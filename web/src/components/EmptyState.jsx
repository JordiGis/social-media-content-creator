import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clapperboard, Plus } from 'lucide-react';
import { api } from '../api';
import { useDialog } from './Dialog.jsx';

export default function EmptyState({ reloadScripts }) {
  const nav = useNavigate();
  const { alert } = useDialog();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await api.createScript({ titulo: 'Nuevo guion' });
      await reloadScripts();
      nav(`/g/${encodeURIComponent(res.file)}`);
    } catch (e) {
      alert({ title: 'No se pudo crear el guion', message: e.message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="empty">
      <div className="empty-emoji"><Clapperboard size={48} strokeWidth={1.5} /></div>
      <h1>Tus guiones por planos</h1>
      <p>
        Selecciona un guion en la izquierda, o crea uno nuevo.
        <br />
        Cada plano puede llevar su propio avatar, vídeo superior y fondo.
      </p>
      <button className="btn btn-primary" onClick={create} disabled={busy}>
        {busy ? 'Creando…' : <><Plus size={16} /> Crear guion</>}
      </button>
    </div>
  );
}
