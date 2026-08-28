CREATE TABLE IF NOT EXISTS smart_menu_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  industry TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',
  asset_id TEXT,
  area_count INTEGER DEFAULT 0,
  page_count INTEGER DEFAULT 1,
  ai_provider TEXT DEFAULT '',
  ai_model TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_smart_menu_templates_workspace
  ON smart_menu_templates (workspace_id, deleted_at, updated_at);

CREATE TABLE IF NOT EXISTS smart_menu_template_areas (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  area_index INTEGER NOT NULL,
  label TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  action_type TEXT DEFAULT 'none',
  action_uri TEXT,
  action_text TEXT,
  action_data TEXT,
  action_display_text TEXT,
  target_page_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_smart_menu_template_areas_template
  ON smart_menu_template_areas (workspace_id, template_id, area_index);
