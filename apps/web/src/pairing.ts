const legacyOrigin = 'https://aoa-tv-api.onrender.com';
export const tokenKey = (base: string) => `aoa.token:${base}`;

export function configuredOrigin(env: {VITE_API_URL?: string; VITE_API_BASE_URL?: string}): string {
  const value = (env.VITE_API_URL || env.VITE_API_BASE_URL || legacyOrigin).trim();
  if(!value) return legacyOrigin;
  const url = new URL(value);
  if(url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)
    || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('The configured API origin is invalid.');
  }
  return url.href.replace(/\/$/, '').replace(/\/api\/v1$/, '');
}

export function pairedToken(storage: Pick<Storage, 'getItem'|'setItem'|'removeItem'>, base: string): string {
  // Only this known deployment shares device state with the configured service.
  // Never use a saved arbitrary backend to choose where credentials are sent.
  storage.removeItem('aoa.backend');
  const current = storage.getItem(tokenKey(base));
  if(current) {
    if(base !== legacyOrigin) storage.removeItem(tokenKey(legacyOrigin));
    return current;
  }
  if(!base || base === legacyOrigin) return '';
  const legacy = storage.getItem(tokenKey(legacyOrigin));
  if(!legacy) return '';
  storage.setItem(tokenKey(base), legacy);
  storage.removeItem(tokenKey(legacyOrigin));
  return legacy;
}

export function phoneName(value: string): string {
  const name = value.trim();
  if(!name) throw new Error('Enter a phone name.');
  return name;
}

export interface PairingRequest {
  status: 'pending';
  expiresAt: string;
  reused: boolean;
  retryAfterSeconds?: number;
}

export function pairingCooldown(seconds = 30): number {
  return Math.max(30, Number.isFinite(seconds) ? Math.ceil(seconds) : 30);
}
