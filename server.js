const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { all, get, run, batch, initDb, getMeta, setMeta, DATA_DIR, ON_VERCEL } = require('./lib/db');
const { sync, SOURCES } = require('./lib/sync');
const { pollLive } = require('./lib/live');
const { pointsFor, leaderboard, CHAMPION_POINTS } = require('./lib/scoring');
const { TEAMS } = require('./lib/teams');
const { CAPTAIN_ENABLED } = require('./lib/flags');

const PORT = process.env.PORT || 3026;
const SYNC_EVERY_MS = 30 * 60 * 1000;
// Prono champion : verrouillage dimanche 14 juin 2026 à minuit (heure de Paris)
const CHAMPION_DEADLINE = process.env.CHAMPION_DEADLINE || '2026-06-14T22:00:00Z';
const championLocked = () => Date.now() >= Date.parse(CHAMPION_DEADLINE);

const token = () => crypto.randomBytes(8).toString('base64url');
const hashPin = (pin) => crypto.createHash('sha256').update(String(pin)).digest('hex');

// ---------- SSO Google : seul cet email a accès à l'admin ----------
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'leobaeckerpro@gmail.com').toLowerCase();
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || null;
const SSO_ENABLED = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
const SESSION_DAYS = 30;
const baseUrl = (req) => `${req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http')}://${req.get('host')}`;

const parseCookies = (req) =>
  Object.fromEntries((req.headers.cookie || '').split(';')
    .map((v) => v.trim().split('=').map(decodeURIComponent))
    .filter((a) => a.length === 2 && a[0]));
const signPart = (p) => crypto.createHmac('sha256', adminKey || 'boot').update(p).digest('base64url');
const makeSession = (email) => {
  const p = Buffer.from(JSON.stringify({ email, exp: Date.now() + SESSION_DAYS * 86400000 })).toString('base64url');
  return p + '.' + signPart(p);
};
function readSession(req) {
  try {
    const raw = parseCookies(req).admin_session;
    if (!raw || !raw.includes('.')) return null;
    const [p, sig] = raw.split('.');
    const want = signPart(p);
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    const s = JSON.parse(Buffer.from(p, 'base64url').toString());
    return s.exp > Date.now() && s.email === ADMIN_EMAIL ? s : null;
  } catch { return null; }
}
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

// Init ré-essayable : si elle échoue (ex. blip réseau Turso au cold start), on ne
// garde PAS la promesse rejetée à vie — la prochaine requête relance l'init.
let _ready = null;
function ensureReady() {
  if (!_ready) {
    _ready = (async () => {
      await initDb();
      ensureConfig();
      await seedPools();
    })().catch((e) => {
      _ready = null; // autorise un nouvel essai
      console.error('[init] échec:', e && (e.cause || e));
      throw e;
    });
  }
  return _ready;
}

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
// La base ne gate QUE les routes API qui en dépendent. Les pages HTML, les assets
// statiques et l'auth (sans base) se chargent toujours, même si Turso a un hoquet.
const AUTH_NO_DB = new Set(['/api/auth/config', '/api/auth/login', '/api/auth/callback', '/api/auth/me', '/api/auth/logout']);
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || AUTH_NO_DB.has(req.path)) return next();
  ensureReady().then(() => next(), () => res.status(503).json({ error: 'Base momentanément indisponible, réessaie dans un instant.' }));
});
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-store'); },
}));

// les pages HTML ne doivent jamais être servies depuis le cache (sinon vieux JS bootstrap)
const sendHtml = (res, file) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', file));
};

