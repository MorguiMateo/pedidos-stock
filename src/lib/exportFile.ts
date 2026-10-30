import { Platform } from 'react-native';

/** Export actual portable files, not text messages truncated by a share target. */
export async function downloadText(filename: string, content: string, mime: string): Promise<void> {
  return downloadFile(filename, content, mime);
}
export async function downloadFile(filename: string, content: string | Uint8Array, mime: string): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([typeof content === 'string' ? content : new Uint8Array(content).buffer], { type: mime }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  const [{ File, Paths }, Sharing] = await Promise.all([import('expo-file-system'), import('expo-sharing')]);
  if (!await Sharing.isAvailableAsync()) throw new Error('No se puede compartir archivos desde este dispositivo. Usá la versión web para descargar el respaldo.');
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write(content);
  await Sharing.shareAsync(file.uri, { mimeType: mime.split(';')[0], dialogTitle: `Guardar o compartir ${filename}` });
}
