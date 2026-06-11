const { all } = require('./db');
const { TEAMS } = require('./teams');

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

async function leaderboard(poolId) {
  const players = await all('SELECT id, name FROM players WHERE pool_id = ? ORDER BY name', [poolId]);
  const finished = await all('SELECT * FROM matches WHERE home_score IS NOT NULL AND away_score IS NOT NULL');
  const byId = new Map(finished.map((m) => [m.id, m]));
  const preds = await all(`
    SELECT p.player_id, p.match_id, p.home, p.away
    FROM predictions p JOIN players pl ON pl.id = p.player_id
    WHERE pl.pool_id = ?
  `, [poolId]);

  const stats = new Map(players.map((p) => [p.id, { id: p.id, name: p.name, pts: 0, exact: 0, outcome: 0, played: 0 }]));
  for (const pr of preds) {
    const m = byId.get(pr.match_id);
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
  return [...stats.values()].sort(
    (a, b) => b.pts - a.pts || b.exact - a.exact || b.outcome - a.outcome || a.name.localeCompare(b.name, 'fr')
  );
}

module.exports = { pointsFor, leaderboard, TEAMS };
