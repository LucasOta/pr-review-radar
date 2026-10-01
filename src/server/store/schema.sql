-- Cache: a projection of GitHub facts. Disposable (Constitution II).
CREATE TABLE IF NOT EXISTS pull_request_snapshots (
  repo                     TEXT    NOT NULL,
  number                   INTEGER NOT NULL,
  node_id                  TEXT    NOT NULL,
  title                    TEXT    NOT NULL,
  author                   TEXT    NOT NULL,
  is_draft                 INTEGER NOT NULL DEFAULT 0,
  url                      TEXT    NOT NULL,
  created_at               TEXT    NOT NULL,
  updated_at               TEXT    NOT NULL,
  head_sha                 TEXT    NOT NULL,
  base_ref                 TEXT    NOT NULL,
  reviews_json             TEXT    NOT NULL DEFAULT '[]',
  commits_json             TEXT    NOT NULL DEFAULT '[]',
  ai_comment_markers_json  TEXT    NOT NULL DEFAULT '[]',
  fetched_at               TEXT    NOT NULL,
  PRIMARY KEY (repo, number)
);

-- App-owned: one local AI review attempt.
CREATE TABLE IF NOT EXISTS review_runs (
  id           TEXT PRIMARY KEY,
  repo         TEXT    NOT NULL,
  number       INTEGER NOT NULL,
  head_sha     TEXT    NOT NULL,
  kind         TEXT    NOT NULL,
  status       TEXT    NOT NULL,
  forced       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL,
  started_at   TEXT,
  finished_at  TEXT,
  exit_code    INTEGER,
  stderr_tail  TEXT,
  error        TEXT
);

-- Drives the "already reviewed this SHA" skip (FR-022).
CREATE INDEX IF NOT EXISTS idx_runs_pr_sha ON review_runs (repo, number, head_sha, status);
CREATE INDEX IF NOT EXISTS idx_runs_pr_created ON review_runs (repo, number, created_at DESC);

-- App-owned: the reviewable product of a succeeded run.
CREATE TABLE IF NOT EXISTS review_drafts (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL UNIQUE,
  repo        TEXT    NOT NULL,
  number      INTEGER NOT NULL,
  head_sha    TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  status      TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  FOREIGN KEY (run_id) REFERENCES review_runs (id)
);

CREATE INDEX IF NOT EXISTS idx_drafts_pr_status ON review_drafts (repo, number, status);

-- App-owned: written only by github/post.ts, only after explicit confirmation (Constitution III).
-- The UNIQUE on draft_id is the database-level guarantee against double posting (FR-029).
CREATE TABLE IF NOT EXISTS posted_reviews (
  id           TEXT PRIMARY KEY,
  draft_id     TEXT    NOT NULL UNIQUE,
  repo         TEXT    NOT NULL,
  number       INTEGER NOT NULL,
  head_sha     TEXT    NOT NULL,
  comment_id   INTEGER NOT NULL,
  comment_url  TEXT    NOT NULL,
  posted_at    TEXT    NOT NULL,
  posted_as    TEXT    NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES review_drafts (id)
);

CREATE INDEX IF NOT EXISTS idx_posted_pr ON posted_reviews (repo, number, posted_at DESC);

-- Small key/value for app state that is not worth a table (last refresh, schema version).
CREATE TABLE IF NOT EXISTS app_state (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
