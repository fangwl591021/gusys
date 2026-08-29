CREATE TABLE IF NOT EXISTS line_ai_reply_usage (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  line_user_id TEXT NOT NULL,
  keyword TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL,
  block_reason TEXT NOT NULL DEFAULT '',
  response_preview TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_line_ai_reply_usage_user_created
  ON line_ai_reply_usage (line_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_line_ai_reply_usage_outcome_created
  ON line_ai_reply_usage (outcome, created_at);
