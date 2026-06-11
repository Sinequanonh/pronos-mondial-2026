const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { db, DATA_DIR, getMeta } = require('./lib/db');
const { sync, SOURCES } = require('./lib/sync');
const { pollLive } = require('./lib/live');
const { pointsFor, leaderboard } = require('./lib/scoring');
const { TEAMS } = require('./lib/teams');

const PORT = process.env.PORT || 3026;
const SYNC_EVERY_MS = 30 * 60 * 1000;

// ---------- config (clé admin persistée) ----------
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
let config = {};
if (fs.existsSync(CONFIG_FILE)) config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
if (process.env.ADMIN_KEY) config.adminKey = process.env.ADMIN_KEY;
if (!config.adminKey) {
  config.adminKey = crypto.randomBytes(16).toString('base64url');
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

const token = () => crypto.randomBytes(8).toString('base64url');
const hashPin = (pin) => crypto.createHash('sha256').update(String(pin)).digest('hex');
const locked = (m) => Date.parse(m.date_utc) <= Date.now();
const finished = (m) => m.home_score != null && m.away_score != null;

// ---------- pools par défaut au premier lancement ----------
if (db.prepare('SELECT COUNT(*) AS n FROM pools').get().n === 0) {
  const ins = db.prepare('INSERT INTO pools (token, name) VALUES (?, ?)');
  ins.run(token(), 'Famille');
  ins.run(token(), 'Amis');
}

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

const getPool = db.prepare('SELECT * FROM pools WHERE token = ?');
const getPlayerByKey = db.prepare('SELECT * FROM players WHERE key = ?');

// ---------- pages ----------
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/p/:token', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'pool.html')));

// ---------- API participant ----------
app.get('/api/pool/:token', (req, res) => {
  const pool = getPool.get(req.params.token);
  if (!pool) return res.status(404).json({ error: 'Pool introuvable' });

  let me = null;
  const key = req.get('x-player-key');
  if (key) {
    const p = getPlayerByKey.get(key);
    if (p && p.pool_id === pool.id) me = { id: p.id, name: p.name };
  }

  const matches = db.prepare('SELECT * FROM matches ORDER BY id').all().map((m) => ({
    id: m.id,
    stage: m.stage,
    round: m.round,
    grp: m.grp,
    date: m.date_utc,
    loc: m.location,
    home: m.home,
    away: m.away,
    hs: m.home_score,
    as: m.away_score,
    advancer: m.advancer,
    locked: locked(m),
    finished: finished(m),
    lhs: m.live_hs,
    las: m.live_as,
    lmin: m.live_min,
    lstate: m.live_state,
  }));
  const matchById = new Map(matches.map((m) => [m.id, m]));

  const allPreds = db.prepare(`
    SELECT pr.match_id, pr.home, pr.away, pl.id AS player_id, pl.name AS player_name
    FROM predictions pr JOIN players pl ON pl.id = pr.player_id
    WHERE pl.pool_id = ?
  `).all(pool.id);

  const mine = {};
  const others = {};
  const counts = {};
  for (const pr of allPreds) {
    const m = matchById.get(pr.match_id);
    if (!m) continue;
    counts[pr.match_id] = (counts[pr.match_id] || 0) + 1;
    if (me && pr.player_id === me.id) mine[pr.match_id] = [pr.home, pr.away];
    if (m.locked) {
      (others[pr.match_id] = others[pr.match_id] || []).push({
        name: pr.player_name,
        h: pr.home,
        a: pr.away,
        pts: finishedPts(m, pr),
      });
    }
  }

  res.json({
    pool: { name: pool.name, lang: pool.lang || 'fr' },
    me,
    players: db.prepare('SELECT name FROM players WHERE pool_id = ? ORDER BY name').all(pool.id).map((p) => p.name),
    teams: TEAMS,
    sources: SOURCES,
    matches,
    mine,
    others,
    counts,
    leaderboard: leaderboard(pool.id).map((r) => ({ ...r, isMe: !!me && r.id === me.id })),
    lastSync: getMeta('last_sync'),
    serverNow: new Date().toISOString(),
  });

  function finishedPts(m, pr) {
    return finished(m) ? pointsFor({ ...m, home_score: m.hs, away_score: m.as }, pr.home, pr.away) : null;
  }
});

app.post('/api/pool/:token/join', (req, res) => {
  const pool = getPool.get(req.params.token);
  if (!pool) return res.status(404).json({ error: 'Pool introuvable' });

  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  const pin = String(req.body.pin || '').trim();
  if (name.length < 2 || name.length > 20) return res.status(400).json({ error: 'Pseudo entre 2 et 20 caractères' });
  if (pin && !/^\d{3,6}$/.test(pin)) return res.status(400).json({ error: 'PIN : 3 à 6 chiffres' });

  const existing = db.prepare('SELECT * FROM players WHERE pool_id = ? AND name = ?').get(pool.id, name);
  if (existing) {
    if (existing.pin_hash && existing.pin_hash !== hashPin(pin)) {
      return res.status(403).json({ error: 'pin', message: 'Ce pseudo est protégé par un PIN' });
    }
    return res.json({ key: existing.key, name: existing.name, rejoined: true });
  }

  const key = crypto.randomBytes(12).toString('base64url');
  db.prepare('INSERT INTO players (pool_id, name, pin_hash, key) VALUES (?, ?, ?, ?)')
    .run(pool.id, name, pin ? hashPin(pin) : null, key);
  return res.json({ key, name, rejoined: false });
});

app.put('/api/pool/:token/predictions', (req, res) => {
  const pool = getPool.get(req.params.token);
  if (!pool) return res.status(404).json({ error: 'Pool introuvable' });
  const player = getPlayerByKey.get(req.get('x-player-key') || '');
  if (!player || player.pool_id !== pool.id) return res.status(401).json({ error: 'Reconnecte-toi (pseudo)' });

  const picks = Array.isArray(req.body.picks) ? req.body.picks.slice(0, 120) : [];
  const getMatch = db.prepare('SELECT * FROM matches WHERE id = ?');
  const upsert = db.prepare(`
    INSERT INTO predictions (player_id, match_id, home, away, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(player_id, match_id) DO UPDATE SET home = excluded.home, away = excluded.away, updated_at = excluded.updated_at
  `);

  let saved = 0;
  const rejected = [];
  for (const pick of picks) {
    const m = getMatch.get(Number(pick.m));
    const h = Number(pick.h);
    const a = Number(pick.a);
    let reason = null;
    if (!m) reason = 'match inconnu';
    else if (locked(m)) reason = 'match commencé';
    else if (!TEAMS[m.home] || !TEAMS[m.away]) reason = 'équipes pas encore connues';
    else if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0 || h > 30 || a > 30) reason = 'score invalide';
    else if (m.stage !== 'group' && h === a) reason = 'pas de nul en élimination directe';
    if (reason) { rejected.push({ m: pick.m, reason }); continue; }
    upsert.run(player.id, m.id, h, a);
    saved += 1;
  }
  res.json({ saved, rejected });
});

