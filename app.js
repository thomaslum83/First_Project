/* =========================================================
   Project Kanban, Gantt & PERT Tracker - app.js
   ========================================================= */

const STORAGE_KEY = 'kanban_gantt_pert_projects_v15';
const COL_WIDTHS_KEY = 'kanban_gantt_col_widths_v15';

let state = {
  projects: [],
  activeProjectId: null,
  activeView: 'kanban', // 'kanban' | 'gantt' | 'pert'
  ganttScale: 'week',   // 'week' | 'day'
  ganttZoom: 1,
  editingTaskId: null
};

let colWidths = {
  idx: 58,
  title: 240,
  owner: 115,
  start: 110,
  end: 105,
  days: 68,
  depends: 140
};

/* ---------- Date Utilities (D/M/YYYY & DD/MM) ---------- */

function parseDMY(str) {
  if (!str) return null;
  const clean = String(str).trim();
  const m = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const y = parseInt(m[3], 10);
  const dt = new Date(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function formatDMY(dt) {
  if (!dt || isNaN(dt.getTime())) return '';
  return `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`;
}

function formatDDMM(dt) {
  if (!dt || isNaN(dt.getTime())) return '';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

function addDays(dt, days) {
  const res = new Date(dt.getTime());
  res.setDate(res.getDate() + days);
  res.setHours(0, 0, 0, 0);
  return res;
}

function diffDaysInclusive(startDt, endDt) {
  if (!startDt || !endDt) return 1;
  const msPerDay = 86400000;
  const diff = Math.round((endDt.getTime() - startDt.getTime()) / msPerDay) + 1;
  return Math.max(1, diff);
}

function getToday() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function getISOWeek(dt) {
  const d = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/* ---------- Storage & State ---------- */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        state.projects = parsed;
      }
    }
    const cw = localStorage.getItem(COL_WIDTHS_KEY);
    if (cw) {
      colWidths = { ...colWidths, ...JSON.parse(cw) };
    }
  } catch (e) {
    console.warn('Resetting unreadable localStorage:', e);
    state.projects = [];
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.projects));
    localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidths));
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

function getActiveProject() {
  return state.projects.find(p => p.id === state.activeProjectId) || null;
}

/* ---------- Modal & Project Creation Handlers ---------- */

window.openProjectModal = function () {
  const modal = document.getElementById('projectModal');
  const nameInput = document.getElementById('projectNameInput');
  const descInput = document.getElementById('projectDescInput');
  if (!modal) return;
  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  if (nameInput) setTimeout(() => nameInput.focus(), 30);
};

window.closeProjectModal = function () {
  const modal = document.getElementById('projectModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
};

window.handleCreateProject = function (e) {
  if (e && e.preventDefault) e.preventDefault();
  const nameInput = document.getElementById('projectNameInput');
  const descInput = document.getElementById('projectDescInput');
  const name = nameInput ? nameInput.value.trim() : '';
  const desc = descInput ? descInput.value.trim() : '';

  if (!name) {
    alert('Please enter a project name.');
    if (nameInput) nameInput.focus();
    return false;
  }

  const today = getToday();
  const newProj = {
    id: 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: name,
    description: desc || 'Project schedule & Kanban workspace',
    tasks: [
      {
        id: 't_' + Date.now() + '_1',
        title: 'Project Kickoff & Scope',
        owner: 'Lead',
        status: 'In Progress',
        startDate: formatDMY(today),
        endDate: formatDMY(addDays(today, 4)),
        startFormula: '',
        dependsOn: '',
        pertX: null,
        pertY: null
      }
    ]
  };

  state.projects.push(newProj);
  saveState();
  window.closeProjectModal();
  openProject(newProj.id);
  return false;
};

window.createProjectFromModal = window.handleCreateProject;

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

function openProject(projId) {
  state.activeProjectId = projId;
  const proj = getActiveProject();
  if (proj) recalculateProjectFormulas(proj);
  renderApp();
}

window.showDashboard = function () {
  state.activeProjectId = null;
  renderApp();
};

/* ---------- Formula Engine (=Row+Days) ---------- */

function parseFormula(formulaStr) {
  if (!formulaStr) return null;
  const clean = String(formulaStr).trim();
  const m = clean.match(/^=\s*(\d+)\s*([+-]\s*\d+)?$/);
  if (!m) return null;
  const rowNum = parseInt(m[1], 10);
  const offset = m[2] ? parseInt(m[2].replace(/\s+/g, ''), 10) : 0;
  return { rowNum, offset };
}

function recalculateProjectFormulas(proj) {
  if (!proj || !Array.isArray(proj.tasks)) return;
  const maxPasses = proj.tasks.length + 2;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    proj.tasks.forEach((task, idx) => {
      if (task.startFormula) {
        const parsed = parseFormula(task.startFormula);
        if (parsed && parsed.rowNum >= 1 && parsed.rowNum <= proj.tasks.length && parsed.rowNum !== idx + 1) {
          const pred = proj.tasks[parsed.rowNum - 1];
          const predEnd = parseDMY(pred.endDate);
          if (predEnd) {
            const curStart = parseDMY(task.startDate);
            const curEnd = parseDMY(task.endDate);
            const dur = diffDaysInclusive(curStart, curEnd);
            const newStart = addDays(predEnd, parsed.offset);
            const newEnd = addDays(newStart, dur - 1);
            const newStartStr = formatDMY(newStart);
            const newEndStr = formatDMY(newEnd);
            if (task.startDate !== newStartStr || task.endDate !== newEndStr || task.dependsOn !== pred.id) {
              task.startDate = newStartStr;
              task.endDate = newEndStr;
              task.dependsOn = pred.id;
              changed = true;
            }
          }
        }
      }
    });
    if (!changed) break;
  }
}

