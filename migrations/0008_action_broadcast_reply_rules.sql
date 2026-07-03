CREATE TABLE IF NOT EXISTS broadcast_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#06C755',
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS broadcast_member_tags (
  line_user_id TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (line_user_id, tag_name)
);

CREATE TABLE IF NOT EXISTS reply_rules (
  id TEXT PRIMARY KEY,
  module_name TEXT NOT NULL DEFAULT '',
  keyword TEXT NOT NULL DEFAULT '',
  reply_type TEXT NOT NULL DEFAULT 'FLEX' CHECK (reply_type IN ('FLEX','IMAGE','TEXT')),
  payload TEXT NOT NULL DEFAULT '',
  preview_image_url TEXT NOT NULL DEFAULT '',
  flex_template TEXT NOT NULL DEFAULT '',
  alt_text TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS paid_broadcasts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'text',
  message_count INTEGER NOT NULL DEFAULT 1,
  audience_json TEXT NOT NULL DEFAULT '{}',
  target_count INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]',
  operator_uid TEXT NOT NULL DEFAULT '',
  test_mode INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_ts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_broadcast_member_tags_tag ON broadcast_member_tags(tag_name);
CREATE INDEX IF NOT EXISTS idx_reply_rules_active ON reply_rules(active);
CREATE INDEX IF NOT EXISTS idx_paid_broadcasts_created_ts ON paid_broadcasts(created_ts DESC);

