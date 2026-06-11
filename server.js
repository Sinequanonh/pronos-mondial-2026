const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { all, get, run, batch, initDb, getMeta, setMeta, DATA_DIR, ON_VERCEL } = require('./lib/db');
const { sync, SOURCES } = require('./lib/sync');
const { pollLive } = require('./lib/live');
const { pointsFor, leaderboard } = require('./lib/scoring');
const { TEAMS } = require('./lib/teams');

const PORT = process.env.PORT || 3026;
const SYNC_EVERY_MS = 30 * 60 * 1000;

const token = () => crypto.randomBytes(8).toString('base64url');
const hashPin = (pin) => crypto.createHash('sha256').update(String(pin)).digest('hex');
const locked = (m) => Date.parse(m.date_utc) <= Date.now();
const finished = (m) => m.home_score != null && m.away_score != null;

// wrapper d'erreurs pour handlers async (Express 4)
const ah = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error('[api]', err);
  if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
});

// ---------- config (clé admin : env > data/config.json > générée) ----------
let adminKey = process.env.ADMIN_KEY || null;
function ensureConfig() {
  if (adminKey) return;
  const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
  try { adminKey = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).adminKey; } catch { /* absent */ }
  if (!adminKey) {
    adminKey = crypto.randomBytes(16).toString('base64url');
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify({ adminKey }, null, 2)); }
    catch { console.warn('[config] FS en lecture seule — définis ADMIN_KEY en variable d\'environnement pour une clé stable'); }
  }
}

async function seedPools() {
  const n = (await get('SELECT COUNT(*) AS n FROM pools')).n;
  if (n === 0) {
    await run('INSERT INTO pools (token, name, lang) VALUES (?, ?, ?)', [token(), 'Famille', 'fr']);
    await run('INSERT INTO pools (token, name, lang) VALUES (?, ?, ?)', [token(), 'Amis', 'en']);
  }
}

const ready = (async () => {
  await initDb();
  ensureConfig();
  await seedPools();
})();
ready.catch((e) => console.error('[init]', e.message));

// ---------- fraîcheur à la demande (pas de tâches de fond en serverless) ----------
let lastFreshCheck = 0;
async function maybeRefresh() {
  if (Date.now() - lastFreshCheck < 20000) return; // anti-rafale par instance
  lastFreshCheck = Date.now();

  const lastSync = await getMeta('last_sync');
  if (!lastSync || Date.now() - Date.parse(lastSync) > SYNC_EVERY_MS) {
    await sync().catch((e) => console.warn('[sync]', e.message));
    return;
  }
  const lastLive = Number(await getMeta('last_live_poll')) || 0;
  if (Date.now() - lastLive > 50000) {
    await setMeta('last_live_poll', String(Date.now()));
    await pollLive().catch((e) => console.warn('[live]', e.message));
  }
}

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => { ready.then(() => next(), (e) => res.status(500).json({ error: 'init: ' + e.message })); });
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---------- pages ----------
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/p/:token', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'pool.html')));

// ---------- API participant ----------
app.get('/api/pool/:token', ah(async (req, res) => {
  await maybeRefresh();

  const pool = await get('SELECT * FROM pools WHERE token = ?', [req.params.token]);
  if (!pool) return res.status(404).json({ error: 'Pool introuvable' });

  let me = null;
  const key = req.get('x-player-key');
  if (key) {
    const p = await get('SELECT * FROM players WHERE key = ?', [key]);
    if (p && p.pool_id === pool.id) me = { id: p.id, name: p.name };
  }

  const matches = (await all('SELECT * FROM matches ORDER BY id')).map((m) => ({
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

  const allPreds = await all(`
    SELECT pr.match_id, pr.home, pr.away, pl.id AS player_id, pl.name AS player_name
    FROM predictions pr JOIN players pl ON pl.id = pr.player_id
    WHERE pl.pool_id = ?
  `, [pool.id]);

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
        pts: m.finished ? pointsFor({ ...m, home_score: m.hs, away_score: m.as }, pr.home, pr.away) : null,
      });
    }
  }

  res.json({
    pool: { name: pool.name, lang: pool.lang || 'fr' },
    me,
    players: (await all('SELECT name FROM players WHERE pool_id = ? ORDER BY name', [pool.id])).map((p) => p.name),
    teams: TEAMS,
    sources: SOURCES,
    matches,
    mine,
    others,
    counts,
    leaderboard: (await leaderboard(pool.id)).map((r) => ({ ...r, isMe: !!me && r.id === me.id })),
    lastSync: await getMeta('last_sync'),
    serverNow: new Date().toISOString(),
  });
}));

