# ⚽ Pronos Mondial 2026

Pronostics de la Coupe du Monde 2026 entre famille & amis. Une seule vue par pool :
arbre du tableau final avec drapeaux, phase de groupes avec saisie des pronos, classement.
Interface FR/EN (toggle dans le header, détection auto de la langue du navigateur),
mode sombre (toggle, suit la préférence système par défaut).

Design façon fiche Google : onglets pills (Aperçu · Matchs · Arbre · Groupes ·
Classement), items de match empilés avec score/inputs à droite, « Live » vert,
tableaux J G N P Diff Pts avec pastille de forme. Sur mobile, l'app s'ouvre sur la
vue **Matchs** (chronologique, par jour) avec les pronos saisissables dans la liste ;
sur desktop, l'onglet **Aperçu** garde tout sur une seule vue.

## Lancer

```bash
npm install
npm start          # http://localhost:3026
```

Au démarrage, le serveur affiche :
- le lien **admin** (avec ta clé) ;
- les liens secrets des pools (`/p/<token>`), créés par défaut : **Famille** et **Amis**.

## Fonctionnement

- **Pools privés** — chaque pool a un lien secret. Qui a le lien voit le pool, personne
  ne voit les autres pools. Aucune liste publique.
- **Connexion libre** — on entre un pseudo, c'est tout. PIN optionnel (3-6 chiffres)
  pour empêcher l'usurpation. La session est gardée dans le navigateur (localStorage).
- **Pronos** — saisie directe dans les groupes et dans l'arbre (dès que les équipes
  sont connues). Sauvegarde automatique. Verrouillage au coup d'envoi. Les pronos des
  autres ne sont visibles qu'une fois le match commencé (clic sur un match verrouillé).
- **Barème** — score exact **3 pts** · bon résultat **1 pt** (en élimination directe :
  bonne équipe qualifiée) · sinon 0.
- **Pronos express** — à l'ouverture (au plus une fois toutes les 12 h), une modale
  propose de pronostiquer les matchs des prochaines 24 h qui n'ont pas encore de prono ;
  une bannière permanente permet de la rouvrir tant qu'il en reste.
- **Scores en temps réel** — pendant un match, le serveur polle le scoreboard public
  ESPN (sans clé) toutes les 60 s : score + minute affichés en rouge (header, groupes,
  arbre). Au coup de sifflet final, le résultat et l'équipe qualifiée sont écrits
  immédiatement (tirs au but inclus via le vainqueur ESPN) — le classement bouge
  sans attendre la synchro fixturedownload.
- **Données** — calendrier, équipes et résultats officiels tirés de
  [fixturedownload.com](https://fixturedownload.com/results/fifa-world-cup-2026)
  (synchro au démarrage puis toutes les 30 min, bouton manuel côté admin).
  Les vainqueurs aux tirs au but sont aussi déduits du tour suivant en secours.
  Drapeaux : [flagcdn.com](https://flagcdn.com). Snapshot de secours dans
  `data/seed-feed.json`.

## Admin (`/`)

Créer / supprimer des pools, copier les liens à partager, forcer une synchro.
La clé est dans `data/config.json` (ou env `ADMIN_KEY`), affichée au démarrage.

## Config

| Variable    | Défaut                                  |
|-------------|-----------------------------------------|
| `PORT`      | `3026`                                   |
| `ADMIN_KEY` | générée dans `data/config.json`          |
| `FEED_URL`  | feed fixturedownload World Cup 2026      |

## Déployer (pour partager les liens)

Tout tient dans **un process Node + un fichier SQLite** (`data/pronos.db`).
Il faut donc un hébergeur avec process permanent et disque persistant.

**⚠️ Pas Vercel tel quel** : serverless = pas de `setInterval` (synchro 30 min,
live ESPN 60 s) et pas de disque persistant pour le SQLite. Adapter pour Vercel
demanderait de remplacer SQLite par Turso/Neon et de passer les synchros en
« à la demande » — faisable, mais c'est un refactor.

**Railway (recommandé, même confort que Vercel)** :
1. Pousser le repo sur GitHub.
2. [railway.app](https://railway.app) → New Project → Deploy from GitHub repo.
3. Dans le service : Settings → Volumes → monter un volume sur `/app/data`.
4. Settings → Networking → Generate Domain. C'est tout : auto-deploy à chaque push.
   (Optionnel : variable `ADMIN_KEY` pour fixer la clé admin.)

**Fly.io / VPS / home-server** : le `Dockerfile` du repo suffit
(`docker run -p 3026:3026 -v pronos-data:/app/data …`). Derrière un domaine,
n'importe quel reverse proxy (Caddy, nginx, Cloudflare Tunnel) fait l'affaire.

## Stack

Node ≥ 18, Express 4, better-sqlite3, front vanilla (zéro build).
