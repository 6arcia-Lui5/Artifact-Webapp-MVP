// DATABASE_URL must be supplied externally; no shared schema receives writes.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
if (!process.env.DATABASE_URL) {
  console.error('Supply DATABASE_URL for an isolated discovery test schema.');
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, ['--test', path.join(__dirname, '../tests/discovery-decisions.test.cjs')], {
    env: { ...process.env, DISCOVERY_TEST_RUN: '1' }, stdio: 'inherit', windowsHide: true,
  });
  process.exitCode = result.status ?? 1;
}
