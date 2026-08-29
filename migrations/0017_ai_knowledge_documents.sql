CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'text/plain',
  content TEXT NOT NULL DEFAULT '',
  content_size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_status_updated
  ON ai_knowledge_documents (status, updated_at);