// ---------- pages ----------
app.get('/', (_req, res) => sendHtml(res, 'admin.html'));
app.get('/p/:token', (_req, res) => sendHtml(res, 'pool.html'));

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

  // capitaine : un match doublé par journée (round). On révèle qui a capitainé quoi seulement
  // sur les matchs verrouillés (la journée a commencé) ; on renvoie toujours MES capitaines.
  const capRows = await all(`
    SELECT cp.player_id, cp.round, cp.match_id, pl.name FROM captain_picks cp
    JOIN players pl ON pl.id = cp.player_id WHERE pl.pool_id = ?
  `, [pool.id]);
  const capByMatch = new Map(); // matchId -> Set(noms)
  const myCaptains = {};         // round -> matchId (pour moi)
  for (const r of capRows) {
    if (!capByMatch.has(r.match_id)) capByMatch.set(r.match_id, new Set());
    capByMatch.get(r.match_id).add(r.name);
    if (me && r.player_id === me.id) myCaptains[r.round] = r.match_id;
  }

  const mine = {};
  const others = {};
  const counts = {};
  const pickers = {}; // qui a déjà pronostiqué (noms seulement, jamais les scores) — matchs non verrouillés
  for (const pr of allPreds) {
    const m = matchById.get(pr.match_id);
    if (!m) continue;
    counts[pr.match_id] = (counts[pr.match_id] || 0) + 1;
    if (!m.locked) (pickers[pr.match_id] = pickers[pr.match_id] || []).push(pr.player_name);
    if (me && pr.player_id === me.id) mine[pr.match_id] = [pr.home, pr.away];
    if (m.locked) {
      (others[pr.match_id] = others[pr.match_id] || []).push({
        name: pr.player_name,
        h: pr.home,
        a: pr.away,
        cap: CAPTAIN_ENABLED && (capByMatch.get(pr.match_id) || new Set()).has(pr.player_name),
        pts: m.finished ? pointsFor({ ...m, home_score: m.hs, away_score: m.as }, pr.home, pr.away) : null,
      });
    }
  }

  const champRows = await all(`
    SELECT cp.team, pl.id AS pid, pl.name
    FROM champion_picks cp JOIN players pl ON pl.id = cp.player_id
    WHERE pl.pool_id = ?
  `, [pool.id]);
  const champion = {
    deadline: CHAMPION_DEADLINE,
    points: CHAMPION_POINTS,
    locked: championLocked(),
    mine: me ? ((champRows.find((r) => r.pid === me.id) || {}).team || null) : null,
    count: champRows.length,
    // QUI a choisi (noms seulement, jamais l'équipe avant le verrou)
    pickers: champRows.map((r) => r.name).sort((a, b) => a.localeCompare(b, 'fr')),
    // les ÉQUIPES des autres ne sortent du serveur qu'une fois le verrou tombé
    picks: championLocked()
      ? champRows.map((r) => ({ name: r.name, team: r.team })).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      : null,
  };

  // photos de profil : on n'expose qu'une petite map nom -> URL versionnée (l'image est servie à part, cachée)
  const avatarRows = await all('SELECT id, name, avatar FROM players WHERE pool_id = ?', [pool.id]);
  const avatars = {};
  for (const r of avatarRows) {
    if (r.avatar) avatars[r.name] = `/api/avatar/${r.id}?v=${crypto.createHash('sha1').update(r.avatar).digest('hex').slice(0, 8)}`;
  }

  res.json({
    pool: { name: pool.name, lang: pool.lang || 'fr' },
    champion,
    avatars,
    captainEnabled: CAPTAIN_ENABLED,
    captains: myCaptains,
    me,
    players: (await all('SELECT name FROM players WHERE pool_id = ? ORDER BY name', [pool.id])).map((p) => p.name),
    teams: TEAMS,
    sources: SOURCES,
    matches,
    mine,
    others,
    counts,
    pickers: Object.fromEntries(Object.entries(pickers).map(([k, v]) => [k, v.sort((a, b) => a.localeCompare(b, 'fr'))])),
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

// ---------- authentification admin (OAuth Google par redirection) ----------
const cookie = (name, val, maxAge) =>
  `${name}=${val}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${ON_VERCEL ? '; Secure' : ''}`;

function loginErrorPage(msg) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <body style="font:15px -apple-system,system-ui,sans-serif;max-width:420px;margin:80px auto;padding:0 20px;text-align:center;color:#202124">
    <h2>⚽ Connexion refusée</h2><p style="color:#5f6368">${msg}</p>
    <p><a href="/" style="color:#1a73e8">← Réessayer</a></p></body>`;
}

app.get('/api/auth/config', (_req, res) => res.json({ ssoEnabled: SSO_ENABLED }));

app.get('/api/auth/me', (req, res) => {
  const s = readSession(req);
  if (!s) return res.status(401).json({ error: 'non connecté' });
  res.json({ email: s.email });
});

app.post('/api/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', cookie('admin_session', '', 0));
  res.json({ ok: true });
});

// 1) départ : redirige vers Google (même onglet, pas de popup)
app.get('/api/auth/login', (req, res) => {
  if (!SSO_ENABLED) return res.status(400).send(loginErrorPage('SSO non configuré.'));
  const state = crypto.randomBytes(16).toString('base64url');
  res.setHeader('Set-Cookie', cookie('oauth_state', state, 600));
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: baseUrl(req) + '/api/auth/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    access_type: 'online',
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + p.toString());
});

// 2) retour : échange le code, vérifie l'email, pose la session
app.get('/api/auth/callback', ah(async (req, res) => {
  res.setHeader('Set-Cookie', cookie('oauth_state', '', 0));
  if (!SSO_ENABLED) return res.status(400).send(loginErrorPage('SSO non configuré.'));
  const { code, state } = req.query;
  const saved = parseCookies(req).oauth_state;
  if (!code || !state || !saved || String(state) !== saved) {
    return res.status(400).send(loginErrorPage('Lien de connexion expiré. Relance la connexion.'));
  }
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code),
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: baseUrl(req) + '/api/auth/callback',
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10000),
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!tok || !tok.id_token) return res.status(401).send(loginErrorPage('Échec de l\'authentification Google.'));

  const info = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tok.id_token),
    { signal: AbortSignal.timeout(10000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!info || info.aud !== GOOGLE_CLIENT_ID) return res.status(401).send(loginErrorPage('Jeton Google invalide.'));
  if (String(info.email || '').toLowerCase() !== ADMIN_EMAIL || info.email_verified !== 'true') {
    return res.status(403).send(loginErrorPage(`Le compte ${info.email || ''} n'est pas autorisé.`));
  }
  res.setHeader('Set-Cookie', [
    cookie('oauth_state', '', 0),
    cookie('admin_session', makeSession(ADMIN_EMAIL), SESSION_DAYS * 86400),
  ]);
  res.redirect('/');
}));

