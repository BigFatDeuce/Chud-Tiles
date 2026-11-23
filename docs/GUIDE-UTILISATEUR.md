# Chud Tiles — Guide du joueur

> English version: [USER-GUIDE.md](USER-GUIDE.md)

Chud Tiles transforme votre musique en partition : des notes descendent le long de colonnes vers une ligne lumineuse ; tapez la touche de la colonne au moment où la note touche la ligne. La partition n'est pas écrite à la main : elle naît de l'écoute du morceau (battements, grosse caisse, caisse claire, cymbales, sons tenus, refrains).

---

## 1. Installer

| Système | Fichier | Remarques |
|---|---|---|
| Windows 10/11 | `Chud-Tiles-Setup-1.0.0.exe` | installeur en français ou en anglais (selon Windows), choix du dossier, raccourcis menu Démarrer et bureau. La désinstallation garde votre profil. |
| Windows, sans installation | `Chud-Tiles-1.0.0-Portable.exe` | se lance directement (clé USB…). Le profil est le même que la version installée. |
| Linux | `Chud-Tiles-1.0.0-x86_64.AppImage` | rendre exécutable (`chmod +x`) puis lancer. Aussi : `Chud-Tiles-1.0.0-x86_64.tar.gz` (décompresser, lancer `chud-tiles`), `Chud-Tiles-1.0.0-amd64.deb` (Debian, Ubuntu…) et `Chud-Tiles-1.0.0-x86_64.rpm` (Fedora, openSUSE…), à installer avec le gestionnaire de paquets. |
| Navigateur | le dossier `dist-web` publié sur un site (HTTPS) | Chrome ou Edge recommandés. Voir §8. |

Windows peut afficher « Windows a protégé votre ordinateur » (application non signée) : « Informations complémentaires » › « Exécuter quand même ».

**Vos données** : profil, records, archives et analyses restent sur l'ordinateur (`%APPDATA%\Chud Tiles` sous Windows, `~/.config/Chud Tiles` sous Linux). Vos fichiers audio ne sont **jamais copiés ni modifiés**.

---

## 2. Premier lancement

1. **Langue** : Réglages › Jeu › Langue (Auto suit la langue du système).
2. **Calibration** (2 minutes, fortement conseillée, indispensable avec un casque Bluetooth) : Réglages › Audio et synchro › Calibrer.
   - *Le son* : tapez sur chaque clic en écoutant seulement. Le jeu mesure le retard de votre sortie audio.
   - *L'image* : sans son, tapez quand chaque note touche la ligne. Le jeu mesure le retard de votre écran.
3. Ouvrez un morceau : **Jouer un fichier**, **glisser-déposer** un fichier n'importe où dans la fenêtre, ou la salle **YouTube**.

---

## 3. Les salles

| Salle | Rôle |
|---|---|
| **Pont** | accueil : derniers morceaux joués, votre niveau, ouvrir un fichier ou un lien. |
| **Archives** | vos morceaux : fichiers, dossiers de musique surveillés, import de la bibliothèque Chud Music, favoris, tri, recherche. Retirer un morceau ne supprime jamais le fichier. |
| **YouTube** (salle radio) | recherche YouTube Music (titres, vidéos, albums, playlists), suggestions, lien collé, *radio* (morceaux proches à la suite), enregistrement d'un album ou d'une playlist dans Listes. |
| **Listes** | vos listes, les albums/playlists enregistrés, les listes de Chud Music (lues, jamais modifiées). Une liste se joue à la suite : l'écran des résultats propose le morceau suivant. |
| **Carnet** | niveau et grade d'équipage, statistiques, classement personnel par difficulté, historique, succès. |
| **Réglages** | jeu, commandes, audio et synchro, affichage, YouTube, données, à propos. |

---

## 4. Avant de jouer : la page du morceau

