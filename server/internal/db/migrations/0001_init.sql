-- Every synced write takes the next value from this sequence. Clients pull
-- "everything with server_seq > cursor", which avoids relying on device clocks.
CREATE SEQUENCE sync_seq;

CREATE TABLE fasts (
    id           uuid PRIMARY KEY,
    started_at   timestamptz NOT NULL,
    ended_at     timestamptz,
    goal_seconds integer     NOT NULL CHECK (goal_seconds > 0),
    notes        text        NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL,
    deleted_at   timestamptz,
    origin       text        NOT NULL,
    server_seq   bigint      NOT NULL DEFAULT nextval('sync_seq'),
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX fasts_server_seq_idx ON fasts (server_seq);
