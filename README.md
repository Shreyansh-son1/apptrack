# apptrack

![CI](https://github.com/Shreyansh-son1/apptrack/actions/workflows/ci.yml/badge.svg)

A job application tracker built to learn TypeScript properly: React on the
front, Express and SQLite on the back, and one set of schemas shared by both.

I built it because I was running a high-volume job search and losing track of
which applications needed a follow-up. The interesting part is not the CRUD,
it is where the types live and what they are asked to do.

## What it does

- Track applications with company, role, source, dates, link and notes
- A status pipeline (saved, applied, screening, interview, offer, rejected,
  withdrawn) where only legal moves are allowed; the server answers `409` to
  an illegal one
- Edit any field of an application, with the same validation as creating one
- Follow-up dates, with a "needs a follow-up" view for anything due
- Search, status filters and a summary strip (tracked, sent, interviewing,
  offers, response rate)
- CSV import with per-row validation, and CSV export that imports back
  without loss

## Running it

```bash
npm install
npm run dev          # API on :3001, client on :5173
```

Other commands:

```bash
npm run typecheck    # tsc --noEmit, strict
npm test             # 64 tests, vitest
npm run build        # builds the client into dist/
npm start            # production: one process serves API + client
```

Data goes into `apptrack.db` (SQLite) in the project root. Override with
`DATABASE_FILE`. There is no auth: it is a single-user tool.

## Docker

```bash
docker compose up --build        # app on http://localhost:3001
```

A two-stage `Dockerfile`: the build stage installs everything, runs the strict
typecheck and builds the React bundle; the runtime stage installs production
dependencies only, copies in the built client and the server source, and runs as
the non-root `node` user. The SQLite file lives at `/data/apptrack.db` on a named
volume, so data survives `docker compose down` and rebuilds. A `HEALTHCHECK`
polls `/api/health`.

Two things I would change for a real deployment: run the server from compiled
JavaScript instead of `tsx`, and move off SQLite if there were more than one
instance (see below).

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

> once an application has been sent (any status except `saved` and
> `withdrawn`), an applied date is required

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

The good rows are inserted in one database transaction (`createMany`), so an
unexpected failure part-way leaves the table exactly as it was, instead of
half-imported. A test forces a failure on the second insert and checks nothing
was kept.

The parser is hand-written rather than a dependency, because handling quoted
fields and escaped quotes was the part I wanted to understand.

## Editing, the summary strip and export

**Editing re-validates the merged record.** `PATCH` accepts any subset of
fields, and the patch schema is the input schema made partial. Making a schema
partial drops its cross-field rules, so on its own an edit could clear the
applied date of a sent application. `repository.update` therefore merges the
patch into the stored record and runs the result through the full input schema.
The edit form sends only the fields that changed, and one `ApplicationForm`
component serves both "add" and "edit" so the two cannot drift apart.

**The response rate is arithmetic in shared code.** `responseRate` and
`applicationsSent` live in `src/shared` and have their own tests. A rejection
counts as a reply; `saved` and `withdrawn` are left out of "sent" because the
data does not say whether they ever went out. It returns `null` instead of
`NaN` when nothing has been sent. It is a response rate, not a success rate: a
company that never answers stays at "applied", the same as one that has not
answered yet.

**Export is the exact inverse of import.** `GET /api/applications/export`
writes the same columns the importer reads, quoting commas, quotes and
newlines. Any cell that starts with `=`, `+`, `-` or `@` gets a leading
apostrophe so a spreadsheet will not run it as a formula, and the importer
strips exactly one apostrophe back off. A test exports records with awkward
notes, imports them into an empty database and checks they match. The route is
registered before `/api/applications/:id`, otherwise Express would read
"export" as an id.

## Hardening and CI

- `helmet` sets the standard security headers. Its default
  `upgrade-insecure-requests` directive is switched off, because over plain
  `http://localhost` it makes the browser try to load the app's own assets over
  https.
- `express-rate-limit` caps each client at 240 requests a minute on `/api`
  (answers `429`). Behind a reverse proxy, set `TRUST_PROXY=1` so the limiter
  sees the real client address.
- Request bodies are size-limited, input is validated at the boundary, and
  every query is parameterised.
- GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, tests and the
  client build on every push and pull request, then builds the Docker image
  and checks that the container answers `/api/health`.

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/applications` | `?status=` `?q=` `?dueOnly=true` |
| POST | `/api/applications` | 201, or 400 with per-field errors |
| GET | `/api/applications/:id` | |
| PATCH | `/api/applications/:id` | any subset of fields; 409 on an illegal status change, 400 if the result would break a cross-field rule |
| DELETE | `/api/applications/:id` | 204 |
| POST | `/api/applications/import` | `text/csv` body |
| GET | `/api/applications/export` | downloads `applications.csv` |
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

**No accounts.** There is no login, so it is a single-user tool. Sharing it
would need authentication (sessions or JWT), per-user rows and Postgres.

**The status flow is my flow.** It assumes screening comes before interview
and that an offer is terminal. Someone else's pipeline would not match.
