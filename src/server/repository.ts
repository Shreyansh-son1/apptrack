import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  applicationInputSchema,
  applicationSchema,
  canTransition,
  isFollowUpDue,
  STATUSES,
  todayIso,
  type Application,
  type ApplicationInput,
  type ApplicationPatch,
  type ListQuery,
  type Stats,
  type Status,
  type StatusCounts,
} from '../shared/index';
import { NotFoundError, TransitionError } from './errors';

/**
 * The database gives back `unknown`-shaped rows with snake_case columns.
 * This is the only place that knows about that shape; everything above
 * this layer works with the `Application` type.
 */
interface Row {
  id: string;
  company: string;
  role: string;
  source: string;
  status: string;
  applied_on: string | null;
  follow_up_on: string | null;
  url: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

/**
 * Rows are parsed, not cast. A cast would only silence the compiler; if
 * a row were ever written by hand with a bad status, `as Application`
 * would happily lie about it and the bug would surface somewhere far
 * away. Parsing fails here, next to the cause.
 */
function toApplication(row: Row): Application {
  return applicationSchema.parse({
    id: row.id,
    company: row.company,
    role: row.role,
    source: row.source,
    status: row.status,
    appliedOn: row.applied_on,
    followUpOn: row.follow_up_on,
    url: row.url,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class ApplicationRepository {
  constructor(private readonly db: Database.Database) {}

  list(query: ListQuery = {}): Application[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (query.status !== undefined) {
      clauses.push('status = ?');
      params.push(query.status);
    }

    if (query.q !== undefined && query.q !== '') {
      clauses.push('(company LIKE ? OR role LIKE ? OR notes LIKE ?)');
      const like = `%${query.q}%`;
      params.push(like, like, like);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT * FROM applications ${where}
         ORDER BY COALESCE(follow_up_on, '9999-12-31') ASC, created_at DESC`,
      )
      .all(...params) as Row[];

    const applications = rows.map(toApplication);

    if (query.dueOnly === true) {
      const today = todayIso();
      return applications.filter((a) => isFollowUpDue(a, today));
    }
    return applications;
  }

  get(id: string): Application {
    const row = this.db
      .prepare('SELECT * FROM applications WHERE id = ?')
      .get(id) as Row | undefined;
    if (row === undefined) throw new NotFoundError('Application');
    return toApplication(row);
  }

  create(input: ApplicationInput): Application {
    const now = new Date().toISOString();
    const record: Application = {
      id: randomUUID(),
      company: input.company,
      role: input.role,
      source: input.source,
      status: input.status,
      appliedOn: input.appliedOn,
      followUpOn: input.followUpOn,
      url: input.url,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO applications
           (id, company, role, source, status, applied_on, follow_up_on, url, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.company,
        record.role,
        record.source,
        record.status,
        record.appliedOn,
        record.followUpOn,
        record.url,
        record.notes,
        record.createdAt,
        record.updatedAt,
      );

    return record;
  }

  /**
   * Inserts every record or none of them. better-sqlite3's `transaction`
   * wraps the function in BEGIN/COMMIT and rolls back if it throws, so a
   * failure on row 40 leaves the table exactly as it was before row 1.
   * It also makes a large import much faster: one commit, not one per row.
   */
  createMany(inputs: readonly ApplicationInput[]): Application[] {
    const insertAll = this.db.transaction((rows: readonly ApplicationInput[]) =>
      rows.map((row) => this.create(row)),
    );
    return insertAll(inputs);
  }

  update(id: string, patch: ApplicationPatch): Application {
    const current = this.get(id);

    if (patch.status !== undefined && !canTransition(current.status, patch.status)) {
      throw new TransitionError(current.status, patch.status);
    }

    /*
     * The patch schema is the input schema made partial, and making a
     * schema partial drops its cross-field rules. So the merged record
     * goes back through the full input schema: that is what stops an
     * edit from clearing the applied date on a sent application, or
     * moving the follow-up date before it.
     */
    const merged = applicationInputSchema.parse({ ...current, ...patch });

    const next: Application = {
      ...current,
      ...merged,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `UPDATE applications SET
           company = ?, role = ?, source = ?, status = ?,
           applied_on = ?, follow_up_on = ?, url = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.company,
        next.role,
        next.source,
        next.status,
        next.appliedOn,
        next.followUpOn,
        next.url,
        next.notes,
        next.updatedAt,
        id,
      );

    return next;
  }

  remove(id: string): void {
    const result = this.db.prepare('DELETE FROM applications WHERE id = ?').run(id);
    if (result.changes === 0) throw new NotFoundError('Application');
  }

  stats(): Stats {
    const rows = this.db
      .prepare('SELECT status, COUNT(*) AS count FROM applications GROUP BY status')
      .all() as Array<{ status: string; count: number }>;

    // Start every status at zero so the client never has to handle undefined.
    const byStatus = Object.fromEntries(
      STATUSES.map((status) => [status, 0]),
    ) as StatusCounts;

    let total = 0;
    for (const row of rows) {
      const status = row.status as Status;
      if (status in byStatus) {
        byStatus[status] = row.count;
        total += row.count;
      }
    }

    return { total, byStatus, dueCount: this.list({ dueOnly: true }).length };
  }
}
