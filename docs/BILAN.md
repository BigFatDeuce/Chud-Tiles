# Chud Tiles 1.0.0 — Bilan

> 23 novembre 2026. Ce qui a été livré, ce qui est vérifié et comment, et les limites connues, sans enjoliver.
> Détails techniques : [DOC-TECHNIQUE.md](DOC-TECHNIQUE.md) · guide : [GUIDE-UTILISATEUR.md](GUIDE-UTILISATEUR.md) / [USER-GUIDE.md](USER-GUIDE.md).

---

## 1. Livrables

| Fichier | Taille | Pour |
|---|---|---|
| `dist/Chud-Tiles-Setup-1.0.0.exe` | ~126 Mo | Windows 10/11, installeur français/anglais |
| `dist/Chud-Tiles-1.0.0-Portable.exe` | ~114 Mo | Windows sans installation |
| `dist/Chud-Tiles-1.0.0-x86_64.AppImage` | ~142 Mo | Linux, toutes distributions |
| `dist/Chud-Tiles-1.0.0-x86_64.tar.gz` | ~135 Mo | Linux, archive |
| `dist-web/` | ~1,8 Mo | version navigateur (site statique) |
| Code, tests, scripts, documentation | ~16 000 lignes TypeScript, ~2 000 lignes de tests et scripts | — |

Chud Music n'a pas été modifié : ses sources et son application installée ont seulement été lues (étude, FFmpeg copié à l'empaquetage, bibliothèque lue en lecture seule).

---

## 2. Le cahier des charges, point par point

