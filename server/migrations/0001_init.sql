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
    refresh_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE operations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    app_id TEXT NOT NULL,
    store TEXT NOT NULL,
    pk TEXT NOT NULL,
    op_type TEXT NOT NULL,
    hlc TEXT NOT NULL,
    payload TEXT,
    received_at INTEGER NOT NULL
);

CREATE INDEX idx_ops_user_app_hlc ON operations(user_id, app_id, hlc);
CREATE INDEX idx_ops_user_app_pk ON operations(user_id, app_id, store, pk);
