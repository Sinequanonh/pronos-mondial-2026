// Couche base de données : libSQL.
//  - en local : fichier SQLite data/pronos.db (comme avant)
//  - sur Vercel : Turso via TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ON_VERCEL = !!process.env.VERCEL;
if (!ON_VERCEL) fs.mkdirSync(DATA_DIR, { recursive: true });

if (ON_VERCEL && !process.env.TURSO_DATABASE_URL) {
  console.error('[db] TURSO_DATABASE_URL manquant — configure Turso dans les variables Vercel (voir README)');
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:' + path.join(DATA_DIR, 'pronos.db'),
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Les Row libsql sont des objets "array-like" : on normalise en objets simples
function rowsToObjects(rs) {
  return rs.rows.map((row) => {
    const o = {};
    rs.columns.forEach((c, i) => { o[c] = row[i]; });
    return o;
  });
}

async function run(sql, args = []) { return client.execute({ sql, args }); }
async function all(sql, args = []) { return rowsToObjects(await client.execute({ sql, args })); }
async function get(sql, args = []) { return (await all(sql, args))[0] || null; }
async function batch(stmts) {
  if (!stmts.length) return;
  return client.batch(stmts.map((s) => (typeof s === 'string' ? s : { sql: s.sql, args: s.args || [] })), 'write');
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pools (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token      TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    lang       TEXT NOT NULL DEFAULT 'fr',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS players (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id    INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    name       TEXT NOT NULL COLLATE NOCASE,
    pin_hash   TEXT,
    key        TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(pool_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS matches (
    id         INTEGER PRIMARY KEY,
    round      INTEGER NOT NULL,
    stage      TEXT NOT NULL,
    grp        TEXT,
    date_utc   TEXT NOT NULL,
    location   TEXT,
    home       TEXT NOT NULL,
    away       TEXT NOT NULL,
    home_score INTEGER,
    away_score INTEGER,
    advancer   TEXT,
    live_hs    INTEGER,
    live_as    INTEGER,
    live_min   TEXT,
    live_state TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS predictions (
    player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    match_id   INTEGER NOT NULL REFERENCES matches(id),
    home       INTEGER NOT NULL,
    away       INTEGER NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (player_id, match_id)
  )`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS champion_picks (
    player_id  INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    team       TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
];

// migrations pour une base créée avant ces colonnes (le fichier local)
const ALTERS = [
  "ALTER TABLE matches ADD COLUMN live_hs INTEGER",
  "ALTER TABLE matches ADD COLUMN live_as INTEGER",
  "ALTER TABLE matches ADD COLUMN live_min TEXT",
  "ALTER TABLE matches ADD COLUMN live_state TEXT",
  "ALTER TABLE pools ADD COLUMN lang TEXT NOT NULL DEFAULT 'fr'",
];

async function initDb() {
  await batch(SCHEMA);
  for (const alter of ALTERS) {
    try { await run(alter); } catch { /* colonne déjà présente */ }
  }
}

async function getMeta(k) {
  const row = await get('SELECT v FROM meta WHERE k = ?', [k]);
  return row ? row.v : null;
}
async function setMeta(k, v) {
  await run('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', [k, v]);
}

module.exports = { run, all, get, batch, initDb, getMeta, setMeta, DATA_DIR, ON_VERCEL };
