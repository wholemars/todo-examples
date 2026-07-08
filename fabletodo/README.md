# fabletodo

A small, fast todo app. Vanilla HTML/CSS/JS frontend, Go standard-library backend,
tasks persisted to a JSON file. The frontend is embedded in the binary, so the whole
app ships as a single executable.

## Run

```sh
go run .                  # serves http://localhost:7373, data in ./todos.json
```

or build a single binary:

```sh
go build -o fabletodo .
./fabletodo -addr localhost:7373 -data todos.json
```

Note: the frontend is embedded at compile time — after editing files in `static/`,
rebuild (`go build`) to pick up changes.

## Features

- Add tasks (Enter), edit inline (double-click or the pencil), delete, check off
- Optional due dates with today / tomorrow / overdue states
- Drag to reorder, persisted across restarts
- Filters (All / Open / Done), live counts, clear done
- Keyboard: `/` focuses the input, `Esc` cancels an edit
- Light and dark themes follow the system setting

## API

| Method   | Path                 | Body                          |
| -------- | -------------------- | ----------------------------- |
| `GET`    | `/api/todos`         | —                             |
| `POST`   | `/api/todos`         | `{"title", "due?"}`           |
| `PATCH`  | `/api/todos/{id}`    | any of `title`, `done`, `due` |
| `DELETE` | `/api/todos/{id}`    | —                             |
| `DELETE` | `/api/todos/done`    | — (clears completed)          |
| `POST`   | `/api/todos/reorder` | `{"ids": [...]}`              |

Dates are `YYYY-MM-DD`; an empty `due` clears the date.
