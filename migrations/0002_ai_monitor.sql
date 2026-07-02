PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_monitor_insights (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL DEFAULT '',
  source_message_ids TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '一般問題',
  risk_level TEXT NOT NULL DEFAULT 'low'
    CHECK (risk_level IN ('low', 'medium', 'high')),
  summary TEXT NOT NULL DEFAULT '',
  recommended_action TEXT NOT NULL DEFAULT '',
  sentiment TEXT NOT NULL DEFAULT 'neutral'
    CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  tags TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_monitor_insights_thread
  ON ai_monitor_insights(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_monitor_insights_risk
  ON ai_monitor_insights(risk_level, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_monitor_insights_category
  ON ai_monitor_insights(category, created_at);