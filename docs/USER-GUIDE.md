# Chud Tiles — Player guide

> Version française : [GUIDE-UTILISATEUR.md](GUIDE-UTILISATEUR.md)

Chud Tiles turns your music into a chart: notes slide down lanes toward a glowing line; press the lane's key when the note touches the line. Nobody writes the chart by hand: it is born from listening to the song (beats, kick, snare, cymbals, sustained sounds, choruses).

---

## 1. Install

| System | File | Notes |
|---|---|---|
| Windows 10/11 | `Chud-Tiles-Setup-1.0.0.exe` | installer in French or English (following Windows), choice of folder, Start menu and desktop shortcuts. Uninstalling keeps your profile. |
| Windows, no install | `Chud-Tiles-1.0.0-Portable.exe` | runs as is (USB stick…). Same profile as the installed version. |
| Linux | `Chud-Tiles-1.0.0-x86_64.AppImage` | make it executable (`chmod +x`) and run it. Also: `Chud-Tiles-1.0.0-x86_64.tar.gz` (unpack, run `chud-tiles`), `Chud-Tiles-1.0.0-amd64.deb` (Debian, Ubuntu…) and `Chud-Tiles-1.0.0-x86_64.rpm` (Fedora, openSUSE…), installed with the package manager. |
| Browser | the `dist-web` folder published on a site (HTTPS) | Chrome or Edge recommended. See §8. |

Windows may say "Windows protected your PC" (unsigned app): "More info" › "Run anyway".

**Your data**: profile, records, archives and analyses stay on the computer (`%APPDATA%\Chud Tiles` on Windows, `~/.config/Chud Tiles` on Linux). Your audio files are **never copied or changed**.

---

## 2. First start