function rewriteFormulasAfterReorder(proj, oldIdsOrder) {
  proj.tasks.forEach(task => {
    if (!task.startFormula) return;
    const parsed = parseFormula(task.startFormula);
    if (!parsed) return;
    const targetOldId = oldIdsOrder[parsed.rowNum - 1];
    if (!targetOldId) return;
    const newIndex = proj.tasks.findIndex(t => t.id === targetOldId);
    if (newIndex !== -1) {
      const signStr = parsed.offset >= 0 ? `+${parsed.offset}` : `${parsed.offset}`;
      task.startFormula = `=${newIndex + 1}${signStr}`;
    }
  });
}

/* ---------- Status & Urgency Color Classification ---------- */

function getTaskUrgencyAndColor(task) {
  const status = task.status || 'To Do';
  if (status === 'Completed') {
    return { badge: 'Completed', colorClass: 'status-completed', hex: '#1e293b', isAlert: false };
  }
  const today = getToday();
  const endDt = parseDMY(task.endDate);
  if (endDt) {
    const msDiff = endDt.getTime() - today.getTime();
    const daysLeft = Math.round(msDiff / 86400000);
    if (daysLeft < 0) {
      return { badge: 'Exceeded Deadline', colorClass: 'status-overdue', hex: '#dc2626', isAlert: true };
    }
    if (daysLeft <= 7) {
      return { badge: 'Near Deadline', colorClass: 'status-warning', hex: '#eab308', isAlert: true };
    }
  }
  if (status === 'Pending') {
    return { badge: 'Pending', colorClass: 'status-pending', hex: '#64748b', isAlert: false };
  }
  if (status === 'In Progress') {
    return { badge: 'In Progress', colorClass: 'status-inprogress', hex: '#16a34a', isAlert: false };
  }
  return { badge: 'To Do', colorClass: 'status-todo', hex: '#2563eb', isAlert: false };
}

/* ---------- View & Navigation Rendering ---------- */

function renderApp() {
  const dashView = document.getElementById('dashboardView');
  const projView = document.getElementById('projectWorkspace');
  const headerTitle = document.getElementById('workspaceTitle');
  const viewSwitchers = document.getElementById('viewSwitchers');
  const exportCsvBtn = document.getElementById('exportCsvBtn');

  const proj = getActiveProject();

  if (!proj) {
    if (dashView) dashView.classList.remove('hidden');
    if (projView) projView.classList.add('hidden');
    if (viewSwitchers) viewSwitchers.classList.add('hidden');
    if (exportCsvBtn) exportCsvBtn.classList.add('hidden');
    if (headerTitle) headerTitle.textContent = 'Projects Dashboard';
    renderDashboard();
    return;
  }

  if (dashView) dashView.classList.add('hidden');
  if (projView) projView.classList.remove('hidden');
  if (viewSwitchers) viewSwitchers.classList.remove('hidden');
  if (exportCsvBtn) exportCsvBtn.classList.remove('hidden');
  if (headerTitle) headerTitle.textContent = proj.name;

  document.querySelectorAll('[data-view-btn]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-view-btn') === state.activeView);
  });

  const kanbanSec = document.getElementById('kanbanSection');
  const ganttSec = document.getElementById('ganttSection');
  const pertSec = document.getElementById('pertSection');

  if (kanbanSec) kanbanSec.classList.toggle('hidden', state.activeView !== 'kanban');
  if (ganttSec) ganttSec.classList.toggle('hidden', state.activeView !== 'gantt');
  if (pertSec) pertSec.classList.toggle('hidden', state.activeView !== 'pert');

  if (state.activeView === 'kanban') renderKanban(proj);
  else if (state.activeView === 'gantt') renderGantt(proj);
  else if (state.activeView === 'pert') renderPert(proj);
}

window.switchView = function (viewName) {
  state.activeView = viewName;
  renderApp();
};

