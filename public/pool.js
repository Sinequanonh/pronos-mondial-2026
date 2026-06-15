/* Pronos Mondial 2026 — vue d'un pool, design façon fiche Google (FR/EN, sombre, live, vues par onglets) */
const TOKEN = decodeURIComponent(location.pathname.split('/').pop());
const LSKEY = 'pronos26:' + TOKEN;
const QPKEY = 'pronos26:qp:' + TOKEN;
const PENDING_KEY = 'pronos26:pending:' + TOKEN; // miroir local des pronos non encore confirmés
const SAVE_DEBOUNCE = 650;
const VIEWS = ['apercu', 'matchs', 'arbre', 'groupes', 'classement'];

const S = {
  key: localStorage.getItem(LSKEY) || '',
  data: null,
  dirty: new Map(),   // matchId -> [h, a] en attente d'envoi
  viewOnly: false,
  saveTimer: null,
  retryTimer: null,
  saving: false,      // un PUT est en vol (single-flight)
  retry: 0,           // compteur de backoff
  lastInput: 0,       // horodatage de la dernière frappe (anti-clobber du poll)
  showPast: false,
  bktCentered: false,
  view: (() => {
    const v = localStorage.getItem('pronos26:view');
    if (VIEWS.includes(v)) return v;
    return window.innerWidth <= 900 ? 'matchs' : 'apercu';
  })(),
};
document.body.dataset.view = S.view;

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- i18n ----------
const I18N = {
  fr: {
    brand: 'Mondial 2026',
    docTitle: (p) => `${p} · Pronos Mondial 2026`,
    tab_apercu: 'Aperçu', tab_matchs: 'Matchs', tab_arbre: 'Arbre', tab_groupes: 'Groupes', tab_classement: 'Classement',
    matchsH2: '🗓️ Tous les matchs',
    matchsSub: 'heures locales · tape tes pronos directement dans la liste',
    bracketH2: '🏆 Tableau final',
    bracketSub: "du 28 juin au 19 juillet — les pronos s'ouvrent quand les équipes sont connues",
    boardH2: '🏅 Classement',
    groupsH2: '📋 Phase de groupes',
    groupsSub: 'classements en direct · pronos dans chaque match',
    players: (n) => `${n} joueur${n > 1 ? 's' : ''}`,
    group: (g) => `Groupe ${g}`,
    stH: ['#', 'Équipe', 'J', 'G', 'N', 'P', 'Diff', 'Pts'],
    caps: { r32: '16ᵉˢ de finale', r16: '8ᵉˢ', qf: 'Quarts', sf: 'Demi' },
    stageShort: { r32: '16ᵉˢ de finale', r16: '8ᵉˢ de finale', qf: 'Quart', sf: 'Demi-finale', third: 'Petite finale', final: 'Finale' },
    stageSubKo: { r32: '16ᵉˢ de finale', r16: '8ᵉˢ de finale', qf: 'Quarts de finale', sf: 'Demi-finales', third: 'Petite finale', final: 'Finale' },
    mdGroup: (n) => `Phase de groupes · Journée ${n} sur 3`,
    finalCap: 'Finale · 19 juillet',
    thirdCap: 'Petite finale · 18 juillet',
    champ: '🏆 Champion', champWorld: 'Champion du monde', champYours: 'Ton champion', champTbd: 'à toi de le prédire…',
    ph1: (g) => `1ᵉʳ gr. ${g}`, ph2: (g) => `2ᵉ gr. ${g}`, ph3: (l) => `3ᵉ ${l}`,
    phW: (n) => `Vainq. m${n}`, phL: (n) => `Perd. m${n}`,
    nextMatch: (vs, rel) => `Prochain match : <b>${vs}</b> ${rel}`,
    over: 'Compétition terminée 🏆',
    liveNow: (s) => `🔴 ${s}`,
    today: "Aujourd'hui", tomorrow: 'Demain',
    finished: 'Terminé', liveWord: 'Live',
    showPast: (n) => `Afficher les ${n} jours passés`, hidePast: 'Masquer les jours passés',
    imminent: 'imminent',
    inMin: (m) => `dans ${m} min`,
    atTime: (t2, h, mm) => `à ${t2} (dans ${h} h ${mm})`,
    onDay: (d, t2) => `${d} à ${t2}`,
    join: 'Participer ⚽', switch: 'changer',
    pts: (n) => `${n} pt${n > 1 ? 's' : ''}`,
    exactSub: (e, o) => `${e} exact${e > 1 ? 's' : ''} · ${o} bon${o > 1 ? 's' : ''} résultat${o > 1 ? 's' : ''}`,
    boardEmpty: "Personne pour l'instant — partage le lien et que le meilleur gagne 🎉",
    rules: 'Comment ça marche',
    rule3: '<b>3 pts</b> — score exact',
    rule1: '<b>1 pt</b> — bon résultat (vainqueur ou nul)',
    rule0: '<b>0 pt</b> — raté 😬',
    ruleKo: "En élimination directe, le « bon résultat », c'est l'équipe qui se qualifie. Les pronos se verrouillent au coup d'envoi 🔒",
    myCount: (m, o) => `Tu as pronostiqué <b>${m}</b> match${m > 1 ? 's' : ''} · <b>${o}</b> encore ouvert${o > 1 ? 's' : ''}.`,
    syncInfo: (ago) => `Scores en direct pendant les matchs · dernière synchro ${ago}`,
    agoNow: "à l'instant", agoMin: (m) => `il y a ${m} min`, agoH: (h, m) => `il y a ${h} h${m}`,
    foot: 'Heures affichées dans ton fuseau · Données fixturedownload.com · Live ESPN · Drapeaux flagcdn.com',
    joinTitle: (p) => `Rejoindre « ${p} »`,
    joinP: "Choisis un pseudo, c'est tout. Le PIN est optionnel — il empêche juste les petits malins de pronostiquer à ta place.",
    joinName: 'Ton pseudo', joinNamePh: 'ex. Tonton Michel',
    joinPin: 'PIN (optionnel, 3 à 6 chiffres)',
    joinGo: "C'est parti ⚽", joinView: 'Je veux juste regarder',
    joinPinErr: 'Ce pseudo est protégé par un PIN — entre le bon code.',
    joinSrvErr: 'Impossible de joindre le serveur.',
    welcome: (n) => `Bienvenue ${n} 🎉 Fais tes pronos !`,
    welcomeBack: (n) => `Re-bonjour ${n} 👋`,
    saved: (n) => `✓ ${n} prono${n > 1 ? 's' : ''} enregistré${n > 1 ? 's' : ''}`,
    sessionLost: 'Session perdue — re-choisis ton pseudo',
    offline: 'Hors ligne ? Réessaie dans un instant',
    noDraw: 'Pas de match nul en élimination directe 😉',
    confirmSwitch: 'Changer de pseudo ? (les pronos déjà faits restent liés à l\'ancien pseudo)',
    seeAll: 'Voir les pronos de tout le monde',
    invalidLink: 'Lien invalide 😕',
    invalidLinkP: "Ce pool n'existe pas (ou plus). Vérifie le lien qu'on t'a partagé.",
    qpTitle: '⚡ Pronos express',
    qpSub: 'Les matchs des prochaines 24 h — tape un score, c\'est sauvegardé direct.',
    qpEmpty: 'Tout est pronostiqué pour les prochaines 24 h 🎉',
    qpClose: 'Fermer',
    qpBanner: (n) => `⚡ ${n} match${n > 1 ? 's' : ''} dans les prochaines 24 h sans prono`,
    qpGo: 'Pronostiquer',
    champH2: '🏆 Prono champion',
    champSub: 'qui soulève la Coupe le 19 juillet ?',
    champDeadline: (d, t2) => `modifiable jusqu'à ${d} · ${t2}`,
    champLockedSub: 'verrouillé — les pronos sont publics',
    champPlaceholder: 'Choisis ton pays…',
    champHidden: (n) => `${n} joueur${n > 1 ? 's ont' : ' a'} déjà choisi — pronos cachés jusqu'au verrouillage 🔒`,
    champWhoHidden: 'le pays choisi reste caché jusqu\'au verrouillage',
    mvpDay: 'Joueur du jour',
    mvpPts: (p) => `+${p} pt${p > 1 ? 's' : ''}`,
    exactToast: '🎯 Score exact ! Bravo, +3',
    badgesTitle: 'Les badges',
    champSaved: (t2) => `🏆 Champion enregistré : ${t2}`,
    champJoinFirst: 'Inscris-toi (bouton « Participer ») pour miser sur ton champion.',
    champNoPick: 'pas de prono',
    champRight: 'TROUVÉ 🎯',
    champBanner: (d) => `🏆 Choisis ton pays champion avant ${d}`,
    champGo: 'Choisir',
    champSearch: 'Rechercher un pays…',
    champNone: 'Aucun pays ne correspond',
    champPoints: (p) => `🎁 <b>+${p} pts</b> au classement si tu trouves le champion`,
    ruleChamp: (p) => `<b>+${p} pts</b> — champion du monde deviné 🏆`,
    whoTitle: 'Qui a déjà pronostiqué ?',
    whoHidden: 'les scores restent secrets jusqu\'au coup d\'envoi',
    savPending: '✎ Modification…',
    savSaving: '⏳ Enregistrement…',
    savSaved: '✓ Enregistré',
    savError: '⚠︎ Non enregistré — nouvel essai…',
    mine: 'toi',
    reasons: {
      'match inconnu': 'match inconnu',
      'match commencé': 'match commencé',
      'équipes pas encore connues': 'équipes pas encore connues',
      'score invalide': 'score invalide',
      'pas de nul en élimination directe': 'pas de nul en élimination directe',
      'Pseudo entre 2 et 20 caractères': 'Pseudo entre 2 et 20 caractères',
      'PIN : 3 à 6 chiffres': 'PIN : 3 à 6 chiffres',
      'prono champion verrouillé': 'prono champion verrouillé',
      'équipe inconnue': 'équipe inconnue',
    },
  },
  en: {
    brand: 'World Cup 2026',
    docTitle: (p) => `${p} · World Cup 2026 predictions`,
    tab_apercu: 'Overview', tab_matchs: 'Matches', tab_arbre: 'Bracket', tab_groupes: 'Groups', tab_classement: 'Standings',
    matchsH2: '🗓️ All matches',
    matchsSub: 'local times · type your picks right in the list',
    bracketH2: '🏆 Knockout bracket',
    bracketSub: 'June 28 – July 19 — picks open once the teams are known',
    boardH2: '🏅 Leaderboard',
    groupsH2: '📋 Group stage',
    groupsSub: 'live tables · picks inside every match',
    players: (n) => `${n} player${n > 1 ? 's' : ''}`,
    group: (g) => `Group ${g}`,
    stH: ['#', 'Team', 'MP', 'W', 'D', 'L', 'GD', 'Pts'],
    caps: { r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarter-finals', sf: 'Semi' },
    stageShort: { r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarter-final', sf: 'Semi-final', third: 'Third place', final: 'Final' },
    stageSubKo: { r32: 'Round of 32', r16: 'Round of 16', qf: 'Quarter-finals', sf: 'Semi-finals', third: 'Third place play-off', final: 'Final' },
    mdGroup: (n) => `Group stage · Matchday ${n} of 3`,
    finalCap: 'Final · July 19',
    thirdCap: 'Third place · July 18',
    champ: '🏆 Champion', champWorld: 'World champions', champYours: 'Your pick', champTbd: 'make your pick…',
    ph1: (g) => `1st gr. ${g}`, ph2: (g) => `2nd gr. ${g}`, ph3: (l) => `3rd ${l}`,
    phW: (n) => `W m${n}`, phL: (n) => `L m${n}`,
    nextMatch: (vs, rel) => `Next match: <b>${vs}</b> ${rel}`,
    over: 'Tournament over 🏆',
    liveNow: (s) => `🔴 ${s}`,
    today: 'Today', tomorrow: 'Tomorrow',
    finished: 'FT', liveWord: 'Live',
    showPast: (n) => `Show ${n} past day${n > 1 ? 's' : ''}`, hidePast: 'Hide past days',
    imminent: 'kicking off',
    inMin: (m) => `in ${m} min`,
    atTime: (t2, h, mm) => `at ${t2} (in ${h}h${mm})`,
    onDay: (d, t2) => `${d} at ${t2}`,
    join: 'Join in ⚽', switch: 'switch',
    pts: (n) => `${n} pt${n > 1 ? 's' : ''}`,
    exactSub: (e, o) => `${e} exact · ${o} correct result${o > 1 ? 's' : ''}`,
    boardEmpty: 'Nobody yet — share the link and may the best win 🎉',
    rules: 'How it works',
    rule3: '<b>3 pts</b> — exact score',
    rule1: '<b>1 pt</b> — correct result (winner or draw)',
    rule0: '<b>0 pts</b> — missed 😬',
    ruleKo: 'In the knockout rounds, a “correct result” means picking the team that goes through. Picks lock at kickoff 🔒',
    myCount: (m, o) => `You've predicted <b>${m}</b> match${m > 1 ? 'es' : ''} · <b>${o}</b> still open.`,
    syncInfo: (ago) => `Live scores during matches · last sync ${ago}`,
    agoNow: 'just now', agoMin: (m) => `${m} min ago`, agoH: (h, m) => `${h}h${m} ago`,
    foot: 'Times shown in your timezone · Data fixturedownload.com · Live ESPN · Flags flagcdn.com',
    joinTitle: (p) => `Join “${p}”`,
    joinP: 'Pick a nickname, that\'s it. The PIN is optional — it just stops pranksters from predicting in your name.',
    joinName: 'Your nickname', joinNamePh: 'e.g. Uncle Mike',
    joinPin: 'PIN (optional, 3–6 digits)',
    joinGo: "Let's go ⚽", joinView: 'Just browsing',
    joinPinErr: 'This nickname is PIN-protected — enter the right code.',
    joinSrvErr: 'Could not reach the server.',
    welcome: (n) => `Welcome ${n} 🎉 Make your picks!`,
    welcomeBack: (n) => `Welcome back ${n} 👋`,
    saved: (n) => `✓ ${n} pick${n > 1 ? 's' : ''} saved`,
    sessionLost: 'Session lost — pick your nickname again',
    offline: 'Offline? Try again in a moment',
    noDraw: 'No draws in knockout games 😉',
    confirmSwitch: 'Switch nickname? (picks already made stay with the old nickname)',
    seeAll: "See everyone's picks",
    invalidLink: 'Invalid link 😕',
    invalidLinkP: 'This pool doesn\'t exist (anymore). Double-check the link you were sent.',
    qpTitle: '⚡ Quick picks',
    qpSub: 'Matches in the next 24 hours — type a score, it saves instantly.',
    qpEmpty: 'Everything in the next 24 hours is predicted 🎉',
    qpClose: 'Done',
    qpBanner: (n) => `⚡ ${n} match${n > 1 ? 'es' : ''} in the next 24 h without a pick`,
    qpGo: 'Make picks',
    champH2: '🏆 Champion pick',
    champSub: 'who lifts the trophy on July 19?',
    champDeadline: (d, t2) => `editable until ${d} · ${t2}`,
    champLockedSub: 'locked — everyone\'s picks are public',
    champPlaceholder: 'Pick your country…',
    champHidden: (n) => `${n} player${n > 1 ? 's have' : ' has'} picked — hidden until lock 🔒`,
    champWhoHidden: 'the chosen country stays hidden until lock',
    mvpDay: 'Player of the day',
    mvpPts: (p) => `+${p} pt${p > 1 ? 's' : ''}`,
    exactToast: '🎯 Exact score! Nice, +3',
    badgesTitle: 'Badges',
    champSaved: (t2) => `🏆 Champion saved: ${t2}`,
    champJoinFirst: 'Join the pool ("Join in") to place your champion pick.',
    champNoPick: 'no pick',
    champRight: 'NAILED IT 🎯',
    champBanner: (d) => `🏆 Pick your champion before ${d}`,
    champGo: 'Pick now',
    champSearch: 'Search a country…',
    champNone: 'No matching country',
    champPoints: (p) => `🎁 <b>+${p} pts</b> on the leaderboard if you nail the champion`,
    ruleChamp: (p) => `<b>+${p} pts</b> — world champion guessed 🏆`,
    whoTitle: 'Who has picked already?',
    whoHidden: 'scores stay secret until kickoff',
    savPending: '✎ Editing…',
    savSaving: '⏳ Saving…',
    savSaved: '✓ Saved',
    savError: '⚠︎ Not saved — retrying…',
    mine: 'you',
    reasons: {
      'match inconnu': 'unknown match',
      'match commencé': 'match already started',
      'équipes pas encore connues': 'teams not known yet',
      'score invalide': 'invalid score',
      'pas de nul en élimination directe': 'no draws in knockout games',
      'Pseudo entre 2 et 20 caractères': 'Nickname must be 2–20 characters',
      'PIN : 3 à 6 chiffres': 'PIN: 3–6 digits',
      'prono champion verrouillé': 'champion pick is locked',
      'équipe inconnue': 'unknown team',
    },
  },
};

const LSLANG = 'pronos26:lang:' + TOKEN; // choix explicite de l'utilisateur, par pool
let LANG = localStorage.getItem(LSLANG) || localStorage.getItem('pronos26:lang') ||
  ((navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en');
// après le premier fetch : si pas de choix explicite, la langue par défaut du pool s'applique
function resolveLang() {
  const poolLang = S.data && S.data.pool.lang;
  if (!localStorage.getItem(LSLANG) && poolLang && poolLang !== LANG) {
    LANG = poolLang;
    makeFormatters();
  }
}
const t = (k, ...a) => {
  const v = (I18N[LANG] && I18N[LANG][k]) ?? I18N.fr[k] ?? k;
  return typeof v === 'function' ? v(...a) : v;
};
const trReason = (r) => (I18N[LANG].reasons || {})[r] || r;

// ---------- thème ----------
let THEME = document.documentElement.dataset.theme || 'light';
function applyTheme() {
  document.documentElement.dataset.theme = THEME;
  $('#btn-theme').textContent = THEME === 'dark' ? '☀️' : '🌙';
  $('#btn-theme').title = THEME === 'dark' ? 'Light mode' : 'Dark mode';
}

// ---------- données ----------
const SIDE_L = { r32: [74, 77, 73, 75, 83, 84, 81, 82], r16: [89, 90, 93, 94], qf: [97, 98], sf: [101] };
const SIDE_R = { sf: [102], qf: [99, 100], r16: [91, 92, 95, 96], r32: [76, 78, 79, 80, 86, 88, 85, 87] };

let MATCHES = new Map();
const M = (id) => MATCHES.get(id);
const team = (name) => (S.data && S.data.teams[name]) || null;
const tNm = (tm) => (LANG === 'fr' ? tm.fr : tm.en) || tm.fr;
const myPick = (id) => (S.data && S.data.mine[id]) || null;
const canEdit = (m) => !!(S.key && S.data.me && !m.locked && team(m.home) && team(m.away));
const isLive = (m) => !m.finished && (m.lstate === 'in' || (m.locked && Date.now() - Date.parse(m.date) < 140 * 60000));
const hasLiveScore = (m) => isLive(m) && m.lhs != null && m.las != null;

const flagImg = (code, cls = 'fl') =>
  `<img class="${cls}" src="https://flagcdn.com/${cls.includes('big') ? 'h80' : 'h40'}/${code}.png" alt="" loading="lazy">`;

// ---------- formats dates ----------
let fDay, fTime, fShort, fLong;
function makeFormatters() {
  const loc = LANG === 'fr' ? 'fr-FR'
    : (navigator.language || '').toLowerCase().startsWith('en') ? navigator.language : 'en-GB';
  fDay = new Intl.DateTimeFormat(loc, { weekday: 'short', day: '2-digit', month: '2-digit' });
  fTime = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' });
  fShort = new Intl.DateTimeFormat(loc, { day: '2-digit', month: '2-digit' });
  fLong = new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long' });
}
makeFormatters();
const fmtDay = (d) => fDay.format(new Date(d)).replace('.', '');
const fmtTime = (d) => fTime.format(new Date(d));
const fmtMeta = (d) => `${fShort.format(new Date(d))} ${fTime.format(new Date(d))}`;
const fmtLong = (d) => cap1(fLong.format(new Date(d)));
function fmtRel(d) {
  const diff = Date.parse(d) - Date.now();
  if (diff < 60000) return t('imminent');
  if (diff < 3600000) return t('inMin', Math.round(diff / 60000));
  if (diff < 86400000) return t('atTime', fmtTime(d), Math.floor(diff / 3600000), Math.round((diff % 3600000) / 60000).toString().padStart(2, '0'));
  return t('onDay', fmtDay(d), fmtTime(d));
}
function fmtRelPast(d) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(d)) / 60000));
  if (mins < 1) return t('agoNow');
  if (mins < 60) return t('agoMin', mins);
  return t('agoH', Math.floor(mins / 60), mins % 60 ? (mins % 60).toString().padStart(2, '0') : '');
}
const dayKeyOf = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };

