import { useCallback, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { api } from './api';
import Sidebar from './components/Sidebar.jsx';
import Editor from './components/Editor.jsx';
import EmptyState from './components/EmptyState.jsx';
import RenderConsole from './components/RenderConsole.jsx';
import Library from './components/Library.jsx';
import Settings from './components/Settings.jsx';
import Inbox from './components/Inbox.jsx';
import Descargas from './components/Descargas.jsx';

const EMPTY_ASSETS = { avatares: [], imagenes: [], fondos: [], topVideos: [], voces: [], musica: [] };

export default function App() {
  const [scripts, setScripts] = useState([]);
  const [assets, setAssets] = useState(EMPTY_ASSETS);
  const [layouts, setLayouts] = useState([]);
  const [render, setRender] = useState(null); // { file, titulo } o null

  const reloadScripts = useCallback(async () => {
    try {
      setScripts(await api.listScripts());
    } catch (e) {
      console.error('No se pudo cargar la lista de guiones', e);
    }
  }, []);

  const reloadAssets = useCallback(async () => {
    try {
      setAssets(await api.assets());
    } catch (e) {
      console.error('No se pudieron cargar los assets', e);
    }
  }, []);

  const reloadLayouts = useCallback(async () => {
    try {
      setLayouts(await api.getLayouts());
    } catch (e) {
      console.error('No se pudieron cargar las plantillas', e);
    }
  }, []);

  useEffect(() => {
    reloadScripts();
    reloadAssets();
    reloadLayouts();
  }, [reloadScripts, reloadAssets, reloadLayouts]);

  const startRender = useCallback((file, titulo) => setRender({ file, titulo }), []);

  return (
    <div className="app">
      <Sidebar scripts={scripts} reloadScripts={reloadScripts} onRender={startRender} />
      <main className="main">
        <Routes>
          <Route path="/" element={<EmptyState reloadScripts={reloadScripts} />} />
          <Route
            path="/biblioteca"
            element={
              <Library
                assets={assets}
                reloadAssets={reloadAssets}
                layouts={layouts}
                reloadLayouts={reloadLayouts}
              />
            }
          />
          <Route path="/configuracion" element={<Settings />} />
          <Route path="/correo" element={<Inbox />} />
          <Route path="/descargas" element={<Descargas />} />
          <Route
            path="/g/:file"
            element={
              <Editor
                assets={assets}
                reloadScripts={reloadScripts}
                reloadAssets={reloadAssets}
                onRender={startRender}
                layouts={layouts}
              />
            }
          />
        </Routes>
      </main>
      {render && (
        <RenderConsole
          target={render}
          onClose={() => setRender(null)}
          reloadScripts={reloadScripts}
        />
      )}
    </div>
  );
}
