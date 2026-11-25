CREATE TABLE IF NOT EXISTS station_click_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub TEXT NOT NULL,
    email TEXT NOT NULL,
    station TEXT NOT NULL,
    station_name TEXT,
    clicked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_station_click_events_clicked_at
ON station_click_events (clicked_at DESC);

CREATE INDEX IF NOT EXISTS idx_station_click_events_google_sub
ON station_click_events (google_sub);

CREATE INDEX IF NOT EXISTS idx_station_click_events_station
ON station_click_events (station);
