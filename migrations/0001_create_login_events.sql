CREATE TABLE IF NOT EXISTS login_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub TEXT NOT NULL,
    email TEXT NOT NULL,
    logged_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_events_logged_at
ON login_events (logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_events_google_sub
ON login_events (google_sub);