app.post('/api/pool/:token/join', ah(async (req, res) => {
  const pool = await get('SELECT * FROM pools WHERE token = ?', [req.params.token]);
  if (!pool) return res.status(404).json({ error: 'Pool introuvable' });

  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  const pin = String(req.body.pin || '').trim();
  if (name.length < 2 || name.length > 20) return res.status(400).json({ error: 'Pseudo entre 2 et 20 caractères' });
  if (pin && !/^\d{3,6}$/.test(pin)) return res.status(400).json({ error: 'PIN : 3 à 6 chiffres' });

  const existing = await get('SELECT * FROM players WHERE pool_id = ? AND name = ?', [pool.id, name]);
  if (existing) {
    if (existing.pin_hash && existing.pin_hash !== hashPin(pin)) {
      return res.status(403).json({ error: 'pin', message: 'Ce pseudo est protégé par un PIN' });
    }
    return res.json({ key: existing.key, name: existing.name, rejoined: true });
  }

  const key = crypto.randomBytes(12).toString('base64url');
  await run('INSERT INTO players (pool_id, name, pin_hash, key) VALUES (?, ?, ?, ?)',
    [pool.id, name, pin ? hashPin(pin) : null, key]);
  return res.json({ key, name, rejoined: false });
}));

app.put('/api/pool/:token/predictions', ah(async (req, res) => {
  const pool = await get('SELECT * FROM pools WHERE token = ?', [req.params.token]);
  if (!pool) return res.status(404).json({ error: 'Pool introuvable' });
  const player = await get('SELECT * FROM players WHERE key = ?', [req.get('x-player-key') || '']);
  if (!player || player.pool_id !== pool.id) return res.status(401).json({ error: 'Reconnecte-toi (pseudo)' });

  const picks = Array.isArray(req.body.picks) ? req.body.picks.slice(0, 120) : [];
  const matchById = new Map((await all('SELECT * FROM matches')).map((m) => [m.id, m]));

  let saved = 0;
  const rejected = [];
  const stmts = [];
  for (const pick of picks) {
    const m = matchById.get(Number(pick.m));
    const h = Number(pick.h);
    const a = Number(pick.a);
    let reason = null;
    if (!m) reason = 'match inconnu';
    else if (locked(m)) reason = 'match commencé';
    else if (!TEAMS[m.home] || !TEAMS[m.away]) reason = 'équipes pas encore connues';
    else if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0 || h > 30 || a > 30) reason = 'score invalide';
    else if (m.stage !== 'group' && h === a) reason = 'pas de nul en élimination directe';
    if (reason) { rejected.push({ m: pick.m, reason }); continue; }
    stmts.push({
      sql: `INSERT INTO predictions (player_id, match_id, home, away, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(player_id, match_id) DO UPDATE SET home = excluded.home, away = excluded.away, updated_at = excluded.updated_at`,
      args: [player.id, m.id, h, a],
    });
    saved += 1;
  }
  await batch(stmts);
  res.json({ saved, rejected });
}));

// ---------- API admin ----------
function admin(req, res, next) {
  const k = req.get('x-admin-key') || req.query.key;
  if (k !== adminKey) return res.status(403).json({ error: 'Clé admin invalide' });
  next();
}

app.get('/api/admin/pools', admin, ah(async (_req, res) => {
  const pools = await all(`
    SELECT p.id, p.token, p.name, p.lang, p.created_at, COUNT(pl.id) AS players
    FROM pools p LEFT JOIN players pl ON pl.pool_id = p.id
    GROUP BY p.id ORDER BY p.id
  `);
  const players = await all(`
    SELECT pl.id, pl.name, pl.pool_id, pl.pin_hash, pl.created_at, COUNT(pr.match_id) AS preds
    FROM players pl LEFT JOIN predictions pr ON pr.player_id = pl.id
    GROUP BY pl.id ORDER BY pl.name
  `);
  for (const p of pools) {
    p.players_list = players.filter((x) => x.pool_id === p.id)
      .map(({ id, name, preds, pin_hash }) => ({ id, name, preds, pin: !!pin_hash }));
  }
  res.json({ pools, lastSync: await getMeta('last_sync') });
}));

app.patch('/api/admin/players/:id', admin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const player = await get('SELECT * FROM players WHERE id = ?', [id]);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable' });

  let name = player.name;
  if (req.body.name !== undefined) {
    name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 20) return res.status(400).json({ error: 'Pseudo entre 2 et 20 caractères' });
    const clash = await get('SELECT id FROM players WHERE pool_id = ? AND name = ? AND id != ?', [player.pool_id, name, id]);
    if (clash) return res.status(409).json({ error: 'Pseudo déjà pris dans ce pool' });
  }

  let pinHash = player.pin_hash;
  if (req.body.pin !== undefined) {
    const pin = String(req.body.pin || '').trim();
    if (pin === '') pinHash = null;
    else if (/^\d{3,6}$/.test(pin)) pinHash = hashPin(pin);
    else return res.status(400).json({ error: 'PIN : 3 à 6 chiffres (ou vide pour le retirer)' });
  }

  await run('UPDATE players SET name = ?, pin_hash = ? WHERE id = ?', [name, pinHash, id]);
  res.json({ ok: true, name, pin: !!pinHash });
}));

