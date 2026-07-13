import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import AssetThumb from './AssetThumb.jsx';

const LABELS = { avatar: 'Avatar', top: 'Vídeo superior', fondo: 'Fondo' };

/**
 * Selector de asset con miniaturas. Permite elegir un archivo concreto para el
 * plano o "Por defecto" (hereda el valor global del guion).
 */
export default function AssetPicker({ kind, value, options = [], defaultValue, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const isDefault = value === defaultValue;
  const missing = value && !options.includes(value);

  const choose = (v) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className={`asset-picker ${open ? 'open' : ''}`} ref={wrapRef}>
      <span className="ap-label">{LABELS[kind] || kind}</span>
      <button type="button" className="ap-button" onClick={() => setOpen((o) => !o)}>
        <AssetThumb kind={kind} name={value} className="ap-thumb" />
        <span className="ap-name">
          {value || '— ninguno —'}
          {isDefault && value ? <em className="ap-tag">def</em> : null}
          {missing ? <em className="ap-tag warn">falta</em> : null}
        </span>
        <span className="ap-caret"><ChevronDown size={16} /></span>
      </button>

      {open && (
        <div className="ap-popover">
          <button
            type="button"
            className={`ap-option ap-option-default ${isDefault ? 'sel' : ''}`}
            onClick={() => choose(defaultValue)}
          >
            <AssetThumb kind={kind} name={defaultValue} className="ap-opt-thumb" />
            <span>Por defecto{defaultValue ? ` · ${defaultValue}` : ''}</span>
          </button>
          <div className="ap-grid">
            {options.map((opt) => (
              <button
                type="button"
                key={opt}
                className={`ap-option ${opt === value ? 'sel' : ''}`}
                title={opt}
                onClick={() => choose(opt)}
              >
                <AssetThumb kind={kind} name={opt} className="ap-opt-thumb" />
                <span className="ap-opt-name">{opt}</span>
              </button>
            ))}
            {options.length === 0 && <div className="muted small pad">Carpeta vacía</div>}
          </div>
        </div>
      )}
    </div>
  );
}
