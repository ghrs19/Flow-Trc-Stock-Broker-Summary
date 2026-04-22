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

function run() {
  try {
    ensureEnvCredentials();

    // 1) Force login using environment credentials (no interactive prompt)
    runStep('Step 1/3 - Force Login', 'npm', ['run', 'login', '--', '--force', '--env']);

    // 2) Populate OHLC for today only
    runStep('Step 2/3 - Populate OHLC Today', 'npm', ['run', 'populate:ohlc', '--', '--today']);

    // 3) Populate broker summary for today
    runStep('Step 3/3 - Populate Broker Summary', 'npm', ['run', 'populate']);

    console.log('\nAll steps completed successfully (sequential sync run).');
  } catch (err) {
    console.error(`\nFatal: ${err.message}`);
    process.exit(1);
  }
}

run();
