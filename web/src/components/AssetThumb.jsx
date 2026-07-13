import { Mic, Music } from 'lucide-react';
import { assetUrl } from '../api';

/** Miniatura de un asset: imagen para avatar, primer frame de vídeo para top/fondo, icono para audio. */
export default function AssetThumb({ kind, name, className = '' }) {
  if (!name) return <div className={`thumb thumb-empty ${className}`}>—</div>;
  if (kind === 'avatar' || kind === 'imagen') {
    return (
      <img
        className={`thumb ${className}`}
        src={(kind === 'imagen' ? assetUrl.imagen : assetUrl.avatar)(name)}
        alt={name}
        loading="lazy"
        draggable={false}
      />
    );
  }
  if (kind === 'musica' || kind === 'voz') {
    return (
      <div className={`thumb thumb-audio ${className}`}>
        {kind === 'voz' ? <Mic size={20} /> : <Music size={20} />}
      </div>
    );
  }
  const url = kind === 'top' ? assetUrl.top(name) : assetUrl.fondo(name);
  return (
    <video
      className={`thumb ${className}`}
      src={`${url}#t=0.1`}
      muted
      playsInline
      preload="metadata"
      tabIndex={-1}
    />
  );
}
