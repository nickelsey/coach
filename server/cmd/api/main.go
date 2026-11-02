// Command api serves the Coach sync API.
//
// Configuration comes from the environment:
//
//	DATABASE_URL     Postgres connection string (required)
//	COACH_API_TOKEN  bearer token clients must send, at least 32 chars (required)
//	LISTEN_ADDR      address to listen on (default ":8080")
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"coach/server/internal/api"
	"coach/server/internal/db"
	"coach/server/internal/store"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	dbURL := os.Getenv("DATABASE_URL")
	token := os.Getenv("COACH_API_TOKEN")
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	if dbURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	if len(token) < 32 {
		return errors.New("COACH_API_TOKEN must be at least 32 characters")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := connectWithRetry(ctx, dbURL, log)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           api.New(store.New(pool), token, log),
		ReadHeaderTimeout: 10 * time.Second,
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	log.Info("listening", "addr", addr)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

// connectWithRetry waits for Postgres, which may still be starting when the
// container comes up.
func connectWithRetry(ctx context.Context, url string, log *slog.Logger) (*pgxpool.Pool, error) {
	var lastErr error
	for attempt := 1; attempt <= 30; attempt++ {
		pool, err := db.Connect(ctx, url)
		if err == nil {
			return pool, nil
		}
		lastErr = err
		log.Warn("database not ready", "attempt", attempt, "err", err)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return nil, lastErr
}