function renderDashboard() {
  const grid = document.getElementById('projectsGrid');
  if (!grid) return;
  if (state.projects.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-card" style="grid-column:1/-1; padding:32px; border:1px dashed #cbd5e1; border-radius:12px; text-align:center; background:#fff;">
        <p style="margin:0 0 12px; color:#475569; font-size:15px;">No projects yet. Click <strong>+ New Project</strong> in the top bar or import a JSON backup.</p>
      </div>`;
    return;
  }

  grid.innerHTML = state.projects.map(p => {
    const total = p.tasks.length;
    const done = p.tasks.filter(t => t.status === 'Completed').length;
    return `
      <div class="project-card" onclick="openProject('${p.id}')" style="cursor:pointer;">
        <div class="project-card-header" style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <h3 style="margin:0; font-size:17px;">${escapeHtml(p.name)}</h3>
          <button class="btn-icon danger" title="Delete Project" onclick="deleteProject('${p.id}', event)">🗑️</button>
        </div>
        <p style="color:#64748b; font-size:13px; margin:8px 0 14px;">${escapeHtml(p.description || '')}</p>
        <div style="display:flex; justify-content:space-between; font-size:12px; color:#334155; font-weight:600;">
          <span>${total} Tasks</span>
          <span>${done} / ${total} Completed</span>
        </div>
      </div>`;
  }).join('');
}

/* ---------- Kanban Board ---------- */

function renderKanban(proj) {
  const board = document.getElementById('kanbanBoard');
  if (!board) return;

  const columns = [
    { key: 'Warning', title: '⚠️ Past Deadline / Warning', isAlertCol: true },
    { key: 'Pending', title: 'Pending' },
    { key: 'To Do', title: 'To Do' },
    { key: 'In Progress', title: 'In Progress' },
    { key: 'Completed', title: 'Completed' }
  ];

  board.innerHTML = columns.map(col => {
    const colTasks = proj.tasks.filter(t => {
      const info = getTaskUrgencyAndColor(t);
      if (col.isAlertCol) return info.isAlert;
      return (t.status || 'To Do') === col.key;
    });

    const cardsHtml = colTasks.map(t => {
      const info = getTaskUrgencyAndColor(t);
      return `
        <div class="kanban-card ${info.colorClass}" draggable="true"
             ondragstart="onKanbanDragStart(event, '${t.id}')"
             onclick="openTaskModal('${t.id}')"
             style="border-left: 5px solid ${info.hex};">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:4px;">
            <span class="badge" style="background:${info.hex}; color:#fff; font-size:11px; padding:2px 7px; border-radius:999px;">${info.badge}</span>
            <span style="font-size:11px; color:#64748b;">${escapeHtml(t.owner || 'Unassigned')}</span>
          </div>
          <div style="font-weight:600; font-size:14px; margin-bottom:6px; color:#0f172a;">${escapeHtml(t.title)}</div>
          <div style="font-size:12px; color:#475569; display:flex; justify-content:space-between;">
            <span>${escapeHtml(t.startDate)} → ${escapeHtml(t.endDate)}</span>
            <span>${diffDaysInclusive(parseDMY(t.startDate), parseDMY(t.endDate))}d</span>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="kanban-column"
           ondragover="event.preventDefault()"
           ondrop="onKanbanDrop(event, '${col.key}')">
        <div class="kanban-col-header">
          <span>${col.title}</span>
          <span class="count-pill">${colTasks.length}</span>
        </div>
        <div class="kanban-cards-list">${cardsHtml || '<div class="empty-col">No tasks</div>'}</div>
      </div>`;
  }).join('');
}

let draggedKanbanTaskId = null;
window.onKanbanDragStart = function (e, taskId) {
  draggedKanbanTaskId = taskId;
};

window.onKanbanDrop = function (e, targetStatus) {
  e.preventDefault();
  if (!draggedKanbanTaskId || targetStatus === 'Warning') return;
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

/* ---------- Task Modal (Add / Edit) ---------- */

window.openTaskModal = function (taskId = null) {
  const proj = getActiveProject();
  if (!proj) return;
  const modal = document.getElementById('taskModal');
  if (!modal) return;

  state.editingTaskId = taskId;
  const task = taskId ? proj.tasks.find(t => t.id === taskId) : null;
  const today = getToday();

  const titleEl = document.getElementById('taskModalTitle');
  if (titleEl) titleEl.textContent = task ? 'Edit Task' : 'Add New Task';

  document.getElementById('taskTitleInput').value = task ? task.title : '';
  document.getElementById('taskOwnerInput').value = task ? (task.owner || '') : '';
  document.getElementById('taskStatusInput').value = task ? (task.status || 'To Do') : 'To Do';
  document.getElementById('taskStartInput').value = task ? (task.startFormula || task.startDate) : formatDMY(today);
  document.getElementById('taskEndInput').value = task ? task.endDate : formatDMY(addDays(today, 3));

  const depSelect = document.getElementById('taskDependsInput');
  if (depSelect) {
    depSelect.innerHTML = '<option value="">None</option>' + proj.tasks
      .filter(t => !task || t.id !== task.id)
      .map((t, i) => `<option value="${t.id}" ${task && task.dependsOn === t.id ? 'selected' : ''}>#${proj.tasks.indexOf(t) + 1} ${escapeHtml(t.title)}</option>`)
      .join('');
  }

  const delBtn = document.getElementById('deleteTaskBtn');
  if (delBtn) delBtn.style.display = task ? 'inline-flex' : 'none';

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
};

