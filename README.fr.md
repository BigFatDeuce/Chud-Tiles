<p align="center">
  <img src="build/logo/svg/logo.svg" width="160" alt="Logo de Chud Tiles">
</p>

<h1 align="center">Chud Tiles</h1>

<p align="center">
  <b>Un jeu de rythme qui écrit ses partitions à partir de votre musique.</b><br>
  Fichiers locaux ou YouTube Music · Windows · Linux · navigateur
  <br><b><a href="https://chud-tiles.holy-c.men">Jouer dans le navigateur : chud-tiles.holy-c.men</a></b>
</p>

<p align="center">
  <a href="https://github.com/BigFatDeuce/Chud-Tiles/releases/latest"><img src="https://img.shields.io/github/v/release/BigFatDeuce/Chud-Tiles?label=release&color=8b5cf6" alt="Dernière version"></a>
  <a href="https://github.com/BigFatDeuce/Chud-Tiles/releases/latest"><img src="https://img.shields.io/github/downloads/BigFatDeuce/Chud-Tiles/total?color=38d6ff" alt="Téléchargements"></a>
  <a href="https://github.com/BigFatDeuce/Chud-Tiles/actions/workflows/ci.yml"><img src="https://github.com/BigFatDeuce/Chud-Tiles/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  &nbsp;·&nbsp; <a href="README.md">English version</a>
</p>

<p align="center">
  <img src="docs/images/gameplay.gif" width="560" alt="Expert, 6 pistes : un combo de 200, des frappes pile au centre, les pistes en feu">
</p>

<p align="center">
  <a href= + REL + ><b>⬇ Télécharger pour Windows ou Linux</b></a> &nbsp;·&nbsp;
  <a href="https://chud-tiles.holy-c.men"><b>▶ Jouer dans le navigateur</b></a>
</p>

![Le pont, l'écran d'accueil de Chud Tiles](docs/images/accueil.jpg)

Les notes glissent sur des pistes lumineuses vers une ligne de frappe : appuyez sur la piste quand elles la touchent. Personne n'écrit les partitions à la main. Chud Tiles écoute chaque morceau (tempo, temps, grosse caisse, caisse claire, cymbales, sons tenus, refrains) et en tire une partition jouable pour chaque difficulté.

## Nouveau dans la 1.1

