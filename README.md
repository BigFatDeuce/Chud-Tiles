# Chud Tiles

**FR** — Jeu de rythme dans un univers astronomique : n'importe quel morceau, fichier local ou YouTube Music, devient une partition jouable, générée automatiquement à partir de la musique elle-même.
**EN** — A rhythm game set in a living universe: any song, a local file or YouTube Music, becomes a playable chart, generated from the music itself.

Interface en français et en anglais (Réglages › Jeu › Langue) · Interface in French and English (Settings › Game › Language).

| | |
|---|---|
| Plateformes / Platforms | Windows 10/11 (installeur + portable), Linux (AppImage, .tar.gz ; .deb/.rpm avec un champ `homepage`), navigateur (Chrome, Edge, Firefox, Safari), macOS (configuration prête, à construire sur un Mac) |
| Musique / Music | fichiers locaux MP3, FLAC, WAV, OGG, OPUS, AAC, M4A, AIFF, WMA (jamais modifiés) · YouTube Music par le lecteur officiel (aucun téléchargement, aucune extraction de flux) · bibliothèque et listes de Chud Music (lecture seule) |
| Jeu / Game | 3 à 7 colonnes, notes simples, longues, accords, rafales · Facile, Normal, Difficile, Expert, Personnalisé · clavier, souris, tactile, manette (configurables) |
| Extras | calibration, entraînement (ralenti, section en boucle), atelier de partitions, aperçu automatique, mode sans échec, cache des analyses, sauvegarde du profil |

## Documentation

| | Français | English |
|---|---|---|
| Guide du joueur / Player guide | [docs/GUIDE-UTILISATEUR.md](docs/GUIDE-UTILISATEUR.md) | [docs/USER-GUIDE.md](docs/USER-GUIDE.md) |
| Documentation technique | [docs/DOC-TECHNIQUE.md](docs/DOC-TECHNIQUE.md) | — |
| Étude préalable et choix | [docs/ETUDE-ARCHITECTURE.md](docs/ETUDE-ARCHITECTURE.md) | — |
| Bilan : ce qui marche, limites | [docs/BILAN.md](docs/BILAN.md) | — |

## Développement / Development

Node 24 ou plus récent / Node 24 or newer.

```powershell
npm install
npm run dev            # application de bureau / desktop app (Electron)
npm run web:dev        # version navigateur / browser version
```

| Commande / Command | Effet / Does |
|---|---|
| `npm run typecheck` | vérification TypeScript (main, preload, interface) |
| `npm run test:unit` | analyse, génération, temps réel, jugement, progression, traductions (Node, sans application) |
| `npm run test:e2e` | l'application réelle pilotée par Playwright, muette et invisible (`-- --online` ajoute YouTube) |
| `npm run test:web` | la version navigateur, hors ligne (`test:web-online` : YouTube par capture d'onglet) |
| `npm run test:i18n` | textes de l'interface sans traduction anglaise |
| `npm run make:icons` | toutes les icônes depuis `build/logo.svg` |
| `npm run dist:win` | `dist/Chud-Tiles-Setup-<v>.exe` + `dist/Chud-Tiles-<v>-Portable.exe` |
| `npm run dist:linux` | AppImage, .tar.gz (sous Linux ; depuis Windows : `scripts/linux-dist.sh` dans WSL) |
| `npm run dist:mac` | .dmg + .zip (sur un Mac) |
| `npm run web:build` | site statique dans `dist-web/` (à servir en HTTPS ou depuis `localhost`) |

Le dossier de Chud Music n'est jamais modifié : son FFmpeg LGPL est **copié** à l'empaquetage (`scripts/prepare-dist.mjs`, variable `CHUD_MUSIC_DIR` pour un autre emplacement).
Chud Music's folder is never changed: its LGPL FFmpeg is **copied** when packaging.
