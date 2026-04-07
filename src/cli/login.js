require('dotenv').config();
const { auth } = require('../lib/stockbit');
const pool = require('../db');
const p = require('@clack/prompts');
const { color } = require('@clack/prompts');

async function run() {
  p.intro(p.bgCyan(p.black(' STOCKBIT LOGIN ')));

  try {
    // 1. Initial attempt to load from tokens or refresh
    const spinner = p.spinner();
    spinner.start('Checking authentication status');
    
    // loadToken will check .env and DB, and try refresh
    const loginResult = await auth.loadToken();
    
    if (auth.isTokenValid()) {
      spinner.stop('Token is valid');
    } else if (loginResult && loginResult.needsVerification) {
      spinner.stop('Trust verification required');
      await handleVerification(loginResult, process.env.STOCKBIT_EMAIL, process.env.STOCKBIT_PASSWORD);
    } else {
      spinner.stop('Authentication required');
      
      // 2. Prompt for credentials
      const group = await p.group(
        {
          email: () => p.text({
            message: 'Enter your Stockbit email',
            placeholder: 'email@example.com',
            validate: (value) => {
              if (!value) return 'Email is required';
              if (!value.includes('@')) return 'Invalid email format';
            },
          }),
          password: () => p.password({
            message: 'Enter your Stockbit password',
            validate: (value) => {
              if (!value) return 'Password is required';
            },
          }),
        },
        {
          onCancel: () => {
            p.cancel('Login cancelled');
            process.exit(0);
          },
        }
      );

      spinner.start('Authenticating with Stockbit');
      const freshLogin = await auth.login(group.email, group.password);

      if (auth.isTokenValid()) {
        spinner.stop('Login successful');
      } else if (freshLogin && freshLogin.needsVerification) {
        spinner.stop('New device trust request sent');
        await handleVerification(freshLogin, group.email, group.password);
      } else {
        spinner.stop('Login failed', 1);
        throw new Error('Could not finalize login. Please check your credentials.');
      }
    }

    // 3. Final success output
    const info = auth.getTokenInfo();
    p.note(
      `Status: ${info.isValid ? 'Authorized' : 'Expired'}\n` +
      `Expires: ${info.expiresAt}\n` +
      `Time Left: ${info.timeLeft}`,
      'Authentication Summary'
    );

    p.outro('Tokens are securely saved to your database and ready for use.');

  } catch (err) {
    p.log.error(err.message);
    p.outro('Operation failed');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function handleVerification(result, savedEmail, savedPass) {
  p.log.warn(`Mobile App Approval Required: ${result.deviceName}`);
  p.log.step('1. Open Stockbit mobile app on your phone');
  p.log.step('2. Find the "Trust This Device" prompt');
  p.log.step('3. Tap "Approve" (Setujui)');
  
  const approve = await p.confirm({
    message: 'Have you approved the request on your phone?',
    initialValue: true,
  });

  if (!approve) {
    p.cancel('Login verification aborted');
    process.exit(0);
  }

  const spinner = p.spinner();
  spinner.start('Finalizing authentication');
  
  // For V6 app flow, we retry the login call which now should return the tokens
  // If we have savedEmail/savedPass, we use them. 
  // Otherwise login() will use its internal state or throw if missing.
  await auth.login(savedEmail, savedPass);
  
  if (auth.isTokenValid()) {
    spinner.stop('Device trusted and logged in successfully');
  } else {
    spinner.stop('Verification failed', 1);
    throw new Error('Failed to finalize login after mobile approval.');
  }
}

run();
