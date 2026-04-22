require('dotenv').config();
const { auth } = require('../lib/stockbit');
const pool = require('../db');

/**
 * Note: @clack/prompts is an ESM-only module. 
 * Since this project is CommonJS, we must use dynamic import() inside an async function.
 */

async function run() {
  const p = await import('@clack/prompts');
  const resolveEnvCredentials = () => {
    const email = process.env.STOCKBIT_USERNAME || process.env.STOCKBIT_EMAIL;
    const password = process.env.STOCKBIT_PASSWORD;
    return { email, password };
  };

  // Move verification logic inside to share the dynamic 'p' import
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
    
    await auth.login(savedEmail, savedPass);
    
    if (auth.isTokenValid()) {
      spinner.stop('Device trusted and logged in successfully');
    } else {
      spinner.stop('Verification failed', 1);
      throw new Error('Failed to finalize login after mobile approval.');
    }
  }

  const args = process.argv.slice(2);
  const forceFresh = args.includes('--force') || args.includes('-f');
  const useEnv = args.includes('--env');
  p.intro(' STOCKBIT LOGIN ');

  try {
    const spinner = p.spinner();
    spinner.start('Checking authentication status');
    
    let loginResult = null;
    try {
      loginResult = await auth.loadToken();
    } catch (err) {
      // Ignore error to allow manual login fallback
    }
    
    if (auth.isTokenValid() && !forceFresh) {
      spinner.stop('Token is valid (Cached)');
    } else if (loginResult && loginResult.needsVerification && !forceFresh) {
      spinner.stop('Trust verification required');
      const creds = resolveEnvCredentials();
      if (!creds.email || !creds.password) {
        throw new Error('Trust verification needs credentials. Set STOCKBIT_USERNAME (or STOCKBIT_EMAIL) and STOCKBIT_PASSWORD.');
      }
      await handleVerification(loginResult, creds.email, creds.password);
    } else {
      if (forceFresh) {
        spinner.stop('Forced fresh login initiated');
      } else {
        spinner.stop('Authentication required');
      }

      let email;
      let password;

      if (useEnv) {
        const creds = resolveEnvCredentials();
        if (!creds.email || !creds.password) {
          throw new Error('Missing environment credentials. Set STOCKBIT_USERNAME (or STOCKBIT_EMAIL) and STOCKBIT_PASSWORD.');
        }
        email = creds.email;
        password = creds.password;
      } else {
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
        email = group.email;
        password = group.password;
      }

      spinner.start(useEnv ? 'Authenticating with Stockbit using environment credentials' : 'Authenticating with Stockbit');
      const freshLogin = await auth.login(email, password);

      if (auth.isTokenValid()) {
        spinner.stop('Login successful');
      } else if (freshLogin && freshLogin.needsVerification) {
        spinner.stop('New device trust request sent');
        if (useEnv) {
          throw new Error('Login needs mobile app approval. Run "npm run login" to approve this device, then retry.');
        }
        await handleVerification(freshLogin, email, password);
      } else {
        spinner.stop('Login failed', 1);
        throw new Error('Could not finalize login. Please check your credentials.');
      }
    }

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

run();
