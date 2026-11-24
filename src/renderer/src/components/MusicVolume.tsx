import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { tr } from '../i18n';
import { useSettings } from '../store/settings';
import { Range } from './ui';

/** Music volume (Settings › Audio › Music), also on the song page and in the pause menu. */
export function MusicVolume() {
  const volume = useSettings((s) => s.volume);
  const set = useSettings((s) => s.set);
  const v = volume.music;
  const Icon = v === 0 ? VolumeX : v < 0.5 ? Volume1 : Volume2;
  return (
    <div className="opt-row">
      <div className="what">
        <b>
          <Icon size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          {tr('Volume de la musique')}
        </b>
        <small>{tr('Fichiers locaux et lecteur YouTube')}</small>
      </div>
      <div className="ctl">
        <Range value={v} min={0} max={1} step={0.01} onChange={(m) => set({ volume: { ...volume, music: m } })} label={tr('Volume de la musique')} />
        <span className="val">{Math.round(v * 100)} %</span>
      </div>
    </div>
  );
}
