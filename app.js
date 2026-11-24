/* Project Kanban, Gantt & PERT Tracker - app.js */
(function () {
  "use strict";

  const STORAGE_KEY = "pm_tracker_projects_v1";
  const COL_WIDTHS_KEY = "pm_tracker_col_widths_v1";

  let state = {
    projects: [],
    activeProjectId: null,
    currentView: "dashboard",
    ganttScale: "weeks",
    zoomLevel: 1,
    colWidths: {
      idx: 68,
      title: 220,
      owner: 110,
      start: 110,
      end: 105,
      days: 65,
      deps: 130
    }
  };

  let editingTaskId = null;
  let dragTaskId = null;
  let dragRowIndex = null;
  let barDragState = null;
  let pertDragState = null;

  /* ---------------- Date & Math Helpers ---------------- */
  function parseDMY(str) {
    if (!str || typeof str !== "string") return null;
    const parts = str.trim().split("/");
    if (parts.length !== 3) return null;
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    if (isNaN(d) || isNaN(m) || isNaN(y) || y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) {
      return null;
    }
    const dt = new Date(y, m - 1, d);
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  function formatDMY(dt) {
    if (!(dt instanceof Date) || isNaN(dt.getTime())) return "";
    return `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`;
  }

  function formatDDMM(dt) {
    if (!(dt instanceof Date) || isNaN(dt.getTime())) return "";
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
  }

  function addDays(dt, days) {
    const copy = new Date(dt.getTime());
    copy.setDate(copy.getDate() + days);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function diffDaysInclusive(startDt, endDt) {
    if (!startDt || !endDt) return 1;
    const ms = endDt.getTime() - startDt.getTime();
    return Math.max(1, Math.round(ms / 86400000) + 1);
  }

  function diffDaysRaw(startDt, endDt) {
    return Math.round((endDt.getTime() - startDt.getTime()) / 86400000);
  }

  function getISOWeek(dt) {
    const tmp = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  }

  function getMonday(dt) {
    const copy = new Date(dt.getTime());
    const day = copy.getDay();
    const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
    copy.setDate(diff);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function todayMidnight() {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }

  function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  /* ---------------- Storage ---------------- */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) state.projects = parsed;
      }
      const cols = localStorage.getItem(COL_WIDTHS_KEY);
      if (cols) {
        Object.assign(state.colWidths, JSON.parse(cols));
      }
    } catch (err) {
      console.warn("Resetting invalid storage:", err);
      state.projects = [];
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.projects));
      localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(state.colWidths));
    } catch (err) {
      console.error("Failed to save state:", err);
    }
  }

  function getActiveProject() {
    return state.projects.find((p) => p.id === state.activeProjectId) || null;
  }

  /* ---------------- Formula & Schedule Engine ---------------- */
  function recalculateProject(project) {
    if (!project || !Array.isArray(project.tasks)) return;
    const tasks = project.tasks;

    for (let pass = 0; pass < tasks.length + 1; pass++) {
      let changed = false;
      tasks.forEach((task) => {
        if (task.startFormula && typeof task.startFormula === "string" && task.startFormula.startsWith("=")) {
          const match = task.startFormula.trim().match(/^=(\d+)\s*([+-]\s*\d+)?$/);
          if (match) {
            const refIdx = parseInt(match[1], 10) - 1;
            const offset = match[2] ? parseInt(match[2].replace(/\s+/g, ""), 10) : 0;
            if (refIdx >= 0 && refIdx < tasks.length && tasks[refIdx].id !== task.id) {
              const pred = tasks[refIdx];
              const predEnd = parseDMY(pred.endDate);
              if (predEnd) {
                const newStart = addDays(predEnd, offset);
                const newStartStr = formatDMY(newStart);
                const dur = Math.max(1, parseInt(task.duration, 10) || 1);
                const newEndStr = formatDMY(addDays(newStart, dur - 1));
                if (task.startDate !== newStartStr || task.endDate !== newEndStr) {
                  task.startDate = newStartStr;
                  task.endDate = newEndStr;
                  changed = true;
                }
                if (!Array.isArray(task.dependencies)) task.dependencies = [];
                if (!task.dependencies.includes(pred.id)) {
                  task.dependencies.push(pred.id);
                }
              }
            }
          }
        }
        const s = parseDMY(task.startDate);
        const e = parseDMY(task.endDate);
        if (s && e) {
          task.duration = diffDaysInclusive(s, e);
        }
      });
      if (!changed) break;
    }
  }

  function rewriteFormulasAfterReorder(tasks, oldOrderIds) {
    const newIndexById = {};
    tasks.forEach((t, idx) => {
      newIndexById[t.id] = idx + 1;
    });
    tasks.forEach((t) => {
      if (t.startFormula && t.startFormula.startsWith("=")) {
        const match = t.startFormula.trim().match(/^=(\d+)\s*([+-]\s*\d+)?$/);
        if (match) {
          const oldOneBased = parseInt(match[1], 10);
          const predId = oldOrderIds[oldOneBased - 1];
          const offsetPart = match[2] ? match[2].replace(/\s+/g, "") : "";
          if (predId && newIndexById[predId]) {
            t.startFormula = `=${newIndexById[predId]}${offsetPart}`;
          } else {
            t.startFormula = "";
          }
        }
      }
    });
  }

  function getTaskColorInfo(task) {
    const status = (task.status || "To Do").toLowerCase();
    if (status === "completed" || status === "done") {
      return { key: "completed", label: "Completed", badge: "Done" };
    }
    const endDt = parseDMY(task.endDate);
    const today = todayMidnight();
    if (endDt) {
      const daysLeft = diffDaysRaw(today, endDt);
      if (daysLeft < 0) {
        return { key: "overdue", label: "Past Deadline", badge: "Overdue" };
      }
      if (daysLeft <= 7) {
        return { key: "warning", label: "Near Deadline", badge: `${daysLeft}d left` };
      }
    }
    if (status === "pending") return { key: "pending", label: "Pending", badge: "Pending" };
    if (status === "in progress") return { key: "in-progress", label: "In Progress", badge: "In Progress" };
    return { key: "to-do", label: "To Do", badge: "To Do" };
  }

  /* ---------------- View Switching & Modals ---------------- */
  function switchView(viewName) {
    state.currentView = viewName;
    const dashboard = document.getElementById("dashboardView");
    const workspace = document.getElementById("workspaceView");
    const kanbanSec = document.getElementById("kanbanView");
    const ganttSec = document.getElementById("ganttView");
    const pertSec = document.getElementById("pertView");

    document.querySelectorAll(".view-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === viewName);
    });

    if (viewName === "dashboard" || !getActiveProject()) {
      state.currentView = "dashboard";
      if (dashboard) dashboard.classList.remove("hidden");
      if (workspace) workspace.classList.add("hidden");
      renderDashboard();
      return;
    }

    if (dashboard) dashboard.classList.add("hidden");
    if (workspace) workspace.classList.remove("hidden");
    if (kanbanSec) kanbanSec.classList.toggle("hidden", viewName !== "kanban");
    if (ganttSec) ganttSec.classList.toggle("hidden", viewName !== "gantt");
    if (pertSec) pertSec.classList.toggle("hidden", viewName !== "pert");

    const proj = getActiveProject();
    const titleEl = document.getElementById("activeProjectTitle");
    if (titleEl && proj) titleEl.textContent = proj.name;

    if (viewName === "kanban") renderKanban();
    if (viewName === "gantt") renderGantt();
    if (viewName === "pert") renderPert();
  }

  function openProjectModal() {
    const modal = document.getElementById("projectModal");
    const nameInput = document.getElementById("projectNameInput");
    const descInput = document.getElementById("projectDescInput");
    if (!modal) return;
    if (nameInput) nameInput.value = "";
    if (descInput) descInput.value = "";
    modal.classList.remove("hidden");
    if (nameInput) setTimeout(() => nameInput.focus(), 30);
  }

  function closeProjectModal() {
    const modal = document.getElementById("projectModal");
    if (modal) modal.classList.add("hidden");
  }

  function handleCreateProject(e) {
    if (e) e.preventDefault();
    const nameInput = document.getElementById("projectNameInput");
    const descInput = document.getElementById("projectDescInput");
    const name = nameInput ? nameInput.value.trim() : "";
    const desc = descInput ? descInput.value.trim() : "";

    if (!name) {
      if (nameInput) nameInput.focus();
      return;
    }

    const todayStr = formatDMY(todayMidnight());
    const nextWeekStr = formatDMY(addDays(todayMidnight(), 6));

    const newProject = {
      id: generateId("proj"),
      name: name,
      description: desc || "Project schedule and task tracker",
      createdAt: todayStr,
      tasks: [
        {
          id: generateId("task"),
          title: "Project Kickoff & Planning",
          category: "Setup",
          owner: "Lead",
          status: "To Do",
          startDate: todayStr,
          endDate: nextWeekStr,
          duration: 7,
          startFormula: "",
          dependencies: [],
          pertPos: null
        }
      ]
    };

    state.projects.push(newProject);
    state.activeProjectId = newProject.id;
    saveState();
    closeProjectModal();
    switchView("kanban");
  }

  function openTaskModal(taskId) {
    const proj = getActiveProject();
    if (!proj) return;
    const modal = document.getElementById("taskModal");
    if (!modal) return;

    editingTaskId = taskId || null;
    const modalTitle = document.getElementById("taskModalTitle");
    const titleInp = document.getElementById("taskTitleInput");
    const catInp = document.getElementById("taskCategoryInput");
    const ownerInp = document.getElementById("taskOwnerInput");
    const statusInp = document.getElementById("taskStatusInput");
    const startInp = document.getElementById("taskStartInput");
    const endInp = document.getElementById("taskEndInput");
    const depsSelect = document.getElementById("taskDepsSelect");
    const deleteBtn = document.getElementById("deleteTaskBtn");

    const task = taskId ? proj.tasks.find((t) => t.id === taskId) : null;
    if (modalTitle) modalTitle.textContent = task ? "Edit Task" : "Add New Task";
    if (deleteBtn) deleteBtn.classList.toggle("hidden", !task);

    const todayStr = formatDMY(todayMidnight());
    if (titleInp) titleInp.value = task ? task.title : "";
    if (catInp) catInp.value = task ? (task.category || "") : "";
    if (ownerInp) ownerInp.value = task ? (task.owner || "") : "";
    if (statusInp) statusInp.value = task ? (task.status || "To Do") : "To Do";
    if (startInp) startInp.value = task ? (task.startFormula || task.startDate) : todayStr;
    if (endInp) endInp.value = task ? task.endDate : formatDMY(addDays(todayMidnight(), 4));

    if (depsSelect) {
      depsSelect.innerHTML = "";
      proj.tasks.forEach((other, idx) => {
        if (task && other.id === task.id) return;
        const opt = document.createElement("option");
        opt.value = other.id;
        opt.textContent = `#${idx + 1} - ${other.title}`;
        if (task && Array.isArray(task.dependencies) && task.dependencies.includes(other.id)) {
          opt.selected = true;
        }
        depsSelect.appendChild(opt);
      });
    }

    modal.classList.remove("hidden");
    if (titleInp) setTimeout(() => titleInp.focus(), 30);
  }

  function closeTaskModal() {
    const modal = document.getElementById("taskModal");
    if (modal) modal.classList.add("hidden");
    editingTaskId = null;
  }

  function handleSaveTask(e) {
    if (e) e.preventDefault();
    const proj = getActiveProject();
    if (!proj) return;

    const title = document.getElementById("taskTitleInput").value.trim();
    if (!title) return;

    const category = document.getElementById("taskCategoryInput").value.trim();
    const owner = document.getElementById("taskOwnerInput").value.trim();
    const status = document.getElementById("taskStatusInput").value;
    const rawStart = document.getElementById("taskStartInput").value.trim();
    const rawEnd = document.getElementById("taskEndInput").value.trim();
    const depsSelect = document.getElementById("taskDepsSelect");
    const selectedDeps = depsSelect
      ? Array.from(depsSelect.selectedOptions).map((o) => o.value)
      : [];

    let startFormula = "";
    let startDate = formatDMY(todayMidnight());
    if (rawStart.startsWith("=")) {
      startFormula = rawStart;
    } else if (parseDMY(rawStart)) {
      startDate = formatDMY(parseDMY(rawStart));
    }

    let endDate = startDate;
    if (parseDMY(rawEnd)) {
      endDate = formatDMY(parseDMY(rawEnd));
    }

    if (editingTaskId) {
      const task = proj.tasks.find((t) => t.id === editingTaskId);
      if (task) {
        task.title = title;
        task.category = category;
        task.owner = owner;
        task.status = status;
        task.startFormula = startFormula;
        if (!startFormula) task.startDate = startDate;
        task.endDate = endDate;
        task.dependencies = selectedDeps;
      }
    } else {
      proj.tasks.push({
        id: generateId("task"),
        title,
        category,
        owner,
        status,
        startDate,
        endDate,
        duration: diffDaysInclusive(parseDMY(startDate), parseDMY(endDate)),
        startFormula,
        dependencies: selectedDeps,
        pertPos: null
      });
    }

    recalculateProject(proj);
    saveState();
    closeTaskModal();
    switchView(state.currentView);
  }

  function handleDeleteTask() {
    const proj = getActiveProject();
    if (!proj || !editingTaskId) return;
    const oldIds = proj.tasks.map((t) => t.id);
    proj.tasks = proj.tasks.filter((t) => t.id !== editingTaskId);
    proj.tasks.forEach((t) => {
      if (Array.isArray(t.dependencies)) {
        t.dependencies = t.dependencies.filter((id) => id !== editingTaskId);
      }
    });
    rewriteFormulasAfterReorder(proj.tasks, oldIds);
    recalculateProject(proj);
    saveState();
    closeTaskModal();
    switchView(state.currentView);
  }

  /* ---------------- Dashboard Rendering ---------------- */
  function renderDashboard() {
    const grid = document.getElementById("projectsGrid");
    if (!grid) return;
    grid.innerHTML = "";

    if (state.projects.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <h3>No Projects Yet</h3>
          <p>Click <strong>+ New Project</strong> above to create your first Kanban, Gantt, and PERT workspace.</p>
        </div>
      `;
      return;
    }

    state.projects.forEach((proj) => {
      const total = proj.tasks.length;
      const done = proj.tasks.filter((t) => (t.status || "").toLowerCase() === "completed").length;
      const card = document.createElement("div");
      card.className = "project-card";
      card.innerHTML = `
        <div class="project-card-header">
          <h3>${escapeHtml(proj.name)}</h3>
          <button class="btn-icon danger-text" title="Delete Project" data-del-proj="${proj.id}">✕</button>
        </div>
        <p class="project-desc">${escapeHtml(proj.description || "")}</p>
        <div class="project-meta">
          <span>${done}/${total} Completed</span>
          <span>Created ${escapeHtml(proj.createdAt || "")}</span>
        </div>
        <div class="project-card-actions">
          <button class="btn btn-primary open-proj-btn" data-open-proj="${proj.id}">Open Project</button>
        </div>
      `;
      grid.appendChild(card);
    });

    grid.querySelectorAll("[data-open-proj]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.activeProjectId = btn.dataset.openProj;
        switchView("kanban");
      });
    });

    grid.querySelectorAll("[data-del-proj]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.delProj;
        if (confirm("Delete this project?")) {
          state.projects = state.projects.filter((p) => p.id !== id);
          if (state.activeProjectId === id) state.activeProjectId = null;
          saveState();
          renderDashboard();
        }
      });
    });
  }

  /* ---------------- Kanban Rendering ---------------- */
  function renderKanban() {
    const proj = getActiveProject();
    if (!proj) return;
    recalculateProject(proj);

    const cols = {
      alert: document.getElementById("colAlert"),
      pending: document.getElementById("colPending"),
      todo: document.getElementById("colTodo"),
      inprogress: document.getElementById("colInProgress"),
      completed: document.getElementById("colCompleted")
    };

    Object.values(cols).forEach((el) => {
      if (el) el.innerHTML = "";
    });

    let counts = { alert: 0, pending: 0, todo: 0, inprogress: 0, completed: 0 };

    proj.tasks.forEach((task) => {
      const colorInfo = getTaskColorInfo(task);
      const statusNorm = (task.status || "To Do").toLowerCase();

      if ((colorInfo.key === "overdue" || colorInfo.key === "warning") && cols.alert) {
        cols.alert.appendChild(createKanbanCard(task, colorInfo, true));
        counts.alert++;
      }

      let targetCol = cols.todo;
      if (statusNorm === "pending") {
        targetCol = cols.pending;
        counts.pending++;
      } else if (statusNorm === "in progress") {
        targetCol = cols.inprogress;
        counts.inprogress++;
      } else if (statusNorm === "completed" || statusNorm === "done") {
        targetCol = cols.completed;
        counts.completed++;
      } else {
        targetCol = cols.todo;
        counts.todo++;
      }

      if (targetCol) {
        targetCol.appendChild(createKanbanCard(task, colorInfo, false));
      }
    });

    setBadge("countAlert", counts.alert);
    setBadge("countPending", counts.pending);
    setBadge("countTodo", counts.todo);
    setBadge("countInProgress", counts.inprogress);
    setBadge("countCompleted", counts.completed);
  }

  function createKanbanCard(task, colorInfo, isAlertMirror) {
    const card = document.createElement("div");
    card.className = `kanban-card status-${colorInfo.key}`;
    card.draggable = !isAlertMirror;
    card.dataset.taskId = task.id;

    card.innerHTML = `
      <div class="card-top">
        <span class="card-category">${escapeHtml(task.category || "General")}</span>
        <span class="card-badge badge-${colorInfo.key}">${escapeHtml(colorInfo.badge)}</span>
      </div>
      <div class="card-title">${escapeHtml(task.title)}</div>
      <div class="card-footer">
        <span>👤 ${escapeHtml(task.owner || "Unassigned")}</span>
        <span>📅 ${escapeHtml(task.startDate)} → ${escapeHtml(task.endDate)}</span>
      </div>
    `;

    card.addEventListener("click", () => openTaskModal(task.id));

    if (!isAlertMirror) {
      card.addEventListener("dragstart", () => {
        dragTaskId = task.id;
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => {
        dragTaskId = null;
        card.classList.remove("dragging");
      });
    }
    return card;
  }

  function setupKanbanDropZones() {
    document.querySelectorAll(".kanban-column[data-status]").forEach((colEl) => {
      colEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        colEl.classList.add("drag-over");
      });
      colEl.addEventListener("dragleave", () => {
        colEl.classList.remove("drag-over");
      });
      colEl.addEventListener("drop", (e) => {
        e.preventDefault();
        colEl.classList.remove("drag-over");
        if (!dragTaskId) return;
        const proj = getActiveProject();
        if (!proj) return;
        const task = proj.tasks.find((t) => t.id === dragTaskId);
        if (task) {
          task.status = colEl.dataset.status;
          saveState();
          renderKanban();
        }
      });
    });
  }

  /* ---------------- Gantt Chart Rendering ---------------- */
  function renderGantt() {
    const proj = getActiveProject();
    if (!proj) return;
    recalculateProject(proj);

    const tableBody = document.getElementById("ganttTableBody");
    const timelineHeader = document.getElementById("ganttTimelineHeader");
    const timelineBody = document.getElementById("ganttTimelineBody");
    if (!tableBody || !timelineHeader || !timelineBody) return;

    applyColumnWidths();
    tableBody.innerHTML = "";
    timelineHeader.innerHTML = "";
    timelineBody.innerHTML = "";

    const tasks = proj.tasks;
    if (tasks.length === 0) return;

    // Determine timeline range
    let minDate = todayMidnight();
    let maxDate = addDays(minDate, 28);
    tasks.forEach((t, idx) => {
      const s = parseDMY(t.startDate);
      const e = parseDMY(t.endDate);
      if (idx === 0 && s) minDate = new Date(s.getTime());
      if (s && s < minDate) minDate = new Date(s.getTime());
      if (e && e > maxDate) maxDate = new Date(e.getTime());
    });

    minDate = getMonday(addDays(minDate, -7));
    maxDate = addDays(maxDate, 14);
    const totalDays = Math.max(14, diffDaysInclusive(minDate, maxDate));

    const pxPerDay = state.ganttScale === "days"
      ? Math.max(18, Math.round(34 * state.zoomLevel))
      : Math.max(4, Math.round(14 * state.zoomLevel));
    const totalWidth = totalDays * pxPerDay;

    timelineHeader.style.width = `${totalWidth}px`;
    timelineBody.style.width = `${totalWidth}px`;
    timelineBody.style.height = `${tasks.length * 44}px`;

    // Build timeline header & vertical grid lines
    if (state.ganttScale === "weeks") {
      for (let d = 0; d < totalDays; d += 7) {
        const weekStart = addDays(minDate, d);
        const colW = Math.min(7, totalDays - d) * pxPerDay;
        const cell = document.createElement("div");
        cell.className = "timeline-col-header";
        cell.style.width = `${colW}px`;
        cell.innerHTML = `<strong>W${getISOWeek(weekStart)}</strong><span>${formatDDMM(weekStart)}</span>`;
        timelineHeader.appendChild(cell);

        const gridLine = document.createElement("div");
        gridLine.className = "timeline-grid-col";
        gridLine.style.left = `${d * pxPerDay}px`;
        gridLine.style.width = `${colW}px`;
        timelineBody.appendChild(gridLine);
      }
    } else {
      const dayNames = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
      for (let d = 0; d < totalDays; d++) {
        const cur = addDays(minDate, d);
        const isWeekend = cur.getDay() === 0 || cur.getDay() === 6;
        const cell = document.createElement("div");
        cell.className = `timeline-col-header ${isWeekend ? "weekend" : ""}`;
        cell.style.width = `${pxPerDay}px`;
        cell.innerHTML = `<strong>${cur.getDate()}/${cur.getMonth() + 1}</strong><span>${dayNames[cur.getDay()]}</span>`;
        timelineHeader.appendChild(cell);

        const gridLine = document.createElement("div");
        gridLine.className = `timeline-grid-col ${isWeekend ? "weekend" : ""}`;
        gridLine.style.left = `${d * pxPerDay}px`;
        gridLine.style.width = `${pxPerDay}px`;
        timelineBody.appendChild(gridLine);
      }
    }

    // Today line
    const todayOffset = diffDaysRaw(minDate, todayMidnight());
    if (todayOffset >= 0 && todayOffset <= totalDays) {
      const todayLine = document.createElement("div");
      todayLine.className = "gantt-today-line";
      todayLine.style.left = `${todayOffset * pxPerDay}px`;
      timelineBody.appendChild(todayLine);
    }

    const barCoords = {};

    tasks.forEach((task, idx) => {
      const row = document.createElement("tr");
      row.dataset.index = idx;
      row.draggable = true;

      row.addEventListener("dragstart", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") {
          e.preventDefault();
          return;
        }
        dragRowIndex = idx;
        row.classList.add("row-dragging");
      });
      row.addEventListener("dragend", () => {
        dragRowIndex = null;
        row.classList.remove("row-dragging");
      });
      row.addEventListener("dragover", (e) => e.preventDefault());
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        if (dragRowIndex !== null && dragRowIndex !== idx) {
          moveTaskRow(dragRowIndex, idx);
        }
      });

      const depNames = (task.dependencies || [])
        .map((depId) => {
          const dIdx = tasks.findIndex((x) => x.id === depId);
          return dIdx >= 0 ? `#${dIdx + 1}` : null;
        })
        .filter(Boolean)
        .join(", ");

      row.innerHTML = `
        <td class="col-idx">
          <span class="drag-handle" title="Drag row">⋮⋮</span>
          <span class="row-num">${idx + 1}</span>
          <button class="row-move-btn" data-move="up" title="Move Up" ${idx === 0 ? "disabled" : ""}>▲</button>
          <button class="row-move-btn" data-move="down" title="Move Down" ${idx === tasks.length - 1 ? "disabled" : ""}>▼</button>
        </td>
        <td class="col-title"><input type="text" class="cell-input" data-field="title" value="${escapeAttr(task.title)}"></td>
        <td class="col-owner"><input type="text" class="cell-input" data-field="owner" value="${escapeAttr(task.owner || "")}"></td>
        <td class="col-start"><input type="text" class="cell-input" data-field="start" value="${escapeAttr(task.startFormula || task.startDate)}" placeholder="D/M/YYYY or =1+3"></td>
        <td class="col-end"><input type="text" class="cell-input" data-field="end" value="${escapeAttr(task.endDate)}"></td>
        <td class="col-days"><input type="number" min="1" class="cell-input num-input" data-field="days" value="${task.duration || 1}"></td>
        <td class="col-deps"><span class="deps-pill" title="Click to edit dependencies">${escapeHtml(depNames || "None")}</span></td>
      `;

      row.querySelector('[data-move="up"]').addEventListener("click", () => moveTaskRow(idx, idx - 1));
      row.querySelector('[data-move="down"]').addEventListener("click", () => moveTaskRow(idx, idx + 1));
      row.querySelector(".deps-pill").addEventListener("click", () => openTaskModal(task.id));

      row.querySelectorAll(".cell-input").forEach((inp) => {
        inp.addEventListener("change", () => {
          const field = inp.dataset.field;
          const val = inp.value.trim();
          if (field === "title" && val) task.title = val;
          if (field === "owner") task.owner = val;
          if (field === "start") {
            if (val.startsWith("=")) {
              task.startFormula = val;
            } else {
              const parsed = parseDMY(val);
              if (parsed) {
                task.startFormula = "";
                task.startDate = formatDMY(parsed);
                const curEnd = parseDMY(task.endDate);
                if (!curEnd || curEnd < parsed) {
                  task.endDate = formatDMY(addDays(parsed, (task.duration || 1) - 1));
                }
              }
            }
          }
          if (field === "end") {
            const parsed = parseDMY(val);
            const s = parseDMY(task.startDate);
            if (parsed && s && parsed >= s) {
              task.endDate = formatDMY(parsed);
              task.duration = diffDaysInclusive(s, parsed);
            }
          }
          if (field === "days") {
            const newDays = Math.max(1, parseInt(val, 10) || 1);
            const s = parseDMY(task.startDate);
            if (s) {
              task.duration = newDays;
              task.endDate = formatDMY(addDays(s, newDays - 1));
            }
          }
          recalculateProject(proj);
          saveState();
          renderGantt();
        });
      });

      tableBody.appendChild(row);

      // Render Gantt bar
      const sDt = parseDMY(task.startDate) || minDate;
      const eDt = parseDMY(task.endDate) || sDt;
      const startOffset = diffDaysRaw(minDate, sDt);
      const spanDays = diffDaysInclusive(sDt, eDt);
      const leftPx = startOffset * pxPerDay;
      const widthPx = Math.max(24, spanDays * pxPerDay);
      const topPx = idx * 44 + 6;
      const colorInfo = getTaskColorInfo(task);

      barCoords[task.id] = {
        left: leftPx,
        right: leftPx + widthPx,
        centerY: topPx + 16
      };

      const bar = document.createElement("div");
      bar.className = `gantt-bar status-${colorInfo.key}`;
      bar.style.left = `${leftPx}px`;
      bar.style.top = `${topPx}px`;
      bar.style.width = `${widthPx}px`;

      bar.innerHTML = `
        <div class="bar-resize-handle left" data-edge="left"></div>
        <span class="bar-date-in">${formatDDMM(sDt)}</span>
        <span class="bar-label">${escapeHtml(task.title)}</span>
        <span class="bar-date-in">${formatDDMM(eDt)}</span>
        <div class="bar-resize-handle right" data-edge="right"></div>
      `;

      bar.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const edge = e.target.dataset.edge || "move";
        barDragState = {
          task,
          mode: edge,
          startX: e.clientX,
          origStart: new Date(sDt.getTime()),
          origEnd: new Date(eDt.getTime()),
          pxPerDay,
          moved: false
        };
      });

      timelineBody.appendChild(bar);
    });

    // Draw thin dashed dependency SVG arrows
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "gantt-arrows-svg");
    svg.setAttribute("width", totalWidth);
    svg.setAttribute("height", tasks.length * 44);
    svg.innerHTML = `
      <defs>
        <marker id="ganttArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <polygon points="0 0, 7 3.5, 0 7" fill="#dc2626" />
        </marker>
      </defs>
    `;

    tasks.forEach((task) => {
      const target = barCoords[task.id];
      if (!target || !Array.isArray(task.dependencies)) return;
      task.dependencies.forEach((depId) => {
        const src = barCoords[depId];
        if (!src) return;
        const x1 = src.right;
        const y1 = src.centerY;
        const x2 = target.left;
        const y2 = target.centerY;
        const midX = x2 >= x1 + 12 ? x1 + (x2 - x1) / 2 : x1 + 12;
        const dPath = x2 >= x1 + 12
          ? `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
          : `M ${x1} ${y1} L ${x1 + 10} ${y1} L ${x1 + 10} ${(y1 + y2) / 2} L ${x2 - 10} ${(y1 + y2) / 2} L ${x2 - 10} ${y2} L ${x2} ${y2}`;

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", dPath);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#dc2626");
        path.setAttribute("stroke-width", "1.25");
        path.setAttribute("stroke-dasharray", "4,3");
        path.setAttribute("marker-end", "url(#ganttArrow)");
        svg.appendChild(path);
      });
    });

    timelineBody.appendChild(svg);
  }

  function moveTaskRow(fromIdx, toIdx) {
    const proj = getActiveProject();
    if (!proj) return;
    if (toIdx < 0 || toIdx >= proj.tasks.length || fromIdx === toIdx) return;
    const oldIds = proj.tasks.map((t) => t.id);
    const [moved] = proj.tasks.splice(fromIdx, 1);
    proj.tasks.splice(toIdx, 0, moved);
    rewriteFormulasAfterReorder(proj.tasks, oldIds);
    recalculateProject(proj);
    saveState();
    renderGantt();
  }

  function sortTasksByDate() {
    const proj = getActiveProject();
    if (!proj) return;
    const oldIds = proj.tasks.map((t) => t.id);
    proj.tasks.sort((a, b) => {
      const sa = parseDMY(a.startDate) || new Date(0);
      const sb = parseDMY(b.startDate) || new Date(0);
      if (sa.getTime() !== sb.getTime()) return sa - sb;
      const ea = parseDMY(a.endDate) || sa;
      const eb = parseDMY(b.endDate) || sb;
      return ea - eb;
    });
    rewriteFormulasAfterReorder(proj.tasks, oldIds);
    recalculateProject(proj);
    saveState();
    renderGantt();
  }

  function applyColumnWidths() {
    const map = {
      "col-idx": state.colWidths.idx,
      "col-title": state.colWidths.title,
      "col-owner": state.colWidths.owner,
      "col-start": state.colWidths.start,
      "col-end": state.colWidths.end,
      "col-days": state.colWidths.days,
      "col-deps": state.colWidths.deps
    };
    Object.entries(map).forEach(([cls, w]) => {
      document.querySelectorAll(`.${cls}`).forEach((el) => {
        el.style.width = `${w}px`;
        el.style.minWidth = `${w}px`;
      });
    });
  }

  function setupColumnResizers() {
    document.querySelectorAll(".col-resizer").forEach((handle) => {
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const colKey = handle.dataset.col;
        const startX = e.clientX;
        const startW = state.colWidths[colKey] || 100;

        function onMove(ev) {
          const newW = Math.max(50, startW + (ev.clientX - startX));
          state.colWidths[colKey] = newW;
          applyColumnWidths();
        }
        function onUp() {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          saveState();
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    });
  }

  /* ---------------- PERT Network Diagram ---------------- */
  function renderPert(forceAutoLayout) {
    const proj = getActiveProject();
    if (!proj) return;
    recalculateProject(proj);

    const canvas = document.getElementById("pertCanvas");
    if (!canvas) return;
    canvas.innerHTML = "";

    const tasks = proj.tasks;
    if (tasks.length === 0) return;

    // Calculate CPM (ES, EF, LS, LF, Slack)
    const nodeMap = {};
    tasks.forEach((t) => {
      nodeMap[t.id] = {
        task: t,
        dur: Math.max(1, parseInt(t.duration, 10) || 1),
        preds: (t.dependencies || []).filter((id) => tasks.some((x) => x.id === id)),
        succs: [],
        es: 0,
        ef: 0,
        ls: 0,
        lf: 0,
        slack: 0,
        stage: 0
      };
    });

    Object.values(nodeMap).forEach((n) => {
      n.preds.forEach((pid) => {
        if (nodeMap[pid]) nodeMap[pid].succs.push(n.task.id);
      });
    });

    // Forward pass
    for (let i = 0; i < tasks.length + 1; i++) {
      Object.values(nodeMap).forEach((n) => {
        let maxPredEf = 0;
        let maxStage = 0;
        n.preds.forEach((pid) => {
          if (nodeMap[pid]) {
            maxPredEf = Math.max(maxPredEf, nodeMap[pid].ef);
            maxStage = Math.max(maxStage, nodeMap[pid].stage + 1);
          }
        });
        n.es = maxPredEf;
        n.ef = n.es + n.dur;
        n.stage = maxStage;
      });
    }

    const projectFinish = Math.max(...Object.values(nodeMap).map((n) => n.ef), 1);

    // Backward pass
    Object.values(nodeMap).forEach((n) => {
      n.lf = projectFinish;
      n.ls = n.lf - n.dur;
    });

    for (let i = 0; i < tasks.length + 1; i++) {
      Object.values(nodeMap).forEach((n) => {
        if (n.succs.length > 0) {
          n.lf = Math.min(...n.succs.map((sid) => nodeMap[sid].ls));
          n.ls = n.lf - n.dur;
        }
        n.slack = n.ls - n.es;
      });
    }

    // Group by stage for layout
    const stages = {};
    Object.values(nodeMap).forEach((n) => {
      if (!stages[n.stage]) stages[n.stage] = [];
      stages[n.stage].push(n);
    });

    let maxW = 1000;
    let maxH = 600;

    Object.entries(stages).forEach(([stageIdx, list]) => {
      list.forEach((n, rowIdx) => {
        if (forceAutoLayout || !n.task.pertPos) {
          n.task.pertPos = {
            x: 40 + parseInt(stageIdx, 10) * 290,
            y: 40 + rowIdx * 155
          };
        }
        maxW = Math.max(maxW, n.task.pertPos.x + 280);
        maxH = Math.max(maxH, n.task.pertPos.y + 180);
      });
    });

    canvas.style.width = `${maxW}px`;
    canvas.style.height = `${maxH}px`;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "pert-svg");
    svg.setAttribute("width", maxW);
    svg.setAttribute("height", maxH);
    svg.innerHTML = `
      <defs>
        <marker id="pertArrowNorm" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <polygon points="0 0, 8 4, 0 8" fill="#64748b" />
        </marker>
        <marker id="pertArrowCrit" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <polygon points="0 0, 8 4, 0 8" fill="#dc2626" />
        </marker>
      </defs>
    `;
    canvas.appendChild(svg);

    function drawPertEdges() {
      svg.querySelectorAll("path").forEach((p) => p.remove());
      Object.values(nodeMap).forEach((n) => {
        const toPos = n.task.pertPos;
        const toCrit = n.slack === 0;
        n.preds.forEach((pid) => {
          const predNode = nodeMap[pid];
          if (!predNode) return;
          const fromPos = predNode.task.pertPos;
          const isCritEdge = toCrit && predNode.slack === 0;

          const x1 = fromPos.x + 220;
          const y1 = fromPos.y + 56;
          const x2 = toPos.x;
          const y2 = toPos.y + 56;
          const cx = (x1 + x2) / 2;

          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`);
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", isCritEdge ? "#dc2626" : "#64748b");
          path.setAttribute("stroke-width", isCritEdge ? "2.4" : "1.5");
          path.setAttribute("marker-end", isCritEdge ? "url(#pertArrowCrit)" : "url(#pertArrowNorm)");
          svg.appendChild(path);
        });
      });
    }

    Object.values(nodeMap).forEach((n) => {
      const t = n.task;
      const isCritical = n.slack === 0;
      const card = document.createElement("div");
      card.className = `pert-node ${isCritical ? "critical" : ""}`;
      card.style.left = `${t.pertPos.x}px`;
      card.style.top = `${t.pertPos.y}px`;

      card.innerHTML = `
        <div class="pert-node-header">
          <span>${escapeHtml(t.title)}</span>
          <span class="pert-dur">${n.dur}d</span>
        </div>
        <div class="pert-node-body">
          <div>👤 ${escapeHtml(t.owner || "Unassigned")}</div>
          <div>📅 ${escapeHtml(t.startDate)} → ${escapeHtml(t.endDate)}</div>
        </div>
        <div class="pert-node-footer">
          <span>ES:${n.es} EF:${n.ef}</span>
          <span>Slack: ${n.slack}d</span>
        </div>
      `;

      card.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        pertDragState = {
          task: t,
          el: card,
          startX: e.clientX,
          startY: e.clientY,
          origX: t.pertPos.x,
          origY: t.pertPos.y,
          redraw: drawPertEdges
        };
      });

      canvas.appendChild(card);
    });

    drawPertEdges();
  }

  /* ---------------- JSON / CSV Import & Export ---------------- */
  function exportJSON() {
    const blob = new Blob([JSON.stringify(state.projects, null, 2)], { type: "application/json" });
    triggerDownload(blob, `projects_backup_${formatDDMM(todayMidnight()).replace("/", "-")}.json`);
  }

  function importJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const imported = Array.isArray(data) ? data : (data.projects || []);
        if (!Array.isArray(imported)) throw new Error("Invalid format");
        imported.forEach((p) => {
          if (p && p.name && Array.isArray(p.tasks)) {
            p.id = generateId("proj");
            state.projects.push(p);
          }
        });
        saveState();
        renderDashboard();
        alert(`Imported ${imported.length} project(s) successfully.`);
      } catch (err) {
        alert("Could not read JSON file. Please verify it is a valid project backup.");
      }
    };
    reader.readAsText(file);
  }

  function exportCSV() {
    const proj = getActiveProject();
    if (!proj) return;
    const rows = [["#", "Task Name", "Category", "Owner", "Status", "Start Date", "End Date", "Days"]];
    proj.tasks.forEach((t, i) => {
      rows.push([
        i + 1,
        `"${(t.title || "").replace(/"/g, '""')}"`,
        `"${(t.category || "").replace(/"/g, '""')}"`,
        `"${(t.owner || "").replace(/"/g, '""')}"`,
        `"${(t.status || "").replace(/"/g, '""')}"`,
        t.startDate,
        t.endDate,
        t.duration || 1
      ]);
    });
    const csvContent = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, `${proj.name.replace(/\s+/g, "_")}.csv`);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ---------------- Global Mouse & DOM Utilities ---------------- */
  function setupGlobalMouseHandlers() {
    document.addEventListener("mousemove", (e) => {
      if (barDragState) {
        const dx = e.clientX - barDragState.startX;
        const deltaDays = Math.round(dx / barDragState.pxPerDay);
        if (deltaDays !== 0) barDragState.moved = true;

        if (barDragState.mode === "move") {
          const ns = addDays(barDragState.origStart, deltaDays);
          const ne = addDays(barDragState.origEnd, deltaDays);
          barDragState.task.startFormula = "";
          barDragState.task.startDate = formatDMY(ns);
          barDragState.task.endDate = formatDMY(ne);
        } else if (barDragState.mode === "left") {
          const ns = addDays(barDragState.origStart, deltaDays);
          if (ns <= barDragState.origEnd) {
            barDragState.task.startFormula = "";
            barDragState.task.startDate = formatDMY(ns);
          }
        } else if (barDragState.mode === "right") {
          const ne = addDays(barDragState.origEnd, deltaDays);
          if (ne >= barDragState.origStart) {
            barDragState.task.endDate = formatDMY(ne);
          }
        }
        renderGantt();
      }

      if (pertDragState) {
        const dx = e.clientX - pertDragState.startX;
        const dy = e.clientY - pertDragState.startY;
        pertDragState.task.pertPos = {
          x: Math.max(10, pertDragState.origX + dx),
          y: Math.max(10, pertDragState.origY + dy)
        };
        pertDragState.el.style.left = `${pertDragState.task.pertPos.x}px`;
        pertDragState.el.style.top = `${pertDragState.task.pertPos.y}px`;
        pertDragState.redraw();
      }
    });

    document.addEventListener("mouseup", () => {
      if (barDragState) {
        const wasMoved = barDragState.moved;
        const clickedTask = barDragState.task;
        barDragState = null;
        const proj = getActiveProject();
        if (proj && wasMoved) {
          recalculateProject(proj);
          saveState();
          renderGantt();
        } else if (!wasMoved && clickedTask) {
          openTaskModal(clickedTask.id);
        }
      }
      if (pertDragState) {
        pertDragState = null;
        saveState();
      }
    });
  }

  function setBadge(id, num) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(num);
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, "&#39;");
  }

  function bindClick(id, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", handler);
  }

  /* ---------------- Initialization ---------------- */
  function init() {
    loadState();

    // New Project buttons (Dashboard & Top Header)
    bindClick("newProjectBtn", openProjectModal);
    bindClick("dashNewProjectBtn", openProjectModal);
    bindClick("closeProjectModalBtn", closeProjectModal);
    bindClick("cancelProjectModalBtn", closeProjectModal);

    const projectForm = document.getElementById("projectForm");
    if (projectForm) projectForm.addEventListener("submit", handleCreateProject);

    // Task Modal buttons
    bindClick("addTaskBtn", () => openTaskModal(null));
    bindClick("ganttAddTaskBtn", () => openTaskModal(null));
    bindClick("closeTaskModalBtn", closeTaskModal);
    bindClick("cancelTaskModalBtn", closeTaskModal);
    bindClick("deleteTaskBtn", handleDeleteTask);

    const taskForm = document.getElementById("taskForm");
    if (taskForm) taskForm.addEventListener("submit", handleSaveTask);

    // Navigation & View Tabs
    bindClick("backToDashboardBtn", () => switchView("dashboard"));
    document.querySelectorAll(".view-tab").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });

    // Gantt Controls
    bindClick("scaleWeeksBtn", () => {
      state.ganttScale = "weeks";
      document.getElementById("scaleWeeksBtn")?.classList.add("active");
      document.getElementById("scaleDaysBtn")?.classList.remove("active");
      renderGantt();
    });
    bindClick("scaleDaysBtn", () => {
      state.ganttScale = "days";
      document.getElementById("scaleDaysBtn")?.classList.add("active");
      document.getElementById("scaleWeeksBtn")?.classList.remove("active");
      renderGantt();
    });
    bindClick("zoomInBtn", () => {
      state.zoomLevel = Math.min(2.5, +(state.zoomLevel + 0.25).toFixed(2));
      renderGantt();
    });
    bindClick("zoomOutBtn", () => {
      state.zoomLevel = Math.max(0.5, +(state.zoomLevel - 0.25).toFixed(2));
      renderGantt();
    });
    bindClick("sortDateBtn", sortTasksByDate);

    // PERT Controls
    bindClick("pertAutoLayoutBtn", () => {
      renderPert(true);
      saveState();
    });

    // JSON & CSV Controls
    bindClick("exportJsonBtn", exportJSON);
    bindClick("exportCsvBtn", exportCSV);
    const importInput = document.getElementById("importJsonInput");
    bindClick("importJsonBtn", () => importInput && importInput.click());
    if (importInput) {
      importInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
          importJSON(e.target.files[0]);
          e.target.value = "";
        }
      });
    }

    setupKanbanDropZones();
    setupColumnResizers();
    setupGlobalMouseHandlers();
    switchView("dashboard");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
