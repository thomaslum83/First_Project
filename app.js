const STORAGE_KEY = 'pk_tracker_projects_v15';
const WIDTHS_KEY = 'pk_tracker_col_widths_v15';

let projects = [];
let activeProjectId = null;
let activeView = 'kanban';
let ganttScale = 'week';
let ganttZoom = 44;
let colWidths = { num: 54, task: 240, owner: 110, start: 105, end: 105, days: 68, deps: 95 };
let dragRowIdx = null;
let pertDragging = null;

function $(ids) {
  if (!Array.isArray(ids)) ids = [ids];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) projects = parsed;
    }
  } catch (e) {
    console.warn('Resetting invalid project storage', e);
    projects = [];
  }
  try {
    const wRaw = localStorage.getItem(WIDTHS_KEY);
    if (wRaw) colWidths = Object.assign(colWidths, JSON.parse(wRaw));
  } catch (e) {}
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch (e) {
    console.error('Failed to save projects', e);
  }
}

function saveWidths() {
  try {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify(colWidths));
  } catch (e) {}
}

function getActiveProject() {
  return projects.find(p => p.id === activeProjectId) || null;
}

function showDashboard() {
  activeProjectId = null;
  const dash = $(['dashboardView', 'projectDashboardView']);
  const work = $(['workspaceView', 'projectWorkspaceView']);
  if (dash) {
    dash.classList.remove('hidden');
    dash.style.display = '';
  }
  if (work) {
    work.classList.add('hidden');
    work.style.display = 'none';
  }
  renderDashboard();
}

function showWorkspace(projectId) {
  if (projectId) activeProjectId = projectId;
  const proj = getActiveProject();
  if (!proj) return showDashboard();

  const dash = $(['dashboardView', 'projectDashboardView']);
  const work = $(['workspaceView', 'projectWorkspaceView']);
  if (dash) {
    dash.classList.add('hidden');
    dash.style.display = 'none';
  }
  if (work) {
    work.classList.remove('hidden');
    work.style.display = '';
  }

  const titleEl = $(['workspaceProjectTitle', 'activeProjectTitle', 'projectTitleDisplay']);
  const descEl = $(['workspaceProjectDesc', 'activeProjectDesc', 'projectDescDisplay']);
  if (titleEl) titleEl.textContent = proj.name;
  if (descEl) descEl.textContent = proj.description || '';

  recalculateProjectDates(proj);
  switchView(activeView);
}

window.showDashboard = showDashboard;
window.openProject = showWorkspace;

window.openProjectModal = function () {
  const modal = $(['projectModal', 'newProjectModal']);
  if (!modal) return;
  const nameIn = $(['projNameInput', 'projectNameInput']) || modal.querySelector('input[type="text"], input:not([type])');
  const descIn = $(['projDescInput', 'projectDescInput']) || modal.querySelector('textarea');
  if (nameIn) nameIn.value = '';
  if (descIn) descIn.value = '';
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  if (nameIn) setTimeout(() => nameIn.focus(), 30);
};

window.closeProjectModal = function () {
  const modal = $(['projectModal', 'newProjectModal']);
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
};

window.createNewProject = function (e) {
  if (e && e.preventDefault) e.preventDefault();
  const modal = $(['projectModal', 'newProjectModal']);
  const nameIn = $(['projNameInput', 'projectNameInput']) || (modal ? modal.querySelector('input[type="text"], input:not([type])') : null);
  const descIn = $(['projDescInput', 'projectDescInput']) || (modal ? modal.querySelector('textarea') : null);

  const name = nameIn ? nameIn.value.trim() : '';
  const description = descIn ? descIn.value.trim() : '';

  if (!name) {
    alert('Please enter a project name.');
    if (nameIn) nameIn.focus();
    return false;
  }

  const newProj = {
    id: 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name,
    description,
    createdAt: new Date().toISOString(),
    tasks: []
  };

  projects.push(newProj);
  saveState();
  window.closeProjectModal();
  renderDashboard();
  showWorkspace(newProj.id);
  return false;
};

window.handleCreateProject = window.createNewProject;
window.createProjectFromModal = window.createNewProject;

window.deleteProject = function (id, ev) {
  if (ev) ev.stopPropagation();
  if (!confirm('Delete this project and all its tasks?')) return;
  projects = projects.filter(p => p.id !== id);
  saveState();
  if (activeProjectId === id) showDashboard();
  else renderDashboard();
};