window.closeTaskModal = function () {
  const modal = document.getElementById('taskModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
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
  const owner = document.getElementById('taskOwnerInput').value.trim();
  const status = document.getElementById('taskStatusInput').value;
  const startRaw = document.getElementById('taskStartInput').value.trim();
  const endRaw = document.getElementById('taskEndInput').value.trim();
  const dependsOn = document.getElementById('taskDependsInput').value;

  let startFormula = '';
  let startDate = startRaw;
  let endDate = endRaw;

  if (startRaw.startsWith('=')) {
    startFormula = startRaw;
    if (!parseDMY(startDate)) startDate = formatDMY(getToday());
  } else {
    const parsedS = parseDMY(startRaw);
    if (!parsedS) {
      alert('Start date must be D/M/YYYY (e.g., 5/11/2026) or an equation (e.g., =1+3).');
      return;
    }
    startDate = formatDMY(parsedS);
  }

  const parsedE = parseDMY(endRaw);
  if (!parsedE) {
    alert('End date must be D/M/YYYY (e.g., 10/11/2026).');
    return;
  }
  endDate = formatDMY(parsedE);

  if (state.editingTaskId) {
    const task = proj.tasks.find(t => t.id === state.editingTaskId);
    if (task) {
      task.title = title;
      task.owner = owner;
      task.status = status;
      task.startFormula = startFormula;
      task.startDate = startDate;
      task.endDate = endDate;
      task.dependsOn = dependsOn;
    }
  } else {
    proj.tasks.push({
      id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title,
      owner,
      status,
      startFormula,
      startDate,
      endDate,
      dependsOn,
      pertX: null,
      pertY: null
    });
  }

  recalculateProjectFormulas(proj);
  saveState();
  window.closeTaskModal();
  renderApp();
};

window.deleteEditingTask = function () {
  const proj = getActiveProject();
  if (!proj || !state.editingTaskId) return;
  const oldOrder = proj.tasks.map(t => t.id);
  proj.tasks = proj.tasks.filter(t => t.id !== state.editingTaskId);
  proj.tasks.forEach(t => {
    if (t.dependsOn === state.editingTaskId) t.dependsOn = '';
  });
  rewriteFormulasAfterReorder(proj, oldOrder);
  recalculateProjectFormulas(proj);
  saveState();
  window.closeTaskModal();
  renderApp();
};

/* ---------- Gantt Chart, Spreadsheet & Arrows ---------- */

window.setGanttScale = function (scale) {
  state.ganttScale = scale;
  renderApp();
};

window.zoomGantt = function (delta) {
  state.ganttZoom = Math.min(2.4, Math.max(0.5, +(state.ganttZoom + delta).toFixed(2)));
  renderApp();
};

window.sortTasksByStartDate = function () {
  const proj = getActiveProject();
  if (!proj) return;
  const oldOrder = proj.tasks.map(t => t.id);
  proj.tasks.sort((a, b) => {
    const sa = parseDMY(a.startDate) || new Date(0);
    const sb = parseDMY(b.startDate) || new Date(0);
    if (sa.getTime() !== sb.getTime()) return sa - sb;
    const ea = parseDMY(a.endDate) || new Date(0);
    const eb = parseDMY(b.endDate) || new Date(0);
    return ea - eb;
  });
  rewriteFormulasAfterReorder(proj, oldOrder);
  recalculateProjectFormulas(proj);
  saveState();
  renderApp();
};

window.moveTaskRow = function (index, direction) {
  const proj = getActiveProject();
  if (!proj) return;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= proj.tasks.length) return;
  const oldOrder = proj.tasks.map(t => t.id);
  const [moved] = proj.tasks.splice(index, 1);
  proj.tasks.splice(targetIndex, 0, moved);
  rewriteFormulasAfterReorder(proj, oldOrder);
  recalculateProjectFormulas(proj);
  saveState();
  renderApp();
};

let draggedRowIndex = null;
window.onGanttRowDragStart = function (e, idx) {
  draggedRowIndex = idx;
};
window.onGanttRowDrop = function (e, targetIdx) {
  e.preventDefault();
  if (draggedRowIndex === null || draggedRowIndex === targetIdx) return;
  const proj = getActiveProject();
  if (!proj) return;
  const oldOrder = proj.tasks.map(t => t.id);
  const [moved] = proj.tasks.splice(draggedRowIndex, 1);
  proj.tasks.splice(targetIdx, 0, moved);
  draggedRowIndex = null;
  rewriteFormulasAfterReorder(proj, oldOrder);
  recalculateProjectFormulas(proj);
  saveState();
  renderApp();
};

