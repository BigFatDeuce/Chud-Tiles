// Test songs: synthetic music with exactly known beats and attacks (tests/unit/synth.mjs), written
// as WAV; with FFmpeg (Chud Tiles' bundled copy, or one on the PATH) also every other format the
// game claims to read. Output: tests/fixtures/audio/ (ignored by git).
//   node tests/fixtures/make-fixtures.mjs
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeSong, makeClicks, SR } from '../unit/synth.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'audio');
mkdirSync(out, { recursive: true });

function wav(pcm, sr = SR) {
  const n = pcm.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), 44 + i * 2);
  return buf;
}

const songs = [
  ['song-128', { bpm: 128, bars: 40 }],
  ['song-100-swing', { bpm: 100, bars: 32, swing: 1 }],
  ['song-110-130', { bpm: 110, bpm2: 130, bars: 40 }],
  ['short-120', { bpm: 120, bars: 12, intro: 2 }],
];
const truth = {};
for (const [name, opt] of songs) {
  const s = makeSong(opt);
  writeFileSync(join(out, `${name}.wav`), wav(s.pcm));
  truth[name] = { beats: s.beats, downbeats: s.downbeats, events: s.events, duration: s.duration, bpm: opt.bpm };
  console.log(`${name}.wav  ${s.duration.toFixed(1)} s`);
}
// clicks every 0.5 s: capture latency and calibration tests
const clickTimes = Array.from({ length: 40 }, (_, k) => 1 + k * 0.5);
writeFileSync(join(out, 'clicks.wav'), wav(makeClicks(clickTimes, 22)));
truth.clicks = { times: clickTimes };
writeFileSync(join(out, 'truth.json'), JSON.stringify(truth));

// other formats, when an FFmpeg is available
const candidates = [join(here, '../../build/vendor/ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), 'ffmpeg'];
const ffmpeg = candidates.find((c) => c === 'ffmpeg' ? spawnSync(c, ['-version']).status === 0 : existsSync(c));
if (!ffmpeg) {
  console.log('FFmpeg introuvable : seuls les WAV sont produits.');
} else {
  const src = join(out, 'short-120.wav');
  const formats = [
    ['mp3', ['-c:a', 'libmp3lame', '-b:a', '192k']],
    ['flac', ['-c:a', 'flac']],
    ['ogg', ['-c:a', 'libvorbis', '-q:a', '5']],
    ['opus', ['-c:a', 'libopus', '-b:a', '128k']],
    ['m4a', ['-c:a', 'aac', '-b:a', '192k']],
    ['aac', ['-c:a', 'aac', '-b:a', '192k', '-f', 'adts']],
    ['aiff', ['-c:a', 'pcm_s16be']],
    ['wma', ['-c:a', 'wmav2', '-b:a', '192k']],
    ['alac.m4a', ['-c:a', 'alac']],
  ];
  for (const [ext, args] of formats) {
    const dst = join(out, `short-120.${ext}`);
    const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, ...args, dst]);
    console.log(`short-120.${ext}`, r.status === 0 ? 'ok' : `échec : ${r.stderr}`);
  }
}