// ---------- scoring (miroir du serveur, pour l'affichage) ----------
function actualAdvancer(m) {
  if (m.advancer) return m.advancer;
  if (m.finished && m.hs !== m.as) return m.hs > m.as ? m.home : m.away;
  return null;
}
function ptsOf(m, pred) {
  if (!m.finished || !pred) return null;
  const [ph, pa] = pred;
  if (ph === m.hs && pa === m.as) return 3;
  if (m.stage === 'group') return Math.sign(ph - pa) === Math.sign(m.hs - m.as) ? 1 : 0;
  const predAdv = ph > pa ? m.home : ph < pa ? m.away : null;
  const actAdv = actualAdvancer(m);
  return predAdv && actAdv && predAdv === actAdv ? 1 : 0;
}
const chipHtml = (pts) =>
  pts == null ? '' : `<span class="chip c${pts}">${pts > 0 ? '+' + pts : '0'}</span>`;

// ---------- placeholders ----------
function phLabel(m, side) {
  const raw = side === 'h' ? m.home : m.away;
  let x;
  if ((x = raw.match(/^1([A-L])$/))) return t('ph1', x[1]);
  if ((x = raw.match(/^2([A-L])$/))) return t('ph2', x[1]);
  if ((x = raw.match(/^3([A-L]+)$/))) return t('ph3', x[1].split('').join('·'));
  const src = (S.data.sources[m.id] || [])[side === 'h' ? 0 : 1];
  if (src) return src > 0 ? t('phW', src) : t('phL', -src);
  return raw;
}

