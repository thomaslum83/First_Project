/* =========================================================
   Project Kanban, Gantt & PERT Tracker - Main Application
   ========================================================= */

const STORAGE_KEY = 'pk_gantt_pert_projects_v1';
const COL_WIDTH_KEY = 'pk_gantt_col_widths_v1';

let state = {
  projects: [],
  activeProjectId: null,
  currentView: 'kanban', // 'kanban' | 'gantt' | 'pert'
  ganttScale: 'weeks',   // 'weeks' | 'days'
  ganttZoom: 1,          // multiplier
  colWidths: {
    idx: 56,
    name: 220,
    owner: 110,
    start: 105,
    end: 105,
    days: 65,
    deps: 130
  }
};

/* -------------------------
   Initialization & Storage
   ------------------------- */
function init() {
  loadState();
  bindGlobalEvents();
  renderDashboard();
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        state.projects = parsed;
      }
    }
    const savedCols = localStorage.getItem(COL_WIDTH_KEY);
    if (savedCols) {
      state.colWidths = { ...state.colWidths, ...JSON.parse(savedCols) };
    }
  } catch (e) {
    console.error('Failed to load saved state:', e);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.projects));
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

function saveColWidths() {
  try {
    localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(state.colWidths));
  } catch (e) {
    console.error('Failed to save column widths:', e);
  }
}

function getActiveProject() {
  return state.projects.find(p => p.id === state.activeProjectId) || null;
}

function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/* -------------------------
   Date Helpers (D/M/YYYY)
   ------------------------- */
function parseDMY(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split('/');
  if (parts.length !== 3) return null;
  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);
  if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function formatDMY(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

function formatDDMM(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

function addDays(date, days) {
  const res = new Date(date);
  res.setDate(res.getDate() + days);
  res.setHours(0, 0, 0, 0);
  return res;
}

function diffDaysInclusive(startDate, endDate) {
  if (!startDate || !endDate) return 1;
  const ms = endDate.getTime() - startDate.getTime();
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

function todayMidnight() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function getISOWeek(date) {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/* -------------------------
   Task Status & Color Logic
   ------------------------- */
function getTaskVisualMeta(task) {
  const status = task.status || 'Pending';
  const end = parseDMY(task.endDate);
  const today = todayMidnight();

  let urgency = 'normal'; // 'overdue' | 'warning' | 'normal'
  let colorClass = 'status-pending';

  if (status === 'Completed') {
    colorClass = 'status-completed';
  } else {
    if (end) {
      const daysLeft = Math.round((end.getTime() - today.getTime()) / 86400000);
      if (daysLeft < 0) {
        urgency = 'overdue';
        colorClass = 'status-overdue';
      } else if (daysLeft <= 7) {
        urgency = 'warning';
        colorClass = 'status-warning';
      }
    }
    if (urgency === 'normal') {
      if (status === 'To Do') colorClass = 'status-todo';
      else if (status === 'In Progress') colorClass = 'status-inprogress';
      else colorClass = 'status-pending';
    }
  }

  return { urgency, colorClass };
}

/* -------------------------
   Formula & Dependency Sync
   ------------------------- */
function recalculateProjectSchedule(project) {
  if (!project || !Array.isArray(project.tasks)) return;
  const tasks = project.tasks;

  // Resolve formulas multiple passes to handle chains
  for (let pass = 0; pass < tasks.length; pass++) {
    tasks.forEach((task, idx) => {
      if (task.startFormula && task.startFormula.trim().startsWith('=')) {
        const expr = task.startFormula.trim().slice(1).replace(/\s+/g, '');
        const match = expr.match(/^(\d+)([+-]\d+)?$/);
        if (match) {
          const refRow = parseInt(match[1], 10) - 1;
          const offset = match[2] ? parseInt(match[2], 10) : 0;
          if (refRow >= 0 && refRow < tasks.length && refRow !== idx) {
            const pred = tasks[refRow];
            const predEnd = parseDMY(pred.endDate);
            if (predEnd) {
              const newStart = addDays(predEnd, offset);
              const dur = Math.max(1, parseInt(task.duration, 10) || 1);
              const newEnd = addDays(newStart, dur - 1);
              task.startDate = formatDMY(newStart);
              task.endDate = formatDMY(newEnd);
              if (!task.dependencies) task.dependencies = [];
              if (!task.dependencies.includes(pred.id)) {
                task.dependencies.push(pred.id);
              }
            }
          }
        }
      }
      // Keep duration consistent with start/end
      const s = parseDMY(task.startDate);
      const e = parseDMY(task.endDate);
      if (s && e) {
        if (e < s) {
          task.endDate = formatDMY(s);
          task.duration = 1;
        } else {
          task.duration = diffDaysInclusive(s, e);
        }
      }
    });
  }
}

function rewriteFormulasOnMove(tasks, oldIndex, newIndex) {
  // Build mapping from old 0-based index -> new 0-based index
  const order = tasks.map((_, i) => i);
  const [moved] = order.splice(oldIndex, 1);
  order.splice(newIndex, 0, moved);

  const oldToNew = {};
  order.forEach((oldIdx, newIdx) => {
    oldToNew[oldIdx] = newIdx;
  });

  tasks.forEach(task => {
    if (task.startFormula && task.startFormula.trim().startsWith('=')) {
      const expr = task.startFormula.trim().slice(1).replace(/\s+/g, '');
      const match = expr.match(/^(\d+)([+-]\d+)?$/);
      if (match) {
        const oldRef = parseInt(match[1], 10) - 1;
        const offsetStr = match[2] || '';
        if (oldToNew.hasOwnProperty(oldRef)) {
          task.startFormula = `=${oldToNew[oldRef] + 1}${offsetStr}`;
        }
      }
    }
  });
}

/* -------------------------
   Global Event Bindings
   ------------------------- */
function bindGlobalEvents() {
  // Dashboard New Project button
  const btnNewProj = document.getElementById('btn-new-project');
  if (btnNewProj) {
    btnNewProj.addEventListener('click', () => openProjectModal());
  }

  // Project Modal save/cancel
  const btnSaveProj = document.getElementById('btn-save-project');
  if (btnSaveProj) {
    btnSaveProj.addEventListener('click', handleSaveNewProject);
  }
  const btnCancelProj = document.getElementById('btn-cancel-project');
  if (btnCancelProj) {
    btnCancelProj.addEventListener('click', closeProjectModal);
  }

  // Back to Dashboard
  const btnBack = document.getElementById('btn-back-dashboard');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      state.activeProjectId = null;
      renderDashboard();
    });
  }

  // View Switcher Tabs
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.getAttribute('data-view'));
    });
  });

  // Add Task button
  const btnAddTask = document.getElementById('btn-add-task');
  if (btnAddTask) {
    btnAddTask.addEventListener('click', () => openTaskModal(null));
  }

  // Task Modal save/cancel/delete
  const btnSaveTask = document.getElementById('btn-save-task');
  if (btnSaveTask) {
    btnSaveTask.addEventListener('click', handleSaveTask);
  }
  const btnCancelTask = document.getElementById('btn-cancel-task');
  if (btnCancelTask) {
    btnCancelTask.addEventListener('click', closeTaskModal);
  }
  const btnDeleteTask = document.getElementById('btn-delete-task');
  if (btnDeleteTask) {
    btnDeleteTask.addEventListener('click', handleDeleteTask);
  }

  // Gantt Controls
  const btnScaleWeeks = document.getElementById('btn-scale-weeks');
  if (btnScaleWeeks) {
    btnScaleWeeks.addEventListener('click', () => {
      state.ganttScale = 'weeks';
      renderGantt();
    });
  }
  const btnScaleDays = document.getElementById('btn-scale-days');
  if (btnScaleDays) {
    btnScaleDays.addEventListener('click', () => {
      state.ganttScale = 'days';
      renderGantt();
    });
  }
  const btnZoomIn = document.getElementById('btn-zoom-in');
  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', () => {
      state.ganttZoom = Math.min(2.5, +(state.ganttZoom + 0.25).toFixed(2));
      renderGantt();
    });
  }
  const btnZoomOut = document.getElementById('btn-zoom-out');
  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', () => {
      state.ganttZoom = Math.max(0.5, +(state.ganttZoom - 0.25).toFixed(2));
      renderGantt();
    });
  }
  const btnSortDate = document.getElementById('btn-sort-date');
  if (btnSortDate) {
    btnSortDate.addEventListener('click', sortTasksByStartDate);
  }

  // PERT Controls
  const btnPertReset = document.getElementById('btn-pert-reset');
  if (btnPertReset) {
    btnPertReset.addEventListener('click', () => {
      const proj = getActiveProject();
      if (proj) {
        proj.tasks.forEach(t => delete t.pertPos);
        saveState();
        renderPert();
      }
    });
  }

  // Export / Import JSON & CSV
  const btnExportJson = document.getElementById('btn-export-json');
  if (btnExportJson) btnExportJson.addEventListener('click', exportJSON);

  const btnImportJson = document.getElementById('btn-import-json');
  const inputImportJson = document.getElementById('input-import-json');
  if (btnImportJson && inputImportJson) {
    btnImportJson.addEventListener('click', () => inputImportJson.click());
    inputImportJson.addEventListener('change', handleImportJSON);
  }

  const btnExportCsv = document.getElementById('btn-export-csv');
  if (btnExportCsv) btnExportCsv.addEventListener('click', exportCSV);
}

