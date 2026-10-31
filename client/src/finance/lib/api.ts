// Client for the payments & analytics API (mounted at /api/finance by server.js).
// Sends the signed-in user's Supabase access token, like the rest of the app.
const BASE = `${((import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000').replace(/\/$/, '')}/api/finance`;

let getToken: () => string | undefined = () => undefined;
/** FinancePage calls this with the current session's token. */
export function setTokenSource(fn: () => string | undefined) {
  getToken = fn;
}

export type Role = 'ADMIN' | 'STAFF' | 'CUSTOMER';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}

export interface ApiResult<T> {
  data: T;
  ms: number | null;
}

export async function apiRaw<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  const ms = Number.parseInt(res.headers.get('x-response-time') ?? '', 10);
  if (res.status === 204) return { data: undefined as T, ms: Number.isFinite(ms) ? ms : null };
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'HTTP_ERROR', e.message ?? `Request failed (${res.status})`, e.details);
  }
  return { data: body as T, ms: Number.isFinite(ms) ? ms : null };
}

export const api = {
  get: <T,>(path: string) => apiRaw<T>(path).then((r) => r.data),
  post: <T,>(path: string, body?: unknown) => apiRaw<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }).then((r) => r.data),
  patch: <T,>(path: string, body?: unknown) => apiRaw<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }).then((r) => r.data),
  delete: (path: string) => apiRaw<void>(path, { method: 'DELETE' }).then((r) => r.data),
};

export function qs(params: Record<string, string | number | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}
