# Working through this project

This file is for me, not for reviewers. The repo is only worth anything if I
can answer questions about it cold, so this is the order to work through it in
and the questions to be able to answer by the end.

Rule: the project does not go on the CV until every question in the last
section has an answer I can give without opening the file.

## Day 1: TypeScript on its own, no project code

Open a scratch file and work through these until each one is boring:

- `type` vs `interface`, and when the difference actually matters
  (declaration merging, unions, extending)
- Union types, and narrowing them with `typeof`, `in`, and equality checks
- Literal types and `as const`. Why does `const x = ['a','b']` infer
  `string[]` but `as const` give `readonly ['a','b']`?
- `unknown` vs `any`. Why is `unknown` the safe one for data off the wire?
- Generics: write `function first<T>(items: T[]): T | undefined`
- Utility types: `Partial`, `Pick`, `Omit`, `Record`, `ReturnType`
- The `never` type and why `assertNever` works

Then read `tsconfig.json` and look up each strictness flag. `strict` is a
bundle; know what `noUncheckedIndexedAccess` does specifically, because it is
why several places in this codebase check for `undefined` after an array
index.

## Day 2: `src/shared/application.ts`

This is the whole project. Read it top to bottom, then:

- Delete a status from `ALLOWED_TRANSITIONS` and run `npm run typecheck`.
  Read the error. Put it back.
- Delete a `case` from `describeStatus` and typecheck. Read that error too:
  that is `assertNever` earning its place.
- Change `as const satisfies Record<Status, readonly Status[]>` to a plain
  type annotation. Notice what autocomplete loses. Understand why `satisfies`
  is the better tool here.
- Add a deliberately impossible date like `2026-02-31` to a test and watch
  which check catches it: the regex or the refinement.

## Day 3: the server

Read in this order: `errors.ts`, `repository.ts`, `app.ts`, `index.ts`.

- Trace one POST request from `app.post` through `applicationInputSchema.parse`
  into `repo.create` and back out. Write the path down.
- Find where a `ZodError` becomes a 400. Find where an unexpected error
  becomes a 500. Explain why the 500 branch does not send the message.
- In `repository.ts`, change `applicationSchema.parse(...)` to
  `... as Application` and run the tests. They still pass. Now explain why
  that is exactly the problem.

## Day 4: the tests

Run `npm test`. Then break things on purpose:

- Make `canTransition` always return `true`. Which tests fail?
- Remove the `superRefine` block. Which tests fail?
- Add a new status to `STATUSES` without updating anything else. What fails
  at typecheck, and what fails at test time?

Then write one test of your own that does not exist yet. Suggestion: a PATCH
that changes `company` should leave `status` untouched.

## Day 5: the client

- `api.ts` first. Understand the `schema: z.ZodType<T>` parameter and why the
  return type follows from it.
- Then `App.tsx`. The `Filter` type is a discriminated union: work out what
  would go wrong with `{ status: Status | null, dueOnly: boolean }` instead.
- Then the components. `NewApplicationForm` keeps its own `FormState` that is
  all strings. Be able to say why that is not the same type as
  `ApplicationInput` and why forcing them to match would be worse.

## Day 6: make it yours

Two changes, both small, both real:

1. Add a field. `salaryRange` or `contactName`. It touches the schema, the
   table, the repository, the form, and the row. Doing it end to end is the
   fastest way to feel how the shared schema pays off.
2. Import the real applications from this job search. Actual data in it turns
   "a project I built" into "a tool I use", which is a much better answer to
   "why did you build this".

## Day 7: deploy and tidy

- Deploy to Render as a single service: build `npm install && npm run build`,
  start `npm start`. Add a persistent disk for `apptrack.db`, or accept that
  the free tier resets and say so in the README.
- Commit in real increments, not one dump. The commit history is visible.
- Take a screenshot of it holding real data and put it at the top of the
  README.

## The defense checklist

Do not put this on the CV until all of these have an answer:

1. Why did you build it?
2. Why TypeScript here? Name a specific bug it stopped.
3. `type` vs `interface`, and which did you use where in this repo?
4. What does Zod give you that TypeScript does not? Why both?
5. Why is `Status` a union of literals instead of `string`?
6. What does `as const satisfies` do that a type annotation does not?
7. How does `assertNever` catch a missing switch case at compile time?
8. Walk a request from the form to SQLite and back, naming every point the
   data is checked.
9. Why parse database rows instead of casting them?
10. Where is there an `as` cast in this codebase, and why was it unavoidable?
11. Why is the illegal-transition response a 409 and not a 400?
12. Why does the CSV import validate row by row instead of all at once?
13. What breaks first at 100,000 records?
14. What would you change if a second person started using it?

15. Why does `update()` re-parse the merged record when the patch schema
    already validated the patch?
16. What does `responseRate` return when nothing has been sent, and why?
17. Why is the export route registered before `/:id`?
18. What is CSV formula injection, and how do export and import cancel each
    other out?
19. What does the rate limiter protect against, and what does it not?
20. What does the CI workflow check that running the tests locally does not?

If a question has no answer yet, that part of the code is not mine yet. Go
back and work through it until it is.