app.delete('/api/admin/players/:id', admin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const player = await get('SELECT * FROM players WHERE id = ?', [id]);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable' });
  // cascade explicite : l'application ne dépend pas du pragma foreign_keys (non garanti sur Turso)
  await batch([
    { sql: 'DELETE FROM predictions WHERE player_id = ?', args: [id] },
    { sql: 'DELETE FROM players WHERE id = ?', args: [id] },
  ]);
  res.json({ ok: true, name: player.name });
}));

app.post('/api/admin/cleanup', admin, ah(async (_req, res) => {
  // purge d'éventuels orphelins laissés par d'anciennes suppressions (avant cascade explicite)
  const a = await run('DELETE FROM predictions WHERE player_id NOT IN (SELECT id FROM players)');
  const b = await run('DELETE FROM players WHERE pool_id NOT IN (SELECT id FROM pools)');
  const c = await run('DELETE FROM predictions WHERE player_id NOT IN (SELECT id FROM players)');
  res.json({
    ok: true,
    orphanPlayers: b.rowsAffected || 0,
    orphanPredictions: (a.rowsAffected || 0) + (c.rowsAffected || 0),
  });
}));

app.post('/api/admin/pools', admin, ah(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Nom entre 2 et 40 caractères' });
  const lang = req.body.lang === 'en' ? 'en' : 'fr';
  const t = token();
  await run('INSERT INTO pools (token, name, lang) VALUES (?, ?, ?)', [t, name, lang]);
  res.json({ token: t, name, lang });
}));

app.patch('/api/admin/pools/:id', admin, ah(async (req, res) => {
  const lang = req.body.lang === 'en' ? 'en' : 'fr';
  await run('UPDATE pools SET lang = ? WHERE id = ?', [lang, Number(req.params.id)]);
  res.json({ ok: true, lang });
}));

app.delete('/api/admin/pools/:id', admin, ah(async (req, res) => {
  const id = Number(req.params.id);
  await batch([
    { sql: 'DELETE FROM predictions WHERE player_id IN (SELECT id FROM players WHERE pool_id = ?)', args: [id] },
    { sql: 'DELETE FROM players WHERE pool_id = ?', args: [id] },
    { sql: 'DELETE FROM pools WHERE id = ?', args: [id] },
  ]);
  res.json({ ok: true });
}));

app.post('/api/admin/sync', admin, ah(async (_req, res) => {
  try {
    const r = await sync();
    await pollLive().catch(() => {});
    res.json(r);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}));

// ---------- cron Vercel (filet de sécurité quotidien) ----------
app.get('/api/cron', ah(async (req, res) => {
  const auth = req.get('authorization') || '';
  const ok = (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) || req.query.key === adminKey;
  if (!ok) return res.status(403).json({ error: 'forbidden' });
  const s = await sync().catch((e) => ({ ok: false, error: e.message }));
  const l = await pollLive().catch((e) => ({ polled: false, error: e.message }));
  res.json({ sync: s, live: l });
}));

// ---------- démarrage (mode serveur long : local, Railway, Docker…) ----------
if (require.main === module && !ON_VERCEL) {
  (async () => {
    await ready;
    try {
      const r = await sync();
      console.log(`[sync] ${r.ok ? `${r.matches} matchs (source: ${r.source})` : `échec: ${r.error}`}`);
    } catch (err) {
      console.error('[sync] échec initial:', err.message);
    }
    await pollLive().then((r) => { if (r.polled) console.log(`[live] ${r.events} événement(s) ESPN suivis`); }).catch(() => {});
    setInterval(() => sync().catch((e) => console.warn('[sync]', e.message)), SYNC_EVERY_MS);
    setInterval(() => pollLive().catch((e) => console.warn('[live]', e.message)), 60 * 1000);

    const pools = await all('SELECT name, token FROM pools ORDER BY id');
    app.listen(PORT, () => {
      const base = `http://localhost:${PORT}`;
      console.log('');
      console.log(`⚽ Pronos Mondial 2026 — ${base}`);
      console.log(`   Admin : ${base}/?key=${adminKey}`);
      for (const p of pools) console.log(`   ${p.name.padEnd(12)} → ${base}/p/${p.token}`);
      console.log('');
    });
  })();
}

module.exports = app;
