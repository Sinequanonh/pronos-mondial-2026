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
  rbktSel: null,      // match sélectionné dans le tableau radial
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
    rbktTip: 'Touchez une équipe pour pronostiquer son match',
    rbktThird: 'Petite finale',
    rbktBack: '← Tableau',
    champ: '🏆 Champion', champWorld: 'Champion du monde', champYours: 'Ton champion', champTbd: 'à toi de le prédire…',
    ph1: (g) => `1ᵉʳ gr. ${g}`, ph2: (g) => `2ᵉ gr. ${g}`, ph3: (l) => `3ᵉ ${l}`,
    phW: (n) => `Vainq. m${n}`, phL: (n) => `Perd. m${n}`,
    nextMatch: (vs, rel) => `Prochain match : <b>${vs}</b> ${rel}`,
    over: 'Compétition terminée 🏆',
    liveNow: (s) => s,
    today: "Aujourd'hui", tomorrow: 'Demain', yesterday: 'Hier',
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
    ruleKo: "En élimination directe, on compte comme en poules — score, vainqueur ou nul (les tirs au but ne comptent pas : un match aux tab reste un nul). Les pronos se verrouillent au coup d'envoi 🔒",
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
    settingsTitle: 'Réglages',
    setLang: 'Langue',
    setTheme: 'Thème',
    setThemeLight: 'Clair',
    setThemeDark: 'Sombre',
    captainSet: 'Capitaine (×2) de la journée',
    captainTip: 'Capitaine — points ×2',
    captainSaved: (lbl) => (lbl ? `⭐ Capitaine : ${lbl}` : '⭐ Capitaine enregistré'),
    captainCleared: 'Capitaine retiré',
    ruleCaptain: '<b>⭐ Capitaine</b> — 1 match ×2 par journée (à choisir avant le coup d\'envoi)',
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
      'Pseudo entre 2 et 20 caractères': 'Pseudo entre 2 et 20 caractères',
      'PIN : 3 à 6 chiffres': 'PIN : 3 à 6 chiffres',
      'prono champion verrouillé': 'prono champion verrouillé',
      'équipe inconnue': 'équipe inconnue',
      'journée commencée': 'journée déjà commencée',
      'match hors journée': 'match hors de cette journée',
      'journée invalide': 'journée invalide',
      'journée inconnue': 'journée inconnue',
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
    rbktTip: 'Tap a team to predict its match',
    rbktThird: 'Third place',
    rbktBack: '← Bracket',
    champ: '🏆 Champion', champWorld: 'World champions', champYours: 'Your pick', champTbd: 'make your pick…',
    ph1: (g) => `1st gr. ${g}`, ph2: (g) => `2nd gr. ${g}`, ph3: (l) => `3rd ${l}`,
    phW: (n) => `W m${n}`, phL: (n) => `L m${n}`,
    nextMatch: (vs, rel) => `Next match: <b>${vs}</b> ${rel}`,
    over: 'Tournament over 🏆',
    liveNow: (s) => s,
    today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday',
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
    ruleKo: 'In the knockout rounds, scoring works like the group stage — score, winner or draw (penalty shootouts don\'t count: a match decided on penalties stays a draw). Picks lock at kickoff 🔒',
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
    settingsTitle: 'Settings',
    setLang: 'Language',
    setTheme: 'Theme',
    setThemeLight: 'Light',
    setThemeDark: 'Dark',
    captainSet: 'Captain (×2) of the matchday',
    captainTip: 'Captain — points ×2',
    captainSaved: (lbl) => (lbl ? `⭐ Captain: ${lbl}` : '⭐ Captain saved'),
    captainCleared: 'Captain cleared',
    ruleCaptain: '<b>⭐ Captain</b> — one match ×2 per matchday (pick before kickoff)',
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
      'Pseudo entre 2 et 20 caractères': 'Nickname must be 2–20 characters',
      'PIN : 3 à 6 chiffres': 'PIN: 3–6 digits',
      'prono champion verrouillé': 'champion pick is locked',
      'équipe inconnue': 'unknown team',
      'journée commencée': 'matchday already started',
      'match hors journée': 'match not in this matchday',
      'journée invalide': 'invalid matchday',
      'journée inconnue': 'unknown matchday',
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
// point rouge pulsant : « ça joue en ce moment » (remplace l'emoji 🔴)
const LIVE_DOT = '<span class="live-dot" aria-hidden="true"></span>';