/* -------------------------
   Dashboard View
   ------------------------- */
function renderDashboard() {
  const dashEl = document.getElementById('dashboard-view');
  const workspaceEl = document.getElementById('workspace-view');
  if (dashEl) dashEl.classList.remove('hidden');
  if (workspaceEl) workspaceEl.classList.add('hidden');

  const grid = document.getElementById('projects-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (state.projects.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>No projects yet</h3>
        <p>Click <strong>+ New Project</strong> to create a project board or import a JSON backup.</p>
      </div>
    `;
    return;
  }

  state.projects.forEach(proj => {
    const total = proj.tasks.length;
    const done = proj.tasks.filter(t => t.status === 'Completed').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <div class="project-card-header">
        <h3>${escapeHtml(proj.name)}</h3>
        <button class="btn-icon btn-del-proj" title="Delete Project">&times;</button>
      </div>
      <p class="project-desc">${escapeHtml(proj.description || 'Project schedule & Kanban board')}</p>
      <div class="project-meta">
        <span>${done} / ${total} Completed</span>
        <span>${pct}%</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-del-proj')) {
        e.stopPropagation();
        if (confirm(`Delete project "${proj.name}"?`)) {
          state.projects = state.projects.filter(p => p.id !== proj.id);
          saveState();
          renderDashboard();
        }
        return;
      }
      openProject(proj.id);
    });

    grid.appendChild(card);
  });
}

function openProjectModal() {
  const modal = document.getElementById('project-modal');
  if (!modal) return;
  document.getElementById('new-project-name').value = '';
  document.getElementById('new-project-desc').value = '';
  modal.classList.remove('hidden');
  document.getElementById('new-project-name').focus();
}

function closeProjectModal() {
  const modal = document.getElementById('project-modal');
  if (modal) modal.classList.add('hidden');
}

function handleSaveNewProject() {
  const nameInput = document.getElementById('new-project-name');
  const descInput = document.getElementById('new-project-desc');
  const name = (nameInput.value || '').trim();
  if (!name) {
    alert('Please enter a project name.');
    return;
  }

  const today = todayMidnight();
  const nextWeek = addDays(today, 6);

  const newProj = {
    id: generateId('proj'),
    name,
    description: (descInput.value || '').trim(),
    tasks: [
      {
        id: generateId('task'),
        name: 'Project Kickoff & Planning',
        category: 'Planning',
        owner: 'Owner',
        status: 'To Do',
        startDate: formatDMY(today),
        endDate: formatDMY(nextWeek),
        duration: 7,
        startFormula: '',
        dependencies: []
      }
    ]
  };

  state.projects.push(newProj);
  saveState();
  closeProjectModal();
  openProject(newProj.id);
}

function openProject(projectId) {
  state.activeProjectId = projectId;
  const proj = getActiveProject();
  if (!proj) return;

  recalculateProjectSchedule(proj);
  saveState();

  document.getElementById('dashboard-view').classList.add('hidden');
  document.getElementById('workspace-view').classList.remove('hidden');
  document.getElementById('active-project-title').textContent = proj.name;

  switchView(state.currentView || 'kanban');
}

function switchView(viewName) {
  state.currentView = viewName;

  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
  });

  document.getElementById('kanban-view').classList.toggle('hidden', viewName !== 'kanban');
  document.getElementById('gantt-view').classList.toggle('hidden', viewName !== 'gantt');
  document.getElementById('pert-view').classList.toggle('hidden', viewName !== 'pert');

  if (viewName === 'kanban') renderKanban();
  else if (viewName === 'gantt') renderGantt();
  else if (viewName === 'pert') renderPert();
}

/* -------------------------
   Kanban Board View
   ------------------------- */
function renderKanban() {
  const proj = getActiveProject();
  if (!proj) return;
  recalculateProjectSchedule(proj);

  const cols = {
    warning: document.getElementById('col-warning-tasks'),
    'To Do': document.getElementById('col-todo-tasks'),
    'In Progress': document.getElementById('col-inprogress-tasks'),
    Completed: document.getElementById('col-done-tasks')
  };

  Object.values(cols).forEach(el => { if (el) el.innerHTML = ''; });

  const counts = { warning: 0, 'To Do': 0, 'In Progress': 0, Completed: 0 };

  proj.tasks.forEach(task => {
    const meta = getTaskVisualMeta(task);

    // Populate Warning / Past Deadline column
    if (meta.urgency === 'overdue' || meta.urgency === 'warning') {
      counts.warning++;
      if (cols.warning) {
        cols.warning.appendChild(createKanbanCard(task, meta, true));
      }
    }

    // Populate status column (Pending maps into To Do column with grey badge/bar)
    const targetColKey = (task.status === 'In Progress') ? 'In Progress'
      : (task.status === 'Completed') ? 'Completed'
      : 'To Do';

    counts[targetColKey]++;
    if (cols[targetColKey]) {
      cols[targetColKey].appendChild(createKanbanCard(task, meta, false));
    }
  });

  const setCount = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setCount('count-warning', counts.warning);
  setCount('count-todo', counts['To Do']);
  setCount('count-inprogress', counts['In Progress']);
  setCount('count-done', counts.Completed);

  setupKanbanDropZones();
}

function createKanbanCard(task, meta, isWarningMirror) {
  const card = document.createElement('div');
  card.className = `kanban-card ${meta.colorClass}`;
  card.draggable = !isWarningMirror;
  card.dataset.taskId = task.id;

  const badgeText = meta.urgency === 'overdue' ? 'OVERDUE'
    : meta.urgency === 'warning' ? 'DUE SOON'
    : (task.status || 'Pending').toUpperCase();

  card.innerHTML = `
    <div class="card-top">
      <span class="card-badge">${badgeText}</span>
      <span class="card-owner">${escapeHtml(task.owner || '')}</span>
    </div>
    <div class="card-title">${escapeHtml(task.name)}</div>
    <div class="card-dates">${task.startDate} → ${task.endDate} (${task.duration}d)</div>
  `;

  if (!isWarningMirror) {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', task.id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  }

  card.addEventListener('click', () => openTaskModal(task.id));
  return card;
}

function setupKanbanDropZones() {
  document.querySelectorAll('.kanban-column[data-status]').forEach(col => {
    col.ondragover = (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    };
    col.ondragleave = () => col.classList.remove('drag-over');
    col.ondrop = (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const newStatus = col.getAttribute('data-status');
      const proj = getActiveProject();
      if (!proj || !taskId || !newStatus) return;
      const task = proj.tasks.find(t => t.id === taskId);
      if (task) {
        task.status = newStatus;
        saveState();
        renderKanban();
      }
    };
  });
}

/* -------------------------
   Task Modal (Add / Edit)
   ------------------------- */
let editingTaskId = null;

function openTaskModal(taskId) {
  const proj = getActiveProject();
  if (!proj) return;
  editingTaskId = taskId;

  const modal = document.getElementById('task-modal');
  const titleEl = document.getElementById('task-modal-title');
  const delBtn = document.getElementById('btn-delete-task');
  const depSelect = document.getElementById('task-deps');

  // Populate dependency dropdown
  depSelect.innerHTML = '<option value="">-- None --</option>';
  proj.tasks.forEach((t, idx) => {
    if (t.id !== taskId) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `#${idx + 1} ${t.name}`;
      depSelect.appendChild(opt);
    }
  });

  if (taskId) {
    const task = proj.tasks.find(t => t.id === taskId);
    if (!task) return;
    titleEl.textContent = 'Edit Task';
    delBtn.classList.remove('hidden');
    document.getElementById('task-name').value = task.name || '';
    document.getElementById('task-owner').value = task.owner || '';
    document.getElementById('task-status').value = task.status || 'Pending';
    document.getElementById('task-start').value = task.startFormula || task.startDate || '';
    document.getElementById('task-end').value = task.endDate || '';
    document.getElementById('task-days').value = task.duration || 1;
    depSelect.value = (task.dependencies && task.dependencies[0]) || '';
  } else {
    titleEl.textContent = 'Add New Task';
    delBtn.classList.add('hidden');
    const today = todayMidnight();
    document.getElementById('task-name').value = '';
    document.getElementById('task-owner').value = '';
    document.getElementById('task-status').value = 'To Do';
    document.getElementById('task-start').value = formatDMY(today);
    document.getElementById('task-end').value = formatDMY(addDays(today, 4));
    document.getElementById('task-days').value = 5;
    depSelect.value = '';
  }

  modal.classList.remove('hidden');
}

