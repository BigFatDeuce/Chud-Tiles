import { ANALYSIS_VERSION, type Analysis } from '@core/analysis/analyze';
import { compactJson, gunzip, gzip, validateAnalysis, VIDEO_ID, type ChartSource } from '@shared/charts';
import * as db from '../storage/db';
import { base, offline } from './leaderboard';

// Shared charts (chud-tiles.holy-c.men): a YouTube song learned or downloaded by one player is ready
// for everyone. Only the analysis travels (beats, attacks, sections), never any sound. Off with
// Settings › Online, like the leaderboard.

const flagKey = (id: string) => `chart-shared:${id}:${ANALYSIS_VERSION}`;

async function timed(input: string, init?: RequestInit, ms = 15_000): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** The analysis another player shared for this video, or null (none, offline, or refused). */
export async function fetchShared(videoId: string): Promise<Analysis | null> {
  if (offline() || !VIDEO_ID.test(videoId)) return null;
  try {
    const res = await timed(`${base()}/api/charts/${videoId}?v=${ANALYSIS_VERSION}`, undefined, 8000);
    if (!res.ok) return null;
    const v = validateAnalysis(JSON.parse(await gunzip(await res.arrayBuffer())), ANALYSIS_VERSION);
    if (!v.ok) return null;
    const a = v.value as unknown as Analysis;
    // nothing to send back: the server already has it
    await db.put('kv', a.source, flagKey(videoId)).catch(() => undefined);
    return a;
  } catch {
    return null;
  }
}

/** Shares an analysis once (again only if a downloaded one can replace one learned by ear). Never throws. */
export async function shareOnce(videoId: string | undefined, a: Analysis): Promise<void> {
  if (!videoId || offline() || !VIDEO_ID.test(videoId)) return;
  try {
    const done = await db.get<ChartSource>('kv', flagKey(videoId)).catch(() => undefined);
    if (done === 'offline' || done === a.source) return;
    const res = await timed(`${base()}/api/charts/${videoId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-chart-version': String(ANALYSIS_VERSION) },
      body: (await gzip(compactJson(a))) as BlobPart,
    });
    if (res.ok) await db.put('kv', a.source, flagKey(videoId)).catch(() => undefined);
  } catch {
    // not shared this time: tried again next time the song is opened
  }
}
