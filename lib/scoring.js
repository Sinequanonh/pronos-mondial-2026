const { all, get } = require('./db');
const { TEAMS } = require('./teams');

// Bonus pour qui devine le champion du monde (attribué quand la finale est jouée)
const CHAMPION_POINTS = Number(process.env.CHAMPION_POINTS || 10);

// Barème : score exact = 3 pts · bon résultat (vainqueur ou nul) = 1 pt · sinon 0.
// Élimination directe : le "bon résultat" = avoir choisi l'équipe qui se qualifie.
function pointsFor(match, ph, pa) {
  if (match.home_score == null || match.away_score == null) return null;
  const hs = match.home_score;
  const as = match.away_score;
  if (ph === hs && pa === as) return 3;
  if (match.stage === 'group') {
    return Math.sign(ph - pa) === Math.sign(hs - as) ? 1 : 0;
  }
  const predAdv = ph > pa ? match.home : ph < pa ? match.away : null;
  const actAdv = match.advancer || (hs !== as ? (hs > as ? match.home : match.away) : null);
  return predAdv && actAdv && predAdv === actAdv ? 1 : 0;
}

// updated_at est en UTC ('YYYY-MM-DD HH:MM:SS' sans fuseau) → ms
const parseUtc = (s) => Date.parse(String(s).replace(' ', 'T') + (/[zZ]$/.test(s) ? '' : 'Z'));
const outcome = (h, a) => (h > a ? 'H' : h < a ? 'A' : 'D');
const dayUTC = (iso) => String(iso).slice(0, 10);

// Badges, calculés sur les pronos réels de chaque joueur (+ contexte du pool).
function badgesFor(items, pid, ctx) {
  // items : pronos VERROUILLÉS du joueur [{ pr:{home,away,updated_at}, m }]
  const fin = items.filter((x) => x.m.home_score != null && x.m.away_score != null)
    .sort((a, b) => a.m.date_utc.localeCompare(b.m.date_utc));
  const total = items.length;
  const badges = [];
  const B = (k) => badges.push(k);

  // --- précision / séries ---
  let exact = 0, best = 0, streak = 0, worst = 0, zStreak = 0;
  let presque = 0, tacticien = 0;
  const dayPts = new Map(); // jour -> [pts...]
  for (const x of fin) {
    const pts = pointsFor(x.m, x.pr.home, x.pr.away);
    if (pts === 3) exact += 1;
    if (pts > 0) { streak += 1; best = Math.max(best, streak); } else streak = 0;
    if (pts === 0) { zStreak += 1; worst = Math.max(worst, zStreak); } else zStreak = 0;
    const diff = Math.abs(x.pr.home - x.m.home_score) + Math.abs(x.pr.away - x.m.away_score);
    if (diff === 1 && pts < 3) presque += 1;
    if (pts === 0 && x.pr.home + x.pr.away === x.m.home_score + x.m.away_score) tacticien += 1;
    (dayPts.get(dayUTC(x.m.date_utc)) || dayPts.set(dayUTC(x.m.date_utc), []).get(dayUTC(x.m.date_utc))).push(pts);
  }
  const perfectDay = [...dayPts.values()].some((arr) => arr.length >= 2 && arr.every((p) => p === 3));
  let francTireur = false;
  for (const x of fin) {
    if (pointsFor(x.m, x.pr.home, x.pr.away) !== 3) continue;
    const ex = ctx.exactCounts.get(x.m.id);
    const nPick = (ctx.matchPicks.get(x.m.id) || []).length;
    if (ex && ex.get(x.pr.home + '-' + x.pr.away) === 1 && nPick >= 3) francTireur = true;
  }
  // maudit : l'équipe désignée gagnante perd
  let decided = 0, cursed = 0;
  for (const x of fin) {
    if (x.pr.home === x.pr.away) continue;
    decided += 1;
    const predHome = x.pr.home > x.pr.away;
    const lost = predHome ? x.m.home_score < x.m.away_score : x.m.away_score < x.m.home_score;
    if (lost) cursed += 1;
  }

  // --- manies (sur pronos verrouillés) ---
  let draws = 0, big = 0, oneNil = 0, mirror = 0, spank = 0, homeWin = 0, decisive = 0, goals = 0;
  for (const x of items) {
    const h = x.pr.home, a = x.pr.away;
    goals += h + a;
    if (h === a) { draws += 1; mirror += 1; }
    else { decisive += 1; if (h > a) homeWin += 1; }
    if ((h === 1 && a === 0) || (h === 0 && a === 1)) oneNil += 1;
    if (h + a >= 5) big += 1;
    if (Math.abs(h - a) >= 3) spank += 1;
  }
  const avgGoals = total ? goals / total : 0;

  // --- France ---
  const fr = items.filter((x) => x.m.home === 'France' || x.m.away === 'France');
  const frBacked = fr.filter((x) => (x.m.home === 'France' ? x.pr.home > x.pr.away : x.pr.away > x.pr.home));

  // --- timing (lead time, heure de dépôt) ---
  let buzzer = 0, leveTot = 0, nuit = 0;
  for (const x of items) {
    const lead = Date.parse(x.m.date_utc) - parseUtc(x.pr.updated_at);
    if (lead >= 0 && lead <= 15 * 60000) buzzer += 1;
    if (lead >= 7 * 86400000) leveTot += 1;
    const parisHour = (new Date(parseUtc(x.pr.updated_at)).getUTCHours() + 2) % 24; // CEST
    if (parisHour < 5) nuit += 1;
  }

  // --- social (consensus du pool) ---
  let consTot = 0, consAgree = 0, lone = false;
  for (const x of items) {
    if (ctx.loneByMatch.get(x.m.id) === pid) lone = true;
    const c = ctx.consensus.get(x.m.id);
    if (!c) continue;
    consTot += 1;
    if (outcome(x.pr.home, x.pr.away) === c) consAgree += 1;
  }

  // ===== attribution (ordre = ordre d'affichage) =====
  // précision
  if (exact >= 3) B('nostradamus'); else if (exact >= 1) B('oeil');
  if (perfectDay) B('journeeParfaite');
  if (francTireur) B('francTireur');
  if (best >= 3) B('feu');
  if (presque >= 4) B('presque');
  if (tacticien >= 3) B('tacticien');
  if (fin.length >= 10 && fin.every((x) => pointsFor(x.m, x.pr.home, x.pr.away) > 0)) B('horloge');
  // manies
  if (oneNil >= 8 && oneNil / total >= 0.25) B('oneNil');
  if (total >= 12 && mirror / total >= 0.4) B('mirror');
  if (spank >= 5) B('fessee');
  if (draws >= 2) B('beton');
  if (big >= 2) B('flambeur');
  if (total >= 10 && avgGoals >= 3.5) B('optimiste');
  if (total >= 10 && avgGoals <= 1.5) B('rabatjoie');
  if (decisive >= 12 && homeWin / decisive >= 0.75) B('casanier');
  // timing
  if (buzzer >= 3) B('buzzer');
  if (leveTot >= 5) B('leveTot');
  if (nuit >= 5) B('nuit');
  // social
  if (lone) B('contre');
  if (consTot >= 8 && consAgree / consTot >= 0.9) B('mouton');
  if (consTot >= 8 && (consTot - consAgree) / consTot >= 0.6) B('loup');
  // France & champion
  if (fr.length >= 1 && frBacked.length === fr.length) B('bleu');
  const myChamp = ctx.champByPlayer.get(pid);
  if (myChamp) {
    if (parseUtc(myChamp.updated_at) < ctx.tournamentStart) B('championPrecoce');
    if (ctx.championCount >= 4 && ctx.teamCounts.get(myChamp.team) === 1) B('rebelleTitre');
  }
  // chambrage
  if (worst >= 5) B('roiZero');
  if (decided >= 5 && cursed / decided >= 0.6) B('maudit');

  return { badges, finishedCount: fin.length };
}

