import { stripFileExtension } from './meshUtils';

export const MAX_IMAGE_FILE_BYTES = 24 * 1024 * 1024; // 24 MB safety limit
const MAX_WEBGL_REFERENCE_DIM = 4096;

export interface LoadedImageReferencePayload {
  name: string;
  fileName: string;
  mimeType: string;
  imageDataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  wasResizedForWebGL: boolean;
}

export function isSupportedReferenceImageFile(file: {
  name: string;
  type: string;
}): boolean {
  const lower = file.name.toLowerCase();
  const mime = (file.type || '').toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/png') {
    return true;
  }
  return (
    lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png')
  );
}

export function detectImageMimeType(file: { name: string; type: string }): string {
  const mime = (file.type || '').toLowerCase();
  if (mime === 'image/png') return 'image/png';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'image/jpeg';
  return file.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('No se pudo codificar la imagen de referencia.'));
      }
    };
    reader.onerror = () =>
      reject(new Error('Error al leer el archivo de imagen desde el dispositivo.'));
    reader.readAsDataURL(blob);
  });
}

function measureImageElement(
  dataUrl: string,
): Promise<{ width: number; height: number; img: HTMLImageElement }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (width <= 0 || height <= 0) {
        reject(new Error('La imagen no tiene dimensiones válidas.'));
        return;
      }
      resolve({ width, height, img });
    };
    img.onerror = () =>
      reject(new Error('El archivo de imagen está dañado o no es compatible.'));
    img.src = dataUrl;
  });
}

export async function loadReferenceImageFile(
  file: File,
  expectedFormat?: 'jpg' | 'png',
): Promise<LoadedImageReferencePayload> {
  if (!isSupportedReferenceImageFile(file)) {
    throw new Error(
      'Formato no compatible. Selecciona una imagen JPG, JPEG o PNG.',
    );
  }

  const mime = detectImageMimeType(file);
  if (expectedFormat === 'jpg' && mime !== 'image/jpeg') {
    throw new Error('Selecciona una imagen en formato JPG o JPEG.');
  }
  if (expectedFormat === 'png' && mime !== 'image/png') {
    throw new Error('Selecciona una imagen en formato PNG.');
  }

  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error(
      `La imagen supera el límite seguro de ${Math.round(MAX_IMAGE_FILE_BYTES / (1024 * 1024))} MB para memoria de dispositivo.`,
    );
  }

  const rawDataUrl = await readBlobAsDataUrl(file);
  const { width, height, img } = await measureImageElement(rawDataUrl);

  let finalDataUrl = rawDataUrl;
  let finalWidth = width;
  let finalHeight = height;
  let wasResizedForWebGL = false;

  // Guard against exceeding iPad Safari WebGL max texture dimension (>4096px)
  if (width > MAX_WEBGL_REFERENCE_DIM || height > MAX_WEBGL_REFERENCE_DIM) {
    const ratio = Math.min(
      MAX_WEBGL_REFERENCE_DIM / width,
      MAX_WEBGL_REFERENCE_DIM / height,
    );
    finalWidth = Math.max(1, Math.round(width * ratio));
    finalHeight = Math.max(1, Math.round(height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = finalWidth;
    canvas.height = finalHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0, finalWidth, finalHeight);
      finalDataUrl = canvas.toDataURL(
        mime,
        mime === 'image/jpeg' ? 0.92 : undefined,
      );
      wasResizedForWebGL = true;
    }
  }

  return {
    name: stripFileExtension(file.name),
    fileName: file.name,
    mimeType: mime,
    imageDataUrl: finalDataUrl,
    naturalWidth: finalWidth,
    naturalHeight: finalHeight,
    wasResizedForWebGL,
  };
}
