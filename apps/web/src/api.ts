export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function request<T>(base: string, token: string, path: string, options: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(15000);
  const headers = new Headers(options.headers);
  if(token) headers.set('Authorization', `Bearer ${token}`);
  if(options.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try { response = await fetch(`${base}/api/v1${path}`, {...options, headers, cache:'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout}); }
  catch (error) { if(signal?.aborted) throw error; throw new ApiError(timeout.aborted ? 'The backend may be waking up. Wait about a minute and try again.' : 'Cannot reach the backend. Check your connection and backend address, or retry in a minute if the backend is waking up.', 0); }
  if(!response.ok) {
    let message = `Request failed (${response.status}). Please try again.`;
    try { const body = await response.json(); if(typeof body.error === 'string') message = body.error.replace(/https?:\/\/\S+/gi, '[address hidden]').replace(/(?:password|token|username|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '[private value hidden]').slice(0,400); } catch { /* Non-JSON proxy error. */ }
    if(response.status===401 || response.status===403) message = token ? 'This phone is no longer paired. Pair again on your TV.' : 'Pairing code was rejected or expired. Generate a new code on your Roku.';
    if(response.status===502 || response.status===503 || response.status===504) message += ' The service may be waking up; retry in about a minute.';
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}
