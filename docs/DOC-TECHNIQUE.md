# Chud Tiles — Documentation technique

> Version 1.0.0 · novembre 2026. Les choix et leur justification sont dans [ETUDE-ARCHITECTURE.md](ETUDE-ARCHITECTURE.md) ; l'état final (ce qui marche, les limites) dans [BILAN.md](BILAN.md).

---

## 1. Vue d'ensemble

| Couche | Technologie | Rôle |
|---|---|---|
| Cœur portable `src/core` | TypeScript pur (ni DOM ni Node) | analyse audio, génération des partitions, prédiction en direct, jugement, progression. Testé sous Node. |
| Interface `src/renderer` | React 19, Zustand 5, Three.js (WebGL 2) | pages, univers, piste de jeu, entrées, horloges, lecteurs. La même pour le bureau et le navigateur. |
| Bureau `src/main`, `src/preload` | Electron 45 | fenêtre, protocole `ct-media://`, FFmpeg, bibliothèque, lecteur YouTube officiel, catalogue YouTube Music, bloqueur, lecture de Chud Music, mode sans échec. |
| Navigateur | même interface, adaptateur `platform/web.ts` | fichiers locaux, YouTube par lien et capture d'onglet. |

L'interface ne connaît le système qu'à travers l'interface `Platform` (`renderer/src/platform/types.ts`) : elle affiche ou masque une fonction selon `caps` (YouTube complet ou par lien, analyse dans la frame ou par capture d'onglet, bloqueur, FFmpeg, dossiers, Chud Music, fenêtre sans cadre), jamais selon le nom de la plateforme.

```
src/
  core/analysis/   frame (trames, partagé avec la frame YouTube), features, onsets, tempo, structure, analyze
  core/chart/      types (difficultés), rules (densité, poids métriques, espacement), lanes (colonnes), generate
  core/live/       predictor (Mode A)
  core/game/       judge (jugement, score, énergie, rangs), progress (XP, niveaux, grades, succès)
  main/            index (fenêtre, IPC), protocol, library, ffmpeg, store, paths, chud-music, i18n, safe-mode
  main/chud/       repris de Chud Music : yt-player (lecteur officiel), youtube (catalogue), adblock (+ worker)
  preload/         index (pont window.ct), yt-guest (canal du lecteur)
  renderer/src/
    platform/      types, electron, web, meta (étiquettes des fichiers dans le navigateur)
    audio/         context (AudioContext partagé), local-player, player (interface commune), sfx
    yt/            host (lecteur et analyseur, bureau), web-host (IFrame API), capture (onglet), player, learn
    game/          session (boucle de jeu), input, live (pont vers le prédicteur), loader (décodage, cache), actions
    gfx/           engine (rendu, bloom, cadence), playfield (piste, notes instanciées), cosmos/ (univers), noise
    pages/ components/ store/ storage/ (IndexedDB) i18n/ workers/ (analyse hors ligne)
  shared/          types et constantes communs (formats audio, liens YouTube)
tests/unit         Node, sans application · tests/e2e  Playwright sur la vraie application et le navigateur
scripts/           make-icons, prepare-dist, linux-dist.sh, i18n-extract
```

---

## 2. Audio et synchronisation

### 2.1 Horloges

