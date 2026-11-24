const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
  try {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!dbUrl) {
      return res.status(500).json({ error: 'Missing DATABASE_URL in Vercel settings' });
    }

    const sql = neon(dbUrl);
    const owner = req.query.owner || (req.body && req.body.owner) || 'default';

    if (req.method === 'GET') {
      const rows = await sql`SELECT data FROM projects WHERE owner = ${owner} ORDER BY updated_at DESC`;
      return res.status(200).json(rows.map(r => r.data));
    }

    if (req.method === 'POST') {
      const project = req.body.project;
      await sql`
        INSERT INTO projects (id, owner, name, data, updated_at)
        VALUES (${project.id}, ${owner}, ${project.name}, ${JSON.stringify(project)}, NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          data = EXCLUDED.data,
          updated_at = NOW();
      `;
      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      await sql`DELETE FROM projects WHERE id = ${id} AND owner = ${owner}`;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
