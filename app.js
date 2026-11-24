// ============================================================================
// Project Kanban, Gantt & PERT Tracker - app.js
// ============================================================================

const STORAGE_KEY = 'pkp_projects_v1';
const COL_WIDTHS_KEY = 'pkp_col_widths_v1';

let state = {
  projects: [],
  activeProjectId: null,
  activeView: 'kanban', // 'kanban' | 'gantt' | 'pert'
  ganttScale: 'weeks',  // 'weeks' | 'days'
  ganttZoom: 1,
  colWidths: {
    index: 64,
    title: 240,
    owner: 110,
    start: 110,
    end: 110,
    days: 70,
    dependsOn: 130
  },
  pertPositions: {}
};

// ============================================================================
// Date & Formula Utilities (D/M/YYYY & DD/MM)
// ============================================================================

function parseDMY(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split('/');
  if (parts.length !== 3) return null;
  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);
  if (isNaN(d) || isNaN(m) || isNaN(y) || y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDMY(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

function formatDDMM(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

function addDays(date, days) {
  const res = new Date(date.getTime());
  res.setDate(res.getDate() + days);
  res.setHours(0, 0, 0, 0);
  return res;
}

function diffDaysInclusive(start, end) {
  if (!start || !end) return 1;
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
  return Math.max(1, diff);
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getMonday(date) {
  const d = new Date(date.getTime());
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ============================================================================
// Storage & State Helpers
// ============================================================================

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        state.projects = parsed;
      }
    }
    const widthsRaw = localStorage.getItem(COL_WIDTHS_KEY);
    if (widthsRaw) {
      state.colWidths = { ...state.colWidths, ...JSON.parse(widthsRaw) };
    }
  } catch (e) {
    console.warn('Resetting corrupted storage:', e);
    state.projects = [];
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.projects));
    localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(state.colWidths));
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

function getActiveProject() {
  return state.projects.find(p => p.id === state.activeProjectId) || null;
}

function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ============================================================================
// Formula Evaluation & Cascading Dependencies
// ============================================================================

function recalculateProjectDates(project) {
  if (!project || !Array.isArray(project.tasks)) return;
  const tasks = project.tasks;
  const idToIndex = new Map();
  tasks.forEach((t, idx) => idToIndex.set(t.id, idx));

  // Multiple passes to cascade chained formulas (e.g., =1+3 -> =2+2)
  for (let pass = 0; pass < tasks.length + 1; pass++) {
    let changed = false;
    tasks.forEach((task, idx) => {
      if (task.startFormula && typeof task.startFormula === 'string' && task.startFormula.trim().startsWith('=')) {
        const match = task.startFormula.trim().match(/^=(\d+)\s*([+-]\s*\d+)?$/);
        if (match) {
          const refRow = parseInt(match[1], 10) - 1;
          const offset = match[2] ? parseInt(match[2].replace(/\s+/g, ''), 10) : 0;
          if (refRow >= 0 && refRow < tasks.length && refRow !== idx) {
            const pred = tasks[refRow];
            const predEnd = parseDMY(pred.end);
            if (predEnd) {
              const newStart = addDays(predEnd, offset);
              const duration = Math.max(1, parseInt(task.days, 10) || 1);
              const newEnd = addDays(newStart, duration - 1);
              const newStartStr = formatDMY(newStart);
              const newEndStr = formatDMY(newEnd);
              if (task.start !== newStartStr || task.end !== newEndStr || task.dependsOn !== pred.id) {
                task.start = newStartStr;
                task.end = newEndStr;
                task.dependsOn = pred.id;
                changed = true;
              }
            }
          }
        }
      } else {
        const s = parseDMY(task.start);
        const e = parseDMY(task.end);
        if (s && e) {
          const calcDays = diffDaysInclusive(s, e);
          if (task.days !== calcDays) {
            task.days = calcDays;
            changed = true;
          }
        }
      }
    });
    if (!changed) break;
  }
}

function rewriteFormulasOnReorder(tasks, oldOrderIds) {
  const newIndexMap = new Map();
  tasks.forEach((t, idx) => newIndexMap.set(t.id, idx + 1));

  tasks.forEach(task => {
    if (task.startFormula && task.startFormula.trim().startsWith('=')) {
      const match = task.startFormula.trim().match(/^=(\d+)\s*([+-]\s*\d+)?$/);
      if (match) {
        const oldRowOneBased = parseInt(match[1], 10);
        const offsetPart = match[2] ? match[2].replace(/\s+/g, '') : '';
        const referencedTaskId = oldOrderIds[oldRowOneBased - 1];
        if (referencedTaskId && newIndexMap.has(referencedTaskId)) {
          const updatedRow = newIndexMap.get(referencedTaskId);
          task.startFormula = `=${updatedRow}${offsetPart}`;
        }
      }
    }
  });
}

// ============================================================================
// Status & Deadline Color Classification
// ============================================================================

