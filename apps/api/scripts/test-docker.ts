import { spawnSync } from 'node:child_process';
import path from 'node:path';

// `npm test` and `npm run test:watch`: the API's integration tests against the
// throwaway Postgres of docker-compose.yml (docs/infra.md#local-test-database).
// Arguments go to vitest: `npm test -- tests/login.test.ts`. CI runs it too, on
// PRs to dev. `npm run test:neon` runs plain vitest instead, against
// DATABASE_URL (CI on release PRs and manual runs, or apps/api/.env).
//
// The URL is fixed on purpose: this script migrates whatever it points at and
// the tests' cleanup runs there, so no environment variable can send it
// anywhere else. Set in the environment, it wins over apps/api/.env: dotenv and
// Prisma only fill in variables that are not already set.
const TEST_DB_URL = 'postgresql://ficha:ficha@127.0.0.1:5433/ficha_test';

const API = path.join(__dirname, '..');
const REPO = path.join(API, '..', '..');
const env = { ...process.env, DATABASE_URL: TEST_DB_URL, DIRECT_DATABASE_URL: TEST_DB_URL };

// Binaries are run through node rather than npx: on Windows npx is a .cmd,
// which needs a shell, and a shell would split arguments with spaces.
const bin = (pkg: string, file: string) => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), file);
const PRISMA = bin('prisma', 'build/index.js');
const VITEST = bin('vitest', 'vitest.mjs');

function run(command: string, args: string[], cwd: string, hint?: string): void {
  const { status, error } = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (error) console.error(error.message);
  if (status === 0) return;
  if (hint) console.error(hint);
  process.exit(status ?? 1);
}

run(
  'docker',
  ['compose', 'up', '--detach', '--wait', 'test-db'],
  REPO,
  'The test database did not start: is Docker running? `npm run test:neon` runs the suite against apps/api/.env.',
);
run(process.execPath, [PRISMA, 'migrate', 'deploy'], API);
run(process.execPath, [PRISMA, 'db', 'execute', '--file', 'prisma/audit-guards.sql', '--schema', 'prisma/schema.prisma'], API);
run(process.execPath, [VITEST, ...process.argv.slice(2)], API);
