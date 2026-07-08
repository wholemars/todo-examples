# Todo

A simple, beautiful full-featured todo app built with web standards and Go.

## Features

- Add, complete, edit, and delete tasks
- Priority levels (low / medium / high)
- Optional due dates with overdue highlighting
- Search, status filters (all / active / done), and sorting
- Clear all completed tasks
- Persistent storage (JSON file via Go API)
- Responsive layout, keyboard-friendly editing

## Run

```bash
go run .
```

Open [http://localhost:8080](http://localhost:8080).

Optional env vars:

- `ADDR` — listen address (default `:8080`)
- `DATA_DIR` — directory for `todos.json` (default `data`)

## Stack

- **Frontend:** HTML5, CSS, vanilla JavaScript
- **Backend:** Go `net/http` REST API, JSON file persistence
