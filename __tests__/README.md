# Backend tests

Two flavors live here:

- **Hermetic unit tests** (the default). Inspect pure functions / planned ops. Examples: `onboardingCal35Migration.test.js`, `backfillQuestionSlugs.test.js`. Fast, no I/O.
- **In-memory Mongo tests** (`*.e2e.test.js`). Spin up a real `mongodb-memory-server` per test file, exercise the actual `updateOne` / upsert path, then tear it down. Use these for migration scripts where the *Mongo behavior* is what's being asserted (idempotency, unique-index collisions, payload round-trip through Mongoose schemas).

## Migration test pattern

Use the helper at [helpers/mongoMemoryServer.js](helpers/mongoMemoryServer.js):

```js
const {
  setupMongoServer,
  teardownMongoServer,
  clearAllCollections,
} = require('./helpers/mongoMemoryServer');
const Question = require('../models/schemas/Question');
const { migrate } = require('../scripts/<your_migration>');

beforeAll(async () => {
  await setupMongoServer();
  await Question.init();          // build unique indexes before seeding
});
afterAll(teardownMongoServer);
afterEach(clearAllCollections);

test('does the thing', async () => {
  await Question.create({ /* seed pre-state */ });
  await migrate({ apply: true });
  const after = await Question.findOne({ /* ... */ }).lean();
  expect(after.someField).toBe(/* ... */);
});
```

Notes:

- **Export `migrate({ apply })` from your migration script** so tests can call it on the already-connected Mongoose instance. Keep the CLI `main()` wrapper, but make it a thin shell: connect → `migrate()` → disconnect. Throw on errors instead of `process.exit(1)` inside `migrate()` — `main()`'s `.catch()` exits the process.
- **Call `await Question.init()`** (or `Model.init()` for whatever schema you're seeding) in `beforeAll`. Mongoose builds unique indexes lazily; without `init()`, uniqueness violations in your test seed will silently pass.
- **Standalone, not replica set.** `MongoMemoryServer.create()` (not `.createReplSet()`) is faster and sufficient. Migrations that wrap ops in `withTransaction` should already fall back to non-transactional apply on standalone Mongo (see `isStandaloneTransactionError` in `migrate_onboarding_cal18.js`).
- **Silence noisy migrations** with `jest.spyOn(console, 'log').mockImplementation(() => {})` in `beforeEach` / restore in `afterEach`.

See [migrateOnboardingCal18.e2e.test.js](migrateOnboardingCal18.e2e.test.js) for the canonical worked example covering idempotency, fingerprint guards, deactivate-by-_id safety, and skipIf payload round-trip.

## Running

```bash
npm test                                          # full suite
npx jest __tests__/migrateOnboardingCal18.e2e     # one file
```

First run downloads the in-memory Mongo binary (~80 MB, cached afterward in `~/.cache/mongodb-binaries`). Allow ~30s on first invocation; subsequent runs are ~5-10s for the e2e suite.
