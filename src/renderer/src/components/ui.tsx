import { lang, locale, tr } from '../i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { Archive, Brain, CalendarDays, Circle, CircleDot, Cloud, Compass, Crosshair, Disc3, Flame, Gauge, Magnet, Moon, Music2, Orbit, Radio, Rocket, SatelliteDish, Sparkles, Star, Sunrise, Telescope, Timer, Zap, type LucideIcon } from 'lucide-react';
import { playSfx } from '../audio/sfx';
import { useToasts } from '../store/toasts';

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-label={tr('Chud Tiles')}>
      <defs>
        <linearGradient id="lg-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4fd6ff" />
          <stop offset="0.55" stopColor="#8f6bff" />
          <stop offset="1" stopColor="#ff5fd2" />
        </linearGradient>
        <radialGradient id="lg-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#8f6bff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#8f6bff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="url(#lg-glow)" />
      {/* the ring passes behind the planet: drawn in two halves */}
      <path d="M4.6 30.2 A21 7 -24 0 1 41.6 13.5" fill="none" stroke="url(#lg-logo)" strokeWidth="1.6" opacity="0.55" />
      <circle cx="24" cy="24" r="12" fill="#0a0c24" stroke="url(#lg-logo)" strokeWidth="2.2" />
      <rect x="18.2" y="16.5" width="3.4" height="9.5" rx="1.7" fill="#fff" />
      <rect x="26.4" y="21.5" width="3.4" height="9.5" rx="1.7" fill="url(#lg-logo)" />
      <path d="M41.6 13.5 A21 7 -24 0 1 4.6 30.2" fill="none" stroke="url(#lg-logo)" strokeWidth="1.6" />
    </svg>
  );
}

export function Cover({ src, size = '', icon = 'music' }: { src?: string | null; size?: '' | 'md' | 'lg'; icon?: 'music' | 'disc' }) {
  const [ok, setOk] = useState(true);
  useEffect(() => setOk(true), [src]);
  return (
    <div className={`cover ${size}`}>
      {src && ok ? <img src={src} alt="" loading="lazy" onError={() => setOk(false)} /> : icon === 'disc' ? <Disc3 size={size === 'lg' ? 56 : 20} /> : <Music2 size={size === 'lg' ? 56 : 20} />}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle ${on ? 'on' : ''}`}
      onClick={() => {
        playSfx('click', 0.6);
        onChange(!on);
      }}
    />
  );
}

export function Range({ value, min, max, step = 1, onChange, label }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label?: string }) {
  const p = ((value - min) / (max - min)) * 100;
  return <input aria-label={label} className="range" type="range" min={min} max={max} step={step} value={value} style={{ ['--p' as string]: `${p}%` }} onChange={(e) => onChange(Number(e.target.value))} />;
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          role="radio"
          aria-checked={o.v === value}
          title={o.title}
          className={o.v === value ? 'on' : ''}
          onClick={() => {
            playSfx('click', 0.5);
            onChange(o.v);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="toast-zone">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          <div>
            <b>{t.title}</b>
            {t.text && <div className="tip" style={{ marginTop: 3 }}>{t.text}</div>}
            {t.action && (
              <button
                className="btn primary small toast-action"
                onClick={(e) => {
                  e.stopPropagation();
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function fmtTime(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '–:––';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

export const fmtScore = (n: number) => Math.round(n).toLocaleString(locale);
export const fmtPct = (a: number, d = 2) => (lang === 'fr' ? `${(a * 100).toFixed(d).replace('.', ',')} %` : `${(a * 100).toFixed(d)}%`);

export const DIFF_LABEL: Record<string, string> = { easy: tr('Facile'), normal: tr('Normal'), hard: tr('Difficile'), expert: tr('Expert'), custom: tr('Personnalisé') };
export const DIFF_COLOR: Record<string, string> = { easy: 'var(--d-easy)', normal: 'var(--d-normal)', hard: 'var(--d-hard)', expert: 'var(--d-expert)', custom: 'var(--d-custom)' };
export const RANK_COLOR: Record<string, string> = { SS: '#ffd98a', S: '#ffc861', A: '#4fd6ff', B: '#8f6bff', C: '#c38bff', D: '#ff8fb0' };

const ACH_ICONS: Record<string, LucideIcon> = { sunrise: Sunrise, orbit: Orbit, sparkles: Sparkles, 'circle-dot': CircleDot, cloud: Cloud, circle: Circle, rocket: Rocket, flame: Flame, crosshair: Crosshair, radio: Radio, brain: Brain, archive: Archive, 'satellite-dish': SatelliteDish, compass: Compass, telescope: Telescope, zap: Zap, moon: Moon, timer: Timer, 'calendar-days': CalendarDays, magnet: Magnet, star: Star, gauge: Gauge };

/** Icon of an achievement (names from the core's achievement list). */
export function AchIcon({ name, size = 20 }: { name: string; size?: number }) {
  const I = ACH_ICONS[name] ?? Star;
  return <I size={size} />;
}

/** "2 h 05", "14 min", "45 s". */
export function fmtDuration(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** "aujourd’hui 21:04", "hier", "12 nov.". */
export function fmtWhen(t: number): string {
  const d = new Date(t);
  const now = new Date();
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  const hm = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return tr('aujourd’hui {hm}', { hm });
  if (days === 1) return tr('hier {hm}', { hm });
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
}

export function RankBadge({ rank, size = 15 }: { rank: string; size?: number }) {
  return (
    <span className="rank-badge" style={{ color: RANK_COLOR[rank] ?? 'var(--ink-2)', fontSize: size }}>
      {rank}
    </span>
  );
}
