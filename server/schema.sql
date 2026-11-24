-- Chud Tiles online leaderboard (Cloudflare D1).
-- Apply: npx wrangler d1 execute chud-tiles-scores --remote --file server/schema.sql -c server/wrangler.jsonc

CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,
  pseudo TEXT NOT NULL,
  pseudo_key TEXT NOT NULL,
  song_key TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT,
  source TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  lanes INTEGER NOT NULL,
  score INTEGER NOT NULL,
  accuracy REAL NOT NULL,
  max_combo INTEGER NOT NULL,
  centre INTEGER NOT NULL,
  perfect INTEGER NOT NULL,
  great INTEGER NOT NULL,
  good INTEGER NOT NULL,
  miss INTEGER NOT NULL,
  hold_ok INTEGER NOT NULL,
  hold_break INTEGER NOT NULL,
  rank TEXT NOT NULL,
  full_combo INTEGER NOT NULL,
  chart_level INTEGER NOT NULL,
  duration REAL NOT NULL,
  version TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scores_board ON scores (song_key, difficulty, lanes, score DESC);
CREATE INDEX IF NOT EXISTS scores_recent ON scores (at DESC);
CREATE INDEX IF NOT EXISTS scores_recent_diff ON scores (difficulty, at DESC);

-- how often a sender publishes: salted hash of the address, kept one hour
CREATE TABLE IF NOT EXISTS posts (
  who TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_who ON posts (who, at);
