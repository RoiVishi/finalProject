/**
 * Thin fetch wrapper for the NestJS backend.
 *  - attaches the bearer token when one is available
 *  - normalises Nest error bodies ({ statusCode, message: string | string[] })
 *    into ApiError with a list of user-readable (Hebrew) messages
 *  - reports 401 on an authenticated request so the app can log out
 * No React and no import.meta here, so it runs under `node --test`.
 */
import { he } from '../i18n/he.js';

export class ApiError extends Error {
  constructor(status, messages) {
    super(messages[0] ?? he.errors.generic);
    this.name = 'ApiError';
    this.status = status; // 0 = network failure / server unreachable
    this.messages = messages;
  }
}

function messagesFrom(body) {
  const m = body && body.message;
  if (Array.isArray(m)) return m.filter((x) => typeof x === 'string' && x);
  if (typeof m === 'string' && m) return [m];
  return [];
}

export function createApiClient({
  baseUrl = '/api',
  fetchImpl = (...a) => globalThis.fetch(...a),
  getToken = () => null,
  onUnauthorized = () => {},
} = {}) {
  async function request(method, path, body) {
    const token = getToken();
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, [he.errors.network]);
    }

    // 202 / 204 carry no body; anything else may or may not be JSON.
    const text = res.status === 204 ? '' : await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }

    if (res.ok) return data;

    if (res.status === 401 && token) onUnauthorized();
    // A proxy with the backend down answers 502/503/504 without a Nest body.
    if (res.status >= 502 && res.status <= 504) throw new ApiError(res.status, [he.errors.network]);
    const msgs = messagesFrom(data);
    throw new ApiError(res.status, msgs.length ? msgs : [he.errors.generic]);
  }

  return {
    request,
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b ?? {}),
    patch: (p, b) => request('PATCH', p, b ?? {}),
    del: (p) => request('DELETE', p),
  };
}