- **Fichier local** : décodé entièrement (`decodeAudioData`, ou FFmpeg → FLAC → décodage) puis joué par un `AudioBufferSourceNode`. Le temps entendu à l'instant `T` vient de `AudioContext.getOutputTimestamp()` : la latence de sortie annoncée par le système est déjà comptée.
- **YouTube, bureau** : un analyseur injecté dans la frame du lecteur officiel (`webFrameMain`, `video.captureStream()` → `AudioContext` propre à la frame, relié à rien) envoie des paires (`currentTime` du média, horloge de la frame) ; une boucle à verrouillage de phase en tire une horloge continue sans sauts. Aucun échantillon ne sort de la frame : seulement des mesures.
- **YouTube, navigateur** : `IframeHost` lit `getCurrentTime()` de l'IFrame API et lisse (`snapS` 0,25 s, `alpha` 0,03) ; avec la capture d'onglet, la même boucle à verrouillage de phase que sur le bureau suit `mediaAt`.
- **Entrées** : chaque appui est daté par `event.timeStamp` (clavier, souris, tactile) ou `gamepad.timestamp` ; le jugement ne dépend pas de la fréquence d'images.
- **Rendu** : chaque image calcule la position des notes pour l'instant où elle sera affichée (`frameMs` + décalage visuel).
- **Compensation** : décalage audio (global), décalage visuel, décalage YouTube (s'ajoute pour YouTube), calibration en deux temps (son, puis image) par médiane robuste des écarts, correction proposée après chaque partie à partir de l'écart moyen mesuré.

### 2.2 Jugement (`core/game/judge.ts`)

| | Fenêtre | Points | Précision |
|---|---|---|---|
| Parfait | ±45 ms | 1 000 | 100 % |
| Super | ±90 ms | 700 | 70 % |
| Bien | ±135 ms | 350 | 40 % |
| Raté | au-delà | 0 | 0 % |

Facile : fenêtres +15 %. Note longue : tête jugée comme une note, relâcher plus de 150 ms (`RELEASE_GRACE`) avant la fin casse le combo. Multiplicateur ×2/×3/×4 à 25/50/100 de combo. Rangs SS (≥ 99 % sans raté ni note longue lâchée), S 95 %, A 90 %, B 80 %, C 70 %, D. Énergie : l'échec à zéro est désactivable. Les notes « fantômes » du mode direct se dissolvent sans pénalité.

---

## 3. Analyse et génération (Mode B, analyse préalable)

Exécutée dans un Web Worker (`workers/analysis.worker.ts`), environ **0,35 s par minute de musique**, résultat gardé dans IndexedDB (`analyses`, clé = morceau, invalidé par `ANALYSIS_VERSION`, la taille et la date du fichier).

1. **Trames** (`frame.ts`) : 2 048 échantillons, pas de 512, Hann, FFT. Huit bandes (sub, grosse caisse, basses, médiums, haut-médium, caisse claire/présence, cymbales, air) : énergie log et flux spectral (compression log, filtre max en fréquence) ; chroma 12 classes ; centroïde ; planéité ; RMS. **Le même code** tourne dans la frame YouTube (il est injecté comme texte source : un test vérifie qu'il est autonome).
2. **Transitoires** (`onsets.ts`) : fonction de détection pondérée, pic local et seuil adaptatif, classe (grosse caisse, caisse claire, cymbale, tonal), force, tenue (son maintenu) et hauteur.
3. **Tempo et battements** (`tempo.ts`) : autocorrélation avec harmoniques et a priori centré sur 120 BPM, programmation dynamique, ajustement par morceaux de la grille, changements de tempo par segments, premiers temps des mesures.
4. **Structure** (`structure.ts`) : auto-similarité par mesure (chroma + timbre), sections, refrains (section répétée la plus intense), intensité par mesure, source de répétition.
5. **Partition** (`generate.ts`, `rules.ts`, `lanes.ts`) : candidats calés sur la grille, saillance (force × poids métrique × classe × intensité), densité cible par mesure selon la difficulté et l'intensité (calmes clairsemés, refrains denses), notes longues sur les sons tenus, accords sur les attaques larges et débuts de section, colonnes par coût minimal (contour mélodique, grosse caisse à gauche / caisse claire à droite, équilibre des mains, anti-répétition, **même motif pour une mesure qui se répète**), vérification d'équité (écart minimal par colonne et global, notes par seconde, doigts simultanés). Graine déterministe : une partition est toujours la même pour un morceau et une difficulté.

| | Facile | Normal | Difficile | Expert | Personnalisé |
|---|---|---|---|---|---|
| Subdivision la plus fine | noire | croche | double croche | double + triolets | réglable |
| Accords | — | rares | oui | fréquents | réglable |
| Notes longues | simples | oui | avec l'autre main | libres | réglable |

Mesures (tests unitaires, morceaux synthétiques dont la vérité est connue) : tempo à ±0,2 BPM (87 à 140 BPM, swing), erreur moyenne des battements 2,8 à 7,9 ms, premiers temps justes à 88–96 %.

---

## 4. Mode A, temps réel (`core/live/predictor.ts`)

Pour un morceau YouTube jamais entendu : impossible de voir l'avenir, donc **prédiction**.

1. Les attaques sont détectées à l'arrivée des trames.
2. Le tempo est réestimé toutes les 0,5 s (hystérésis), la phase suivie par une boucle à verrouillage de phase.
3. Chaque mesure terminée est mémorisée sur 16 cases (force, instrument).
4. La mesure qui va entrer à l'écran est prédite à partir des mesures situées 2, 4 et 8 mesures avant, pondérées par leur réussite récente.
5. Les notes suivent les mêmes règles que hors ligne ; elles sont engagées une fois, à l'horizon (temps d'approche + marge), jamais déplacées ni retirées.

Une note que la musique ne confirme pas devient un **fantôme** qui se dissout. Pulsation introuvable → **mode prudent** (notes rares sur la pulsation probable). **Silence** (RMS moyen < 0,004 sur 1,5 s) → aucune note. Coût : ~30 µs par trame (budget 11,6 ms).

### Comparaison des deux modes (mesurée)

| | Mode A — direct | Mode B — analyse préalable |
|---|---|---|
| Notes à moins de 25 ms d'une vraie attaque | 84 à 96 % selon le morceau (tests unitaires) | calées sur la grille analysée (battements à ~3 ms) |
| Premières notes | après 8 à 12 s d'écoute | dès le début |
| Refrains, notes longues sur toute la durée | découverts en cours de route | connus avant de jouer |
| Reproductible | non | oui |
| Changement de tempo brutal, silence, break | fantômes possibles, silence géré | sans problème |

D'où l'**apprentissage** : après une partie en direct (ou « Écouter d'abord »), les mesures enregistrées pendant l'écoute (`yt/learn.ts`) passent par l'analyse complète, et YouTube rejoint la qualité du Mode B dès la partie suivante (IndexedDB `learned`).

---

## 5. YouTube

- **Bureau** : le lecteur officiel est une page servie par l'application dans une `<webview>` à la session séparée `persist:ct-youtube` (`main/chud/yt-player.ts`, repris de Chud Music). Visible (coin de l'écran pendant la partie, jamais masqué ni sous 200 px), contrôlé par messages (`charger`, `jouer`, `pause`, `saut`, `volume`, `vitesse`). Publicités détectées et partie mise en attente.
- **Catalogue** : `youtubei.js` (métadonnées seulement : recherche, suggestions, albums, playlists, radio), langue et pays suivant ceux de l'interface et du système.
- **Bloqueur** : `@ghostery/adblocker-electron`, listes uBlock Origin, compilé dans un worker, appliqué **uniquement** à la session du lecteur, interrupteur et état dans Réglages › YouTube (même principe et mêmes listes que Chud Music).
- **Navigateur** : IFrame API officielle + capture de l'onglet avec le consentement explicite du joueur (`getDisplayMedia`, `preferCurrentTab`, audio seulement : la piste vidéo est arrêtée aussitôt). Rien n'est enregistré.
- Jamais : téléchargement, extraction de flux, retard ajouté au son, lecteur caché.

---

## 6. Rendu et performances

- Un seul `WebGLRenderer` : l'univers (`gfx/cosmos` : nébuleuse en bruit fractal à résolution réduite, trois couches d'étoiles, planète, anneaux, lunes, galaxie, comètes, astéroïdes instanciés, traînées de voyage) puis la piste (`gfx/playfield.ts` : notes instanciées, positions calculées dans le *vertex shader* depuis l'heure du morceau), bloom à résolution réduite.
- Aucune allocation dans la boucle de jeu (tableaux typés réutilisés). Cadence libre (60 à 240 Hz) ou plafonnée ; 30 i/s dans les menus inactifs (option).
- Qualité Auto / Basse / Moyenne / Haute ; effets complets / réduits / minimaux ; mouvements réduits.
- Fond d'écran animé uniquement par shaders procéduraux : aucune vidéo, aucune image externe.

---

## 7. Langues

- `renderer/src/i18n` : le texte français est la clé (`tr('Jouer')`), le dictionnaire `en.ts` donne l'anglais. Variables `tr('{n} notes', { n })`, pluriels `trn(n, un, plusieurs)` (0 et 1 au singulier en français, seul 1 en anglais), nombres et dates par `fmtNum` / `locale`.
- La langue est lue au démarrage (réglage, sinon langue du système) ; la changer recharge l'interface (les constantes construites au chargement sont donc traduites aussi).
- Processus principal : `main/i18n.ts` (`say(fr, en)`) pour les titres de dialogues et les erreurs ; l'interface lui donne sa langue au démarrage (`app:lang`).
- Ajouter une langue : un dictionnaire `xx.ts`, une entrée dans `LANGS`, la règle de pluriel dans `trn`.
- `npm run test:i18n` (et un test unitaire) échoue si un texte de l'interface n'a pas de traduction, si une traduction perd une variable `{x}`, ou si un succès ou un grade n'est pas traduit. `node scripts/i18n-extract.mjs report` liste les textes non encore passés par `tr()`.

---

## 8. Mode sans échec (`main/safe-mode.ts`)

| Déclencheur | Effet |
|---|---|
| `--safe-mode`, Réglages › Affichage, `CT_SAFE_MODE=1` | `app.disableHardwareAcceleration()` + `enable-unsafe-swiftshader` : WebGL sur le processeur (SwiftShader) ; interface : qualité basse, effets 0, 60 i/s max, pastille « Mode sans échec ». |
| Deux démarrages de suite sans interface fonctionnelle (compteur `starting` dans `chud-tiles.json`, remis à zéro après 8 s sans problème ou à la fermeture normale) | démarrage suivant en mode sans échec, raison « crash ». |
| Interface plantée plus de 3 fois en une minute | redémarrage immédiat en mode sans échec ; déjà dedans : message et fermeture. |
| Pilote graphique planté 2 fois | prochain démarrage en mode sans échec, avertissement. |
| WebGL indisponible au démarrage | redémarrage en mode sans échec. |

Navigateur : `?safe` dans l'adresse (effets minimaux ; le navigateur garde son propre choix de GPU).

---

## 9. Données

| Où | Quoi |
|---|---|
| IndexedDB de l'interface | `kv` (réglages, profil, listes, partitions modifiées), `records` (historique), `tracks` (archives), `analyses` (cache), `learned` (morceaux YouTube appris), `handles` (fichiers du navigateur) |
| `chud-tiles.json` (dossier utilisateur) | fenêtre, dossiers de musique, bloqueur, mode sans échec |
| Cache système (`%LOCALAPPDATA%\Chud Tiles\Cache`, `~/.cache/chud-tiles`) | listes de filtres compilées, pochettes |
| Fichiers audio | **lus seulement** (protocole `ct-media://` avec liste blanche de chemins, FFmpeg vers un tube) |
| Chud Music | **lu seulement** : instantané de `chud.db` ouvert en lecture, pochettes servies depuis son dossier |

Sauvegarde / restauration du profil complet dans un fichier JSON (Réglages › Données).

### Classement en ligne (`server/`, `src/shared/leaderboard.ts`)

Le site `chud-tiles.holy-c.men` est un Worker Cloudflare : il sert la version navigateur (`dist-web`, ressources statiques) et l'API du classement sous `/api/`. Les scores sont dans une base D1 (SQLite, `server/schema.sql`).

| Route | Effet |
|---|---|
| `GET /api/scores/recent?difficulty=all\|easy\|normal\|hard\|expert` | les 100 derniers scores |
| `GET /api/scores/song?key=&difficulty=&lanes=` | le classement d'un morceau : meilleur score de chaque pseudo |
| `POST /api/scores` | publie un score (corps JSON `ScoreSubmission`) |

- Un morceau est identifié par `yt:<id vidéo>` ou `s:<artiste>|<titre>` nettoyés (`songKeyOf`) : un même morceau a le même classement d'un joueur à l'autre. Classement par morceau, difficulté et nombre de colonnes.
- Seuls comptent les morceaux terminés en Facile à Expert, hors entraînement, aperçu et parties en direct (notes prédites). Le serveur refuse les scores incohérents (`validateScore` : comptes de notes, combo, score maximal possible, pseudo).
- Aucun compte : un pseudo n'est qu'un nom. L'adresse de l'expéditeur n'est gardée qu'une heure, hachée avec un sel secret, pour limiter à 30 envois par heure.
- Le jeu n'envoie rien sans le bouton *Publier* ; les tests automatisés ne joignent jamais le serveur ; Réglages › Jeu › Classement en ligne coupe tout.
- Déployer : `npm run site:deploy` (construit le site puis `wrangler deploy -c server/wrangler.jsonc`). Le sel : `wrangler secret put SALT -c server/wrangler.jsonc`.

---

## 10. Tests

| Commande | Contenu | Résultat (23/11/2026) |
|---|---|---|
| `npm run typecheck` | main, preload, interface | 0 erreur |
| `npm run test:unit` | trames autonomes, tempo/battements/premiers temps (6 morceaux), structure, partitions (équité, déterminisme, niveaux), prédicteur (alignement, silence, coût), jugement (fenêtres, cadence, fantômes, échec), progression, traductions | 42/42 |
| `npm run test:e2e` | `smoke` (fenêtre, pont, pages, Chud Music, FFmpeg), `formats` (10 formats par leur chemin, fichiers intacts), `editor` (atelier), `lang` (tout en anglais, sélecteur, messages du système), `safe` (mode sans échec, détection des plantages, rendu logiciel) | 5/5 suites |
| `npm run test:e2e -- --online` | + `radio` (salle radio, listes, bloqueur, apprentissage), `youtube` (recherche, lecteur officiel, analyse dans la frame, partie en direct, apprentissage) | 9/9 et 14/14 |
| `npm run test:web` / `test:web-online` | navigateur : démarrage, analyse d'un fichier, partie, langue · YouTube par lien et capture d'onglet | 5/5 · 7/7 |

Les tests de bout en bout tournent dans des profils temporaires isolés, dans une fenêtre invisible, muette, qui ne prend jamais le focus (`CT_TEST_QUIET`) ; `CT_TEST_VISIBLE=1` montre l'exécution. `CT_EXE=…` les lance sur l'application empaquetée.

---

## 11. Construire

| Cible | Commande | Sortie |
|---|---|---|
| Windows | `npm run dist:win` | `dist/Chud-Tiles-Setup-1.0.0.exe` (NSIS, français/anglais, dossier au choix, données gardées à la désinstallation), `dist/Chud-Tiles-1.0.0-Portable.exe` |
| Linux | `node scripts/prepare-dist.mjs linux` (Windows) puis `wsl -d <distribution> -- bash scripts/linux-dist.sh`, ou `npm run dist:linux` sous Linux | AppImage, .tar.gz, .deb, .rpm (ces deux derniers parce que `package.json` a un champ `homepage`) |
| macOS | `npm run dist:mac` sur un Mac | .dmg, .zip (non signés : la signature Apple demande un compte développeur) |
| Navigateur | `npm run web:build` | `dist-web/`, site statique (HTTPS ou `localhost` : la capture d'onglet et l'accès aux fichiers l'exigent) |

`prepare-dist.mjs` génère les icônes si besoin (`build/logo.svg` → PNG, ICO, ICNS, favicon), **copie** le FFmpeg LGPL de Chud Music (sources désignées par `CHUD_MUSIC_DIR`, par le fichier local non versionné `.chud-music-dir` ou par un dossier `Chud-Music` voisin ; sinon Chud Music installé sous Windows) sans jamais écrire dans son dossier, et écrit `build/THIRD-PARTY-NOTICES.txt`.
