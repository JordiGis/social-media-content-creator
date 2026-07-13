import { useEffect, useRef } from 'react';

/** Textarea que crece con el contenido (estilo Notion). */
export default function AutoTextarea({ value, onChange, placeholder, className = '' }) {
  const ref = useRef(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(resize, [value]);

  return (
    <textarea
      ref={ref}
      className={`auto-textarea ${className}`}
      value={value}
      placeholder={placeholder}
      rows={2}
      onChange={(e) => {
        onChange(e.target.value);
        resize();
      }}
    />
  );
}
