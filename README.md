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

## Déployer

L'app a deux modes :
- **serveur long** (local, Railway, Docker, VPS) : SQLite fichier + tâches de fond
  (`setInterval`) — rien à configurer ;
- **serverless (Vercel)** : base **Turso** (SQLite hébergé) + synchros « à la
  demande » déclenchées par les requêtes des joueurs (le front polle toutes les
  60 s, donc le live reste vivant) + cron quotidien en filet de sécurité.

### Vercel (repo importé → il manque la base)

1. **Créer la base Turso** (gratuit) :
   ```bash
   brew install tursodatabase/tap/turso
   turso auth signup
   turso db create pronos2026 --location cdg     # cdg = Paris
   turso db show pronos2026 --url                # → TURSO_DATABASE_URL
   turso db tokens create pronos2026             # → TURSO_AUTH_TOKEN
   ```
2. **Variables d'environnement Vercel** (Project → Settings → Environment Variables) :
   - `TURSO_DATABASE_URL` = `libsql://pronos2026-….turso.io`
   - `TURSO_AUTH_TOKEN` = le token
   - `ADMIN_KEY` = une clé de ton choix (obligatoire en serverless)
   - `CRON_SECRET` = au choix (protège `/api/cron`)
3. (Conseillé) Settings → Functions → Region : **Paris/cdg1** (même région que Turso).
4. **Redéployer** (ou `git push`). La première visite crée le schéma, synchronise
   les 104 matchs et crée les pools Famille (FR) et Amis (EN).
5. Récupérer les liens : `https://<projet>.vercel.app/?key=<ADMIN_KEY>`.

### Railway / Docker / VPS (zéro config)

Railway : New Project → Deploy from GitHub repo → Volume monté sur `/app/data`
→ Generate Domain. Ou le `Dockerfile` du repo :
`docker run -p 3026:3026 -v pronos-data:/app/data …`

## Stack

Node ≥ 18, Express 4, better-sqlite3, front vanilla (zéro build).
