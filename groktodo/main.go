package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(b)
}

type Todo struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Completed bool      `json:"completed"`
	Priority  string    `json:"priority"` // low | medium | high
	DueDate   *string   `json:"dueDate,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Store struct {
	mu    sync.RWMutex
	todos []Todo
	path  string
}

func NewStore(path string) (*Store, error) {
	s := &Store{path: path, todos: []Todo{}}
	if err := s.load(); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	return s, nil
}

func (s *Store) load() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, &s.todos)
}

func (s *Store) save() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s.todos, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o644)
}

func (s *Store) List() []Todo {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Todo, len(s.todos))
	copy(out, s.todos)
	return out
}

func (s *Store) Create(title, priority string, dueDate *string) (Todo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	if priority == "" {
		priority = "medium"
	}
	t := Todo{
		ID:        newID(),
		Title:     strings.TrimSpace(title),
		Completed: false,
		Priority:  priority,
		DueDate:   dueDate,
		CreatedAt: now,
		UpdatedAt: now,
	}
	s.todos = append(s.todos, t)
	return t, s.save()
}

func (s *Store) Update(id string, patch map[string]any) (Todo, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.todos {
		if s.todos[i].ID != id {
			continue
		}
		t := &s.todos[i]
		if v, ok := patch["title"].(string); ok {
			t.Title = strings.TrimSpace(v)
		}
		if v, ok := patch["completed"].(bool); ok {
			t.Completed = v
		}
		if v, ok := patch["priority"].(string); ok && v != "" {
			t.Priority = v
		}
		if v, ok := patch["dueDate"]; ok {
			switch d := v.(type) {
			case string:
				if d == "" {
					t.DueDate = nil
				} else {
					t.DueDate = &d
				}
			case nil:
				t.DueDate = nil
			}
		}
		t.UpdatedAt = time.Now().UTC()
		return *t, true, s.save()
	}
	return Todo{}, false, nil
}

func (s *Store) Delete(id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, t := range s.todos {
		if t.ID == id {
			s.todos = append(s.todos[:i], s.todos[i+1:]...)
			return true, s.save()
		}
	}
	return false, nil
}

func (s *Store) ClearCompleted() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	kept := s.todos[:0]
	n := 0
	for _, t := range s.todos {
		if t.Completed {
			n++
			continue
		}
		kept = append(kept, t)
	}
	s.todos = kept
	return n, s.save()
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func main() {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "data"
	}
	store, err := NewStore(filepath.Join(dataDir, "todos.json"))
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/todos", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, store.List())
	})

	mux.HandleFunc("POST /api/todos", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Title    string  `json:"title"`
			Priority string  `json:"priority"`
			DueDate  *string `json:"dueDate"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		if strings.TrimSpace(body.Title) == "" {
			writeError(w, http.StatusBadRequest, "title is required")
			return
		}
		switch body.Priority {
		case "", "low", "medium", "high":
		default:
			writeError(w, http.StatusBadRequest, "priority must be low, medium, or high")
			return
		}
		t, err := store.Create(body.Title, body.Priority, body.DueDate)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to save")
			return
		}
		writeJSON(w, http.StatusCreated, t)
	})

	mux.HandleFunc("PUT /api/todos/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		var patch map[string]any
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		t, ok, err := store.Update(id, patch)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to save")
			return
		}
		if !ok {
			writeError(w, http.StatusNotFound, "todo not found")
			return
		}
		writeJSON(w, http.StatusOK, t)
	})

	mux.HandleFunc("DELETE /api/todos/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		ok, err := store.Delete(id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to save")
			return
		}
		if !ok {
			writeError(w, http.StatusNotFound, "todo not found")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("DELETE /api/todos", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("completed") != "true" {
			writeError(w, http.StatusBadRequest, "use ?completed=true to clear completed todos")
			return
		}
		n, err := store.ClearCompleted()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to save")
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"cleared": n})
	})

	static := http.FileServer(http.Dir("static"))
	mux.Handle("GET /", static)
	mux.Handle("GET /static/", http.StripPrefix("/static/", static))

	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8080"
	}
	log.Printf("Todo app listening on http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
