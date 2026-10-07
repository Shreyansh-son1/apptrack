import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server/app';
import { openDatabase } from '../src/server/db';
import { ApplicationRepository } from '../src/server/repository';
import type {
  Application,
  ApplicationInput,
  ImportResult,
  Stats,
} from '../src/shared/index';

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

describe('editing an application (PATCH with several fields)', () => {
  it('changes several fields at once and leaves the rest alone', async () => {
    const created = await createOne({ notes: 'first note', source: 'naukri' });
    const response = await request(app)
      .patch(`/api/applications/${created.id}`)
      .send({ company: 'Flexiple Labs', role: 'Backend Developer', notes: 'edited' });

    expect(response.status).toBe(200);
    const updated = response.body as Application;
    expect(updated.company).toBe('Flexiple Labs');
    expect(updated.role).toBe('Backend Developer');
    expect(updated.notes).toBe('edited');
    expect(updated.source).toBe('naukri');
    expect(updated.createdAt).toBe(created.createdAt);
  });

  it('rejects a bad url with per-field errors', async () => {
    const created = await createOne();
    const response = await request(app)
      .patch(`/api/applications/${created.id}`)
      .send({ url: 'not-a-url' });
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toHaveProperty('url');
  });

  it('will not let an edit clear the applied date of a sent application', async () => {
    const created = await createOne({ status: 'applied', appliedOn: '2026-09-18' });
    const response = await request(app)
      .patch(`/api/applications/${created.id}`)
      .send({ appliedOn: '' });
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toHaveProperty('appliedOn');
  });

  it('will not let an edit put the follow-up before the applied date', async () => {
    const created = await createOne({ status: 'applied', appliedOn: '2026-09-18' });
    const response = await request(app)
      .patch(`/api/applications/${created.id}`)
      .send({ followUpOn: '2026-09-01' });
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toHaveProperty('followUpOn');
  });

  it('lets a saved posting be withdrawn without an applied date', async () => {
    const created = await createOne();
    const response = await request(app)
      .patch(`/api/applications/${created.id}`)
      .send({ status: 'withdrawn' });
    expect(response.status).toBe(200);
  });
});

describe('GET /api/applications/export', () => {
  it('is not mistaken for an id, and downloads as a CSV file', async () => {
    await createOne();
    const response = await request(app).get('/api/applications/export');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('applications.csv');
    expect(response.text.split('\n')[0]).toBe(
      'company,role,source,status,appliedOn,followUpOn,url,notes',
    );
  });

  it('round-trips: export, import into an empty database, get the same records', async () => {
    await createOne({
      company: 'Acme, Inc.',
      role: 'Dev "Lead"',
      source: 'referral',
      status: 'applied',
      appliedOn: '2026-09-18',
      followUpOn: '2026-09-25',
      url: 'https://example.com/jobs/1',
      notes: 'multi\nline, with "quotes"',
    });
    await createOne({ company: 'Formula', role: 'Tester', notes: '=HYPERLINK("http://x")' });
    await createOne({ company: 'Dash', role: 'Tester', notes: '- started with a dash' });
    await createOne({ company: 'Quote', role: 'Tester', notes: "'=already quoted" });

    const exported = await request(app).get('/api/applications/export');
    const originals = (await request(app).get('/api/applications')).body as Application[];

    const fresh = createApp(openDatabase(':memory:'));
    const imported = await request(fresh)
      .post('/api/applications/import')
      .set('Content-Type', 'text/csv')
      .send(exported.text);
    expect((imported.body as ImportResult).imported).toBe(4);
    expect((imported.body as ImportResult).skipped).toBe(0);

    const copies = (await request(fresh).get('/api/applications')).body as Application[];
    const strip = (a: Application) => ({
      company: a.company,
      role: a.role,
      source: a.source,
      status: a.status,
      appliedOn: a.appliedOn,
      followUpOn: a.followUpOn,
      url: a.url,
      notes: a.notes,
    });
    const byCompany = (a: Application, b: Application) => a.company.localeCompare(b.company);
    expect([...copies].sort(byCompany).map(strip)).toEqual(
      [...originals].sort(byCompany).map(strip),
    );
  });
});

describe('hardening', () => {
  it('sends standard security headers', async () => {
    const response = await request(app).get('/api/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['content-security-policy']).not.toContain(
      'upgrade-insecure-requests',
    );
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('answers 429 once a client exceeds the rate limit', async () => {
    const limited = createApp(openDatabase(':memory:'), { rateLimitPerMinute: 3 });
    for (let i = 0; i < 3; i += 1) {
      expect((await request(limited).get('/api/health')).status).toBe(200);
    }
    const blocked = await request(limited).get('/api/health');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toContain('Too many requests');
  });
});

describe('createMany is all-or-nothing', () => {
  it('rolls back every insert when one row fails partway', () => {
    const db = openDatabase(':memory:');
    const repo = new ApplicationRepository(db);

    const good: ApplicationInput = {
      company: 'Flexiple',
      role: 'Full Stack Developer',
      source: 'linkedin',
      status: 'saved',
      appliedOn: null,
      followUpOn: null,
      url: null,
      notes: '',
    };
    // A null source breaks the table's NOT NULL rule, so SQLite throws on
    // the second insert, after the first has already gone in.
    const bad = { ...good, company: 'Broken', source: null } as unknown as ApplicationInput;

    expect(() => repo.createMany([good, bad])).toThrow();
    expect(repo.list()).toHaveLength(0);
  });

  it('keeps everything when all rows are fine', () => {
    const repo = new ApplicationRepository(openDatabase(':memory:'));
    const row: ApplicationInput = {
      company: 'A',
      role: 'B',
      source: 'other',
      status: 'saved',
      appliedOn: null,
      followUpOn: null,
      url: null,
      notes: '',
    };
    expect(repo.createMany([row, { ...row, company: 'C' }])).toHaveLength(2);
    expect(repo.list()).toHaveLength(2);
  });
});
