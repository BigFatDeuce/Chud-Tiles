import type { YtLink } from './types';

// YouTube and YouTube Music links pasted by the user → what they point to.
//   https://www.youtube.com/watch?v=ID[&list=PL…]   https://music.youtube.com/watch?v=ID
//   https://youtu.be/ID   https://www.youtube.com/shorts/ID   https://www.youtube.com/embed/ID
//   https://www.youtube.com/playlist?list=PL…       https://music.youtube.com/playlist?list=OLAK…

const ID = /^[\w-]{11}$/;

export function parseYtLink(text: string): YtLink | null {
  const raw = text.trim();
  if (!/youtu/i.test(raw) || /\s/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let video: string | null = null;
  if (host === 'youtu.be') video = u.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    video = u.searchParams.get('v');
    const m = /^\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname);
    if (!video && m) video = m[1] ?? null;
  } else return null;
  const list = u.searchParams.get('list');
  // a "radio" list (RD…) made for a video is not a playlist to import: the video is what was meant
  if (list && !/^RD/.test(list) && (u.pathname === '/playlist' || !video)) return { kind: 'playlist', id: list, ...(video && ID.test(video) ? { videoId: video } : {}) };
  if (video && ID.test(video)) return { kind: 'video', id: video };
  if (list) return { kind: 'playlist', id: list };
  return null;
}
