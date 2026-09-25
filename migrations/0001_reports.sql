-- Feedback sent from the app's report dialog.
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'idea')),
  status TEXT NOT NULL DEFAULT 'new',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  steps TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  -- The factory or power grid the sender chose to attach, as JSON.
  plan TEXT,
  -- App and game data version, planner, tier, screen, browser.
  meta TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX reports_created ON reports (created);
CREATE INDEX reports_status ON reports (status, id);

-- The hourly limit: one row per report sent in the last hour, keyed by a hash of the sender's address
-- that changes every hour. Nothing ties these to a report, and rows older than an hour are deleted.
CREATE TABLE hits (
  sender TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX hits_sender ON hits (sender);
CREATE INDEX hits_at ON hits (at);