app.put('/api/pool/:token/champion', ah(async (req, res) => {
  const pool = await get('SELECT * FROM pools WHERE token = ?', [req.params.token]);
  if (!pool) return res.status(404).json({ error: 'Pool introuvable' });
  const player = await get('SELECT * FROM players WHERE key = ?', [req.get('x-player-key') || '']);
  if (!player || player.pool_id !== pool.id) return res.status(401).json({ error: 'Reconnecte-toi (pseudo)' });
  if (championLocked()) return res.status(400).json({ error: 'prono champion verrouillé' });
  const team = String(req.body.team || '');
  if (!TEAMS[team]) return res.status(400).json({ error: 'équipe inconnue' });
  await run(`
    INSERT INTO champion_picks (player_id, team, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(player_id) DO UPDATE SET team = excluded.team, updated_at = excluded.updated_at
  `, [player.id, team]);
  res.json({ ok: true, team });
}));

// Capitaine : un match doublé par journée (round). Verrouillé au coup d'envoi du 1er match de la journée.
app.put('/api/pool/:token/captain', ah(async (req, res) => {
  if (!CAPTAIN_ENABLED) return res.status(403).json({ error: 'Capitaine désactivé' });
  const pool = await get('SELECT * FROM pools WHERE token = ?', [req.params.token]);
  if (!pool) return res.status(404).json({ error: 'Pool introuvable' });
  const player = await get('SELECT * FROM players WHERE key = ?', [req.get('x-player-key') || '']);
  if (!player || player.pool_id !== pool.id) return res.status(401).json({ error: 'Reconnecte-toi (pseudo)' });

  const round = Number(req.body.round);
  const matchId = req.body.matchId == null ? null : Number(req.body.matchId);
  if (!Number.isInteger(round)) return res.status(400).json({ error: 'journée invalide' });

  const roundStart = (await get('SELECT MIN(date_utc) AS s FROM matches WHERE round = ?', [round]));
  if (!roundStart || !roundStart.s) return res.status(400).json({ error: 'journée inconnue' });
  if (Date.parse(roundStart.s) <= Date.now()) return res.status(400).json({ error: 'journée commencée' });

  if (matchId == null) { // déselection
    await run('DELETE FROM captain_picks WHERE player_id = ? AND round = ?', [player.id, round]);
    return res.json({ ok: true, round, matchId: null });
  }
  const m = await get('SELECT * FROM matches WHERE id = ?', [matchId]);
  if (!m || m.round !== round) return res.status(400).json({ error: 'match hors journée' });
  await run(`
    INSERT INTO captain_picks (player_id, round, match_id, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(player_id, round) DO UPDATE SET match_id = excluded.match_id, updated_at = excluded.updated_at
  `, [player.id, round, matchId]);
  res.json({ ok: true, round, matchId });
}));

