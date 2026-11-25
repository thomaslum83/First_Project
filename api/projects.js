const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw)).digest('hex');
}

module.exports = async function handler(req, res) {
  try {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!dbUrl) {
      return res.status(500).json({ error: 'Missing DATABASE_URL in Vercel settings' });
    }

    const sql = neon(dbUrl);

    await sql`
      CREATE TABLE IF NOT EXISTS user_folders (
        owner TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        is_shared BOOLEAN DEFAULT FALSE,
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `;

    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT FALSE;`;

    // Handle user registration / login verification
    if (req.method === 'POST' && req.body && req.body.action === 'auth') {
      const owner = String(req.body.owner || '').trim();
      const password = String(req.body.password || '');
      if (!owner || !password) {
        return res.status(400).json({ error: 'Name and password are required' });
      }

      const pwHash = hashPassword(password);
      const existing = await sql`SELECT password_hash FROM user_folders WHERE LOWER(owner) = LOWER(${owner})`;

      if (existing.length === 0) {
        await sql`INSERT INTO user_folders (owner, password_hash) VALUES (${owner}, ${pwHash})`;
        return res.status(200).json({ success: true, owner, isNew: true });
      }

      if (existing[0].password_hash !== pwHash) {
        return res.status(401).json({ error: 'Incorrect password for this personal folder' });
      }

      return res.status(200).json({ success: true, owner, isNew: false });
    }

    // Load projects (either "All Team Projects" shared view OR verified private folder)
    if (req.method === 'GET') {
      const mode = req.query.mode || 'private';
      if (mode === 'team') {
        const rows = await sql`
          SELECT owner, data FROM projects
          WHERE is_shared = TRUE
          ORDER BY updated_at DESC
        `;
        return res.status(200).json(rows.map(r => ({ ...r.data, _owner: r.owner, isShared: true })));
      }

      const owner = String(req.query.owner || '').trim();
      const password = String(req.query.password || '');
      const users = await sql`SELECT password_hash FROM user_folders WHERE LOWER(owner) = LOWER(${owner})`;

      if (users.length === 0 || users[0].password_hash !== hashPassword(password)) {
        return res.status(401).json({ error: 'Unauthorized folder access' });
      }

      const rows = await sql`
        SELECT owner, is_shared, data FROM projects
        WHERE LOWER(owner) = LOWER(${owner})
        ORDER BY updated_at DESC
      `;
      return res.status(200).json(rows.map(r => ({ ...r.data, _owner: r.owner, isShared: r.is_shared })));
    }

    // Save or update a project inside a verified user's folder
    if (req.method === 'POST') {
      const owner = String(req.body.owner || '').trim();
      const password = String(req.body.password || '');
      const project = req.body.project;
      const isShared = Boolean(project.isShared);

      const users = await sql`SELECT password_hash FROM user_folders WHERE LOWER(owner) = LOWER(${owner})`;
      if (users.length === 0 || users[0].password_hash !== hashPassword(password)) {
        return res.status(401).json({ error: 'Unauthorized save attempt' });
      }

      await sql`
        INSERT INTO projects (id, owner, name, is_shared, data, updated_at)
        VALUES (${project.id}, ${owner}, ${project.name}, ${isShared}, ${JSON.stringify(project)}, NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          is_shared = EXCLUDED.is_shared,
          data = EXCLUDED.data,
          updated_at = NOW()
        WHERE LOWER(projects.owner) = LOWER(${owner});
      `;
      return res.status(200).json({ success: true });
    }

    // Delete a project (only allowed by the project owner)
    if (req.method === 'DELETE') {
      const id = req.query.id;
      const owner = String(req.query.owner || '').trim();
      const password = String(req.query.password || '');

      const users = await sql`SELECT password_hash FROM user_folders WHERE LOWER(owner) = LOWER(${owner})`;
      if (users.length === 0 || users[0].password_hash !== hashPassword(password)) {
        return res.status(401).json({ error: 'Unauthorized delete attempt' });
      }

      await sql`DELETE FROM projects WHERE id = ${id} AND LOWER(owner) = LOWER(${owner})`;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
