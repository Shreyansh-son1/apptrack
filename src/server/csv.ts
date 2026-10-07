import {
  applicationInputSchema,
  type Application,
  type ImportResult,
} from '../shared/index';
import { fieldErrors } from './errors';
import type { ApplicationRepository } from './repository';

/**
 * A small CSV reader that handles quoted fields and escaped quotes.
 * Written rather than pulled in as a dependency because the parsing is
 * the interesting part: this is untrusted external input, and the whole
 * point of the import is that one bad row must not stop the good ones
 * or reach the database half-formed.
 */
export function parseCsv(input: string): string[][] {
  // Excel's "CSV UTF-8" puts a byte order mark at the start, which would
  // otherwise glue itself to the first header name.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1; // escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

/** Column order of the export. Every name is one the importer accepts. */
export const EXPORT_COLUMNS = [
  'company',
  'role',
  'source',
  'status',
  'appliedOn',
  'followUpOn',
  'url',
  'notes',
] as const;

/**
 * Spreadsheet apps run a cell as a formula if it starts with one of
 * these. Notes can be pasted from anywhere, so an exported cell like
 * `=HYPERLINK(...)` would execute when the file is opened. Prefixing an
 * apostrophe makes the cell plain text.
 */
const FORMULA_LIKE = /^'*[=+\-@]/;
const GUARDED = /^'+[=+\-@]/;

export function escapeCell(value: string): string {
  /*
   * Anything that is formula-like, or already looks like a guarded cell
   * (apostrophes then a formula character), gets one more apostrophe.
   * The importer strips exactly one, so the two are exact inverses.
   */
  const safe = FORMULA_LIKE.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The importer undoes the guard above, so export then import is lossless. */
function unguardCell(value: string): string {
  return GUARDED.test(value) ? value.slice(1) : value;
}

export function toCsv(applications: readonly Application[]): string {
  const lines = [EXPORT_COLUMNS.join(',')];
  for (const application of applications) {
    lines.push(
      [
        application.company,
        application.role,
        application.source,
        application.status,
        application.appliedOn ?? '',
        application.followUpOn ?? '',
        application.url ?? '',
        application.notes,
      ]
        .map(escapeCell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

const HEADER_ALIASES: Record<string, string> = {
  company: 'company',
  role: 'role',
  position: 'role',
  title: 'role',
  source: 'source',
  status: 'status',
  appliedon: 'appliedOn',
  applied: 'appliedOn',
  applieddate: 'appliedOn',
  followupon: 'followUpOn',
  followup: 'followUpOn',
  url: 'url',
  link: 'url',
  notes: 'notes',
};

function normaliseHeader(header: string): string | null {
  const key = header.trim().toLowerCase().replace(/[\s_-]/g, '');
  return HEADER_ALIASES[key] ?? null;
}

/**
 * Validates every row independently and reports the failures by row
 * number instead of rejecting the whole file. Rows are inserted in a
 * single transaction, so an unexpected failure mid-import leaves the
 * table as it was rather than half-populated.
 */
export function importCsv(
  repo: ApplicationRepository,
  text: string,
): ImportResult {
  const rows = parseCsv(text);
  const headerRow = rows[0];

  if (headerRow === undefined) {
    return { imported: 0, skipped: 0, errors: [{ row: 0, issues: ['File is empty'] }] };
  }

  const headers = headerRow.map(normaliseHeader);
  if (!headers.includes('company') || !headers.includes('role')) {
    return {
      imported: 0,
      skipped: 0,
      errors: [{ row: 1, issues: ['Header row must include company and role'] }],
    };
  }

  const errors: ImportResult['errors'] = [];
  const valid: Array<ReturnType<typeof applicationInputSchema.parse>> = [];

  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i] ?? [];
    const raw: Record<string, string> = {};

    headers.forEach((header, index) => {
      if (header === null) return;
      raw[header] = unguardCell((cells[index] ?? '').trim());
    });

    // Let schema defaults apply rather than sending empty strings through.
    for (const key of Object.keys(raw)) {
      if (raw[key] === '' && key !== 'appliedOn' && key !== 'followUpOn' && key !== 'url') {
        delete raw[key];
      }
    }

    const result = applicationInputSchema.safeParse(raw);
    if (result.success) {
      valid.push(result.data);
    } else {
      const fields = fieldErrors(result.error);
      const issues = Object.entries(fields).map(
        ([field, messages]) => `${field}: ${messages.join('; ')}`,
      );
      errors.push({ row: i + 1, issues });
    }
  }

  // One transaction: if any insert fails, none of the good rows are kept.
  repo.createMany(valid);

  return { imported: valid.length, skipped: errors.length, errors };
}
