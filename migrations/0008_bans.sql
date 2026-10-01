-- Senders turned away for a while. `who` is a hash of the secret and the sender's address (an IPv6 one cut to its /64),
-- kept only while a ban lasts and 30 days after, then deleted. It never goes into the visit counts.
CREATE TABLE bans (
  who TEXT PRIMARY KEY,
  until TEXT NOT NULL,
  strikes INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX bans_until ON bans (until);

-- The same hash on a report, so the owner can ban whoever sent it. Cleared a week after the report arrives; the
-- report itself stays until the owner downloads and deletes it.
ALTER TABLE reports ADD COLUMN who TEXT NOT NULL DEFAULT '';
