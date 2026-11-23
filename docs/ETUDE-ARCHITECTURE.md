# Chud Tiles — Étude préalable, choix techniques et plan

> Rédigé le 22 novembre 2026, avant la première ligne de code (Phases 1 et 2 du cahier des charges).
> Ce document est mis à jour au fil du développement ; le bilan final est dans [`BILAN.md`](BILAN.md).

---

## 0. Résumé des décisions

| Sujet | Décision | Pourquoi, en une ligne |
|---|---|---|
| Moteur | **TypeScript + Three.js (WebGL2, shaders maison)**, interface **React** | seul choix qui tourne à l'identique sous Windows, Linux, macOS **et** dans un navigateur, et qui peut héberger le lecteur officiel YouTube |
| Application de bureau | **Electron 45** (comme Chud Music) | lecteur YouTube officiel, bloqueur Ghostery, catalogue YouTube Music, FFmpeg : déjà éprouvés dans Chud Music |
| Version navigateur | **même code**, adaptateur « web » | fichiers locaux complets ; YouTube par lien, analyse par capture d'onglet autorisée (Chrome/Edge) |
| Analyse YouTube | script d'analyse **injecté dans la frame du lecteur officiel** (`captureStream` → copie du son → FFT) ; **seules des mesures** (énergies, flux spectral) sortent de la frame | la lecture officielle n'est ni modifiée, ni retardée, ni enregistrée ; aucune donnée audio n'est extraite |
| Mode A (temps réel) | **prédiction** : tempo + phase + mémoire des motifs rythmiques (mesures précédentes), notes engagées ~2 s à l'avance ; notes « fantômes » non confirmées par la musique jamais comptées comme ratées | on ne peut pas lire le futur d'un flux qu'on n'a pas le droit de retarder |
| Mode B (préalable) | fichiers locaux : décodage complet → analyse hors ligne (≈ 1 s par morceau) ; YouTube : **« apprentissage »** — la première écoute enregistre les mesures, la carte précise est construite et gardée pour les parties suivantes | précision maximale et cartes reproductibles |
| Synchronisation | horloge audio (`AudioContext.getOutputTimestamp`) pour les fichiers ; horloge du `<video>` YouTube transmise par la frame avec synchronisation d'horloges type NTP ; entrées jugées sur `event.timeStamp` (indépendant des images/s) ; calibration automatique par frappes | un jeu de rythme mal synchronisé n'a aucun intérêt |
| Réutilisation de Chud Music | **copie adaptée** de modules éprouvés (lecteur YouTube, catalogue, bloqueur, protocole média, FFmpeg) + **lecture seule de sa bibliothèque** (instantané de `chud.db`) | aucun fichier de Chud Music n'est modifié ; Chud Tiles reste autonome |
| Stockage | IndexedDB partout (scores, historique, analyses en cache, profil) | une seule implémentation pour bureau et navigateur |
| Plateformes | Windows (NSIS + portable), Linux (AppImage, .deb, .rpm, construits sous Linux ou WSL), Web (site statique / PWA) ; macOS : code et configuration prêts, construction sur un Mac ou un runner macOS | priorité Windows/Linux |

---

## 1. Audit de Chud Music (lecture seule)

