-- Answers to the short questions the app asks: after trying a part of it, and under Settings › Updates for a version.
-- One row for each thing a person did with a question (it was shown, answered, put off, closed, or switched off for
-- good). No id, address or time of day finer than the second the row was written; the rating is 1 to 5 on an answer.
CREATE TABLE polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- Which question: a short name for a part of the app, or "update-" and the version.
  q TEXT NOT NULL,
  act TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  -- Where it was asked: popup or update.
  src TEXT NOT NULL DEFAULT 'popup',
  -- Which address it came in on (set by the server) and the app's version.
  host TEXT NOT NULL DEFAULT '',
  ver TEXT NOT NULL DEFAULT ''
);

CREATE INDEX polls_q ON polls (q, id);