window.onCellEdit = function (taskId, field, value) {
  const proj = getActiveProject();
  if (!proj) return;
  const task = proj.tasks.find(t => t.id === taskId);
  if (!task) return;

  const val = String(value).trim();
  if (field === 'title') {
    if (val) task.title = val;
  } else if (field === 'owner') {
    task.owner = val;
  } else if (field === 'start') {
    if (val.startsWith('=')) {
      task.startFormula = val;
    } else {
      const dt = parseDMY(val);
      if (dt) {
        const oldStart = parseDMY(task.startDate);
        const oldEnd = parseDMY(task.endDate);
        const dur = diffDaysInclusive(oldStart, oldEnd);
        task.startFormula = '';
        task.startDate = formatDMY(dt);
        task.endDate = formatDMY(addDays(dt, dur - 1));
      }
    }
  } else if (field === 'end') {
    const dt = parseDMY(val);
    if (dt) {
      const sDt = parseDMY(task.startDate);
      if (sDt && dt < sDt) {
        task.endDate = task.startDate;
      } else {
        task.endDate = formatDMY(dt);
      }
    }
  } else if (field === 'days') {
    const days = parseInt(val, 10);
    if (!isNaN(days) && days >= 1) {
      const sDt = parseDMY(task.startDate);
      if (sDt) {
        task.endDate = formatDMY(addDays(sDt, days - 1));
      }
    }
  } else if (field === 'dependsOn') {
    task.dependsOn = val;
    if (!val) task.startFormula = '';
  }

  recalculateProjectFormulas(proj);
  saveState();
  renderApp();
};

