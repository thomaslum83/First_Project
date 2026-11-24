const STORAGE_KEY = 'kanban_gantt_pert_projects_v16';
const WIDTHS_KEY = 'kanban_gantt_col_widths_v16';

let projects = [];
let activeProjectId = null;
let currentView = 'kanban';
let ganttScale = 'week';
let colPx = 84;
let colWidths = {
  idx: 58,
  name: 210,
  owner: 105,
  start: 105,
  end: 105,
  days: 65,
  dep: 115
};

let draggedTaskId = null;
let draggedRowIndex = null;
let resizingCol = null;
let resizeStartX = 0;
let resizeStartW = 0;

let barDragState = null;
let pertDragState = null;

function initApp() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) projects = JSON.parse(saved) || [];
  } catch (e) {
    projects = [];
  }
  try {
    const savedW = localStorage.getItem(WIDTHS_KEY);
    if (savedW) colWidths = Object.assign(colWidths, JSON.parse(savedW));
  } catch (e) {}

  renderDashboard();

  document.addEventListener('mousemove', handleGlobalMouseMove);
  document.addEventListener('mouseup', handleGlobalMouseUp);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch (e) {}
}

function saveWidths() {
  try {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify(colWidths));
  } catch (e) {}
}

function openProjectModal() {
  const modal = document.getElementById('projectModal') || document.querySelector('.modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  const inputs = modal.querySelectorAll('input[type="text"], input:not([type])');
  if (inputs[0]) {
    inputs[0].value = '';
    setTimeout(() => inputs[0].focus(), 30);
  }
  if (inputs[1]) inputs[1].value = '';
}

function closeProjectModal() {
  const modal = document.getElementById('projectModal') || document.querySelector('.modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

function createNewProject() {
  const modal = document.getElementById('projectModal') || document.querySelector('.modal');
  let nameInput = document.getElementById('projNameInput') || document.getElementById('projectNameInput');
  let descInput = document.getElementById('projDescInput') || document.getElementById('projectDescInput');

  if (!nameInput && modal) {
    const textInputs = modal.querySelectorAll('input[type="text"], input:not([type])');
    nameInput = textInputs[0] || null;
    descInput = textInputs[1] || null;
  }

  const name = nameInput ? nameInput.value.trim() : '';
  const desc = descInput ? descInput.value.trim() : '';

  if (!name) {
    alert('Please enter a project name.');
    if (nameInput) nameInput.focus();
    return;
  }

  const todayStr = formatDMY(new Date());
  const nextWeekStr = formatDMY(addDays(new Date(), 4));

  const newProj = {
    id: 'proj_' + Date.now(),
    name: name,
    description: desc,
    tasks: [
      {
        id: 't_' + Date.now() + '_1',
        title: 'Project Kickoff & Planning',
        category: 'Planning',
        owner: 'Lead',
        status: 'To Do',
        start: todayStr,
        end: nextWeekStr,
        days: 5,
        formula: '',
        dependsOn: '',
        pertX: 60,
        pertY: 80
      }
    ]
  };

  projects.push(newProj);
  saveState();
  closeProjectModal();
  openProject(newProj.id);
}

window.openProjectModal = openProjectModal;
window.closeProjectModal = closeProjectModal;
window.createNewProject = createNewProject;
window.handleCreateProject = function(e) {
  if (e) e.preventDefault();
  createNewProject();
};

function showDashboard() {
  activeProjectId = null;
  const dash = document.getElementById('dashboardView');
  const ws = document.getElementById('workspaceView');
  const bc = document.getElementById('breadcrumbProject');
  const tabs = document.getElementById('viewTabs');
  if (dash) dash.classList.remove('hidden');
  if (ws) ws.classList.add('hidden');
  if (bc) bc.textContent = '';
  if (tabs) tabs.classList.add('hidden');
  renderDashboard();
}
window.showDashboard = showDashboard;

function openProject(projId) {
  const proj = projects.find(p => p.id === projId);
  if (!proj) return;
  activeProjectId = projId;

  const dash = document.getElementById('dashboardView');
  const ws = document.getElementById('workspaceView');
  const bc = document.getElementById('breadcrumbProject');
  const tabs = document.getElementById('viewTabs');

  if (dash) dash.classList.add('hidden');
  if (ws) ws.classList.remove('hidden');
  if (bc) bc.textContent = ' / ' + proj.name;
  if (tabs) tabs.classList.remove('hidden');

  recalculateFormulas(proj);
  switchView(currentView);
}
window.openProject = openProject;

function deleteProject(projId, event) {
  if (event) event.stopPropagation();
  if (!confirm('Delete this project permanently?')) return;
  projects = projects.filter(p => p.id !== projId);
  saveState();
  renderDashboard();
}
window.deleteProject = deleteProject;

function renderDashboard() {
  const grid = document.getElementById('projectsGrid');
  if (!grid) return;
  if (projects.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1; text-align:center; padding:48px 20px; border:2px dashed #cbd5e1; border-radius:12px; color:#64748b;">
      No projects yet. Click <strong>+ New Project</strong> at the top to create your first workspace, or import a JSON backup.
    </div>`;
    return;
  }

  grid.innerHTML = projects.map(p => {
    const total = p.tasks.length;
    const done = p.tasks.filter(t => t.status === 'Completed' || t.status === 'Done').length;
    return `
      <div class="project-card" onclick="openProject('${p.id}')">
        <div class="project-card-header">
          <h3>${escapeHtml(p.name)}</h3>
          <button class="btn-icon-danger" onclick="deleteProject('${p.id}', event)" title="Delete Project">🗑️</button>
        </div>
        <p class="project-desc">${escapeHtml(p.description || 'Project schedule & workflow')}</p>
        <div class="project-meta">
          <span>📋 ${total} Tasks</span>
          <span>✅ ${done}/${total} Done</span>
        </div>
      </div>
    `;
  }).join('');
}

function switchView(view) {
  currentView = view;
  const views = ['kanban', 'gantt', 'pert'];
  views.forEach(v => {
    const el = document.getElementById(v + 'View');
    const btn = document.getElementById('tab-' + v);
    if (el) el.classList.toggle('hidden', v !== view);
    if (btn) btn.classList.toggle('active', v === view);
  });

  const proj = getActiveProject();
  if (!proj) return;
  if (view === 'kanban') renderKanban(proj);
  if (view === 'gantt') renderGantt(proj);
  if (view === 'pert') renderPert(proj);
}
window.switchView = switchView;

function getActiveProject() {
  return projects.find(p => p.id === activeProjectId) || null;
}

/* ================= DATE & FORMULA HELPERS ================= */
function parseDMY(str) {
  if (!str) return new Date();
  const parts = String(str).trim().split('/');
  if (parts.length !== 3) return new Date();
  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const y = parseInt(parts[2], 10);
  const dt = new Date(y, m, d);
  return isNaN(dt.getTime()) ? new Date() : dt;
}

function formatDMY(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) date = new Date();
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

function formatShortDM(str) {
  const parts = String(str || '').split('/');
  if (parts.length < 2) return str || '';
  const dd = parts[0].padStart(2, '0');
  const mm = parts[1].padStart(2, '0');
  return `${dd}/${mm}`;
}

function addDays(date, days) {
  const res = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  res.setDate(res.getDate() + days);
  return res;
}

function diffDaysInclusive(startStr, endStr) {
  const s = parseDMY(startStr);
  const e = parseDMY(endStr);
  const diff = Math.round((e - s) / 86400000) + 1;
  return Math.max(1, diff);
}

function getTaskColorClass(task) {
  const status = (task.status || 'To Do').toLowerCase();
  if (status === 'completed' || status === 'done') return 'status-completed';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = parseDMY(task.end);
  end.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((end - today) / 86400000);

  if (daysLeft < 0) return 'status-overdue';
  if (daysLeft <= 7) return 'status-warning';

  if (status === 'pending') return 'status-pending';
  if (status === 'in progress') return 'status-progress';
  return 'status-todo';
}

function getTaskHexColor(task) {
  const cls = getTaskColorClass(task);
  const map = {
    'status-pending': '#64748b',
    'status-todo': '#2563eb',
    'status-progress': '#16a34a',
    'status-completed': '#0f172a',
    'status-warning': '#eab308',
    'status-overdue': '#dc2626'
  };
  return map[cls] || '#2563eb';
}

function recalculateFormulas(proj) {
  if (!proj || !proj.tasks) return;
  for (let pass = 0; pass < proj.tasks.length; pass++) {
    proj.tasks.forEach((task, idx) => {
      if (task.formula && task.formula.startsWith('=')) {
        const match = task.formula.match(/^=(\d+)([+-]\d+)?$/);
        if (match) {
          const refIdx = parseInt(match[1], 10) - 1;
          const offset = match[2] ? parseInt(match[2], 10) : 0;
          if (refIdx >= 0 && refIdx < proj.tasks.length && refIdx !== idx) {
            const pred = proj.tasks[refIdx];
            const predEnd = parseDMY(pred.end);
            const newStart = addDays(predEnd, offset);
            const dur = Math.max(1, parseInt(task.days, 10) || diffDaysInclusive(task.start, task.end));
            task.start = formatDMY(newStart);
            task.end = formatDMY(addDays(newStart, dur - 1));
            task.days = dur;
            task.dependsOn = pred.id;
          }
        }
      } else {
        task.days = diffDaysInclusive(task.start, task.end);
      }
    });
  }
}

/* ================= TASK MODAL ================= */
function openTaskModal(taskId = null) {
  const proj = getActiveProject();
  if (!proj) return;
  const modal = document.getElementById('taskModal');
  if (!modal) return;

  const depSelect = document.getElementById('taskDependsInput');
  if (depSelect) {
    depSelect.innerHTML = '<option value="">None</option>' +
      proj.tasks.filter(t => t.id !== taskId).map((t, i) =>
        `<option value="${t.id}">#${proj.tasks.indexOf(t) + 1} ${escapeHtml(t.title)}</option>`
      ).join('');
  }

  const editIdInput = document.getElementById('editTaskId');
  const titleInput = document.getElementById('taskTitleInput');
  const catInput = document.getElementById('taskCatInput');
  const ownerInput = document.getElementById('taskOwnerInput');
  const statusInput = document.getElementById('taskStatusInput');
  const startInput = document.getElementById('taskStartInput');
  const endInput = document.getElementById('taskEndInput');

  if (taskId) {
    const t = proj.tasks.find(x => x.id === taskId);
    if (!t) return;
    if (editIdInput) editIdInput.value = t.id;
    if (titleInput) titleInput.value = t.title;
    if (catInput) catInput.value = t.category || '';
    if (ownerInput) ownerInput.value = t.owner || '';
    if (statusInput) statusInput.value = t.status || 'To Do';
    if (startInput) startInput.value = t.formula || t.start;
    if (endInput) endInput.value = t.end;
    if (depSelect) depSelect.value = t.dependsOn || '';
  } else {
    if (editIdInput) editIdInput.value = '';
    if (titleInput) titleInput.value = '';
    if (catInput) catInput.value = 'General';
    if (ownerInput) ownerInput.value = '';
    if (statusInput) statusInput.value = 'To Do';
    const today = new Date();
    if (startInput) startInput.value = formatDMY(today);
    if (endInput) endInput.value = formatDMY(addDays(today, 3));
    if (depSelect) depSelect.value = '';
  }

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}
window.openTaskModal = openTaskModal;

function closeTaskModal() {
  const modal = document.getElementById('taskModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
}
window.closeTaskModal = closeTaskModal;

function saveTaskFromModal() {
  const proj = getActiveProject();
  if (!proj) return;

  const editId = document.getElementById('editTaskId')?.value;
  const title = document.getElementById('taskTitleInput')?.value.trim();
  if (!title) {
    alert('Please enter a task name.');
    return;
  }
  const category = document.getElementById('taskCatInput')?.value.trim() || 'General';
  const owner = document.getElementById('taskOwnerInput')?.value.trim() || '';
  const status = document.getElementById('taskStatusInput')?.value || 'To Do';
  const rawStart = document.getElementById('taskStartInput')?.value.trim() || formatDMY(new Date());
  const rawEnd = document.getElementById('taskEndInput')?.value.trim() || rawStart;
  const dependsOn = document.getElementById('taskDependsInput')?.value || '';

  let formula = '';
  let start = rawStart;
  let end = rawEnd;
  let days = 1;

  if (rawStart.startsWith('=')) {
    formula = rawStart.replace(/\s+/g, '');
    days = editId ? (proj.tasks.find(x => x.id === editId)?.days || 3) : 3;
    start = formatDMY(new Date());
    end = formatDMY(addDays(new Date(), days - 1));
  } else {
    start = formatDMY(parseDMY(rawStart));
    end = formatDMY(parseDMY(rawEnd));
    if (parseDMY(end) < parseDMY(start)) end = start;
    days = diffDaysInclusive(start, end);
  }

  if (editId) {
    const t = proj.tasks.find(x => x.id === editId);
    if (t) {
      t.title = title;
      t.category = category;
      t.owner = owner;
      t.status = status;
      t.formula = formula;
      t.start = start;
      t.end = end;
      t.days = days;
      t.dependsOn = dependsOn;
    }
  } else {
    proj.tasks.push({
      id: 't_' + Date.now(),
      title,
      category,
      owner,
      status,
      formula,
      start,
      end,
      days,
      dependsOn,
      pertX: 60 + (proj.tasks.length % 4) * 240,
      pertY: 60 + Math.floor(proj.tasks.length / 4) * 140
    });
  }

  recalculateFormulas(proj);
  saveState();
  closeTaskModal();
  switchView(currentView);
}
window.saveTaskFromModal = saveTaskFromModal;

function deleteTask(taskId, e) {
  if (e) e.stopPropagation();
  const proj = getActiveProject();
  if (!proj) return;
  proj.tasks = proj.tasks.filter(t => t.id !== taskId);
  proj.tasks.forEach(t => {
    if (t.dependsOn === taskId) t.dependsOn = '';
  });
  recalculateFormulas(proj);
  saveState();
  switchView(currentView);
}
window.deleteTask = deleteTask;

/* ================= KANBAN VIEW ================= */
function renderKanban(proj) {
  const board = document.getElementById('kanbanBoard');
  if (!board) return;

  const warningTasks = proj.tasks.filter(t => {
    const cls = getTaskColorClass(t);
    return cls === 'status-overdue' || cls === 'status-warning';
  });

  const cols = [
    { key: 'Warning', title: '⚠️ Past Deadline / Warning', items: warningTasks, isAlert: true },
    { key: 'Pending', title: 'Pending', items: proj.tasks.filter(t => t.status === 'Pending') },
    { key: 'To Do', title: 'To Do', items: proj.tasks.filter(t => !t.status || t.status === 'To Do') },
    { key: 'In Progress', title: 'In Progress', items: proj.tasks.filter(t => t.status === 'In Progress') },
    { key: 'Completed', title: 'Completed', items: proj.tasks.filter(t => t.status === 'Completed' || t.status === 'Done') }
  ];

  board.innerHTML = cols.map(col => `
    <div class="kanban-col ${col.isAlert ? 'kanban-col-alert' : ''}"
         ondragover="event.preventDefault()"
         ondrop="handleKanbanDrop(event, '${col.key}')">
      <div class="kanban-col-header">
        <span>${col.title}</span>
        <span class="badge">${col.items.length}</span>
      </div>
      <div class="kanban-cards">
        ${col.items.map(t => {
          const colorCls = getTaskColorClass(t);
          return `
            <div class="kanban-card ${colorCls}" draggable="true"
                 ondragstart="draggedTaskId='${t.id}'"
                 onclick="openTaskModal('${t.id}')">
              <div class="kcard-top">
                <span class="kcard-cat">${escapeHtml(t.category || 'Task')}</span>
                <button class="kcard-del" onclick="deleteTask('${t.id}', event)">✕</button>
              </div>
              <div class="kcard-title">${escapeHtml(t.title)}</div>
              <div class="kcard-footer">
                <span>👤 ${escapeHtml(t.owner || 'Unassigned')}</span>
                <span>📅 ${t.start} → ${t.end}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');
}

function handleKanbanDrop(e, targetCol) {
  e.preventDefault();
  if (targetCol === 'Warning' || !draggedTaskId) return;
  const proj = getActiveProject();
  if (!proj) return;
  const t = proj.tasks.find(x => x.id === draggedTaskId);
  if (t) {
    t.status = targetCol;
    saveState();
    renderKanban(proj);
  }
  draggedTaskId = null;
}
window.handleKanbanDrop = handleKanbanDrop;

/* ================= GANTT VIEW ================= */
function setGanttScale(scale) {
  ganttScale = scale;
  colPx = scale === 'day' ? 38 : 84;
  document.getElementById('btnScaleWeek')?.classList.toggle('active', scale === 'week');
  document.getElementById('btnScaleDay')?.classList.toggle('active', scale === 'day');
  const proj = getActiveProject();
  if (proj) renderGantt(proj);
}
window.setGanttScale = setGanttScale;

function zoomGantt(delta) {
  colPx = Math.max(24, Math.min(180, colPx + delta));
  const proj = getActiveProject();
  if (proj) renderGantt(proj);
}
window.zoomGantt = zoomGantt;

function sortGanttByDate() {
  const proj = getActiveProject();
  if (!proj) return;
  const oldOrder = proj.tasks.map(t => t.id);
  proj.tasks.sort((a, b) => {
    const diff = parseDMY(a.start) - parseDMY(b.start);
    return diff !== 0 ? diff : parseDMY(a.end) - parseDMY(b.end);
  });
  rewriteFormulasAfterReorder(proj, oldOrder);
  recalculateFormulas(proj);
  saveState();
  renderGantt(proj);
}
window.sortGanttByDate = sortGanttByDate;

function moveRow(index, delta) {
  const proj = getActiveProject();
  if (!proj) return;
  const newIndex = index + delta;
  if (newIndex < 0 || newIndex >= proj.tasks.length) return;
  const oldOrder = proj.tasks.map(t => t.id);
  const [moved] = proj.tasks.splice(index, 1);
  proj.tasks.splice(newIndex, 0, moved);
  rewriteFormulasAfterReorder(proj, oldOrder);
  recalculateFormulas(proj);
  saveState();
  renderGantt(proj);
}
window.moveRow = moveRow;

function handleRowDrop(targetIdx) {
  if (draggedRowIndex === null || draggedRowIndex === targetIdx) return;
  const proj = getActiveProject();
  if (!proj) return;
  const oldOrder = proj.tasks.map(t => t.id);
  const [moved] = proj.tasks.splice(draggedRowIndex, 1);
  proj.tasks.splice(targetIdx, 0, moved);
  draggedRowIndex = null;
  rewriteFormulasAfterReorder(proj, oldOrder);
  recalculateFormulas(proj);
  saveState();
  renderGantt(proj);
}
window.handleRowDrop = handleRowDrop;

function rewriteFormulasAfterReorder(proj, oldOrder) {
  proj.tasks.forEach(t => {
    if (t.formula && t.formula.startsWith('=')) {
      const m = t.formula.match(/^=(\d+)([+-]\d+)?$/);
      if (m) {
        const oldRefIdx = parseInt(m[1], 10) - 1;
        const refId = oldOrder[oldRefIdx];
        const newRefIdx = proj.tasks.findIndex(x => x.id === refId);
        if (newRefIdx !== -1) {
          t.formula = `=${newRefIdx + 1}${m[2] || ''}`;
        }
      }
    }
  });
}

function startColResize(e, colKey) {
  e.preventDefault();
  e.stopPropagation();
  resizingCol = colKey;
  resizeStartX = e.clientX;
  resizeStartW = colWidths[colKey];
}
window.startColResize = startColResize;

function updateCell(idx, field, val) {
  const proj = getActiveProject();
  if (!proj || !proj.tasks[idx]) return;
  const t = proj.tasks[idx];
  val = String(val).trim();

  if (field === 'title') t.title = val || t.title;
  if (field === 'owner') t.owner = val;
  if (field === 'start') {
    if (val.startsWith('=')) {
      t.formula = val.replace(/\s+/g, '');
    } else {
      t.formula = '';
      t.start = formatDMY(parseDMY(val));
      const dur = Math.max(1, parseInt(t.days, 10) || 1);
      t.end = formatDMY(addDays(parseDMY(t.start), dur - 1));
    }
  }
  if (field === 'end') {
    t.formula = '';
    t.end = formatDMY(parseDMY(val));
    if (parseDMY(t.end) < parseDMY(t.start)) t.start = t.end;
    t.days = diffDaysInclusive(t.start, t.end);
  }
  if (field === 'days') {
    const newDays = Math.max(1, parseInt(val, 10) || 1);
    t.days = newDays;
    t.end = formatDMY(addDays(parseDMY(t.start), newDays - 1));
  }
  if (field === 'dependsOn') {
    t.dependsOn = val;
    if (!val) t.formula = '';
  }

  recalculateFormulas(proj);
  saveState();
  renderGantt(proj);
}
window.updateCell = updateCell;

function getISOWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function renderGantt(proj) {
  const container = document.getElementById('ganttContainer');
  if (!container) return;

  if (proj.tasks.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:40px; text-align:center;">No tasks yet. Click <strong>+ Add Task</strong> to build your schedule.</div>`;
    return;
  }

  let minDate = parseDMY(proj.tasks[0].start);
  let maxDate = parseDMY(proj.tasks[0].end);
  proj.tasks.forEach(t => {
    const s = parseDMY(t.start);
    const e = parseDMY(t.end);
    if (s < minDate) minDate = s;
    if (e > maxDate) maxDate = e;
  });

  minDate = addDays(minDate, -3);
  maxDate = addDays(maxDate, 7);

  if (ganttScale === 'week') {
    const dow = (minDate.getDay() + 6) % 7;
    minDate = addDays(minDate, -dow);
  }

  const totalDays = Math.max(14, Math.round((maxDate - minDate) / 86400000) + 1);
  const pxPerDay = ganttScale === 'day' ? colPx : (colPx / 7);
  const timelineWidth = Math.ceil(totalDays * pxPerDay);

  let headerColsHtml = '';
  if (ganttScale === 'week') {
    const numWeeks = Math.ceil(totalDays / 7);
    for (let w = 0; w < numWeeks; w++) {
      const wStart = addDays(minDate, w * 7);
      const wkNum = getISOWeek(wStart);
      headerColsHtml += `<div class="tl-col" style="width:${colPx}px">W${wkNum}<br><small>${wStart.getDate()}/${wStart.getMonth() + 1}</small></div>`;
    }
  } else {
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    for (let d = 0; d < totalDays; d++) {
      const cur = addDays(minDate, d);
      const isWknd = cur.getDay() === 0 || cur.getDay() === 6;
      headerColsHtml += `<div class="tl-col ${isWknd ? 'wknd' : ''}" style="width:${colPx}px">${cur.getDate()}/${cur.getMonth() + 1}<br><small>${dayNames[cur.getDay()]}</small></div>`;
    }
  }

  const rowHeight = 46;
  const totalTableW = Object.values(colWidths).reduce((a, b) => a + b, 0);

  const tableRowsHtml = proj.tasks.map((t, idx) => `
    <div class="gantt-row" style="height:${rowHeight}px"
         draggable="true"
         ondragstart="draggedRowIndex=${idx}"
         ondragover="event.preventDefault()"
         ondrop="handleRowDrop(${idx})">
      <div class="gcell idx-cell" style="width:${colWidths.idx}px">
        <span class="drag-grip" title="Drag row">⋮⋮</span>
        <span>${idx + 1}</span>
        <span class="row-arrows">
          <button onclick="moveRow(${idx}, -1)" title="Move Up">▲</button>
          <button onclick="moveRow(${idx}, 1)" title="Move Down">▼</button>
        </span>
      </div>
      <div class="gcell" style="width:${colWidths.name}px">
        <input class="ginput" value="${escapeHtml(t.title)}" onchange="updateCell(${idx}, 'title', this.value)" />
      </div>
      <div class="gcell" style="width:${colWidths.owner}px">
        <input class="ginput" value="${escapeHtml(t.owner || '')}" onchange="updateCell(${idx}, 'owner', this.value)" />
      </div>
      <div class="gcell" style="width:${colWidths.start}px">
        <input class="ginput" value="${escapeHtml(t.formula || t.start)}" title="Enter D/M/YYYY or formula like =1+3" onchange="updateCell(${idx}, 'start', this.value)" />
      </div>
      <div class="gcell" style="width:${colWidths.end}px">
        <input class="ginput" value="${escapeHtml(t.end)}" onchange="updateCell(${idx}, 'end', this.value)" />
      </div>
      <div class="gcell" style="width:${colWidths.days}px">
        <input class="ginput num" type="number" min="1" value="${t.days}" onchange="updateCell(${idx}, 'days', this.value)" />
      </div>
      <div class="gcell" style="width:${colWidths.dep}px">
        <select class="ginput" onchange="updateCell(${idx}, 'dependsOn', this.value)">
          <option value="">None</option>
          ${proj.tasks.map((opt, oi) => oi !== idx ? `<option value="${opt.id}" ${t.dependsOn === opt.id ? 'selected' : ''}>#${oi + 1} ${escapeHtml(opt.title)}</option>` : '').join('')}
        </select>
      </div>
    </div>
  `).join('');

  const barCoords = {};
  const barsHtml = proj.tasks.map((t, idx) => {
    const sDate = parseDMY(t.start);
    const eDate = parseDMY(t.end);
    const offsetDays = Math.round((sDate - minDate) / 86400000);
    const durDays = Math.max(1, Math.round((eDate - sDate) / 86400000) + 1);
    const left = Math.max(0, offsetDays * pxPerDay);
    const width = Math.max(28, durDays * pxPerDay);
    const top = idx * rowHeight + 6;
    const height = rowHeight - 12;
    const bg = getTaskHexColor(t);

    barCoords[t.id] = { left, right: left + width, midY: idx * rowHeight + rowHeight / 2 };

    return `
      <div class="gantt-bar" style="left:${left}px; top:${top}px; width:${width}px; height:${height}px; background:${bg};"
           onmousedown="startBarDrag(event, ${idx}, 'move', ${pxPerDay})"
           ondblclick="openTaskModal('${t.id}')">
        <div class="bar-handle left" onmousedown="startBarDrag(event, ${idx}, 'left', ${pxPerDay})"></div>
        <span class="bar-date">${formatShortDM(t.start)}</span>
        <span class="bar-label">${escapeHtml(t.title)}</span>
        <span class="bar-date">${formatShortDM(t.end)}</span>
        <div class="bar-handle right" onmousedown="startBarDrag(event, ${idx}, 'right', ${pxPerDay})"></div>
      </div>
    `;
  }).join('');

  const arrowsSvg = proj.tasks.map(t => {
    if (!t.dependsOn || !barCoords[t.dependsOn] || !barCoords[t.id]) return '';
    const from = barCoords[t.dependsOn];
    const to = barCoords[t.id];
    const x1 = from.right;
    const y1 = from.midY;
    const x2 = to.left;
    const y2 = to.midY;
    const midX = x1 + 12;
    const path = x2 >= x1 + 16
      ? `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
      : `M ${x1} ${y1} L ${x1 + 10} ${y1} L ${x1 + 10} ${(y1 + y2) / 2} L ${x2 - 10} ${(y1 + y2) / 2} L ${x2 - 10} ${y2} L ${x2} ${y2}`;
    return `<path d="${path}" fill="none" stroke="#dc2626" stroke-width="1.25" stroke-dasharray="4,3" marker-end="url(#arrowhead)"/>`;
  }).join('');

  const totalBodyH = proj.tasks.length * rowHeight;

  container.innerHTML = `
    <div class="gantt-split">
      <div class="gantt-left" style="width:${totalTableW}px; min-width:${totalTableW}px">
        <div class="gantt-header-row">
          <div class="ghcell" style="width:${colWidths.idx}px">#<div class="col-resizer" onmousedown="startColResize(event,'idx')"></div></div>
          <div class="ghcell" style="width:${colWidths.name}px">Task / Description<div class="col-resizer" onmousedown="startColResize(event,'name')"></div></div>
          <div class="ghcell" style="width:${colWidths.owner}px">Owner<div class="col-resizer" onmousedown="startColResize(event,'owner')"></div></div>
          <div class="ghcell" style="width:${colWidths.start}px">Start<div class="col-resizer" onmousedown="startColResize(event,'start')"></div></div>
          <div class="ghcell" style="width:${colWidths.end}px">End<div class="col-resizer" onmousedown="startColResize(event,'end')"></div></div>
          <div class="ghcell" style="width:${colWidths.days}px">Days<div class="col-resizer" onmousedown="startColResize(event,'days')"></div></div>
          <div class="ghcell" style="width:${colWidths.dep}px">Depends On<div class="col-resizer" onmousedown="startColResize(event,'dep')"></div></div>
        </div>
        <div class="gantt-body-left">${tableRowsHtml}</div>
      </div>
      <div class="gantt-right">
        <div class="tl-header" style="width:${timelineWidth}px">${headerColsHtml}</div>
        <div class="tl-body" style="width:${timelineWidth}px; height:${totalBodyH}px">
          <svg class="gantt-svg" width="${timelineWidth}" height="${totalBodyH}">
            <defs>
              <marker id="arrowhead" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <polygon points="0 0, 7 3.5, 0 7" fill="#dc2626" />
              </marker>
            </defs>
            ${arrowsSvg}
          </svg>
          ${barsHtml}
        </div>
      </div>
    </div>
  `;
}

function startBarDrag(e, idx, mode, pxPerDay) {
  e.preventDefault();
  e.stopPropagation();
  const proj = getActiveProject();
  if (!proj) return;
  const t = proj.tasks[idx];
  barDragState = {
    idx,
    mode,
    pxPerDay,
    startX: e.clientX,
    origStart: parseDMY(t.start),
    origEnd: parseDMY(t.end)
  };
}
window.startBarDrag = startBarDrag;

/* ================= PERT VIEW ================= */
function autoLayoutPert() {
  const proj = getActiveProject();
  if (!proj) return;
  const levels = {};
  proj.tasks.forEach(t => { levels[t.id] = 0; });

  for (let i = 0; i < proj.tasks.length; i++) {
    proj.tasks.forEach(t => {
      if (t.dependsOn && levels[t.dependsOn] !== undefined) {
        levels[t.id] = Math.max(levels[t.id], levels[t.dependsOn] + 1);
      }
    });
  }

  const stageCounts = {};
  proj.tasks.forEach(t => {
    const lv = levels[t.id] || 0;
    const rowInStage = stageCounts[lv] || 0;
    stageCounts[lv] = rowInStage + 1;
    t.pertX = 50 + lv * 260;
    t.pertY = 50 + rowInStage * 135;
  });

  saveState();
  renderPert(proj);
}
window.autoLayoutPert = autoLayoutPert;

function renderPert(proj) {
  const canvas = document.getElementById('pertCanvas');
  if (!canvas) return;

  if (proj.tasks.length === 0) {
    canvas.innerHTML = `<div class="empty-state" style="padding:40px; text-align:center;">No tasks yet. Add tasks to generate the PERT network diagram.</div>`;
    return;
  }

  const es = {}, ef = {};
  proj.tasks.forEach(t => { es[t.id] = 0; ef[t.id] = t.days || 1; });
  for (let i = 0; i < proj.tasks.length; i++) {
    proj.tasks.forEach(t => {
      if (t.dependsOn && ef[t.dependsOn] !== undefined) {
        es[t.id] = Math.max(es[t.id], ef[t.dependsOn]);
      }
      ef[t.id] = es[t.id] + (t.days || 1);
    });
  }
  const projectEnd = Math.max(...Object.values(ef), 1);
  const ls = {}, lf = {};
  proj.tasks.forEach(t => { lf[t.id] = projectEnd; ls[t.id] = projectEnd - (t.days || 1); });
  for (let i = 0; i < proj.tasks.length; i++) {
    proj.tasks.forEach(t => {
      if (t.dependsOn && ls[t.id] !== undefined) {
        lf[t.dependsOn] = Math.min(lf[t.dependsOn], ls[t.id]);
        const pred = proj.tasks.find(x => x.id === t.dependsOn);
        if (pred) ls[pred.id] = lf[pred.id] - (pred.days || 1);
      }
    });
  }

  let maxX = 900, maxY = 560;
  proj.tasks.forEach((t, idx) => {
    if (typeof t.pertX !== 'number') t.pertX = 50 + (idx % 4) * 260;
    if (typeof t.pertY !== 'number') t.pertY = 50 + Math.floor(idx / 4) * 135;
    maxX = Math.max(maxX, t.pertX + 260);
    maxY = Math.max(maxY, t.pertY + 160);
  });

  const nodesHtml = proj.tasks.map((t, idx) => {
    const slack = (ls[t.id] || 0) - (es[t.id] || 0);
    const isCrit = slack <= 0;
    return `
      <div class="pert-node ${isCrit ? 'pert-critical' : ''}"
           style="left:${t.pertX}px; top:${t.pertY}px"
           onmousedown="startPertDrag(event, '${t.id}')"
           ondblclick="openTaskModal('${t.id}')">
        <div class="pert-node-hdr">
          <span>#${idx + 1} ${escapeHtml(t.owner || '')}</span>
          <span>${isCrit ? 'CRITICAL' : 'Slack: ' + slack + 'd'}</span>
        </div>
        <div class="pert-node-title">${escapeHtml(t.title)}</div>
        <div class="pert-node-meta">
          <span>⏱ ${t.days}d</span>
          <span>${formatShortDM(t.start)} - ${formatShortDM(t.end)}</span>
        </div>
      </div>
    `;
  }).join('');

  const edgesHtml = proj.tasks.map(t => {
    if (!t.dependsOn) return '';
    const pred = proj.tasks.find(x => x.id === t.dependsOn);
    if (!pred) return '';
    const x1 = pred.pertX + 210;
    const y1 = pred.pertY + 46;
    const x2 = t.pertX;
    const y2 = t.pertY + 46;
    const isCrit = ((ls[t.id] - es[t.id]) <= 0) && ((ls[pred.id] - es[pred.id]) <= 0);
    const stroke = isCrit ? '#dc2626' : '#64748b';
    const marker = isCrit ? 'url(#pertArrowCrit)' : 'url(#pertArrow)';
    return `<path d="M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="${isCrit ? 2.2 : 1.5}" marker-end="${marker}" />`;
  }).join('');

  canvas.innerHTML = `
    <div class="pert-stage" style="width:${maxX}px; height:${maxY}px">
      <svg class="pert-svg" width="${maxX}" height="${maxY}">
        <defs>
          <marker id="pertArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <polygon points="0 0, 8 4, 0 8" fill="#64748b" />
          </marker>
          <marker id="pertArrowCrit" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <polygon points="0 0, 8 4, 0 8" fill="#dc2626" />
          </marker>
        </defs>
        ${edgesHtml}
      </svg>
      ${nodesHtml}
    </div>
  `;
}

function startPertDrag(e, taskId) {
  e.preventDefault();
  const proj = getActiveProject();
  if (!proj) return;
  const t = proj.tasks.find(x => x.id === taskId);
  if (!t) return;
  pertDragState = {
    taskId,
    startX: e.clientX,
    startY: e.clientY,
    origX: t.pertX,
    origY: t.pertY
  };
}
window.startPertDrag = startPertDrag;

/* ================= GLOBAL MOUSE HANDLERS ================= */
function handleGlobalMouseMove(e) {
  if (resizingCol) {
    const delta = e.clientX - resizeStartX;
    colWidths[resizingCol] = Math.max(45, resizeStartW + delta);
    const proj = getActiveProject();
    if (proj && currentView === 'gantt') renderGantt(proj);
    return;
  }

  if (barDragState) {
    const proj = getActiveProject();
    if (!proj) return;
    const t = proj.tasks[barDragState.idx];
    if (!t) return;
    const deltaDays = Math.round((e.clientX - barDragState.startX) / barDragState.pxPerDay);
    if (barDragState.mode === 'move') {
      t.formula = '';
      t.start = formatDMY(addDays(barDragState.origStart, deltaDays));
      t.end = formatDMY(addDays(barDragState.origEnd, deltaDays));
    } else if (barDragState.mode === 'left') {
      t.formula = '';
      let ns = addDays(barDragState.origStart, deltaDays);
      if (ns > barDragState.origEnd) ns = barDragState.origEnd;
      t.start = formatDMY(ns);
      t.days = diffDaysInclusive(t.start, t.end);
    } else if (barDragState.mode === 'right') {
      let ne = addDays(barDragState.origEnd, deltaDays);
      if (ne < barDragState.origStart) ne = barDragState.origStart;
      t.end = formatDMY(ne);
      t.days = diffDaysInclusive(t.start, t.end);
    }
    recalculateFormulas(proj);
    renderGantt(proj);
    return;
  }

  if (pertDragState) {
    const proj = getActiveProject();
    if (!proj) return;
    const t = proj.tasks.find(x => x.id === pertDragState.taskId);
    if (!t) return;
    t.pertX = Math.max(10, pertDragState.origX + (e.clientX - pertDragState.startX));
    t.pertY = Math.max(10, pertDragState.origY + (e.clientY - pertDragState.startY));
    renderPert(proj);
  }
}

function handleGlobalMouseUp() {
  if (resizingCol) {
    resizingCol = null;
    saveWidths();
  }
  if (barDragState) {
    barDragState = null;
    saveState();
  }
  if (pertDragState) {
    pertDragState = null;
    saveState();
  }
}

/* ================= EXPORT / IMPORT ================= */
function exportJSON() {
  const blob = new Blob([JSON.stringify(projects, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kanban_gantt_pert_backup.json';
  a.click();
}
window.exportJSON = exportJSON;

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const imported = JSON.parse(evt.target.result);
      if (Array.isArray(imported)) {
        projects = imported;
        saveState();
        showDashboard();
        alert('Projects imported successfully!');
      } else {
        alert('Invalid JSON backup file.');
      }
    } catch (err) {
      alert('Failed to parse JSON file.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}
window.importJSON = importJSON;

function exportCSV() {
  const proj = getActiveProject();
  if (!proj) return;
  const headers = ['Row', 'Task Name', 'Category', 'Owner', 'Status', 'Start Date', 'End Date', 'Days', 'Formula', 'Depends On'];
  const rows = proj.tasks.map((t, idx) => {
    const predIdx = proj.tasks.findIndex(x => x.id === t.dependsOn);
    const depLabel = predIdx !== -1 ? `#${predIdx + 1} ${proj.tasks[predIdx].title}` : '';
    return [
      idx + 1,
      `"${(t.title || '').replace(/"/g, '""')}"`,
      `"${(t.category || '').replace(/"/g, '""')}"`,
      `"${(t.owner || '').replace(/"/g, '""')}"`,
      `"${(t.status || '').replace(/"/g, '""')}"`,
      t.start,
      t.end,
      t.days,
      `"${(t.formula || '').replace(/"/g, '""')}"`,
      `"${depLabel.replace(/"/g, '""')}"`
    ].join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${proj.name.replace(/[^a-z0-9]/gi, '_')}_schedule.csv`;
  a.click();
}
window.exportCSV = exportCSV;

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
