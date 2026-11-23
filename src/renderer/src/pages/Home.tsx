import { FolderOpen, Play, Radio, Sparkles } from 'lucide-react';
import { levelOf, titleOf } from '@core/game/progress';
import { platform } from '../platform';
import { useLibrary, recentTracks } from '../store/library';
import { useProfile } from '../store/profile';
import { go } from '../store/nav';
import { pickAndOpen, openTrack } from '../game/actions';
import { Cover, DIFF_LABEL, fmtScore } from '../components/ui';
import { playSfx } from '../audio/sfx';
import { tr, trn } from '../i18n';

export function LevelRing({ xp, size = 46 }: { xp: number; size?: number }) {
  const lv = levelOf(xp);
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const k = lv.into / lv.need;
  return (
    <div className="lvl" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(150,162,255,0.16)" strokeWidth="3" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#lg-ring)" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${c * k} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <defs>
          <linearGradient id="lg-ring">
            <stop offset="0" stopColor="#4fd6ff" />
            <stop offset="1" stopColor="#ff5fd2" />
          </linearGradient>
        </defs>
      </svg>
      {lv.level}
    </div>
  );
}

export function Home() {
  const tracks = useLibrary((s) => s.tracks);
  const profile = useProfile((s) => s.profile);
  const recentRuns = useProfile((s) => s.recent);
  const recents = recentTracks(tracks, 8);
  const last = recents[0];
  const lv = levelOf(profile.xp);
  const lastRun = recentRuns.find((r) => !r.practice);
  return (
    <div className="home page-enter">
      <section className="hero">
        <div className="label kicker">{tr('Station Chud · pont d’observation')}</div>
        <h1>
          {tr('CHUD')}
          <span className="l2">{tr('TILES')}</span>
        </h1>
        <p>{tr('Chaque morceau devient une constellation de notes à jouer. Ouvrez vos fichiers ou lancez YouTube Music : la partition naît de la musique elle-même.')}</p>
        <div className="actions">
          <button
            className="btn primary big"
            onClick={() => {
              playSfx('click');
              void pickAndOpen();
            }}
          >
            <FolderOpen size={19} /> {tr('Jouer un fichier')}
          </button>
          <button className="btn cyan big" onClick={() => go({ id: 'search' })}>
            <Radio size={19} /> {platform.caps.youtube === 'full' ? tr('YouTube Music') : tr('Lien YouTube')}
          </button>
          {last && (
            <button className="btn big ghost" onClick={() => openTrack(last)} title={last.title}>
              <Play size={18} /> {tr('Reprendre')}
            </button>
          )}
        </div>
        <p className="tip" style={{ marginTop: 18 }}>{tr('Astuce : glissez-déposez des fichiers audio n’importe où dans la fenêtre.')}</p>
      </section>
      <section className="home-side">
        <div className="panel profile-card brackets">
          <LevelRing xp={profile.xp} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row">
              <b className="display" style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}>{tr(titleOf(lv.level))}</b>
              <span className="grow" />
              <span className="muted num" style={{ fontSize: 12 }}>
                {Math.round(lv.into)} / {lv.need} {tr('XP')}
              </span>
            </div>
            <div className="xpbar" style={{ marginTop: 8 }}>
              <i style={{ width: `${(lv.into / lv.need) * 100}%` }} />
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              {trn(profile.plays, '{n} partie', '{n} parties')} · {trn(Object.keys(profile.achievements).length, '{n} succès', '{n} succès')}
              {lastRun && (
                <>
                  {' '}
                  {tr('· dernière : {rank} en {diff} ({score})', { rank: lastRun.rank, diff: DIFF_LABEL[lastRun.difficulty], score: fmtScore(lastRun.score) })}
                </>
              )}
            </div>
          </div>
        </div>
        <div className="panel pad">
          <div className="panel-title">
            <Sparkles size={16} color="var(--gold)" />
            <h3>{tr('Récemment joués')}</h3>
            <span className="grow" />
            <button className="btn small ghost" onClick={() => go({ id: 'library' })}>
              {tr('Archives')}
            </button>
          </div>
          {recents.length ? (
            <div className="recent-strip">
              {recents.slice(0, 6).map((t) => (
                <div key={t.key} className="card-track" onClick={() => openTrack(t)} onMouseEnter={() => playSfx('hover', 0.4)}>
                  <Cover src={t.cover ?? null} />
                  <div>
                    <b>{t.title}</b>
                    <small>{t.artist ?? (t.source === 'youtube' ? tr('YouTube') : tr('Fichier local'))}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty" style={{ padding: '22px 10px' }}>
              <span>{tr('Aucun morceau joué pour l’instant.')}</span>
              <span className="tip">{tr('Ouvrez un fichier audio ou cherchez sur YouTube Music pour commencer.')}</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
