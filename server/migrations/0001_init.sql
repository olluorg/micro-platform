-- Initial schema for ollu sync server.
-- App-agnostic: the server treats `app_id` opaquely. New apps appear without server changes.

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    email TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (provider, subject)
);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    refresh_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    refresh_expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_refresh ON sessions(refresh_hash);

-- Operations are stored in server-insertion order via `seq`. Cursor pagination
-- uses seq, not hlc, so out-of-order pushes still propagate to other devices.
-- HLC is kept for client-side LWW conflict resolution.
CREATE TABLE operations (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id),
    app_id TEXT NOT NULL,
    store TEXT NOT NULL,
    pk TEXT NOT NULL,
    op_type TEXT NOT NULL,
    hlc TEXT NOT NULL,
    payload TEXT,
    received_at INTEGER NOT NULL
);

CREATE INDEX idx_ops_user_app_seq ON operations(user_id, app_id, seq);
CREATE INDEX idx_ops_user_app_pk ON operations(user_id, app_id, store, pk);
