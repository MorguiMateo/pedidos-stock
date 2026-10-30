import { MAX_PHOTO_LENGTH } from '@shared/features/clients/clientForm';

export async function preparePetPhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Elegí una foto JPG, PNG o WebP.');
  if (file.size > 10 * 1024 * 1024) throw new Error('La foto debe pesar menos de 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('No se pudo leer la foto.')); img.src = url; });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 50000000) throw new Error('La foto tiene dimensiones demasiado grandes. Elegí una imagen más pequeña.');
    const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la foto.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.7);
    if (data.length > MAX_PHOTO_LENGTH) throw new Error('La foto es demasiado grande. Elegí otra imagen.');
    return data;
  } finally { URL.revokeObjectURL(url); }
}