function closeTaskModal() {
  document.getElementById('task-modal').classList.add('hidden');
  editingTaskId = null;
}

function handleSaveTask() {
  const proj = getActiveProject();
  if (!proj) return;

  const name = document.getElementById('task-name').value.trim();
  if (!name) {
    alert('Task name is required.');
    return;
  }

  const owner = document.getElementById('task-owner').value.trim();
  const status = document.getElementById('task-status').value;
  const startRaw = document.getElementById('task-start').value.trim();
  const endRaw = document.getElementById('task-end').value.trim();
  const daysVal = Math.max(1, parseInt(document.getElementById('task-days').value, 10) || 1);
  const depId = document.getElementById('task-deps').value;

  let startFormula = '';
  let startDate = formatDMY(todayMidnight());
  let endDate = formatDMY(addDays(todayMidnight(), daysVal - 1));

  if (startRaw.startsWith('=')) {
    startFormula = startRaw;
  } else {
    const parsedStart = parseDMY(startRaw);
    if (parsedStart) {
      startDate = formatDMY(parsedStart);
      const parsedEnd = parseDMY(endRaw);
      if (parsedEnd && parsedEnd >= parsedStart) {
        endDate = formatDMY(parsedEnd);
      } else {
        endDate = formatDMY(addDays(parsedStart, daysVal - 1));
      }
    }
  }

  const dependencies = depId ? [depId] : [];

  if (editingTaskId) {
    const task = proj.tasks.find(t => t.id === editingTaskId);
    if (task) {
      task.name = name;
      task.owner = owner;
      task.status = status;
      task.startFormula = startFormula;
      task.startDate = startDate;
      task.endDate = endDate;
      task.duration = daysVal;
      task.dependencies = dependencies;
    }
  } else {
    proj.tasks.push({
      id: generateId('task'),
      name,
      owner,
      status,
      startFormula,
      startDate,
      endDate,
      duration: daysVal,
      dependencies
    });
  }

  recalculateProjectSchedule(proj);
  saveState();
  closeTaskModal();
  switchView(state.currentView);
}

