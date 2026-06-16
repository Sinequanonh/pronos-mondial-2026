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

  // --- précision / séries (matchs terminés) ---
  let exact = 0, best = 0, streak = 0, presque = 0;
  const dayPts = new Map(); // jour -> [pts...]
  for (const x of fin) {
    const pts = pointsFor(x.m, x.pr.home, x.pr.away);
    if (pts === 3) exact += 1;
    if (pts > 0) { streak += 1; best = Math.max(best, streak); } else streak = 0;
    const diff = Math.abs(x.pr.home - x.m.home_score) + Math.abs(x.pr.away - x.m.away_score);
    if (diff === 1 && pts < 3) presque += 1;
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

  // --- style de prono (pronos verrouillés) : moyenne de buts annoncée ---
  const predGoals = items.reduce((s, x) => s + x.pr.home + x.pr.away, 0);
  const avgGoals = total ? predGoals / total : 0;

  // --- France ---
  const fr = items.filter((x) => x.m.home === 'France' || x.m.away === 'France');
  const frBacked = fr.filter((x) => (x.m.home === 'France' ? x.pr.home > x.pr.away : x.pr.away > x.pr.home));

  // --- social : seul à contre-courant du pool sur un match ---
  let lone = false;
  for (const x of items) { if (ctx.loneByMatch.get(x.m.id) === pid) { lone = true; break; } }

  // ===== attribution (ordre = priorité d'affichage ; l'écran n'en montre que 4) =====
  if (exact >= 3) B('nostradamus');                          // 3 scores exacts ou +
  if (perfectDay) B('journeeParfaite');                      // tous les matchs d'un jour pile
  if (francTireur) B('francTireur');                         // exact que personne d'autre n'a osé
  if (best >= 3) B('feu');                                   // 3 bons pronos d'affilée
  if (presque >= 4) B('presque');                            // roi du « à un but près »
  if (lone) B('contre');                                     // seul à contre-courant du pool
  if (decided >= 5 && cursed / decided >= 0.6) B('maudit');  // les équipes qu'il sacre perdent
  const myChamp = ctx.champByPlayer.get(pid);
  if (myChamp && ctx.championCount >= 4 && ctx.teamCounts.get(myChamp.team) === 1) B('rebelleTitre'); // seul sur son champion
  if (total >= 8 && avgGoals <= 2.0) B('beton');             // n'annonce que des matchs fermés
  if (total >= 8 && avgGoals >= 3.3) B('flambeur');          // n'annonce que des cartons
  if (fr.length >= 1 && frBacked.length === fr.length) B('bleu'); // toujours derrière les Bleus

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

  // contexte cross-joueurs : pronos par match → unicité des scores exacts + franc rebelle
  const matchPicks = new Map();
  for (const pr of preds) {
    if (!matchPicks.has(pr.match_id)) matchPicks.set(pr.match_id, []);
    matchPicks.get(pr.match_id).push({ pid: pr.player_id, h: pr.home, a: pr.away });
  }
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
  const ctx = { matchPicks, exactCounts, loneByMatch, champByPlayer, teamCounts, championCount: champRows.length };

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
  return sorted;
}

module.exports = { pointsFor, leaderboard, TEAMS, CHAMPION_POINTS };
