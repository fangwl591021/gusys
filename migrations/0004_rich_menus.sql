CREATE TABLE IF NOT EXISTS rich_menus (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  alias_id TEXT NOT NULL DEFAULT '',
  chat_bar_text TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL DEFAULT '{}',
  image_data_url TEXT NOT NULL DEFAULT '',
  line_rich_menu_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  deployed_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rich_menus_updated_at
  ON rich_menus(updated_at);