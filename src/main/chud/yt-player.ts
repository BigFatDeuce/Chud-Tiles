import { app, session, shell, webFrameMain, type BrowserWindow, type WebContents } from 'electron';
import { join } from 'node:path';
import { createFrameAnalyzer, FRAME_SIZE, HOP } from '@core/analysis/frame';

// Adapted from Chud Music (src/main/yt-player.ts, v1.4.0): same design, same rules.
//
// The official YouTube IFrame player, shown (≥ 200×200, nothing drawn over it) by the interface.
// It lives in a <webview> on its own session partition, so the Referer rule and the ad blocker
// apply to YouTube only, never to the rest of the game.
//
//   renderer <webview src="ct-yt://player/"> ── session persist:ct-youtube
//     └ our page (served from memory below) → https://www.youtube.com/iframe_api → YT.Player
//
// What changes from Chud Music: the small spectrum meter injected into YouTube's frame becomes
// the game's rhythm analyser (the very same `createFrameAnalyzer` as for local files). It listens
// to a copy of the <video>'s sound (captureStream → ScriptProcessor connected to a silent gain):
// playback, volume and output are untouched, nothing is recorded, and only measurements leave
// the frame — 32 numbers per 10.7 ms frame — together with clock pairs (media time ↔ instant).

export const YT_SCHEME = 'ct-yt';
export const YT_PARTITION = 'persist:ct-youtube';
export const YT_PLAYER_URL = `${YT_SCHEME}://player/`;
// YouTube's Required Minimum Functionality: embedded clients send an identifying Referer.
const APP_REFERER = 'https://app.chudtiles/';

const PLAYER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>YouTube</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}#yt{position:absolute;inset:0;width:100%;height:100%}</style>
</head><body><div id="yt"></div>
<script>
  const host = window.ctHost;
  let player = null, ready = false, pending = null, volume = 80, muted = false, timer = 0, rate = 1;
  const emit = (m) => host.send(m);
  const tick = () => {
    if (!player || !player.getCurrentTime) return;
    emit({ type: 'time', t: player.getCurrentTime() || 0, d: player.getDuration() || 0, loaded: player.getVideoLoadedFraction() || 0 });
  };
  const applyVolume = () => { player.setVolume(volume); if (muted || volume === 0) player.mute(); else player.unMute(); };
  const noCaptions = () => {
    try { player.setOption('captions', 'track', {}); } catch {}
    try { player.unloadModule('captions'); } catch {}
    try { player.unloadModule('cc'); } catch {}
  };
  const applyRate = () => { try { if (player.getPlaybackRate() !== rate) player.setPlaybackRate(rate); } catch {} };
  function run(c) {
    switch (c.op) {
      case 'load':
        if (c.autoplay === false) player.cueVideoById({ videoId: c.id, startSeconds: c.start || 0 });
        else player.loadVideoById({ videoId: c.id, startSeconds: c.start || 0 });
        applyVolume(); noCaptions(); break;
      case 'play': player.playVideo(); break;
      case 'pause': player.pauseVideo(); break;
      case 'stop': player.stopVideo(); break;
      case 'seek': player.seekTo(c.t, true); setTimeout(tick, 50); break;
      case 'volume': volume = c.v; muted = c.muted; applyVolume(); break;
      case 'rate': rate = c.rate; applyRate(); break;
    }
  }
  host.onCommand((c) => {
    if (c.op === 'volume') { volume = c.v; muted = c.muted; }
    if (c.op === 'rate') rate = c.rate;
    if (ready) run(c);
    else if (c.op === 'load') pending = c;
    else if (c.op === 'stop' || c.op === 'pause') pending = null;
  });
  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('yt', {
      width: '100%', height: '100%',
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0, iv_load_policy: 3, cc_load_policy: 0, origin: location.origin },
      events: {
        onReady: () => { ready = true; applyVolume(); emit({ type: 'ready' }); if (pending) { run(pending); pending = null; } },
        onStateChange: (e) => { if (e.data === 1 || e.data === 3) { noCaptions(); applyRate(); } emit({ type: 'state', state: e.data }); clearInterval(timer); if (e.data === 1 || e.data === 2 || e.data === 3) timer = setInterval(tick, 250); tick(); },
        onApiChange: () => noCaptions(),
        onError: (e) => emit({ type: 'error', code: e.data }),
      },
    });
  };
  window.addEventListener('error', (e) => emit({ type: 'log', message: String(e.message) }));
  // measurements of the rhythm analyser running inside YouTube's frame (ANALYSER_JS)
  window.addEventListener('message', (e) => {
    if (!/^https:\\/\\/(www\\.)?youtube(-nocookie)?\\.com$/.test(e.origin)) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.ctFrames) emit(Object.assign({ type: 'frames' }, d.ctFrames));
    else if (d.ctClock) emit(Object.assign({ type: 'clock' }, d.ctClock));
    else if (d.ctAnalyser) emit(Object.assign({ type: 'analyser' }, d.ctAnalyser));
  });
