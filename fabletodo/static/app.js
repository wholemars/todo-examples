"use strict";

// --- state -----------------------------------------------------------------

const state = {
  todos: [],
  filter: localStorage.getItem("fabletodo:filter") || "all",
};

const $ = (sel) => document.querySelector(sel);
const list = $("#list");
const captureInput = $("#capture-input");
const captureDue = $("#capture-due");

// Three slightly different strikes so a page of done tasks doesn't look stamped.
const STRIKES = [
  "M2,6 C15,3.5 30,8 45,5 S70,7.5 98,5",
  "M2,5 C20,7.5 35,3.5 55,6 S80,4 98,6",
  "M2,6 C12,4 28,7 50,4.5 S78,7 98,4.5",
];

// --- api ---------------------------------------------------------------------

async function api(path, options = {}) {
  const res = await fetch(`/api/${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

function report(err) {
  console.error(err);
  toast("Couldn't reach the server — changes may not be saved.");
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

// --- dates -------------------------------------------------------------------

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dueLabel(due) {
  const today = todayISO();
  const t = new Date(today + "T00:00:00");
  const d = new Date(due + "T00:00:00");
  const days = Math.round((d - t) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== t.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts).toLowerCase();
}

function isOverdue(todo) {
  return todo.due && !todo.done && todo.due < todayISO();
}

// --- rendering -----------------------------------------------------------------

function visibleTodos() {
  if (state.filter === "active") return state.todos.filter((t) => !t.done);
  if (state.filter === "done") return state.todos.filter((t) => t.done);
  return state.todos;
}

function render({ enteringId } = {}) {
  list.replaceChildren(...visibleTodos().map((t) => renderItem(t, t.id === enteringId)));
  renderChrome();
}

function renderChrome() {
  const open = state.todos.filter((t) => !t.done).length;
  const done = state.todos.length - open;

  const tally = $("#tally");
  if (state.todos.length === 0) tally.textContent = "a clean slate";
  else if (open === 0) tally.textContent = `all ${done} done — nothing left`;
  else tally.textContent = `${open} open${done ? ` · ${done} done` : ""}`;

  const counts = { all: state.todos.length, active: open, done };
  const labels = { all: "All", active: "Open", done: "Done" };
  document.querySelectorAll(".filter").forEach((btn) => {
    const f = btn.dataset.filter;
    btn.setAttribute("aria-selected", String(f === state.filter));
    const c = document.createElement("span");
    c.className = "count";
    c.textContent = counts[f];
    btn.replaceChildren(labels[f], c);
  });

  const clearBtn = $("#clear-done");
  clearBtn.hidden = done === 0;
  clearBtn.textContent = `Clear done (${done})`;

  const empty = $("#empty");
  const messages = {
    all: "Nothing here yet. Write your first task above.",
    active: "All clear — everything is crossed off.",
    done: "Nothing crossed off yet.",
  };
  empty.hidden = visibleTodos().length > 0;
  empty.textContent = messages[state.filter];
}

function svg(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function strikeIndex(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % STRIKES.length;
}

function renderItem(todo, entering = false) {
  const li = document.createElement("li");
  li.className = "item" + (todo.done ? " done" : "") + (entering ? " entering" : "");
  li.dataset.id = todo.id;
  li.draggable = true;

  // grip
  const grip = document.createElement("span");
  grip.className = "grip";
  grip.title = "Drag to reorder";
  grip.textContent = "⠿";
  li.append(grip);

  // checkbox
  const check = document.createElement("button");
  check.className = "check";
  check.setAttribute("role", "checkbox");
  check.setAttribute("aria-checked", String(todo.done));
  check.setAttribute("aria-label", todo.title);
  const checkSvg = svg("svg", { viewBox: "0 0 22 22", width: 22, height: 22 });
  checkSvg.append(
    svg("path", { class: "ring", d: "M11 2.6 C16 2.2 19.6 6 19.4 11 C19.2 16 16 19.6 11 19.4 C6 19.2 2.4 16 2.6 11 C2.8 6 6 3 11 2.6" }),
    svg("path", { class: "tick", d: "M6.5 11.5 L9.5 14.5 L15.5 7.5", pathLength: 1 }),
  );
  check.append(checkSvg);
  check.addEventListener("click", () => toggle(todo, li));
  li.append(check);

  // label + strike overlay
  const wrap = document.createElement("span");
  wrap.className = "label-wrap";
  const box = document.createElement("span");
  box.className = "label-box";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = todo.title;
  const strike = svg("svg", { class: "strike", viewBox: "0 0 100 10", preserveAspectRatio: "none", "aria-hidden": "true" });
  strike.append(svg("path", { d: STRIKES[strikeIndex(todo.id)], pathLength: 1 }));
  box.append(label, strike);
  wrap.append(box);
  wrap.addEventListener("dblclick", () => startEdit(todo, li, wrap));
  li.append(wrap);

  // due chip
  if (todo.due) {
    const chip = document.createElement("span");
    chip.className = "due-chip mono" + (isOverdue(todo) ? " overdue" : "");
    chip.textContent = dueLabel(todo.due);
    chip.title = todo.due;
    li.append(chip);
  }

  // actions: due date, edit, delete
  const actions = document.createElement("span");
  actions.className = "actions";

  const dueBtn = iconButton("Set due date", "M2.5 4 h15 v13 h-15 z M2.5 8.5 h15 M6.5 2 v3.5 M13.5 2 v3.5");
  const dueInput = document.createElement("input");
  dueInput.type = "date";
  dueInput.className = "date-input";
  dueInput.tabIndex = -1;
  dueInput.value = todo.due || "";
  dueInput.addEventListener("change", () => setDue(todo, dueInput.value));
  dueBtn.addEventListener("click", () => openPicker(dueInput));
  actions.append(dueBtn, dueInput);

  const editBtn = iconButton("Edit task", "M4 16 L3.5 13 L13 3.5 A1.8 1.8 0 0 1 16.5 7 L7 16.5 Z");
  editBtn.addEventListener("click", () => startEdit(todo, li, wrap));
  actions.append(editBtn);

  const delBtn = iconButton("Delete task", "M5 5 L15 15 M15 5 L5 15");
  delBtn.classList.add("danger");
  delBtn.addEventListener("click", () => remove(todo, li));
  actions.append(delBtn);

  li.append(actions);
  return li;
}

function iconButton(label, pathD) {
  const btn = document.createElement("button");
  btn.className = "icon-btn";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  const s = svg("svg", { viewBox: "0 0 20 20", width: 17, height: 17, fill: "none", "aria-hidden": "true" });
  s.append(svg("path", { d: pathD }));
  btn.append(s);
  return btn;
}

function openPicker(input) {
  try {
    input.showPicker();
  } catch {
    input.focus();
    input.click();
  }
}

// --- actions ---------------------------------------------------------------------

async function add(title, due) {
  try {
    const todo = await api("todos", { method: "POST", body: JSON.stringify({ title, due }) });
    state.todos.push(todo);
    render({ enteringId: todo.id });
  } catch (err) {
    report(err);
  }
}

// Toggle in place so the strike animation plays, then reconcile with the filter.
function toggle(todo, li) {
  todo.done = !todo.done;
  li.classList.toggle("done", todo.done);
  li.querySelector(".check").setAttribute("aria-checked", String(todo.done));
  renderChrome();

  const stillVisible = state.filter === "all" || (state.filter === "active") !== todo.done;
  if (!stillVisible) {
    setTimeout(() => {
      li.classList.add("leaving");
      setTimeout(() => render(), 220);
    }, 650);
  }
  api(`todos/${todo.id}`, { method: "PATCH", body: JSON.stringify({ done: todo.done }) }).catch(report);
}

function remove(todo, li) {
  li.classList.add("leaving");
  setTimeout(() => {
    state.todos = state.todos.filter((t) => t.id !== todo.id);
    render();
  }, 220);
  api(`todos/${todo.id}`, { method: "DELETE" }).catch(report);
}

function setDue(todo, due) {
  todo.due = due;
  render();
  api(`todos/${todo.id}`, { method: "PATCH", body: JSON.stringify({ due }) }).catch(report);
}

function startEdit(todo, li, wrap) {
  if (li.querySelector(".edit-input")) return;
  const input = document.createElement("input");
  input.className = "edit-input";
  input.value = todo.title;
  input.maxLength = 500;
  wrap.replaceChildren(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const title = input.value.trim();
    if (save && title && title !== todo.title) {
      todo.title = title;
      api(`todos/${todo.id}`, { method: "PATCH", body: JSON.stringify({ title }) }).catch(report);
    }
    render();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

async function clearDone() {
  state.todos = state.todos.filter((t) => !t.done);
  render();
  api("todos/done", { method: "DELETE" }).catch(report);
}

// --- drag to reorder ---------------------------------------------------------------

let dragId = null;

list.addEventListener("dragstart", (e) => {
  const li = e.target.closest(".item");
  if (!li) return;
  dragId = li.dataset.id;
  li.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragId);
});

list.addEventListener("dragover", (e) => {
  e.preventDefault();
  const li = e.target.closest(".item");
  clearDropMarks();
  if (!li || li.dataset.id === dragId) return;
  const before = e.clientY < li.getBoundingClientRect().top + li.offsetHeight / 2;
  li.classList.add(before ? "drop-above" : "drop-below");
});

list.addEventListener("dragleave", (e) => {
  if (e.target === list) clearDropMarks();
});

list.addEventListener("drop", (e) => {
  e.preventDefault();
  const target = e.target.closest(".item");
  clearDropMarks();
  if (!target || !dragId || target.dataset.id === dragId) return;
  const before = e.clientY < target.getBoundingClientRect().top + target.offsetHeight / 2;
  moveVisible(dragId, target.dataset.id, before);
});

list.addEventListener("dragend", () => {
  dragId = null;
  clearDropMarks();
  list.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
});

function clearDropMarks() {
  list.querySelectorAll(".drop-above, .drop-below").forEach((el) =>
    el.classList.remove("drop-above", "drop-below"));
}

// Reorder the visible items, then merge back into the full list so hidden
// (filtered-out) items keep their positions.
function moveVisible(id, targetId, before) {
  const visible = visibleTodos().map((t) => t.id);
  const from = visible.indexOf(id);
  visible.splice(from, 1);
  let to = visible.indexOf(targetId);
  if (!before) to += 1;
  visible.splice(to, 0, id);

  const queue = [...visible];
  const visibleSet = new Set(visible);
  const merged = state.todos.map((t) => {
    if (!visibleSet.has(t.id)) return t;
    return state.todos.find((x) => x.id === queue.shift());
  });
  state.todos = merged;
  render();
  api("todos/reorder", { method: "POST", body: JSON.stringify({ ids: state.todos.map((t) => t.id) }) }).catch(report);
}

// --- capture bar --------------------------------------------------------------------

$("#capture-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const title = captureInput.value.trim();
  if (!title) return;
  add(title, captureDue.value);
  captureInput.value = "";
  setCaptureChip("");
});

$("#capture-due-btn").addEventListener("click", () => openPicker(captureDue));
captureDue.addEventListener("change", () => setCaptureChip(captureDue.value));
$("#capture-chip-clear").addEventListener("click", () => setCaptureChip(""));

function setCaptureChip(due) {
  captureDue.value = due;
  const chip = $("#capture-chip");
  chip.hidden = !due;
  if (due) $("#capture-chip-text").textContent = "due " + dueLabel(due);
  captureInput.focus();
}

// --- filters & footer -----------------------------------------------------------------

document.querySelectorAll(".filter").forEach((btn) =>
  btn.addEventListener("click", () => {
    state.filter = btn.dataset.filter;
    localStorage.setItem("fabletodo:filter", state.filter);
    render();
  }),
);

$("#clear-done").addEventListener("click", clearDone);

// --- keyboard ----------------------------------------------------------------------------

document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
  if (e.key === "/" && !typing) {
    e.preventDefault();
    captureInput.focus();
  }
  if (e.key === "Escape" && document.activeElement === captureInput) {
    captureInput.blur();
  }
});

// --- boot --------------------------------------------------------------------------------

function renderDate() {
  $("#today-date").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
}

async function boot() {
  renderDate();
  try {
    state.todos = await api("todos");
  } catch (err) {
    report(err);
  }
  render();
}

boot();