async function leaderboard(poolId) {
  const players = await all('SELECT id, name FROM players WHERE pool_id = ? ORDER BY name', [poolId]);
  const allMatches = await all('SELECT * FROM matches');
  const mById = new Map(allMatches.map((m) => [m.id, m]));
  const finished = allMatches.filter((m) => m.home_score != null && m.away_score != null);
  const byId = new Map(finished.map((m) => [m.id, m]));
  const anyFinished = finished.length > 0;
  const now = Date.now();
  const preds = await all(`
    SELECT p.player_id, p.match_id, p.home, p.away, p.updated_at
    FROM predictions p JOIN players pl ON pl.id = p.player_id
    WHERE pl.pool_id = ?
  `, [poolId]);

  // contexte cross-joueurs : pronos par match → consensus 1N2 + unicité des scores exacts
  const matchPicks = new Map();
  for (const pr of preds) {
    if (!matchPicks.has(pr.match_id)) matchPicks.set(pr.match_id, []);
    matchPicks.get(pr.match_id).push({ pid: pr.player_id, h: pr.home, a: pr.away });
  }
  const consensus = new Map();
  const exactCounts = new Map();
  const loneByMatch = new Map(); // matchId -> pid du SEUL joueur à contre-courant (tous les autres d'accord)
  for (const [mid, picks] of matchPicks) {
    const tally = { H: 0, D: 0, A: 0 };
    const ex = new Map();
    for (const p of picks) {
      tally[outcome(p.h, p.a)] += 1;
      const k = p.h + '-' + p.a;
      ex.set(k, (ex.get(k) || 0) + 1);
    }
    let cons = null;
    for (const o of ['H', 'D', 'A']) if (tally[o] > picks.length / 2) cons = o;
    consensus.set(mid, cons);
    exactCounts.set(mid, ex);
    // ≥3 votants, exactement 2 issues, dont une à 1 seul → ce joueur est le franc rebelle
    const present = ['H', 'D', 'A'].filter((o) => tally[o] > 0);
    if (picks.length >= 3 && present.length === 2) {
      const minorOutcome = present.find((o) => tally[o] === 1);
      if (minorOutcome) {
        const rebel = picks.find((p) => outcome(p.h, p.a) === minorOutcome);
        if (rebel) loneByMatch.set(mid, rebel.pid);
      }
    }
  }
  // contexte champion
  const champRows = await all(`
    SELECT cp.player_id, cp.team, cp.updated_at FROM champion_picks cp
    JOIN players pl ON pl.id = cp.player_id WHERE pl.pool_id = ?
  `, [poolId]);
  const champByPlayer = new Map(champRows.map((r) => [r.player_id, r]));
  const teamCounts = new Map();
  for (const r of champRows) teamCounts.set(r.team, (teamCounts.get(r.team) || 0) + 1);
  const tournamentStart = Math.min(...allMatches.map((m) => Date.parse(m.date_utc)));
  const ctx = { matchPicks, consensus, exactCounts, loneByMatch, champByPlayer, teamCounts, championCount: champRows.length, tournamentStart };

  // capitaine : un match par journée (round) dont les points comptent double
  const capRows = await all(`
    SELECT cp.player_id, cp.round, cp.match_id FROM captain_picks cp
    JOIN players pl ON pl.id = cp.player_id WHERE pl.pool_id = ?
  `, [poolId]);
  const capByPlayer = new Map();
  for (const r of capRows) {
    if (!capByPlayer.has(r.player_id)) capByPlayer.set(r.player_id, new Map());
    capByPlayer.get(r.player_id).set(r.round, r.match_id);
  }

  const stats = new Map(players.map((p) => [p.id, { id: p.id, name: p.name, pts: 0, exact: 0, outcome: 0, played: 0 }]));
  const lockedPredsByPlayer = new Map(players.map((p) => [p.id, []]));
  for (const pr of preds) {
    const m = byId.get(pr.match_id);
    const full = mById.get(pr.match_id);
    if (full && Date.parse(full.date_utc) <= now) lockedPredsByPlayer.get(pr.player_id)?.push({ pr, m: full });
    if (!m) continue;
    const s = stats.get(pr.player_id);
    if (!s) continue;
    const pts = pointsFor(m, pr.home, pr.away);
    if (pts == null) continue;
    s.played += 1;
    s.pts += pts;
    if (pts === 3) s.exact += 1;
    else if (pts === 1) s.outcome += 1;
    // capitaine : ce match double pour ce joueur sur sa journée
    const cap = capByPlayer.get(pr.player_id);
    if (cap && cap.get(m.round) === m.id) { s.pts += pts; s.captainPts = (s.captainPts || 0) + pts; }
  }
  // bonus champion : la finale est jouée et le vainqueur connu
  const final = await get('SELECT * FROM matches WHERE id = 104');
  if (final && final.home_score != null && final.away_score != null) {
    const champ = final.advancer ||
      (final.home_score !== final.away_score
        ? (final.home_score > final.away_score ? final.home : final.away)
        : null);
    if (champ) {
      const winners = await all(`
        SELECT cp.player_id FROM champion_picks cp
        JOIN players pl ON pl.id = cp.player_id
        WHERE pl.pool_id = ? AND cp.team = ?
      `, [poolId, champ]);
      for (const w of winners) {
        const s = stats.get(w.player_id);
        if (s) { s.pts += CHAMPION_POINTS; s.champ = true; }
      }
    }
  }

  // badges par joueur
  for (const [pid, s] of stats) {
    const { badges, finishedCount } = badgesFor(lockedPredsByPlayer.get(pid) || [], pid, ctx);
    s.badges = badges;
    if (anyFinished && finishedCount === 0) s.badges.push('fantome'); // n'a joué aucun match terminé
  }

  const sorted = [...stats.values()].sort(
    (a, b) => b.pts - a.pts || b.exact - a.exact || b.outcome - a.outcome || a.name.localeCompare(b.name, 'fr')
  );
  // bonnet d'âne : dernier du classement (≥3 joueurs, des points en jeu)
  if (sorted.length >= 3 && anyFinished && sorted[0].pts > 0) {
    sorted[sorted.length - 1].badges.push('ane');
  }
  return sorted;
}

module.exports = { pointsFor, leaderboard, TEAMS, CHAMPION_POINTS };
