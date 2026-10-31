import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { HttpError, badRequest } from './errors.js';

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw badRequest('VALIDATION_ERROR', 'Invalid input', result.error.flatten());
  return result.data;
}

export function pagination(query: Record<string, unknown>, defaultSize = 25) {
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(query.pageSize)) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

export function idParam(req: Request, name = 'id'): number {
  const id = Number(req.params[name]);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('INVALID_ID', `Invalid ${name}`);
  return id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParam(req: Request, name = 'id'): string {
  const id = req.params[name];
  if (!UUID_RE.test(id)) throw badRequest('INVALID_ID', `Invalid ${name}`);
  return id;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.flatten() } });
  }
  console.error(err);
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
}