function renderGantt(proj) {
  const container = document.getElementById('ganttContainer');
  if (!container) return;

  recalculateProjectFormulas(proj);

  const ROW_H = 46;
  const HEADER_H = 48;

  // Determine timeline range
  let minDt = getToday();
  let maxDt = addDays(minDt, 28);
  proj.tasks.forEach(t => {
    const s = parseDMY(t.startDate);
    const e = parseDMY(t.endDate);
    if (s && s < minDt) minDt = new Date(s.getTime());
    if (e && e > maxDt) maxDt = new Date(e.getTime());
  });
  minDt = addDays(minDt, -3);
  maxDt = addDays(maxDt, 7);

  const totalDays = diffDaysInclusive(minDt, maxDt);
  const pxPerDay = (state.ganttScale === 'week' ? 22 : 42) * state.ganttZoom;
  const timelineWidth = totalDays * pxPerDay;

  // Build timeline header cells
  let headerCellsHtml = '';
  if (state.ganttScale === 'week') {
    let cur = new Date(minDt.getTime());
    while (cur <= maxDt) {
      const weekNum = getISOWeek(cur);
      const daysToSun = (7 - (cur.getDay() || 7)) % 7;
      const chunkDays = Math.min(daysToSun + 1, diffDaysInclusive(cur, maxDt));
      const w = chunkDays * pxPerDay;
      headerCellsHtml += `<div class="gantt-time-cell" style="width:${w}px;">W${weekNum}<br><small>${formatDDMM(cur)}</small></div>`;
      cur = addDays(cur, chunkDays);
    }
  } else {
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(minDt, i);
      const isWknd = d.getDay() === 0 || d.getDay() === 6;
      headerCellsHtml += `<div class="gantt-time-cell ${isWknd ? 'wknd' : ''}" style="width:${pxPerDay}px;">${formatDDMM(d)}</div>`;
    }
  }

  // Build spreadsheet rows
  const tableRowsHtml = proj.tasks.map((t, idx) => {
    const sDt = parseDMY(t.startDate);
    const eDt = parseDMY(t.endDate);
    const days = diffDaysInclusive(sDt, eDt);
    const depOptions = `<option value="">—</option>` + proj.tasks
      .filter(other => other.id !== t.id)
      .map(other => `<option value="${other.id}" ${t.dependsOn === other.id ? 'selected' : ''}>#${proj.tasks.indexOf(other) + 1} ${escapeHtml(other.title)}</option>`)
      .join('');

    return `
      <div class="gantt-row" style="height:${ROW_H}px;"
           draggable="true"
           ondragstart="onGanttRowDragStart(event, ${idx})"
           ondragover="event.preventDefault()"
           ondrop="onGanttRowDrop(event, ${idx})">
        <div class="gantt-cell idx-cell" style="width:${colWidths.idx}px;">
          <span class="drag-grip" title="Drag row">⋮⋮</span>
          <span>${idx + 1}</span>
          <span class="row-arrows">
            <button onclick="moveTaskRow(${idx}, -1)" title="Move Up">▲</button>
            <button onclick="moveTaskRow(${idx}, 1)" title="Move Down">▼</button>
          </span>
        </div>
        <div class="gantt-cell" style="width:${colWidths.title}px;">
          <input type="text" value="${escapeHtml(t.title)}" onchange="onCellEdit('${t.id}', 'title', this.value)" />
        </div>
        <div class="gantt-cell" style="width:${colWidths.owner}px;">
          <input type="text" value="${escapeHtml(t.owner || '')}" onchange="onCellEdit('${t.id}', 'owner', this.value)" />
        </div>
        <div class="gantt-cell" style="width:${colWidths.start}px;">
          <input type="text" value="${escapeHtml(t.startFormula || t.startDate)}"
                 title="Enter D/M/YYYY or =Row+Days (e.g. =1+3)"
                 onchange="onCellEdit('${t.id}', 'start', this.value)" />
        </div>
        <div class="gantt-cell" style="width:${colWidths.end}px;">
          <input type="text" value="${escapeHtml(t.endDate)}" onchange="onCellEdit('${t.id}', 'end', this.value)" />
        </div>
        <div class="gantt-cell" style="width:${colWidths.days}px;">
          <input type="number" min="1" value="${days}" onchange="onCellEdit('${t.id}', 'days', this.value)" />
        </div>
        <div class="gantt-cell" style="width:${colWidths.depends}px;">
          <select onchange="onCellEdit('${t.id}', 'dependsOn', this.value)">${depOptions}</select>
        </div>
      </div>`;
  }).join('');

  // Build bars & SVG dashed arrows
  const barCoords = {};
  const barsHtml = proj.tasks.map((t, idx) => {
    const sDt = parseDMY(t.startDate) || minDt;
    const eDt = parseDMY(t.endDate) || sDt;
    const offsetDays = Math.round((sDt.getTime() - minDt.getTime()) / 86400000);
    const durDays = diffDaysInclusive(sDt, eDt);
    const leftPx = offsetDays * pxPerDay;
    const widthPx = Math.max(24, durDays * pxPerDay);
    const topPx = idx * ROW_H + 6;
    const barH = ROW_H - 12;

    barCoords[t.id] = { left: leftPx, right: leftPx + widthPx, midY: topPx + barH / 2 };
    const info = getTaskUrgencyAndColor(t);

    return `
      <div class="gantt-bar" data-task-id="${t.id}"
           style="left:${leftPx}px; top:${topPx}px; width:${widthPx}px; height:${barH}px; background:${info.hex};"
           onmousedown="startGanttBarDrag(event, '${t.id}', 'move', ${pxPerDay})">
        <div class="bar-resize-left" onmousedown="startGanttBarDrag(event, '${t.id}', 'left', ${pxPerDay})"></div>
        <span class="bar-date-in">${formatDDMM(sDt)}</span>
        <span class="bar-label-wrap">${escapeHtml(t.title)}</span>
        <span class="bar-date-in">${formatDDMM(eDt)}</span>
        <div class="bar-resize-right" onmousedown="startGanttBarDrag(event, '${t.id}', 'right', ${pxPerDay})"></div>
      </div>`;
  }).join('');

  let arrowsSvg = '';
  proj.tasks.forEach(t => {
    if (t.dependsOn && barCoords[t.dependsOn] && barCoords[t.id]) {
      const from = barCoords[t.dependsOn];
      const to = barCoords[t.id];
      const midX = from.right + 12;
      const d = `M ${from.right} ${from.midY} L ${midX} ${from.midY} L ${midX} ${to.midY} L ${to.left - 4} ${to.midY}`;
      arrowsSvg += `<path d="${d}" fill="none" stroke="#ef4444" stroke-width="1.25" stroke-dasharray="4,3" marker-end="url(#arrowhead)" />`;
    }
  });

  const totalTableW = Object.values(colWidths).reduce((a, b) => a + b, 0);
  const bodyHeight = Math.max(240, proj.tasks.length * ROW_H);

  container.innerHTML = `
    <div class="gantt-wrapper" style="display:flex; overflow:auto; border:1px solid #cbd5e1; border-radius:10px; background:#fff;">
      <div class="gantt-left" style="width:${totalTableW}px; flex-shrink:0; border-right:2px solid #cbd5e1;">
        <div class="gantt-header-row" style="height:${HEADER_H}px; display:flex; background:#f1f5f9; border-bottom:1px solid #cbd5e1; font-weight:600; font-size:12px;">
          ${renderResizableHeader('idx', '#')}
          ${renderResizableHeader('title', 'Task / Description')}
          ${renderResizableHeader('owner', 'Owner')}
          ${renderResizableHeader('start', 'Start')}
          ${renderResizableHeader('end', 'End')}
          ${renderResizableHeader('days', 'Days')}
          ${renderResizableHeader('depends', 'Depends On')}
        </div>
        <div>${tableRowsHtml}</div>
      </div>
      <div class="gantt-right" style="width:${timelineWidth}px; flex-shrink:0; position:relative;">
        <div class="gantt-timeline-header" style="height:${HEADER_H}px; display:flex; background:#f8fafc; border-bottom:1px solid #cbd5e1;">
          ${headerCellsHtml}
        </div>
        <div class="gantt-timeline-body" style="height:${bodyHeight}px; position:relative;">
          <svg width="${timelineWidth}" height="${bodyHeight}" style="position:absolute; top:0; left:0; pointer-events:none;">
            <defs>
              <marker id="arrowhead" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <polygon points="0 0, 7 3.5, 0 7" fill="#ef4444" />
              </marker>
            </defs>
            ${arrowsSvg}
          </svg>
          ${barsHtml}
        </div>
      </div>
    </div>`;
}

