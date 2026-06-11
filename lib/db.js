const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'pronos.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS pools (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id    INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  name       TEXT NOT NULL COLLATE NOCASE,
  pin_hash   TEXT,
  key        TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(pool_id, name)
);

CREATE TABLE IF NOT EXISTS matches (
  id         INTEGER PRIMARY KEY,   -- numéro de match FIFA (1..104)
  round      INTEGER NOT NULL,
  stage      TEXT NOT NULL,         -- group | r32 | r16 | qf | sf | third | final
  grp        TEXT,                  -- 'A'..'L' (phase de groupes uniquement)
  date_utc   TEXT NOT NULL,
  location   TEXT,
  home       TEXT NOT NULL,         -- nom d'équipe ou placeholder ("2A", "To be announced")
  away       TEXT NOT NULL,
  home_score INTEGER,
  away_score INTEGER,
  advancer   TEXT                   -- équipe qualifiée (matchs à élimination, déduit ou fourni)
);

CREATE TABLE IF NOT EXISTS predictions (
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  match_id   INTEGER NOT NULL REFERENCES matches(id),
  home       INTEGER NOT NULL,
  away       INTEGER NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (player_id, match_id)
);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
`);

// migrations légères : colonnes scores en direct (ESPN)
const matchCols = db.prepare('PRAGMA table_info(matches)').all().map((c) => c.name);
for (const [col, type] of [['live_hs', 'INTEGER'], ['live_as', 'INTEGER'], ['live_min', 'TEXT'], ['live_state', 'TEXT']]) {
  if (!matchCols.includes(col)) db.exec(`ALTER TABLE matches ADD COLUMN ${col} ${type}`);
}

// migration : langue par défaut d'un pool (fr | en)
const poolCols = db.prepare('PRAGMA table_info(pools)').all().map((c) => c.name);
if (!poolCols.includes('lang')) db.exec("ALTER TABLE pools ADD COLUMN lang TEXT NOT NULL DEFAULT 'fr'");

function getMeta(k) {
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get(k);
  return row ? row.v : null;
}
function setMeta(k, v) {
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
}

module.exports = { db, DATA_DIR, getMeta, setMeta };