function renderDashboard() {
  const grid = $(['projectGrid', 'projectsGrid', 'projectList']);
  if (!grid) return;

  if (!projects.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;text-align:center;padding:48px 24px;border:2px dashed #cbd5e1;border-radius:12px;color:#64748b;">
        <p style="font-size:15px;margin:0 0 12px;">No projects yet. Click <strong>+ New Project</strong> at the top right to create your first workspace, or import a JSON backup.</p>
        <button type="button" class="btn btn-primary" onclick="openProjectModal()">+ New Project</button>
      </div>`;
    return;
  }

  grid.innerHTML = projects.map(p => {
    const total = (p.tasks || []).length;
    const done = (p.tasks || []).filter(t => t.status === 'done').length;
    return `
      <div class="project-card" onclick="openProject('${p.id}')" style="cursor:pointer;">
        <div class="project-card-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <h3 style="margin:0;font-size:17px;">${escapeHtml(p.name)}</h3>
          <button type="button" class="btn-icon" title="Delete Project" onclick="deleteProject('${p.id}', event)">🗑️</button>
        </div>
        <p style="color:#64748b;font-size:13px;margin:8px 0 14px;">${escapeHtml(p.description || 'No description')}</p>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:#475569;border-top:1px solid #e2e8f0;padding-top:10px;">
          <span>${total} task${total === 1 ? '' : 's'}</span>
          <span>${done}/${total} completed</span>
        </div>
      </div>`;
  }).join('');
}

function parseDMY(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
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
  if (!(dt instanceof Date) || isNaN(dt)) return '';
  return `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`;
}

function formatDDMM(dt) {
  if (!(dt instanceof Date) || isNaN(dt)) return '';
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

function diffDaysInclusive(start, end) {
  const ms = 86400000;
  return Math.max(1, Math.round((end - start) / ms) + 1);
}

function todayZero() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function parseFormula(formulaStr) {
  if (!formulaStr) return null;
  const m = String(formulaStr).trim().match(/^=\s*(\d+)\s*([+-]\s*\d+)?$/);
  if (!m) return null;
  const rowNum = parseInt(m[1], 10);
  const offset = m[2] ? parseInt(m[2].replace(/\s+/g, ''), 10) : 0;
  return { rowNum, offset };
}

function recalculateProjectDates(proj) {
  if (!proj || !Array.isArray(proj.tasks)) return;
  const tasks = proj.tasks;
  for (let pass = 0; pass < tasks.length + 1; pass++) {
    let changed = false;
    tasks.forEach((t, idx) => {
      const f = parseFormula(t.startFormula);
      if (f && f.rowNum >= 1 && f.rowNum <= tasks.length && f.rowNum !== idx + 1) {
        const pred = tasks[f.rowNum - 1];
        const predEnd = parseDMY(pred.endDate);
        if (predEnd) {
          const newStart = addDays(predEnd, f.offset);
          const dur = Math.max(1, parseInt(t.days, 10) || 1);
          const newEnd = addDays(newStart, dur - 1);
          const sStr = formatDMY(newStart);
          const eStr = formatDMY(newEnd);
          if (t.startDate !== sStr || t.endDate !== eStr) {
            t.startDate = sStr;
            t.endDate = eStr;
            changed = true;
          }
          if (!Array.isArray(t.dependencies)) t.dependencies = [];
          if (!t.dependencies.includes(pred.id)) t.dependencies.push(pred.id);
        }
      } else {
        const s = parseDMY(t.startDate);
        const dur = Math.max(1, parseInt(t.days, 10) || 1);
        if (s) {
          const eStr = formatDMY(addDays(s, dur - 1));
          if (t.endDate !== eStr) {
            t.endDate = eStr;
            changed = true;
          }
        }
      }
    });
    if (!changed) break;
  }
}

function getTaskVisualState(task) {
  const today = todayZero();
  const end = parseDMY(task.endDate);
  if (task.status === 'done') {
    return { color: '#16a34a', bg: '#dcfce7', border: '#86efac', badge: 'Done', urgent: null };
  }
  if (end) {
    const daysLeft = Math.round((end - today) / 86400000);
    if (daysLeft < 0) {
      return { color: '#dc2626', bg: '#fee2e2', border: '#fca5a5', badge: 'Overdue', urgent: 'overdue' };
    }
    if (daysLeft <= 7) {
      return { color: '#ca8a04', bg: '#fef9c3', border: '#fde047', badge: 'Due Soon', urgent: 'warning' };
    }
  }
  if (task.status === 'inprogress') {
    return { color: '#2563eb', bg: '#dbeafe', border: '#93c5fd', badge: 'In Progress', urgent: null };
  }
  return { color: '#64748b', bg: '#f1f5f9', border: '#cbd5e1', badge: 'To Do', urgent: null };
}

window.switchView = function (view) {
  activeView = view;
  ['kanban', 'gantt', 'pert'].forEach(v => {
    const sec = $([v + 'View', v + 'Section']);
    const tab = $([v + 'TabBtn', 'tab-' + v]);
    if (sec) {
      sec.classList.toggle('hidden', v !== view);
      sec.style.display = v === view ? '' : 'none';
    }
    if (tab) tab.classList.toggle('active', v === view);
  });

  if (view === 'kanban') renderKanban();
  else if (view === 'gantt') renderGantt();
  else if (view === 'pert') renderPert();
};

window.openTaskModal = function (taskId) {
  const proj = getActiveProject();
  if (!proj) return;
  const modal = $(['taskModal', 'editTaskModal']);
  if (!modal) return;

  const task = taskId ? proj.tasks.find(t => t.id === taskId) : null;
  const idIn = $(['editTaskId', 'taskIdInput']);
  const titleIn = $(['taskTitleInput', 'editTaskTitle']);
  const catIn = $(['taskCategoryInput', 'editTaskCategory']);
  const ownerIn = $(['taskOwnerInput', 'editTaskOwner']);
  const statusIn = $(['taskStatusInput', 'editTaskStatus']);
  const startIn = $(['taskStartInput', 'editTaskStart']);
  const endIn = $(['taskEndInput', 'editTaskEnd']);
  const depsSel = $(['taskDepsSelect', 'editTaskDeps']);

  const todayStr = formatDMY(todayZero());
  if (idIn) idIn.value = task ? task.id : '';
  if (titleIn) titleIn.value = task ? task.title : '';
  if (catIn) catIn.value = task ? (task.category || '') : '';
  if (ownerIn) ownerIn.value = task ? (task.owner || '') : '';
  if (statusIn) statusIn.value = task ? (task.status || 'todo') : 'todo';
  if (startIn) startIn.value = task ? (task.startFormula || task.startDate || todayStr) : todayStr;
  if (endIn) endIn.value = task ? (task.endDate || todayStr) : formatDMY(addDays(todayZero(), 4));

  if (depsSel) {
    depsSel.innerHTML = proj.tasks
      .filter(t => !task || t.id !== task.id)
      .map((t, i) => {
        const selected = task && Array.isArray(task.dependencies) && task.dependencies.includes(t.id) ? 'selected' : '';
        return `<option value="${t.id}" ${selected}>#${proj.tasks.indexOf(t) + 1} - ${escapeHtml(t.title)}</option>`;
      }).join('');
  }

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  if (titleIn) setTimeout(() => titleIn.focus(), 30);
};

