import { describe, expect, it } from 'vitest';
import {
  applicationInputSchema,
  applicationPatchSchema,
  isoDateSchema,
} from '../src/shared/index';

describe('isoDateSchema', () => {
  it('accepts a real date', () => {
    expect(isoDateSchema.safeParse('2026-02-28').success).toBe(true);
  });

  it('rejects the wrong shape', () => {
    expect(isoDateSchema.safeParse('28-02-2026').success).toBe(false);
  });

  it('rejects a date that does not exist', () => {
    // The regex passes, so this is caught by the refinement, not the shape.
    expect(isoDateSchema.safeParse('2026-02-31').success).toBe(false);
  });
});

describe('applicationInputSchema', () => {
  const minimal = { company: 'Flexiple', role: 'Full Stack Developer' };

  it('fills in defaults for a minimal record', () => {
    const result = applicationInputSchema.parse(minimal);
    expect(result.status).toBe('saved');
    expect(result.source).toBe('other');
    expect(result.notes).toBe('');
    expect(result.appliedOn).toBeNull();
  });

  it('trims whitespace', () => {
    const result = applicationInputSchema.parse({
      company: '  Flexiple  ',
      role: ' Full Stack Developer ',
    });
    expect(result.company).toBe('Flexiple');
  });

  it('requires a company', () => {
    const result = applicationInputSchema.safeParse({ company: '   ', role: 'SDE' });
    expect(result.success).toBe(false);
  });

  it('turns an empty url into null rather than failing', () => {
    const result = applicationInputSchema.parse({ ...minimal, url: '' });
    expect(result.url).toBeNull();
  });

  it('rejects a url that is not a url', () => {
    const result = applicationInputSchema.safeParse({ ...minimal, url: 'flexiple' });
    expect(result.success).toBe(false);
  });

  it('requires an applied date once the status is past saved', () => {
    const result = applicationInputSchema.safeParse({ ...minimal, status: 'applied' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['appliedOn']);
    }
  });

  it('accepts an applied record that has a date', () => {
    const result = applicationInputSchema.safeParse({
      ...minimal,
      status: 'applied',
      appliedOn: '2026-09-18',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a follow-up before the applied date', () => {
    const result = applicationInputSchema.safeParse({
      ...minimal,
      status: 'applied',
      appliedOn: '2026-09-18',
      followUpOn: '2026-09-01',
    });
    expect(result.success).toBe(false);
  });

  it('ignores unknown fields instead of storing them', () => {
    const result = applicationInputSchema.parse({ ...minimal, id: 'hacked', notes: 'x' });
    expect('id' in result).toBe(false);
  });
});

describe('applicationPatchSchema', () => {
  it('accepts a single field', () => {
    expect(applicationPatchSchema.safeParse({ status: 'withdrawn' }).success).toBe(true);
  });

  it('rejects an empty patch', () => {
    expect(applicationPatchSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(applicationPatchSchema.safeParse({ status: 'ghosted' }).success).toBe(false);
  });
});
