// Package store implements the sync protocol on top of Postgres.
//
// Clients push batches of changed records and pull everything with a
// server_seq above their cursor. Each entity type gets its own table and its
// own field in Changes; adding a type means adding a migration, a struct with
// upsert/pull functions, and wiring it into Push and Pull below.
package store

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Origins a record can come from.
var validOrigins = map[string]bool{"phone": true, "watch": true, "web": true, "mcp": true}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Changes is a set of records grouped by entity type.
type Changes struct {
	Fasts []Fast `json:"fasts"`
}

// PushResult says which records were written and which were skipped because
// the server already had an equal or newer version.
type PushResult struct {
	Applied []string `json:"applied"`
	Stale   []string `json:"stale"`
}

// PullResult is one page of changes. Cursor is the value to send as "since"
// on the next pull.
type PullResult struct {
	Changes Changes `json:"changes"`
	Cursor  int64   `json:"cursor"`
	HasMore bool    `json:"has_more"`
}

// ValidationError marks a request the client must fix; the API maps it to 400.
type ValidationError struct{ msg string }

func (e ValidationError) Error() string { return e.msg }

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Store is the Postgres-backed sync store.
type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Validate checks every record in the batch before anything is written.
func (c Changes) Validate() error {
	for i, f := range c.Fasts {
		if err := f.Validate(); err != nil {
			return ValidationError{fmt.Sprintf("fasts[%d]: %v", i, err)}
		}
	}
	return nil
}

// Push writes a batch atomically.
func (s *Store) Push(ctx context.Context, c Changes) (PushResult, error) {
	if err := c.Validate(); err != nil {
		return PushResult{}, err
	}
	res := PushResult{Applied: []string{}, Stale: []string{}}

	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// Serialize writers so server_seq values become visible in order;
		// otherwise a puller could advance past a seq still being committed.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(1)`); err != nil {
			return err
		}
		for _, f := range c.Fasts {
			ok, err := upsertFast(ctx, tx, f)
			if err != nil {
				return err
			}
			if ok {
				res.Applied = append(res.Applied, f.ID)
			} else {
				res.Stale = append(res.Stale, f.ID)
			}
		}
		return nil
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23514" { // check_violation
			return PushResult{}, ValidationError{pgErr.Message}
		}
		return PushResult{}, err
	}
	return res, nil
}

// Pull returns up to limit records changed after since, across all types,
// in server_seq order.
func (s *Store) Pull(ctx context.Context, since int64, limit int) (PullResult, error) {
	// Fetch limit+1 from each table so we can tell whether more remain.
	fasts, err := pullFasts(ctx, s.pool, since, limit+1)
	if err != nil {
		return PullResult{}, err
	}

	type seqer interface{ seq() int64 }
	var all []seqer
	for _, f := range fasts {
		all = append(all, f)
	}
	sort.Slice(all, func(i, j int) bool { return all[i].seq() < all[j].seq() })

	res := PullResult{Changes: Changes{Fasts: []Fast{}}, Cursor: since}
	if len(all) > limit {
		all = all[:limit]
		res.HasMore = true
	}
	for _, r := range all {
		switch v := r.(type) {
		case Fast:
			res.Changes.Fasts = append(res.Changes.Fasts, v)
		}
		res.Cursor = r.seq()
	}
	return res, nil
}

func validateMeta(id string, created, updated time.Time, origin string) error {
	if !uuidRe.MatchString(id) {
		return errors.New("id must be a UUID")
	}
	if created.IsZero() || updated.IsZero() {
		return errors.New("created_at and updated_at are required")
	}
	if updated.Before(created) {
		return errors.New("updated_at is before created_at")
	}
	if !validOrigins[origin] {
		return fmt.Errorf("unknown origin %q", origin)
	}
	return nil
}