function handleDeleteTask() {
  const proj = getActiveProject();
  if (!proj || !editingTaskId) return;
  proj.tasks = proj.tasks.filter(t => t.id !== editingTaskId);
  proj.tasks.forEach(t => {
    if (t.dependencies) {
      t.dependencies = t.dependencies.filter(d => d !== editingTaskId);
    }
  });
  recalculateProjectSchedule(proj);
  saveState();
  closeTaskModal();
  switchView(state.currentView);
}

/* -------------------------
   Gantt Chart & Spreadsheet
   ------------------------- */
function sortTasksByStartDate() {
  const proj = getActiveProject();
  if (!proj) return;

  // Map old IDs to reorder formulas cleanly
  const oldIndexMap = {};
  proj.tasks.forEach((t, i) => { oldIndexMap[t.id] = i; });

  proj.tasks.sort((a, b) => {
    const da = parseDMY(a.startDate) || new Date(8640000000000000);
    const db = parseDMY(b.startDate) || new Date(8640000000000000);
    if (da.getTime() !== db.getTime()) return da - db;
    const ea = parseDMY(a.endDate) || da;
    const eb = parseDMY(b.endDate) || db;
    return ea - eb;
  });

  const newIndexMap = {};
  proj.tasks.forEach((t, i) => { newIndexMap[t.id] = i; });

  proj.tasks.forEach(task => {
    if (task.startFormula && task.startFormula.startsWith('=')) {
      const m = task.startFormula.slice(1).replace(/\s+/g, '').match(/^(\d+)([+-]\d+)?$/);
      if (m) {
        const oldIdx = parseInt(m[1], 10) - 1;
        const oldTaskEntry = Object.entries(oldIndexMap).find(([, idx]) => idx === oldIdx);
        if (oldTaskEntry) {
          const newIdx = newIndexMap[oldTaskEntry[0]];
          if (newIdx !== undefined) {
            task.startFormula = `=${newIdx + 1}${m[2] || ''}`;
          }
        }
      }
    }
  });

  recalculateProjectSchedule(proj);
  saveState();
  renderGantt();
}

function renderGantt() {
  const proj = getActiveProject();
  if (!proj) return;
  recalculateProjectSchedule(proj);

  // Update scale toggle buttons
  const btnWeeks = document.getElementById('btn-scale-weeks');
  const btnDays = document.getElementById('btn-scale-days');
  if (btnWeeks) btnWeeks.classList.toggle('active', state.ganttScale === 'weeks');
  if (btnDays) btnDays.classList.toggle('active', state.ganttScale === 'days');

  renderGanttTable(proj);
  renderGanttTimeline(proj);
}

