#!/usr/bin/env node
// Baja automáticamente los vídeos/música del "carrito" (descargas.json) para no
// tener que ir a mano por cada enlace. Deja el binario en STAGING (_pendientes)
// y marca el item como 'subido' reutilizando stageDescarga(), igual que cuando lo
// subes desde la web. Luego solo queda "registrar" desde la UI.
//
// Cómo resuelve cada enlace:
//   1. Enlace directo a un archivo (.mp4/.mp3…): lo descarga tal cual.
//   2. Búsqueda de Pixabay (pixabay.com/videos/search/<q>/): usa la API de vídeos
//      (necesita PIXABAY_API_KEY en .env), coge el mejor resultado y lo baja.
//   3. Resto (ncs.io, bensound, mixkit…): no tienen API fácil -> se salta y avisa
//      para bajarlo a mano.
//
// Baja VARIOS candidatos por card (top-N de la búsqueda) para poder elegir en la
// web el que más pegue; los demás se descartan sin borrar la card.
//
// Uso:
//   pnpm descargar              # cards sin candidatos aún (N por card)
//   pnpm descargar --n 6        # baja 6 candidatos por card
//   pnpm descargar --id abc123  # solo esa card
//   pnpm descargar --force      # añade más candidatos a cards ya bajadas
//   pnpm descargar --dry        # enseña qué bajaría, sin bajar nada

import path from 'node:path';
import { config } from '../src/config.js';
import { assetKind } from '../src/assets.js';
import { listDescargas, addCandidato } from '../src/descargas.js';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const onlyId = valOf('--id');
const force = has('--force');
const dry = has('--dry');
// Cuántos candidatos bajar por card (para poder elegir el que más pegue).
const N = Math.max(1, Number(valOf('--n')) || config.descargas.candidatos);

const log = (...a) => console.log(...a);

// Descarga una URL a Buffer (sigue redirecciones; falla claro si no es 2xx).
async function fetchBuffer(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'Mozilla/5.0 ContentCreator/descargar' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

// ¿La URL apunta directa a un archivo del tipo esperado? (por extensión)
function directExt(url, kind) {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return assetKind(kind).ext.has(ext) ? ext : null;
}

// Extrae el término de búsqueda de un enlace pixabay .../search/<q>/
function pixabayQuery(url) {
  const m = new URL(url).pathname.match(/\/search\/([^/]+)/);
  return m ? decodeURIComponent(m[1]).replace(/\+/g, ' ') : '';
}

// Consulta la API de vídeos de Pixabay y devuelve hasta `n` hits [{mp4Url, pageURL}]
// para poder elegir. `preferVertical` prioriza clips 9:16 (vídeos 'top'/'fondos').
async function pixabayPickMany(query, n, preferVertical) {
  const key = config.descargas.pixabayApiKey;
  if (!key) throw new Error('Falta PIXABAY_API_KEY en .env (clave gratis en pixabay.com/api/docs)');
  const api = new URL('https://pixabay.com/api/videos/');
  api.searchParams.set('key', key);
  api.searchParams.set('q', query);
  api.searchParams.set('per_page', '50');
  const data = JSON.parse((await fetchBuffer(api.toString())).toString('utf8'));
  const hits = Array.isArray(data.hits) ? data.hits : [];
  if (!hits.length) throw new Error(`Pixabay sin resultados para "${query}"`);
  // De cada hit, la variante más pequeña con lado mayor >= 1280px (FHD basta para
  // el lienzo 1080; evita bajar 4K de 200 MB). Si ninguna llega, la mayor.
  const best = (h) => {
    const vs = Object.values(h.videos || {}).filter((v) => v && v.url);
    const byArea = [...vs].sort(
      (a, b) => (a.width || 0) * (a.height || 0) - (b.width || 0) * (b.height || 0)
    );
    const bigSide = (v) => Math.max(v.width || 0, v.height || 0);
    return byArea.find((v) => bigSide(v) >= 1280) || byArea[byArea.length - 1];
  };
  const scored = hits.map((h) => ({ h, v: best(h) })).filter((x) => x.v);
  scored.sort((a, b) => {
    if (preferVertical) {
      const va = a.v.height > a.v.width ? 1 : 0;
      const vb = b.v.height > b.v.width ? 1 : 0;
      if (va !== vb) return vb - va; // verticales primero
    }
    return (b.v.width || 0) * (b.v.height || 0) - (a.v.width || 0) * (a.v.height || 0);
  });
  if (!scored.length) throw new Error(`Pixabay sin variante descargable para "${query}"`);
  return scored.slice(0, n).map((x) => ({ mp4Url: x.v.url, pageURL: x.h.pageURL || '' }));
}

// Resuelve una card -> lista de candidatos [{url, origName, pageURL?}] a bajar.
// Lanza si no se puede automatizar (música sin API, etc.).
async function resolveMany(card) {
  // 1. Enlace directo a archivo del tipo correcto -> un único candidato.
  const ext = directExt(card.url, card.kind);
  if (ext) return [{ url: card.url, origName: `${card.id}${ext}` }];

  // 2. Búsqueda de VÍDEOS de Pixabay -> API, hasta N candidatos. Solo para kinds
  //    de vídeo: Pixabay no tiene API de audio, así que /music/search/ NO cuela
  //    (bajaría vídeos por error). La música clásica se baja a mano.
  const esVideoKind = card.kind === 'top' || card.kind === 'fondos';
  if (esVideoKind && card.fuente === 'pixabay.com' && /\/videos\/search\//.test(card.url)) {
    const q = pixabayQuery(card.url);
    const hits = await pixabayPickMany(q, N, true);
    return hits.map((h, i) => ({ url: h.mp4Url, origName: `${card.id}-${i + 1}.mp4`, pageURL: h.pageURL }));
  }

  // 3. Sin automatización posible (música Pixabay/otros, páginas de clip ya usadas…).
  throw new Error('enlace no auto-descargable (bájalo a mano y súbelo desde la web)');
}

async function main() {
  const all = await listDescargas();
  // Por defecto solo cards sin candidatos (para no re-bajar). --force baja también
  // en cards que ya tienen candidatos (añade más para elegir). --id fuerza una.
  const cards = all.filter((d) => {
    if (onlyId) return d.id === onlyId;
    if (d.estado === 'registrado') return false; // ya cerradas, nada que bajar
    return !(d.candidatos || []).length || force;
  });
  if (onlyId && !cards.length) {
    log(`No hay card con id "${onlyId}".`);
    process.exit(1);
  }
  if (!cards.length) {
    log('Nada por bajar. (usa --force para añadir más candidatos a cards ya bajadas)');
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const card of cards) {
    const tag = `[${card.id}] ${card.titulo || card.url}`;
    let cands;
    try {
      cands = await resolveMany(card);
    } catch (e) {
      log(`✗ ${tag}: ${e.message}`);
      fail++;
      continue;
    }
    log(`↓ ${tag}  (${cands.length} candidato${cands.length > 1 ? 's' : ''})`);
    for (const c of cands) {
      try {
        if (dry) {
          log(`    ~ ${c.url}`);
          continue;
        }
        const buffer = await fetchBuffer(c.url);
        // Deja como url del candidato la página del clip (atribución/repro) si la hay.
        await addCandidato(card.id, c.origName, buffer, c.pageURL || c.url);
        log(`    ✓ ${(buffer.length / 1e6).toFixed(1)} MB`);
        ok++;
      } catch (e) {
        log(`    ✗ ${e.message}`);
        fail++;
      }
    }
  }
  log(`\nHecho. ${ok} candidatos bajados, ${fail} fallidos/omitidos. Revisa y marca válidos en la web.`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
