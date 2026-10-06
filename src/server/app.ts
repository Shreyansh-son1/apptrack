import express, {
  type Application as ExpressApp,
  type Request,
  type Response,
} from 'express';
import type Database from 'better-sqlite3';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import {
  applicationInputSchema,
  applicationPatchSchema,
  listQuerySchema,
  type Application,
  type ImportResult,
  type Stats,
} from '../shared/index';
import { errorHandler, NotFoundError } from './errors';
import { ApplicationRepository } from './repository';
import { importCsv, toCsv } from './csv';

/**
 * Wraps an async handler so a rejected promise reaches the error
 * middleware. Express 4 does not do this itself. The generics keep the
 * handler's own request and response types intact.
 */
function asyncRoute<Req extends Request, Res extends Response>(
  handler: (req: Req, res: Res) => Promise<void> | void,
) {
  return (req: Req, res: Res, next: express.NextFunction): void => {
    void Promise.resolve(handler(req, res)).catch(next);
  };
}

export interface AppOptions {
  /** Requests per minute per client on /api. Tests lower this to prove it works. */
  rateLimitPerMinute?: number;
}

export function createApp(
  db: Database.Database,
  { rateLimitPerMinute = 240 }: AppOptions = {},
): ExpressApp {
  const app = express();
  const repo = new ApplicationRepository(db);

  /*
   * Standard security headers. Helmet's default Content-Security-Policy
   * also sends `upgrade-insecure-requests`, which makes browsers try to
   * load this app's own assets over https. Over plain http://localhost
   * that breaks the page, so that one directive is switched off.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { 'upgrade-insecure-requests': null },
      },
    }),
  );

  // A single-user tool, but it can be exposed. A cap per client keeps a
  // runaway script (or a stranger) from hammering the database.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: rateLimitPerMinute,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { message: 'Too many requests, slow down' } },
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ type: 'text/csv', limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get(
    '/api/applications',
    asyncRoute((req, res: Response<Application[]>) => {
      // Query strings are `unknown` shaped, so they get parsed like any
      // other untrusted input rather than read field by field.
      const query = listQuerySchema.parse(req.query);
      res.json(repo.list(query));
    }),
  );

  /*
   * Registered BEFORE /api/applications/:id. Express matches routes in
   * order, so if this came after, "export" would be read as an id and
   * the request would 404.
   */
  app.get(
    '/api/applications/export',
    asyncRoute((_req, res) => {
      res
        .type('text/csv')
        .attachment('applications.csv')
        .send(toCsv(repo.list()));
    }),
  );

  app.get(
    '/api/applications/:id',
    asyncRoute((req, res: Response<Application>) => {
      const id = req.params.id;
      if (id === undefined) throw new NotFoundError('Application');
      res.json(repo.get(id));
    }),
  );

  app.post(
    '/api/applications',
    asyncRoute((req, res: Response<Application>) => {
      const input = applicationInputSchema.parse(req.body);
      res.status(201).json(repo.create(input));
    }),
  );

  app.patch(
    '/api/applications/:id',
    asyncRoute((req, res: Response<Application>) => {
      const id = req.params.id;
      if (id === undefined) throw new NotFoundError('Application');
      const patch = applicationPatchSchema.parse(req.body);
      res.json(repo.update(id, patch));
    }),
  );

  app.delete(
    '/api/applications/:id',
    asyncRoute((req, res) => {
      const id = req.params.id;
      if (id === undefined) throw new NotFoundError('Application');
      repo.remove(id);
      res.status(204).end();
    }),
  );

  app.post(
    '/api/applications/import',
    asyncRoute((req, res: Response<ImportResult>) => {
      const text = typeof req.body === 'string' ? req.body : '';
      res.json(importCsv(repo, text));
    }),
  );

  app.get(
    '/api/stats',
    asyncRoute((_req, res: Response<Stats>) => {
      res.json(repo.stats());
    }),
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { message: 'No such endpoint' } });
  });

  app.use(errorHandler);

  return app;
}