Source étudiée : le dépôt [Chud Music](https://github.com/BigFatDeuce/Chud-Music) (v1.4.0). Rien n'y a été écrit. La base `chud.db` n'a été lue que **sur une copie**.

### 1.1 Architecture constatée

```
Electron 45.2.2 (Chromium 156, Node 24) — electron-vite 6, React 19, Zustand, TypeScript
main/      fenêtre, protocole chud-media:// (Range + CORS), SQLite (node:sqlite), FFmpeg LGPL,
           catalogue YouTube Music (youtubei.js), session YouTube (persist:youtube),
           bloqueur Ghostery + listes uBlock Origin (worker), mises à jour GitHub
preload/   pont IPC typé (window.chud) + yt-guest (canal du lecteur YouTube)
renderer/  interface React, moteur Web Audio (2 decks, EQ, analyseur), visualiseur butterchurn
shared/    types, machines à états (tables), i18n (10 langues)
```

### 1.2 Composants et décision de réutilisation

| Composant Chud Music | Ce qu'il fait | Décision pour Chud Tiles |
|---|---|---|
| `main/yt-player.ts` | page `chud-yt://player/` servie depuis la mémoire, `<webview>` isolé sur partition dédiée, en-tête `Referer`, IFrame API, injection de scripts dans la frame YouTube (`webFrameMain.executeJavaScript`) | **Repris et adapté** : même principe ; le petit mesureur de spectre (22 bandes, 30/s) est remplacé par un **analyseur rythmique** (8 bandes, flux spectral, ~94 mesures/s, horodatage média) |
| `main/youtube.ts` | catalogue YouTube Music via `youtubei.js` (recherche, albums, artistes, mix `RDAMVM`, liens collés) | **Repris** (recherche, suggestions, album, artiste, mix, liens YouTube) |
| `main/adblock.ts` + `adblock-worker.ts` | moteur Ghostery alimenté par **le catalogue officiel des listes uBlock Origin**, vérification horaire (ETag), moteur sérialisé en cache, construit dans un worker, appliqué à la seule session YouTube, diagnostic « ad-showing » | **Repris tel quel dans son principe et ses réglages** : mêmes listes, mêmes groupes (`default`, `ads`, `privacy`), même filtrage cosmétique limité à YouTube, interrupteur, état, compteur de requêtes bloquées et de pubs vues |
| `shared/machines.ts` | machines à états en tables (lecture, bloqueur, mises à jour) | **Repris** pour le bloqueur ; le jeu a sa propre machine (chargement → compte à rebours → jeu → pause → résultats) |
| `main/protocol.ts` | protocole média avec `Range`, liste blanche de chemins | **Repris** (`ct-media://`) |
| `main/ffmpeg.ts` + `build/vendor/ffmpeg` | FFmpeg 9.0.2 **LGPL**, audio seul, sortie FLAC | **Réutilisé** (même binaire, copié dans le paquet) pour ALAC, WMA, AIFF, WavPack, AC3 |
| Base `chud.db` | bibliothèque, playlists (locales + YouTube), historique | **Lue en lecture seule** via un instantané copié dans le cache de Chud Tiles : la bibliothèque et les playlists de Chud Music apparaissent dans le jeu, sans double scan |
| Pochettes en cache | `%LOCALAPPDATA%\Chud Music\Cache\covers` | **Lues** pour afficher les pochettes de la bibliothèque importée |
| Moteur Web Audio (decks, EQ, gapless) | lecture musicale continue | **Non repris** : un jeu de rythme a besoin d'une horloge échantillon-exacte (`AudioBufferSourceNode` sur un tampon décodé), pas d'un lecteur continu |
| butterchurn, Canvas UI, skins | visualiseur et effets de Chud Music | **Non repris** : direction artistique propre (shaders astronomiques), pour ne pas faire un « Chud Music bis » |

**Pourquoi copier plutôt que partager un paquet commun ?** Un paquet partagé obligerait à restructurer Chud Music (interdit). Importer directement ses fichiers depuis un autre dépôt rendrait la compilation de Chud Tiles dépendante d'un chemin réseau et des modules internes de Chud Music (i18n, chemins `Chud Music`). Les ~900 lignes reprises sont donc copiées dans `src/main/chud/`, avec leur origine en en-tête, et restent alignées sur les mêmes principes. Pour une factorisation future, ces fichiers sont le point de départ d'un paquet `@chud/core`.

### 1.3 Nova Drift

Jeu GameMaker étudié comme référence visuelle (fichiers du jeu et licences de ses polices).

| Élément | Licence | Réutilisable ? |
|---|---|---|
| Graphismes, sons, musiques (`data.win`, `audiogroup*.dat`) | propriété de Pixeljam | **Non** (droit d'auteur) |
| Police **Ailerons** | licence « Exclusive Product » **pour Nova Drift uniquement**, embarquement dans un logiciel interdit (clauses 2 et 5) | **Non** |
| Gidole, Noto Sans, Taipei Sans, Roboto Condensed | SIL OFL / Apache 2.0 | Oui (disponibles aussi à la source) |

Nova Drift sert donc d'**inspiration** : lisibilité d'un jeu très chargé en effets, géométrie vectorielle lumineuse, sobriété des HUD. Aucun asset n'en est copié.

---

## 2. YouTube Music et analyse audio : ce qui est réellement possible

### 2.1 Le problème

- Le lecteur officiel est une **iframe `youtube.com` d'une autre origine** : la page qui l'héberge ne peut ni lire son DOM ni brancher son son dans son propre graphe Web Audio (politique de même origine).
- Le son ne passe jamais par notre `AudioContext` : `AnalyserNode`, `AudioWorklet` ou `MediaElementSource` côté application **ne voient rien**.
- Le flux est en MSE (blob) servi par `googlevideo.com` : le télécharger ou le ré-extraire est interdit (conditions YouTube et exigence du projet).
- Les règles YouTube interdisent le lecteur invisible (< 200×200 px ou masqué) et la séparation audio/vidéo (Chud Music §6).

### 2.2 Les solutions étudiées

| Approche | Fonctionne ? | Respecte vos exigences ? | Verdict |
|---|---|---|---|
| Analyse dans **notre** page (Web Audio) | ❌ le son n'y est pas | — | impossible |
| **Script injecté dans la frame YouTube** (Electron `webFrameMain`) : `video.captureStream()` → `AudioContext` local à la frame → FFT → **mesures** envoyées à l'application | ✅ prouvé par le spectre YouTube de Chud Music | ✅ copie relié à rien : lecture, volume, sortie inchangés ; aucun échantillon ne sort de la frame | **retenu (bureau)** |
| Retarder le son du lecteur (ligne à retard dans la frame) pour « voir le futur » | ✅ techniquement | ❌ modifie la lecture officielle (son décalé de l'image) | écarté |
| Capture du son système (loopback WASAPI / moniteur PipeWire) | ✅ | ⚠️ capte tout le PC (notifications…), permissions | secours possible, non prioritaire |
| **Capture d'onglet autorisée** (`getDisplayMedia` avec audio, l'utilisateur choisit l'onglet) | ✅ Chrome/Edge | ✅ consentement explicite | **retenu (navigateur)** |
| Télécharger / extraire l'audio | ✅ | ❌ interdit | écarté |
| API officielle YouTube Data | métadonnées seulement | ✅ | option navigateur (clé saisie par l'utilisateur) |

**Contenus protégés** : Electron n'embarque pas Widevine, YouTube sert donc au lecteur intégré des flux non chiffrés ; `captureStream` y fonctionne. Un contenu chiffré ne serait de toute façon pas lisible.

### 2.3 Conséquence : deux modes, et un troisième qui les réconcilie

| | Mode A — temps réel | Mode B — analyse préalable | « Apprentissage » YouTube |
|---|---|---|---|
| Source | YouTube (ou un fichier, pour comparaison) | fichiers locaux | YouTube, 2ᵉ partie et suivantes |
| Connaissance du futur | **aucune** : prédiction | totale | totale (mesures de la 1ʳᵉ écoute) |
| Précision rythmique | bonne sur musique régulière, faible sur rubato/ruptures | excellente | excellente |
| Structure (refrains, ponts) | détectée a posteriori | détectée avant de jouer | détectée avant de jouer |
| Reproductibilité | non | oui (graine déterministe) | oui |
| Démarrage | ~6 s d'« acquisition du signal » | immédiat (≈ 1 s d'analyse, puis cache) | immédiat |
| Limites | ruptures soudaines (break, silence) imprévisibles → notes « fantômes » dissoutes sans pénalité | durée de décodage pour les très longs fichiers | la 1ʳᵉ partie doit aller au bout (ou presque) |

---

## 3. Comparaison des moteurs

Critère éliminatoire n° 1 : **héberger le lecteur officiel YouTube** (iframe Chromium) et lire ses mesures audio.
Critère éliminatoire n° 2 (nouveau) : **tourner aussi dans un navigateur**.

| | Godot 4 | Unity 6 | Unreal 5 | Electron + React + Three.js | Electron + PixiJS | Rust natif (wgpu/Bevy + cpal) |
|---|---|---|---|---|---|---|
| 1. Avantages | moteur libre, léger, export simple, bon 2D/3D | écosystème énorme, `AudioSettings.dspTime` | rendu haut de gamme | Chromium identique partout, lecteur YouTube éprouvé, réutilisation directe de Chud Music, shaders GLSL, React pour l'UI | batch 2D très rapide | latence audio minimale, binaire léger |
| 2. Limites | **aucun navigateur web intégré** (plugins CEF/wry tiers) ; export Web sans accès YouTube | webview payante (Vuplex), licences, éditeur lourd | démesuré, ~500 Mo, navigateur CEF ancien | mémoire (~300–500 Mo), GC JavaScript à maîtriser | pas de 3D (planètes, perspective) | aucune webview Chromium sous Linux (wry = WebKitGTK), tout le catalogue/bloqueur à réécrire |
| 3. Performances | excellentes | excellentes | excellentes | **très bonnes** si rendu instancié et zéro allocation par image | excellentes en 2D | excellentes |
| 4. Audio | AudioServer, bon | DSP, bon | MetaSounds | Web Audio : horloge échantillon-exacte, `getOutputTimestamp`, AudioWorklet | idem (Web Audio) | WASAPI/ALSA direct |
| 5. Synchronisation | `get_time_since_last_mix` + latence : très bonne | très bonne | bonne | **très bonne** : horloge audio + `event.timeStamp` des entrées | idem | excellente |
| 6. Intégration Chud Music | nulle (GDScript/C#) + passerelle IPC à écrire | nulle | nulle | **directe** (même pile : TS, Electron 45, youtubei.js, Ghostery) | directe | nulle |
| 7. Windows / Linux | ✅ / ✅ | ✅ / ✅ | ✅ / ⚠️ | ✅ / ✅ (même Chromium) | ✅ / ✅ | ✅ / ✅ |
| 7 bis. Navigateur / macOS | export Web limité / ✅ | WebGL limité / ✅ | ❌ / ✅ | **✅ / ✅** | ✅ / ✅ | WASM possible / ✅ |
| 8. Maintenance | bonne | moyenne (licences) | lourde | bonne (un seul langage partout) | bonne | lourde |
| 9. Complexité de développement | élevée (deux mondes + IPC YouTube) | élevée | très élevée | **moyenne** | moyenne | très élevée |
| 10. Évolution | bonne | bonne | bonne | éditeur, partage de cartes, mobile (navigateur tactile), WebGPU | 2D seulement | bonne |

**Architecture hybride (Electron pour la musique + Godot pour le jeu)** : deux processus, deux fenêtres ou une texture partagée, une horloge transmise par IPC (gigue de plusieurs ms), deux chaînes de compilation, et toujours rien pour le navigateur. Elle n'apporte rien que Three.js ne fasse pas ici.

**Recommandation : TypeScript + Three.js (WebGL2) + React, dans Electron pour le bureau et tel quel dans le navigateur.**
Le jeu affiche quelques centaines de notes instanciées, des particules et des shaders plein écran : une charge qu'un GPU intégré tient à 120 i/s en WebGL2 si le rendu est conçu pour (une seule passe d'instances, positions calculées dans le *vertex shader* à partir de l'horloge, aucune allocation par image). PixiJS serait aussi rapide en 2D, mais l'univers astronomique (planètes, anneaux, éclipses, parallaxe) et la piste en perspective demandent de la 3D.

---

## 4. Stratégie multiplateforme

```
            ┌───────────────────────── cœur portable (TypeScript) ─────────────────────────┐
            │ analyse audio · génération des notes · temps réel · score · progression       │
            │ rendu Three.js (cosmos + piste) · interface React · entrées · horloges        │
            └──────────────────────────────┬───────────────────────────────────────────────┘
                                           │ interface Platform (capacités déclarées)
                 ┌─────────────────────────┴─────────────────────────┐
     adaptateur Electron (Windows, Linux, macOS)          adaptateur Web (navigateur, PWA)
     · recherche YouTube Music (youtubei.js)              · fichiers locaux (sélecteur, glisser-déposer)
     · lecteur officiel + analyse dans la frame           · YouTube par lien collé (+ recherche avec clé
     · bloqueur Ghostery (listes uBO)                       API Data, facultative)
     · FFmpeg (ALAC, WMA, AIFF…)                          · analyse YouTube par capture d'onglet (Chrome/Edge)
     · bibliothèque et playlists de Chud Music            · formats décodables par le navigateur
     · dossiers locaux scannés                            · stockage IndexedDB
```

| Plateforme | Statut visé | Ce qui manque par rapport au bureau |
|---|---|---|
| Windows 10/11 | complet, installeur + portable | — |
| Linux | complet, AppImage + .deb + .rpm | — |
| macOS | code complet ; construction sur un Mac ou un runner GitHub macOS (signature Apple exigée) | non testé ici (pas de Mac) |
| Navigateur (Chrome, Edge, Firefox, Safari) | jouable avec fichiers locaux | pas de recherche YouTube Music sans clé ; analyse YouTube seulement avec capture d'onglet (Chrome/Edge) ; pas de bloqueur ; pas de FFmpeg (ALAC/WMA/AIFF selon navigateur) |

---

## 5. Architecture détaillée

### 5.1 Arborescence

```
src/
  core/                  100 % portable, sans DOM ni Node, testé sous Node
    analysis/            fft, extracteur de trames (partagé avec la frame YouTube), onsets,
                         tempo & battements, structure (sections, intensité, répétitions)
    chart/               génération (sélection, notes longues, accords, colonnes, équité)
    live/                prédicteur temps réel (Mode A)
    game/                jugement, score, combo, précision, énergie, rangs
    progress/            XP, niveaux, succès
  main/                  Electron : fenêtre, protocole, FFmpeg, bibliothèque, pont Chud Music
    chud/                modules repris de Chud Music (lecteur YouTube, catalogue, bloqueur)
  preload/               pont IPC (window.ct) + canal du lecteur YouTube
  renderer/src/
    platform/            interface Platform + adaptateurs electron / web
    audio/               horloge, lecteur local (AudioBuffer), moteur YouTube, sons d'interface
    gfx/                 univers (nébuleuse, étoiles, planète, lunes, anneaux, galaxie, comètes,
                         astéroïdes, distorsion), piste de jeu, particules, post-traitement
    game/                session de jeu, entrées (clavier, souris, tactile, manette), HUD
    pages/ components/ store/
  workers/               analyse hors ligne (Web Worker)
tests/   unit (Node, sans application) · e2e (Playwright sur la vraie application Electron)
```

### 5.2 Communications

| De → vers | Canal | Contenu |
|---|---|---|
| Interface → main | `ipcRenderer.invoke` (pont `window.ct`) | recherche, bibliothèque, décodage FFmpeg, réglages bloqueur, fenêtre |
| Interface → lecteur YouTube | `webview.send('yt-cmd')` | charger, jouer, pause, saut, volume, vitesse |
| Frame YouTube → interface | `postMessage` → page du lecteur → `sendToHost` | **trames de mesures** (8 bandes × flux/énergie, chroma, horodatage média) + paires d'horloge |
| Interface → worker d'analyse | `postMessage` (tampons transférés) | signal mono → analyse complète |
| Session de jeu → rendu | mémoire partagée (tableaux typés) | notes visibles, états, effets |

---

## 6. Audio et synchronisation

### 6.1 Horloges

- **Fichiers locaux** : le morceau est décodé entièrement (`decodeAudioData`, ou FFmpeg → FLAC puis décodage) et joué par un `AudioBufferSourceNode`. Temps du morceau entendu à l'instant `T` (horloge `performance.now`) :
  `t = (contextTime + (T − performanceTime)) − départ`, avec `{contextTime, performanceTime} = ctx.getOutputTimestamp()` : la latence de sortie annoncée par le système est donc déjà comptée.
- **YouTube** : la frame envoie ~60 fois/s des paires (`video.currentTime`, horloge de la frame). L'écart entre l'horloge de la frame et celle de l'interface est mesuré par aller-retour (style NTP, on garde les échanges les plus rapides). Une régression glissante donne une horloge continue, lissée, sans sauts.
- **Rendu** : chaque image calcule `t` pour l'instant où elle sera affichée (horodatage `requestAnimationFrame` + décalage visuel).
- **Entrées** : chaque appui est daté par `event.timeStamp` (clavier, souris, tactile) ou `gamepad.timestamp` : le jugement ne dépend **pas** de la fréquence d'images.
- **Compensation utilisateur** : décalage audio (ms) et décalage visuel (ms), réglables, par sortie audio ; **calibration automatique** (taper en rythme sur 16 battements, médiane robuste des écarts).
- **Écrans 120/144/240 Hz** : `requestAnimationFrame` suit la fréquence de l'écran ; aucune logique ne dépend du nombre d'images.

### 6.2 Fenêtres de jugement

| Jugement | Fenêtre | Précision comptée |
|---|---|---|
| Perfect | ±45 ms | 100 % |
| Great | ±90 ms | 70 % |
| Good | ±135 ms | 40 % |
| Miss | au-delà, ou note non jouée | 0 % |

(+15 % en Easy.) Note longue : tête jugée comme une note ; relâcher plus de 150 ms avant la fin casse le combo.

---

## 7. Génération des notes (le cœur du projet)

### 7.1 Extraction (identique hors ligne, dans le worker, et en direct, dans la frame YouTube)

Trames de 2048 échantillons, pas de 512 (≈ 10,7 ms à 48 kHz), fenêtre de Hann, FFT.
Par trame : **8 bandes** (sub 20–60 Hz, grosse caisse 60–150, basses 150–400, médiums 400–1 k, haut-médium 1–2,5 k, présence/caisse claire 2,5–6 k, cymbales 6–12 k, air 12–20 k) : énergie logarithmique et **flux spectral « SuperFlux »** (compression log, filtre max en fréquence contre le vibrato) ; **chroma** 12 classes ; centroïde ; planéité (bruit vs son tonal).

### 7.2 Analyse hors ligne

1. **Fonction de détection** pondérée (grosse caisse, caisse claire, cymbales, tonal) normalisée par la dynamique locale.
2. **Transitoires** : pic local + seuil adaptatif (moyenne glissante + δ) + délai minimal. Chaque transitoire reçoit une force, une **classe** (grosse caisse / caisse claire / cymbale / tonal), une **tenue** (stabilité de l'énergie après l'attaque) et une hauteur (chroma dominant).
3. **Tempo** : autocorrélation + harmoniques, a priori log-gaussien centré sur 120 BPM (lève l'ambiguïté du double/moitié).
4. **Battements** : programmation dynamique (Ellis 2007) puis **ajustement linéaire par morceaux** de la grille (précision sub-milliseconde sur la musique produite au clic, souplesse sur le reste). Détection de changement de tempo par segments.
5. **Premier temps** des mesures (4/4) : grosse caisse + changements harmoniques.
6. **Structure** : matrice d'auto-similarité par mesure (chroma + timbre), nouveauté → sections, regroupement → refrains (section répétée la plus intense), **source de répétition** de chaque mesure.
7. **Intensité** par mesure (sonie, densité de transitoires, aigus), normalisée sur le morceau.

### 7.3 De l'analyse aux notes

1. **Grille** : croches, doubles croches, triolets (détectés par section).
2. **Candidats** : transitoires calés sur la grille (tolérance proportionnelle à la subdivision) ; temps forts sans transitoire en appoint faible (passages calmes réguliers).
3. **Saillance** = force × poids métrique (1er temps > temps > croche > double) × classe × intensité.
4. **Densité cible par mesure** = f(difficulté, intensité de la section) : les passages calmes s'éclaircissent, les refrains s'intensifient.
5. **Notes longues** : sons tenus (tonal + tenue), longueur calée sur la grille ; nappes sans attaque → longues notes.
6. **Accords** : attaques larges (grosse caisse + crash), 1ers temps intenses, débuts de section.
7. **Colonnes** : coût minimal (aléa déterministe) combinant contour mélodique (la hauteur monte → vers la droite), préférence instrumentale douce (grosse caisse à gauche, caisse claire à droite), équilibre des mains, anti-répétition (n-grammes), **réutilisation du motif de la mesure similaire** (un riff qui revient → le même motif), escaliers/trilles dans les rafales de cymbales.
8. **Vérification d'équité** : écart minimal par colonne (« jacks »), notes par seconde glissantes, mains (2 doigts max en Easy/Normal), notes pendant une note longue, entrée de jeu ≥ 2 s.

### 7.4 Difficultés

| | Easy | Normal | Hard | Expert | Custom |
|---|---|---|---|---|---|
| Subdivision la plus fine | noire | croche | double | double + triolets | réglable |
| Écart min. (toutes colonnes) | 300 ms | 170 ms | 115 ms | 85 ms | réglable |
| Écart min. même colonne | 450 ms | 260 ms | 170 ms | 120 ms | réglable |
| Notes/s max (fenêtre 1 s) | 3,5 | 5,5 | 8 | 12 | réglable |
| Accords | — | rares | oui | fréquents (+ triples rares) | réglable |
| Notes longues | simples, exclusives | oui | avec notes de l'autre main | libres | réglable |

### 7.5 Temps réel (Mode A)

Mêmes trames, flux continu. Tempo réestimé toutes les 0,5 s avec hystérésis ; phase verrouillée (boucle à verrouillage de phase) ; **mémoire des 8 dernières mesures sur une grille de 16 cases** : la mesure à venir est prédite comme une combinaison des mesures −1, −2 et −4, pondérées selon celle qui a le mieux prédit les dernières. Notes engagées à l'horizon (durée d'approche + marge), jamais retirées une fois visibles. **Notes fantômes** : une note prédite que la musique ne confirme pas (aucune attaque à ±70 ms) se dissout ; la manquer ne coûte rien. Confiance faible (pas de pulsation) → **mode sans échec** : notes rares sur la pulsation la plus probable et notes longues sur les nappes.

---

## 8. Score, progression

Score par note (Perfect 1000 / Great 700 / Good 350) × multiplicateur de combo (×1, ×2 à 25, ×3 à 50, ×4 à 100). Précision pondérée. Rangs SS (≥ 99 % et full combo), S, A, B, C, D. Jauge d'énergie (échec possible, désactivable). Records par morceau × difficulté, historique, classement personnel (10 meilleures parties), XP et niveaux, succès, statistiques.

---

## 9. Direction artistique

Univers astronomique **procédural** (shaders, aucun GIF ni vidéo) : nébuleuse en bruit fractal déformé, trois couches d'étoiles en parallaxe qui scintillent, constellations qui se tracent, planète à surface et atmosphère animées avec anneaux et lunes en orbite, éclipses, galaxie spirale, comètes, ceinture d'astéroïdes instanciée, poussières. Chaque page est un **lieu** de cet univers ; changer de page = voyage (distorsion des étoiles). En jeu : la nébuleuse et les étoiles suivent l'intensité, les basses font respirer l'atmosphère de la planète, les combos déclenchent des phénomènes (anneau de supernova, aurore). Palette : nuit profonde, violet, bleu, cyan, magenta, or en accent rare. Sobriété : effets discrets hors jeu, réglables (complets / réduits / minimum).

---

## 10. Performances

- Notes : **une seule** `InstancedMesh`, positions calculées dans le *vertex shader* à partir de l'heure du morceau ; le processeur ne touche que les notes qui entrent ou sortent.
- Aucune allocation par image dans la boucle de jeu (tableaux typés réutilisés).
- Nébuleuse rendue à résolution réduite ; bloom à demi-résolution ; qualité adaptative si une image dépasse le budget.
- Analyse hors ligne dans un Web Worker ; analyse YouTube dans la frame YouTube (autre processus).
- Univers ralenti (30 i/s) dans les menus inactifs, pleine fréquence en jeu.

---

## 11. Stratégie de tests

| Niveau | Quoi | Comment |
|---|---|---|
| Unitaires (Node, sans app) | tempo et battements sur signaux synthétiques à BPM connus (90–174, swing, changement de tempo), précision de la grille, transitoires, équité des cartes (aucune violation des règles), déterminisme, temps réel sur fichier simulé, score et rangs | `npm run test:unit` |
| Synchronisation | horloge locale vs `getOutputTimestamp` ; latence de capture de la frame mesurée sur un clic connu | e2e Playwright |
| Application réelle | jeu complet au clavier simulé (événements datés), souris, manette virtuelle, pause/reprise, changement de morceau, fichiers de chaque format | e2e Playwright (`_electron`) |
| En ligne | recherche YouTube Music, lecture, analyse en direct, apprentissage, bloqueur | `npm run test:online` |
| Performances | images/s et pire image pendant le jeu + analyse | e2e |

---

## 12. Risques principaux

| Risque | Impact | Parade |
|---|---|---|
| YouTube change son lecteur intégré ou refuse la lecture (« confirmez que vous n'êtes pas un robot ») | lecture YouTube impossible | détection reprise de Chud Music, message clair ; les fichiers locaux restent jouables |
| `captureStream` refusé ou muet dans la frame | pas d'analyse YouTube | détection (niveaux nuls), bascule sur un mode « pulsation » + saisie du tempo au tapotement |
| Prédiction temps réel fausse sur musique irrégulière | notes mal placées | notes fantômes, mode sans échec, carte apprise dès la 2ᵉ partie |
| Latence variable (Bluetooth) | décalage | calibration par sortie audio |
| Catalogue non officiel (InnerTube) cassé | plus de recherche | coller un lien fonctionne toujours (lecture par le lecteur officiel) |
| Mémoire des longs fichiers décodés | > 400 Mo pour 20 min | morceaux > 15 min : lecture en flux + analyse par blocs |
| Blocage des publicités contraire aux règles YouTube | avertissements, refus | interrupteur, comme dans Chud Music (risque déjà accepté pour Chud Music) |

---

## 13. Ordre de développement

1. Cœur portable testé (analyse, génération, score) sur signaux synthétiques et vrais fichiers.
2. Rendu (univers + piste) et **premier jeu jouable** sur fichier local, synchronisation vérifiée.
3. Electron : lecteur YouTube + analyse dans la frame + temps réel + apprentissage, bloqueur, recherche, bibliothèque Chud Music.
4. Interface complète, progression, réglages, calibration, entraînement, version navigateur.
5. Tests complets, paquets, documentation, bilan.
