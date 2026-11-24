/* Complete Kanban, Gantt & PERT Project Tracker Application */
const STORAGE_KEY = 'kanban_gantt_pert_projects_v16';
const COL_WIDTHS_KEY = 'kanban_gantt_col_widths_v16';

let state = {
  projects: [],
  activeProjectId: null,
  activeView: 'kanban', // 'kanban' | 'gantt' | 'pert'
  ganttScale: 'weeks',  // 'weeks' | 'days'
  ganttZoom: 1,
  editingTaskId: null
};

const DEFAULT_COL_WIDTHS = {
  idx: 58,
  title: 220,
  owner: 110,
  start: 115,
  end: 105,
  days: 65,
  deps: 120
};

let colWidths = { ...DEFAULT_COL_WIDTHS };

/* -------------------- Date Helpers (D/M/YYYY & DD/MM) -------------------- */
function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseDMY(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split('/');
  if (parts.length !== 3) return null;
  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);
  if (isNaN(d) || isNaN(m) || isNaN(y) || y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return isNaN(dt.getTime()) ? null : dt;
}

function formatDMY(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

function formatDDMM(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
}

function addDays(date, days) {
  const res = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  res.setDate(res.getDate() + Math.round(days));
  res.setHours(0, 0, 0, 0);
  return res;
}

function diffDaysInclusive(start, end) {
  const ms = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.round((end - start) / ms) + 1);
}

function todayZero() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getMonday(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/* -------------------- Storage & State Management -------------------- */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.projects)) {
        state.projects = parsed.projects;
      }
    }
  } catch (e) {
    console.warn('Resetting corrupted storage:', e);
    state.projects = [];
  }
  try {
    const cw = localStorage.getItem(COL_WIDTHS_KEY);
    if (cw) {
      colWidths = { ...DEFAULT_COL_WIDTHS, ...JSON.parse(cw) };
    }
  } catch (e) {}
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects: state.projects }));
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

function saveColWidths() {
  try {
    localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidths));
  } catch (e) {}
}

function getActiveProject() {
  return state.projects.find(p => p.id === state.activeProjectId) || null;
}

/* -------------------- Project Creation & Dashboard -------------------- */
window.openProjectModal = function () {
  const modal = document.getElementById('projectModal');
  const input = document.getElementById('projectNameInput');
  const desc = document.getElementById('projectDescInput');
  if (input) input.value = '';
  if (desc) desc.value = '';
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    if (input) setTimeout(() => input.focus(), 50);
  }
};

