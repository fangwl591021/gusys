CREATE TABLE IF NOT EXISTS smart_menu_assets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'gusys',
  image_data_url TEXT NOT NULL DEFAULT '',
  original_filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 2500,
  height INTEGER NOT NULL DEFAULT 1686,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS smart_menu_projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'gusys',
  template_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  asset_id TEXT,
  chat_bar_text TEXT NOT NULL DEFAULT '選單',
  page_count INTEGER NOT NULL DEFAULT 1,
  line_rich_menu_id TEXT NOT NULL DEFAULT '',
  rich_menu_alias_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS smart_menu_project_areas (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'gusys',
  project_id TEXT NOT NULL,
  area_index INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 0,
  height REAL NOT NULL DEFAULT 0,
  action_type TEXT NOT NULL DEFAULT 'message',
  action_uri TEXT NOT NULL DEFAULT '',
  action_text TEXT NOT NULL DEFAULT '',
  action_data TEXT NOT NULL DEFAULT '',
  action_display_text TEXT NOT NULL DEFAULT '',
  target_page_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_smart_menu_assets_workspace ON smart_menu_assets(workspace_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_smart_menu_projects_workspace ON smart_menu_projects(workspace_id, deleted_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_smart_menu_project_areas_project ON smart_menu_project_areas(project_id, area_index);
CREATE UNIQUE INDEX IF NOT EXISTS idx_smart_menu_project_areas_order ON smart_menu_project_areas(project_id, area_index);
