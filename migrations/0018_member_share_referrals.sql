CREATE TABLE IF NOT EXISTS member_share_links (
  id TEXT PRIMARY KEY,
  share_code TEXT NOT NULL UNIQUE,
  owner_line_user_id TEXT NOT NULL UNIQUE,
  invite_url TEXT NOT NULL DEFAULT '',
  qr_url TEXT NOT NULL DEFAULT '',
  click_count INTEGER NOT NULL DEFAULT 0,
  join_count INTEGER NOT NULL DEFAULT 0,
  last_clicked_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_member_share_links_owner
  ON member_share_links(owner_line_user_id);

CREATE TABLE IF NOT EXISTS member_referral_events (
  id TEXT PRIMARY KEY,
  share_code TEXT NOT NULL,
  owner_line_user_id TEXT NOT NULL,
  referred_line_user_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_member_referral_events_share
  ON member_referral_events(share_code, created_at);

CREATE INDEX IF NOT EXISTS idx_member_referral_events_referred
  ON member_referral_events(referred_line_user_id, event_type);
