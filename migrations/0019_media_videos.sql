CREATE TABLE IF NOT EXISTS media_videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  media_label TEXT NOT NULL DEFAULT '官方影音',
  source_url TEXT NOT NULL,
  source_label TEXT NOT NULL DEFAULT '開啟店家影音',
  playback_mode TEXT NOT NULL DEFAULT 'external',
  poster_url TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_media_videos_status_order
  ON media_videos(status, display_order, created_at);

INSERT OR IGNORE INTO media_videos (
  id, title, description, media_label, source_url, source_label,
  playback_mode, display_order, status
) VALUES (
  'store-live-001',
  '重口味現場直擊',
  '來看看重口味溫泉魚現場的真實互動體驗！',
  '官方影音',
  'https://lisa-content.line-apps.com/eyJjb250ZW5jRW5jIjp0cnVlLCJjb250ZW50VXJpIjoiN2lndGdhaTVHQjJueXdLa3l6Wnh2cFo0ODlwcWlnVHg5eWwrWmpacXBJVFVOcEdTbk9XL2hwQkxVNEgxYlNnbkIyb25NaTd2b3ROV1dMcDl4TUhIaDFUb2N0ZENBMjQ2cllyTWJXTUErMnQ4WmZ0Q2FQSGRjUDhTYzdxQmRVMTY0c1BpTEVQeEdMalo2NitUUW1nc0x5VHJCOFU3V3U1MWdHK1h3TWxTRi9DQTJCWHE2VWNkTkxGWFp2SXFCeE1qIiwiaXNzIjoiTElTQSIsImlhdCI6MTc4ODAxMDE3MiwiYXVkIjoibGlnaHRzIn0.qt-vxu0FtKkToYp9nJr1a9_USyvV1-EYBznizej7g-M',
  '開啟店家影音',
  'external',
  10,
  'active'
);
