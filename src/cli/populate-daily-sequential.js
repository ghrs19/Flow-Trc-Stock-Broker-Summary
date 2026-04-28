require('dotenv').config();
const { spawnSync } = require('child_process');

function runStep(title, command, args) {
  console.log(`\n=== ${title} ===`);
  console.log(`$ ${command} ${args.join(' ')}`);

  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw new Error(`${title} failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${title} failed with exit code ${result.status}`);
  }
}

function ensureEnvCredentials() {
  const usernameOrEmail = process.env.STOCKBIT_USERNAME || process.env.STOCKBIT_EMAIL;
  const password = process.env.STOCKBIT_PASSWORD;

  if (!usernameOrEmail || !password) {
    throw new Error(
      'Missing credentials in .env. Set STOCKBIT_USERNAME (or STOCKBIT_EMAIL) and STOCKBIT_PASSWORD.'
    );
  }
}

/**
 * Returns today's date in WIB (Asia/Jakarta) as YYYY-MM-DD string.
 */
function getTodayWIB() {
  return new Date()
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); // returns YYYY-MM-DD
}

function run() {
  try {
    ensureEnvCredentials();

    const today = getTodayWIB();
    console.log(`\nDaily sequential pipeline for date: ${today}`);

    // 1) Force login using environment credentials (no interactive prompt)
    runStep('Step 1/3 - Force Login', 'npm', ['run', 'login', '--', '--force', '--env']);

    // 2) Populate OHLC for today (WIB date, consistent with Step 3)
    runStep(
      'Step 2/3 - Populate OHLC Today',
      'npm',
      ['run', 'populate:ohlc', '--', `--from=${today}`, `--to=${today}`]
    );

    // 3) Populate broker summary for today (skip-aware: skips stocks already populated)
    runStep(
      'Step 3/3 - Populate Broker Summary',
      'npm',
      ['run', 'populate:history:date', '--', `--from=${today}`, `--to=${today}`]
    );

    console.log('\nAll steps completed successfully (sequential sync run).');
  } catch (err) {
    console.error(`\nFatal: ${err.message}`);
    process.exit(1);
  }
}

run();
