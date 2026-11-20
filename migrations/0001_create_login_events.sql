CREATE TABLE IF NOT EXISTS login_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL,
    email TEXT,
    google_sub TEXT,
    name TEXT,
    picture TEXT,
    email_verified INTEGER,
    logged_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    browser TEXT,
    os TEXT,
    device_type TEXT,
    country TEXT,
    continent TEXT,
    city TEXT,
    region TEXT,
    region_code TEXT,
    postal_code TEXT,
    latitude TEXT,
    longitude TEXT,
    timezone TEXT,
    is_eu_country INTEGER,
    asn INTEGER,
    as_organization TEXT,
    colo TEXT,
    cf_ray TEXT,
    accept_language TEXT,
    referer TEXT,
    origin TEXT,
    http_protocol TEXT,
    tls_version TEXT,
    client_tcp_rtt INTEGER,
    request_method TEXT,
    request_path TEXT,
    failure_reason TEXT,
    metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_login_events_logged_at
ON login_events (logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_events_google_sub
ON login_events (google_sub);

CREATE INDEX IF NOT EXISTS idx_login_events_email
ON login_events (email);

CREATE INDEX IF NOT EXISTS idx_login_events_status
ON login_events (status);