window.closeTaskModal = function () {
  const modal = $(['taskModal', 'editTaskModal']);
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
};

window.saveTaskFromModal = function (e) {
  if (e && e.preventDefault) e.preventDefault();
  const proj = getActiveProject();
  if (!proj) return false;

  const idIn = $(['editTaskId', 'taskIdInput']);
  const titleIn = $(['taskTitleInput', 'editTaskTitle']);
  const catIn = $(['taskCategoryInput', 'editTaskCategory']);
  const ownerIn = $(['taskOwnerInput', 'editTaskOwner']);
  const statusIn = $(['taskStatusInput', 'editTaskStatus']);
  const startIn = $(['taskStartInput', 'editTaskStart']);
  const endIn = $(['taskEndInput', 'editTaskEnd']);
  const depsSel = $(['taskDepsSelect', 'editTaskDeps']);

  const title = titleIn ? titleIn.value.trim() : '';
  if (!title) {
    alert('Please enter a task title.');
    return false;
  }

  const rawStart = startIn ? startIn.value.trim() : '';
  const rawEnd = endIn ? endIn.value.trim() : '';
  const formula = parseFormula(rawStart);
  let startDate = formatDMY(todayZero());
  let endDate = formatDMY(addDays(todayZero(), 4));
  let days = 5;

  if (formula) {
    const eDt = parseDMY(rawEnd);
    days = eDt ? 5 : 5;
  } else {
    const sDt = parseDMY(rawStart) || todayZero();
    const eDt = parseDMY(rawEnd);
    startDate = formatDMY(sDt);
    if (eDt && eDt >= sDt) {
      endDate = formatDMY(eDt);
      days = diffDaysInclusive(sDt, eDt);
    } else {
      endDate = formatDMY(addDays(sDt, days - 1));
    }
  }

  const deps = depsSel ? Array.from(depsSel.selectedOptions).map(o => o.value) : [];
  const existingId = idIn ? idIn.value : '';

  if (existingId) {
    const task = proj.tasks.find(t => t.id === existingId);
    if (task) {
      task.title = title;
      task.category = catIn ? catIn.value.trim() : '';
      task.owner = ownerIn ? ownerIn.value.trim() : '';
      task.status = statusIn ? statusIn.value : 'todo';
      task.startFormula = formula ? rawStart : '';
      if (!formula) {
        task.startDate = startDate;
        task.endDate = endDate;
        task.days = days;
      }
      task.dependencies = deps;
    }
  } else {
    proj.tasks.push({
      id: 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title,
      category: catIn ? catIn.value.trim() : '',
      owner: ownerIn ? ownerIn.value.trim() : '',
      status: statusIn ? statusIn.value : 'todo',
      startFormula: formula ? rawStart : '',
      startDate,
      endDate,
      days,
      dependencies: deps
    });
  }

  recalculateProjectDates(proj);
  saveState();
  window.closeTaskModal();
  switchView(activeView);
  return false;
};

window.deleteTask = function (taskId, ev) {
  if (ev) ev.stopPropagation();
  const proj = getActiveProject();
  if (!proj) return;
  const idx = proj.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return;
  proj.tasks.splice(idx, 1);
  proj.tasks.forEach(t => {
    if (Array.isArray(t.dependencies)) {
      t.dependencies = t.dependencies.filter(d => d !== taskId);
    }
  });
  recalculateProjectDates(proj);
  saveState();
  switchView(activeView);
};