</script>
<script src="https://www.youtube.com/iframe_api"></script>
</body></html>`;

/**
 * Runs inside YouTube's own player frame. Two things leave it:
 *  · clock pairs: the media time being heard and the instant (epoch ms, high resolution) it was
 *    read — the game's clock for YouTube songs;
 *  · feature frames of the sound (createFrameAnalyzer, the same code as for local files), each
 *    with the media time of its centre. Times come from the frame's audio clock (sample exact)
 *    mapped onto the media time; frames heard during an ad are not sent.
 */
export const ANALYSER_JS = `(() => {
  if (window.__ctAnalyser) return 'present';
  window.__ctAnalyser = true;
  const createFrameAnalyzer = ${createFrameAnalyzer.toString()};
  const SIZE = ${FRAME_SIZE}, HOP = ${HOP}, BUF = 1024;
  const post = (m) => parent.postMessage(m, '*');
  let ctx = null, node = null, src = null, track = null, an = null, vid = null;
  let times = [], data = [], lastSend = 0;
  const isAd = () => !!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting');
  const clock = () => {
    const v = document.querySelector('video');
    if (!v) return;
    const ad = isAd();
    post({ ctClock: { ct: v.currentTime, at: performance.timeOrigin + performance.now(), paused: v.paused || v.ended || ad, ad: ad, rate: v.playbackRate || 1, buffering: v.readyState < 3 || v.seeking, ac: ctx ? ctx.currentTime : -1 } });
  };
  const flush = () => {
    if (times.length) post({ ctFrames: { times: times, data: data, sampleRate: ctx ? ctx.sampleRate : 0 } });
    times = []; data = [];
    lastSend = performance.now();
  };
  // Media time of the sample stream: a phase-locked loop on (media time, media seconds per audio
  // second). The audio clock is sample exact but may run a little apart from the media clock; the
  // media clock is right but read with jitter. Frame times follow the samples (no jitter) and are
  // steered slowly towards the media clock (no drift). A real jump (seek, new video) restarts it.
  let pll = null;
  /** Media time of the end of the last block analysed. */
  let lastEnd = null;
  function process(e) {
    // nothing is analysed while YouTube does not play the song (paused, buffering, seeking, ad)
    if (!vid || vid.paused || vid.seeking || vid.readyState < 3 || isAd()) { pll = null; return; }
    const rate = vid.playbackRate || 1;
    const sr = ctx.sampleRate;
    const dur = BUF / sr;
    // media time of the end of this input block, as the media clock says
    const obs = vid.currentTime - (ctx.currentTime - (e.playbackTime - dur)) * rate;
    if (!pll || pll.rate !== rate) {
      // (re)start; after a buffering stall the sound goes on where it stopped: the analysis
      // window is kept, only a real jump (seek, new video) starts it afresh
      if (lastEnd === null || Math.abs(obs - dur * rate - lastEnd) > 0.15) an.reset();
      pll = { m: obs - dur * rate, k: rate, rate: rate };
    }
    const start = pll.m;
    const k = pll.k;
    let end = start + dur * k;
    const err = obs - end;
    if (Math.abs(err) > 0.15) { pll = null; lastEnd = null; an.reset(); return; }
    end += err * 0.05;
    pll.k = Math.min(rate * 1.08, Math.max(rate * 0.92, k + err * 0.03));
    pll.m = end;
    lastEnd = end;
    const x = e.inputBuffer.getChannelData(0);
    // total silence while the video plays: the capture may have lost the sound (taken again after 1.5 s)
    let peak = 0;
    for (let i = 0; i < BUF; i += 8) { const a = x[i] < 0 ? -x[i] : x[i]; if (a > peak) peak = a; }
    silentFor = peak < 1e-6 ? silentFor + dur : 0;
    if (silentFor > 1.5 && !vid.muted) { silentFor = 0; track = null; }
    for (let j = 0; j < BUF; j += HOP) {
      const tEnd = start + ((j + HOP) / sr) * k;
      an.push(x.subarray(j, j + HOP), (f) => {
        times.push(tEnd - an.lag * k);
        for (let i = 0; i < SIZE; i++) data.push(f[i]);
      });
    }
    if (performance.now() - lastSend > 45) flush();
  }
  // YouTube may switch the media source of its <video> (an ad, a quality change): the captured
  // track then ends or falls silent. A new capture is taken when that happens.
  let cs = null, silentFor = 0, hooked = null;
  function hook(v) {
    let t = null;
    try {
      cs = v.captureStream ? v.captureStream() : null;
      t = cs ? cs.getAudioTracks().find((x) => x.readyState === 'live') || null : null;
    } catch (err) { post({ ctAnalyser: { ok: false, reason: String(err) } }); return false; }
    if (!t) return false;
    const stream = cs;
    cs.addEventListener('addtrack', () => { if (cs === stream) track = null; });
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: 'interactive' });
      node = ctx.createScriptProcessor(BUF, 1, 1);
      const silent = ctx.createGain();
      silent.gain.value = 0;
      node.connect(silent);
      silent.connect(ctx.destination);
      an = createFrameAnalyzer(ctx.sampleRate);
      node.onaudioprocess = process;
    }
    if (src) try { src.disconnect(); } catch (err) {}
    src = ctx.createMediaStreamSource(new MediaStream([t]));
    src.connect(node);
    track = t; vid = v; pll = null; silentFor = 0; an.reset();
    if (hooked !== v) {
      hooked = v;
      ['playing', 'pause', 'seeked', 'ratechange', 'waiting'].forEach((ev) => v.addEventListener(ev, clock));
    }
    post({ ctAnalyser: { ok: true } });
    return true;
  }
  setInterval(() => {
    const v = document.querySelector('video');
    if (v && (v !== vid || !track || track.readyState === 'ended' || track.muted) && v.readyState >= 1) hook(v);
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }, 400);
  setInterval(clock, 50);
  return 'installed';
})()`;

/** Hides YouTube's subtitle layer inside its player frame (the player API turns them off too). */
const NO_CAPTIONS_JS = `(() => {
  if (document.getElementById('ct-no-cc')) return;
  const s = document.createElement('style');
  s.id = 'ct-no-cc';
  s.textContent = '.ytp-caption-window-container,.caption-window,.ytp-caption-segment{display:none!important}';
  (document.head || document.documentElement).appendChild(s);
  setInterval(() => {
    const m = document.getElementById('movie_player');
    try { if (m && m.isSubtitlesOn && m.isSubtitlesOn()) m.toggleSubtitles(); } catch {}
    if (!document.getElementById('ct-no-cc')) (document.head || document.documentElement).appendChild(s);
  }, 1000);
})()`;

/**
 * Read-only look at YouTube's own player frame, when it does not play: does it show its error
 * screen, and does that screen ask to sign in ("Sign in to confirm you're not a bot")? Nothing is
 * clicked, hidden or changed (as in Chud Music: no Google account, by design).
 */
const BLOCKED_JS = `(() => {
  const shown = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  };
  let status = null;
  try {
    const p = document.getElementById('movie_player');
    const r = p && p.getPlayerResponse ? p.getPlayerResponse() : null;
    status = r && r.playabilityStatus ? r.playabilityStatus.status : null;
  } catch {}
  if (status === 'LOGIN_REQUIRED') return 'signin';
  const signin = [...document.querySelectorAll('a[href*="accounts.google."], a[href*="ServiceLogin"], a[href*="/signin"]')].some(shown);
  const error = [...document.querySelectorAll('.ytp-error, .ytp-error-content, [class*="error-screen"]')].some(shown);
  if (signin) return 'signin';
  if (error || status === 'ERROR' || status === 'UNPLAYABLE') return 'error';
  return null;
})()`;

const embedFrame = () => ytGuest()?.mainFrame.framesInSubtree.find((f) => /youtube(-nocookie)?\.com\/embed\//.test(f.url));

export async function ytBlocked(): Promise<'signin' | 'error' | null> {
  const fake = process.env.CT_TEST_YT_BLOCKED;
  if (fake === 'signin' || fake === 'error') return fake;
  const frame = embedFrame();
  if (!frame) return null;
  const v: unknown = await frame.executeJavaScript(BLOCKED_JS).catch(() => null);
  return v === 'signin' || v === 'error' ? v : null;
}

export const ytSchemePrivilege = { scheme: YT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } };

let guest: WebContents | null = null;
export const ytGuest = () => (guest && !guest.isDestroyed() ? guest : null);
export { embedFrame };

export function initYouTubeSession(win: BrowserWindow): Electron.Session {
  const ses = session.fromPartition(YT_PARTITION);
  ses.protocol.handle(YT_SCHEME, (req) => {
    const url = new URL(req.url);
    if (url.host !== 'player') return new Response('Not found', { status: 404 });
    return new Response(PLAYER_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
  ses.webRequest.onBeforeSendHeaders({ urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'] }, (d, cb) => {
    d.requestHeaders.Referer = APP_REFERER;
    cb({ requestHeaders: d.requestHeaders });
  });
  // No camera, microphone, notifications… for anything loaded in the player.
  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));

  // Only our player page may be attached as a <webview>, always on the YouTube partition,
  // sandboxed, with our guest preload.
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    if (!params.src?.startsWith(YT_PLAYER_URL)) {
      e.preventDefault();
      return;
    }
    params.partition = YT_PARTITION;
    prefs.preload = join(__dirname, '../preload/yt-guest.js');
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.autoplayPolicy = 'no-user-gesture-required';
    prefs.backgroundThrottling = false;
  });
  win.webContents.on('did-attach-webview', (_e, wc) => {
    guest = wc;
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/(www\.|music\.)?youtube\.com\//.test(url) || /^https:\/\/youtu\.be\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (ev, url) => {
      if (!url.startsWith(YT_PLAYER_URL)) ev.preventDefault();
    });
    if (!app.isPackaged) wc.on('console-message', (ev) => console.log('[yt-player]', ev.message));
    wc.on('did-frame-finish-load', (_ev, isMainFrame, processId, routingId) => {
      if (isMainFrame) return;
      const frame = webFrameMain.fromId(processId, routingId);
      if (frame && /^https:\/\/(www\.)?youtube(-nocookie)?\.com\/embed\//.test(frame.url)) {
        frame.executeJavaScript(ANALYSER_JS).catch((err) => console.warn('[yt-player] analyser', err));
        frame.executeJavaScript(NO_CAPTIONS_JS).catch(() => {});
      }
    });
  });
  return ses;
}