// Photo de profil d'un joueur. Stockée en base en data URL ; servie en binaire + cache long
// (l'URL est versionnée côté payload, donc on peut cacher agressivement).
app.get('/api/avatar/:id', ah(async (req, res) => {
  const row = await get('SELECT avatar FROM players WHERE id = ?', [Number(req.params.id)]);
  const m = row && row.avatar && /^data:(image\/[a-z.+-]+);base64,(.+)$/i.exec(row.avatar);
  if (!m) return res.status(404).end();
  res.set('Content-Type', m[1]);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(m[2], 'base64'));
}));

// ---------- API admin ----------
// Accès : session Google (cookie) ou clé API en en-tête (scripts/CLI). Jamais via ?key= (fuite d'URL).
function admin(req, res, next) {
  if (readSession(req)) return next();
  if ((req.get('x-admin-key') || '') === adminKey) return next();
  return res.status(403).json({ error: 'Accès admin refusé' });
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

// Admin : (re)poser/retirer le prono champion d'un joueur — exception manuelle, ignore le verrou de date.
// Body { team: "<clé TEAMS>" } pour poser, { team: null } pour retirer.
app.put('/api/admin/players/:id/champion', admin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const player = await get('SELECT * FROM players WHERE id = ?', [id]);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable' });
  const team = req.body.team == null ? null : String(req.body.team);
  if (team === null) {
    await run('DELETE FROM champion_picks WHERE player_id = ?', [id]);
    return res.json({ ok: true, team: null });
  }
  if (!TEAMS[team]) return res.status(400).json({ error: 'équipe inconnue' });
  await run(`
    INSERT INTO champion_picks (player_id, team, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(player_id) DO UPDATE SET team = excluded.team, updated_at = excluded.updated_at
  `, [id, team]);
  res.json({ ok: true, team });
}));

// Admin : poser/retirer la photo de profil d'un joueur.
// Body { dataUrl: "data:image/...;base64,..." } pour poser, { dataUrl: null } pour retirer.
app.put('/api/admin/players/:id/avatar', admin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const player = await get('SELECT * FROM players WHERE id = ?', [id]);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable' });
  const dataUrl = req.body.dataUrl == null ? null : String(req.body.dataUrl);
  if (dataUrl !== null && !/^data:image\/[a-z.+-]+;base64,.+/i.test(dataUrl)) {
    return res.status(400).json({ error: 'dataUrl image attendue' });
  }
  await run('UPDATE players SET avatar = ? WHERE id = ?', [dataUrl, id]);
  res.json({ ok: true, hasAvatar: dataUrl !== null });
}));

// Admin : forcer/corriger un prono d'un joueur sur un match — exception manuelle, ignore le verrou
// du coup d'envoi (utile pour rattraper un prono « oublié »). Body { matchId, home, away }.
app.put('/api/admin/players/:id/prediction', admin, ah(async (req, res) => {
  const id = Number(req.params.id);
  const player = await get('SELECT * FROM players WHERE id = ?', [id]);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable' });
  const m = await get('SELECT * FROM matches WHERE id = ?', [Number(req.body.matchId)]);
  if (!m) return res.status(404).json({ error: 'Match introuvable' });
  const h = Number(req.body.home), a = Number(req.body.away);
  if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0 || h > 30 || a > 30) {
    return res.status(400).json({ error: 'score invalide' });
  }
  await run(`INSERT INTO predictions (player_id, match_id, home, away, updated_at)
             VALUES (?, ?, ?, ?, datetime('now'))
             ON CONFLICT(player_id, match_id) DO UPDATE SET home = excluded.home, away = excluded.away, updated_at = excluded.updated_at`,
            [id, m.id, h, a]);
  res.json({ ok: true, matchId: m.id, home: h, away: a });
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
  const ok = (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) || (req.get('x-admin-key') || '') === adminKey;
  if (!ok) return res.status(403).json({ error: 'forbidden' });
  const s = await sync().catch((e) => ({ ok: false, error: e.message }));
  const l = await pollLive().catch((e) => ({ polled: false, error: e.message }));
  res.json({ sync: s, live: l });
}));

// ---------- démarrage (mode serveur long : local, Railway, Docker…) ----------
if (require.main === module && !ON_VERCEL) {
  (async () => {
    await ensureReady();
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
      console.log(`   Admin : ${base}/ (clé API locale : ${adminKey})`);
      for (const p of pools) console.log(`   ${p.name.padEnd(12)} → ${base}/p/${p.token}`);
      console.log('');
    });
  })();
}

module.exports = app;
