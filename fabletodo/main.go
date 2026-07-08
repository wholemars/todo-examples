package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed static
var staticFS embed.FS

// Todo is one task. Order is implicit: the position in the store's slice.
type Todo struct {
	ID      string    `json:"id"`
	Title   string    `json:"title"`
	Done    bool      `json:"done"`
	Due     string    `json:"due,omitempty"` // YYYY-MM-DD, empty = no due date
	Created time.Time `json:"created"`
}

type Store struct {
	mu    sync.Mutex
	path  string
	todos []*Todo
}

func NewStore(path string) (*Store, error) {
	s := &Store{path: path, todos: []*Todo{}}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &s.todos); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	return s, nil
}

// save writes the list atomically: temp file + rename.
func (s *Store) save() error {
	data, err := json.MarshalIndent(s.todos, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *Store) List() []*Todo {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Todo, len(s.todos))
	copy(out, s.todos)
	return out
}

func (s *Store) Add(title, due string) (*Todo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t := &Todo{ID: newID(), Title: title, Due: due, Created: time.Now().UTC()}
	s.todos = append(s.todos, t)
	return t, s.save()
}

func (s *Store) find(id string) (int, *Todo) {
	for i, t := range s.todos {
		if t.ID == id {
			return i, t
		}
	}
	return -1, nil
}

func (s *Store) Update(id string, title *string, done *bool, due *string) (*Todo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, t := s.find(id)
	if t == nil {
		return nil, os.ErrNotExist
	}
	if title != nil {
		t.Title = *title
	}
	if done != nil {
		t.Done = *done
	}
	if due != nil {
		t.Due = *due
	}
	return t, s.save()
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	i, t := s.find(id)
	if t == nil {
		return os.ErrNotExist
	}
	s.todos = append(s.todos[:i], s.todos[i+1:]...)
	return s.save()
}

// Reorder rearranges todos to match ids. IDs not listed keep their
// relative order and follow the listed ones.
func (s *Store) Reorder(ids []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	byID := make(map[string]*Todo, len(s.todos))
	for _, t := range s.todos {
		byID[t.ID] = t
	}
	next := make([]*Todo, 0, len(s.todos))
	for _, id := range ids {
		if t, ok := byID[id]; ok {
			next = append(next, t)
			delete(byID, id)
		}
	}
	for _, t := range s.todos {
		if _, left := byID[t.ID]; left {
			next = append(next, t)
		}
	}
	s.todos = next
	return s.save()
}

func (s *Store) ClearDone() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := s.todos[:0]
	removed := 0
	for _, t := range s.todos {
		if t.Done {
			removed++
		} else {
			kept = append(kept, t)
		}
	}
	s.todos = kept
	return removed, s.save()
}

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func validTitle(title string) (string, bool) {
	title = strings.TrimSpace(title)
	return title, title != "" && len(title) <= 500
}

func validDue(due string) bool {
	if due == "" {
		return true
	}
	_, err := time.Parse("2006-01-02", due)
	return err == nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func main() {
	addr := flag.String("addr", "localhost:7373", "listen address")
	dataFile := flag.String("data", "todos.json", "path to the JSON data file")
	flag.Parse()

	store, err := NewStore(*dataFile)
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/todos", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, store.List())
	})

	mux.HandleFunc("POST /api/todos", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Title, Due string }
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		title, ok := validTitle(in.Title)
		if !ok {
			writeErr(w, http.StatusBadRequest, "title must be 1-500 characters")
			return
		}
		if !validDue(in.Due) {
			writeErr(w, http.StatusBadRequest, "due must be YYYY-MM-DD")
			return
		}
		t, err := store.Add(title, in.Due)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, t)
	})

	mux.HandleFunc("PATCH /api/todos/{id}", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Title *string `json:"title"`
			Done  *bool   `json:"done"`
			Due   *string `json:"due"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		if in.Title != nil {
			title, ok := validTitle(*in.Title)
			if !ok {
				writeErr(w, http.StatusBadRequest, "title must be 1-500 characters")
				return
			}
			in.Title = &title
		}
		if in.Due != nil && !validDue(*in.Due) {
			writeErr(w, http.StatusBadRequest, "due must be YYYY-MM-DD")
			return
		}
		t, err := store.Update(r.PathValue("id"), in.Title, in.Done, in.Due)
		if errors.Is(err, os.ErrNotExist) {
			writeErr(w, http.StatusNotFound, "no such todo")
			return
		}
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, t)
	})

	mux.HandleFunc("DELETE /api/todos/done", func(w http.ResponseWriter, r *http.Request) {
		n, err := store.ClearDone()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"removed": n})
	})

	mux.HandleFunc("DELETE /api/todos/{id}", func(w http.ResponseWriter, r *http.Request) {
		err := store.Delete(r.PathValue("id"))
		if errors.Is(err, os.ErrNotExist) {
			writeErr(w, http.StatusNotFound, "no such todo")
			return
		}
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("POST /api/todos/reorder", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ IDs []string `json:"ids"` }
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		if err := store.Reorder(in.IDs); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, store.List())
	})

	static, _ := fs.Sub(staticFS, "static")
	mux.Handle("/", http.FileServerFS(static))

	abs, _ := filepath.Abs(*dataFile)
	log.Printf("fabletodo listening on http://%s (data: %s)", *addr, abs)
	log.Fatal(http.ListenAndServe(*addr, mux))
}
