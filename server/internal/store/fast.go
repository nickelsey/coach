package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Fast is one fasting period. EndedAt is nil while the fast is running.
type Fast struct {
	ID          string     `json:"id"`
	StartedAt   time.Time  `json:"started_at"`
	EndedAt     *time.Time `json:"ended_at"`
	GoalSeconds int        `json:"goal_seconds"`
	Notes       string     `json:"notes"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	DeletedAt   *time.Time `json:"deleted_at"`
	Origin      string     `json:"origin"`
	ServerSeq   int64      `json:"server_seq,omitempty"`
}

func (f Fast) seq() int64 { return f.ServerSeq }

// Validate checks the fields a client is responsible for.
func (f Fast) Validate() error {
	if err := validateMeta(f.ID, f.CreatedAt, f.UpdatedAt, f.Origin); err != nil {
		return err
	}
	if f.StartedAt.IsZero() {
		return errors.New("started_at is required")
	}
	if f.EndedAt != nil && f.EndedAt.Before(f.StartedAt) {
		return errors.New("ended_at is before started_at")
	}
	if f.GoalSeconds <= 0 {
		return errors.New("goal_seconds must be positive")
	}
	return nil
}

// upsertFast writes f unless the stored row is as new or newer
// (last-writer-wins on updated_at). It reports whether the row was written.
func upsertFast(ctx context.Context, tx pgx.Tx, f Fast) (bool, error) {
	tag, err := tx.Exec(ctx, `
		INSERT INTO fasts (id, started_at, ended_at, goal_seconds, notes,
		                   created_at, updated_at, deleted_at, origin)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (id) DO UPDATE SET
			started_at   = EXCLUDED.started_at,
			ended_at     = EXCLUDED.ended_at,
			goal_seconds = EXCLUDED.goal_seconds,
			notes        = EXCLUDED.notes,
			updated_at   = EXCLUDED.updated_at,
			deleted_at   = EXCLUDED.deleted_at,
			origin       = EXCLUDED.origin,
			server_seq   = nextval('sync_seq')
		WHERE fasts.updated_at < EXCLUDED.updated_at`,
		f.ID, f.StartedAt, f.EndedAt, f.GoalSeconds, f.Notes,
		f.CreatedAt, f.UpdatedAt, f.DeletedAt, f.Origin)
	if err != nil {
		return false, fmt.Errorf("upsert fast %s: %w", f.ID, err)
	}
	return tag.RowsAffected() == 1, nil
}

func pullFasts(ctx context.Context, q querier, since int64, limit int) ([]Fast, error) {
	rows, err := q.Query(ctx, `
		SELECT id::text, started_at, ended_at, goal_seconds, notes,
		       created_at, updated_at, deleted_at, origin, server_seq
		FROM fasts
		WHERE server_seq > $1
		ORDER BY server_seq
		LIMIT $2`, since, limit)
	if err != nil {
		return nil, fmt.Errorf("pull fasts: %w", err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Fast, error) {
		var f Fast
		err := r.Scan(&f.ID, &f.StartedAt, &f.EndedAt, &f.GoalSeconds, &f.Notes,
			&f.CreatedAt, &f.UpdatedAt, &f.DeletedAt, &f.Origin, &f.ServerSeq)
		return f, err
	})
}
