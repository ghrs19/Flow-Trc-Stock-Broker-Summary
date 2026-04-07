const pool = require('./db');
const { fetchBrokerSummary } = require('./lib/stockbit');
const { upsertBrokerSummary } = require('./lib/upsert');

const DELAY_MS = parseInt(process.env.POPULATE_DELAY_MS, 10) || 2100;

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let date = null;
  let yesterday = false;

  for (const arg of args) {
    if (arg.startsWith('--date=')) {
      date = arg.split('=')[1];
    }
    if (arg === '--yesterday' || arg === '-1') {
      yesterday = true;
    }
  }

  if (!date) {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    if (yesterday) {
      now.setDate(now.getDate() - 1);
    }
    date = formatDate(now);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Usage: node src/cron-populate.js [--date=YYYY-MM-DD] [--yesterday|-1]');
    console.error('  No flag     → today (WIB)');
    console.error('  --yesterday → yesterday (WIB)');
    console.error('  -1          → yesterday (WIB)');
    console.error('  --date=...  → specific date');
    process.exit(1);
  }

  return { date };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getActiveStocks() {
  const result = await pool.query(
    `SELECT symbol FROM stocks WHERE is_active = true ORDER BY symbol`
  );
  return result.rows.map((row) => row.symbol);
}

async function run() {
  const { date } = parseArgs();
  const stocks = await getActiveStocks();

  console.log(`=== Broker Summary Populate ===`);
  console.log(`Date: ${date} | Stocks: ${stocks.length} | Delay: ${DELAY_MS}ms`);
  console.log(`Started at: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })} WIB`);
  console.log('');

  const startTime = Date.now();
  let success = 0;
  let failed = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < stocks.length; i++) {
    const symbol = stocks[i];
    const idx = `[${i + 1}/${stocks.length}]`;

    try {
      const { buyRows, sellRows } = await fetchBrokerSummary(symbol, date);
      const count = await upsertBrokerSummary(pool, symbol, date, buyRows, sellRows);

      if (count > 0) {
        console.log(`${idx} ${symbol} — ${count} rows upserted (buy: ${buyRows.length}, sell: ${sellRows.length})`);
        success++;
      } else {
        console.log(`${idx} ${symbol} — no data (skipped)`);
        skipped++;
      }
    } catch (err) {
      console.error(`${idx} ${symbol} — ERROR: ${err.message}`);
      errors.push({ symbol, error: err.message });
      failed++;
    }

    if (i < stocks.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log(`=== Summary ===`);
  console.log(`Success: ${success} | Failed: ${failed} | Skipped: ${skipped}`);
  console.log(`Duration: ${duration}s`);
  console.log(`Finished at: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })} WIB`);

  if (errors.length > 0) {
    console.log('');
    console.log(`=== Errors ===`);
    for (const e of errors) {
      console.log(`  ${e.symbol}: ${e.error}`);
    }
  }

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run();
