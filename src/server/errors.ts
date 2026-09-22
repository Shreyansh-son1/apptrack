import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '../shared/index';

/** An error we raised on purpose, with an HTTP status attached. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(what = 'Record') {
    super(404, `${what} not found`);
    this.name = 'NotFoundError';
  }
}

/** A rejected status change, e.g. rejected -> offer. */
export class TransitionError extends AppError {
  constructor(from: string, to: string) {
    super(409, `Cannot move an application from ${from} to ${to}`);
    this.name = 'TransitionError';
  }
}

/** Flattens a ZodError into field -> messages for the client. */
export function fieldErrors(error: ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    const existing = result[key];
    if (existing) {
      existing.push(issue.message);
    } else {
      result[key] = [issue.message];
    }
  }
  return result;
}

/**
 * One place that turns any thrown value into a response. Express 4 needs
 * all four parameters for this to register as an error handler, which is
 * why `_next` is present but unused.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response<ApiErrorBody>,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: { message: 'Some fields need fixing', fields: fieldErrors(error) },
    });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }

  // Anything reaching here is unplanned. Log it, but do not leak internals.
  console.error('Unhandled error:', error);
  res.status(500).json({ error: { message: 'Something went wrong' } });
}