function renderResizableHeader(key, label) {
  return `
    <div class="gantt-th" style="width:${colWidths[key]}px; position:relative; padding:0 8px; display:flex; align-items:center; border-right:1px solid #e2e8f0; box-sizing:border-box;">
      <span>${label}</span>
      <div class="col-resizer" onmousedown="startColResize(event, '${key}')"></div>
    </div>`;
}

window.startColResize = function (e, key) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startW = colWidths[key];
  function onMove(ev) {
    colWidths[key] = Math.max(48, startW + (ev.clientX - startX));
    const proj = getActiveProject();
    if (proj) renderGantt(proj);
  }
  function onUp() {
    saveState();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

window.startGanttBarDrag = function (e, taskId, mode, pxPerDay) {
  e.stopPropagation();
  const proj = getActiveProject();
  if (!proj) return;
  const task = proj.tasks.find(t => t.id === taskId);
  if (!task) return;

  const startX = e.clientX;
  const origStart = parseDMY(task.startDate);
  const origEnd = parseDMY(task.endDate);
  if (!origStart || !origEnd) return;

  function onMove(ev) {
    const deltaDays = Math.round((ev.clientX - startX) / pxPerDay);
    if (mode === 'move') {
      task.startFormula = '';
      task.startDate = formatDMY(addDays(origStart, deltaDays));
      task.endDate = formatDMY(addDays(origEnd, deltaDays));
    } else if (mode === 'left') {
      const candidate = addDays(origStart, deltaDays);
      if (candidate <= origEnd) {
        task.startFormula = '';
        task.startDate = formatDMY(candidate);
      }
    } else if (mode === 'right') {
      const candidate = addDays(origEnd, deltaDays);
      if (candidate >= origStart) {
        task.endDate = formatDMY(candidate);
      }
    }
    recalculateProjectFormulas(proj);
    renderGantt(proj);
  }

  function onUp() {
    saveState();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

/* ---------- PERT Chart & Critical Path ---------- */

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

function renderPert(proj) {
  const canvas = document.getElementById('pertCanvas');
  if (!canvas) return;
  if (proj.tasks.length === 0) {
    canvas.innerHTML = '<p style="padding:24px; color:#64748b;">Add tasks to generate the PERT network diagram.</p>';
    return;
  }

  // Build CPM metrics (ES, EF, LS, LF, Slack)
  const nodes = {};
  proj.tasks.forEach((t, i) => {
    const dur = diffDaysInclusive(parseDMY(t.startDate), parseDMY(t.endDate));
    nodes[t.id] = { task: t, index: i + 1, dur, preds: [], succs: [], es: 0, ef: dur, ls: 0, lf: dur, slack: 0, stage: 0 };
  });

  proj.tasks.forEach(t => {
    if (t.dependsOn && nodes[t.dependsOn]) {
      nodes[t.id].preds.push(t.dependsOn);
      nodes[t.dependsOn].succs.push(t.id);
    }
  });

  // Forward pass
  for (let pass = 0; pass < proj.tasks.length + 2; pass++) {
    proj.tasks.forEach(t => {
      const n = nodes[t.id];
      if (n.preds.length > 0) {
        n.es = Math.max(...n.preds.map(pid => nodes[pid].ef));
        n.stage = Math.max(...n.preds.map(pid => nodes[pid].stage + 1));
      }
      n.ef = n.es + n.dur;
    });
  }

  const projectFinish = Math.max(...Object.values(nodes).map(n => n.ef), 1);

  // Backward pass
  Object.values(nodes).forEach(n => {
    n.lf = projectFinish;
    n.ls = n.lf - n.dur;
  });

  for (let pass = 0; pass < proj.tasks.length + 2; pass++) {
    proj.tasks.forEach(t => {
      const n = nodes[t.id];
      if (n.succs.length > 0) {
        n.lf = Math.min(...n.succs.map(sid => nodes[sid].ls));
      }
      n.ls = n.lf - n.dur;
      n.slack = n.ls - n.es;
    });
  }

  // Stage coordinates
  const stageCounts = {};
  proj.tasks.forEach(t => {
    const n = nodes[t.id];
    const rowInStage = stageCounts[n.stage] || 0;
    stageCounts[n.stage] = rowInStage + 1;
    if (t.pertX === null || t.pertY === null) {
      t.pertX = 40 + n.stage * 270;
      t.pertY = 40 + rowInStage * 155;
    }
  });

  const NODE_W = 210;
  const NODE_H = 112;
  const maxW = Math.max(960, ...proj.tasks.map(t => t.pertX + NODE_W + 60));
  const maxH = Math.max(540, ...proj.tasks.map(t => t.pertY + NODE_H + 60));

  let arrowsHtml = '';
  proj.tasks.forEach(t => {
    const n = nodes[t.id];
    n.preds.forEach(pid => {
      const pNode = nodes[pid];
      const isCrit = n.slack === 0 && pNode.slack === 0;
      const x1 = pNode.task.pertX + NODE_W;
      const y1 = pNode.task.pertY + NODE_H / 2;
      const x2 = t.pertX;
      const y2 = t.pertY + NODE_H / 2;
      const cx = (x1 + x2) / 2;
      arrowsHtml += `<path d="M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2 - 5} ${y2}"
        fill="none" stroke="${isCrit ? '#dc2626' : '#64748b'}" stroke-width="${isCrit ? 2.4 : 1.5}"
        marker-end="url(#${isCrit ? 'pertArrowCrit' : 'pertArrow'})" />`;
    });
  });

  const cardsHtml = proj.tasks.map(t => {
    const n = nodes[t.id];
    const isCrit = n.slack === 0;
    const info = getTaskUrgencyAndColor(t);
    return `
      <div class="pert-node ${isCrit ? 'critical-node' : ''}"
           style="left:${t.pertX}px; top:${t.pertY}px; width:${NODE_W}px; height:${NODE_H}px; border-color:${isCrit ? '#dc2626' : '#cbd5e1'};"
           onmousedown="startPertNodeDrag(event, '${t.id}')">
        <div class="pert-node-head" style="background:${isCrit ? '#dc2626' : info.hex}; color:#fff;">
          <span>#${n.index} ${isCrit ? 'CRITICAL' : info.badge}</span>
          <span>${n.dur}d</span>
        </div>
        <div class="pert-node-title">${escapeHtml(t.title)}</div>
        <div class="pert-node-meta">
          <span>ES:${n.es} EF:${n.ef}</span>
          <span>Slack:${n.slack}d</span>
        </div>
      </div>`;
  }).join('');

  canvas.innerHTML = `
    <div style="position:relative; width:${maxW}px; height:${maxH}px;">
      <svg width="${maxW}" height="${maxH}" style="position:absolute; top:0; left:0; pointer-events:none;">
        <defs>
          <marker id="pertArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <polygon points="0 0, 8 4, 0 8" fill="#64748b" />
          </marker>
          <marker id="pertArrowCrit" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <polygon points="0 0, 8 4, 0 8" fill="#dc2626" />
          </marker>
        </defs>
        ${arrowsHtml}
      </svg>
      ${cardsHtml}
    </div>`;
}

window.startPertNodeDrag = function (e, taskId) {
  e.stopPropagation();
  const proj = getActiveProject();
  if (!proj) return;
  const task = proj.tasks.find(t => t.id === taskId);
  if (!task) return;

  const startX = e.clientX;
  const startY = e.clientY;
  const origX = task.pertX;
  const origY = task.pertY;

  function onMove(ev) {
    task.pertX = Math.max(10, origX + (ev.clientX - startX));
    task.pertY = Math.max(10, origY + (ev.clientY - startY));
    renderPert(proj);
  }
  function onUp() {
    saveState();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

/* ---------- Export / Import JSON & Export CSV ---------- */

window.exportJSON = function () {
  const payload = JSON.stringify({ projects: state.projects, colWidths }, null, 2);
  downloadBlob(payload, 'kanban_gantt_pert_backup.json', 'application/json');
};

window.triggerImportJSON = function () {
  const inp = document.getElementById('importJsonInput');
  if (inp) inp.click();
};

window.handleImportJSON = function (e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (ev) {
    try {
      const data = JSON.parse(ev.target.result);
      if (Array.isArray(data)) {
        state.projects = data;
      } else if (data && Array.isArray(data.projects)) {
        state.projects = data.projects;
        if (data.colWidths) colWidths = { ...colWidths, ...data.colWidths };
      } else {
        alert('Invalid JSON format.');
        return;
      }
      state.activeProjectId = null;
      saveState();
      renderApp();
    } catch (err) {
      alert('Could not parse JSON file.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
};

window.exportCSV = function () {
  const proj = getActiveProject();
  if (!proj) return;
  const rows = [['#', 'Task Name', 'Owner', 'Status', 'Start Date', 'Formula', 'End Date', 'Days', 'Depends On']];
  proj.tasks.forEach((t, i) => {
    const depIdx = t.dependsOn ? proj.tasks.findIndex(x => x.id === t.dependsOn) + 1 : '';
    const days = diffDaysInclusive(parseDMY(t.startDate), parseDMY(t.endDate));
    rows.push([
      i + 1,
      `"${(t.title || '').replace(/"/g, '""')}"`,
      `"${(t.owner || '').replace(/"/g, '""')}"`,
      t.status || 'To Do',
      t.startDate,
      t.startFormula || '',
      t.endDate,
      days,
      depIdx ? `#${depIdx}` : ''
    ]);
  });
  const csvContent = rows.map(r => r.join(',')).join('\n');
  const safeName = proj.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  downloadBlob(csvContent, `${safeName}_schedule.csv`, 'text/csv;charset=utf-8;');
};

function downloadBlob(content, filename, mimeType) {
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
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------- Boot ---------- */

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  renderApp();
});
