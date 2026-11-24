import { useState } from 'react';
import { cleanPseudo } from '@shared/leaderboard';
import { tr } from '../i18n';
import { useSettings } from '../store/settings';
import { Toggle } from './ui';

/** Song page, before playing: the pseudo, and whether the score is published by itself at the end. */
export function PreGamePublish() {
  const s = useSettings();
  const [pseudo, setPseudo] = useState(s.pseudo);
  const clean = cleanPseudo(pseudo);
  return (
    <div className="pregame-publish">
      <input
        className="input"
        value={pseudo}
        maxLength={20}
        placeholder={tr('Votre pseudo')}
        aria-label={tr('Votre pseudo')}
        onChange={(e) => setPseudo(e.target.value)}
        onBlur={() => clean && clean !== s.pseudo && s.set({ pseudo: clean })}
        // Enter starts the run on this page: here it only validates the name
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <label className="row" style={{ gap: 8, whiteSpace: 'nowrap' }}>
        <Toggle
          on={s.autoPublish && !!clean}
          onChange={(v) => {
            if (clean) s.set({ pseudo: clean, autoPublish: v });
          }}
          label={tr('Publier mon score à la fin')}
        />
        <small className="muted">{tr('Publier à la fin')}</small>
      </label>
    </div>
  );
}
