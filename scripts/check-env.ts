/**
 * Release env check — run with: npm run check-env
 * Reads .env (without overriding real environment variables), prints problems, exits 1 on any.
 */
import { checkEnv } from '../src/lib/check-env';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: rely on the process environment.
}

const problems = checkEnv(process.env);
if (problems.length > 0) {
  console.error('Release environment check FAILED:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('Release environment check passed.');
