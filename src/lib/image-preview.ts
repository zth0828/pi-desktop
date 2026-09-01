export function parseDataUrl(src: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/s.exec(src);
  if (!match || !match[1] || !match[2]) return null;
  return { mimeType: match[1], data: match[2] };
}

export function mimeToExtension(mimeType: string): string {
  const clean = mimeType.toLowerCase().split(';')[0].trim();
  switch (clean) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/svg+xml':
      return 'svg';
    case 'image/bmp':
      return 'bmp';
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return 'ico';
    default:
      return 'png';
  }
}

export function suggestFileName(name?: string, mimeType = 'image/png'): string {
  const ext = mimeToExtension(mimeType);
  if (!name || !name.trim()) {
    return `image.${ext}`;
  }
  const trimmed = name.trim();
  if (/\.[a-zA-Z0-9]+$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}.${ext}`;
}

export function getImageSaveFilters(mimeType = 'image/png'): Array<{ name: string; extensions: string[] }> {
  const ext = mimeToExtension(mimeType);
  const label = `${ext.toUpperCase()} Image (*.${ext})`;
  return [
    { name: label, extensions: [ext] },
    { name: 'All Files (*.*)', extensions: ['*'] },
  ];
}

export async function resolveImageData(src: string): Promise<{ mimeType: string; data: string }> {
  const parsed = parseDataUrl(src);
  if (parsed) return parsed;
  const res = await fetch(src);
  const blob = await res.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const data = btoa(binary);
  const mimeType = blob.type || 'image/png';
  return { mimeType, data };
}
