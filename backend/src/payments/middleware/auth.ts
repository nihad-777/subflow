// Auth for the payments module. The frontend sends the Supabase access token
// (`Authorization: Bearer <token>`), same as the rest of the API. We verify it,
// then read the role from `profiles` (never from the token or the client).
// Result: req.user = { id, role } with role in upper case (ADMIN/STAFF/CUSTOMER).
//
// Verification, in order: SUPABASE_JWT_SECRET (HS256, used by tests), otherwise
// Supabase's /auth/v1/user endpoint with SUPABASE_ANON_KEY (works on every
// project, same check as server.js's requireUser), cached for 60 s per token.
import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { queryOne } from '../lib/db.js';
import { HttpError, forbidden } from '../lib/errors.js';

export type Role = 'ADMIN' | 'STAFF' | 'CUSTOMER';
export interface AuthUser {
  id: string; // profiles.id = auth.users.id (uuid)
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

const tokenCache = new Map<string, { sub: string; expires: number }>();

async function verifySupabaseToken(token: string): Promise<JWTPayload> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (secret) {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { audience: 'authenticated' });
    return payload;
  }
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url) throw new HttpError(500, 'AUTH_NOT_CONFIGURED', 'Set SUPABASE_URL and SUPABASE_ANON_KEY');
  if (!anon) {
    // Projects on the new asymmetric signing keys can be verified locally.
    jwks ??= createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`));
    const { payload } = await jwtVerify(token, jwks, { audience: 'authenticated' });
    return payload;
  }
  const cached = tokenCache.get(token);
  if (cached && cached.expires > Date.now()) return { sub: cached.sub };
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('invalid token');
  const user = (await res.json()) as { id?: string };
  if (!user.id) throw new Error('invalid token');
  if (tokenCache.size > 1000) tokenCache.clear();
  tokenCache.set(token, { sub: user.id, expires: Date.now() + 60_000 });
  return { sub: user.id };
}

async function loadProfile(id: string): Promise<AuthUser | null> {
  if (!UUID_RE.test(id)) return null;
  return queryOne<AuthUser>('SELECT id, upper(role::text) AS role FROM profiles WHERE id = $1', [id]);
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    if (req.user?.role) return next();
    req.user = undefined; // server.js's requireUser may have set a Supabase user without a role
    const header = req.header('authorization');
    if (header?.startsWith('Bearer ')) {
      let payload: JWTPayload;
      try {
        payload = await verifySupabaseToken(header.slice(7));
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(401, 'INVALID_TOKEN', 'Session expired or invalid. Sign in again.');
      }
      const user = payload.sub ? await loadProfile(payload.sub) : null;
      if (!user) throw new HttpError(403, 'NO_PROFILE', 'No profile found for this account');
      req.user = user;
    } else if (process.env.DEV_AUTH === 'true' && req.header('x-user-id')) {
      const user = await loadProfile(req.header('x-user-id')!);
      if (user) req.user = user;
    }
    if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required');
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in required'));
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
