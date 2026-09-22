import express, {
  type Application as ExpressApp,
  type Request,
  type Response,
} from 'express';
import type Database from 'better-sqlite3';
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
import { importCsv } from './csv';

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

export function createApp(db: Database.Database): ExpressApp {
  const app = express();
  const repo = new ApplicationRepository(db);

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
