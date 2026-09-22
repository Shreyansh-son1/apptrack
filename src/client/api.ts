import { z } from 'zod';
import {
  applicationSchema,
  type Application,
  type ApplicationInput,
  type ApplicationPatch,
  type ImportResult,
  type ListQuery,
  type Stats,
} from '../shared/index';

/**
 * An API failure carrying the field errors the server produced, so a form
 * can put each message next to the input it belongs to.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * One request helper for the whole client.
 *
 * The `schema` parameter is what makes this worth having: the caller says
 * what shape it expects and gets that type back, and the response is
 * parsed rather than cast, so a server that has drifted fails here with a
 * clear message instead of producing `undefined` deep inside a component.
 */
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });

  if (response.status === 204) {
    return schema.parse(undefined);
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = z
      .object({
        error: z.object({
          message: z.string(),
          fields: z.record(z.array(z.string())).optional(),
        }),
      })
      .safeParse(body);

    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error.message : 'Request failed',
      parsed.success ? (parsed.data.error.fields ?? {}) : {},
    );
  }

  return schema.parse(body);
}

const statsSchema = z.object({
  total: z.number(),
  byStatus: z.record(z.number()),
  dueCount: z.number(),
}) as unknown as z.ZodType<Stats>;

export const api = {
  list(query: ListQuery = {}): Promise<Application[]> {
    const params = new URLSearchParams();
    if (query.status !== undefined) params.set('status', query.status);
    if (query.q !== undefined && query.q !== '') params.set('q', query.q);
    if (query.dueOnly === true) params.set('dueOnly', 'true');
    const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
    return request(`/api/applications${suffix}`, z.array(applicationSchema));
  },

  create(input: ApplicationInput): Promise<Application> {
    return request('/api/applications', applicationSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  update(id: string, patch: ApplicationPatch): Promise<Application> {
    return request(`/api/applications/${id}`, applicationSchema, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  async remove(id: string): Promise<void> {
    await request(`/api/applications/${id}`, z.undefined(), { method: 'DELETE' });
  },

  importCsv(text: string): Promise<ImportResult> {
    return request(
      '/api/applications/import',
      z.object({
        imported: z.number(),
        skipped: z.number(),
        errors: z.array(z.object({ row: z.number(), issues: z.array(z.string()) })),
      }),
      { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: text },
    );
  },

  stats(): Promise<Stats> {
    return request('/api/stats', statsSchema);
  },
};
