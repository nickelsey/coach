package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"coach/server/internal/store"
)

const testToken = "test-token-0123456789-0123456789-abcdef"

type fakeSyncer struct {
	pushed    store.Changes
	pushErr   error
	pullSince int64
	pullLimit int
}

func (f *fakeSyncer) Push(_ context.Context, c store.Changes) (store.PushResult, error) {
	f.pushed = c
	if f.pushErr != nil {
		return store.PushResult{}, f.pushErr
	}
	return store.PushResult{Applied: []string{"a"}, Stale: []string{}}, nil
}

func (f *fakeSyncer) Pull(_ context.Context, since int64, limit int) (store.PullResult, error) {
	f.pullSince, f.pullLimit = since, limit
	return store.PullResult{Changes: store.Changes{Fasts: []store.Fast{}}, Cursor: since}, nil
}

func newTestServer(t *testing.T, s Syncer) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(New(s, testToken, slog.New(slog.NewTextHandler(io.Discard, nil))))
	t.Cleanup(srv.Close)
	return srv
}

func do(t *testing.T, method, url, token, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func TestHealthzNeedsNoToken(t *testing.T) {
	srv := newTestServer(t, &fakeSyncer{})
	if resp := do(t, "GET", srv.URL+"/healthz", "", ""); resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
}

func TestSyncRequiresToken(t *testing.T) {
	srv := newTestServer(t, &fakeSyncer{})
	for _, tok := range []string{"", "wrong-token"} {
		if resp := do(t, "GET", srv.URL+"/v1/sync/pull", tok, ""); resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("token %q: status = %d, want 401", tok, resp.StatusCode)
		}
	}
}

func TestPullParams(t *testing.T) {
	f := &fakeSyncer{}
	srv := newTestServer(t, f)

	resp := do(t, "GET", srv.URL+"/v1/sync/pull?since=42&limit=10", testToken, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if f.pullSince != 42 || f.pullLimit != 10 {
		t.Errorf("got since=%d limit=%d, want 42, 10", f.pullSince, f.pullLimit)
	}

	do(t, "GET", srv.URL+"/v1/sync/pull", testToken, "")
	if f.pullSince != 0 || f.pullLimit != defaultPullLimit {
		t.Errorf("defaults: got since=%d limit=%d", f.pullSince, f.pullLimit)
	}

	for _, q := range []string{"since=-1", "since=abc", "limit=0", "limit=5000"} {
		if resp := do(t, "GET", srv.URL+"/v1/sync/pull?"+q, testToken, ""); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", q, resp.StatusCode)
		}
	}
}

func TestPushDecodesBody(t *testing.T) {
	f := &fakeSyncer{}
	srv := newTestServer(t, f)
	body := `{"fasts":[{"id":"7f1c5e3a-2b4d-4c6e-8f00-112233445566","started_at":"2026-10-27T16:30:00Z",
		"ended_at":null,"goal_seconds":57600,"notes":"","created_at":"2026-10-27T16:30:00Z",
		"updated_at":"2026-10-27T16:30:00Z","deleted_at":null,"origin":"phone"}]}`

	resp := do(t, "POST", srv.URL+"/v1/sync/push", testToken, body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if len(f.pushed.Fasts) != 1 || f.pushed.Fasts[0].GoalSeconds != 57600 {
		t.Errorf("pushed = %+v", f.pushed)
	}
	var res store.PushResult
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil || len(res.Applied) != 1 {
		t.Errorf("response = %+v, err %v", res, err)
	}
}

func TestPushRejectsBadInput(t *testing.T) {
	srv := newTestServer(t, &fakeSyncer{})
	for name, body := range map[string]string{
		"malformed":     `{"fasts":[`,
		"unknown field": `{"workouts":[]}`,
	} {
		if resp := do(t, "POST", srv.URL+"/v1/sync/push", testToken, body); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", name, resp.StatusCode)
		}
	}
}

func TestPushValidationErrorIs400(t *testing.T) {
	srv := newTestServer(t, &fakeSyncer{pushErr: store.ValidationError{}})
	if resp := do(t, "POST", srv.URL+"/v1/sync/push", testToken, `{"fasts":[]}`); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}
