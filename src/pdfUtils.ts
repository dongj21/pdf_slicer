export function megabytesToBytes(value: number): number {
  return Math.floor(value * 1_000_000);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1000 && unitIndex < units.length - 1) {
    size /= 1000;
    unitIndex += 1;
  }

  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

export function getBasePdfName(filename: string): string {
  return filename.replace(/\.pdf$/i, '') || 'document';
}

export function getPartFilename(originalName: string, index: number): string {
  const safeBaseName = getBasePdfName(originalName)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'document';

  return `${safeBaseName}_part-${String(index).padStart(3, '0')}.pdf`;
}
