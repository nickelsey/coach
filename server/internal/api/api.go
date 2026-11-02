// Package api is the HTTP layer: auth, request decoding and routing.
package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"coach/server/internal/store"
)

const (
	maxBodyBytes     = 5 << 20
	defaultPullLimit = 500
	maxPullLimit     = 2000
)

// Syncer is the storage the handlers need; *store.Store implements it.
type Syncer interface {
	Push(ctx context.Context, c store.Changes) (store.PushResult, error)
	Pull(ctx context.Context, since int64, limit int) (store.PullResult, error)
}

// New returns the API handler. Every /v1 route requires the bearer token.
func New(s Syncer, token string, log *slog.Logger) http.Handler {
	h := &handlers{s: s, log: log}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	v1 := http.NewServeMux()
	v1.HandleFunc("POST /v1/sync/push", h.push)
	v1.HandleFunc("GET /v1/sync/pull", h.pull)
	mux.Handle("/v1/", requireToken(token, v1))
	return mux
}

type handlers struct {
	s   Syncer
	log *slog.Logger
}

func (h *handlers) push(w http.ResponseWriter, r *http.Request) {
	var c store.Changes
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	res, err := h.s.Push(r.Context(), c)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *handlers) pull(w http.ResponseWriter, r *http.Request) {
	since, err := intParam(r, "since", 0)
	if err != nil || since < 0 {
		writeError(w, http.StatusBadRequest, "since must be a non-negative integer")
		return
	}
	limit, err := intParam(r, "limit", defaultPullLimit)
	if err != nil || limit < 1 || limit > maxPullLimit {
		writeError(w, http.StatusBadRequest, "limit must be between 1 and 2000")
		return
	}
	res, err := h.s.Pull(r.Context(), since, int(limit))
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *handlers) fail(w http.ResponseWriter, err error) {
	var ve store.ValidationError
	if errors.As(err, &ve) {
		writeError(w, http.StatusBadRequest, ve.Error())
		return
	}
	h.log.Error("request failed", "err", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

func requireToken(token string, next http.Handler) http.Handler {
	want := []byte("Bearer " + token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := []byte(r.Header.Get("Authorization"))
		if subtle.ConstantTimeCompare(got, want) != 1 {
			writeError(w, http.StatusUnauthorized, "missing or invalid token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func intParam(r *http.Request, name string, def int64) (int64, error) {
	v := strings.TrimSpace(r.URL.Query().Get(name))
	if v == "" {
		return def, nil
	}
	return strconv.ParseInt(v, 10, 64)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