function renderGanttTable(proj) {
  const headerEl = document.getElementById('gantt-table-header');
  const bodyEl = document.getElementById('gantt-table-body');
  if (!headerEl || !bodyEl) return;

  const w = state.colWidths;
  const cols = [
    { key: 'idx', label: '#', width: w.idx },
    { key: 'name', label: 'Task / Description', width: w.name },
    { key: 'owner', label: 'Owner', width: w.owner },
    { key: 'start', label: 'Start', width: w.start },
    { key: 'end', label: 'End', width: w.end },
    { key: 'days', label: 'Days', width: w.days },
    { key: 'deps', label: 'Depends On', width: w.deps }
  ];

  headerEl.innerHTML = '';
  cols.forEach(col => {
    const cell = document.createElement('div');
    cell.className = 'gantt-th';
    cell.style.width = `${col.width}px`;
    cell.style.minWidth = `${col.width}px`;
    cell.innerHTML = `<span>${col.label}</span><div class="col-resizer" data-col="${col.key}"></div>`;
    headerEl.appendChild(cell);
  });

  setupColumnResizers();

  bodyEl.innerHTML = '';
  proj.tasks.forEach((task, rowIndex) => {
    const row = document.createElement('div');
    row.className = 'gantt-tr';
    row.dataset.index = rowIndex;

    // 1. Index + Move Controls
    const cIdx = makeCell(w.idx, 'cell-idx');
    cIdx.innerHTML = `
      <span class="drag-grip" title="Drag row">⋮⋮</span>
      <span class="row-num">${rowIndex + 1}</span>
      <div class="row-arrows">
        <button class="btn-move-up" title="Move Up" ${rowIndex === 0 ? 'disabled' : ''}>▲</button>
        <button class="btn-move-down" title="Move Down" ${rowIndex === proj.tasks.length - 1 ? 'disabled' : ''}>▼</button>
      </div>
    `;
    cIdx.querySelector('.btn-move-up').onclick = () => moveTaskRow(rowIndex, rowIndex - 1);
    cIdx.querySelector('.btn-move-down').onclick = () => moveTaskRow(rowIndex, rowIndex + 1);

    // 2. Task Name
    const cName = makeCell(w.name);
    const inpName = document.createElement('input');
    inpName.type = 'text';
    inpName.value = task.name || '';
    inpName.onchange = () => {
      task.name = inpName.value.trim() || task.name;
      saveState();
      renderGanttTimeline(proj);
    };
    cName.appendChild(inpName);

    // 3. Owner
    const cOwner = makeCell(w.owner);
    const inpOwner = document.createElement('input');
    inpOwner.type = 'text';
    inpOwner.value = task.owner || '';
    inpOwner.onchange = () => {
      task.owner = inpOwner.value.trim();
      saveState();
    };
    cOwner.appendChild(inpOwner);

    // 4. Start Date or Formula
    const cStart = makeCell(w.start);
    const inpStart = document.createElement('input');
    inpStart.type = 'text';
    inpStart.value = task.startFormula ? `${task.startDate} (${task.startFormula})` : task.startDate;
    inpStart.title = 'Enter D/M/YYYY or formula like =1+3';
    inpStart.onfocus = () => {
      if (task.startFormula) inpStart.value = task.startFormula;
    };
    inpStart.onblur = () => {
      const val = inpStart.value.trim();
      if (val.startsWith('=')) {
        task.startFormula = val;
      } else {
        const cleanDateStr = val.split(' ')[0];
        const parsed = parseDMY(cleanDateStr);
        if (parsed) {
          task.startFormula = '';
          task.startDate = formatDMY(parsed);
          const dur = Math.max(1, parseInt(task.duration, 10) || 1);
          task.endDate = formatDMY(addDays(parsed, dur - 1));
        }
      }
      recalculateProjectSchedule(proj);
      saveState();
      renderGantt();
    };
    inpStart.onkeydown = (e) => { if (e.key === 'Enter') inpStart.blur(); };
    cStart.appendChild(inpStart);

    // 5. End Date
    const cEnd = makeCell(w.end);
    const inpEnd = document.createElement('input');
    inpEnd.type = 'text';
    inpEnd.value = task.endDate || '';
    inpEnd.onchange = () => {
      const parsedEnd = parseDMY(inpEnd.value.trim());
      const parsedStart = parseDMY(task.startDate);
      if (parsedEnd && parsedStart && parsedEnd >= parsedStart) {
        task.endDate = formatDMY(parsedEnd);
        task.duration = diffDaysInclusive(parsedStart, parsedEnd);
      }
      recalculateProjectSchedule(proj);
      saveState();
      renderGantt();
    };
    cEnd.appendChild(inpEnd);

    // 6. Editable Days Duration
    const cDays = makeCell(w.days);
    const inpDays = document.createElement('input');
    inpDays.type = 'number';
    inpDays.min = '1';
    inpDays.value = task.duration || 1;
    inpDays.onchange = () => {
      const newDur = Math.max(1, parseInt(inpDays.value, 10) || 1);
      task.duration = newDur;
      const parsedStart = parseDMY(task.startDate);
      if (parsedStart) {
        task.endDate = formatDMY(addDays(parsedStart, newDur - 1));
      }
      recalculateProjectSchedule(proj);
      saveState();
      renderGantt();
    };
    cDays.appendChild(inpDays);

    // 7. Dependencies Dropdown
    const cDeps = makeCell(w.deps);
    const selDeps = document.createElement('select');
    selDeps.innerHTML = '<option value="">None</option>';
    proj.tasks.forEach((other, idx) => {
      if (other.id !== task.id) {
        const opt = document.createElement('option');
        opt.value = other.id;
        opt.textContent = `#${idx + 1} ${other.name}`;
        if (task.dependencies && task.dependencies.includes(other.id)) {
          opt.selected = true;
        }
        selDeps.appendChild(opt);
      }
    });
    selDeps.onchange = () => {
      task.dependencies = selDeps.value ? [selDeps.value] : [];
      saveState();
      renderGanttTimeline(proj);
    };
    cDeps.appendChild(selDeps);

    row.append(cIdx, cName, cOwner, cStart, cEnd, cDays, cDeps);
    setupRowDragDrop(row, rowIndex);
    bodyEl.appendChild(row);
  });
}

