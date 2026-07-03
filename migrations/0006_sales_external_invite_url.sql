ALTER TABLE sales_reps ADD COLUMN external_invite_url TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_sales_reps_external_invite_url
  ON sales_reps(external_invite_url);