window.closeProjectModal = function () {
  const modal = document.getElementById('projectModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
};

window.createNewProject = function () {
  const input = document.getElementById('projectNameInput');
  const desc = document.getElementById('projectDescInput');
  const name = input ? input.value.trim() : '';
  if (!name) {
    alert('Please enter a project name.');
    if (input) input.focus();
    return;
  }

  const today = todayZero();
  const sampleEnd = addDays(today, 4);

  const newProj = {
    id: 'proj_' + Date.now(),
    name: name,
    description: desc ? desc.value.trim() : '',
    createdAt: formatDMY(today),
    tasks: [
      {
        id: 'task_' + Date.now() + '_1',
        title: 'Project Kickoff & Planning',
        category: 'To Do',
        owner: 'Team',
        status: 'To Do',
        startDate: formatDMY(today),
        endDate: formatDMY(sampleEnd),
        days: 5,
        startFormula: '',
        dependsOn: [],
        pertX: null,
        pertY: null
      }
    ]
  };

  state.projects.push(newProj);
  saveState();
  window.closeProjectModal();
  openProject(newProj.id);
};

window.handleCreateProject = function (e) {
  if (e && e.preventDefault) e.preventDefault();
  window.createNewProject();
};

function deleteProject(projId, e) {
  if (e) e.stopPropagation();
  if (!confirm('Delete this project permanently?')) return;
  state.projects = state.projects.filter(p => p.id !== projId);
  if (state.activeProjectId === projId) {
    state.activeProjectId = null;
  }
  saveState();
  renderApp();
}

function showDashboard() {
  state.activeProjectId = null;
  renderApp();
}

function openProject(projId) {
  state.activeProjectId = projId;
  state.activeView = 'kanban';
  recalculateProjectSchedule(getActiveProject());
  renderApp();
}

function switchView(view) {
  state.activeView = view;
  renderApp();
}

/* -------------------- Status & Deadline Color Logic -------------------- */
function getTaskColorInfo(task) {
  const status = task.status || 'Pending';
  if (status === 'Completed' || status === 'Done') {
    return { cls: 'color-completed', label: 'Completed', bg: '#111827', text: '#ffffff', isUrgent: false };
  }
  const end = parseDMY(task.endDate);
  const today = todayZero();
  if (end) {
    const diffMs = end - today;
    const daysLeft = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    if (daysLeft < 0) {
      return { cls: 'color-overdue', label: 'Overdue', bg: '#dc2626', text: '#ffffff', isUrgent: true, reason: `Exceeded by ${Math.abs(daysLeft)}d` };
    }
    if (daysLeft <= 7) {
      return { cls: 'color-warning', label: 'Due Soon', bg: '#eab308', text: '#111827', isUrgent: true, reason: daysLeft === 0 ? 'Due today' : `Due in ${daysLeft}d` };
    }
  }
  if (status === 'In Progress') {
    return { cls: 'color-inprogress', label: 'In Progress', bg: '#16a34a', text: '#ffffff', isUrgent: false };
  }
  if (status === 'To Do') {
    return { cls: 'color-todo', label: 'To Do', bg: '#2563eb', text: '#ffffff', isUrgent: false };
  }
  return { cls: 'color-pending', label: 'Pending', bg: '#6b7280', text: '#ffffff', isUrgent: false };
}

/* -------------------- Formula & Schedule Engine -------------------- */
function parseFormula(formulaStr) {
  if (!formulaStr || typeof formulaStr !== 'string') return null;
  const trimmed = formulaStr.trim();
  if (!trimmed.startsWith('=')) return null;
  const match = trimmed.match(/^=\s*(\d+)\s*([+-]\s*\d+)?$/);
  if (!match) return null;
  const rowNum = parseInt(match[1], 10);
  const offset = match[2] ? parseInt(match[2].replace(/\s+/g, ''), 10) : 0;
  return { rowNum, offset };
}

function recalculateProjectSchedule(proj) {
  if (!proj || !Array.isArray(proj.tasks)) return;
  const tasks = proj.tasks;
  // Iterative propagation to resolve chained formulas
  for (let pass = 0; pass < tasks.length + 1; pass++) {
    let changed = false;
    tasks.forEach((task, idx) => {
      const parsed = parseFormula(task.startFormula);
      if (parsed && parsed.rowNum >= 1 && parsed.rowNum <= tasks.length && parsed.rowNum !== idx + 1) {
        const refTask = tasks[parsed.rowNum - 1];
        const refEnd = parseDMY(refTask.endDate);
        if (refEnd) {
          const newStart = addDays(refEnd, parsed.offset);
          const dur = Math.max(1, parseInt(task.days, 10) || 1);
          const newEnd = addDays(newStart, dur - 1);
          const newStartStr = formatDMY(newStart);
          const newEndStr = formatDMY(newEnd);
          if (task.startDate !== newStartStr || task.endDate !== newEndStr) {
            task.startDate = newStartStr;
            task.endDate = newEndStr;
            changed = true;
          }
          if (!Array.isArray(task.dependsOn)) task.dependsOn = [];
          if (!task.dependsOn.includes(refTask.id)) {
            task.dependsOn = [refTask.id];
          }
        }
      } else {
        const s = parseDMY(task.startDate);
        const e = parseDMY(task.endDate);
        if (s && e) {
          if (e < s) {
            task.endDate = formatDMY(s);
            task.days = 1;
          } else {
            task.days = diffDaysInclusive(s, e);
          }
        }
      }
    });
    if (!changed) break;
  }
}

function moveTaskRow(fromIndex, toIndex) {
  const proj = getActiveProject();
  if (!proj) return;
  const tasks = proj.tasks;
  if (fromIndex < 0 || fromIndex >= tasks.length || toIndex < 0 || toIndex >= tasks.length || fromIndex === toIndex) return;

  // Map old task ID -> old 1-based row number
  const oldRowById = {};
  tasks.forEach((t, i) => { oldRowById[t.id] = i + 1; });

  // Capture referenced task ID for each formula before moving
  const formulaRefId = {};
  tasks.forEach(t => {
    const parsed = parseFormula(t.startFormula);
    if (parsed && parsed.rowNum >= 1 && parsed.rowNum <= tasks.length) {
      formulaRefId[t.id] = { refId: tasks[parsed.rowNum - 1].id, offset: parsed.offset };
    }
  });

  const [moved] = tasks.splice(fromIndex, 1);
  tasks.splice(toIndex, 0, moved);

  // Map task ID -> new 1-based row number
  const newRowById = {};
  tasks.forEach((t, i) => { newRowById[t.id] = i + 1; });

  // Rewrite formulas to preserve task links
  tasks.forEach(t => {
    if (formulaRefId[t.id]) {
      const { refId, offset } = formulaRefId[t.id];
      const newRow = newRowById[refId];
      if (newRow) {
        const sign = offset >= 0 ? `+${offset}` : `${offset}`;
        t.startFormula = `=${newRow}${sign}`;
      }
    }
  });

  recalculateProjectSchedule(proj);
  saveState();
  renderApp();
}

function sortTasksByStartDate() {
  const proj = getActiveProject();
  if (!proj) return;
  const tasks = proj.tasks;

  const formulaRefId = {};
  tasks.forEach(t => {
    const parsed = parseFormula(t.startFormula);
    if (parsed && parsed.rowNum >= 1 && parsed.rowNum <= tasks.length) {
      formulaRefId[t.id] = { refId: tasks[parsed.rowNum - 1].id, offset: parsed.offset };
    }
  });

  tasks.sort((a, b) => {
    const sa = parseDMY(a.startDate) || new Date(8640000000000000);
    const sb = parseDMY(b.startDate) || new Date(8640000000000000);
    if (sa.getTime() !== sb.getTime()) return sa - sb;
    const ea = parseDMY(a.endDate) || sa;
    const eb = parseDMY(b.endDate) || sb;
    return ea - eb;
  });

  const newRowById = {};
  tasks.forEach((t, i) => { newRowById[t.id] = i + 1; });

  tasks.forEach(t => {
    if (formulaRefId[t.id]) {
      const { refId, offset } = formulaRefId[t.id];
      const newRow = newRowById[refId];
      if (newRow) {
        const sign = offset >= 0 ? `+${offset}` : `${offset}`;
        t.startFormula = `=${newRow}${sign}`;
      }
    }
  });

  recalculateProjectSchedule(proj);
  saveState();
  renderApp();
}

/* -------------------- Task Modal (Create / Edit) -------------------- */
window.openTaskModal = function (taskId = null, defaultStatus = 'To Do') {
  const proj = getActiveProject();
  if (!proj) return;
  state.editingTaskId = taskId;

  const modal = document.getElementById('taskModal');
  const titleEl = document.getElementById('taskTitleInput');
  const ownerEl = document.getElementById('taskOwnerInput');
  const statusEl = document.getElementById('taskStatusInput');
  const startEl = document.getElementById('taskStartInput');
  const endEl = document.getElementById('taskEndInput');
  const daysEl = document.getElementById('taskDaysInput');
  const depEl = document.getElementById('taskDepInput');
  const modalHeader = document.getElementById('taskModalTitle');

  if (depEl) {
    depEl.innerHTML = '<option value="">None</option>' + proj.tasks
      .filter(t => t.id !== taskId)
      .map((t, idx) => `<option value="${t.id}">#${proj.tasks.indexOf(t) + 1} - ${escapeHtml(t.title)}</option>`)
      .join('');
  }

  if (taskId) {
    const task = proj.tasks.find(t => t.id === taskId);
    if (!task) return;
    if (modalHeader) modalHeader.textContent = 'Edit Task';
    if (titleEl) titleEl.value = task.title || '';
    if (ownerEl) ownerEl.value = task.owner || '';
    if (statusEl) statusEl.value = task.status || 'To Do';
    if (startEl) startEl.value = task.startFormula ? task.startFormula : (task.startDate || '');
    if (endEl) endEl.value = task.endDate || '';
    if (daysEl) daysEl.value = task.days || 1;
    if (depEl) depEl.value = (task.dependsOn && task.dependsOn[0]) ? task.dependsOn[0] : '';
  } else {
    const today = todayZero();
    if (modalHeader) modalHeader.textContent = 'Add New Task';
    if (titleEl) titleEl.value = '';
    if (ownerEl) ownerEl.value = 'Team';
    if (statusEl) statusEl.value = defaultStatus;
    if (startEl) startEl.value = formatDMY(today);
    if (endEl) endEl.value = formatDMY(addDays(today, 2));
    if (daysEl) daysEl.value = 3;
    if (depEl) depEl.value = '';
  }

  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    if (titleEl) setTimeout(() => titleEl.focus(), 50);
  }
};