const flagImg = (code, cls = 'fl') =>
  `<img class="${cls}" src="https://flagcdn.com/${cls.includes('big') ? 'h80' : 'h40'}/${code}.png" alt="" loading="lazy">`;

// ---------- avatars (photo de profil devant le nom) ----------
// teinte stable dérivée du nom, pour le monogramme de secours quand pas de photo
const monoHue = (name) => { let h = 0; const s = String(name || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
function avatarHtml(name, cls = '') {
  const url = (S.data && S.data.avatars && S.data.avatars[name]) || null;
  if (url) return `<img class="avatar ${cls}" src="${esc(url)}" alt="" loading="lazy">`;
  const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<span class="avatar mono ${cls}" style="--mh:${monoHue(name)}" aria-hidden="true">${esc(initial)}</span>`;
}

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
  if (ph === m.hs && pa === m.as) return 3;                       // score exact
  return Math.sign(ph - pa) === Math.sign(m.hs - m.as) ? 1 : 0;   // bon résultat (nul/vainqueur), TAB ignorés
}
const chipHtml = (pts) =>
  pts == null ? '' : `<span class="chip c${pts}">${pts > 0 ? '+' + pts : '0'}</span>`;
// pastille de points, doublée si capitaine (couleur basée sur les points bruts)
const ptsChip = (raw, cap) => {
  if (raw == null) return '';
  const v = cap ? raw * 2 : raw;
  return `<span class="chip c${raw}">${v > 0 ? '+' + v : '0'}${cap ? ' ⭐' : ''}</span>`;
};

// ---------- capitaine (1 match ×2 par journée/round) ----------
const roundStarted = (round) => S.roundMin && S.roundMin[round] != null && S.roundMin[round] <= Date.now();
const captainOn = () => !!(S.data && S.data.captainEnabled); // feature flag serveur (cf. lib/flags.js)
const myCap = (m) => !!(captainOn() && S.data && S.data.captains && S.data.captains[m.round] === m.id);
const capSettable = (m) => !!(captainOn() && S.data && S.data.me && !roundStarted(m.round));

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
  if (!m.finished || m.hs === m.as) return ''; // nul (TAB inclus) : pas de surlignage
  const winner = m.hs > m.as ? m.home : m.away;
  return winner === (side === 'h' ? m.home : m.away) ? 'win' : 'lose';
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
  if (isLive(m)) return `<span class="live">${LIVE_DOT}${t('liveWord')}</span><span class="live">${esc(m.lmin || '')}</span>`;
  if (m.finished) {
    const my = myPick(m.id);
    return `<span>${t('finished')}</span>${my ? ptsChip(ptsOf(m, my), myCap(m)) : ''}`;
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
  const metaR = !m.locked ? '' : (expandable ? '▾' : '');
  // contrôle capitaine : étoile à cocher si la journée n'a pas commencé, sinon marqueur ⭐×2 sur mon capitaine
  const capCtl = capSettable(m)
    ? `<button class="cap-star ${myCap(m) ? 'on' : ''}" data-cap-round="${m.round}" data-cap-match="${m.id}" title="${t('captainSet')}">${myCap(m) ? '⭐' : '☆'}</button>`
    : myCap(m) ? `<span class="cap-badge" title="${t('captainTip')}">⭐×2</span>` : '';
  const whoHtml = !m.locked && S.data.players.length
    ? `<div class="who-panel">
        ${pickersList.map((n) => `<div class="row done">✓ ${avatarHtml(n)}<b>${esc(n)}</b></div>`).join('')}
        ${S.data.players.filter((p) => !pickersList.includes(p)).map((n) => `<div class="row wait">⏳ ${avatarHtml(n)}${esc(n)}</div>`).join('')}
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
    ? `<div class="mi-mine">${t('mine')} : ${my[0]}–${my[1]}${m.finished ? ' ' + ptsChip(ptsOf(m, my), myCap(m)) : ''}</div>`
    : '';
  const othersHtml = expandable
    ? `<div class="gm-others" data-o="${m.id}" hidden>${others.map((o) =>
        `<div class="row ${o.cap ? 'cap' : ''}"><span class="nm">${avatarHtml(o.name)}${o.cap ? '⭐ ' : ''}${esc(o.name)}</span><span class="sc">${o.h}<i>–</i>${o.a}</span><span class="ch">${ptsChip(o.pts, o.cap)}</span></div>`).join('')}</div>`
    : '';

  return `<div class="mi-wrap ${myCap(m) ? 'is-cap' : ''}"><div class="mi ${expandable ? 'lk' : ''}" data-gm="${m.id}" data-pair="${m.id}" ${expandable ? `title="${t('seeAll')}"` : ''}>
      <div class="mi-main">
        ${(label || metaR || capCtl) ? `<div class="mi-meta"><span>${label}</span><span class="mi-meta-r">${capCtl}${metaR}</span></div>` : ''}
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
  // par défaut on garde aussi la veille visible ; le bouton ne masque que les jours d'avant
  const startYesterday = new Date(startToday); startYesterday.setDate(startYesterday.getDate() - 1);
  const isPast = (day) => { const d = new Date(day.date); d.setHours(0, 0, 0, 0); return d < startYesterday; };
  const pastDays = days.filter(isPast);
  const visible = S.showPast ? days : days.filter((d) => !isPast(d));
  const todayK = dayKeyOf(Date.now());
  const tomorrowK = dayKeyOf(Date.now() + 86400000);
  const yesterdayK = dayKeyOf(Date.now() - 86400000);

  const dayLabel = (d) =>
    d.k === todayK ? `${t('today')} · ${fmtLong(d.date)}`
      : d.k === tomorrowK ? `${t('tomorrow')} · ${fmtLong(d.date)}`
      : d.k === yesterdayK ? `${t('yesterday')} · ${fmtLong(d.date)}`
      : fmtLong(d.date);

  $('#daylist').innerHTML =
    (pastDays.length ? `<button class="pill-ghost" id="btn-past">${S.showPast ? t('hidePast') : t('showPast', pastDays.length)}</button>` : '') +
    visible.map((d) => `
      <div class="dayhead">${dayLabel(d)}<span class="n">· ${d.items.length}</span></div>
      <div class="day-grid">${d.items.map((m) => matchItem(m, true)).join('')}</div>`).join('');
}

// ---------- tableau radial (roue, inspiré de glaze/saj) ----------
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

// géométrie de la roue (repère SVG 0..1000, angle horaire depuis le haut)
const RB = { cx: 500, cy: 500, R0: 410, R1: 322, R2: 238, R3: 156, R4: 80 };
const rbAngle = (i, n) => (i + 0.5) * 360 / n;
function rbPt(r, aDeg) {
  const a = aDeg * Math.PI / 180;
  return [RB.cx + r * Math.sin(a), RB.cy - r * Math.cos(a)];
}
// coude radial : segment radial enfant→rayon parent, puis arc jusqu'à l'angle du parent
function rbElbow(cA, cR, pA, pR) {
  const [x1, y1] = rbPt(cR, cA);
  const [x2, y2] = rbPt(pR, cA);
  const [x3, y3] = rbPt(pR, pA);
  const sweep = pA >= cA ? 1 : 0;
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} A${pR} ${pR} 0 0 ${sweep} ${x3.toFixed(1)} ${y3.toFixed(1)}`;
}
// vainqueur d'un match (réel sinon mon prono), seulement si c'est une équipe connue
function predAdv(id) {
  const m = M(id);
  if (!m) return null;
  const real = actualAdvancer(m);
  if (real) return team(real) ? real : null;
  const p = myPick(id);
  if (!p || p[0] === p[1]) return null;
  const win = p[0] > p[1] ? m.home : m.away;
  return team(win) ? win : null;
}
// libellé court d'un emplacement encore inconnu (1A, 2B, meilleur 3ᵉ…)
function rbCode(raw) {
  let x;
  if ((x = String(raw).match(/^([12])([A-L])$/))) return x[1] + x[2];
  if (String(raw)[0] === '3') return '3ᵉ';
  return String(raw).slice(0, 3);
}

function renderBracket() {
  const wrap = $('#bracket');
  if (!wrap) { renderRbktDetail(); return; }
  // SIDE_R sur le demi-cercle droit, SIDE_L sur le gauche → les deux demi-tableaux se rejoignent au centre
  const r32 = [...SIDE_R.r32, ...SIDE_L.r32]; // 16 matchs
  const r16 = [...SIDE_R.r16, ...SIDE_L.r16]; // 8
  const qf = [...SIDE_R.qf, ...SIDE_L.qf];    // 4
  const sf = [...SIDE_R.sf, ...SIDE_L.sf];    // 2
  const sel = S.rbktSel;

  const defs = [], links = [], nodes = [];
  let nid = 0;
  const flagNode = (x, y, r, code) => {
    const cid = 'rbc' + (nid++);
    defs.push(`<clipPath id="${cid}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/></clipPath>`);
    return `<image href="https://flagcdn.com/h80/${code}.png" x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${(2 * r).toFixed(1)}" height="${(2 * r).toFixed(1)}" clip-path="url(#${cid})" preserveAspectRatio="xMidYMid slice"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" class="rn-ring"/>`;
  };

  // chaque anneau : nœuds (équipe/jeton) + le match dans lequel chacun joue ; srcOf = match d'où vient l'équipe du cran
  const rings = [
    { R: RB.R0, n: 32, nr: 22, leaf: true, teamOf: (i) => { const m = M(r32[i >> 1]); return m ? (i % 2 ? m.away : m.home) : null; }, matchOf: (i) => r32[i >> 1], srcOf: () => null },
    { R: RB.R1, n: 16, nr: 17.5, leaf: false, teamOf: (i) => predAdv(r32[i]), matchOf: (i) => r16[i >> 1], srcOf: (i) => r32[i] },
    { R: RB.R2, n: 8, nr: 16.5, leaf: false, teamOf: (i) => predAdv(r16[i]), matchOf: (i) => qf[i >> 1], srcOf: (i) => r16[i] },
    { R: RB.R3, n: 4, nr: 15.5, leaf: false, teamOf: (i) => predAdv(qf[i]), matchOf: (i) => sf[i >> 1], srcOf: (i) => qf[i] },
    { R: RB.R4, n: 2, nr: 15, leaf: false, teamOf: (i) => predAdv(sf[i]), matchOf: () => 104, srcOf: (i) => sf[i] },
  ];
  // vainqueur RÉEL du match joué à ce cran (sert au grisage des éliminés et au chemin lumineux)
  const realAdv = (mid) => { const m = M(mid); const a = m ? actualAdvancer(m) : null; return a && team(a) ? a : null; };

  // liens (dessinés sous les nœuds) : le trajet du vainqueur réel s'illumine
  for (let k = 0; k < rings.length; k++) {
    const c = rings[k], par = rings[k + 1];
    for (let i = 0; i < c.n; i++) {
      const cA = rbAngle(i, c.n);
      const name = c.teamOf(i);
      const advCls = name && realAdv(c.matchOf(i)) === name ? ' adv' : '';
      const selCls = c.matchOf(i) === sel ? ' sel' : '';
      if (par) links.push(`<path class="rn-link${advCls}${selCls}" d="${rbElbow(cA, c.R, rbAngle(i >> 1, par.n), par.R)}"/>`);
      else { const [x1, y1] = rbPt(c.R, cA); links.push(`<path class="rn-link${advCls}${selCls}" d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${RB.cx} ${RB.cy}"/>`); }
    }
  }

  // nœuds
  for (let k = 0; k < rings.length; k++) {
    const rg = rings[k];
    for (let i = 0; i < rg.n; i++) {
      const a = rbAngle(i, rg.n);
      const [x, y] = rbPt(rg.R, a);
      const name = rg.teamOf(i);
      const tm = name ? team(name) : null;
      const selCls = rg.matchOf(i) === sel ? ' sel' : '';
      // éliminé pour de vrai à ce cran → grisé ; place obtenue via mon prono (pas un résultat) → cerclé pointillé
      const advHere = tm ? realAdv(rg.matchOf(i)) : null;
      const outCls = tm && advHere && advHere !== name ? ' out' : '';
      const guessCls = tm && !rg.leaf && !realAdv(rg.srcOf(i)) ? ' guess' : '';
      let inner, lbl = '';
      if (tm) {
        inner = flagNode(x, y, rg.nr, tm.code);
        if (rg.leaf) { const [lx, ly] = rbPt(rg.R + 30, a); lbl = `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" dy="0.34em" class="rn-lbl">${esc(tm.tri)}</text>`; }
      } else if (rg.leaf) {
        const m = M(r32[i >> 1]);
        inner = `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rg.nr}" class="rn-ph"/><text x="${x.toFixed(1)}" y="${y.toFixed(1)}" dy="0.34em" class="rn-pht">${esc(m ? rbCode(i % 2 ? m.away : m.home) : '?')}</text>`;
      } else inner = `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" class="rn-dot"/>`;
      nodes.push(`<g class="rn${selCls}${outCls}${guessCls}" data-rbkt-match="${rg.matchOf(i)}">${inner}${lbl}</g>`);
    }
  }

  // centre : trophée ou drapeau du champion (pointillé si issu de mon prono)
  const champName = predAdv(104);
  const ctm = champName ? team(champName) : null;
  const champGuess = ctm && !realAdv(104) ? ' guess' : '';
  const centerInner = ctm
    ? flagNode(RB.cx, RB.cy, 40, ctm.code)
    : '<text x="500" y="502" dy="0.34em" class="rn-trophy">🏆</text>';
  nodes.push(`<g class="rn rn-cwrap${sel === 104 ? ' sel' : ''}${champGuess}" data-rbkt-match="104"><circle cx="500" cy="500" r="46" class="rn-center"/>${centerInner}</g>`);

  wrap.innerHTML = `<svg class="rbkt" viewBox="0 0 1000 1000" role="img" aria-label="${esc(t('bracketH2'))}">
    <defs>${defs.join('')}</defs>
    <g class="rn-links">${links.join('')}</g>
    ${nodes.join('')}
  </svg>`;
  renderRbktDetail();
}

function renderRbktDetail() {
  const el = $('#rbkt-detail');
  if (!el) return;
  const id = S.rbktSel;
  if (id != null && M(id)) {
    el.classList.add('open');
    el.innerHTML = `<button class="rbkt-back" data-rbkt-match="">${t('rbktBack')}</button>${matchItem(M(id), true)}`;
  } else {
    el.classList.remove('open');
    el.innerHTML = `<div class="rbkt-default">${champHtml()}<p class="rbkt-tip">${t('rbktTip')}</p><button class="pill-ghost" data-rbkt-match="103">${t('rbktThird')}</button></div>`;
  }
}

function rbktSelect(id) {
  S.rbktSel = (id == null || !M(id)) ? null : id;
  rbTTHide();
  renderBracket();
  if (S.rbktSel != null) $('#rbkt-detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- tooltip de la roue (survol souris uniquement) ----------
let rbTT = null;
function rbTTHtml(m) {
  const th = team(m.home), ta = team(m.away);
  const stage = m.grp ? t('group', m.grp) : (t('stageShort')[m.stage] || '');
  let sub;
  if (m.finished) sub = `<b>${m.hs} – ${m.as}</b> · ${t('finished')}`;
  else if (hasLiveScore(m)) sub = `<b>${m.lhs} – ${m.las}</b> · ${esc(m.lmin || 'LIVE')}`;
  else sub = esc(fmtMeta(m.date));
  const my = myPick(m.id);
  const mine = my ? `<div class="rn-tt-mine">${t('mine')} : ${my[0]}–${my[1]}${m.finished ? ' ' + chipHtml(ptsOf(m, my)) : ''}</div>` : '';
  return `<div class="rn-tt-stage">${esc(stage)}</div>
    <div class="rn-tt-teams">${esc(th ? tNm(th) : phLabel(m, 'h'))} – ${esc(ta ? tNm(ta) : phLabel(m, 'a'))}</div>
    <div class="rn-tt-sub">${sub}</div>${mine}`;
}
function rbTTMove(e) {
  if (!rbTT) return;
  const x = Math.min(e.clientX + 14, window.innerWidth - rbTT.offsetWidth - 8);
  const y = Math.min(e.clientY + 14, window.innerHeight - rbTT.offsetHeight - 8);
  rbTT.style.left = x + 'px';
  rbTT.style.top = y + 'px';
}
function rbTTHide() { if (rbTT) rbTT.hidden = true; }
document.addEventListener('mouseover', (e) => {
  if (!matchMedia('(hover: hover)').matches) return;
  const g = e.target.closest && e.target.closest('#bracket [data-rbkt-match]');
  const m = g && g.dataset.rbktMatch !== '' ? M(Number(g.dataset.rbktMatch)) : null;
  if (!m) { rbTTHide(); return; }
  if (!rbTT) { rbTT = document.createElement('div'); rbTT.className = 'rn-tt'; document.body.appendChild(rbTT); }
  rbTT.innerHTML = rbTTHtml(m);
  rbTT.hidden = false;
  rbTTMove(e);
});
document.addEventListener('mousemove', (e) => { if (rbTT && !rbTT.hidden) rbTTMove(e); });
document.addEventListener('mouseout', (e) => {
  if (e.target.closest && e.target.closest('#bracket [data-rbkt-match]')) rbTTHide();
});
document.addEventListener('scroll', rbTTHide, true);

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
      ? `<div class="row done">✓ ${avatarHtml(name)}<b>${esc(name)}</b></div>`
      : `<div class="row wait">⏳ ${avatarHtml(name)}${esc(name)}</div>`).join('');
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
        <span class="champ-player">${avatarHtml(name)}${esc(name)}</span>
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

async function setCaptain(round, matchId) {
  try {
    const res = await api('PUT', `/api/pool/${encodeURIComponent(TOKEN)}/captain`, { round, matchId });
    const j = await res.json();
    if (!res.ok) { toast(`⚠️ ${trReason(j.error)}`, true); return; }
    if (matchId == null) delete S.data.captains[round];
    else S.data.captains[round] = matchId;
    if (matchId) {
      const m = M(matchId);
      const lbl = m && team(m.home) && team(m.away) ? `${team(m.home).tri}–${team(m.away).tri}` : '';
      toast(t('captainSaved', lbl));
    } else {
      toast(t('captainCleared'));
    }
    render();
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
  // précision / exploits
  nostradamus:     { emoji: '🔮', fr: 'Nostradamus',       en: 'Nostradamus',    dfr: '3 scores exacts ou plus',           den: '3+ exact scores' },
  journeeParfaite: { emoji: '💯', fr: 'Journée parfaite',  en: 'Perfect day',    dfr: 'tous les matchs d\'un jour pile poil', den: 'every match of a day nailed' },
  francTireur:     { emoji: '🎯', fr: 'Le Franc-tireur',   en: 'Lone sniper',    dfr: 'score exact que personne d\'autre n\'a osé', den: 'exact score nobody else dared' },
  feu:             { emoji: '🔥', fr: 'En feu',            en: 'On fire',        dfr: '3 bons pronos d\'affilée',          den: '3 correct picks in a row' },
  presque:         { emoji: '😤', fr: 'À un but près',     en: 'So close',       dfr: 'le roi du « j\'y étais presque »',  den: 'king of the near-miss' },
  // social & champion
  contre:          { emoji: '🧭', fr: 'À contre-courant',  en: 'Lone dissenter', dfr: 'seul à pronostiquer l\'inverse de tous', den: 'sole pick against everyone' },
  rebelleTitre:    { emoji: '🎸', fr: 'Le Rebelle du titre', en: 'Title rebel',  dfr: 'seul à croire en son champion',     den: 'sole believer in his champ' },
  // style de prono
  beton:           { emoji: '🧱', fr: 'Bétonneur',         en: 'The wall',       dfr: 'n\'annonce que des matchs fermés',  den: 'only predicts tight games' },
  flambeur:        { emoji: '🎰', fr: 'Le Flambeur',       en: 'High roller',    dfr: 'n\'annonce que des cartons',        den: 'only predicts goal fests' },
  bleu:            { emoji: '🇫🇷', fr: 'Cœur bleu',         en: 'True blue',      dfr: 'toujours derrière les Bleus',       den: 'always backs France' },
  // chambrage
  maudit:          { emoji: '💀', fr: 'Le Maudit',         en: 'The cursed',     dfr: 'les équipes qu\'il sacre perdent',  den: 'teams he backs keep losing' },
  fantome:         { emoji: '👻', fr: 'Fantôme',           en: 'No-show',        dfr: 'a zappé tous les matchs joués',     den: 'skipped every played match' },
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

// badges d'un joueur : on n'en montre que 4 (les plus prestigieux d'abord), le reste sous « +N »
const BADGE_CAP = 4;
function badgesHtml(list) {
  const known = (list || []).filter((b) => BADGES[b]);
  if (!known.length) return '';
  const chip = (b) => {
    const txt = badgeLabel(b) + ' — ' + badgeDesc(b);
    return `<span class="badge" tabindex="0" aria-label="${esc(txt)}"><span class="be">${BADGES[b].emoji}</span><span class="bt"><b>${esc(badgeLabel(b))}</b>${esc(badgeDesc(b))}</span></span>`;
  };
  let html = known.slice(0, BADGE_CAP).map(chip).join('');
  const extra = known.slice(BADGE_CAP);
  if (extra.length) {
    const more = extra.map((b) => `${BADGES[b].emoji} ${badgeLabel(b)}`).join('\n');
    html += `<span class="badge badge-more" tabindex="0" aria-label="${esc(extra.map(badgeLabel).join(', '))}"><span class="be">+${extra.length}</span><span class="bt">${esc(more)}</span></span>`;
  }
  return `<span class="badges">${html}</span>`;
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
  // ex aequo (mêmes points) : même rang, même médaille, côte à côte ; le rang suivant saute (1, 1, 3…)
  const groups = [];
  for (const r of lb) {
    const g = groups[groups.length - 1];
    if (g && g.pts === r.pts) g.rows.push(r);
    else groups.push({ pts: r.pts, rows: [r] });
  }
  const medal = (rk, pts) => (pts > 0 && rk <= 3 ? ['👑', '🥈', '🥉'][rk - 1] : rk);
  const playerCell = (r) => `
      <div class="tie-p ${r.isMe ? 'me' : ''}">
        ${avatarHtml(r.name)}
        <span class="nm"><span class="nm-line"><span class="nm-name">${esc(r.name)}</span>${badgesHtml(r.badges)}</span><small>${t('exactSub', r.exact, r.outcome)}${r.champ ? ` · 🏆 +${(S.data.champion && S.data.champion.points) || 10}` : ''}</small></span>
      </div>`;
  let rank = 1;
  $('#board').innerHTML = mvpHtml + groups.map((g) => {
    const rk = rank;
    rank += g.rows.length;
    const rkCls = g.pts > 0 && rk <= 3 ? 'rk' + rk : '';
    if (g.rows.length === 1) {
      const r = g.rows[0];
      return `
    <div class="board-row ${r.isMe ? 'me' : ''}">
      <span class="rk ${rkCls}">${medal(rk, g.pts)}</span>
      ${avatarHtml(r.name)}
      <span class="nm"><span class="nm-line"><span class="nm-name">${esc(r.name)}</span>${badgesHtml(r.badges)}</span><small>${t('exactSub', r.exact, r.outcome)}${r.champ ? ` · 🏆 +${(S.data.champion && S.data.champion.points) || 10}` : ''}</small></span>
      <span class="pt">${g.pts}<small> pt${g.pts > 1 ? 's' : ''}</small></span>
    </div>`;
    }
    return `
    <div class="board-row tie">
      <span class="rk ${rkCls}">${medal(rk, g.pts)}</span>
      <div class="tie-players">${g.rows.map(playerCell).join('<div class="tie-sep"></div>')}</div>
      <span class="pt">${g.pts}<small> pt${g.pts > 1 ? 's' : ''}</small></span>
    </div>`;
  }).join('');
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
    ${captainOn() ? `<span class="dot" style="background:#fbbf24"></span>${t('ruleCaptain')}<br>` : ''}
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
    ? `<span class="live">${LIVE_DOT}${t('liveNow', live.slice(0, 2).map(liveLabel).join(' · '))}</span>`
    : next ? t('nextMatch', vsShort(next), fmtRel(next.date)) : t('over');

  const u = $('#h-user');
  if (S.data.me) {
    const row = S.data.leaderboard.find((r) => r.isMe);
    u.innerHTML = `<span class="userchip">${avatarHtml(S.data.me.name)} ${esc(S.data.me.name)} · ${t('pts', row ? row.pts : 0)}
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
      ? `<div class="hf-live">${m.lhs ?? 0}–${m.las ?? 0}<span>${LIVE_DOT}${esc(m.lmin || 'LIVE')}</span></div>`
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
  $('#btn-settings').title = t('settingsTitle');
  renderTabs();
  if (S.data) $('#join-title').textContent = t('joinTitle', S.data.pool.name);
}

function render() {
  // début de chaque journée (round) = coup d'envoi du 1er match → sert au verrou capitaine
  S.roundMin = {};
  for (const m of S.data.matches) {
    const d = Date.parse(m.date);
    if (S.roundMin[m.round] == null || d < S.roundMin[m.round]) S.roundMin[m.round] = d;
  }
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
  // tableau radial : sélectionne le match d'un nœud (ou revient à la roue si data vide)
  const rbn = e.target.closest('[data-rbkt-match]');
  if (rbn && !e.target.closest('input')) {
    const v = rbn.dataset.rbktMatch;
    rbktSelect(v === '' ? null : Number(v));
    return;
  }
  // tooltip de badge : tap pour afficher (mobile), ferme les autres
  const badge = e.target.closest('.board-row .badge');
  document.querySelectorAll('.board-row .badge.show').forEach((b) => { if (b !== badge) b.classList.remove('show'); });
  if (badge) { badge.classList.toggle('show'); return; }
  // capitaine : (dé)sélectionne le match doublé de la journée (no-op si la mécanique est en pause)
  const capBtn = captainOn() ? e.target.closest('[data-cap-round]') : null;
  if (capBtn) {
    const round = Number(capBtn.dataset.capRound);
    const matchId = Number(capBtn.dataset.capMatch);
    setCaptain(round, S.data.captains[round] === matchId ? null : matchId);
    return;
  }
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

// ---------- réglages (langue, thème, badges) ----------
function setLang(lang) {
  if (lang === LANG) return;
  LANG = lang;
  localStorage.setItem(LSLANG, LANG);
  makeFormatters();
  applyStatic();
  if (S.data) render();
  if (qpVisible()) openQP();
  if (settingsOpen()) renderSettings();
}
function setTheme(th) {
  if (th === THEME) return;
  THEME = th;
  localStorage.setItem('pronos26:theme', THEME);
  applyTheme();
  if (settingsOpen()) renderSettings();
}

const settingsOpen = () => !$('#settings').classList.contains('hidden');
function renderSettings() {
  $('#t-settings-h2').textContent = t('settingsTitle');
  const seg = (cur, opts) => `<div class="set-seg">${opts.map((o) => `<button class="${o.v === cur ? 'on' : ''}" data-set="${o.k}" data-val="${o.v}">${o.label}</button>`).join('')}</div>`;
  const badgeRows = Object.keys(BADGES).map((k) =>
    `<div class="set-badge"><span class="chipc">${BADGES[k].emoji}</span><div class="set-badge-txt"><b>${esc(badgeLabel(k))}</b><span>${esc(badgeDesc(k))}</span></div></div>`).join('');
  $('#settings-body').innerHTML = `
    <div class="set-section">
      <div class="set-row"><span>${t('setLang')}</span>${seg(LANG, [{ k: 'lang', v: 'fr', label: 'Français' }, { k: 'lang', v: 'en', label: 'English' }])}</div>
      <div class="set-row"><span>${t('setTheme')}</span>${seg(THEME, [{ k: 'theme', v: 'light', label: '☀️ ' + t('setThemeLight') }, { k: 'theme', v: 'dark', label: '🌙 ' + t('setThemeDark') }])}</div>
    </div>
    <div class="set-section">
      <h3>${t('badgesTitle')}</h3>
      <div class="set-badges">${badgeRows}</div>
    </div>`;
}
function openSettings() { renderSettings(); $('#settings').classList.remove('hidden'); }
function closeSettings() { $('#settings').classList.add('hidden'); }

$('#btn-settings').addEventListener('click', openSettings);
$('#settings-close').addEventListener('click', closeSettings);
$('#settings').addEventListener('click', (e) => {
  if (e.target.id === 'settings') return closeSettings(); // clic sur le fond
  const b = e.target.closest('[data-set]');
  if (!b) return;
  if (b.dataset.set === 'lang') setLang(b.dataset.val);
  else if (b.dataset.set === 'theme') setTheme(b.dataset.val);
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
