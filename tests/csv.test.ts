import { describe, expect, it } from 'vitest';
import { escapeCell, parseCsv, toCsv } from '../src/server/csv';
import type { Application } from '../src/shared/index';

function application(overrides: Partial<Application> = {}): Application {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    company: 'Flexiple',
    role: 'Full Stack Developer',
    source: 'linkedin',
    status: 'applied',
    appliedOn: '2026-09-18',
    followUpOn: null,
    url: null,
    notes: '',
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('escapeCell', () => {
  it('leaves plain text alone', () => {
    expect(escapeCell('hello')).toBe('hello');
  });

  it('quotes commas, quotes and newlines, doubling inner quotes', () => {
    expect(escapeCell('a,b')).toBe('"a,b"');
    expect(escapeCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises anything a spreadsheet would run as a formula', () => {
    for (const bad of ['=SUM(A1)', '+1', '-1', '@cmd']) {
      expect(escapeCell(bad).startsWith("'")).toBe(true);
    }
  });
});

describe('toCsv', () => {
  it('writes a header row the importer accepts, then one line per record', () => {
    const lines = toCsv([application()]).trimEnd().split('\n');
    expect(lines[0]).toBe('company,role,source,status,appliedOn,followUpOn,url,notes');
    expect(lines[1]).toBe('Flexiple,Full Stack Developer,linkedin,applied,2026-09-18,,,');
  });

  it('writes just the header for an empty list', () => {
    expect(toCsv([])).toBe('company,role,source,status,appliedOn,followUpOn,url,notes\n');
  });

  it('survives being read back by the parser', () => {
    const tricky = application({ notes: 'said "ok", then\nleft' });
    const rows = parseCsv(toCsv([tricky]));
    expect(rows[1]?.[7]).toBe('said "ok", then\nleft');
  });
});

describe('parseCsv', () => {
  it('ignores a byte order mark so the first header still matches', () => {
    const rows = parseCsv('﻿company,role\nA,B\n');
    expect(rows[0]).toEqual(['company', 'role']);
  });
});
