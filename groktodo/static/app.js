const API = "/api/todos";

const state = {
  todos: [],
  filter: "all",
  search: "",
  sort: "created",
};

const els = {
  form: document.getElementById("todo-form"),
  title: document.getElementById("title-input"),
  priority: document.getElementById("priority-input"),
  due: document.getElementById("due-input"),
  list: document.getElementById("todo-list"),
  empty: document.getElementById("empty-state"),
  search: document.getElementById("search-input"),
  sort: document.getElementById("sort-select"),
  clear: document.getElementById("clear-completed"),
  filters: document.querySelectorAll(".filter"),
  statActive: document.getElementById("stat-active"),
  statDone: document.getElementById("stat-done"),
  toast: document.getElementById("toast"),
};

let toastTimer;

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add("is-visible"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove("is-visible");
    setTimeout(() => {
      els.toast.hidden = true;
    }, 250);
  }, 2200);
}

async function api(path = "", options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function loadTodos() {
  state.todos = await api();
  render();
}

function priorityRank(p) {
  return { high: 0, medium: 1, low: 2 }[p] ?? 1;
}

function isOverdue(todo) {
  if (!todo.dueDate || todo.completed) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${todo.dueDate}T00:00:00`);
  return due < today;
}

function formatDue(dateStr) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

function filteredTodos() {
  let items = [...state.todos];

  if (state.filter === "active") items = items.filter((t) => !t.completed);
  if (state.filter === "completed") items = items.filter((t) => t.completed);

  const q = state.search.trim().toLowerCase();
  if (q) items = items.filter((t) => t.title.toLowerCase().includes(q));

  items.sort((a, b) => {
    switch (state.sort) {
      case "priority":
        return priorityRank(a.priority) - priorityRank(b.priority) ||
          new Date(b.createdAt) - new Date(a.createdAt);
      case "due": {
        if (!a.dueDate && !b.dueDate) return new Date(b.createdAt) - new Date(a.createdAt);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      }
      case "alpha":
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      default:
        return new Date(b.createdAt) - new Date(a.createdAt);
    }
  });

  return items;
}

function checkIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>`;
}

function trashIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;
}

function renderTodo(todo) {
  const li = document.createElement("li");
  li.className = `todo-item${todo.completed ? " is-completed" : ""}`;
  li.dataset.id = todo.id;

  const overdue = isOverdue(todo);
  const dueLabel = todo.dueDate
    ? `<span class="badge badge-due${overdue ? " is-overdue" : ""}">${overdue ? "Overdue · " : ""}${formatDue(todo.dueDate)}</span>`
    : "";

  li.innerHTML = `
    <button type="button" class="check${todo.completed ? " is-on" : ""}" data-action="toggle" aria-label="${todo.completed ? "Mark active" : "Mark complete"}" aria-pressed="${todo.completed}">
      ${checkIcon()}
    </button>
    <div class="todo-body">
      <p class="todo-title" data-action="edit" title="Double-click to edit">${escapeHtml(todo.title)}</p>
      <div class="todo-meta">
        <span class="badge badge-${todo.priority}">${todo.priority}</span>
        ${dueLabel}
      </div>
    </div>
    <div class="todo-actions">
      <button type="button" class="icon-btn danger" data-action="delete" aria-label="Delete task">
        ${trashIcon()}
      </button>
    </div>
  `;

  return li;
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function render() {
  const items = filteredTodos();
  els.list.replaceChildren(...items.map(renderTodo));
  els.empty.hidden = items.length > 0;

  const active = state.todos.filter((t) => !t.completed).length;
  const done = state.todos.length - active;
  els.statActive.textContent = String(active);
  els.statDone.textContent = String(done);
  els.clear.disabled = done === 0;
}

async function addTodo(e) {
  e.preventDefault();
  const title = els.title.value.trim();
  if (!title) return;

  const payload = {
    title,
    priority: els.priority.value,
  };
  if (els.due.value) payload.dueDate = els.due.value;

  try {
    const todo = await api("", { method: "POST", body: JSON.stringify(payload) });
    state.todos.unshift(todo);
    els.form.reset();
    els.priority.value = "medium";
    els.title.focus();
    render();
    showToast("Task added");
  } catch (err) {
    showToast(err.message);
  }
}

async function toggleTodo(id) {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return;
  try {
    const updated = await api(`/${id}`, {
      method: "PUT",
      body: JSON.stringify({ completed: !todo.completed }),
    });
    Object.assign(todo, updated);
    render();
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteTodo(id) {
  try {
    await api(`/${id}`, { method: "DELETE" });
    state.todos = state.todos.filter((t) => t.id !== id);
    render();
    showToast("Task deleted");
  } catch (err) {
    showToast(err.message);
  }
}

function startEdit(li, todo) {
  const titleEl = li.querySelector(".todo-title");
  if (!titleEl || li.querySelector(".todo-title-input")) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "todo-title-input";
  input.value = todo.title;
  input.maxLength = 200;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let saved = false;

  const finish = async (commit) => {
    if (saved) return;
    saved = true;
    const next = input.value.trim();
    if (!commit || !next || next === todo.title) {
      render();
      return;
    }
    try {
      const updated = await api(`/${todo.id}`, {
        method: "PUT",
        body: JSON.stringify({ title: next }),
      });
      Object.assign(todo, updated);
      render();
      showToast("Task updated");
    } catch (err) {
      showToast(err.message);
      render();
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

async function clearCompleted() {
  try {
    const result = await api("?completed=true", { method: "DELETE" });
    state.todos = state.todos.filter((t) => !t.completed);
    render();
    showToast(`Cleared ${result.cleared} completed`);
  } catch (err) {
    showToast(err.message);
  }
}

els.form.addEventListener("submit", addTodo);
els.search.addEventListener("input", () => {
  state.search = els.search.value;
  render();
});
els.sort.addEventListener("change", () => {
  state.sort = els.sort.value;
  render();
});
els.clear.addEventListener("click", clearCompleted);

els.filters.forEach((btn) => {
  btn.addEventListener("click", () => {
    state.filter = btn.dataset.filter;
    els.filters.forEach((b) => {
      const active = b === btn;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", String(active));
    });
    render();
  });
});

els.list.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const li = btn.closest(".todo-item");
  if (!li) return;
  const id = li.dataset.id;
  const action = btn.dataset.action;

  if (action === "toggle") toggleTodo(id);
  if (action === "delete") deleteTodo(id);
});

els.list.addEventListener("dblclick", (e) => {
  const title = e.target.closest(".todo-title");
  if (!title) return;
  const li = title.closest(".todo-item");
  const todo = state.todos.find((t) => t.id === li.dataset.id);
  if (todo) startEdit(li, todo);
});

loadTodos().catch((err) => {
  showToast(err.message || "Could not load tasks");
  render();
});