function getTaskColorInfo(task) {
  const status = task.status || 'Pending';
  if (status === 'Completed') {
    return { colorClass: 'status-completed', badgeText: 'Completed', isUrgent: false, urgencyType: null };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = parseDMY(task.end);

  if (endDate) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysRemaining = Math.round((endDate.getTime() - today.getTime()) / msPerDay);
    if (daysRemaining < 0) {
      return { colorClass: 'status-overdue', badgeText: `Overdue (${Math.abs(daysRemaining)}d)`, isUrgent: true, urgencyType: 'overdue' };
    }
    if (daysRemaining <= 7) {
      return { colorClass: 'status-warning', badgeText: `Due in ${daysRemaining}d`, isUrgent: true, urgencyType: 'warning' };
    }
  }

  if (status === 'In Progress') {
    return { colorClass: 'status-inprogress', badgeText: 'In Progress', isUrgent: false, urgencyType: null };
  }
  if (status === 'To Do') {
    return { colorClass: 'status-todo', badgeText: 'To Do', isUrgent: false, urgencyType: null };
  }
  return { colorClass: 'status-pending', badgeText: 'Pending', isUrgent: false, urgencyType: null };
}

// ============================================================================
// Global Modal & Navigation Handlers (Bound to Window for Inline & JS Calls)
// ============================================================================

window.openProjectModal = function () {
  const modal = document.getElementById('projectModal');
  const nameInput = document.getElementById('projectNameInput');
  const descInput = document.getElementById('projectDescInput');
  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    if (nameInput) setTimeout(() => nameInput.focus(), 50);
  }
};

window.closeProjectModal = function () {
  const modal = document.getElementById('projectModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
};

window.createProjectFromModal = function (e) {
  if (e) e.preventDefault();
  const nameInput = document.getElementById('projectNameInput');
  const descInput = document.getElementById('projectDescInput');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    alert('Please enter a project name.');
    if (nameInput) nameInput.focus();
    return;
  }
  const desc = descInput ? descInput.value.trim() : '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDefault = addDays(today, 4);

  const newProject = {
    id: generateId('proj'),
    name,
    description: desc,
    createdAt: formatDMY(today),
    tasks: [
      {
        id: generateId('task'),
        title: 'Project Kickoff & Planning',
        category: 'Planning',
        owner: 'Team Lead',
        status: 'To Do',
        start: formatDMY(today),
        end: formatDMY(endDefault),
        days: 5,
        dependsOn: '',
        startFormula: ''
      }
    ]
  };

  state.projects.push(newProject);
  saveState();
  window.closeProjectModal();
  window.openProject(newProject.id);
};

window.openProject = function (projectId) {
  state.activeProjectId = projectId;
  const dash = document.getElementById('dashboardView');
  const workspace = document.getElementById('workspaceView');
  if (dash) dash.classList.add('hidden');
  if (workspace) workspace.classList.remove('hidden');
  renderWorkspace();
};

window.showDashboard = function () {
  state.activeProjectId = null;
  const dash = document.getElementById('dashboardView');
  const workspace = document.getElementById('workspaceView');
  if (workspace) workspace.classList.add('hidden');
  if (dash) dash.classList.remove('hidden');
  renderDashboard();
};

window.deleteProject = function (projectId, event) {
  if (event) event.stopPropagation();
  if (!confirm('Delete this project and all its tasks?')) return;
  state.projects = state.projects.filter(p => p.id !== projectId);
  saveState();
  if (state.activeProjectId === projectId) {
    window.showDashboard();
  } else {
    renderDashboard();
  }
};

window.switchView = function (viewName) {
  state.activeView = viewName;
  renderWorkspace();
};

// ============================================================================
// Task Modal Handlers
// ============================================================================

window.openTaskModal = function (taskId = null) {
  const project = getActiveProject();
  if (!project) return;
  const modal = document.getElementById('taskModal');
  const modalTitle = document.getElementById('taskModalTitle');
  const idInput = document.getElementById('taskIdInput');
  const titleInput = document.getElementById('taskTitleInput');
  const catInput = document.getElementById('taskCategoryInput');
  const ownerInput = document.getElementById('taskOwnerInput');
  const statusInput = document.getElementById('taskStatusInput');
  const startInput = document.getElementById('taskStartInput');
  const endInput = document.getElementById('taskEndInput');
  const daysInput = document.getElementById('taskDaysInput');
  const depSelect = document.getElementById('taskDependsSelect');
  const deleteBtn = document.getElementById('deleteTaskBtn');

  if (depSelect) {
    depSelect.innerHTML = '<option value="">None</option>';
    project.tasks.forEach((t, i) => {
      if (t.id !== taskId) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `#${i + 1} - ${t.title}`;
        depSelect.appendChild(opt);
      }
    });
  }

  if (taskId) {
    const task = project.tasks.find(t => t.id === taskId);
    if (!task) return;
    if (modalTitle) modalTitle.textContent = 'Edit Task';
    if (idInput) idInput.value = task.id;
    if (titleInput) titleInput.value = task.title;
    if (catInput) catInput.value = task.category || '';
    if (ownerInput) ownerInput.value = task.owner || '';
    if (statusInput) statusInput.value = task.status || 'Pending';
    if (startInput) startInput.value = task.startFormula || task.start;
    if (endInput) endInput.value = task.end;
    if (daysInput) daysInput.value = task.days || 1;
    if (depSelect) depSelect.value = task.dependsOn || '';
    if (deleteBtn) deleteBtn.classList.remove('hidden');
  } else {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (modalTitle) modalTitle.textContent = 'Add New Task';
    if (idInput) idInput.value = '';
    if (titleInput) titleInput.value = '';
    if (catInput) catInput.value = 'General';
    if (ownerInput) ownerInput.value = '';
    if (statusInput) statusInput.value = 'Pending';
    if (startInput) startInput.value = formatDMY(today);
    if (endInput) endInput.value = formatDMY(addDays(today, 2));
    if (daysInput) daysInput.value = 3;
    if (depSelect) depSelect.value = '';
    if (deleteBtn) deleteBtn.classList.add('hidden');
  }

  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
};

