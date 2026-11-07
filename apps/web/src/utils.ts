export function backendUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Enter a backend HTTPS address without credentials or query parameters.');
  if (url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Use HTTPS for a remote backend.');
  return url.href.replace(/\/$/, '').replace(/\/api\/v1$/, '');
}
export function clock(seconds = 0) { const n = Math.max(0, Math.floor(seconds)); return `${Math.floor(n / 3600) ? Math.floor(n / 3600) + ':' : ''}${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
export function safeImage(value?: string) { if (!value) return undefined; try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; } }
