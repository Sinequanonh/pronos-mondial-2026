// Scores en temps réel via le scoreboard public ESPN (sans clé).
// On ne polle que pendant la fenêtre d'un match (kickoff − 5 min → +160 min).
// État live → colonnes live_* ; coup de sifflet final → home_score/away_score + advancer.
const { all, run } = require('./db');
const { TEAMS } = require('./teams');
const { inferAdvancers } = require('./sync');

const ESPN_URL = (yyyymmdd) =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${yyyymmdd}`;

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// nom ESPN normalisé → nom du feed fixturedownload
const LOOKUP = {};
for (const key of Object.keys(TEAMS)) LOOKUP[norm(key)] = key;
Object.assign(LOOKUP, {
  [norm('South Korea')]: 'Korea Republic',
  [norm('Iran')]: 'IR Iran',
  [norm('Ivory Coast')]: "Côte d'Ivoire",
  [norm('Cape Verde')]: 'Cabo Verde',
  [norm('DR Congo')]: 'Congo DR',
  [norm('Democratic Republic of the Congo')]: 'Congo DR',
  [norm('Czech Republic')]: 'Czechia',
  [norm('Turkey')]: 'Türkiye',
  [norm('United States')]: 'USA',
  [norm('Bosnia-Herzegovina')]: 'Bosnia and Herzegovina',
});

const WINDOW_BEFORE = 5 * 60000;
const WINDOW_AFTER = 160 * 60000;

async function fetchDay(yyyymmdd) {
  const res = await fetch(ESPN_URL(yyyymmdd), {
    headers: { 'user-agent': 'pronos-mondial-2026' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  const json = await res.json();
  return json.events || [];
}

async function pollLive() {
  const now = Date.now();
  const open = await all('SELECT * FROM matches WHERE home_score IS NULL');
  const active = open.filter((m) => {
    const t = Date.parse(m.date_utc);
    return now >= t - WINDOW_BEFORE && now <= t + WINDOW_AFTER;
  });
  if (!active.length) return { polled: false };

  const allMatches = await all('SELECT * FROM matches');
  const findOurMatch = (evDate, homeName, awayName) => {
    const t = Date.parse(evDate);
    return allMatches.find((m) =>
      Math.abs(Date.parse(m.date_utc) - t) <= 45 * 60000 &&
      ((m.home === homeName && m.away === awayName) || (m.home === awayName && m.away === homeName))
    );
  };

  const days = [...new Set(active.map((m) => m.date_utc.slice(0, 10).replace(/-/g, '')))];
  const events = [];
  for (const d of days) {
    try { events.push(...await fetchDay(d)); }
    catch (err) { console.warn(`[live] ESPN ${d}: ${err.message}`); }
  }

  let finals = 0;
  for (const ev of events) {
    const comp = ev.competitions && ev.competitions[0];
    if (!comp || !comp.competitors) continue;
    const homeC = comp.competitors.find((c) => c.homeAway === 'home');
    const awayC = comp.competitors.find((c) => c.homeAway === 'away');
    if (!homeC || !awayC) continue;
    const homeName = LOOKUP[norm(homeC.team.displayName)] || LOOKUP[norm(homeC.team.shortDisplayName || '')];
    const awayName = LOOKUP[norm(awayC.team.displayName)] || LOOKUP[norm(awayC.team.shortDisplayName || '')];
    if (!homeName || !awayName) continue;
    const m = findOurMatch(ev.date, homeName, awayName);
    if (!m) continue;

    const swapped = m.home === awayName;
    const st = comp.status || ev.status || {};
    const state = st.type && st.type.state;
    let hs = Number(homeC.score), as = Number(awayC.score);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    if (swapped) [hs, as] = [as, hs];
    const clock = (st.type && st.type.shortDetail) || st.displayClock || '';

    if (state === 'in') {
      await run("UPDATE matches SET live_hs=?, live_as=?, live_min=?, live_state='in' WHERE id=?", [hs, as, clock, m.id]);
    } else if (state === 'post' || (st.type && st.type.completed)) {
      let advancer = null;
      if (m.stage !== 'group') {
        const winC = comp.competitors.find((c) => c.winner === true);
        if (winC) advancer = LOOKUP[norm(winC.team.displayName)] || null;
        if (!advancer && hs !== as) advancer = hs > as ? m.home : m.away;
      }
      await run(
        "UPDATE matches SET home_score=?, away_score=?, advancer=COALESCE(?, advancer), live_state='post', live_min=NULL WHERE id=?",
        [hs, as, advancer, m.id]
      );
      if (m.home_score == null) {
        finals += 1;
        console.log(`[live] terminé : ${m.home} ${hs}–${as} ${m.away} (match ${m.id})`);
      }
    }
  }
  if (finals) await inferAdvancers();
  return { polled: true, events: events.length, finals };
}

module.exports = { pollLive };
