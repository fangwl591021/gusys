CREATE TABLE IF NOT EXISTS ai_usage_ledger (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,
  feature_code TEXT NOT NULL,
  operation_code TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_request_id TEXT,
  status TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  provider_cost_micros INTEGER NOT NULL DEFAULT 0,
  billable_cost_micros INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_workspace_created
  ON ai_usage_ledger (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_usage_feature_created
  ON ai_usage_ledger (feature_code, created_at);
