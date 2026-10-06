import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Status
 *
 * A union of string literals, not `string`. This is the single most
 * useful typing decision in the project: the compiler now knows the
 * complete set of statuses, so a typo is a build error, a switch can
 * be checked for exhaustiveness, and the transition table below cannot
 * silently miss a case.
 * ------------------------------------------------------------------ */

export const STATUSES = [
  'saved',
  'applied',
  'screening',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
] as const;

export const statusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof statusSchema>;

/** Statuses where nothing further is expected from us. */
export const TERMINAL_STATUSES = ['rejected', 'withdrawn'] as const;

/**
 * Which statuses each status may move to.
 *
 * `satisfies` is doing real work here. It checks the shape (every
 * Status is a key, every value holds only valid Statuses) while
 * keeping the exact literal types of each array, so callers still get
 * precise autocomplete instead of a widened `Status[]`.
 */
export const ALLOWED_TRANSITIONS = {
  saved: ['applied', 'withdrawn'],
  applied: ['screening', 'interview', 'rejected', 'withdrawn'],
  screening: ['interview', 'rejected', 'withdrawn'],
  interview: ['offer', 'rejected', 'withdrawn'],
  offer: ['rejected', 'withdrawn'],
  rejected: [],
  withdrawn: [],
} as const satisfies Record<Status, readonly Status[]>;

