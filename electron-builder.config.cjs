// Packaging (same base as Chud Music's). Windows: NSIS installer (French or English) and a portable
// exe. Linux (built on Fedora, WSL works): AppImage, .tar.gz (+ .deb, .rpm with a homepage). macOS: dmg and zip (to
// build on a Mac). `node scripts/prepare-dist.mjs <win|linux|mac>` runs first: icons, FFmpeg (copied
// read-only from Chud Music), third-party notices.
const { existsSync } = require('node:fs');

const ffmpegWin = existsSync('build/vendor/ffmpeg/ffmpeg.exe');
const ffmpegLinux = existsSync('build/vendor/ffmpeg-linux/ffmpeg');
const ffmpegMac = existsSync('build/vendor/ffmpeg-mac/ffmpeg');
const notices = { from: 'build/THIRD-PARTY-NOTICES.txt', to: 'THIRD-PARTY-NOTICES.txt' };
// .deb and .rpm require the project's web address: add "homepage" to package.json to build them too
const homepage = !!require('./package.json').homepage;

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'app.chudtiles',
  productName: 'Chud Tiles',
  copyright: 'Chud Tiles',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['out/**', 'package.json'],
  // Worker threads cannot be loaded from inside the asar archive.
  asarUnpack: ['out/main/chunks/adblock-worker-*.js'],
  // the GitHub releases: electron-updater reads latest.yml / latest-linux.yml there
  publish: [{ provider: 'github', owner: 'BigFatDeuce', repo: 'Chud-Tiles', releaseType: 'release' }],
  // the interface's own languages are enough: other Chromium locales are left out (smaller)
  electronLanguages: ['fr', 'en-US', 'en-GB'],
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
    ],
    extraResources: [...(ffmpegWin ? [{ from: 'build/vendor/ffmpeg', to: 'ffmpeg' }] : []), notices],
    icon: 'build/icons/icon.ico',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    // never touch %APPDATA%\Chud Tiles (profile, records, archives): not on update, not on uninstall
    deleteAppDataOnUninstall: false,
    installerIcon: 'build/icons/icon.ico',
    uninstallerIcon: 'build/icons/icon.ico',
    installerHeaderIcon: 'build/icons/icon.ico',
    artifactName: 'Chud-Tiles-Setup-${version}.${ext}',
    shortcutName: 'Chud Tiles',
    // installer and uninstaller in French or English, chosen from the system's language
    installerLanguages: ['fr_FR', 'en_US'],
    multiLanguageInstaller: true,
    displayLanguageSelector: false,
  },
  portable: {
    artifactName: 'Chud-Tiles-${version}-Portable.exe',
    unpackDirName: 'chud-tiles-portable',
  },
  linux: {
    target: ['AppImage', 'tar.gz', ...(homepage ? ['deb', 'rpm'] : [])].map((target) => ({ target, arch: ['x64'] })),
    syncDesktopName: true,
    // the window icon (Windows takes the exe's own) and FFmpeg
    extraResources: [...(ffmpegLinux ? [{ from: 'build/vendor/ffmpeg-linux', to: 'ffmpeg' }] : []), { from: 'build/icons/png/icon-256.png', to: 'icon.png' }, notices],
    artifactName: 'Chud-Tiles-${version}-x86_64.${ext}',
    executableName: 'chud-tiles',
    synopsis: 'Rhythm game made from your music',
    description: 'Rhythm game: any song (local files, YouTube Music) becomes a playable chart. Jeu de rythme : chaque morceau devient une partition jouable.',
    maintainer: 'Chud Tiles',
    category: 'Game',
    icon: 'build/icons/png/icon-512.png',
    desktop: { entry: { Keywords: 'rhythm;music;game;tiles;youtube;rythme;jeu;' } },
  },
  deb: { artifactName: 'Chud-Tiles-${version}-amd64.${ext}', packageName: 'chud-tiles' },
  rpm: {
    artifactName: 'Chud-Tiles-${version}-x86_64.${ext}',
    packageName: 'chud-tiles',
    // rpm records the build machine's host name: keep it neutral
    fpm: ['--rpm-rpmbuild-define', '_buildhost localhost'],
  },
  mac: {
    target: [{ target: 'dmg' }, { target: 'zip' }],
    category: 'public.app-category.music-games',
    icon: 'build/icons/icon.icns',
    extraResources: [...(ffmpegMac ? [{ from: 'build/vendor/ffmpeg-mac', to: 'ffmpeg' }] : []), { from: 'build/icons/png/icon-256.png', to: 'icon.png' }, notices],
    artifactName: 'Chud-Tiles-${version}-mac-${arch}.${ext}',
  },
};
