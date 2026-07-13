import { parseFile } from 'music-metadata';

/** Devuelve la duración del audio en segundos (float). */
export async function getAudioDuration(filePath) {
  const metadata = await parseFile(filePath);
  const duration = metadata?.format?.duration;
  if (!duration || !Number.isFinite(duration)) {
    throw new Error('No se pudo determinar la duración del audio generado');
  }
  return duration;
}