function winCls(m, side) {
  if (!m.finished) return '';
  const adv = m.stage === 'group' ? (m.hs === m.as ? null : m.hs > m.as ? m.home : m.away) : actualAdvancer(m);
  if (!adv) return '';
  return adv === (side === 'h' ? m.home : m.away) ? 'win' : 'lose';
}

// ---------- item de match (style fiche Google) ----------
function miScore(m, side) {
  const pred = myPick(m.id);
  if (m.finished) return `<span class="mi-sc">${side === 'h' ? m.hs : m.as}</span>`;
  if (hasLiveScore(m)) return `<span class="mi-sc livec">${side === 'h' ? m.lhs : m.las}</span>`;
  if (canEdit(m)) {
    const pend = S.dirty.get(m.id);
    const v = pend ? pend[side === 'h' ? 0 : 1] : pred ? pred[side === 'h' ? 0 : 1] : '';
    return `<input class="bi" data-m="${m.id}" data-s="${side}" type="number" min="0" max="30" inputmode="numeric" value="${v}">`;
  }
  if (pred && !m.locked) return `<span class="mi-sc mine">${pred[side === 'h' ? 0 : 1]}</span>`;
  return '<span class="mi-sc dim">–</span>';
}

function miSide(m) {
  if (isLive(m)) return `<span class="live">${t('liveWord')}</span><span class="live">${esc(m.lmin || '')}</span>`;
  if (m.finished) {
    const my = myPick(m.id);
    return `<span>${t('finished')}</span>${my ? chipHtml(ptsOf(m, my)) : ''}`;
  }
  const k = dayKeyOf(m.date);
  const day = k === dayKeyOf(Date.now()) ? t('today') : k === dayKeyOf(Date.now() + 86400000) ? t('tomorrow') : fmtDay(m.date);
  return `<span class="day">${day}</span><span class="time">${fmtTime(m.date)}</span>`;
}

function matchItem(m, showStage) {
  const th = team(m.home), ta = team(m.away);
  const my = myPick(m.id);
  const others = S.data.others[m.id] || [];
  const expandable = m.locked && others.length > 0;

  const label = showStage ? (m.grp ? t('group', m.grp) : t('stageShort')[m.stage] || I18N[LANG].stageShort[m.stage]) : '';
  const pickersList = (S.data.pickers || {})[m.id] || [];
  const metaR = !m.locked
    ? `<button class="who-btn" data-who="${m.id}" title="${t('whoTitle')}">👥 ${S.data.counts[m.id] || 0} ▾</button>`
    : expandable ? '▾' : '';
  const whoHtml = !m.locked && S.data.players.length
    ? `<div class="who-panel" hidden>
        ${pickersList.map((n) => `<div class="row done">✓ <b>${esc(n)}</b></div>`).join('')}
        ${S.data.players.filter((p) => !pickersList.includes(p)).map((n) => `<div class="row wait">⏳ ${esc(n)}</div>`).join('')}
        <div class="who-note">🔒 ${t('whoHidden')}</div>
      </div>`
    : '';
  const teamRow = (side) => {
    const tm = side === 'h' ? th : ta;
    const raw = side === 'h' ? m.home : m.away;
    return `<div class="mi-team ${tm ? '' : 'ph'} ${winCls(m, side)}">
      ${tm ? flagImg(tm.code) : '<span class="fl ph">?</span>'}
      <span class="mi-name">${esc(tm ? tNm(tm) : phLabel(m, side))}</span>
      ${miScore(m, side)}
    </div>`;
  };
  const mineLine = m.locked && my
    ? `<div class="mi-mine">${t('mine')} : ${my[0]}–${my[1]}${m.finished ? ' ' + chipHtml(ptsOf(m, my)) : ''}</div>`
    : '';
  const othersHtml = expandable
    ? `<div class="gm-others" data-o="${m.id}" hidden>${others.map((o) =>
        `<div class="row"><span class="nm">${esc(o.name)}</span><span class="sc">${o.h}<i>–</i>${o.a}</span><span class="ch">${chipHtml(o.pts)}</span></div>`).join('')}</div>`
    : '';

  return `<div class="mi-wrap"><div class="mi ${expandable ? 'lk' : ''}" data-gm="${m.id}" data-pair="${m.id}" ${expandable ? `title="${t('seeAll')}"` : ''}>
      <div class="mi-main">
        ${(label || metaR) ? `<div class="mi-meta"><span>${label}</span><span>${metaR}</span></div>` : ''}
        ${teamRow('h')}${teamRow('a')}
        ${mineLine}
      </div>
      <div class="mi-side">${miSide(m)}</div>
    </div>${whoHtml}${othersHtml}</div>`;
}