1. **Language**: Settings › Game › Language (Auto follows the system's language).
2. **Calibration** (2 minutes, strongly advised, essential with Bluetooth headphones): Settings › Audio & sync › Calibrate.
   - *Sound*: tap on each click, listening only. The game measures your audio output's delay.
   - *Picture*: no sound, tap when each note touches the line. The game measures your screen's delay.
3. Open a song: **Play a file**, **drag and drop** a file anywhere in the window, or the **YouTube** room.

---

## 3. The rooms

| Room | What for |
|---|---|
| **Bridge** | home: recently played songs, your level, open a file or a link. |
| **Archives** | your songs: files, watched music folders, Chud Music library import, favourites, sorting, search. Removing a song never deletes the file. |
| **YouTube** (radio room) | YouTube Music search (songs, videos, albums, playlists), suggestions, pasted links, *radio* (similar songs in a row), saving an album or playlist to Lists. |
| **Lists** | your lists, saved albums/playlists, Chud Music's lists (read, never changed). A list plays in a row: the results screen offers the next song. |
| **Logbook** | crew level and rank, statistics, personal leaderboard per difficulty, history, achievements. |
| **Settings** | game, controls, audio & sync, display, YouTube, data, about. |

---

## 4. Before playing: the song page

- **Structure**: the song's intensity map, its sections, choruses in gold.
- **Difficulty**: Easy, Normal, Hard, Expert, Custom — each card shows the number of notes, notes per second, holds, chords and a level from 1 to 20.
- **Lanes**: 3 to 7.
- **Scroll speed**: how long a note is visible (shorter = faster).
- **Failing allowed**: the run stops when the energy drops to zero (can be turned off).
- **Practice**: music speed (50, 65, 75, 90 or 100 %; 50, 75 or 100 % for YouTube), one section, looped. Practice runs do not count for records.
- **Custom**: density, subdivisions (quarters → sixteenths), chords, holds, minimum gap between notes, judgement windows.
- Buttons: **Play** (Enter), **Preview** (the eye: the chart plays itself), **Workshop** (the pen: edit the chart).

Analysing a file takes about a second per minute of music, once: it is then cached.

---

## 5. Playing

| Action | Keyboard (default) | Gamepad | Mouse / touch |
|---|---|---|---|
| Lanes, 4 lanes | D F J K (or ← ↓ ↑ →) | D-pad and shoulders on the left, face buttons and shoulders on the right | touch the lane |
| Lanes, 3 / 5 / 6 / 7 | F Space J · D F Space J K · S D F J K L · S D F Space J K L | same | same |
| Pause | Esc | Start | pause button, bottom right |
| Restart | ² (or `) | — | pause menu |

Every key and button can be changed in Settings › Controls (one layout per number of lanes).

**Notes**: tap, **hold** (keep pressed to the end; letting go early breaks the combo), **chord** (several lanes at once).

**Judgements**: Perfect (±45 ms), Great (±90 ms), Good (±135 ms), Miss. Easy has 15 % wider windows. "EARLY" / "LATE" shows under the judgement when a note is not perfect (can be turned off).

**Score**: Perfect 1,000, Great 700, Good 350, times the combo multiplier (×2 from 25, ×3 from 50, ×4 from 100). **Ranks**: SS (≥ 99 % with no miss), S (95 %), A (90 %), B (80 %), C (70 %), D.

**Pause**: resume, restart, nudge the audio offset by ±5 ms if notes feel early or late, quit.

**Results**: score, accuracy, max combo, judgement details, timing curve (are your taps early or late on average? a button applies the suggested correction), record, XP earned, achievements, play again, change difficulty, next song in the queue.

---

## 6. YouTube Music

The music is played **by the official YouTube player**, visible in a corner during the run. Nothing is downloaded, no stream is extracted.

- **First encounter** with a song: two choices.
  - **Play live** (mode A): notes are written while the song plays, slightly ahead (rhythm prediction). The first seconds "tune in the signal". A predicted note the music does not confirm fades away: missing it costs nothing.
  - **Listen first**: the song plays once (you can do something else), then the station knows the whole song: full chart, choruses, holds, as for a file.
- After a live run played to the end, the song is **learned**: the next run has the full chart.
- Settings › YouTube: first-listen behaviour, **YouTube offset** (added to the audio offset), **ad blocker** (the same as Chud Music, applied only to the player; an ad puts the run on hold).
- If YouTube asks you to sign in or refuses a video ("the owner does not allow…"), a message says so; your files stay playable.

---

## 7. Chart workshop

Song page › pen. The generated chart of the chosen difficulty opens, ready to be touched up.

| Gesture | Effect |
|---|---|
| Click | add a note |
| Drag on a lane | long note |
| Drag a note | move it (snapped to the grid) |
| Right click | delete |
| Shift + click | multiple selection |
| H | hold ⇄ tap |
| Arrows | move the selection |
| Wheel / Ctrl + wheel | scroll / zoom |
| 1 to 4 | grid: beats, eighths, triplets, sixteenths |
| Space | listen |
| Ctrl+Z / Ctrl+Y / Ctrl+S | undo / redo / save |

**Test** saves, then starts a practice run just before the shown spot. The song page shows "edited"; **Back to the generated chart** removes your edits.

---

## 8. Browser version

Same game, same charts, no install.

- Local files: button or drag and drop. Chrome and Edge remember picked files (permission asked again once per session).
- YouTube: **paste a link** to a video or a YouTube Music song (search and the ad blocker are in the desktop app). To write the notes, the station listens to the tab: choose "This tab" and tick "Also share tab audio" (Chrome, Edge). Nothing is recorded.
- Formats: those the browser decodes (MP3, FLAC, WAV, OGG, OPUS, AAC, M4A depending on the browser); WMA, ALAC and some AIFF need the desktop app (FFmpeg).
- An address ending in `?safe`: minimal effects.

---

## 9. Useful settings

- **Display**: graphics quality (Auto picks for the computer), frames per second (Screen = 60, 120, 144, 240 Hz…), power-saving menus (30 fps outside runs), cosmic effects, reduced motion, frame counter, track tilt.
- **Safe mode** (Display): if the display crashes, flickers or stays black. The game then draws without the graphics card, minimal effects, 60 fps at most. It also starts in this mode by itself after two failed starts or repeated graphics driver crashes; a gold "Safe mode" badge at the top says so, and Settings › Display › **Restart normally** leaves it. Command line: `"Chud Tiles.exe" --safe-mode`.
- **Data**: back up / restore the whole profile to a file, clear the analysis cache, reset progress, forget the archives (files stay on disk).

---

## 10. Progress

Each run earns XP: notes hit × difficulty × accuracy, plus bonuses (song cleared, full combo, stars). Practice earns none. Levels give a **crew rank**: Cadet, Observer, Navigator, Pilot, Astronomer, Commander, Stellar admiral, Cosmic legend. 22 **achievements** to discover (first full combo, 1,000 combo, Expert cleared, seven days in a row, a song learned from YouTube…). The Logbook keeps the ten best runs per difficulty and the whole history.

---

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| Notes feel early or late | calibrate again; in game, Pause › ±5 ms; the results screen suggests a measured correction. |
| Offset only with YouTube | Settings › YouTube › YouTube offset. |
| Stutter | Display: Low or Medium quality, Reduced effects; close heavy apps; the frame counter shows the worst frame. |
| Black screen, crash at start | safe mode starts by itself at the next launch; otherwise `--safe-mode`. |
| A file does not open | is the format in the list? On Windows/Linux, FFmpeg ships with the game for rare formats. |
| "No sound received from the YouTube player" | the video may be protected or paused by YouTube; try another version of the song. |
