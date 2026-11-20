ALTER TABLE login_events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'google_login';
ALTER TABLE login_events ADD COLUMN status TEXT NOT NULL DEFAULT 'success';
ALTER TABLE login_events ADD COLUMN name TEXT;
ALTER TABLE login_events ADD COLUMN picture TEXT;
ALTER TABLE login_events ADD COLUMN email_verified INTEGER;
ALTER TABLE login_events ADD COLUMN ip TEXT;
ALTER TABLE login_events ADD COLUMN user_agent TEXT;
ALTER TABLE login_events ADD COLUMN browser TEXT;
ALTER TABLE login_events ADD COLUMN os TEXT;
ALTER TABLE login_events ADD COLUMN device_type TEXT;
ALTER TABLE login_events ADD COLUMN country TEXT;
ALTER TABLE login_events ADD COLUMN continent TEXT;
ALTER TABLE login_events ADD COLUMN city TEXT;
ALTER TABLE login_events ADD COLUMN region TEXT;
ALTER TABLE login_events ADD COLUMN region_code TEXT;
ALTER TABLE login_events ADD COLUMN postal_code TEXT;
ALTER TABLE login_events ADD COLUMN latitude TEXT;
ALTER TABLE login_events ADD COLUMN longitude TEXT;
ALTER TABLE login_events ADD COLUMN timezone TEXT;
ALTER TABLE login_events ADD COLUMN is_eu_country INTEGER;
ALTER TABLE login_events ADD COLUMN asn INTEGER;
ALTER TABLE login_events ADD COLUMN as_organization TEXT;
ALTER TABLE login_events ADD COLUMN colo TEXT;
ALTER TABLE login_events ADD COLUMN cf_ray TEXT;
ALTER TABLE login_events ADD COLUMN accept_language TEXT;
ALTER TABLE login_events ADD COLUMN referer TEXT;
ALTER TABLE login_events ADD COLUMN origin TEXT;
ALTER TABLE login_events ADD COLUMN http_protocol TEXT;
ALTER TABLE login_events ADD COLUMN tls_version TEXT;
ALTER TABLE login_events ADD COLUMN client_tcp_rtt INTEGER;
ALTER TABLE login_events ADD COLUMN request_method TEXT;
ALTER TABLE login_events ADD COLUMN request_path TEXT;
ALTER TABLE login_events ADD COLUMN failure_reason TEXT;
ALTER TABLE login_events ADD COLUMN metadata_json TEXT;

CREATE INDEX IF NOT EXISTS idx_login_events_email
ON login_events (email);

CREATE INDEX IF NOT EXISTS idx_login_events_status
ON login_events (status);