// ---------- vue Matchs (chronologique) ----------
function renderMatchs() {
  const ms = [...S.data.matches].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const days = [];
  let cur = null;
  for (const m of ms) {
    const k = dayKeyOf(m.date);
    if (!cur || cur.k !== k) { cur = { k, date: m.date, items: [] }; days.push(cur); }
    cur.items.push(m);
  }
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const isPast = (day) => { const d = new Date(day.date); d.setHours(0, 0, 0, 0); return d < startToday; };
  const pastDays = days.filter(isPast);
  const visible = S.showPast ? days : days.filter((d) => !isPast(d));
  const todayK = dayKeyOf(Date.now());
  const tomorrowK = dayKeyOf(Date.now() + 86400000);

  const dayLabel = (d) =>
    d.k === todayK ? `${t('today')} · ${fmtLong(d.date)}`
      : d.k === tomorrowK ? `${t('tomorrow')} · ${fmtLong(d.date)}`
      : fmtLong(d.date);

  $('#daylist').innerHTML =
    (pastDays.length ? `<button class="pill-ghost" id="btn-past">${S.showPast ? t('hidePast') : t('showPast', pastDays.length)}</button>` : '') +
    visible.map((d) => `
      <div class="dayhead">${dayLabel(d)}<span class="n">· ${d.items.length}</span></div>
      <div class="day-grid">${d.items.map((m) => matchItem(m, true)).join('')}</div>`).join('');
}

// ---------- arbre ----------
function bmRow(m, side) {
  const name = side === 'h' ? m.home : m.away;
  const tm = team(name);
  const flag = tm ? flagImg(tm.code) : '<span class="fl ph">?</span>';
  const label = tm
    ? `<span class="tn" title="${esc(tNm(tm))}">${tm.tri}</span>`
    : `<span class="tn">${esc(phLabel(m, side))}</span>`;
  const pred = myPick(m.id);
  let cell;
  if (m.finished) cell = `<span class="sc">${side === 'h' ? m.hs : m.as}</span>`;
  else if (hasLiveScore(m)) cell = `<span class="sc live">${side === 'h' ? m.lhs : m.las}</span>`;
  else if (canEdit(m)) {
    const pend = S.dirty.get(m.id);
    const v = pend ? pend[side === 'h' ? 0 : 1] : pred ? pred[side === 'h' ? 0 : 1] : '';
    cell = `<input class="bi" data-m="${m.id}" data-s="${side}" type="number" min="0" max="30" inputmode="numeric" value="${v}">`;
  } else if (pred) cell = `<span class="sc mine">${pred[side === 'h' ? 0 : 1]}</span>`;
  else cell = '<span class="sc dim">·</span>';
  return `<div class="bm-row ${tm ? '' : 'ph'} ${winCls(m, side)}">${flag}${label}${cell}</div>`;
}

function bmCard(id, cls = '') {
  const m = M(id);
  if (!m) return '';
  const pred = myPick(id);
  const chip = m.finished && pred ? chipHtml(ptsOf(m, pred)) : '';
  const right = isLive(m)
    ? `<span class="gm-live">${esc(m.lmin || 'LIVE')}</span>`
    : esc((m.loc || '').replace(' Stadium', ''));
  return `<div class="bm ${m.finished ? 'done' : ''} ${cls}" data-m="${id}" data-pair="${id}">${chip}
    ${bmRow(m, 'h')}${bmRow(m, 'a')}
    <div class="bm-meta"><span>${fmtMeta(m.date)}</span><span>${right}</span></div>
  </div>`;
}

function bcol(ids, capTxt) {
  let duos = '';
  if (ids.length === 1) duos = `<div class="duo solo">${bmCard(ids[0])}</div>`;
  else for (let i = 0; i < ids.length; i += 2) duos += `<div class="duo">${bmCard(ids[i])}${bmCard(ids[i + 1])}</div>`;
  return `<div class="bcol"><div class="bcap">${capTxt}</div><div class="bbody">${duos}</div></div>`;
}

function champHtml() {
  const fin = M(104);
  const adv = fin ? actualAdvancer(fin) : null;
  let sub = null, name = null;
  if (adv) { sub = t('champWorld'); name = adv; }
  else {
    const p = myPick(104);
    if (p && fin && team(fin.home) && team(fin.away)) { sub = t('champYours'); name = p[0] > p[1] ? fin.home : fin.away; }
  }
  if (!name) return `<div class="champ"><div class="t">${t('champ')}</div><div class="q">${t('champTbd')}</div></div>`;
  const tm = team(name);
  return `<div class="champ"><div class="t">🏆 ${sub}</div>${tm ? flagImg(tm.code, 'fl big') : ''}<div class="n">${esc(tm ? tNm(tm) : name)}</div></div>`;
}

function centerBracket() {
  const sc = $('.bkt-scroll');
  if (sc && sc.clientWidth > 0 && sc.scrollWidth > sc.clientWidth) {
    sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2;
    S.bktCentered = true;
  }
}

function renderBracket() {
  const caps = I18N[LANG].caps;
  const order = ['r32', 'r16', 'qf', 'sf'];
  const left = `<div class="bkt-half bkL">${order.map((k) => bcol(SIDE_L[k], caps[k])).join('')}</div>`;
  const right = `<div class="bkt-half bkR">${[...order].reverse().map((k) => bcol(SIDE_R[k], caps[k])).join('')}</div>`;
  const center = `<div class="bcol"><div class="bcap">${t('finalCap')}</div><div class="bbody center">
      ${champHtml()}
      ${bmCard(104, 'stub-l stub-r')}
      <div><div class="third-cap">${t('thirdCap')}</div>${bmCard(103)}</div>
    </div></div>`;
  $('#bracket').innerHTML = left + center + right;
  if (!S.bktCentered) centerBracket();
}

// ---------- groupes ----------
function standingsHtml(ms) {
  const names = [];
  for (const m of ms) for (const n of [m.home, m.away]) if (!names.includes(n)) names.push(n);
  const st = new Map(names.map((n) => [n, { n, pj: 0, w: 0, d: 0, l: 0, pts: 0, bp: 0, bc: 0, last: null }]));
  for (const m of [...ms].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!m.finished) continue;
    const h = st.get(m.home), a = st.get(m.away);
    h.pj++; a.pj++; h.bp += m.hs; h.bc += m.as; a.bp += m.as; a.bc += m.hs;
    if (m.hs > m.as) { h.w++; a.l++; h.pts += 3; }
    else if (m.hs < m.as) { a.w++; h.l++; a.pts += 3; }
    else { h.d++; a.d++; h.pts++; a.pts++; }
    h.last = { mine: m.hs, opp: m.as };
    a.last = { mine: m.as, opp: m.hs };
  }
  const dispName = (n) => { const tm = team(n); return tm ? tNm(tm) : n; };
  const rows = [...st.values()].sort((x, y) =>
    y.pts - x.pts || (y.bp - y.bc) - (x.bp - x.bc) || y.bp - x.bp || dispName(x.n).localeCompare(dispName(y.n), LANG)
  );
  const H = t('stH');
  const fchip = (r) => {
    if (!r.last) return '';
    const cls = r.last.mine > r.last.opp ? 'w' : r.last.mine < r.last.opp ? 'l' : 'd';
    return `<span class="fchip ${cls}">${r.last.mine}-${r.last.opp}</span>`;
  };
  return `<table class="standings">
    <tr><th></th><th class="t">${H[1]}</th><th></th><th>${H[2]}</th><th>${H[3]}</th><th>${H[4]}</th><th>${H[5]}</th><th>${H[6]}</th><th>${H[7]}</th></tr>
    ${rows.map((r, i) => {
      const tm = team(r.n);
      const gd = r.bp - r.bc;
      return `<tr class="${i < 2 ? 'q' : ''}">
        <td class="rkk">${i + 1}</td>
        <td class="t"><span class="in">${tm ? flagImg(tm.code) : ''}<span class="nm">${esc(dispName(r.n))}</span></span></td>
        <td>${fchip(r)}</td>
        <td>${r.pj}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${gd > 0 ? '+' + gd : gd}</td><td class="pts">${r.pts}</td></tr>`;
    }).join('')}
  </table>`;
}

function renderGroups() {
  const letters = [...new Set(S.data.matches.filter((m) => m.grp).map((m) => m.grp))].sort();
  $('#groups').innerHTML = letters.map((g) => {
    const ms = S.data.matches.filter((m) => m.grp === g).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    return `<div class="gcard"><h3>${t('group', g)}</h3>${standingsHtml(ms)}<div class="gms">${ms.map((m) => matchItem(m, false)).join('')}</div></div>`;
  }).join('');
}

