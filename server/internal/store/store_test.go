package store

import (
	"context"
	"os"
	"testing"
	"time"

	"coach/server/internal/db"
)

var t0 = time.Date(2026, 10, 27, 16, 30, 0, 0, time.UTC)

func validFast() Fast {
	return Fast{
		ID:          "7f1c5e3a-2b4d-4c6e-8f00-112233445566",
		StartedAt:   t0,
		GoalSeconds: 16 * 3600,
		CreatedAt:   t0,
		UpdatedAt:   t0,
		Origin:      "phone",
	}
}

func TestFastValidate(t *testing.T) {
	before := t0.Add(-time.Hour)
	cases := map[string]func(*Fast){
		"bad id":           func(f *Fast) { f.ID = "not-a-uuid" },
		"no start":         func(f *Fast) { f.StartedAt = time.Time{} },
		"ends before":      func(f *Fast) { f.EndedAt = &before },
		"zero goal":        func(f *Fast) { f.GoalSeconds = 0 },
		"unknown origin":   func(f *Fast) { f.Origin = "fridge" },
		"updated<created":  func(f *Fast) { f.UpdatedAt = before },
		"missing metadata": func(f *Fast) { f.CreatedAt = time.Time{} },
	}
	if err := validFast().Validate(); err != nil {
		t.Fatalf("valid fast rejected: %v", err)
	}
	for name, mutate := range cases {
		f := validFast()
		mutate(&f)
		if err := f.Validate(); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestMigrationsSorted(t *testing.T) {
	ms, err := db.Migrations()
	if err != nil || len(ms) == 0 {
		t.Fatalf("migrations: %v (n=%d)", err, len(ms))
	}
	for i := 1; i < len(ms); i++ {
		if ms[i-1].Name >= ms[i].Name {
			t.Errorf("out of order: %s, %s", ms[i-1].Name, ms[i].Name)
		}
	}
}

// TestSyncRoundTrip runs against a real, disposable Postgres database:
//
//	COACH_TEST_DATABASE_URL=postgres://... go test ./...
//
// It drops and recreates the schema, so never point it at real data.
func TestSyncRoundTrip(t *testing.T) {
	url := os.Getenv("COACH_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("COACH_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err := pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public`); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatalf("second migrate should be a no-op: %v", err)
	}
	s := New(pool)

	f := validFast()
	res, err := s.Push(ctx, Changes{Fasts: []Fast{f}})
	if err != nil || len(res.Applied) != 1 {
		t.Fatalf("first push: %+v, %v", res, err)
	}

	// Re-pushing the same version is stale, not an error.
	res, err = s.Push(ctx, Changes{Fasts: []Fast{f}})
	if err != nil || len(res.Stale) != 1 {
		t.Fatalf("repush: %+v, %v", res, err)
	}

	page, err := s.Pull(ctx, 0, 100)
	if err != nil || len(page.Changes.Fasts) != 1 {
		t.Fatalf("pull: %+v, %v", page, err)
	}
	cursor := page.Cursor

	// A newer edit wins and moves the row past the cursor.
	end := t0.Add(16 * time.Hour)
	f.EndedAt, f.UpdatedAt = &end, end
	if res, err := s.Push(ctx, Changes{Fasts: []Fast{f}}); err != nil || len(res.Applied) != 1 {
		t.Fatalf("update push: %+v, %v", res, err)
	}
	page, err = s.Pull(ctx, cursor, 100)
	if err != nil || len(page.Changes.Fasts) != 1 || page.Changes.Fasts[0].EndedAt == nil {
		t.Fatalf("pull after update: %+v, %v", page, err)
	}

	// An older edit loses.
	older := f
	older.UpdatedAt = t0.Add(time.Hour)
	older.Notes = "stale"
	if res, _ := s.Push(ctx, Changes{Fasts: []Fast{older}}); len(res.Stale) != 1 {
		t.Fatalf("older edit should be stale: %+v", res)
	}

	// Paging: three new rows, limit 2.
	var batch []Fast
	for _, id := range []string{
		"00000000-0000-4000-8000-000000000001",
		"00000000-0000-4000-8000-000000000002",
		"00000000-0000-4000-8000-000000000003",
	} {
		g := validFast()
		g.ID = id
		batch = append(batch, g)
	}
	if _, err := s.Push(ctx, Changes{Fasts: batch}); err != nil {
		t.Fatal(err)
	}
	page, _ = s.Pull(ctx, 0, 2)
	if len(page.Changes.Fasts) != 2 || !page.HasMore {
		t.Fatalf("page 1: %+v", page)
	}
	page, _ = s.Pull(ctx, page.Cursor, 2)
	if len(page.Changes.Fasts) != 2 || page.HasMore {
		t.Fatalf("page 2: %+v", page)
	}
}
