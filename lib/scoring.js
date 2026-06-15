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

// Badges rigolos, calculés sur les pronos réels de chaque joueur.
function badgesFor(items) {
  // items : [{ pr:{home,away}, m:{...match complet...} }] — tous les pronos du joueur (matchs verrouillés)
  const fin = items.filter((x) => x.m.home_score != null && x.m.away_score != null)
    .sort((a, b) => a.m.date_utc.localeCompare(b.m.date_utc));
  let exact = 0, best = 0, streak = 0;
  for (const x of fin) {
    const pts = pointsFor(x.m, x.pr.home, x.pr.away);
    if (pts === 3) exact += 1;
    if (pts > 0) { streak += 1; best = Math.max(best, streak); } else streak = 0;
  }
  let drawsPicked = 0, bigPicks = 0;
  for (const x of items) {
    if (x.pr.home === x.pr.away) drawsPicked += 1;
    if (x.pr.home + x.pr.away >= 5) bigPicks += 1;
  }
  const fr = items.filter((x) => x.m.home === 'France' || x.m.away === 'France');
  const frBacked = fr.filter((x) => (x.m.home === 'France' ? x.pr.home > x.pr.away : x.pr.away > x.pr.home));

  const badges = [];
  if (exact >= 3) badges.push('nostradamus');
  else if (exact >= 1) badges.push('oeil');
  if (best >= 3) badges.push('feu');
  if (fr.length >= 1 && frBacked.length === fr.length) badges.push('bleu');
  if (drawsPicked >= 2) badges.push('beton');
  if (bigPicks >= 2) badges.push('flambeur');
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
    SELECT p.player_id, p.match_id, p.home, p.away
    FROM predictions p JOIN players pl ON pl.id = p.player_id
    WHERE pl.pool_id = ?
  `, [poolId]);

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
    const { badges, finishedCount } = badgesFor(lockedPredsByPlayer.get(pid) || []);
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