| Demande | État | Vérifié par |
|---|---|---|
| Jeu à colonnes : frappes, notes longues, accords, rafales, zone de frappe, pénalités, précision récompensée | ✅ 3 à 7 colonnes | tests unitaires (jugement, cadences, fenêtres), e2e (parties réelles) |
| Clavier, souris, manette configurables, tactile | ✅ | clavier et souris en e2e ; manette et tactile : code présent, **non couverts par les tests automatiques** (pas de manette virtuelle ni d'écran tactile dans l'environnement de test) |
| Génération automatique synchronisée depuis YouTube Music | ✅ | e2e en ligne `youtube` (recherche, lecteur officiel, analyse dans la frame, partie en direct, apprentissage) |
| Mode A temps réel + Mode B analyse préalable, comparés | ✅ + apprentissage qui réconcilie les deux | tests unitaires (alignement mesuré), DOC-TECHNIQUE §4 |
| Grosse caisse / caisse claire / cymbales vers les colonnes, accords, notes longues, densité selon calmes et refrains, tempo, équité, répartition | ✅ | tests unitaires (équité sans violation, déterminisme, niveaux croissants) |
| Lecteur officiel YouTube, sans téléchargement, sans extraction, sans contournement | ✅ | architecture (analyse de mesures dans la frame, capture d'onglet consentie dans le navigateur) |
| Bloqueur de publicités de Chud Music, même principe et configuration | ✅ mêmes listes uBlock Origin, session du lecteur seulement | e2e `radio` (réglages du bloqueur), `smoke` (état lisible) |
| Recherche, sélection, lecture/pause/reprise, suivant, volume, titre/artiste, playlists | ✅ | e2e `radio`, `youtube` |
| Fichiers locaux MP3, FLAC, WAV, OGG, OPUS, AAC, M4A, AIFF, WMA, originaux intacts, analyse en cache | ✅ (+ ALAC) | e2e `formats` : 10 fichiers ouverts par leur chemin, tempo juste, empreintes SHA-256 et dates identiques avant/après |
| Facile, Normal, Difficile, Expert, Personnalisé | ✅ | tests unitaires (niveaux 1 à 17 croissants) |
| Score, combo, précision, classement personnel, historique, records, succès, progression | ✅ 22 succès, 8 grades | tests unitaires (progression, succès, séries), e2e |
| Interface station spatiale rétro-moderne, astronomie vivante | ✅ univers entièrement procédural | captures d'écran des tests |
| Synchronisation précise, compensation réglable | ✅ calibration son + image, décalages audio / visuel / YouTube, correction proposée après partie | tests unitaires (jugement indépendant de la cadence), e2e |
| 60 i/s minimum, 120+ si possible | ✅ cadence libre jusqu'à la fréquence de l'écran | compteur d'images intégré ; voir limites §4 |
| Windows installeur + portable, Linux AppImage, application de bureau | ✅ | §5 |
| Jouable partout : Windows, Linux, navigateur, macOS | ✅ Windows, Linux, navigateur · ⚠️ macOS configuré, non construit | §5 |
| Calibration, entraînement, ralenti, section en boucle, mode sans échec, cache, éditeur de partitions | ✅ | e2e `editor`, `safe`, tests de l'entraînement dans `editor` |
| Français et anglais au minimum | ✅ 561 textes traduits, sélecteur, messages du système traduits | `test:i18n`, test unitaire, e2e `lang` (aucun texte français restant en anglais, sélecteur), e2e `web` |

---

## 3. Résultats des tests (23/11/2026)

| Suite | Résultat |
|---|---|
| Vérification TypeScript | 0 erreur |
| Unitaires (`test:unit`) | **42/42** |
| Traductions (`test:i18n`) | 561 textes, 0 sans anglais |
| `smoke` | 5/5 |
| `formats` | 11/11 |
| `editor` | 12/12 |
| `lang` | 7/7 |
| `safe` | 9/9 |
| `radio` (en ligne) | 14/14 |
| `youtube` (en ligne) | 9/9 |
| `web` (navigateur) | 5/5 |
| `web-youtube` (navigateur, en ligne) | 7/7 |
| Application Windows empaquetée (`CT_EXE`) : `smoke`, `formats`, `lang`, `safe` | 5/5, 11/11, 7/7, 9/9 |
| Application Linux empaquetée (WSL, `scripts/linux-tests.sh`) : mêmes suites | 5/5, 11/11, 7/7, 9/9 |

Mesures (morceaux synthétiques, vérité connue) : tempo à ±0,2 BPM de 87 à 140 BPM et en swing ; erreur moyenne des battements 2,8 à 7,9 ms ; premiers temps justes 88 à 96 % ; analyse ≈ 0,35 s par minute de musique ; Mode A : 84 à 96 % des notes à moins de 25 ms d'une vraie attaque, premières notes après 8 à 12 s ; prédicteur ≈ 30 µs par trame.

---

## 4. Limites connues

**Plateformes**
- **macOS** : configuration prête (`npm run dist:mac`, icône ICNS), mais rien n'a encore été construit ni testé sur un Mac. Une application non signée demandera « Ouvrir quand même » ; la signature et la notarisation Apple exigent un compte développeur.
- **Windows** : installeur et exécutable **non signés** → avertissement SmartScreen au premier lancement.
- **Linux** : AppImage, .tar.gz, .deb et .rpm (les deux derniers construits depuis que `package.json` a une adresse `homepage`) ; les tests empaquetés tournent sur l'AppImage.
- **Navigateur** : pas de recherche YouTube Music (lien collé seulement), pas de bloqueur, pas de FFmpeg (WMA, ALAC et certains AIFF illisibles), analyse de YouTube seulement dans Chrome/Edge avec le partage de l'onglet. Il doit être servi en HTTPS (ou `localhost`).

**YouTube**
- La recherche passe par le catalogue non officiel de YouTube Music (`youtubei.js`, comme Chud Music) : un changement chez YouTube peut la casser ; coller un lien continue de fonctionner.
- YouTube peut demander une connexion, refuser une vidéo dans les lecteurs intégrés, ou servir un contenu protégé que l'analyse ne peut pas entendre : un message l'explique.
- Le bloqueur de publicités va contre les conditions de YouTube (comme dans Chud Music) ; il se coupe d'un interrupteur.
- **Mode A** : sur une musique irrégulière (rubato, ruptures, breaks), des notes prédites peuvent ne pas correspondre (elles se dissolvent sans pénalité) ; les premières notes arrivent après ~10 s. La partition apprise ensuite n'a pas ces défauts.

**Qualité des partitions**
- Les mesures chiffrées viennent de morceaux synthétiques dont la vérité est connue, et des parties réelles des tests en ligne. Il n'y a pas eu d'évaluation sur un large corpus de vraie musique de tous genres : le ressenti (densité, choix des colonnes) mérite d'être ajusté avec vos retours de jeu.

**Performances et matériel**
- Les tests tournent dans une fenêtre invisible, où le navigateur limite les images : ils vérifient le bon fonctionnement, pas les images par seconde réelles. Le compteur d'images (Réglages › Affichage) montre les i/s et la pire image sur votre machine.
- Manette et tactile : implémentés, non testés automatiquement.
- Un fichier très long (> 15–20 min) est décodé entièrement en mémoire (plusieurs centaines de Mo).
- Le mode sans échec dessine sur le processeur : jouable, mais plus lent sur un écran à haute résolution.

---

## 5. Constructions

| Cible | Commande | Résultat |
|---|---|---|
| Windows | `npm run dist:win` | installeur + portable ; l'application empaquetée passe `smoke`, `formats`, `lang`, `safe` (32/32) |
| Linux | `node scripts/prepare-dist.mjs linux` puis `scripts/linux-dist.sh` (WSL) | AppImage, .tar.gz, .deb, .rpm ; l'application empaquetée passe les mêmes suites sous WSLg (32/32), FFmpeg Linux compris |
| Navigateur | `npm run web:build` | `dist-web/` ; `web` 5/5, `web-youtube` 7/7 |
| macOS | `npm run dist:mac` | non construit |