// ---------- prono champion ----------
const champDisplayDate = () => new Date(Date.parse(S.data.champion.deadline) - 60000); // affiche 23:59 plutôt que 00:00
function renderChampion() {
  const c = S.data && S.data.champion;
  if (!c) { $('#sec-champ').style.display = 'none'; return; }
  $('#sec-champ').style.display = '';
  const dd = champDisplayDate();
  $('#champ-sub').textContent = c.locked ? t('champLockedSub') : t('champSub');

  const mineTeam = c.mine ? team(c.mine) : null;
  const final = M(104);
  const actual = final ? actualAdvancer(final) : null;

  let html = '';
  if (!c.locked) {
    if (S.data.me) {
      const opts = Object.entries(S.data.teams)
        .map(([key, tm]) => ({ key, label: tNm(tm), code: tm.code }))
        .sort((a, b) => a.label.localeCompare(b.label, LANG));
      const btnContent = mineTeam
        ? `${flagImg(mineTeam.code)} <b>${esc(tNm(mineTeam))}</b>`
        : `<span class="champ-ph">${t('champPlaceholder')}</span>`;
      html += `<div class="champ-dd">
          <button class="champ-dd-btn" data-champ-dd>${btnContent}<span class="chev">▾</span></button>
          <div class="champ-dd-panel" hidden>
            <input class="champ-dd-search" placeholder="${t('champSearch')}" autocomplete="off">
            <div class="champ-dd-list">
              ${opts.map((o) => `<button class="champ-dd-opt ${o.key === c.mine ? 'sel' : ''}" data-champ-team="${esc(o.key)}" data-label="${esc(o.label)}">${flagImg(o.code)} <span>${esc(o.label)}</span></button>`).join('')}
            </div>
            <div class="champ-dd-empty" hidden>${t('champNone')}</div>
          </div>
        </div>`;
    } else {
      html += `<div class="champ-note">${t('champJoinFirst')}</div>`;
    }
    const picked = new Set(c.pickers || []);
    const whoRows = (S.data.players || []).map((name) => picked.has(name)
      ? `<div class="row done">✓ <b>${esc(name)}</b></div>`
      : `<div class="row wait">⏳ ${esc(name)}</div>`).join('');
    html += `<div class="champ-note">${t('champPoints', c.points || 10)}</div>
             <div class="champ-note">⏳ ${t('champDeadline', cap1(fmtDay(dd)), fmtTime(dd))}</div>
             <div class="champ-who">${whoRows}<div class="who-note">🔒 ${t('champWhoHidden')}</div></div>`;
  } else {
    const byName = new Map((c.picks || []).map((p) => [p.name, p.team]));
    const rows = S.data.players.map((name) => {
      const tk = byName.get(name);
      const tm = tk ? team(tk) : null;
      const hit = actual && tk === actual;
      return `<div class="champ-row ${hit ? 'hit' : ''}">
        ${tm ? flagImg(tm.code) : '<span class="fl ph">–</span>'}
        <span class="champ-team">${tm ? esc(tNm(tm)) : `<i>${t('champNoPick')}</i>`}</span>
        <span class="champ-player">${esc(name)}</span>
        ${hit ? `<span class="chip c3">${t('champRight')}</span>` : ''}
      </div>`;
    }).join('');
    html = rows || `<div class="champ-note">${t('champNoPick')}</div>`;
  }
  $('#champ-body').innerHTML = html;
}

async function saveChampion(teamKey) {
  try {
    const hadPick = !!S.data.champion.mine;
    const res = await api('PUT', `/api/pool/${encodeURIComponent(TOKEN)}/champion`, { team: teamKey });
    const j = await res.json();
    if (!res.ok) { toast(`⚠️ ${trReason(j.error)}`, true); return; }
    S.data.champion.mine = j.team;
    if (!hadPick) {
      S.data.champion.count += 1;
      const me = S.data.me;
      if (me && Array.isArray(S.data.champion.pickers) && !S.data.champion.pickers.includes(me.name)) {
        S.data.champion.pickers.push(me.name);
        S.data.champion.pickers.sort((a, b) => a.localeCompare(b, 'fr'));
      }
    }
    const tm = team(j.team);
    toast(t('champSaved', tm ? tNm(tm) : j.team));
    renderChampion();
    renderBanner();
  } catch {
    toast(t('offline'), true);
  }
}

const normTxt = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

document.addEventListener('input', (e) => {
  if (!e.target.classList || !e.target.classList.contains('champ-dd-search')) return;
  const panel = e.target.closest('.champ-dd-panel');
  const q = normTxt(e.target.value.trim());
  let shown = 0;
  panel.querySelectorAll('.champ-dd-opt').forEach((o) => {
    const hit = !q || normTxt(o.dataset.label).includes(q);
    o.hidden = !hit;
    if (hit) shown += 1;
  });
  panel.querySelector('.champ-dd-empty').hidden = shown > 0;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.champ-dd-panel:not([hidden])').forEach((p) => { p.hidden = true; });
});

// ---------- classement joueurs ----------
// ---------- badges rigolos ----------
const BADGES = {
  oeil:        { emoji: '🎯', fr: 'Œil de lynx',  en: 'Sharp eye',     dfr: 'a trouvé un score exact',          den: 'nailed an exact score' },
  nostradamus: { emoji: '🔮', fr: 'Nostradamus',  en: 'Nostradamus',   dfr: '3 scores exacts ou plus',          den: '3+ exact scores' },
  feu:         { emoji: '🔥', fr: 'En feu',       en: 'On fire',       dfr: '3 bons pronos d\'affilée',          den: '3 correct picks in a row' },
  bleu:        { emoji: '🇫🇷', fr: 'Cœur bleu',    en: 'True blue',     dfr: 'toujours derrière les Bleus',       den: 'always backs France' },
  beton:       { emoji: '🧱', fr: 'Bétonneur',    en: 'The wall',      dfr: 'fan des matchs fermés',             den: 'loves low-scoring games' },
  flambeur:    { emoji: '🎰', fr: 'Le Flambeur',  en: 'High roller',   dfr: 'parie sur les cartons',             den: 'bets on goal fests' },
  ane:         { emoji: '🪅', fr: 'Bonnet d\'âne', en: 'Wooden spoon',  dfr: 'dernier du classement',             den: 'last place' },
  fantome:     { emoji: '👻', fr: 'Fantôme',      en: 'No-show',       dfr: 'a zappé tous les matchs joués',     den: 'skipped every played match' },
};
const badgeLabel = (k) => (BADGES[k] ? (LANG === 'fr' ? BADGES[k].fr : BADGES[k].en) : k);
const badgeDesc = (k) => (BADGES[k] ? (LANG === 'fr' ? BADGES[k].dfr : BADGES[k].den) : '');

// ---------- joueur du jour ----------
function playerOfDay() {
  const fin = S.data.matches.filter((m) => m.finished);
  if (!fin.length) return null;
  const latest = fin.map((m) => m.date).sort((a, b) => b.localeCompare(a))[0];
  const dayK = dayKeyOf(latest);
  const dayMatches = fin.filter((m) => dayKeyOf(m.date) === dayK);
  const tally = new Map();
  for (const m of dayMatches) for (const o of (S.data.others[m.id] || [])) {
    if (o.pts == null) continue;
    tally.set(o.name, (tally.get(o.name) || 0) + o.pts);
  }
  let max = 0;
  for (const v of tally.values()) max = Math.max(max, v);
  if (max <= 0) return null;
  const winners = [...tally].filter(([, p]) => p === max).map(([n]) => n).sort((a, b) => a.localeCompare(b, LANG));
  return { date: dayMatches[0].date, winners, pts: max };
}

// ---------- confettis (score exact) ----------
const CONFKEY = 'pronos26:conf:' + TOKEN;
function fireConfetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let cv = document.getElementById('confetti-cv');
  if (!cv) { cv = document.createElement('canvas'); cv.id = 'confetti-cv'; cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:300'; document.body.appendChild(cv); }
  const ctx = cv.getContext('2d');
  const W = cv.width = window.innerWidth, H = cv.height = window.innerHeight;
  const colors = ['#2563eb', '#ffffff', '#dc2626', '#fbbf24', '#34d399'];
  const parts = Array.from({ length: 150 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * 140, y: H * 0.3,
    vx: (Math.random() - 0.5) * 15, vy: Math.random() * -15 - 4,
    g: 0.32 + Math.random() * 0.12, s: 5 + Math.random() * 7,
    rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.35,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  let t0 = null;
  (function frame(t) {
    if (t0 == null) t0 = t;
    const el = t - t0;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vx *= 0.99;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - el / 2600); ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.55);
      ctx.restore();
    }
    if (el < 2600) requestAnimationFrame(frame); else cv.remove();
  })(performance.now());
}
function celebrateExacts() {
  if (!S.data || !S.data.me) return;
  let done; try { done = new Set(JSON.parse(localStorage.getItem(CONFKEY) || '[]')); } catch { done = new Set(); }
  let fire = false;
  for (const m of S.data.matches) {
    const pick = S.data.mine[m.id];
    if (!m.finished || !pick || done.has(m.id)) continue;
    if (ptsOf(m, pick) !== 3) continue;
    done.add(m.id);
    if (Date.now() - Date.parse(m.date) < 8 * 3600000) fire = true; // résultat récent → on fête
  }
  try { localStorage.setItem(CONFKEY, JSON.stringify([...done])); } catch { /* ignore */ }
  if (fire) { fireConfetti(); toast(t('exactToast')); }
}