// ---------- API admin ----------
function admin(req, res, next) {
  const k = req.get('x-admin-key') || req.query.key;
  if (k !== config.adminKey) return res.status(403).json({ error: 'Clé admin invalide' });
  next();
}

app.get('/api/admin/pools', admin, (_req, res) => {
  const pools = db.prepare(`
    SELECT p.id, p.token, p.name, p.lang, p.created_at, COUNT(pl.id) AS players
    FROM pools p LEFT JOIN players pl ON pl.pool_id = p.id
    GROUP BY p.id ORDER BY p.id
  `).all();
  res.json({ pools, lastSync: getMeta('last_sync') });
});

app.post('/api/admin/pools', admin, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Nom entre 2 et 40 caractères' });
  const lang = req.body.lang === 'en' ? 'en' : 'fr';
  const t = token();
  db.prepare('INSERT INTO pools (token, name, lang) VALUES (?, ?, ?)').run(t, name, lang);
  res.json({ token: t, name, lang });
});

app.patch('/api/admin/pools/:id', admin, (req, res) => {
  const lang = req.body.lang === 'en' ? 'en' : 'fr';
  db.prepare('UPDATE pools SET lang = ? WHERE id = ?').run(lang, Number(req.params.id));
  res.json({ ok: true, lang });
});

app.delete('/api/admin/pools/:id', admin, (req, res) => {
  db.prepare('DELETE FROM pools WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/admin/sync', admin, async (_req, res) => {
  try {
    const r = await sync();
    await pollLive().catch(() => {});
    res.json(r);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------- démarrage ----------
(async () => {
  try {
    const r = await sync();
    console.log(`[sync] ${r.ok ? `${r.matches} matchs (source: ${r.source})` : `échec: ${r.error}`}`);
  } catch (err) {
    console.error('[sync] échec initial:', err.message);
  }
  setInterval(() => sync().catch((e) => console.warn('[sync]', e.message)), SYNC_EVERY_MS);
  pollLive().then((r) => { if (r.polled) console.log(`[live] ${r.events} événement(s) ESPN suivis`); }).catch((e) => console.warn('[live]', e.message));
  setInterval(() => pollLive().catch((e) => console.warn('[live]', e.message)), 60 * 1000);

  app.listen(PORT, () => {
    const base = `http://localhost:${PORT}`;
    const pools = db.prepare('SELECT name, token FROM pools ORDER BY id').all();
    console.log('');
    console.log(`⚽ Pronos Mondial 2026 — ${base}`);
    console.log(`   Admin : ${base}/?key=${config.adminKey}`);
    for (const p of pools) console.log(`   ${p.name.padEnd(12)} → ${base}/p/${p.token}`);
    console.log('');
  });
})();