export function canTransition(from: Status, to: Status): boolean {
  if (from === to) return true;
  const allowed: readonly Status[] = ALLOWED_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Throws at compile time if a switch over Status misses a case, and at
 * runtime if bad data somehow reaches it. The parameter type is `never`,
 * so if a new status is added and a switch is not updated, the call
 * below it stops compiling.
 */
export function assertNever(value: never, context = 'value'): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`);
}

/** Plain-language label. The switch is exhaustive, see assertNever. */
export function describeStatus(status: Status): string {
  switch (status) {
    case 'saved':
      return 'Saved, not applied yet';
    case 'applied':
      return 'Application sent';
    case 'screening':
      return 'In screening';
    case 'interview':
      return 'Interviewing';
    case 'offer':
      return 'Offer received';
    case 'rejected':
      return 'Rejected';
    case 'withdrawn':
      return 'Withdrawn';
    default:
      return assertNever(status, 'status');
  }
}

/* ------------------------------------------------------------------ *
 * Source
 * ------------------------------------------------------------------ */

export const SOURCES = [
  'linkedin',
  'naukri',
  'referral',
  'company-site',
  'other',
] as const;

export const sourceSchema = z.enum(SOURCES);
export type Source = z.infer<typeof sourceSchema>;

/* ------------------------------------------------------------------ *
 * Field schemas
 * ------------------------------------------------------------------ */

/** Calendar date as YYYY-MM-DD. Checked for shape and for real-date-ness. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return false;
    // Rejects 2026-02-31, which Date would otherwise roll over to March.
    return parsed.toISOString().slice(0, 10) === value;
  }, 'Not a real calendar date');

/** Empty string is treated as "not set" so form inputs can post "". */
const optionalUrlSchema = z
  .union([z.literal(''), z.string().url('Enter a full URL, including https://')])
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .default(null);

const optionalDateSchema = z
  .union([z.literal(''), isoDateSchema])
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .default(null);

/* ------------------------------------------------------------------ *
 * Application
 * ------------------------------------------------------------------ */

/**
 * What a client is allowed to send when creating a record.
 *
 * Note what is absent: id, createdAt, updatedAt. Those are the server's
 * to decide, so they are not in the input type at all and a client
 * cannot set them even by accident.
 */
export const applicationInputSchema = z
  .object({
    company: z.string().trim().min(1, 'Company is required').max(120),
    role: z.string().trim().min(1, 'Role is required').max(160),
    source: sourceSchema.default('other'),
    status: statusSchema.default('saved'),
    appliedOn: optionalDateSchema,
    followUpOn: optionalDateSchema,
    url: optionalUrlSchema,
    notes: z.string().trim().max(2000).default(''),
  })
  .superRefine((value, ctx) => {
    /*
     * A cross-field rule the type system cannot express: once an
     * application has been sent, an applied date is required. 'withdrawn'
     * is exempt, because a saved posting can be dropped without ever
     * having been applied to. This is the
     * clearest example in the project of why Zod earns its place
     * alongside TypeScript rather than duplicating it.
     */
    if (value.status !== 'saved' && value.status !== 'withdrawn' && value.appliedOn === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['appliedOn'],
        message: 'An applied date is required once the application has been sent',
      });
    }
    if (
      value.appliedOn !== null &&
      value.followUpOn !== null &&
      value.followUpOn < value.appliedOn
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['followUpOn'],
        message: 'Follow-up date cannot be before the applied date',
      });
    }
  });

export type ApplicationInput = z.infer<typeof applicationInputSchema>;

/** A stored record: the input plus the fields the server owns. */
export const applicationSchema = z.object({
  id: z.string().uuid(),
  company: z.string(),
  role: z.string(),
  source: sourceSchema,
  status: statusSchema,
  appliedOn: isoDateSchema.nullable(),
  followUpOn: isoDateSchema.nullable(),
  url: z.string().url().nullable(),
  notes: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Application = z.infer<typeof applicationSchema>;

/**
 * A partial update. Built from the object inside applicationInputSchema
 * rather than re-listing every field, so the two cannot drift apart.
 * `.partial()` is Zod's equivalent of the Partial<T> utility type.
 */
export const applicationPatchSchema = applicationInputSchema
  .innerType()
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Send at least one field to update',
  );

export type ApplicationPatch = z.infer<typeof applicationPatchSchema>;

/* ------------------------------------------------------------------ *
 * Query and response shapes
 * ------------------------------------------------------------------ */

export const listQuerySchema = z.object({
  status: statusSchema.optional(),
  q: z.string().trim().max(120).optional(),
  /** coerce, because query strings arrive as strings. */
  dueOnly: z.coerce.boolean().optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export type StatusCounts = Record<Status, number>;

export interface Stats {
  total: number;
  byStatus: StatusCounts;
  /** Records whose follow-up date is today or earlier and still open. */
  dueCount: number;
}

/** Every failed request has this shape, so the client handles one thing. */
export interface ApiErrorBody {
  error: {
    message: string;
    /** Field path -> messages, present only for validation failures. */
    fields?: Record<string, string[]>;
  };
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; issues: string[] }>;
}

/* ------------------------------------------------------------------ *
 * Small derived helpers, shared so client and server agree
 * ------------------------------------------------------------------ */

export function isTerminal(status: Status): boolean {
  const terminal: readonly Status[] = TERMINAL_STATUSES;
  return terminal.includes(status);
}

export function isFollowUpDue(
  application: Pick<Application, 'status' | 'followUpOn'>,
  today: string,
): boolean {
  if (application.followUpOn === null) return false;
  if (isTerminal(application.status)) return false;
  return application.followUpOn <= today;
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Pipeline numbers
 * ------------------------------------------------------------------ */

/**
 * Applications that actually went out. 'withdrawn' is left out on
 * purpose: the data does not say whether the person withdrew before or
 * after sending, so counting it either way would be a guess.
 */
export function applicationsSent(counts: StatusCounts): number {
  return (
    counts.applied +
    counts.screening +
    counts.interview +
    counts.offer +
    counts.rejected
  );
}

/**
 * Share of sent applications that got any reply, a rejection included
 * (a rejection is still an answer). Returns null when nothing has been
 * sent yet, so the UI shows a dash instead of dividing by zero.
 *
 * Caveat worth knowing: a company that never replies stays at 'applied',
 * so silence and "still waiting" look the same. This is a response rate,
 * not a success rate.
 */
export function responseRate(counts: StatusCounts): number | null {
  const sent = applicationsSent(counts);
  if (sent === 0) return null;
  const replied = sent - counts.applied;
  return replied / sent;
}