window.closeTaskModal = function () {
  const modal = document.getElementById('taskModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
  state.editingTaskId = null;
};

window.saveTaskFromModal = function (e) {
  if (e && e.preventDefault) e.preventDefault();
  const proj = getActiveProject();
  if (!proj) return;

  const title = document.getElementById('taskTitleInput').value.trim();
  if (!title) {
    alert('Task title is required.');
    return;
  }
  const owner = document.getElementById('taskOwnerInput').value.trim() || 'Unassigned';
  const status = document.getElementById('taskStatusInput').value;
  const rawStart = document.getElementById('taskStartInput').value.trim();
  const rawEnd = document.getElementById('taskEndInput').value.trim();
  const daysVal = Math.max(1, parseInt(document.getElementById('taskDaysInput').value, 10) || 1);
  const depVal = document.getElementById('taskDepInput').value;

  let startFormula = '';
  let startDate = formatDMY(todayZero());
  let endDate = formatDMY(addDays(todayZero(), daysVal - 1));

  if (rawStart.startsWith('=')) {
    startFormula = rawStart;
  } else if (parseDMY(rawStart)) {
    startDate = formatDMY(parseDMY(rawStart));
    if (parseDMY(rawEnd) && parseDMY(rawEnd) >= parseDMY(rawStart)) {
      endDate = formatDMY(parseDMY(rawEnd));
    } else {
      endDate = formatDMY(addDays(parseDMY(startDate), daysVal - 1));
    }
  }

  const dependsOn = depVal ? [depVal] : [];

  if (state.editingTaskId) {
    const task = proj.tasks.find(t => t.id === state.editingTaskId);
    if (task) {
      task.title = title;
      task.owner = owner;
      task.status = status;
      task.startFormula = startFormula;
      task.startDate = startDate;
      task.endDate = endDate;
      task.days = daysVal;
      task.dependsOn = dependsOn;
    }
  } else {
    proj.tasks.push({
      id: 'task_' + Date.now(),
      title,
      owner,
      status,
      startFormula,
      startDate,
      endDate,
      days: daysVal,
      dependsOn,
      pertX: null,
      pertY: null
    });
  }

  recalculateProjectSchedule(proj);
  sortTasksByStartDate();
  window.closeTaskModal();
};

function deleteTask(taskId, e) {
  if (e) e.stopPropagation();
  const proj = getActiveProject();
  if (!proj) return;
  if (!confirm('Delete this task?')) return;
  proj.tasks = proj.tasks.filter(t => t.id !== taskId);
  proj.tasks.forEach(t => {
    if (Array.isArray(t.dependsOn)) {
      t.dependsOn = t.dependsOn.filter(id => id !== taskId);
    }
  });
  recalculateProjectSchedule(proj);
  saveState();
  renderApp();
}

/* -------------------- Export / Import JSON & CSV -------------------- */
function exportJSON() {
  const dataStr = JSON.stringify({ projects: state.projects }, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `projects_backup_${formatDMY(todayZero()).replace(/\//g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function triggerImportJSON() {
  const input = document.getElementById('importJsonInput');
  if (input) input.click();
}

function handleImportJSON(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (evt) {
    try {
      const parsed = JSON.parse(evt.target.result);
      if (parsed && Array.isArray(parsed.projects)) {
        state.projects = parsed.projects;
        state.activeProjectId = null;
        saveState();
        renderApp();
        alert(`Imported ${parsed.projects.length} project(s) successfully.`);
      } else {
        alert('Invalid JSON format. Expected { "projects": [...] }.');
      }
    } catch (err) {
      alert('Failed to parse JSON file.');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

function exportCSV() {
  const proj = getActiveProject();
  if (!proj) return;
  const headers = ['Row', 'Task Title', 'Owner', 'Status', 'Start Date', 'End Date', 'Days', 'Formula', 'Depends On'];
  const rows = proj.tasks.map((t, idx) => {
    const depNames = (t.dependsOn || [])
      .map(id => {
        const foundIdx = proj.tasks.findIndex(x => x.id === id);
        return foundIdx >= 0 ? `#${foundIdx + 1} ${proj.tasks[foundIdx].title}` : '';
      })
      .filter(Boolean)
      .join('; ');
    return [
      idx + 1,
      `"${(t.title || '').replace(/"/g, '""')}"`,
      `"${(t.owner || '').replace(/"/g, '""')}"`,
      `"${(t.status || '').replace(/"/g, '""')}"`,
      t.startDate || '',
      t.endDate || '',
      t.days || 1,
      `"${(t.startFormula || '').replace(/"/g, '""')}"`,
      `"${depNames.replace(/"/g, '""')}"`
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${proj.name.replace(/[^a-z0-9]/gi, '_')}_schedule.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* -------------------- Rendering Entry -------------------- */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderApp() {
  const dashboardEl = document.getElementById('dashboardView');
  const workspaceEl = document.getElementById('workspaceView');
  const proj = getActiveProject();

  if (!proj) {
    if (dashboardEl) dashboardEl.classList.remove('hidden');
    if (workspaceEl) workspaceEl.classList.add('hidden');
    renderDashboard();
  } else {
    if (dashboardEl) dashboardEl.classList.add('hidden');
    if (workspaceEl) workspaceEl.classList.remove('hidden');
    renderWorkspace(proj);
  }
}

function renderDashboard() {
  const grid = document.getElementById('projectsGrid');
  if (!grid) return;

  if (state.projects.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <p>No projects yet. Click <strong>+ New Project</strong> at the top to create your first workspace, or import a JSON backup.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = state.projects.map(p => {
    const total = p.tasks ? p.tasks.length : 0;
    const done = p.tasks ? p.tasks.filter(t => t.status === 'Completed' || t.status === 'Done').length : 0;
    return `
      <div class="project-card" onclick="openProject('${p.id}')">
        <div class="project-card-header">
          <h3>${escapeHtml(p.name)}</h3>
          <button class="btn-icon-danger" title="Delete Project" onclick="deleteProject('${p.id}', event)">✕</button>
        </div>
        <p class="project-desc">${escapeHtml(p.description || 'No description provided.')}</p>
        <div class="project-meta">
          <span>📋 ${done}/${total} Completed</span>
          <span>📅 ${escapeHtml(p.createdAt || '')}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderWorkspace(proj) {
  const titleEl = document.getElementById('activeProjectTitle');
  if (titleEl) titleEl.textContent = proj.name;

  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === state.activeView);
  });

  const kanbanContainer = document.getElementById('kanbanView');
  const ganttContainer = document.getElementById('ganttView');
  const pertContainer = document.getElementById('pertView');

  if (kanbanContainer) kanbanContainer.classList.toggle('hidden', state.activeView !== 'kanban');
  if (ganttContainer) ganttContainer.classList.toggle('hidden', state.activeView !== 'gantt');
  if (pertContainer) pertContainer.classList.toggle('hidden', state.activeView !== 'pert');

  if (state.activeView === 'kanban') renderKanban(proj);
  else if (state.activeView === 'gantt') renderGantt(proj);
  else if (state.activeView === 'pert') renderPert(proj);
}

/* -------------------- Kanban View -------------------- */
function renderKanban(proj) {
  const board = document.getElementById('kanbanBoard');
  if (!board) return;

  const urgentTasks = proj.tasks.filter(t => getTaskColorInfo(t).isUrgent);

  const columns = [
    { key: 'URGENT', title: '⚠️ Past Deadline / Warning', tasks: urgentTasks, droppable: false },
    { key: 'Pending', title: 'Pending', tasks: proj.tasks.filter(t => (t.status || 'Pending') === 'Pending'), droppable: true },
    { key: 'To Do', title: 'To Do', tasks: proj.tasks.filter(t => t.status === 'To Do'), droppable: true },
    { key: 'In Progress', title: 'In Progress', tasks: proj.tasks.filter(t => t.status === 'In Progress'), droppable: true },
    { key: 'Completed', title: 'Completed', tasks: proj.tasks.filter(t => t.status === 'Completed' || t.status === 'Done'), droppable: true }
  ];

  board.innerHTML = columns.map(col => {
    const cardsHtml = col.tasks.map(task => {
      const cInfo = getTaskColorInfo(task);
      const badge = cInfo.reason ? `<span class="urgent-badge">${escapeHtml(cInfo.reason)}</span>` : '';
      return `
        <div class="kanban-card ${cInfo.cls}"
             style="border-left: 6px solid ${cInfo.bg};"
             draggable="true"
             ondragstart="onKanbanDragStart(event, '${task.id}')"
             onclick="openTaskModal('${task.id}')">
          <div class="kanban-card-top">
            <span class="status-pill" style="background:${cInfo.bg}; color:${cInfo.text};">${escapeHtml(task.status)}</span>
            ${badge}
            <button class="btn-card-del" onclick="deleteTask('${task.id}', event)" title="Delete">✕</button>
          </div>
          <div class="kanban-card-title">${escapeHtml(task.title)}</div>
          <div class="kanban-card-meta">
            <span>👤 ${escapeHtml(task.owner || 'Team')}</span>
            <span>📅 ${escapeHtml(task.startDate)} → ${escapeHtml(task.endDate)} (${task.days}d)</span>
          </div>
        </div>
      `;
    }).join('');

    const dropAttrs = col.droppable
      ? `ondragover="event.preventDefault()" ondrop="onKanbanDrop(event, '${col.key}')"`
      : '';

    const addBtn = col.droppable
      ? `<button class="btn-add-col-task" onclick="openTaskModal(null, '${col.key}')">+ Add Task</button>`
      : '';

    return `
      <div class="kanban-column ${col.key === 'URGENT' ? 'kanban-column-urgent' : ''}" ${dropAttrs}>
        <div class="kanban-col-header">
          <span>${col.title}</span>
          <span class="col-count">${col.tasks.length}</span>
        </div>
        <div class="kanban-cards-list">${cardsHtml || '<div class="col-empty">No tasks</div>'}</div>
        ${addBtn}
      </div>
    `;
  }).join('');
}

let draggedKanbanTaskId = null;
window.onKanbanDragStart = function (e, taskId) {
  draggedKanbanTaskId = taskId;
  e.dataTransfer.effectAllowed = 'move';
};

window.onKanbanDrop = function (e, targetStatus) {
  e.preventDefault();
  if (!draggedKanbanTaskId) return;
  const proj = getActiveProject();
  if (!proj) return;
  const task = proj.tasks.find(t => t.id === draggedKanbanTaskId);
  if (task) {
    task.status = targetStatus;
    saveState();
    renderApp();
  }
  draggedKanbanTaskId = null;
};

/* -------------------- Gantt View -------------------- */
function setGanttScale(scale) {
  state.ganttScale = scale;
  renderApp();
}

function adjustGanttZoom(delta) {
  state.ganttZoom = Math.max(0.5, Math.min(2.5, +(state.ganttZoom + delta).toFixed(2)));
  renderApp();
}

function renderGantt(proj) {
  const container = document.getElementById('ganttContainer');
  if (!container) return;

  recalculateProjectSchedule(proj);
  const tasks = proj.tasks;

  // Determine timeline bounds
  let minDate = todayZero();
  let maxDate = addDays(minDate, 28);

  tasks.forEach(t => {
    const s = parseDMY(t.startDate);
    const e = parseDMY(t.endDate);
    if (s && s < minDate) minDate = new Date(s);
    if (e && e > maxDate) maxDate = new Date(e);
  });

  minDate = getMonday(addDays(minDate, -7));
  maxDate = addDays(maxDate, 14);

  const totalDays = Math.max(14, diffDaysInclusive(minDate, maxDate));
  const pxPerDay = (state.ganttScale === 'weeks' ? 18 : 42) * state.ganttZoom;
  const timelineWidth = totalDays * pxPerDay;
  const rowHeight = 44;

  // Build timeline header cells
  let headerHtml = '';
  let gridLinesHtml = '';

  if (state.ganttScale === 'weeks') {
    let cur = new Date(minDate);
    while (cur <= maxDate) {
      const wk = getISOWeek(cur);
      const wWidth = 7 * pxPerDay;
      headerHtml += `
        <div class="gantt-time-cell" style="width:${wWidth}px;">
          <div class="wk-num">W${wk}</div>
          <div class="wk-date">${cur.getDate()}/${cur.getMonth() + 1}</div>
        </div>
      `;
      gridLinesHtml += `<div class="gantt-grid-col" style="width:${wWidth}px;"></div>`;
      cur = addDays(cur, 7);
    }
  } else {
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(minDate, i);
      const isWknd = d.getDay() === 0 || d.getDay() === 6;
      headerHtml += `
        <div class="gantt-time-cell ${isWknd ? 'weekend' : ''}" style="width:${pxPerDay}px;">
          <div class="wk-num">${d.getDate()}/${d.getMonth() + 1}</div>
          <div class="wk-date">${dayNames[d.getDay()]}</div>
        </div>
      `;
      gridLinesHtml += `<div class="gantt-grid-col ${isWknd ? 'weekend' : ''}" style="width:${pxPerDay}px;"></div>`;
    }
  }

  // Today marker
  const today = todayZero();
  let todayMarkerHtml = '';
  if (today >= minDate && today <= maxDate) {
    const offsetDays = (today - minDate) / (24 * 60 * 60 * 1000);
    const leftPx = offsetDays * pxPerDay + pxPerDay / 2;
    todayMarkerHtml = `<div class="gantt-today-line" style="left:${leftPx}px;" title="Today (${formatDMY(today)})"></div>`;
  }

  // Spreadsheet rows + Timeline bars
  const tableRowsHtml = tasks.map((t, idx) => {
    const startDisplay = t.startFormula ? t.startFormula : (t.startDate || '');
    const depVal = (t.dependsOn && t.dependsOn[0]) ? t.dependsOn[0] : '';
    const depOptions = '<option value="">None</option>' + tasks
      .map((other, oIdx) => other.id === t.id ? '' : `<option value="${other.id}" ${depVal === other.id ? 'selected' : ''}>#${oIdx + 1} ${escapeHtml(other.title)}</option>`)
      .join('');

    return `
      <tr class="gantt-row" data-row-idx="${idx}"
          ondragover="event.preventDefault()"
          ondrop="onGanttRowDrop(event, ${idx})">
        <td style="width:${colWidths.idx}px;" class="cell-idx">
          <span class="drag-handle" draggable="true" ondragstart="onGanttRowDragStart(event, ${idx})" title="Drag row">⋮⋮</span>
          <span>${idx + 1}</span>
          <span class="row-arrows">
            <button onclick="moveTaskRow(${idx}, ${idx - 1})" ${idx === 0 ? 'disabled' : ''} title="Move Up">▲</button>
            <button onclick="moveTaskRow(${idx}, ${idx + 1})" ${idx === tasks.length - 1 ? 'disabled' : ''} title="Move Down">▼</button>
          </span>
        </td>
        <td style="width:${colWidths.title}px;">
          <input class="cell-input" value="${escapeHtml(t.title)}" onchange="updateTaskField('${t.id}', 'title', this.value)" />
        </td>
        <td style="width:${colWidths.owner}px;">
          <input class="cell-input" value="${escapeHtml(t.owner || '')}" onchange="updateTaskField('${t.id}', 'owner', this.value)" />
        </td>
        <td style="width:${colWidths.start}px;">
          <input class="cell-input" value="${escapeHtml(startDisplay)}" title="Enter D/M/YYYY or formula like =1+3" onchange="updateTaskStartCell('${t.id}', this.value)" />
        </td>
        <td style="width:${colWidths.end}px;">
          <input class="cell-input" value="${escapeHtml(t.endDate || '')}" onchange="updateTaskEndCell('${t.id}', this.value)" />
        </td>
        <td style="width:${colWidths.days}px;">
          <input class="cell-input cell-num" type="number" min="1" value="${t.days || 1}" onchange="updateTaskDaysCell('${t.id}', this.value)" />
        </td>
        <td style="width:${colWidths.deps}px;">
          <select class="cell-select" onchange="updateTaskDepCell('${t.id}', this.value)">${depOptions}</select>
        </td>
      </tr>
    `;
  }).join('');

  // Bars & Dependency coordinates
  const barCoords = {};
  const barsHtml = tasks.map((t, idx) => {
    const s = parseDMY(t.startDate);
    const e = parseDMY(t.endDate);
    if (!s || !e) return '';
    const startOffset = Math.max(0, (s - minDate) / (24 * 60 * 60 * 1000));
    const durDays = diffDaysInclusive(s, e);
    const left = startOffset * pxPerDay;
    const width = Math.max(48, durDays * pxPerDay);
    const top = idx * rowHeight + 6;
    const height = rowHeight - 12;

    barCoords[t.id] = { left, right: left + width, centerY: top + height / 2 };
    const cInfo = getTaskColorInfo(t);

    return `
      <div class="gantt-bar"
           data-task-id="${t.id}"
           style="left:${left}px; top:${top}px; width:${width}px; height:${height}px; background:${cInfo.bg}; color:${cInfo.text};"
           onmousedown="startBarDrag(event, '${t.id}', 'move', ${pxPerDay})"
           ondblclick="openTaskModal('${t.id}')">
        <div class="bar-resize-left" onmousedown="startBarDrag(event, '${t.id}', 'left', ${pxPerDay})"></div>
        <span class="bar-date-left">${formatDDMM(s)}</span>
        <span class="bar-label">${escapeHtml(t.title)}</span>
        <span class="bar-date-right">${formatDDMM(e)}</span>
        <div class="bar-resize-right" onmousedown="startBarDrag(event, '${t.id}', 'right', ${pxPerDay})"></div>
      </div>
    `;
  }).join('');

  // Thin dashed dependency SVG arrows
  let svgArrows = '';
  tasks.forEach(t => {
    if (!Array.isArray(t.dependsOn)) return;
    t.dependsOn.forEach(predId => {
      const from = barCoords[predId];
      const to = barCoords[t.id];
      if (!from || !to) return;
      const x1 = from.right;
      const y1 = from.centerY;
      const x2 = to.left;
      const y2 = to.centerY;
      const midX = x1 + Math.max(12, (x2 - x1) / 2);
      const pathD = x2 >= x1 + 10
        ? `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
        : `M ${x1} ${y1} L ${x1 + 10} ${y1} L ${x1 + 10} ${(y1 + y2) / 2} L ${x2 - 10} ${(y1 + y2) / 2} L ${x2 - 10} ${y2} L ${x2} ${y2}`;
      svgArrows += `<path d="${pathD}" fill="none" stroke="#dc2626" stroke-width="1.25" stroke-dasharray="4,3" marker-end="url(#depArrow)" />`;
    });
  });

  const bodyHeight = Math.max(240, tasks.length * rowHeight);

  container.innerHTML = `
    <div class="gantt-toolbar">
      <div class="gantt-toolbar-group">
        <button class="btn-secondary" onclick="openTaskModal()">+ Add Task</button>
        <button class="btn-secondary" onclick="sortTasksByStartDate()">⇅ Sort by Start Date</button>
      </div>
      <div class="gantt-toolbar-group">
        <div class="scale-toggle">
          <button class="${state.ganttScale === 'weeks' ? 'active' : ''}" onclick="setGanttScale('weeks')">Weeks</button>
          <button class="${state.ganttScale === 'days' ? 'active' : ''}" onclick="setGanttScale('days')">Days</button>
        </div>
        <button class="btn-secondary" onclick="adjustGanttZoom(-0.2)" title="Shrink">−</button>
        <button class="btn-secondary" onclick="adjustGanttZoom(0.2)" title="Expand">+</button>
      </div>
    </div>
    <div class="gantt-split">
      <div class="gantt-left">
        <table class="gantt-table">
          <thead>
            <tr>
              ${renderResizableTh('idx', '#')}
              ${renderResizableTh('title', 'Task / Description')}
              ${renderResizableTh('owner', 'Owner')}
              ${renderResizableTh('start', 'Start')}
              ${renderResizableTh('end', 'End')}
              ${renderResizableTh('days', 'Days')}
              ${renderResizableTh('deps', 'Depends On')}
            </tr>
          </thead>
          <tbody>${tableRowsHtml}</tbody>
        </table>
      </div>
      <div class="gantt-right">
        <div class="gantt-timeline-inner" style="width:${timelineWidth}px;">
          <div class="gantt-timeline-header">${headerHtml}</div>
          <div class="gantt-timeline-body" style="height:${bodyHeight}px;">
            <div class="gantt-grid-bg">${gridLinesHtml}</div>
            ${todayMarkerHtml}
            <svg class="gantt-arrows-svg" width="${timelineWidth}" height="${bodyHeight}">
              <defs>
                <marker id="depArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#dc2626" />
                </marker>
              </defs>
              ${svgArrows}
            </svg>
            ${barsHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderResizableTh(key, label) {
  const w = colWidths[key] || 100;
  return `
    <th style="width:${w}px; min-width:${w}px; max-width:${w}px;">
      <span>${label}</span>
      <div class="col-resizer" onmousedown="startColResize(event, '${key}')"></div>
    </th>
  `;
}

/* Column Resizing */
window.startColResize = function (e, key) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startW = colWidths[key] || 100;

  function onMove(ev) {
    colWidths[key] = Math.max(45, startW + (ev.clientX - startX));
    renderGantt(getActiveProject());
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    saveColWidths();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
};

/* Row Drag Reordering */
let draggedGanttRowIdx = null;
window.onGanttRowDragStart = function (e, idx) {
  draggedGanttRowIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
};
window.onGanttRowDrop = function (e, targetIdx) {
  e.preventDefault();
  if (draggedGanttRowIdx !== null && draggedGanttRowIdx !== targetIdx) {
    moveTaskRow(draggedGanttRowIdx, targetIdx);
  }
  draggedGanttRowIdx = null;
};

/* Inline Cell Updates */
window.updateTaskField = function (taskId, field, val) {
  const proj = getActiveProject();
  if (!proj) return;
  const task = proj.tasks.find(t => t.id === taskId);
  if (task) {
    task[field] = val.trim();
    saveState();
    renderApp();
  }
};

window.updateTaskStartCell = function (taskId, val) {
  const proj = getActiveProject();
  if (!proj) return;
  const task = proj.tasks.find(t => t.id === taskId);
  if (!task) return;
  const trimmed = val.trim();
  if (trimmed.startsWith('=')) {
    const parsed = parseFormula(trimmed);
    if (!parsed) {
      alert('Invalid formula. Use format like =1+3 (3 days after Row #1).');
      renderApp();
      return;
    }
    task.startFormula = trimmed;
  } else {
    const dt = parseDMY(trimmed);
    if (!dt) {
      alert('Invalid date. Please use D/M/YYYY format or a formula like =1+3.');
      renderApp();
      return;
    }
    task.startFormula = '';
    task.startDate = formatDMY(dt);
    const dur = Math.max(1, parseInt(task.days, 10) || 1);
    task.endDate = formatDMY(addDays(dt, dur - 1));
  }
  recalculateProjectSchedule(proj);
  saveState();
  renderApp();
};

window.updateTaskEndCell = function (taskId, val) {
  const proj = getActiveProject();
  if (!proj) return;
  const task = proj.tasks.find(t => t.id === taskId);
  if (!task) return;
  const dt = parseDMY(val);
  if (!dt) {
    alert('Invalid date. Please use D/M/YYYY format.');
    renderApp();
    return;
  }
  const s = parseDMY(task.startDate);
  if (s && dt < s) {
    alert('End date cannot be earlier than Start date.');
    renderApp();
    return;
  }
  task.endDate = formatDMY(dt);
  if (s) task.days = diffDaysInclusive(s, dt);
  recalculateProjectSchedule(proj);
  saveState();
  renderApp();
};

window.updateTaskDaysCell = function (taskId, val) {
  const proj = getActiveProject();
  if (!proj) return;
  const task = proj.tasks.find(t => t.id === taskId);
  if (!task) return;
  const days = Math.max(1, parseInt(val, 10) || 1);
  task.days = days;
  const s = parseDMY(task.startDate);
  if (s) {
    task.endDate = formatDMY(addDays(s, days - 1));
  }
  recalculateProjectSchedule(proj);
  saveState();
  renderApp();
};

window.updateTaskDepCell = function (taskId, depTaskId) {
  const proj = getActiveProject();
  if (!proj) return;
  const task = proj.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.dependsOn = depTaskId ? [depTaskId] : [];
  if (!depTaskId) {
    task.startFormula = '';
  }
  recalculateProjectSchedule(proj);
  saveState();
  renderApp();
};

/* Interactive Bar Dragging & Resizing */
window.startBarDrag = function (e, taskId, mode, pxPerDay) {
  e.preventDefault();
  e.stopPropagation();
  const proj = getActiveProject();
  if (!proj) return;
  const task = proj.tasks.find(t => t.id === taskId);
  if (!task) return;

  const origStart = parseDMY(task.startDate);
  const origEnd = parseDMY(task.endDate);
  if (!origStart || !origEnd) return;

  const startX = e.clientX;
  let lastDeltaDays = 0;

  function onMove(ev) {
    const dx = ev.clientX - startX;
    const deltaDays = Math.round(dx / pxPerDay);
    if (deltaDays === lastDeltaDays) return;
    lastDeltaDays = deltaDays;

    if (mode === 'move') {
      task.startFormula = '';
      task.startDate = formatDMY(addDays(origStart, deltaDays));
      task.endDate = formatDMY(addDays(origEnd, deltaDays));
    } else if (mode === 'left') {
      task.startFormula = '';
      const candidateStart = addDays(origStart, deltaDays);
      if (candidateStart <= origEnd) {
        task.startDate = formatDMY(candidateStart);
        task.days = diffDaysInclusive(candidateStart, origEnd);
      }
    } else if (mode === 'right') {
      const candidateEnd = addDays(origEnd, deltaDays);
      if (candidateEnd >= origStart) {
        task.endDate = formatDMY(candidateEnd);
        task.days = diffDaysInclusive(origStart, candidateEnd);
      }
    }
    recalculateProjectSchedule(proj);
    renderGantt(proj);
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    saveState();
    renderApp();
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
};

/* -------------------- PERT Chart View & Critical Path -------------------- */
function renderPert(proj) {
  const container = document.getElementById('pertContainer');
  if (!container) return;

  recalculateProjectSchedule(proj);
  const tasks = proj.tasks;
  if (tasks.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Add tasks to generate the PERT network diagram.</p></div>';
    return;
  }

  // Build adjacency & Critical Path metrics (ES, EF, LS, LF, Slack)
  const taskMap = {};
  const preds = {};
  const succs = {};
  tasks.forEach(t => {
    taskMap[t.id] = t;
    preds[t.id] = [];
    succs[t.id] = [];
  });

  tasks.forEach(t => {
    if (Array.isArray(t.dependsOn)) {
      t.dependsOn.forEach(pid => {
        if (taskMap[pid]) {
          preds[t.id].push(pid);
          succs[pid].push(t.id);
        }
      });
    }
  });

  // Topological sort (Kahn's algorithm)
  const inDegree = {};
  tasks.forEach(t => { inDegree[t.id] = preds[t.id].length; });
  const queue = tasks.filter(t => inDegree[t.id] === 0).map(t => t.id);
  const topo = [];
  const stage = {};
  queue.forEach(id => { stage[id] = 0; });

  while (queue.length > 0) {
    const u = queue.shift();
    topo.push(u);
    succs[u].forEach(v => {
      stage[v] = Math.max(stage[v] || 0, (stage[u] || 0) + 1);
      inDegree[v]--;
      if (inDegree[v] === 0) queue.push(v);
    });
  }
  // Handle any cycles gracefully
  tasks.forEach(t => {
    if (!topo.includes(t.id)) {
      topo.push(t.id);
      stage[t.id] = 0;
    }
  });

  // Forward pass
  const es = {}, ef = {};
  topo.forEach(id => {
    const dur = Math.max(1, parseInt(taskMap[id].days, 10) || 1);
    es[id] = preds[id].length === 0 ? 0 : Math.max(...preds[id].map(p => ef[p] || 0));
    ef[id] = es[id] + dur;
  });

  const projectFinish = Math.max(1, ...topo.map(id => ef[id] || 0));

  // Backward pass
  const ls = {}, lf = {}, slack = {};
  [...topo].reverse().forEach(id => {
    const dur = Math.max(1, parseInt(taskMap[id].days, 10) || 1);
    lf[id] = succs[id].length === 0 ? projectFinish : Math.min(...succs[id].map(s => ls[s] ?? projectFinish));
    ls[id] = lf[id] - dur;
    slack[id] = Math.max(0, ls[id] - es[id]);
  });

  // Auto-position nodes by stage if pertX/pertY not set
  const stageCounts = {};
  const nodeW = 210;
  const nodeH = 105;
  const colGap = 270;
  const rowGap = 135;

  tasks.forEach(t => {
    const st = stage[t.id] || 0;
    const rowInStage = stageCounts[st] || 0;
    stageCounts[st] = rowInStage + 1;
    if (t.pertX == null || t.pertY == null) {
      t.pertX = 40 + st * colGap;
      t.pertY = 40 + rowInStage * rowGap;
    }
  });

  const maxX = Math.max(900, ...tasks.map(t => (t.pertX || 0) + nodeW + 80));
  const maxY = Math.max(520, ...tasks.map(t => (t.pertY || 0) + nodeH + 80));

  let arrowsSvg = '';
  tasks.forEach(t => {
    preds[t.id].forEach(pid => {
      const from = taskMap[pid];
      if (!from) return;
      const isCritEdge = slack[pid] === 0 && slack[t.id] === 0 && ef[pid] === es[t.id];
      const x1 = from.pertX + nodeW;
      const y1 = from.pertY + nodeH / 2;
      const x2 = t.pertX;
      const y2 = t.pertY + nodeH / 2;
      const cx1 = x1 + Math.max(40, (x2 - x1) * 0.45);
      const cx2 = x2 - Math.max(40, (x2 - x1) * 0.45);
      const color = isCritEdge ? '#dc2626' : '#64748b';
      const width = isCritEdge ? 2.2 : 1.4;
      const marker = isCritEdge ? 'url(#pertCritArrow)' : 'url(#pertNormArrow)';
      arrowsSvg += `<path d="M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}" marker-end="${marker}" />`;
    });
  });

  const nodesHtml = tasks.map((t, idx) => {
    const isCritical = slack[t.id] === 0;
    const cInfo = getTaskColorInfo(t);
    return `
      <div class="pert-node ${isCritical ? 'pert-critical' : ''}"
           style="left:${t.pertX}px; top:${t.pertY}px; width:${nodeW}px;"
           onmousedown="startPertNodeDrag(event, '${t.id}')"
           ondblclick="openTaskModal('${t.id}')">
        <div class="pert-node-header" style="background:${cInfo.bg}; color:${cInfo.text};">
          <span>#${idx + 1} ${isCritical ? '🔥 Critical' : escapeHtml(t.status)}</span>
          <span>${t.days}d</span>
        </div>
        <div class="pert-node-title">${escapeHtml(t.title)}</div>
        <div class="pert-node-dates">${escapeHtml(t.startDate)} → ${escapeHtml(t.endDate)}</div>
        <div class="pert-node-metrics">
          <span>ES:${es[t.id]} EF:${ef[t.id]}</span>
          <span>Slack: ${slack[t.id]}d</span>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="pert-toolbar">
      <div class="pert-legend">
        <span class="legend-crit">🔥 Red Border/Arrows = Critical Path (0 Slack)</span>
        <span>• Total Duration: <strong>${projectFinish} days</strong></span>
        <span>• Drag boxes to arrange</span>
      </div>
      <button class="btn-secondary" onclick="resetPertLayout()">🔄 Auto Layout</button>
    </div>
    <div class="pert-canvas-wrap">
      <div class="pert-canvas" style="width:${maxX}px; height:${maxY}px;">
        <svg width="${maxX}" height="${maxY}" class="pert-svg">
          <defs>
            <marker id="pertCritArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 Z" fill="#dc2626" />
            </marker>
            <marker id="pertNormArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 Z" fill="#64748b" />
            </marker>
          </defs>
          ${arrowsSvg}
        </svg>
        ${nodesHtml}
      </div>
    </div>
  `;
}

window.resetPertLayout = function () {
  const proj = getActiveProject();
  if (!proj) return;
  proj.tasks.forEach(t => {
    t.pertX = null;
    t.pertY = null;
  });
  saveState();
  renderPert(proj);
};

window.startPertNodeDrag = function (e, taskId) {
  e.preventDefault();
  const proj = getActiveProject();
  if (!proj) return;
  const task = proj.tasks.find(t => t.id === taskId);
  if (!task) return;

  const startX = e.clientX;
  const startY = e.clientY;
  const origX = task.pertX || 0;
  const origY = task.pertY || 0;

  function onMove(ev) {
    task.pertX = Math.max(10, origX + (ev.clientX - startX));
    task.pertY = Math.max(10, origY + (ev.clientY - startY));
    renderPert(proj);
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    saveState();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
};

/* -------------------- Initialize on DOM Ready -------------------- */
document.addEventListener('DOMContentLoaded', function () {
  loadState();
  renderApp();
});