window.closeTaskModal = function () {
  const modal = document.getElementById('taskModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
};

window.saveTaskFromModal = function (e) {
  if (e) e.preventDefault();
  const project = getActiveProject();
  if (!project) return;

  const taskId = document.getElementById('taskIdInput')?.value || '';
  const title = document.getElementById('taskTitleInput')?.value.trim() || '';
  if (!title) {
    alert('Task name is required.');
    return;
  }

  const category = document.getElementById('taskCategoryInput')?.value.trim() || 'General';
  const owner = document.getElementById('taskOwnerInput')?.value.trim() || '';
  const status = document.getElementById('taskStatusInput')?.value || 'Pending';
  const rawStart = document.getElementById('taskStartInput')?.value.trim() || '';
  const rawEnd = document.getElementById('taskEndInput')?.value.trim() || '';
  const rawDays = parseInt(document.getElementById('taskDaysInput')?.value, 10) || 1;
  const dependsOn = document.getElementById('taskDependsSelect')?.value || '';

  let startFormula = '';
  let startStr = rawStart;
  let endStr = rawEnd;
  let days = Math.max(1, rawDays);

  if (rawStart.startsWith('=')) {
    startFormula = rawStart;
    const today = new Date();
    startStr = formatDMY(today);
    endStr = formatDMY(addDays(today, days - 1));
  } else {
    const sDate = parseDMY(rawStart) || new Date();
    let eDate = parseDMY(rawEnd);
    if (!eDate || eDate < sDate) {
      eDate = addDays(sDate, days - 1);
    } else {
      days = diffDaysInclusive(sDate, eDate);
    }
    startStr = formatDMY(sDate);
    endStr = formatDMY(eDate);
  }

  if (taskId) {
    const existing = project.tasks.find(t => t.id === taskId);
    if (existing) {
      Object.assign(existing, {
        title, category, owner, status,
        start: startStr, end: endStr, days, dependsOn, startFormula
      });
    }
  } else {
    project.tasks.push({
      id: generateId('task'),
      title, category, owner, status,
      start: startStr, end: endStr, days, dependsOn, startFormula
    });
  }

  recalculateProjectDates(project);
  saveState();
  window.closeTaskModal();
  renderWorkspace();
};

window.deleteCurrentTask = function () {
  const project = getActiveProject();
  const taskId = document.getElementById('taskIdInput')?.value;
  if (!project || !taskId) return;
  if (!confirm('Delete this task?')) return;
  project.tasks = project.tasks.filter(t => t.id !== taskId);
  project.tasks.forEach(t => {
    if (t.dependsOn === taskId) t.dependsOn = '';
  });
  recalculateProjectDates(project);
  saveState();
  window.closeTaskModal();
  renderWorkspace();
};

// ============================================================================
// Dashboard Rendering
// ============================================================================

function renderDashboard() {
  const grid = document.getElementById('projectsGrid');
  if (!grid) return;

  if (state.projects.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>No Projects Yet</h3>
        <p>Click <strong>+ New Project</strong> to create your first Kanban, Gantt & PERT workspace, or import a JSON backup.</p>
        <button class="btn btn-primary" onclick="openProjectModal()">+ New Project</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = state.projects.map(proj => {
    const total = proj.tasks.length;
    const completed = proj.tasks.filter(t => t.status === 'Completed').length;
    const urgent = proj.tasks.filter(t => getTaskColorInfo(t).isUrgent).length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    return `
      <div class="project-card" onclick="openProject('${proj.id}')">
        <div class="project-card-header">
          <h3>${escapeHtml(proj.name)}</h3>
          <button class="btn-icon-danger" title="Delete Project" onclick="deleteProject('${proj.id}', event)">🗑️</button>
        </div>
        <p class="project-desc">${escapeHtml(proj.description || 'No description provided.')}</p>
        <div class="project-stats">
          <span>📋 ${total} Tasks</span>
          <span>✅ ${completed} Done (${pct}%)</span>
          ${urgent > 0 ? `<span class="urgent-pill">⚠️ ${urgent} Due/Overdue</span>` : ''}
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }).join('');
}

// ============================================================================
// Workspace Rendering Dispatcher
// ============================================================================

function renderWorkspace() {
  const project = getActiveProject();
  if (!project) {
    window.showDashboard();
    return;
  }

  recalculateProjectDates(project);

  const titleEl = document.getElementById('activeProjectTitle');
  if (titleEl) titleEl.textContent = project.name;

  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === state.activeView);
  });

  const kanbanContainer = document.getElementById('kanbanView');
  const ganttContainer = document.getElementById('ganttView');
  const pertContainer = document.getElementById('pertView');

  if (kanbanContainer) kanbanContainer.classList.toggle('hidden', state.activeView !== 'kanban');
  if (ganttContainer) ganttContainer.classList.toggle('hidden', state.activeView !== 'gantt');
  if (pertContainer) pertContainer.classList.toggle('hidden', state.activeView !== 'pert');

  if (state.activeView === 'kanban') renderKanban(project);
  if (state.activeView === 'gantt') renderGantt(project);
  if (state.activeView === 'pert') renderPert(project);
}

// ============================================================================
// Kanban View
// ============================================================================

function renderKanban(project) {
  const board = document.getElementById('kanbanBoard');
  if (!board) return;

  const urgentTasks = project.tasks.filter(t => getTaskColorInfo(t).isUrgent);
  const columns = [
    { id: 'Urgent', title: '⚠️ Past Deadline / Warning', tasks: urgentTasks, isSmart: true },
    { id: 'Pending', title: 'Pending', tasks: project.tasks.filter(t => (t.status || 'Pending') === 'Pending'), isSmart: false },
    { id: 'To Do', title: 'To Do', tasks: project.tasks.filter(t => t.status === 'To Do'), isSmart: false },
    { id: 'In Progress', title: 'In Progress', tasks: project.tasks.filter(t => t.status === 'In Progress'), isSmart: false },
    { id: 'Completed', title: 'Completed', tasks: project.tasks.filter(t => t.status === 'Completed'), isSmart: false }
  ];

  board.innerHTML = columns.map(col => `
    <div class="kanban-column ${col.isSmart ? 'kanban-column-warning' : ''}"
         data-status="${col.id}"
         ondragover="handleKanbanDragOver(event)"
         ondrop="handleKanbanDrop(event, '${col.id}', ${col.isSmart})">
      <div class="kanban-col-header">
        <span>${col.title}</span>
        <span class="col-count">${col.tasks.length}</span>
      </div>
      <div class="kanban-cards">
        ${col.tasks.map(task => {
          const info = getTaskColorInfo(task);
          return `
            <div class="kanban-card ${info.colorClass}"
                 draggable="true"
                 ondragstart="handleKanbanDragStart(event, '${task.id}')"
                 onclick="openTaskModal('${task.id}')">
              <div class="card-top">
                <span class="card-cat">${escapeHtml(task.category || 'General')}</span>
                <span class="card-badge">${info.badgeText}</span>
              </div>
              <div class="card-title">${escapeHtml(task.title)}</div>
              <div class="card-meta">
                <span>👤 ${escapeHtml(task.owner || 'Unassigned')}</span>
                <span>📅 ${task.start} → ${task.end} (${task.days}d)</span>
              </div>
              ${col.isSmart ? `<div class="card-stage-tag">Stage: ${task.status}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `).join('');
}

let draggedKanbanTaskId = null;

window.handleKanbanDragStart = function (e, taskId) {
  draggedKanbanTaskId = taskId;
  e.dataTransfer.effectAllowed = 'move';
};

window.handleKanbanDragOver = function (e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
};

window.handleKanbanDrop = function (e, targetStatus, isSmart) {
  e.preventDefault();
  if (isSmart || !draggedKanbanTaskId) return;
  const project = getActiveProject();
  if (!project) return;
  const task = project.tasks.find(t => t.id === draggedKanbanTaskId);
  if (task) {
    task.status = targetStatus;
    saveState();
    renderWorkspace();
  }
  draggedKanbanTaskId = null;
};

// ============================================================================
// Gantt Chart & Spreadsheet View
// ============================================================================

window.setGanttScale = function (scale) {
  state.ganttScale = scale;
  renderWorkspace();
};

window.zoomGantt = function (delta) {
  state.ganttZoom = Math.min(2.5, Math.max(0.5, +(state.ganttZoom + delta).toFixed(2)));
  renderWorkspace();
};

window.sortGanttByDate = function () {
  const project = getActiveProject();
  if (!project) return;
  const oldIds = project.tasks.map(t => t.id);
  project.tasks.sort((a, b) => {
    const sa = parseDMY(a.start) || new Date(0);
    const sb = parseDMY(b.start) || new Date(0);
    if (sa.getTime() !== sb.getTime()) return sa - sb;
    const ea = parseDMY(a.end) || new Date(0);
    const eb = parseDMY(b.end) || new Date(0);
    return ea - eb;
  });
  rewriteFormulasOnReorder(project.tasks, oldIds);
  recalculateProjectDates(project);
  saveState();
  renderWorkspace();
};

window.moveGanttRow = function (index, direction) {
  const project = getActiveProject();
  if (!project) return;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= project.tasks.length) return;
  const oldIds = project.tasks.map(t => t.id);
  const temp = project.tasks[index];
  project.tasks[index] = project.tasks[targetIndex];
  project.tasks[targetIndex] = temp;
  rewriteFormulasOnReorder(project.tasks, oldIds);
  recalculateProjectDates(project);
  saveState();
  renderWorkspace();
};

let draggedRowIdx = null;
window.handleRowDragStart = function (e, idx) {
  draggedRowIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
};
window.handleRowDragOver = function (e) {
  e.preventDefault();
};
window.handleRowDrop = function (e, targetIdx) {
  e.preventDefault();
  if (draggedRowIdx === null || draggedRowIdx === targetIdx) return;
  const project = getActiveProject();
  if (!project) return;
  const oldIds = project.tasks.map(t => t.id);
  const [moved] = project.tasks.splice(draggedRowIdx, 1);
  project.tasks.splice(targetIdx, 0, moved);
  rewriteFormulasOnReorder(project.tasks, oldIds);
  recalculateProjectDates(project);
  saveState();
  draggedRowIdx = null;
  renderWorkspace();
};

window.updateGanttCell = function (taskId, field, value) {
  const project = getActiveProject();
  if (!project) return;
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) return;

  const trimmed = String(value).trim();

  if (field === 'title' || field === 'owner') {
    task[field] = trimmed;
  } else if (field === 'start') {
    if (trimmed.startsWith('=')) {
      task.startFormula = trimmed;
    } else {
      const parsed = parseDMY(trimmed);
      if (parsed) {
        task.startFormula = '';
        task.start = formatDMY(parsed);
        const dur = Math.max(1, parseInt(task.days, 10) || 1);
        task.end = formatDMY(addDays(parsed, dur - 1));
      }
    }
  } else if (field === 'end') {
    const parsedEnd = parseDMY(trimmed);
    const parsedStart = parseDMY(task.start);
    if (parsedEnd && parsedStart && parsedEnd >= parsedStart) {
      task.end = formatDMY(parsedEnd);
      task.days = diffDaysInclusive(parsedStart, parsedEnd);
    }
  } else if (field === 'days') {
    const newDays = Math.max(1, parseInt(trimmed, 10) || 1);
    task.days = newDays;
    const parsedStart = parseDMY(task.start);
    if (parsedStart) {
      task.end = formatDMY(addDays(parsedStart, newDays - 1));
    }
  } else if (field === 'dependsOn') {
    task.dependsOn = trimmed;
    if (!trimmed) {
      task.startFormula = '';
    }
  }

  recalculateProjectDates(project);
  saveState();
  renderWorkspace();
};

function renderGantt(project) {
  const container = document.getElementById('ganttContainer');
  if (!container) return;

  const tasks = project.tasks;
  if (tasks.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No tasks yet. Click <strong>+ Add Task</strong> to build your schedule.</p></div>`;
    return;
  }

  // Determine timeline range
  let minDate = null;
  let maxDate = null;
  tasks.forEach(t => {
    const s = parseDMY(t.start);
    const e = parseDMY(t.end);
    if (s && (!minDate || s < minDate)) minDate = new Date(s.getTime());
    if (e && (!maxDate || e > maxDate)) maxDate = new Date(e.getTime());
  });
  if (!minDate) minDate = new Date();
  if (!maxDate) maxDate = addDays(minDate, 14);

  minDate = getMonday(addDays(minDate, -7));
  maxDate = addDays(maxDate, 14);

  const pxPerDay = (state.ganttScale === 'days' ? 38 : 14) * state.ganttZoom;
  const totalDays = diffDaysInclusive(minDate, maxDate);
  const timelineWidth = totalDays * pxPerDay;
  const rowHeight = 46;
  const headerHeight = 48;

  // Build time axis header cells
  let timeHeadersHtml = '';
  if (state.ganttScale === 'weeks') {
    let cursor = new Date(minDate.getTime());
    while (cursor <= maxDate) {
      const weekNum = getISOWeek(cursor);
      const label = `W${weekNum} (${cursor.getDate()}/${cursor.getMonth() + 1})`;
      const wPx = 7 * pxPerDay;
      timeHeadersHtml += `<div class="gantt-time-cell" style="width:${wPx}px;min-width:${wPx}px;">${label}</div>`;
      cursor = addDays(cursor, 7);
    }
  } else {
    let cursor = new Date(minDate.getTime());
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    while (cursor <= maxDate) {
      const isWeekend = cursor.getDay() === 0 || cursor.getDay() === 6;
      const label = `${cursor.getDate()}/${cursor.getMonth() + 1} ${dayNames[cursor.getDay()]}`;
      timeHeadersHtml += `<div class="gantt-time-cell ${isWeekend ? 'weekend-col' : ''}" style="width:${pxPerDay}px;min-width:${pxPerDay}px;">${label}</div>`;
      cursor = addDays(cursor, 1);
    }
  }

  const w = state.colWidths;
  const tableWidth = w.index + w.title + w.owner + w.start + w.end + w.days + w.dependsOn;

  // Build spreadsheet rows
  const rowsHtml = tasks.map((task, idx) => {
    const depOptions = `<option value="">None</option>` + tasks.map((other, oIdx) => {
      if (other.id === task.id) return '';
      return `<option value="${other.id}" ${task.dependsOn === other.id ? 'selected' : ''}>#${oIdx + 1} ${escapeHtml(other.title)}</option>`;
    }).join('');

    return `
      <div class="gantt-row" style="height:${rowHeight}px;"
           draggable="true"
           ondragstart="handleRowDragStart(event, ${idx})"
           ondragover="handleRowDragOver(event)"
           ondrop="handleRowDrop(event, ${idx})">
        <div class="gantt-cell idx-cell" style="width:${w.index}px;">
          <span class="drag-handle" title="Drag row">⋮⋮</span>
          <span class="row-num">${idx + 1}</span>
          <div class="row-arrows">
            <button onclick="moveGanttRow(${idx}, -1)" title="Move Up">▲</button>
            <button onclick="moveGanttRow(${idx}, 1)" title="Move Down">▼</button>
          </div>
        </div>
        <div class="gantt-cell" style="width:${w.title}px;">
          <input type="text" value="${escapeHtml(task.title)}" onchange="updateGanttCell('${task.id}', 'title', this.value)" />
        </div>
        <div class="gantt-cell" style="width:${w.owner}px;">
          <input type="text" value="${escapeHtml(task.owner || '')}" onchange="updateGanttCell('${task.id}', 'owner', this.value)" />
        </div>
        <div class="gantt-cell" style="width:${w.start}px;">
          <input type="text" value="${escapeHtml(task.startFormula || task.start)}"
                 title="Enter D/M/YYYY or formula like =1+3"
                 onchange="updateGanttCell('${task.id}', 'start', this.value)" />
        </div>
        <div class="gantt-cell" style="width:${w.end}px;">
          <input type="text" value="${escapeHtml(task.end)}" onchange="updateGanttCell('${task.id}', 'end', this.value)" />
        </div>
        <div class="gantt-cell" style="width:${w.days}px;">
          <input type="number" min="1" value="${task.days}" onchange="updateGanttCell('${task.id}', 'days', this.value)" />
        </div>
        <div class="gantt-cell" style="width:${w.dependsOn}px;">
          <select onchange="updateGanttCell('${task.id}', 'dependsOn', this.value)">${depOptions}</select>
        </div>
      </div>
    `;
  }).join('');

  // Build timeline bars & SVG dependency arrows
  const taskCoords = new Map();
  const barsHtml = tasks.map((task, idx) => {
    const s = parseDMY(task.start) || minDate;
    const e = parseDMY(task.end) || s;
    const offsetDays = Math.max(0, diffDaysInclusive(minDate, s) - 1);
    const durDays = diffDaysInclusive(s, e);
    const leftPx = offsetDays * pxPerDay;
    const widthPx = Math.max(46, durDays * pxPerDay);
    const topPx = idx * rowHeight + 6;
    const barH = rowHeight - 12;

    taskCoords.set(task.id, {
      left: leftPx,
      right: leftPx + widthPx,
      centerY: idx * rowHeight + rowHeight / 2
    });

    const colorInfo = getTaskColorInfo(task);
    return `
      <div class="gantt-bar ${colorInfo.colorClass}"
           data-task-id="${task.id}"
           style="left:${leftPx}px; top:${topPx}px; width:${widthPx}px; height:${barH}px;"
           onmousedown="startGanttBarDrag(event, '${task.id}', 'move', ${pxPerDay})">
        <div class="bar-resize-handle left" onmousedown="startGanttBarDrag(event, '${task.id}', 'left', ${pxPerDay})"></div>
        <span class="bar-date-in">${formatDDMM(s)}</span>
        <span class="bar-label-wrap">${escapeHtml(task.title)}</span>
        <span class="bar-date-in">${formatDDMM(e)}</span>
        <div class="bar-resize-handle right" onmousedown="startGanttBarDrag(event, '${task.id}', 'right', ${pxPerDay})"></div>
      </div>
    `;
  }).join('');

  // Thin dashed dependency arrows
  let arrowsSvg = '';
  tasks.forEach(task => {
    if (task.dependsOn && taskCoords.has(task.dependsOn) && taskCoords.has(task.id)) {
      const from = taskCoords.get(task.dependsOn);
      const to = taskCoords.get(task.id);
      const startX = from.right;
      const startY = from.centerY;
      const endX = to.left;
      const endY = to.centerY;
      const midX = startX + 12;

      const path = endX >= midX
        ? `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`
        : `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${(startY + endY) / 2} L ${endX - 12} ${(startY + endY) / 2} L ${endX - 12} ${endY} L ${endX} ${endY}`;

      arrowsSvg += `<path d="${path}" fill="none" stroke="#dc2626" stroke-width="1.25" stroke-dasharray="4,3" marker-end="url(#ganttArrow)" />`;
    }
  });

  // Today marker line
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayOffset = (diffDaysInclusive(minDate, today) - 1) * pxPerDay;
  const todayLineHtml = (today >= minDate && today <= maxDate)
    ? `<div class="gantt-today-line" style="left:${todayOffset}px; height:${tasks.length * rowHeight}px;"></div>`
    : '';

  container.innerHTML = `
    <div class="gantt-split-wrapper">
      <div class="gantt-table-pane" style="width:${tableWidth}px; min-width:${tableWidth}px;">
        <div class="gantt-header-row" style="height:${headerHeight}px;">
          <div class="gantt-th" style="width:${w.index}px;">#<div class="col-resizer" onmousedown="startColResize(event, 'index')"></div></div>
          <div class="gantt-th" style="width:${w.title}px;">Task / Description<div class="col-resizer" onmousedown="startColResize(event, 'title')"></div></div>
          <div class="gantt-th" style="width:${w.owner}px;">Owner<div class="col-resizer" onmousedown="startColResize(event, 'owner')"></div></div>
          <div class="gantt-th" style="width:${w.start}px;">Start<div class="col-resizer" onmousedown="startColResize(event, 'start')"></div></div>
          <div class="gantt-th" style="width:${w.end}px;">End<div class="col-resizer" onmousedown="startColResize(event, 'end')"></div></div>
          <div class="gantt-th" style="width:${w.days}px;">Days<div class="col-resizer" onmousedown="startColResize(event, 'days')"></div></div>
          <div class="gantt-th" style="width:${w.dependsOn}px;">Depends On<div class="col-resizer" onmousedown="startColResize(event, 'dependsOn')"></div></div>
        </div>
        <div class="gantt-body-rows">${rowsHtml}</div>
      </div>

      <div class="gantt-timeline-pane">
        <div class="gantt-timeline-header" style="width:${timelineWidth}px; height:${headerHeight}px;">
          ${timeHeadersHtml}
        </div>
        <div class="gantt-timeline-canvas" style="width:${timelineWidth}px; height:${tasks.length * rowHeight}px;">
          ${todayLineHtml}
          <svg class="gantt-svg-layer" width="${timelineWidth}" height="${tasks.length * rowHeight}">
            <defs>
              <marker id="ganttArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
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

// Column Resizing
window.startColResize = function (e, colKey) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startW = state.colWidths[colKey] || 100;

  function onMove(ev) {
    const newW = Math.max(50, startW + (ev.clientX - startX));
    state.colWidths[colKey] = newW;
    renderWorkspace();
  }
  function onUp() {
    saveState();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

// Gantt Bar Drag & Resize
window.startGanttBarDrag = function (e, taskId, mode, pxPerDay) {
  e.preventDefault();
  e.stopPropagation();
  const project = getActiveProject();
  if (!project) return;
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) return;

  const origStart = parseDMY(task.start);
  const origEnd = parseDMY(task.end);
  if (!origStart || !origEnd) return;

  const startX = e.clientX;

  function onMove(ev) {
    const deltaDays = Math.round((ev.clientX - startX) / pxPerDay);
    if (mode === 'move') {
      task.startFormula = '';
      task.start = formatDMY(addDays(origStart, deltaDays));
      task.end = formatDMY(addDays(origEnd, deltaDays));
    } else if (mode === 'left') {
      const newS = addDays(origStart, deltaDays);
      if (newS <= origEnd) {
        task.startFormula = '';
        task.start = formatDMY(newS);
        task.days = diffDaysInclusive(newS, origEnd);
      }
    } else if (mode === 'right') {
      const newE = addDays(origEnd, deltaDays);
      if (newE >= origStart) {
        task.end = formatDMY(newE);
        task.days = diffDaysInclusive(origStart, newE);
      }
    }
    recalculateProjectDates(project);
    renderWorkspace();
  }

  function onUp() {
    saveState();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

// ============================================================================
// PERT Chart & Critical Path Method (CPM)
// ============================================================================

window.resetPertLayout = function () {
  const project = getActiveProject();
  if (!project) return;
  delete state.pertPositions[project.id];
  renderWorkspace();
};

function renderPert(project) {
  const canvas = document.getElementById('pertCanvas');
  if (!canvas) return;
  const tasks = project.tasks;

  if (tasks.length === 0) {
    canvas.innerHTML = `<div class="empty-state"><p>Add tasks to generate the PERT network diagram.</p></div>`;
    return;
  }

  // Build CPM graph
  const nodeMap = new Map();
  tasks.forEach((t, idx) => {
    nodeMap.set(t.id, {
      task: t,
      index: idx + 1,
      duration: Math.max(1, parseInt(t.days, 10) || 1),
      preds: [],
      succs: [],
      es: 0,
      ef: 0,
      ls: 0,
      lf: 0,
      slack: 0,
      stage: 0
    });
  });

  tasks.forEach(t => {
    if (t.dependsOn && nodeMap.has(t.dependsOn) && t.dependsOn !== t.id) {
      nodeMap.get(t.id).preds.push(t.dependsOn);
      nodeMap.get(t.dependsOn).succs.push(t.id);
    }
  });

  // Forward pass (ES, EF, Stage)
  for (let i = 0; i < tasks.length; i++) {
    nodeMap.forEach(node => {
      if (node.preds.length > 0) {
        let maxPredEf = 0;
        let maxPredStage = 0;
        node.preds.forEach(pid => {
          const p = nodeMap.get(pid);
          if (p) {
            maxPredEf = Math.max(maxPredEf, p.ef);
            maxPredStage = Math.max(maxPredStage, p.stage + 1);
          }
        });
        node.es = maxPredEf;
        node.stage = maxPredStage;
      }
      node.ef = node.es + node.duration;
    });
  }

  let projectDuration = 0;
  nodeMap.forEach(node => {
    projectDuration = Math.max(projectDuration, node.ef);
  });

  // Backward pass (LS, LF, Slack)
  nodeMap.forEach(node => {
    node.lf = projectDuration;
    node.ls = node.lf - node.duration;
  });

  for (let i = 0; i < tasks.length; i++) {
    nodeMap.forEach(node => {
      if (node.succs.length > 0) {
        let minSuccLs = projectDuration;
        node.succs.forEach(sid => {
          const s = nodeMap.get(sid);
          if (s) minSuccLs = Math.min(minSuccLs, s.ls);
        });
        node.lf = minSuccLs;
        node.ls = node.lf - node.duration;
      }
      node.slack = node.ls - node.es;
    });
  }

  // Auto-layout positions by stage
  if (!state.pertPositions[project.id]) {
    state.pertPositions[project.id] = {};
  }
  const posStore = state.pertPositions[project.id];
  const stageCounters = {};
  const nodeW = 220;
  const nodeH = 112;

  nodeMap.forEach(node => {
    const st = node.stage;
    stageCounters[st] = (stageCounters[st] || 0);
    if (!posStore[node.task.id]) {
      posStore[node.task.id] = {
        x: 40 + st * 290,
        y: 40 + stageCounters[st] * 150
      };
    }
    stageCounters[st]++;
  });

  let maxX = 900;
  let maxY = 550;
  Object.values(posStore).forEach(p => {
    maxX = Math.max(maxX, p.x + nodeW + 80);
    maxY = Math.max(maxY, p.y + nodeH + 80);
  });

  // Build SVG arrows
  let svgLines = '';
  nodeMap.forEach(node => {
    const toPos = posStore[node.task.id];
    node.preds.forEach(pid => {
      const predNode = nodeMap.get(pid);
      const fromPos = posStore[pid];
      if (fromPos && toPos && predNode) {
        const isCriticalEdge = node.slack === 0 && predNode.slack === 0;
        const x1 = fromPos.x + nodeW;
        const y1 = fromPos.y + nodeH / 2;
        const x2 = toPos.x;
        const y2 = toPos.y + nodeH / 2;
        const cx1 = x1 + 45;
        const cx2 = x2 - 45;
        const color = isCriticalEdge ? '#dc2626' : '#64748b';
        const width = isCriticalEdge ? '2.5' : '1.5';
        const marker = isCriticalEdge ? 'url(#pertArrowCrit)' : 'url(#pertArrowNorm)';

        svgLines += `<path d="M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}"
                           fill="none" stroke="${color}" stroke-width="${width}" marker-end="${marker}" />`;
      }
    });
  });

  // Build PERT node boxes
  let nodesHtml = '';
  nodeMap.forEach(node => {
    const pos = posStore[node.task.id];
    const isCritical = node.slack === 0;
    const colorInfo = getTaskColorInfo(node.task);

    nodesHtml += `
      <div class="pert-node ${isCritical ? 'pert-critical' : ''}"
           style="left:${pos.x}px; top:${pos.y}px; width:${nodeW}px;"
           onmousedown="startPertNodeDrag(event, '${node.task.id}')">
        <div class="pert-node-header ${colorInfo.colorClass}">
          <span>#${node.index} • ${node.duration}d</span>
          <span>${isCritical ? 'CRITICAL' : `Slack: ${node.slack}d`}</span>
        </div>
        <div class="pert-node-title">${escapeHtml(node.task.title)}</div>
        <div class="pert-node-dates">${node.task.start} → ${node.task.end}</div>
        <div class="pert-cpm-grid">
          <span title="Early Start">ES: ${node.es}</span>
          <span title="Early Finish">EF: ${node.ef}</span>
          <span title="Late Start">LS: ${node.ls}</span>
          <span title="Late Finish">LF: ${node.lf}</span>
        </div>
      </div>
    `;
  });

  canvas.innerHTML = `
    <div class="pert-stage" style="width:${maxX}px; height:${maxY}px; position:relative;">
      <svg width="${maxX}" height="${maxY}" style="position:absolute; top:0; left:0; pointer-events:none;">
        <defs>
          <marker id="pertArrowNorm" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <polygon points="0 0, 8 4, 0 8" fill="#64748b" />
          </marker>
          <marker id="pertArrowCrit" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <polygon points="0 0, 8 4, 0 8" fill="#dc2626" />
          </marker>
        </defs>
        ${svgLines}
      </svg>
      ${nodesHtml}
    </div>
  `;
}

window.startPertNodeDrag = function (e, taskId) {
  e.preventDefault();
  const project = getActiveProject();
  if (!project) return;
  const pos = state.pertPositions[project.id]?.[taskId];
  if (!pos) return;

  const startX = e.clientX;
  const startY = e.clientY;
  const origX = pos.x;
  const origY = pos.y;

  function onMove(ev) {
    pos.x = Math.max(10, origX + (ev.clientX - startX));
    pos.y = Math.max(10, origY + (ev.clientY - startY));
    renderPert(project);
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

// ============================================================================
// Export / Import JSON & Export CSV
// ============================================================================

window.exportJSON = function () {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    projects: state.projects,
    colWidths: state.colWidths
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `project_tracker_backup_${formatDMY(new Date()).replace(/\//g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

window.triggerImportJSON = function () {
  const input = document.getElementById('importJsonInput');
  if (input) input.click();
};

window.handleImportJSON = function (e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (ev) {
    try {
      const data = JSON.parse(ev.target.result);
      const importedProjects = Array.isArray(data) ? data : data.projects;
      if (!Array.isArray(importedProjects)) {
        alert('Invalid JSON backup format.');
        return;
      }
      state.projects = importedProjects;
      if (data.colWidths) {
        state.colWidths = { ...state.colWidths, ...data.colWidths };
      }
      saveState();
      window.showDashboard();
      alert(`Successfully imported ${importedProjects.length} project(s).`);
    } catch (err) {
      alert('Could not read JSON file: ' + err.message);
    }
    e.target.value = '';
  };
  reader.readAsText(file);
};

window.exportCSV = function () {
  const project = getActiveProject();
  if (!project) {
    alert('Open a project first to export its CSV schedule.');
    return;
  }
  const idToNum = new Map();
  project.tasks.forEach((t, i) => idToNum.set(t.id, `#${i + 1} ${t.title}`));

  const headers = ['Row', 'Task Name', 'Category', 'Owner', 'Status', 'Start Date', 'End Date', 'Days', 'Formula', 'Depends On'];
  const rows = project.tasks.map((t, idx) => [
    idx + 1,
    `"${(t.title || '').replace(/"/g, '""')}"`,
    `"${(t.category || '').replace(/"/g, '""')}"`,
    `"${(t.owner || '').replace(/"/g, '""')}"`,
    `"${(t.status || '').replace(/"/g, '""')}"`,
    t.start,
    t.end,
    t.days,
    `"${(t.startFormula || '').replace(/"/g, '""')}"`,
    `"${(idToNum.get(t.dependsOn) || '').replace(/"/g, '""')}"`
  ].join(','));

  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_schedule.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ============================================================================
// Utility & Boot
// ============================================================================

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  renderDashboard();

  // Bind extra safety listeners in case inline handlers were stripped
  document.querySelectorAll('[data-action="new-project"]').forEach(btn => {
    btn.addEventListener('click', window.openProjectModal);
  });
});
