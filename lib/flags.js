// Feature flags — bascule un booléen ci-dessous puis redéploie pour (dé)activer une mécanique.
// Chaque flag peut aussi être forcé par une variable d'env homonyme ('1' = on, '0' = off),
// ce qui prime sur la valeur par défaut.
const flag = (name, def) => (process.env[name] == null ? def : process.env[name] === '1');

module.exports = {
  // Capitaine : 1 match ×2 par journée. Mis en pause le 17/06/2026 (jamais utilisé en prod).
  // Le code, la table captain_picks et les pronos existants restent intacts.
  // Repasser à `true` (ou poser CAPTAIN_ENABLED=1) pour le réactiver.
  CAPTAIN_ENABLED: flag('CAPTAIN_ENABLED', false),
};