- **Structure** : la carte d'intensité du morceau, ses sections, les refrains en or.
- **Difficulté** : Facile, Normal, Difficile, Expert, Personnalisé — chaque carte indique le nombre de notes, les notes par seconde, les notes longues, les accords et un niveau de 1 à 20.
- **Colonnes** : 3 à 7.
- **Vitesse de défilement** : temps pendant lequel une note est visible (plus court = plus rapide).
- **Échec possible** : la partie s'arrête quand l'énergie tombe à zéro (désactivable).
- **Entraînement** : vitesse de la musique (50, 65, 75, 90 ou 100 % ; 50, 75 ou 100 % pour YouTube), une section, en boucle. Les parties d'entraînement ne comptent pas pour les records.
- **Personnalisé** : densité, subdivisions (noires → doubles croches), accords, notes longues, écart minimal entre deux notes, fenêtres de jugement.
- Boutons : **Jouer** (Entrée), **Aperçu** (l'œil : la partition se joue toute seule), **Atelier** (le crayon : modifier la partition).

L'analyse d'un fichier prend environ une seconde par minute de musique, une seule fois : elle est ensuite gardée en cache.

---

## 5. Jouer

| Action | Clavier (défaut) | Manette | Souris / tactile |
|---|---|---|---|
| Colonnes, 4 colonnes | 1 2 3 4, rangée du haut du clavier (ou ← ↓ ↑ →) | croix et gâchettes à gauche, boutons et gâchettes à droite | toucher la colonne |
| Colonnes, 3 / 5 / 6 / 7 | 1 2 3 · 1 à 5 · 1 à 6 · 1 à 7 | idem | idem |
| Pause | Échap | Start | bouton pause en bas à droite |
| Recommencer | Retour arrière (⌫) | — | menu pause |

Toutes les touches et tous les boutons se changent dans Réglages › Commandes (une configuration par nombre de colonnes). **Touches sous les pistes** (même onglet) écrit la touche ou le bouton de chaque colonne sous la ligne de frappe pendant la partie : clavier, manette, ou *Auto* (le dernier utilisé).

**Les notes** : simple (taper), **longue** (maintenir jusqu'au bout ; lâcher avant casse le combo), **accord** (plusieurs colonnes en même temps).

**Jugements** : Parfait (±45 ms), Super (±90 ms), Bien (±135 ms), Raté. En Facile les fenêtres sont 15 % plus larges. « TÔT » / « TARD » s'affichent sous le jugement quand une note n'est pas parfaite (désactivable).

**Score** : Parfait 1 000, Super 700, Bien 350, multiplié par le combo (×2 dès 25, ×3 dès 50, ×4 dès 100). **Rangs** : SS (≥ 99 % sans aucun raté), S (95 %), A (90 %), B (80 %), C (70 %), D.

**Pause** : reprendre, recommencer, ajuster le décalage audio de ±5 ms si les notes semblent en avance ou en retard, quitter.

**Résultats** : score, précision, combo maximal, détails des jugements, courbe de précision du rythme (vos appuis sont-ils en avance ou en retard en moyenne ? un bouton applique la correction proposée), record, XP gagnée, succès obtenus, rejouer, changer de difficulté, morceau suivant de la file.

---

## 6. YouTube Music

Deux façons de jouer un morceau YouTube (Réglages › YouTube › Lecture des morceaux YouTube) :

1. **Télécharger le son** (par défaut, application de bureau) : le son est téléchargé une fois avec [yt-dlp](https://github.com/yt-dlp/yt-dlp), puis joué et analysé comme un fichier : partition complète dès la première partie, pas de publicité, pas de saccade. yt-dlp s'installe tout seul au premier morceau (dans le profil de Chud Tiles). Les morceaux téléchargés se suppriment dans Réglages › YouTube. Attention : télécharger va à l'encontre des conditions d'utilisation de YouTube (usage personnel, à vos risques).
2. **Lecteur officiel en direct** : la musique est jouée par le lecteur officiel YouTube, visible dans un coin pendant la partie ; rien n'est téléchargé. C'est aussi le secours automatique si un téléchargement échoue. Le lecteur précharge environ 30 s de musique avant la partie pour éviter les saccades.

Avec le lecteur officiel :

- **Première rencontre** d'un morceau : deux choix.
  - **Jouer en direct** (mode A) : les notes sont écrites pendant l'écoute, avec un peu d'avance (prédiction du rythme). Les premières secondes servent à « capter le signal ». Une note prédite que la musique ne confirme pas se dissout : la manquer ne coûte rien.
  - **Écouter d'abord** : le morceau joue une fois (vous pouvez faire autre chose), puis la station connaît toute la chanson : partition complète, refrains, notes longues, comme pour un fichier.
- Après une partie en direct jouée jusqu'au bout, le morceau est **appris** : la partie suivante a la partition complète.
- Réglages › YouTube : comportement de la première écoute, **décalage YouTube** (s'ajoute au décalage audio), **bloqueur de publicités** (le même que Chud Music, appliqué uniquement au lecteur ; une publicité met la partie en attente).
- Si YouTube demande une connexion ou refuse une vidéo (« le propriétaire n'autorise pas… »), un message l'explique ; vos fichiers restent jouables.

---

## 7. Atelier de partitions

Page du morceau › crayon. La partition générée de la difficulté choisie s'ouvre, faite pour être retouchée.

| Geste | Effet |
|---|---|
| Clic | ajouter une note |
| Glisser sur une piste | note longue |
| Glisser une note | la déplacer (aimantée à la grille) |
| Clic droit | supprimer |
| Maj + clic | sélection multiple |
| H | note longue ⇄ simple |
| Flèches | déplacer la sélection |
| Molette / Ctrl + molette | défiler / zoomer |
| 1 à 4 | grille : temps, croches, triolets, doubles croches |
| Espace | écouter |
| Ctrl+Z / Ctrl+Y / Ctrl+S | annuler / rétablir / enregistrer |

**Tester** enregistre puis lance une partie d'entraînement juste avant l'endroit affiché. La page du morceau signale « modifiée » ; **Revenir à la partition générée** efface vos retouches.

---

## 8. Version navigateur

Même jeu, mêmes partitions, sans installation.

- Fichiers locaux : bouton ou glisser-déposer. Chrome et Edge se souviennent des fichiers choisis (permission redemandée une fois par session).
- YouTube : **coller un lien** de vidéo ou de YouTube Music (la recherche et le bloqueur sont dans l'application de bureau). Pour écrire les notes, la station écoute l'onglet : choisissez « Cet onglet » et cochez « Partager aussi l'audio de l'onglet » (Chrome, Edge). Rien n'est enregistré.
- Formats : ceux que le navigateur décode (MP3, FLAC, WAV, OGG, OPUS, AAC, M4A selon le navigateur) ; WMA, ALAC et certains AIFF demandent l'application de bureau (FFmpeg).
- Adresse terminée par `?safe` : effets minimaux.

---

## 9. Réglages utiles

- **Affichage** : qualité graphique (Auto choisit selon la machine), images par seconde (Écran = 60, 120, 144, 240 Hz…), menus économes (30 i/s hors partie), effets cosmiques, mouvements réduits, compteur d'images, inclinaison de la piste.
- **Mode sans échec** (Affichage) : si l'affichage plante, clignote ou reste noir. Le jeu dessine alors sans la carte graphique, effets minimaux, 60 i/s au plus. Il démarre aussi tout seul dans ce mode après deux lancements ratés ou des plantages répétés du pilote graphique ; une pastille dorée « Mode sans échec » en haut de l'écran le rappelle, et Réglages › Affichage › **Redémarrer normalement** en sort. Ligne de commande : `Chud Tiles.exe --safe-mode`.
- **Données** : sauvegarder / restaurer le profil complet dans un fichier, vider le cache des analyses, remettre la progression à zéro, oublier les archives (les fichiers restent sur le disque).

---

## 10. Progression

Chaque partie rapporte de l'XP : notes réussies × difficulté × précision, plus des bonus (morceau terminé, full combo, étoiles). L'entraînement n'en rapporte pas. Les niveaux donnent un **grade d'équipage** : Cadet, Observateur, Navigateur, Pilote, Astronome, Commandant, Amiral stellaire, Légende cosmique. 22 **succès** à découvrir (premier full combo, combo de 1 000, Expert terminé, sept jours de suite, morceau appris de YouTube…). Le Carnet garde les dix meilleures parties par difficulté et tout l'historique.

---

## 11. En cas de souci

| Symptôme | Solution |
|---|---|
| Les notes semblent en avance ou en retard | refaire la calibration ; en jeu, Pause › ±5 ms ; l'écran des résultats propose une correction mesurée. |
| Décalage seulement avec YouTube | Réglages › YouTube › Décalage YouTube. |
| Saccades | Affichage : qualité Basse ou Moyenne, effets Réduits ; fermer les applications lourdes ; le compteur d'images montre la pire image. |
| Écran noir, plantage au démarrage | le mode sans échec se déclenche tout seul au lancement suivant ; sinon `--safe-mode`. |
| Un fichier ne s'ouvre pas | le format est-il dans la liste ? Sous Windows/Linux, FFmpeg est livré avec le jeu pour les formats rares. |
| « Aucun son reçu du lecteur YouTube » | la vidéo est peut-être protégée ou mise en pause par YouTube ; essayer une autre version du morceau. |
