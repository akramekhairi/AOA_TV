export class ApiError extends Error { constructor(message: string, public status: number, public invalidCredentials = false, public retryAfterMs = 0) { super(message); } }
export async function request<T>(base: string, token: string, path: string, options: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(path.startsWith('/subtitles/') ? 70000 : 15000);
  const headers = new Headers(options.headers);
  if(token) headers.set('Authorization', `Bearer ${token}`);
  if(options.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try { response = await fetch(`${base}/api/v1${path}`, {...options, headers, cache:'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout}); }
  catch (error) { if(signal?.aborted) throw error; throw new ApiError(timeout.aborted ? 'The request timed out. Check your connection and try again.' : 'Cannot connect to AOA TV. Check your internet connection and try again.', 0); }
  if(!response.ok) {
    let message = response.status === 504 ? 'The service timed out. Try again shortly.'
      : [502,503].includes(response.status) ? 'The service is temporarily unavailable. Try again shortly.'
      : `Request failed (${response.status}). Please try again.`;
    let invalidCredentials = false;
    try { const body = await response.json(); invalidCredentials = response.status === 401 && ['Device token required', 'Device token invalid or revoked'].includes(body.error); if(typeof body.error === 'string') message = body.error.replace(/https?:\/\/\S+/gi, '[address hidden]').replace(/(?:password|token|username|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '[private value hidden]').slice(0,400); } catch { /* Non-JSON proxy error. */ }
    if(invalidCredentials) message = 'This phone is no longer paired. Pair again on your TV.';
    const retryAfter=response.headers.get('Retry-After');
    const retryDelay = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter)*1000 : retryAfter ? Date.parse(retryAfter)-Date.now() : NaN;
    const retryAfterMs = Number.isFinite(retryDelay) ? Math.max(1000,Math.min(600000,retryDelay)) : response.status===429 ? 60000 : 0;
    throw new ApiError(message, response.status, invalidCredentials, retryAfterMs);
  }
  const result = await response.json();
  signal?.throwIfAborted();
  return result as T;
}