function renderKanban() {
  const board = $(['kanbanBoard', 'kanbanColumns']);
  const proj = getActiveProject();
  if (!board || !proj) return;

  const cols = [
    { key: 'warning', title: '⚠️ Past Deadline / Warning', items: [] },
    { key: 'todo', title: 'To Do', items: [] },
    { key: 'inprogress', title: 'In Progress', items: [] },
    { key: 'done', title: 'Done', items: [] }
  ];

  proj.tasks.forEach(t => {
    const st = getTaskVisualState(t);
    if (st.urgent) cols[0].items.push(t);
    const target = cols.find(c => c.key === (t.status || 'todo'));
    if (target) target.items.push(t);
  });

  board.innerHTML = cols.map(col => `
    <div class="kanban-col" data-status="${col.key}"
         ondragover="event.preventDefault()"
         ondrop="onKanbanDrop(event, '${col.key}')">
      <div class="kanban-col-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <strong>${col.title}</strong>
        <span class="badge">${col.items.length}</span>
      </div>
      <div class="kanban-cards" style="display:flex;flex-direction:column;gap:10px;min-height:120px;">
        ${col.items.map(t => {
          const st = getTaskVisualState(t);
          return `
            <div class="kanban-card" draggable="true"
                 ondragstart="event.dataTransfer.setData('text/plain', '${t.id}')"
                 onclick="openTaskModal('${t.id}')"
                 style="border-left:4px solid ${st.color};background:#fff;padding:10px 12px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);cursor:pointer;">
              <div style="display:flex;justify-content:space-between;gap:6px;align-items:flex-start;">
                <strong style="font-size:14px;">${escapeHtml(t.title)}</strong>
                <button type="button" class="btn-icon" onclick="deleteTask('${t.id}', event)">✕</button>
              </div>
              <div style="font-size:12px;color:#64748b;margin-top:4px;">
                ${t.owner ? '👤 ' + escapeHtml(t.owner) + ' • ' : ''}${t.startDate} → ${t.endDate} (${t.days}d)
              </div>
              <div style="margin-top:6px;">
                <span style="font-size:11px;padding:2px 7px;border-radius:99px;background:${st.bg};color:${st.color};font-weight:600;">${st.badge}</span>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

window.onKanbanDrop = function (ev, status) {
  ev.preventDefault();
  if (status === 'warning') return;
  const proj = getActiveProject();
  if (!proj) return;
  const taskId = ev.dataTransfer.getData('text/plain');
  const task = proj.tasks.find(t => t.id === taskId);
  if (task) {
    task.status = status;
    saveState();
    renderKanban();
  }
};

window.setGanttScale = function (scale) {
  ganttScale = scale;
  ganttZoom = scale === 'day' ? 32 : 48;
  renderGantt();
};

window.zoomGantt = function (delta) {
  ganttZoom = Math.max(20, Math.min(120, ganttZoom + delta));
  renderGantt();
};

window.sortGanttByStartDate = function () {
  const proj = getActiveProject();
  if (!proj) return;
  const oldIndexMap = new Map(proj.tasks.map((t, idx) => [t.id, idx + 1]));
  proj.tasks.sort((a, b) => {
    const da = parseDMY(a.startDate) || new Date(8640000000000000);
    const db = parseDMY(b.startDate) || new Date(8640000000000000);
    if (da - db !== 0) return da - db;
    const ea = parseDMY(a.endDate) || da;
    const eb = parseDMY(b.endDate) || db;
    return ea - eb;
  });
  rewriteFormulasAfterReorder(proj, oldIndexMap);
  recalculateProjectDates(proj);
  saveState();
  renderGantt();
};

function rewriteFormulasAfterReorder(proj, oldIndexMap) {
  const idByOldRow = new Map();
  oldIndexMap.forEach((oldRow, id) => idByOldRow.set(oldRow, id));
  const newIndexMap = new Map(proj.tasks.map((t, idx) => [t.id, idx + 1]));

  proj.tasks.forEach(t => {
    const f = parseFormula(t.startFormula);
    if (f) {
      const targetId = idByOldRow.get(f.rowNum);
      const newRow = targetId ? newIndexMap.get(targetId) : null;
      if (newRow) {
        const sign = f.offset >= 0 ? '+' : '';
        t.startFormula = `=${newRow}${f.offset !== 0 ? sign + f.offset : ''}`;
      }
    }
  });
}

window.moveTaskRow = function (idx, dir) {
  const proj = getActiveProject();
  if (!proj) return;
  const target = idx + dir;
  if (target < 0 || target >= proj.tasks.length) return;
  const oldIndexMap = new Map(proj.tasks.map((t, i) => [t.id, i + 1]));
  const [moved] = proj.tasks.splice(idx, 1);
  proj.tasks.splice(target, 0, moved);
  rewriteFormulasAfterReorder(proj, oldIndexMap);
  recalculateProjectDates(proj);
  saveState();
  renderGantt();
};

function renderGantt() {
  const container = $(['ganttContainer', 'ganttWrapper']);
  const proj = getActiveProject();
  if (!container || !proj) return;

  recalculateProjectDates(proj);

  if (!proj.tasks.length) {
    container.innerHTML = `<div style="padding:36px;text-align:center;color:#64748b;">No tasks in this project yet. Click <strong>+ Add Task</strong> to begin scheduling.</div>`;
    return;
  }

  let minDate = null;
  let maxDate = null;
  proj.tasks.forEach(t => {
    const s = parseDMY(t.startDate);
    const e = parseDMY(t.endDate);
    if (s && (!minDate || s < minDate)) minDate = s;
    if (e && (!maxDate || e > maxDate)) maxDate = e;
  });
  if (!minDate) minDate = todayZero();
  if (!maxDate) maxDate = addDays(minDate, 14);
  minDate = addDays(minDate, -3);
  maxDate = addDays(maxDate, 7);

  const totalDays = Math.max(14, diffDaysInclusive(minDate, maxDate));
  const pxPerDay = ganttScale === 'day' ? ganttZoom : ganttZoom / 7;
  const timelineWidth = Math.ceil(totalDays * pxPerDay);
  const rowHeight = 44;

  let headerCells = '';
  if (ganttScale === 'day') {
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(minDate, i);
      const isWknd = d.getDay() === 0 || d.getDay() === 6;
      headerCells += `<div style="width:${pxPerDay}px;flex-shrink:0;text-align:center;font-size:11px;border-right:1px solid #e2e8f0;background:${isWknd ? '#f1f5f9' : '#f8fafc'};line-height:38px;">${d.getDate()}/${d.getMonth() + 1}</div>`;
    }
  } else {
    for (let i = 0; i < totalDays; i += 7) {
      const d = addDays(minDate, i);
      const wWidth = Math.min(7, totalDays - i) * pxPerDay;
      headerCells += `<div style="width:${wWidth}px;flex-shrink:0;text-align:center;font-size:11px;border-right:1px solid #e2e8f0;background:#f8fafc;line-height:38px;">${formatDDMM(d)}</div>`;
    }
  }

  const tableRows = proj.tasks.map((t, idx) => {
    const depsLabels = (t.dependencies || [])
      .map(id => proj.tasks.findIndex(x => x.id === id))
      .filter(i => i >= 0)
      .map(i => '#' + (i + 1))
      .join(', ');

    return `
      <tr style="height:${rowHeight}px;border-bottom:1px solid #e2e8f0;"
          draggable="true"
          ondragstart="dragRowIdx=${idx}"
          ondragover="event.preventDefault()"
          ondrop="onGanttRowDrop(event, ${idx})">
        <td style="width:${colWidths.num}px;text-align:center;font-size:12px;color:#475569;cursor:grab;user-select:none;">
          ⋮⋮ ${idx + 1}
          <button type="button" onclick="moveTaskRow(${idx},-1)" style="border:none;background:none;cursor:pointer;padding:0 2px;">▲</button>
          <button type="button" onclick="moveTaskRow(${idx},1)" style="border:none;background:none;cursor:pointer;padding:0 2px;">▼</button>
        </td>
        <td style="width:${colWidths.task}px;padding:0 6px;">
          <input type="text" value="${escapeHtml(t.title)}" onchange="updateGanttCell(${idx}, 'title', this.value)" style="width:100%;border:1px solid transparent;background:transparent;font-size:13px;" />
        </td>
        <td style="width:${colWidths.owner}px;padding:0 6px;">
          <input type="text" value="${escapeHtml(t.owner || '')}" onchange="updateGanttCell(${idx}, 'owner', this.value)" style="width:100%;border:1px solid transparent;background:transparent;font-size:12px;" />
        </td>
        <td style="width:${colWidths.start}px;padding:0 6px;">
          <input type="text" value="${escapeHtml(t.startFormula || t.startDate)}" title="D/M/YYYY or =Row+Days (e.g. =1+3)" onchange="updateGanttCell(${idx}, 'start', this.value)" style="width:100%;border:1px solid #e2e8f0;border-radius:4px;padding:2px 4px;font-size:12px;" />
        </td>
        <td style="width:${colWidths.end}px;padding:0 6px;">
          <input type="text" value="${escapeHtml(t.endDate)}" onchange="updateGanttCell(${idx}, 'end', this.value)" style="width:100%;border:1px solid #e2e8f0;border-radius:4px;padding:2px 4px;font-size:12px;" />
        </td>
        <td style="width:${colWidths.days}px;padding:0 6px;">
          <input type="number" min="1" value="${t.days}" onchange="updateGanttCell(${idx}, 'days', this.value)" style="width:100%;border:1px solid #e2e8f0;border-radius:4px;padding:2px 4px;font-size:12px;text-align:center;" />
        </td>
        <td style="width:${colWidths.deps}px;padding:0 6px;font-size:12px;color:#475569;cursor:pointer;" onclick="openTaskModal('${t.id}')">
          ${depsLabels || '—'}
        </td>
      </tr>`;
  }).join('');

  const barCoords = new Map();
  const barsHtml = proj.tasks.map((t, idx) => {
    const s = parseDMY(t.startDate) || minDate;
    const e = parseDMY(t.endDate) || s;
    const left = Math.round((s - minDate) / 86400000 * pxPerDay);
    const width = Math.max(28, Math.round(diffDaysInclusive(s, e) * pxPerDay));
    const top = idx * rowHeight + 6;
    const height = rowHeight - 12;
    barCoords.set(t.id, { left, right: left + width, midY: idx * rowHeight + rowHeight / 2 });
    const st = getTaskVisualState(t);

    return `
      <div class="gantt-bar" data-idx="${idx}"
           onmousedown="startBarDrag(event, ${idx}, 'move')"
           style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;background:${st.color};color:#fff;border-radius:6px;display:flex;align-items:center;justify-content:space-between;padding:0 6px;font-size:10px;cursor:grab;box-shadow:0 1px 2px rgba(0,0,0,0.15);overflow:hidden;user-select:none;">
        <div onmousedown="startBarDrag(event, ${idx}, 'left')" style="position:absolute;left:0;top:0;bottom:0;width:6px;cursor:ew-resize;"></div>
        <span style="opacity:0.9;flex-shrink:0;">${formatDDMM(s)}</span>
        <span style="padding:0 4px;line-height:1.1;text-align:center;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:600;">${escapeHtml(t.title)}</span>
        <span style="opacity:0.9;flex-shrink:0;">${formatDDMM(e)}</span>
        <div onmousedown="startBarDrag(event, ${idx}, 'right')" style="position:absolute;right:0;top:0;bottom:0;width:6px;cursor:ew-resize;"></div>
      </div>`;
  }).join('');

  let arrowsSvg = '';
  proj.tasks.forEach(t => {
    const to = barCoords.get(t.id);
    if (!to || !Array.isArray(t.dependencies)) return;
    t.dependencies.forEach(depId => {
      const from = barCoords.get(depId);
      if (!from) return;
      const midX = from.right + 10;
      const d = `M ${from.right} ${from.midY} L ${midX} ${from.midY} L ${midX} ${to.midY} L ${to.left} ${to.midY}`;
      arrowsSvg += `<path d="${d}" fill="none" stroke="#ef4444" stroke-width="1.25" stroke-dasharray="4,3" marker-end="url(#ganttArrow)" />`;
    });
  });

  const totalHeight = proj.tasks.length * rowHeight;
  container.innerHTML = `
    <div style="display:flex;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;background:#fff;">
      <div style="overflow-x:auto;flex-shrink:0;max-width:58%;border-right:2px solid #cbd5e1;">
        <table style="border-collapse:collapse;table-layout:fixed;">
          <thead>
            <tr style="height:38px;background:#f8fafc;border-bottom:1px solid #cbd5e1;font-size:12px;">
              ${renderResizableTh('#', 'num')}
              ${renderResizableTh('Task / Description', 'task')}
              ${renderResizableTh('Owner', 'owner')}
              ${renderResizableTh('Start', 'start')}
              ${renderResizableTh('End', 'end')}
              ${renderResizableTh('Days', 'days')}
              ${renderResizableTh('Depends', 'deps')}
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      <div style="overflow-x:auto;flex:1;position:relative;">
        <div style="width:${timelineWidth}px;">
          <div style="display:flex;height:38px;border-bottom:1px solid #cbd5e1;">${headerCells}</div>
          <div style="position:relative;height:${totalHeight}px;background-image:linear-gradient(to bottom, transparent ${rowHeight - 1}px, #f1f5f9 ${rowHeight}px);background-size:100% ${rowHeight}px;">
            <svg width="${timelineWidth}" height="${totalHeight}" style="position:absolute;top:0;left:0;pointer-events:none;">
              <defs>
                <marker id="ganttArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#ef4444" />
                </marker>
              </defs>
              ${arrowsSvg}
            </svg>
            ${barsHtml}
          </div>
        </div>
      </div>
    </div>`;
}

function renderResizableTh(label, key) {
  return `<th style="width:${colWidths[key]}px;position:relative;padding:0 6px;text-align:left;border-right:1px solid #e2e8f0;user-select:none;">
    ${label}
    <div onmousedown="startColResize(event, '${key}')" style="position:absolute;right:0;top:0;bottom:0;width:5px;cursor:col-resize;"></div>
  </th>`;
}

window.startColResize = function (ev, key) {
  ev.preventDefault();
  const startX = ev.clientX;
  const startW = colWidths[key];
  function onMove(e) {
    colWidths[key] = Math.max(44, startW + (e.clientX - startX));
    renderGantt();
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    saveWidths();
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

window.onGanttRowDrop = function (ev, targetIdx) {
  ev.preventDefault();
  if (dragRowIdx === null || dragRowIdx === targetIdx) return;
  const proj = getActiveProject();
  if (!proj) return;
  const oldIndexMap = new Map(proj.tasks.map((t, i) => [t.id, i + 1]));
  const [moved] = proj.tasks.splice(dragRowIdx, 1);
  proj.tasks.splice(targetIdx, 0, moved);
  dragRowIdx = null;
  rewriteFormulasAfterReorder(proj, oldIndexMap);
  recalculateProjectDates(proj);
  saveState();
  renderGantt();
};

window.updateGanttCell = function (idx, field, val) {
  const proj = getActiveProject();
  if (!proj || !proj.tasks[idx]) return;
  const t = proj.tasks[idx];
  val = String(val).trim();

  if (field === 'title' && val) t.title = val;
  else if (field === 'owner') t.owner = val;
  else if (field === 'days') {
    const d = Math.max(1, parseInt(val, 10) || 1);
    t.days = d;
    const s = parseDMY(t.startDate);
    if (s) t.endDate = formatDMY(addDays(s, d - 1));
  } else if (field === 'start') {
    const f = parseFormula(val);
    if (f) {
      t.startFormula = val;
    } else {
      const s = parseDMY(val);
      if (s) {
        t.startFormula = '';
        t.startDate = formatDMY(s);
        t.endDate = formatDMY(addDays(s, (t.days || 1) - 1));
      }
    }
  } else if (field === 'end') {
    const e = parseDMY(val);
    const s = parseDMY(t.startDate);
    if (e && s && e >= s) {
      t.endDate = formatDMY(e);
      t.days = diffDaysInclusive(s, e);
    }
  }

  recalculateProjectDates(proj);
  saveState();
  renderGantt();
};

window.startBarDrag = function (ev, idx, mode) {
  ev.stopPropagation();
  ev.preventDefault();
  const proj = getActiveProject();
  if (!proj || !proj.tasks[idx]) return;
  const t = proj.tasks[idx];
  const origStart = parseDMY(t.startDate);
  const origEnd = parseDMY(t.endDate);
  if (!origStart || !origEnd) return;

  const pxPerDay = ganttScale === 'day' ? ganttZoom : ganttZoom / 7;
  const startX = ev.clientX;

  function onMove(e) {
    const deltaDays = Math.round((e.clientX - startX) / pxPerDay);
    if (mode === 'move') {
      t.startFormula = '';
      t.startDate = formatDMY(addDays(origStart, deltaDays));
      t.endDate = formatDMY(addDays(origEnd, deltaDays));
    } else if (mode === 'left') {
      t.startFormula = '';
      const ns = addDays(origStart, deltaDays);
      if (ns <= origEnd) {
        t.startDate = formatDMY(ns);
        t.days = diffDaysInclusive(ns, origEnd);
      }
    } else if (mode === 'right') {
      const ne = addDays(origEnd, deltaDays);
      if (ne >= origStart) {
        t.endDate = formatDMY(ne);
        t.days = diffDaysInclusive(origStart, ne);
      }
    }
    recalculateProjectDates(proj);
    renderGantt();
  }

  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    saveState();
  }

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

window.resetPertLayout = function () {
  const proj = getActiveProject();
  if (!proj) return;
  proj.tasks.forEach(t => { delete t.pertPos; });
  saveState();
  renderPert();
};

function renderPert() {
  const container = $(['pertContainer', 'pertCanvasWrapper']);
  const proj = getActiveProject();
  if (!container || !proj) return;

  if (!proj.tasks.length) {
    container.innerHTML = `<div style="padding:36px;text-align:center;color:#64748b;">Add tasks with dependencies in the Kanban or Gantt view to generate the PERT network diagram.</div>`;
    return;
  }

  const taskMap = new Map(proj.tasks.map(t => [t.id, t]));
  const es = new Map();
  const ef = new Map();
  const stage = new Map();

  for (let pass = 0; pass < proj.tasks.length + 1; pass++) {
    proj.tasks.forEach(t => {
      const deps = (t.dependencies || []).filter(id => taskMap.has(id));
      let maxPrevEf = 0;
      let maxPrevStage = -1;
      deps.forEach(dId => {
        maxPrevEf = Math.max(maxPrevEf, ef.get(dId) || 0);
        maxPrevStage = Math.max(maxPrevStage, stage.get(dId) ?? 0);
      });
      es.set(t.id, maxPrevEf);
      ef.set(t.id, maxPrevEf + (t.days || 1));
      stage.set(t.id, maxPrevStage + 1);
    });
  }

  let projectDuration = 0;
  ef.forEach(val => { projectDuration = Math.max(projectDuration, val); });

  const lf = new Map();
  const ls = new Map();
  proj.tasks.forEach(t => {
    lf.set(t.id, projectDuration);
    ls.set(t.id, projectDuration - (t.days || 1));
  });

  for (let pass = 0; pass < proj.tasks.length + 1; pass++) {
    proj.tasks.forEach(t => {
      const successors = proj.tasks.filter(s => (s.dependencies || []).includes(t.id));
      if (successors.length) {
        let minSuccLs = projectDuration;
        successors.forEach(s => {
          minSuccLs = Math.min(minSuccLs, ls.get(s.id) ?? projectDuration);
        });
        lf.set(t.id, minSuccLs);
        ls.set(t.id, minSuccLs - (t.days || 1));
      }
    });
  }

  const stageCounts = new Map();
  const nodeW = 200;
  const nodeH = 92;

  proj.tasks.forEach(t => {
    if (!t.pertPos) {
      const stg = stage.get(t.id) || 0;
      const row = stageCounts.get(stg) || 0;
      stageCounts.set(stg, row + 1);
      t.pertPos = { x: 40 + stg * 270, y: 40 + row * 130 };
    }
  });

  let maxW = 900;
  let maxH = 520;
  proj.tasks.forEach(t => {
    maxW = Math.max(maxW, t.pertPos.x + nodeW + 80);
    maxH = Math.max(maxH, t.pertPos.y + nodeH + 80);
  });

  let edgesSvg = '';
  proj.tasks.forEach(t => {
    const tCrit = ((ls.get(t.id) || 0) - (es.get(t.id) || 0)) <= 0;
    (t.dependencies || []).forEach(depId => {
      const pred = taskMap.get(depId);
      if (!pred) return;
      const pCrit = ((ls.get(pred.id) || 0) - (es.get(pred.id) || 0)) <= 0;
      const isCritEdge = tCrit && pCrit && (ef.get(pred.id) === es.get(t.id));
      const x1 = pred.pertPos.x + nodeW;
      const y1 = pred.pertPos.y + nodeH / 2;
      const x2 = t.pertPos.x;
      const y2 = t.pertPos.y + nodeH / 2;
      const cx = (x1 + x2) / 2;
      const color = isCritEdge ? '#dc2626' : '#64748b';
      const width = isCritEdge ? 2.2 : 1.3;
      edgesSvg += `<path d="M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}" marker-end="url(#${isCritEdge ? 'pertCritArrow' : 'pertArrow'})" />`;
    });
  });

  const nodesHtml = proj.tasks.map((t, idx) => {
    const slack = Math.max(0, (ls.get(t.id) || 0) - (es.get(t.id) || 0));
    const isCrit = slack === 0;
    return `
      <div onmousedown="startPertNodeDrag(event, '${t.id}')"
           style="position:absolute;left:${t.pertPos.x}px;top:${t.pertPos.y}px;width:${nodeW}px;height:${nodeH}px;background:#fff;border:2px solid ${isCrit ? '#dc2626' : '#94a3b8'};border-radius:8px;padding:8px 10px;box-shadow:0 2px 6px rgba(0,0,0,0.08);cursor:move;user-select:none;">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:${isCrit ? '#dc2626' : '#64748b'};font-weight:700;">
          <span>#${idx + 1} ${isCrit ? '• CRITICAL' : ''}</span>
          <span>${t.days}d • Slack ${slack}d</span>
        </div>
        <div style="font-size:13px;font-weight:600;margin:4px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.title)}</div>
        <div style="font-size:11px;color:#475569;">${t.startDate} → ${t.endDate}</div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div style="overflow:auto;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;position:relative;height:560px;">
      <div style="position:relative;width:${maxW}px;height:${maxH}px;">
        <svg width="${maxW}" height="${maxH}" style="position:absolute;top:0;left:0;pointer-events:none;">
          <defs>
            <marker id="pertArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 Z" fill="#64748b" />
            </marker>
            <marker id="pertCritArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 Z" fill="#dc2626" />
            </marker>
          </defs>
          ${edgesSvg}
        </svg>
        ${nodesHtml}
      </div>
    </div>`;
}

window.startPertNodeDrag = function (ev, taskId) {
  ev.preventDefault();
  const proj = getActiveProject();
  if (!proj) return;
  const task = proj.tasks.find(t => t.id === taskId);
  if (!task || !task.pertPos) return;
  const startX = ev.clientX;
  const startY = ev.clientY;
  const origX = task.pertPos.x;
  const origY = task.pertPos.y;

  function onMove(e) {
    task.pertPos.x = Math.max(10, origX + (e.clientX - startX));
    task.pertPos.y = Math.max(10, origY + (e.clientY - startY));
    renderPert();
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    saveState();
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

window.exportJSON = function () {
  const payload = JSON.stringify({ projects, colWidths }, null, 2);
  downloadBlob(payload, 'kanban_gantt_backup.json', 'application/json');
};

window.importJSON = function (ev) {
  const file = ev && ev.target && ev.target.files ? ev.target.files[0] : null;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      if (Array.isArray(data)) projects = data;
      else if (data && Array.isArray(data.projects)) projects = data.projects;
      if (data && data.colWidths) colWidths = Object.assign(colWidths, data.colWidths);
      saveState();
      saveWidths();
      showDashboard();
    } catch (err) {
      alert('Invalid JSON backup file.');
    }
  };
  reader.readAsText(file);
};

window.exportCSV = function () {
  const proj = getActiveProject();
  if (!proj) return;
  const rows = [['Row', 'Task Name', 'Category', 'Owner', 'Status', 'Start Date', 'End Date', 'Days', 'Formula', 'Depends On']];
  proj.tasks.forEach((t, idx) => {
    const deps = (t.dependencies || [])
      .map(id => proj.tasks.findIndex(x => x.id === id) + 1)
      .filter(n => n > 0)
      .join(';');
    rows.push([idx + 1, t.title, t.category || '', t.owner || '', t.status || 'todo', t.startDate, t.endDate, t.days, t.startFormula || '', deps]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadBlob(csv, `${proj.name.replace(/[^a-z0-9]/gi, '_')}_schedule.csv`, 'text/csv;charset=utf-8;');
};

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
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

document.addEventListener('DOMContentLoaded', function () {
  loadState();
  showDashboard();
});