function renderBoard() {
  const lb = S.data.leaderboard;
  $('#board-sub').textContent = t('players', lb.length);
  if (!lb.length) {
    $('#board').innerHTML = `<div class="empty">${t('boardEmpty')}</div>`;
    return;
  }
  const mvp = playerOfDay();
  const mvpHtml = mvp
    ? `<div class="mvp"><span class="mvp-star">🌟</span><div class="mvp-txt"><b>${t('mvpDay')}</b> · ${esc(cap1(fmtDay(mvp.date)))}<br>${mvp.winners.map(esc).join(' & ')} <span class="mvp-pts">${t('mvpPts', mvp.pts)}</span></div></div>`
    : '';
  $('#board').innerHTML = mvpHtml + lb.map((r, i) => `
    <div class="board-row ${r.isMe ? 'me' : ''}">
      <span class="rk">${i === 0 && r.pts > 0 ? '👑' : i + 1}</span>
      <span class="nm"><span class="nm-line"><span class="nm-name">${esc(r.name)}</span>${(r.badges && r.badges.length) ? `<span class="badges">${r.badges.map((b) => {
        const meta = BADGES[b]; if (!meta) return '';
        const txt = badgeLabel(b) + ' — ' + badgeDesc(b);
        return `<span class="badge" tabindex="0" aria-label="${esc(txt)}"><span class="be">${meta.emoji}</span><span class="bt"><b>${esc(badgeLabel(b))}</b>${esc(badgeDesc(b))}</span></span>`;
      }).join('')}</span>` : ''}</span><small>${t('exactSub', r.exact, r.outcome)}${r.champ ? ` · 🏆 +${(S.data.champion && S.data.champion.points) || 10}` : ''}</small></span>
      <span class="pt">${r.pts}<small> pt${r.pts > 1 ? 's' : ''}</small></span>
    </div>`).join('');
}

function renderRules() {
  const open = S.data.matches.filter((m) => !m.locked && team(m.home) && team(m.away)).length;
  const mineCount = Object.keys(S.data.mine).length;
  const sync = S.data.lastSync ? fmtRelPast(S.data.lastSync) : '—';
  $('#rules').innerHTML = `
    <b>${t('rules')}</b><br>
    <span class="dot" style="background:#137333"></span>${t('rule3')}<br>
    <span class="dot" style="background:#e8710a"></span>${t('rule1')}<br>
    <span class="dot" style="background:#80868b"></span>${t('rule0')}<br>
    <span class="dot" style="background:#fbbf24"></span>${t('ruleChamp', (S.data.champion && S.data.champion.points) || 10)}<br>
    ${t('ruleKo')}<br><br>
    <b>${t('badgesTitle')}</b>
    <div class="badge-legend">${Object.keys(BADGES).map((k) => `<span class="bl"><span class="be">${BADGES[k].emoji}</span> ${esc(badgeLabel(k))} — <i>${esc(badgeDesc(k))}</i></span>`).join('')}</div>
    <br>
    ${S.data.me ? t('myCount', mineCount, open) + '<br>' : ''}
    <span style="opacity:.75">${t('syncInfo', sync)}</span>`;
}

// ---------- header ----------
const vsShort = (m) => `${team(m.home)?.tri || '?'}–${team(m.away)?.tri || '?'}`;
function liveLabel(m) {
  const a = team(m.home)?.tri || '?';
  const b = team(m.away)?.tri || '?';
  return m.lhs != null ? `${a} ${m.lhs}–${m.las} ${b}${m.lmin ? ' · ' + esc(m.lmin) : ''}` : `${a}–${b}`;
}
function stageSubTitle() {
  const g = S.data.matches.filter((m) => m.stage === 'group' && !m.finished);
  if (g.length) return t('mdGroup', Math.min(...g.map((m) => m.round || 1)));
  const next = S.data.matches.find((m) => !m.finished && m.stage !== 'group');
  if (next) return I18N[LANG].stageSubKo[next.stage];
  return t('over');
}
function renderHeader() {
  $('#h-pool').textContent = S.data.pool.name;
  $('#h-sub').textContent = stageSubTitle();
  document.title = t('docTitle', S.data.pool.name);

  const live = S.data.matches.filter(isLive);
  const next = S.data.matches.filter((m) => !m.locked).sort((a, b) => a.date.localeCompare(b.date))[0];
  $('#h-next').innerHTML = live.length
    ? `<span class="live">${t('liveNow', live.slice(0, 2).map(liveLabel).join(' · '))}</span>`
    : next ? t('nextMatch', vsShort(next), fmtRel(next.date)) : t('over');

  const u = $('#h-user');
  if (S.data.me) {
    const row = S.data.leaderboard.find((r) => r.isMe);
    u.innerHTML = `<span class="userchip">👤 ${esc(S.data.me.name)} · ${t('pts', row ? row.pts : 0)}
      <button id="btn-switch">${t('switch')}</button></span>`;
  } else {
    u.innerHTML = `<span class="userchip"><button id="btn-join2" style="font-size:13px">${t('join')}</button></span>`;
  }
}

