// Runs the node:test suites compiled by tsconfig.test.json.
// TZ is fixed to Europe/Berlin so that the DST test cases are meaningful.
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--test', 'build/test/__tests__/**/*.test.js'], {
  stdio: 'inherit',
  env: { ...process.env, TZ: 'Europe/Berlin' },
});
process.exit(result.status ?? 1);
