-- The hourly limits become one counter per sender and clock hour, with no finer time kept, so a
-- counter can't be lined up with the time a report arrived.
DROP TABLE hits;

CREATE TABLE hits (
  -- Hash of the secret, the hour and the address (or its IPv6 /64 or /48), never stored with a report.
  sender TEXT PRIMARY KEY,
  hour TEXT NOT NULL,
  n INTEGER NOT NULL,
  -- Random tag of the request that last took this slot; the report is stored only if it took every slot.
  last TEXT NOT NULL DEFAULT ''
);

CREATE INDEX hits_hour ON hits (hour);