function makeCell(width, extraClass = '') {
  const div = document.createElement('div');
  div.className = `gantt-td ${extraClass}`;
  div.style.width = `${width}px`;
  div.style.minWidth = `${width}px`;
  return div;
}

function moveTaskRow(fromIdx, toIdx) {
  const proj = getActiveProject();
  if (!proj || toIdx < 0 || toIdx >= proj.tasks.length || fromIdx === toIdx) return;

  rewriteFormulasOnMove(proj.tasks, fromIdx, toIdx);
  const [moved] = proj.tasks.splice(fromIdx, 1);
  proj.tasks.splice(toIdx, 0, moved);

  recalculateProjectSchedule(proj);
  saveState();
  renderGantt();
}

function setupRowDragDrop(rowEl, rowIndex) {
  const grip = rowEl.querySelector('.drag-grip');
  if (!grip) return;
  grip.onmousedown = () => { rowEl.draggable = true; };
  rowEl.ondragstart = (e) => {
    e.dataTransfer.setData('text/row-index', String(rowIndex));
    rowEl.classList.add('row-dragging');
  };
  rowEl.ondragend = () => {
    rowEl.draggable = false;
    rowEl.classList.remove('row-dragging');
  };
  rowEl.ondragover = (e) => {
    e.preventDefault();
    rowEl.classList.add('row-drop-target');
  };
  rowEl.ondragleave = () => rowEl.classList.remove('row-drop-target');
  rowEl.ondrop = (e) => {
    e.preventDefault();
    rowEl.classList.remove('row-drop-target');
    const fromIdx = parseInt(e.dataTransfer.getData('text/row-index'), 10);
    if (!isNaN(fromIdx)) moveTaskRow(fromIdx, rowIndex);
  };
}

function setupColumnResizers() {
  document.querySelectorAll('.col-resizer').forEach(handle => {
    handle.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const colKey = handle.getAttribute('data-col');
      const startX = e.clientX;
      const startWidth = state.colWidths[colKey] || 100;

      const onMouseMove = (moveEvt) => {
        const delta = moveEvt.clientX - startX;
        state.colWidths[colKey] = Math.max(48, startWidth + delta);
        const proj = getActiveProject();
        if (proj) renderGanttTable(proj);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        saveColWidths();
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };
  });
}