// ---------- onglets ----------
function renderTabs() {
  $('#tabs').innerHTML = VIEWS.map((v) =>
    `<button class="tab ${S.view === v ? 'on' : ''}" data-view-btn="${v}">${t('tab_' + v)}</button>`).join('');
}
function switchView(v) {
  if (!VIEWS.includes(v)) return;
  S.view = v;
  localStorage.setItem('pronos26:view', v);
  document.body.dataset.view = v;
  renderTabs();
  if (v === 'apercu' || v === 'arbre') setTimeout(centerBracket, 30);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ---------- pronos express ----------
function qpMatches() {
  if (!S.data) return [];
  const limit = Date.now() + 24 * 3600000;
  return S.data.matches
    .filter((m) => !m.locked && team(m.home) && team(m.away) && !S.data.mine[m.id] && !S.dirty.has(m.id) && Date.parse(m.date) <= limit)
    .sort((a, b) => a.date.localeCompare(b.date));
}
function renderBanner() {
  const b = $('#qp-banner');
  if (!S.data.me) { b.classList.add('hidden'); return; }
  const n = qpMatches().length;
  const c = S.data.champion;
  const needChamp = c && !c.locked && !c.mine;
  if (n === 0 && !needChamp) { b.classList.add('hidden'); return; }
  b.classList.remove('hidden');
  if (n > 0) {
    $('#qp-banner-txt').textContent = t('qpBanner', n) + (needChamp ? '  ·  🏆' : '');
    $('#qp-go').textContent = t('qpGo');
    $('#qp-go').dataset.bannerAction = 'qp';
  } else {
    const dd = champDisplayDate();
    $('#qp-banner-txt').textContent = t('champBanner', `${fmtDay(dd)} ${fmtTime(dd)}`);
    $('#qp-go').textContent = t('champGo');
    $('#qp-go').dataset.bannerAction = 'champ';
  }
}
function qpRow(m) {
  const th = team(m.home), ta = team(m.away);
  return `<div class="qp-row" data-pair="${m.id}">
    <span class="qp-when">${fmtDay(m.date)}<br>${fmtTime(m.date)}</span>
    <span class="qp-t h"><span class="qn">${esc(tNm(th))}</span> ${flagImg(th.code)}</span>
    <span class="qp-in">
      <input class="bi" data-m="${m.id}" data-s="h" type="number" min="0" max="30" inputmode="numeric">
      <span style="color:var(--muted)">–</span>
      <input class="bi" data-m="${m.id}" data-s="a" type="number" min="0" max="30" inputmode="numeric">
    </span>
    <span class="qp-t a">${flagImg(ta.code)} <span class="qn">${esc(tNm(ta))}</span></span>
    <span class="qp-st" id="qp-st-${m.id}"></span>
  </div>`;
}
function openQP() {
  const ms = qpMatches();
  $('#qp-title').textContent = t('qpTitle');
  $('#qp-sub').textContent = ms.length ? t('qpSub') : t('qpEmpty');
  $('#qp-list').innerHTML = ms.map(qpRow).join('');
  $('#qp-close').textContent = t('qpClose');
  $('#qp').classList.remove('hidden');
  localStorage.setItem(QPKEY, String(Date.now()));
  const first = $('#qp-list input.bi');
  if (first) setTimeout(() => first.focus(), 60);
}
function closeQP() {
  flushSave(false); // sauvegarde immédiate de ce qui vient d'être tapé dans la modale
  $('#qp').classList.add('hidden');
  render();
}
const qpVisible = () => !$('#qp').classList.contains('hidden');

// ---------- bannière « Tous derrière les Bleus » ----------
function hfCountdown(d) {
  let s = Math.max(0, Math.floor((Date.parse(d) - Date.now()) / 1000));
  const j = Math.floor(s / 86400); s -= j * 86400;
  const pad = (x) => String(x).padStart(2, '0');
  return (j > 0 ? `J-${j} · ` : '') + `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function renderFranceHero() {
  const el = $('#hero-fr');
  if (!el || !S.data) return;
  if (localStorage.getItem('pronos26:hero') === 'off') { el.hidden = true; return; }

  const frMatches = S.data.matches.filter((m) => m.home === 'France' || m.away === 'France');
  const live = frMatches.find((m) => isLive(m));
  const next = frMatches.filter((m) => !m.finished && !m.locked).sort((a, b) => a.date.localeCompare(b.date))[0];
  const m = live || next;
  const fr = team('France');

  let card;
  if (m) {
    const oppRaw = m.home === 'France' ? m.away : m.home;
    const opp = team(oppRaw);
    const oppLabel = opp ? tNm(opp) : phLabel(m, m.home === 'France' ? 'a' : 'h');
    const oppFlag = opp ? flagImg(opp.code, 'hf-subflag') + ' ' : '';
    const stage = m.grp ? t('group', m.grp) : (I18N[LANG].stageShort[m.stage] || '');
    const picks = S.data.counts[m.id] || 0;
    const status = live
      ? `<div class="hf-live">${m.lhs ?? 0}–${m.las ?? 0}<span>🔴 ${esc(m.lmin || 'LIVE')}</span></div>`
      : `<div class="hf-count" data-hf-date="${m.date}">${hfCountdown(m.date)}</div>`;
    card = `
      <div class="hf-card">
        <div class="hf-card-top"><span>⚽ ${esc(stage)}</span><span class="hf-brand">PRONOS 2026</span></div>
        <div class="hf-main">
          ${fr ? flagImg(fr.code, 'hf-flag big') : '🇫🇷'}
          <div class="hf-who">
            <div class="hf-team">France</div>
            <div class="hf-sub">${live
              ? (LANG === 'fr' ? `contre ${oppFlag}${esc(oppLabel)} — en ce moment` : `vs ${oppFlag}${esc(oppLabel)} — live now`)
              : `vs ${oppFlag}${esc(oppLabel)} · ${esc(cap1(fmtDay(m.date)))} ${esc(fmtTime(m.date))}`}</div>
          </div>
          ${status}
        </div>
        <div class="hf-ticker"><div class="hf-ticker-in">${('ALLEZ LES BLEUS&nbsp;&nbsp;🇫🇷&nbsp;&nbsp;FRA-2026&nbsp;&nbsp;E5446327A3F&nbsp;&nbsp;★&nbsp;★&nbsp;&nbsp;').repeat(8)}</div></div>
        <div class="hf-stats">
          <div><label>${LANG === 'fr' ? 'PRONOS DÉPOSÉS' : 'PICKS IN'}</label><b>${picks}</b></div>
          <div><label>${LANG === 'fr' ? 'COUP D\'ENVOI' : 'KICKOFF'}</label><b>${esc(fmtTime(m.date))}</b></div>
          <div><label>${LANG === 'fr' ? 'CONFIANCE' : 'BELIEF'}</label><b>100%</b></div>
          <button class="hf-open" data-hf-go>${LANG === 'fr' ? 'FAIRE MON PRONO' : 'MAKE MY PICK'} ↗</button>
        </div>
      </div>`;
  } else {
    card = `<div class="hf-card"><div class="hf-main">
      ${fr ? flagImg(fr.code, 'hf-flag big') : '🇫🇷'}
      <div class="hf-who"><div class="hf-team">Allez les Bleus</div>
      <div class="hf-sub">${LANG === 'fr' ? 'Quoi qu\'il arrive.' : 'No matter what.'}</div></div>
    </div></div>`;
  }

  el.hidden = false;
  const echo = Array.from({ length: 7 }, () => '<span>TOUS DERRIÈRE LES BLEUS&nbsp;!</span>').join('');
  el.innerHTML = `
    <button class="hf-x" data-hf-close title="${LANG === 'fr' ? 'Masquer la bannière' : 'Hide banner'}">✕</button>
    <div class="hf-echo" aria-hidden="true">${echo}</div>
    <div class="hf-ball" aria-hidden="true">⚽</div>
    ${card}`;
}

setInterval(() => {
  const c = document.querySelector('[data-hf-date]');
  if (c) c.textContent = hfCountdown(c.dataset.hfDate);
}, 1000);

// ---------- rendu global ----------
function applyStatic() {
  document.documentElement.lang = LANG;
  $('#t-brand').textContent = t('brand');
  $('#t-matchs-h2').textContent = t('matchsH2');
  $('#t-matchs-sub').textContent = t('matchsSub');
  $('#t-bracket-h2').textContent = t('bracketH2');
  $('#t-bracket-sub').textContent = t('bracketSub');
  $('#t-board-h2').textContent = t('boardH2');
  $('#t-champ-h2').textContent = t('champH2');
  $('#t-groups-h2').textContent = t('groupsH2');
  $('#t-groups-sub').textContent = t('groupsSub');
  $('#t-join-p').textContent = t('joinP');
  $('#t-join-name').textContent = t('joinName');
  $('#j-name').placeholder = t('joinNamePh');
  $('#t-join-pin').textContent = t('joinPin');
  $('#t-join-go').textContent = t('joinGo');
  $('#j-view').textContent = t('joinView');
  $('#btn-lang').textContent = LANG === 'fr' ? 'EN' : 'FR';
  renderTabs();
  if (S.data) $('#join-title').textContent = t('joinTitle', S.data.pool.name);
}

function render() {
  renderHeader();
  renderFranceHero();
  renderMatchs();
  renderBracket();
  renderGroups();
  renderChampion();
  renderBoard();
  renderRules();
  renderBanner();
  $('#foot').textContent = t('foot');
  celebrateExacts(); // confettis si un score exact vient de tomber
}

// ---------- réseau ----------
async function api(method, url, body, opts = {}) {
  return fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(S.key ? { 'x-player-key': S.key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    keepalive: opts.keepalive || false, // survit au backgrounding / fermeture de l'onglet (mobile)
    signal: opts.signal,
  });
}

async function fetchData() {
  const res = await api('GET', `/api/pool/${encodeURIComponent(TOKEN)}`);
  if (res.status === 404) {
    document.body.innerHTML = `<div class="admin-wrap"><div class="admin-card" style="text-align:center">
      <h2>${t('invalidLink')}</h2><p style="color:var(--muted)">${t('invalidLinkP')}</p></div></div>`;
    throw new Error('pool 404');
  }
  const json = await res.json();
  if (S.key && !json.me) { localStorage.removeItem(LSKEY); S.key = ''; }
  S.data = json;
  MATCHES = new Map(json.matches.map((m) => [m.id, m]));
}

// ---------- sauvegarde (robuste, mobile-safe) ----------
// Miroir local des pronos non confirmés : survit à la fermeture/éviction de l'onglet.
function persistPending() {
  try {
    if (S.dirty.size) localStorage.setItem(PENDING_KEY, JSON.stringify([...S.dirty]));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* quota / mode privé : on continue */ }
}

let savePillTimer = null;
function setSaveStatus(state) {
  const el = $('#savepill');
  if (!el) return;
  clearTimeout(savePillTimer);
  if (state === 'pending' || state === 'saving') {
    el.className = 'savepill'; el.textContent = state === 'saving' ? t('savSaving') : t('savPending'); el.hidden = false;
  } else if (state === 'error') {
    el.className = 'savepill err'; el.textContent = t('savError'); el.hidden = false;
  } else if (state === 'saved') {
    el.className = 'savepill ok'; el.textContent = t('savSaved'); el.hidden = false;
    savePillTimer = setTimeout(() => { if (!S.dirty.size && !S.saving) el.hidden = true; }, 1600);
  } else {
    el.hidden = true;
  }
}

function scheduleSave() {
  clearTimeout(S.saveTimer);
  clearTimeout(S.retryTimer);
  S.saveTimer = setTimeout(() => save(), SAVE_DEBOUNCE);
}

// opts.keepalive : flush de dernière seconde (page qui passe en arrière-plan) — bypasse le single-flight,
// l'UPSERT serveur étant idempotent un éventuel doublon est sans effet.
async function save(opts = {}) {
  if (!S.key || !S.dirty.size) return;
  if (S.saving && !opts.keepalive) return; // un PUT est déjà en vol ; le finally relancera les survivants
  clearTimeout(S.saveTimer);
  if (!opts.keepalive) { S.saving = true; setSaveStatus('saving'); }

  const snap = [...S.dirty].map(([m, [h, a]]) => ({ m, h, a }));
  let ctrl = null, to = null;
  if (!opts.keepalive) { ctrl = new AbortController(); to = setTimeout(() => ctrl.abort(), 12000); }

  try {
    const res = await api('PUT', `/api/pool/${encodeURIComponent(TOKEN)}/predictions`,
      { picks: snap }, { keepalive: opts.keepalive, signal: ctrl ? ctrl.signal : undefined });
    if (res.status === 401) { S.saving = false; toast(t('sessionLost'), true); openJoin(); return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const rejected = new Set((j.rejected || []).map((r) => Number(r.m)));
    for (const p of snap) {
      if (!rejected.has(p.m)) {
        S.data.mine[p.m] = [p.h, p.a];
        const st = document.getElementById('qp-st-' + p.m);
        if (st) st.textContent = '✓';
      }
      // On ne RETIRE de dirty que si la valeur n'a pas changé depuis l'envoi : une frappe
      // arrivée pendant le PUT survit et sera renvoyée. Les rejets sont permanents (match commencé,
      // score invalide…) → on les retire aussi, sinon boucle de retry infinie.
      const cur = S.dirty.get(p.m);
      if (cur && cur[0] === p.h && cur[1] === p.a) S.dirty.delete(p.m);
    }
    persistPending();
    S.retry = 0;
    if (j.saved > 0) toast(t('saved', j.saved));
    if (j.rejected && j.rejected.length) toast(`⚠️ ${trReason(j.rejected[0].reason)}`, true);
    renderRules();
    renderBanner();
    // resynchronise les inputs des sections où l'on n'est PAS en train de taper
    const ae = document.activeElement;
    const inSec = (sel) => ae && ae.closest && ae.closest(sel);
    if (!inSec('#sec-matchs')) renderMatchs();
    if (!inSec('#sec-groups')) renderGroups();
  } catch {
    if (!opts.keepalive) {
      setSaveStatus('error');
      toast(t('offline'), true);
      clearTimeout(S.retryTimer);
      S.retryTimer = setTimeout(() => save(), Math.min(20000, 800 * 2 ** S.retry) + Math.floor(Math.random() * 400));
      S.retry += 1;
    }
  } finally {
    if (to) clearTimeout(to);
    if (!opts.keepalive) {
      S.saving = false;
      if (S.dirty.size) scheduleSave();      // survivants (frappés pendant l'envoi) → un seul nouveau passage
      else setSaveStatus('saved');
    }
  }
}

// flush immédiat (blur d'un champ, fermeture de modale, passage en arrière-plan)
function flushSave(keepalive) {
  if (!S.dirty.size || !S.key) return;
  clearTimeout(S.saveTimer);
  save({ keepalive });
}

document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.classList || !el.classList.contains('bi')) return;
  const box = el.closest('[data-pair]') || document;
  const mid = Number(el.dataset.m);
  const m = M(mid);
  const hEl = box.querySelector('input.bi[data-s="h"]');
  const aEl = box.querySelector('input.bi[data-s="a"]');
  if (!hEl || !aEl || !m) return;
  S.lastInput = Date.now();
  const h = hEl.value === '' ? null : Number(hEl.value);
  const a = aEl.value === '' ? null : Number(aEl.value);
  const valid = Number.isInteger(h) && Number.isInteger(a) && h >= 0 && a >= 0 && h <= 30 && a <= 30;
  const koDraw = valid && m.stage !== 'group' && h === a;
  [hEl, aEl].forEach((x) => x.classList.toggle('bad', koDraw));
  if (koDraw) { S.dirty.delete(mid); persistPending(); toast(t('noDraw'), true); return; }
  if (valid) { S.dirty.set(mid, [h, a]); persistPending(); setSaveStatus('pending'); scheduleSave(); }
  else { S.dirty.delete(mid); persistPending(); }
});

// flush quand on quitte un champ de score (clavier refermé, champ suivant)
document.addEventListener('blur', (e) => {
  if (e.target.classList && e.target.classList.contains('bi')) flushSave(false);
}, true);

// flush de dernière seconde quand l'onglet passe en arrière-plan / se ferme (mobile : appli changée,
// écran verrouillé…). keepalive:true pour que la requête parte malgré le gel de la page.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(true); });
window.addEventListener('pagehide', () => flushSave(true));
window.addEventListener('online', () => { if (S.dirty.size) save(); });

document.addEventListener('click', (e) => {
  // ferme les dropdowns champion ouverts si on clique ailleurs
  if (!e.target.closest('.champ-dd')) {
    document.querySelectorAll('.champ-dd-panel:not([hidden])').forEach((p) => { p.hidden = true; });
  }
  // tooltip de badge : tap pour afficher (mobile), ferme les autres
  const badge = e.target.closest('.board-row .badge');
  document.querySelectorAll('.board-row .badge.show').forEach((b) => { if (b !== badge) b.classList.remove('show'); });
  if (badge) { badge.classList.toggle('show'); return; }
  const ddBtn = e.target.closest('[data-champ-dd]');
  if (ddBtn) {
    const panel = ddBtn.parentElement.querySelector('.champ-dd-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      const s = panel.querySelector('.champ-dd-search');
      s.value = '';
      panel.querySelectorAll('.champ-dd-opt').forEach((o) => { o.hidden = false; });
      panel.querySelector('.champ-dd-empty').hidden = true;
      setTimeout(() => s.focus(), 30);
    }
    return;
  }
  const ddOpt = e.target.closest('[data-champ-team]');
  if (ddOpt) { saveChampion(ddOpt.dataset.champTeam); return; }
  const whoBtn = e.target.closest('[data-who]');
  if (whoBtn) {
    const panel = whoBtn.closest('.mi-wrap')?.querySelector('.who-panel');
    if (panel) panel.hidden = !panel.hidden;
    return;
  }
  const tabBtn = e.target.closest('[data-view-btn]');
  if (tabBtn) { switchView(tabBtn.dataset.viewBtn); return; }
  const mi = e.target.closest('.mi.lk');
  if (mi && !e.target.closest('input')) {
    const panel = document.querySelector(`.gm-others[data-o="${mi.dataset.gm}"]`);
    if (panel) panel.hidden = !panel.hidden;
    return;
  }
  if (e.target.closest('[data-hf-close]')) {
    localStorage.setItem('pronos26:hero', 'off');
    $('#hero-fr').hidden = true;
    return;
  }
  if (e.target.closest('[data-hf-go]')) { switchView('matchs'); return; }
  if (e.target.id === 'btn-past') { S.showPast = !S.showPast; renderMatchs(); return; }
  if (e.target.id === 'btn-switch') {
    if (confirm(t('confirmSwitch'))) {
      localStorage.removeItem(LSKEY);
      S.key = '';
      openJoin();
    }
  }
  if (e.target.id === 'btn-join2') openJoin();
  if (e.target.id === 'qp-go') {
    if (e.target.dataset.bannerAction === 'champ') {
      if (document.body.dataset.view !== 'apercu') switchView('classement');
      document.querySelector('#sec-champ')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      openQP();
    }
    return;
  }
  if (e.target.id === 'qp-close') closeQP();
});

// ---------- toast ----------
let toastTimer = null;
function toast(msg, warn = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('warn', warn);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- inscription ----------
function openJoin() {
  $('#join-title').textContent = S.data ? t('joinTitle', S.data.pool.name) : t('joinGo');
  $('#j-err').textContent = '';
  $('#join').classList.remove('hidden');
  setTimeout(() => $('#j-name').focus(), 50);
}

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#j-name').value.trim();
  const pin = $('#j-pin').value.trim();
  try {
    const res = await fetch(`/api/pool/${encodeURIComponent(TOKEN)}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, pin }),
    });
    const j = await res.json();
    if (!res.ok) {
      $('#j-err').textContent = j.error === 'pin' ? t('joinPinErr') : trReason(j.error) || t('joinSrvErr');
      return;
    }
    S.key = j.key;
    localStorage.setItem(LSKEY, j.key);
    $('#join').classList.add('hidden');
    toast(j.rejoined ? t('welcomeBack', j.name) : t('welcome', j.name));
    await fetchData();
    render();
    if (S.dirty.size) save(); // renvoie les pronos saisis avant de devoir se ré-identifier
    if (qpMatches().length) openQP();
  } catch {
    $('#j-err').textContent = t('joinSrvErr');
  }
});

