export const NOTE_MAX = 60;

const PATH_PREFIX = /^(\/|\.\.?\/|~\/)/;
const FILE_AFTER_SLASH = /\/[^/\s]+\.[A-Za-z0-9]+$/;

function looksLikePath(token: string): boolean {
  if (PATH_PREFIX.test(token)) return true;
  const slashes = token.split('/').length - 1;
  return slashes >= 2 || (slashes === 1 && FILE_AFTER_SLASH.test(token));
}

export function sanitizeNote(text: string): string {
  const cleaned = text
    .replaceAll('`', '')
    .split(/\s+/)
    .filter((token) => token && !looksLikePath(token))
    .join(' ')
    .trim();
  if (cleaned.length <= NOTE_MAX) return cleaned;
  return `${cleaned.slice(0, NOTE_MAX - 1).trimEnd()}…`;
}