- **Visez le centre.** Des tuiles plus grandes, avec une bande étroite au milieu : une note frappée pile au centre (±20 ms) rapporte bien plus, et une série de frappes pile ajoute jusqu'à +100 %.
- **Du spectacle.** Des paliers de combo de 25 à 400 embrasent les pistes : ondes de choc, faisceaux, et un éclair quand le combo casse.
- **Classement en ligne** sur [chud-tiles.holy-c.men](https://chud-tiles.holy-c.men) : un tableau par morceau et difficulté, les 100 derniers scores, un pseudo choisi avant ou après la partie.
- **Mises à jour** cherchées au lancement : l'installeur Windows et l'AppImage se mettent à jour seuls.
- Volume de la musique avant la partie et dans le menu pause ; les morceaux YouTube se jouent en partie normale (partition complète) par défaut.

## Ce qu'il sait faire

**Des partitions nées de la musique**
- Tempo, temps et mesures ; grosse caisse, caisse claire et cymbales réparties sur les pistes ; notes longues sur les sons tenus ; accords et rafales ; plus de notes dans les refrains.
- Facile, Normal, Difficile, Expert et Personnalisé (densité, subdivisions, accords, notes longues, écart minimal, fenêtres de jugement), chacune notée de 1 à 20, sur 3 à 7 pistes.
- Un même morceau donne toujours la même partition, et chaque analyse est gardée en cache.

**Votre musique, intacte**
- Fichiers locaux : MP3, FLAC, WAV, OGG, OPUS, AAC, M4A, AIFF, WMA, ALAC. Glisser-déposer, dossiers surveillés, favoris. Les fichiers ne sont jamais copiés ni modifiés.
- YouTube Music : recherche, albums, playlists, radio. Par défaut, l'application de bureau télécharge une fois le son du morceau avec [yt-dlp](https://github.com/yt-dlp/yt-dlp) (installé au premier usage) et le joue comme un fichier local : partition complète tout de suite, sans publicité ni saccade. L'autre façon est **le lecteur officiel de YouTube**, en direct, sans rien télécharger (c'est aussi le secours si un téléchargement échoue) :
  - *Jouer en direct* : les notes sont prédites un peu en avance pendant que le morceau joue.
  - *Écouter d'abord* : une écoute complète, puis la partition entière.
  - Un morceau joué en direct jusqu'au bout est *appris* : la partie suivante a la partition complète.
- Pensé pour cohabiter avec [Chud Music](https://github.com/BigFatDeuce/Chud-Music) : le même bloqueur de publicités (moteur Ghostery, listes uBlock Origin, appliqué au seul lecteur) et la bibliothèque et les listes de Chud Music, en lecture seule.

**Jouez comme vous voulez**
- Clavier, souris, tactile et manette ; chaque touche se change, une disposition par nombre de pistes.
- Calibration du son et de l'image, décalage propre à YouTube, et courbe de précision après chaque partie avec une correction proposée.
- Entraînement (vitesse de 50 à 100 %, une section, en boucle), aperçu automatique, et un atelier pour retoucher n'importe quelle partition générée.
- Progression : XP, 8 grades d'équipage, 22 succès, classement personnel par difficulté, historique complet.
- **Classement en ligne** : après un morceau terminé (Facile à Expert), choisissez un pseudo et publiez votre score. Chaque morceau a son classement par difficulté et nombre de colonnes, et l'onglet *Classement* liste les 100 derniers scores. Rien n'est envoyé sans publication ; désactivable dans Réglages › Jeu.

**Un univers vivant**
- Scènes spatiales procédurales dessinées avec Three.js (WebGL2) : nébuleuses, planètes à anneaux, ceintures d'astéroïdes.
- Les images par seconde suivent l'écran (60, 120, 144, 240 Hz…) ; les frappes sont jugées sur leur propre horodatage, quelle que soit la cadence.
- Mode sans échec (rendu logiciel, effets minimaux) pour les pilotes graphiques capricieux ; il s'active seul après des plantages répétés.
- Interface en français et en anglais.

## Captures

| | |
|---|---|
| ![Une partie en Expert, 6 pistes : combo de 256, série pile au centre](docs/images/partie.jpg) | ![Page d'un morceau : cinq difficultés, pistes, volume, classement en ligne](docs/images/morceau.jpg) |
| ![L'atelier de partitions](docs/images/editor.jpg) | ![Le carnet de bord : niveau, statistiques, succès](docs/images/logbook.jpg) |

## Plateformes

| Plateforme | Paquet | Remarques |
|---|---|---|
| Windows 10/11 | `Chud-Tiles-Setup-<version>.exe`, `Chud-Tiles-<version>-Portable.exe` | installeur en français ou en anglais, ou exécutable portable. Non signé : SmartScreen demande une fois (*Informations complémentaires › Exécuter quand même*). |
| Linux x64 | `.AppImage`, `.tar.gz`, `.deb`, `.rpm` | AppImage : `chmod +x`, puis lancez-la. |
| Navigateur | [chud-tiles.holy-c.men](https://chud-tiles.holy-c.men), ou votre propre site statique (`npm run web:build`) servi en HTTPS | Chrome ou Edge recommandés. Fichiers locaux, et YouTube à partir d'un lien collé (partage du son de l'onglet). |
| macOS | `npm run dist:mac` sur un Mac | configuration prête, pas encore construite ni testée. |

Votre profil, vos records et vos analyses restent sur votre ordinateur (`%APPDATA%\Chud Tiles` sous Windows, `~/.config/Chud Tiles` sous Linux, le stockage du navigateur sur le web).

## Commandes par défaut

| Action | Clavier | Manette | Souris / tactile |
|---|---|---|---|
| Pistes (4 pistes) | `1` `2` `3` `4` (rangée des chiffres) ou les flèches | croix, boutons, gâchettes | touchez la piste |
| Pause | `Échap` | Start | bouton pause |
| Recommencer | `Retour arrière` | — | menu pause |

Jugements : Pile ±20 ms (frapper la ligne centrale de la tuile : moitié plus de points, et un bonus de série), Parfait ±45 ms, Super ±90 ms, Bien ±135 ms. Les règles complètes, les autres nombres de pistes et le dépannage sont dans le [guide du joueur](docs/GUIDE-UTILISATEUR.md).

## Construire depuis les sources

Node 24 ou plus récent.

```sh
npm install
npm run dev        # application de bureau (Electron)
npm run web:dev    # version navigateur
```

| Commande | Effet |
|---|---|
| `npm run typecheck` | vérification TypeScript (main, preload, interface) |
| `npm run test:unit` | analyse, génération, prédiction en direct, jugement, progression, traductions (Node, sans application) |
| `npm run test:e2e` | l'application réelle pilotée par Playwright, muette et invisible (`-- --online` ajoute YouTube) |
| `npm run test:web` | la version navigateur, hors ligne |
| `npm run test:i18n` | textes de l'interface sans traduction anglaise |
| `npm run dist:win` | installeur et exécutable portable Windows dans `dist/` |
| `npm run dist:linux` | AppImage, .tar.gz, .deb, .rpm (sous Linux ; depuis Windows, `scripts/linux-dist.sh` dans WSL) |
| `npm run dist:mac` | .dmg et .zip (sur un Mac) |
| `npm run web:build` | site statique dans `dist-web/` |
| `npm run site:deploy` | construit le site et le déploie avec l'API du classement sur Cloudflare (`server/` : Worker + D1 ; demande `wrangler login`) |

**FFmpeg (facultatif).** Les formats rares (WMA, ALAC, certains AIFF) sont décodés par FFmpeg. Les paquets de bureau embarquent la version LGPL, audio seulement, de Chud Music : `scripts/prepare-dist.mjs` la copie depuis une copie de Chud Music qui contient son dossier `build/vendor` (variable `CHUD_MUSIC_DIR`, ou chemin écrit dans un fichier local `.chud-music-dir`). Sans elle, les paquets sont construits sans FFmpeg et les autres formats fonctionnent.

## Documentation

| | Français | English |
|---|---|---|
| Guide du joueur | [docs/GUIDE-UTILISATEUR.md](docs/GUIDE-UTILISATEUR.md) | [docs/USER-GUIDE.md](docs/USER-GUIDE.md) |
| Documentation technique | [docs/DOC-TECHNIQUE.md](docs/DOC-TECHNIQUE.md) | — |
| Étude préalable et choix | [docs/ETUDE-ARCHITECTURE.md](docs/ETUDE-ARCHITECTURE.md) | — |
| Bilan : ce qui marche, limites | [docs/BILAN.md](docs/BILAN.md) | — |

## Construit avec

Electron, React, TypeScript, Three.js, Zustand, Vite et electron-vite, [youtubei.js](https://github.com/LuanRT/YouTube.js), [le bloqueur de Ghostery](https://github.com/ghostery/adblocker), FFmpeg (LGPL), les polices Oxanium et Space Grotesk (SIL OFL) et les icônes Lucide. L'empaquetage écrit la liste complète des licences tierces dans `THIRD-PARTY-NOTICES.txt`, livré avec l'application.

## À savoir

- Chud Tiles n'est affilié ni à YouTube ni à Google. Les vidéos YouTube sont lues par le lecteur intégré officiel de YouTube et restent soumises à ses conditions. Le téléchargement avec yt-dlp (par défaut sur le bureau) et le bloqueur de publicités vont à l'encontre de ces conditions : usage personnel, à vos risques ; les deux se coupent dans Réglages › YouTube.
- Aucune licence n'a encore été choisie : le code est public en lecture, mais tous droits réservés.
