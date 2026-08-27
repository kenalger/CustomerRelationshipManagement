import "dotenv/config";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set — start the local db with `npx prisma dev --name crm-local`");
}

/*
 * No `db.$disconnect()` anywhere in the tests, deliberately.
 *
 * `lib/db.ts` caches the client on `globalThis` so Next's dev reloads do not
 * exhaust the pool. That cache is shared between test files, so a file calling
 * `$disconnect()` in its own `afterAll` closed the client every LATER file was
 * still holding — "Server has closed the connection", in whichever suites
 * happened to run next.
 *
 * It failed intermittently because it depends on file order, and it got worse
 * as the suite grew: twenty-five files were doing it. Tests do not tear down a
 * shared singleton. The pool is released when the process exits.
 */
