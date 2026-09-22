# apptrack

A job application tracker built to learn TypeScript properly: React on the
front, Express and SQLite on the back, and one set of schemas shared by both.

I built it because I was running a high-volume job search and losing track of
which applications needed a follow-up. The interesting part is not the CRUD,
it is where the types live and what they are asked to do.

## Running it

```bash
npm install
npm run dev          # API on :3001, client on :5173
```

Other commands:

```bash
npm run typecheck    # tsc --noEmit, strict
npm test             # 42 tests, vitest
npm run build        # builds the client into dist/
npm start            # production: one process serves API + client
```

Data goes into `apptrack.db` (SQLite) in the project root. Override with
`DATABASE_FILE`. There is no auth: it is a single-user tool.

## Layout

```
src/shared/     Zod schemas, domain types, transition rules   <- the core
src/server/     Express app, repository, CSV import, errors
src/client/     React UI and the typed fetch layer
tests/          Validation, transitions, and HTTP-level tests
```

`src/shared` is imported by both sides. That single folder is the reason the
project is worth reading: the schema that validates a request body is the same
schema that produces the client's types, so the two cannot drift.

## The three decisions worth explaining

**1. Status is a union of literals, not a string.**

```ts
export const STATUSES = ['saved', 'applied', 'screening', 'interview',
                         'offer', 'rejected', 'withdrawn'] as const;
export type Status = (typeof STATUSES)[number];
```

Because the compiler knows the full set, the transition table cannot miss a
case, and `describeStatus` is checked for exhaustiveness through an
`assertNever` default branch. Add an eighth status and the build breaks in
every place that needs updating, which is what I wanted.

**2. Zod alongside TypeScript, not instead of it.**

TypeScript disappears at runtime; a request body is `unknown` no matter what
the type annotation says. Zod handles the runtime half, and `z.infer` derives
the static type from the same schema so there is one definition, not two.

It also expresses rules the type system cannot. This one is a cross-field
rule, so it lives in `superRefine` rather than in a type:

> once a record's status is past `saved`, an applied date is required

**3. Rows are parsed, not cast.**

`repository.ts` runs every database row through `applicationSchema.parse`
instead of `as Application`. A cast is a promise to the compiler, not a check:
a hand-edited row with `status = 'ghosted'` would sail through a cast and blow
up somewhere unrelated. Parsing fails at the boundary, next to the cause.

The same applies in the other direction: the client parses API responses too,
so a stale deploy produces a clear error rather than `undefined` inside a
component.

## CSV import

`POST /api/applications/import` takes pasted CSV. Every row is validated
independently and failures are reported by row number while the good rows
still import.

This is deliberate, and it comes from a bug I hit during an internship where
malformed records reached a store undetected because validation ran on the
batch rather than the row. Rejecting an entire file because line 40 has a typo
is the other failure mode, and it is almost as annoying.

The parser is hand-written rather than a dependency, because handling quoted
fields and escaped quotes was the part I wanted to understand.

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/applications` | `?status=` `?q=` `?dueOnly=true` |
| POST | `/api/applications` | 201, or 400 with per-field errors |
| GET | `/api/applications/:id` | |
| PATCH | `/api/applications/:id` | 409 on an illegal status change |
| DELETE | `/api/applications/:id` | 204 |
| POST | `/api/applications/import` | `text/csv` body |
| GET | `/api/stats` | counts by status, follow-ups due |

Every failure returns the same shape, so the client handles one thing:

```json
{ "error": { "message": "Some fields need fixing",
             "fields": { "appliedOn": ["An applied date is required..."] } } }
```

## What I would fix next

**SQLite and a single process.** Fine for one user and a few hundred rows.
Concurrent writers would need Postgres, and the `ORDER BY` with no pagination
would be the first thing to hurt at scale: the list endpoint loads every
matching row into memory before filtering due follow-ups. At a few hundred
records that is invisible; at a hundred thousand it is the bug.

**`dueOnly` filters in JavaScript, not SQL.** It was quicker to reuse the
shared `isFollowUpDue` helper than to duplicate the rule as a WHERE clause,
and keeping one definition of "due" mattered more than the query cost at this
size. It is still the wrong place for it.

**No optimistic concurrency.** Two tabs editing the same record will have
last-write-wins. The `updatedAt` field is there and would be the obvious thing
to check against.

**The status flow is my flow.** It assumes screening comes before interview
and that an offer is terminal. Someone else's pipeline would not match.
