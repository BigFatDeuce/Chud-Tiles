import { Download, Monitor } from 'lucide-react';
import { RELEASES_URL } from '@shared/project';
import { tr } from '../i18n';
import { platform } from '../platform';

/** Browser version: the desktop app plays better; a link to the latest release. */
export function DesktopCallout({ compact = false }: { compact?: boolean }) {
  if (platform.kind !== 'web') return null;
  if (compact)
    return (
      <a className="desktop-callout compact" href={RELEASES_URL} target="_blank" rel="noreferrer">
        <Monitor size={15} /> {tr('Meilleur en version bureau : télécharger Chud Tiles')}
      </a>
    );
  return (
    <div className="panel pad desktop-callout brackets">
      <div className="panel-title">
        <Monitor size={16} color="var(--gold)" />
        <h3>{tr('Meilleur en version bureau')}</h3>
      </div>
      <ul>
        <li>{tr('Les morceaux YouTube téléchargés : partition complète tout de suite, sans publicité ni partage d’onglet')}</li>
        <li>{tr('Toute votre bibliothèque, dossiers surveillés, tous les formats audio')}</li>
        <li>{tr('Plus fluide, et des mises à jour automatiques')}</li>
      </ul>
      <a className="btn primary" href={RELEASES_URL} target="_blank" rel="noreferrer">
        <Download size={16} /> {tr('Télécharger pour Windows ou Linux')}
      </a>
    </div>
  );
}
