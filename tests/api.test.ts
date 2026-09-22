import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server/app';
import { openDatabase } from '../src/server/db';
import type { Application, ImportResult, Stats } from '../src/shared/index';

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  // ':memory:' gives every test a clean database with no file cleanup.
  app = createApp(openDatabase(':memory:'));
});

async function createOne(
  overrides: Record<string, unknown> = {},
): Promise<Application> {
  const response = await request(app)
    .post('/api/applications')
    .send({ company: 'Flexiple', role: 'Full Stack Developer', ...overrides });
  expect(response.status).toBe(201);
  return response.body as Application;
}

describe('POST /api/applications', () => {
  it('creates a record and assigns server-owned fields', async () => {
    const created = await createOne();
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.status).toBe('saved');
    expect(created.createdAt).toBe(created.updatedAt);
  });

  it('returns field-level errors for bad input', async () => {
    const response = await request(app).post('/api/applications').send({ company: '' });
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toHaveProperty('company');
    expect(response.body.error.fields).toHaveProperty('role');
  });

  it('will not let a client set its own id', async () => {
    const created = await createOne({ id: 'chosen-by-client' });
    expect(created.id).not.toBe('chosen-by-client');
  });
});

describe('GET /api/applications', () => {
  it('filters by status', async () => {
    await createOne({ company: 'A' });
    await createOne({ company: 'B', status: 'applied', appliedOn: '2026-09-01' });

    const response = await request(app).get('/api/applications?status=applied');
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect((response.body as Application[])[0]?.company).toBe('B');
  });

  it('searches company, role and notes', async () => {
    await createOne({ company: 'Flexiple' });
    await createOne({ company: 'Wadhwani AI', notes: 'referral from quiz club' });

    const byNote = await request(app).get('/api/applications?q=referral');
    expect(byNote.body).toHaveLength(1);
    expect((byNote.body as Application[])[0]?.company).toBe('Wadhwani AI');
  });

  it('rejects an unknown status in the query string', async () => {
    const response = await request(app).get('/api/applications?status=ghosted');
    expect(response.status).toBe(400);
  });
});

describe('PATCH /api/applications/:id', () => {
  it('applies a legal transition', async () => {
    const created = await createOne();
    const response = await request(app)
      .patch(`/api/applications/${created.id}`)
      .send({ status: 'applied', appliedOn: '2026-09-18' });

    expect(response.status).toBe(200);
    expect((response.body as Application).status).toBe('applied');
  });

  it('refuses an illegal transition with 409', async () => {
    const created = await createOne();
    await request(app)
      .patch(`/api/applications/${created.id}`)
      .send({ status: 'withdrawn' });

    const response = await request(app)
      .patch(`/api/applications/${created.id}`)
      .send({ status: 'offer' });

    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain('withdrawn');
  });

  it('rejects an empty patch', async () => {
    const created = await createOne();
    const response = await request(app)
      .patch(`/api/applications/${created.id}`)
      .send({});
    expect(response.status).toBe(400);
  });

  it('404s for an unknown id', async () => {
    const response = await request(app)
      .patch('/api/applications/does-not-exist')
      .send({ notes: 'x' });
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/applications/:id', () => {
  it('removes the record', async () => {
    const created = await createOne();
    expect((await request(app).delete(`/api/applications/${created.id}`)).status).toBe(204);
    expect((await request(app).get(`/api/applications/${created.id}`)).status).toBe(404);
  });
});

describe('POST /api/applications/import', () => {
  it('imports good rows and reports bad ones by row number', async () => {
    const csv = [
      'company,role,status,appliedOn',
      'Flexiple,Full Stack Developer,applied,2026-09-18',
      ',Missing Company,saved,',
      'Wadhwani AI,Full Stack Engineer,applied,not-a-date',
      'Triveous,Full Stack Developer,saved,',
    ].join('\n');

    const response = await request(app)
      .post('/api/applications/import')
      .set('Content-Type', 'text/csv')
      .send(csv);

    const result = response.body as ImportResult;
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.errors.map((e) => e.row)).toEqual([3, 4]);
  });

  it('handles quoted fields containing commas', async () => {
    const csv =
      'company,role,notes\nFlexiple,"Developer, Full Stack","Applied via LinkedIn, 2nd degree"';

    const response = await request(app)
      .post('/api/applications/import')
      .set('Content-Type', 'text/csv')
      .send(csv);

    expect((response.body as ImportResult).imported).toBe(1);
    const listed = await request(app).get('/api/applications');
    expect((listed.body as Application[])[0]?.role).toBe('Developer, Full Stack');
  });

  it('rejects a file with no usable header', async () => {
    const response = await request(app)
      .post('/api/applications/import')
      .set('Content-Type', 'text/csv')
      .send('name,thing\nx,y');

    expect((response.body as ImportResult).imported).toBe(0);
  });
});

describe('GET /api/stats', () => {
  it('reports zero for statuses with no records', async () => {
    await createOne();
    const response = await request(app).get('/api/stats');
    const stats = response.body as Stats;
    expect(stats.total).toBe(1);
    expect(stats.byStatus.saved).toBe(1);
    expect(stats.byStatus.offer).toBe(0);
  });
});