function renderGanttTimeline(proj) {
  const scaleHeader = document.getElementById('gantt-timeline-header');
  const barsLayer = document.getElementById('gantt-bars-layer');
  const svgLayer = document.getElementById('gantt-arrows-layer');
  if (!scaleHeader || !barsLayer || !svgLayer) return;

  // Determine timeline min/max bounds
  let minDate = todayMidnight();
  let maxDate = addDays(minDate, 28);

  if (proj.tasks.length > 0) {
    const starts = proj.tasks.map(t => parseDMY(t.startDate)).filter(Boolean);
    const ends = proj.tasks.map(t => parseDMY(t.endDate)).filter(Boolean);
    if (starts.length) minDate = new Date(Math.min(...starts.map(d => d.getTime())));
    if (ends.length) maxDate = new Date(Math.max(...ends.map(d => d.getTime())));
  }

  minDate = getMonday(addDays(minDate, -7));
  maxDate = addDays(maxDate, 14);

  const ROW_HEIGHT = 44;
  const pxPerDay = (state.ganttScale === 'days' ? 36 : 14) * state.ganttZoom;
  const totalDays = Math.max(14, Math.round((maxDate - minDate) / 86400000) + 1);
  const totalWidth = totalDays * pxPerDay;
  const totalHeight = Math.max(200, proj.tasks.length * ROW_HEIGHT);

  scaleHeader.style.width = `${totalWidth}px`;
  barsLayer.style.width = `${totalWidth}px`;
  barsLayer.style.height = `${totalHeight}px`;
  svgLayer.setAttribute('width', totalWidth);
  svgLayer.setAttribute('height', totalHeight);

  // Build Header Columns (Weeks or Days)
  scaleHeader.innerHTML = '';
  if (state.ganttScale === 'weeks') {
    let cursor = new Date(minDate);
    while (cursor <= maxDate) {
      const colWidth = 7 * pxPerDay;
      const cell = document.createElement('div');
      cell.className = 'timeline-col-head';
      cell.style.width = `${colWidth}px`;
      cell.innerHTML = `<strong>W${getISOWeek(cursor)}</strong><span>${formatDDMM(cursor)}</span>`;
      scaleHeader.appendChild(cell);
      cursor = addDays(cursor, 7);
    }
  } else {
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(minDate, i);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const cell = document.createElement('div');
      cell.className = `timeline-col-head ${isWeekend ? 'weekend' : ''}`;
      cell.style.width = `${pxPerDay}px`;
      cell.innerHTML = `<strong>${d.getDate()}/${d.getMonth() + 1}</strong><span>${dayNames[d.getDay()]}</span>`;
      scaleHeader.appendChild(cell);
    }
  }

  // Render Task Bars
  barsLayer.innerHTML = '';
  const barCoords = {};

  proj.tasks.forEach((task, rowIndex) => {
    const s = parseDMY(task.startDate);
    const e = parseDMY(task.endDate);
    if (!s || !e) return;

    const offsetDays = Math.round((s - minDate) / 86400000);
    const durDays = diffDaysInclusive(s, e);
    const left = offsetDays * pxPerDay;
    const width = Math.max(pxPerDay, durDays * pxPerDay);
    const top = rowIndex * ROW_HEIGHT + 6;
    const height = ROW_HEIGHT - 12;

    barCoords[task.id] = {
      left,
      right: left + width,
      centerY: top + height / 2
    };

    const meta = getTaskVisualMeta(task);
    const bar = document.createElement('div');
    bar.className = `gantt-bar ${meta.colorClass}`;
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
    bar.style.width = `${width}px`;
    bar.style.height = `${height}px`;

    bar.innerHTML = `
      <div class="bar-resize-left"></div>
      <span class="bar-date-start">${formatDDMM(s)}</span>
      <span class="bar-label">${escapeHtml(task.name)}</span>
      <span class="bar-date-end">${formatDDMM(e)}</span>
      <div class="bar-resize-right"></div>
    `;

    setupBarDragResize(bar, task, pxPerDay);
    barsLayer.appendChild(bar);
  });

  // Render Thin Dashed Dependency Arrows
  svgLayer.innerHTML = `
    <defs>
      <marker id="dep-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
        <polygon points="0 0, 7 3.5, 0 7" fill="#dc2626" />
      </marker>
    </defs>
  `;

  proj.tasks.forEach(task => {
    if (!task.dependencies || !barCoords[task.id]) return;
    const target = barCoords[task.id];

    task.dependencies.forEach(predId => {
      const source = barCoords[predId];
      if (!source) return;

      const x1 = source.right;
      const y1 = source.centerY;
      const x2 = target.left;
      const y2 = target.centerY;
      const midX = x1 + Math.max(12, (x2 - x1) / 2);

      const pathData = (x2 >= x1 + 8)
        ? `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
        : `M ${x1} ${y1} L ${x1 + 10} ${y1} L ${x1 + 10} ${(y1 + y2) / 2} L ${x2 - 10} ${(y1 + y2) / 2} L ${x2 - 10} ${y2} L ${x2} ${y2}`;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#dc2626');
      path.setAttribute('stroke-width', '1.25');
      path.setAttribute('stroke-dasharray', '4,3');
      path.setAttribute('marker-end', 'url(#dep-arrow)');
      svgLayer.appendChild(path);
    });
  });
}

function setupBarDragResize(barEl, task, pxPerDay) {
  barEl.onmousedown = (e) => {
    e.preventDefault();
    const isLeft = e.target.classList.contains('bar-resize-left');
    const isRight = e.target.classList.contains('bar-resize-right');
    const mode = isLeft ? 'left' : isRight ? 'right' : 'move';

    const startX = e.clientX;
    const origStart = parseDMY(task.startDate);
    const origEnd = parseDMY(task.endDate);
    if (!origStart || !origEnd) return;

    const onMouseMove = (moveEvt) => {
      const deltaDays = Math.round((moveEvt.clientX - startX) / pxPerDay);
      let newStart = new Date(origStart);
      let newEnd = new Date(origEnd);

      if (mode === 'move') {
        newStart = addDays(origStart, deltaDays);
        newEnd = addDays(origEnd, deltaDays);
        task.startFormula = '';
      } else if (mode === 'left') {
        newStart = addDays(origStart, deltaDays);
        if (newStart > newEnd) newStart = new Date(newEnd);
        task.startFormula = '';
      } else if (mode === 'right') {
        newEnd = addDays(origEnd, deltaDays);
        if (newEnd < newStart) newEnd = new Date(newStart);
      }

      task.startDate = formatDMY(newStart);
      task.endDate = formatDMY(newEnd);
      task.duration = diffDaysInclusive(newStart, newEnd);

      const startSpan = barEl.querySelector('.bar-date-start');
      const endSpan = barEl.querySelector('.bar-date-end');
      if (startSpan) startSpan.textContent = formatDDMM(newStart);
      if (endSpan) endSpan.textContent = formatDDMM(newEnd);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      const proj = getActiveProject();
      if (proj) {
        recalculateProjectSchedule(proj);
        saveState();
        renderGantt();
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };
}

/* -------------------------
   PERT Chart & Critical Path
   ------------------------- */
function renderPert() {
  const proj = getActiveProject();
  if (!proj) return;
  recalculateProjectSchedule(proj);

  const canvas = document.getElementById('pert-nodes-layer');
  const svg = document.getElementById('pert-arrows-layer');
  if (!canvas || !svg) return;

  canvas.innerHTML = '';
  svg.innerHTML = `
    <defs>
      <marker id="pert-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <polygon points="0 0, 8 4, 0 8" fill="#64748b" />
      </marker>
      <marker id="pert-arrow-crit" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <polygon points="0 0, 8 4, 0 8" fill="#dc2626" />
      </marker>
    </defs>
  `;

  if (proj.tasks.length === 0) return;

  // Compute CPM (ES, EF, LS, LF, Slack, Stage)
  const nodes = {};
  proj.tasks.forEach(t => {
    nodes[t.id] = {
      task: t,
      dur: Math.max(1, parseInt(t.duration, 10) || 1),
      preds: (t.dependencies || []).filter(id => proj.tasks.some(x => x.id === id)),
      succs: [],
      es: 0,
      ef: 0,
      ls: 0,
      lf: 0,
      slack: 0,
      stage: 0
    };
  });

  Object.values(nodes).forEach(n => {
    n.preds.forEach(pid => {
      if (nodes[pid]) nodes[pid].succs.push(n.task.id);
    });
  });

  // Forward pass
  for (let i = 0; i < proj.tasks.length; i++) {
    Object.values(nodes).forEach(n => {
      if (n.preds.length > 0) {
        n.es = Math.max(...n.preds.map(pid => nodes[pid].ef));
        n.stage = Math.max(...n.preds.map(pid => nodes[pid].stage + 1));
      }
      n.ef = n.es + n.dur;
    });
  }

  const projectEnd = Math.max(...Object.values(nodes).map(n => n.ef));

  // Backward pass
  Object.values(nodes).forEach(n => {
    n.lf = projectEnd;
    n.ls = projectEnd - n.dur;
  });

  for (let i = 0; i < proj.tasks.length; i++) {
    Object.values(nodes).forEach(n => {
      if (n.succs.length > 0) {
        n.lf = Math.min(...n.succs.map(sid => nodes[sid].ls));
      }
      n.ls = n.lf - n.dur;
      n.slack = n.ls - n.es;
    });
  }

  // Group by stage for auto layout
  const stageBuckets = {};
  Object.values(nodes).forEach(n => {
    if (!stageBuckets[n.stage]) stageBuckets[n.stage] = [];
    stageBuckets[n.stage].push(n);
  });

  const NODE_W = 210;
  const NODE_H = 112;
  const COL_GAP = 270;
  const ROW_GAP = 140;

  let maxX = 800;
  let maxY = 500;

  Object.entries(stageBuckets).forEach(([stageStr, list]) => {
    const stageIdx = parseInt(stageStr, 10);
    list.forEach((n, idxInStage) => {
      if (!n.task.pertPos) {
        n.task.pertPos = {
          x: 40 + stageIdx * COL_GAP,
          y: 40 + idxInStage * ROW_GAP
        };
      }
      maxX = Math.max(maxX, n.task.pertPos.x + NODE_W + 80);
      maxY = Math.max(maxY, n.task.pertPos.y + NODE_H + 80);
    });
  });

  canvas.style.width = `${maxX}px`;
  canvas.style.height = `${maxY}px`;
  svg.setAttribute('width', maxX);
  svg.setAttribute('height', maxY);

  // Draw PERT Nodes
  Object.values(nodes).forEach(n => {
    const isCritical = n.slack === 0;
    const meta = getTaskVisualMeta(n.task);
    const el = document.createElement('div');
    el.className = `pert-node ${meta.colorClass} ${isCritical ? 'critical-node' : ''}`;
    el.style.left = `${n.task.pertPos.x}px`;
    el.style.top = `${n.task.pertPos.y}px`;

    el.innerHTML = `
      <div class="pert-node-header">
        <span>${isCritical ? '🔥 CRITICAL' : `Slack: ${n.slack}d`}</span>
        <span>${n.dur}d</span>
      </div>
      <div class="pert-node-title">${escapeHtml(n.task.name)}</div>
      <div class="pert-node-dates">${n.task.startDate} → ${n.task.endDate}</div>
    `;

    setupPertNodeDrag(el, n.task, svg, nodes);
    canvas.appendChild(el);
  });

  drawPertArrows(svg, nodes);
}

function drawPertArrows(svg, nodes) {
  // Keep defs, clear paths
  const defs = svg.querySelector('defs');
  svg.innerHTML = '';
  if (defs) svg.appendChild(defs);

  const NODE_W = 210;
  const NODE_H = 112;

  Object.values(nodes).forEach(n => {
    n.preds.forEach(pid => {
      const predNode = nodes[pid];
      if (!predNode) return;

      const x1 = predNode.task.pertPos.x + NODE_W;
      const y1 = predNode.task.pertPos.y + NODE_H / 2;
      const x2 = n.task.pertPos.x;
      const y2 = n.task.pertPos.y + NODE_H / 2;

      const isCritEdge = predNode.slack === 0 && n.slack === 0 && predNode.ef === n.es;
      const c1x = x1 + Math.abs(x2 - x1) * 0.45;
      const c2x = x2 - Math.abs(x2 - x1) * 0.45;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', isCritEdge ? '#dc2626' : '#64748b');
      path.setAttribute('stroke-width', isCritEdge ? '2.2' : '1.5');
      path.setAttribute('marker-end', isCritEdge ? 'url(#pert-arrow-crit)' : 'url(#pert-arrow)');
      svg.appendChild(path);
    });
  });
}

function setupPertNodeDrag(el, task, svg, nodes) {
  el.onmousedown = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = task.pertPos.x;
    const origY = task.pertPos.y;

    const onMove = (ev) => {
      task.pertPos.x = Math.max(10, origX + (ev.clientX - startX));
      task.pertPos.y = Math.max(10, origY + (ev.clientY - startY));
      el.style.left = `${task.pertPos.x}px`;
      el.style.top = `${task.pertPos.y}px`;
      drawPertArrows(svg, nodes);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      saveState();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
}

/* -------------------------
   Export / Import (JSON & CSV)
   ------------------------- */
function exportJSON() {
  const payload = {
    exportedAt: new Date().toISOString(),
    colWidths: state.colWidths,
    projects: state.projects
  };
  downloadFile(JSON.stringify(payload, null, 2), 'kanban_gantt_pert_backup.json', 'application/json');
}

function handleImportJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (Array.isArray(data)) {
        state.projects = data;
      } else if (data && Array.isArray(data.projects)) {
        state.projects = data.projects;
        if (data.colWidths) state.colWidths = { ...state.colWidths, ...data.colWidths };
      } else {
        alert('Invalid JSON backup format.');
        return;
      }
      saveState();
      saveColWidths();
      state.activeProjectId = null;
      renderDashboard();
      alert('Projects imported successfully!');
    } catch (err) {
      alert('Failed to read JSON file: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function exportCSV() {
  const proj = getActiveProject();
  if (!proj) return;

  const headers = ['Row', 'Task Name', 'Owner', 'Status', 'Start Date', 'Formula', 'End Date', 'Days', 'Depends On'];
  const rows = proj.tasks.map((t, idx) => {
    const depNames = (t.dependencies || [])
      .map(id => {
        const pIdx = proj.tasks.findIndex(x => x.id === id);
        return pIdx >= 0 ? `#${pIdx + 1}` : '';
      })
      .filter(Boolean)
      .join('; ');

    return [
      idx + 1,
      csvEscape(t.name),
      csvEscape(t.owner),
      csvEscape(t.status),
      csvEscape(t.startDate),
      csvEscape(t.startFormula),
      csvEscape(t.endDate),
      t.duration || 1,
      csvEscape(depNames)
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');
  const safeName = proj.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  downloadFile(csvContent, `${safeName}_schedule.csv`, 'text/csv;charset=utf-8;');
}

function csvEscape(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', init);
