const fs = require('fs');
const path = require('path');
const { all, get, run, batch, setMeta, DATA_DIR } = require('./db');
const { TEAMS } = require('./teams');

const FEED_URL = process.env.FEED_URL || 'https://fixturedownload.com/feed/json/fifa-world-cup-2026';
const CACHE_FILE = path.join(DATA_DIR, 'feed-cache.json');
const SEED_FILE = path.join(DATA_DIR, 'seed-feed.json');

// Arbre officiel FIFA : match → [source domicile, source extérieur]
// (positif = vainqueur du match N, négatif = perdant du match N)
const SOURCES = {
  89: [74, 77], 90: [73, 75], 91: [76, 78], 92: [79, 80],
  93: [83, 84], 94: [81, 82], 95: [86, 88], 96: [85, 87],
  97: [89, 90], 98: [93, 94], 99: [91, 92], 100: [95, 96],
  101: [97, 98], 102: [99, 100],
  103: [-101, -102], 104: [101, 102],
};

function stageOf(n) {
  if (n <= 72) return 'group';
  if (n <= 88) return 'r32';
  if (n <= 96) return 'r16';
  if (n <= 100) return 'qf';
  if (n <= 102) return 'sf';
  if (n === 103) return 'third';
  return 'final';
}

const UPSERT_SQL = `
  INSERT INTO matches (id, round, stage, grp, date_utc, location, home, away, home_score, away_score, advancer)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    round = excluded.round, stage = excluded.stage, grp = excluded.grp,
    date_utc = excluded.date_utc, location = excluded.location,
    home = excluded.home, away = excluded.away,
    home_score = COALESCE(excluded.home_score, matches.home_score),
    away_score = COALESCE(excluded.away_score, matches.away_score),
    advancer = COALESCE(excluded.advancer, matches.advancer)
`;

async function applyFeed(rows) {
  const stmts = [];
  for (const r of rows) {
    if (!r || typeof r.MatchNumber !== 'number') continue;
    stmts.push({
      sql: UPSERT_SQL,
      args: [
        r.MatchNumber,
        r.RoundNumber,
        stageOf(r.MatchNumber),
        r.Group ? r.Group.replace('Group ', '') : null,
        String(r.DateUtc || '').replace(' ', 'T'),
        r.Location || null,
        r.HomeTeam || 'To be announced',
        r.AwayTeam || 'To be announced',
        r.HomeTeamScore == null ? null : Number(r.HomeTeamScore),
        r.AwayTeamScore == null ? null : Number(r.AwayTeamScore),
        r.Winner && TEAMS[r.Winner] ? r.Winner : null,
      ],
    });
  }
  await batch(stmts);
}

// Déduit le qualifié des matchs à élimination directe :
//  - score non nul → vainqueur direct
//  - nul (tirs au but) → on regarde quelle équipe apparaît au tour suivant
async function inferAdvancers() {
  const ko = await all("SELECT * FROM matches WHERE stage != 'group'");
  const byId = new Map(ko.map((m) => [m.id, m]));
  const resolved = (name) => !!TEAMS[name];

  for (const m of ko) {
    if (m.advancer) continue;
    const finished = m.home_score != null && m.away_score != null;
    if (!finished || !resolved(m.home) || !resolved(m.away)) continue;

    let adv = null;
    if (m.home_score !== m.away_score) {
      adv = m.home_score > m.away_score ? m.home : m.away;
    } else {
      for (const [pid, srcs] of Object.entries(SOURCES)) {
        const parent = byId.get(Number(pid));
        if (!parent) continue;
        srcs.forEach((src, i) => {
          if (Math.abs(src) !== m.id) return;
          const occupant = i === 0 ? parent.home : parent.away;
          if (!resolved(occupant) || (occupant !== m.home && occupant !== m.away)) return;
          if (src > 0) adv = occupant;
          else adv = occupant === m.home ? m.away : m.home;
        });
        if (adv) break;
      }
    }
    if (adv) await run('UPDATE matches SET advancer = ? WHERE id = ?', [adv, m.id]);
  }
}

async function fetchFeed() {
  const res = await fetch(FEED_URL, { headers: { 'user-agent': 'pronos-mondial-2026' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length < 50) throw new Error('feed invalide');
  return rows;
}

async function sync() {
  let rows = null;
  let source = 'live';
  try {
    rows = await fetchFeed();
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(rows)); } catch { /* FS en lecture seule (Vercel) */ }
  } catch (err) {
    const empty = (await get('SELECT COUNT(*) AS n FROM matches')).n === 0;
    if (!empty) {
      console.warn(`[sync] feed indisponible (${err.message}) — données existantes conservées`);
      return { ok: false, error: err.message };
    }
    for (const file of [CACHE_FILE, SEED_FILE]) {
      try {
        rows = JSON.parse(fs.readFileSync(file, 'utf8'));
        source = path.basename(file);
        break;
      } catch { /* fichier absent */ }
    }
    if (!rows) throw err;
  }
  await applyFeed(rows);
  await inferAdvancers();
  const now = new Date().toISOString();
  await setMeta('last_sync', now);
  await setMeta('last_sync_source', source);
  return { ok: true, matches: rows.length, source, at: now };
}

module.exports = { sync, SOURCES, FEED_URL, inferAdvancers };
