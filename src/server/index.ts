import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app';
import { openDatabase } from './db';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../..');

const port = Number(process.env.PORT ?? 3001);
const dbFile = process.env.DATABASE_FILE ?? path.join(projectRoot, 'apptrack.db');

const db = openDatabase(dbFile);
const app = createApp(db);

// In production the API also serves the built React bundle, so the whole
// thing deploys as one service.
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(projectRoot, 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`apptrack API listening on http://localhost:${port}`);
});
