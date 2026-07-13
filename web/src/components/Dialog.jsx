import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Diálogo modal reutilizable que sustituye a window.confirm/window.alert.
// Se controla por parámetros y se usa de forma imperativa con promesas:
//
//   const { confirm, alert } = useDialog();
//   if (!(await confirm({ message: '¿Seguro?', tone: 'danger' }))) return;
//   await alert({ message: 'Error', tone: 'danger' });
//
// Acepta una cadena suelta como atajo de `message`: confirm('¿Seguro?').

const DialogContext = createContext(null);

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog debe usarse dentro de <DialogProvider>');
  return ctx;
}

const DEFAULTS = {
  title: '',
  message: '',
  confirmText: 'Aceptar',
  cancelText: 'Cancelar',
  tone: 'default', // 'default' | 'danger'
  mode: 'confirm', // 'confirm' | 'alert'
};

const normalize = (opts) => (typeof opts === 'string' ? { message: opts } : opts || {});

export function DialogProvider({ children }) {
  const [state, setState] = useState(null); // opciones activas o null
  const resolver = useRef(null);

  const open = useCallback((opts) => {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setState({ ...DEFAULTS, ...opts });
    });
  }, []);

  const close = useCallback((result) => {
    resolver.current?.(result);
    resolver.current = null;
    setState(null);
  }, []);

  const confirm = useCallback((opts) => open({ mode: 'confirm', ...normalize(opts) }), [open]);
  const alert = useCallback(
    (opts) => open({ mode: 'alert', confirmText: 'Aceptar', ...normalize(opts) }),
    [open]
  );

  // Valor que devuelve la promesa al cerrar: alert resuelve undefined, confirm un booleano.
  const settle = (ok) => close(state?.mode === 'alert' ? undefined : ok);

  useEffect(() => {
    if (!state) return;
    const onKey = (e) => {
      if (e.key === 'Escape') settle(false);
      if (e.key === 'Enter') settle(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {state && (
        <div className="modal-backdrop" onMouseDown={() => settle(false)}>
          <div
            className={`modal modal-${state.tone}`}
            role="alertdialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {state.title && <h2 className="modal-title">{state.title}</h2>}
            {state.message && <p className="modal-message">{state.message}</p>}
            <div className="modal-actions">
              {state.mode === 'confirm' && (
                <button className="btn" onClick={() => settle(false)}>
                  {state.cancelText}
                </button>
              )}
              <button
                className={`btn ${state.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                autoFocus
                onClick={() => settle(true)}
              >
                {state.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