$('#j-view').addEventListener('click', () => {
  S.viewOnly = true;
  $('#join').classList.add('hidden');
});

// ---------- toggles ----------
$('#btn-lang').addEventListener('click', () => {
  LANG = LANG === 'fr' ? 'en' : 'fr';
  localStorage.setItem(LSLANG, LANG);
  makeFormatters();
  applyStatic();
  if (S.data) render();
  if (qpVisible()) openQP();
});

$('#btn-theme').addEventListener('click', () => {
  THEME = THEME === 'dark' ? 'light' : 'dark';
  localStorage.setItem('pronos26:theme', THEME);
  applyTheme();
});

// ---------- boucle ----------
// Le poll/re-render ne doit jamais écraser une saisie en cours : on le suspend tant qu'il reste
// du dirty, qu'un PUT est en vol, qu'une frappe date de moins de 3 s, ou qu'un champ a le focus.
const editingNow = () =>
  S.dirty.size > 0 ||
  S.saving ||
  Date.now() - S.lastInput < 3000 ||
  qpVisible() ||
  (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('bi'));

setInterval(async () => {
  if (editingNow()) return;
  try { await fetchData(); render(); } catch { /* réessaie au prochain tick */ }
}, 60000);

setInterval(() => { if (S.data && !editingNow()) renderHeader(); }, 30000);

(async function init() {
  applyTheme();
  applyStatic();
  try {
    await fetchData();
  } catch { return; }
  resolveLang();
  applyStatic();
  // rejoue les pronos saisis mais jamais confirmés (onglet fermé/évincé avant l'envoi)
  if (S.key) {
    try {
      const pend = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
      if (Array.isArray(pend) && pend.length) S.dirty = new Map(pend.map(([m, v]) => [Number(m), v]));
    } catch { /* ignore */ }
  }
  render();
  if (S.dirty.size) scheduleSave();
  if (!S.key && !S.viewOnly) {
    openJoin();
  } else if (S.data.me && qpMatches().length && Date.now() - (+localStorage.getItem(QPKEY) || 0) > 12 * 3600000) {
    openQP();
  }
})();
