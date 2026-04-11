require('dotenv').config();
const pool = require('../db');
const { fetchOHLC } = require('../lib/stockbit');
const { upsertStockPrices } = require('../lib/upsert');

const DELAY_MS = 1650;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parses relative range like "5mo", "10d", "1y"
 */
function parseRelativeRange(rangeStr) {
  const match = rangeStr.match(/^(\d+)(d|w|mo|y)$/);
  if (!match) throw new Error(`Invalid range format: "${rangeStr}". Use e.g. 5mo, 10d, 1y, 2y`);

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const date = new Date();
  date.setHours(0, 0, 0, 0);

  switch (unit) {
    case 'd':  date.setDate(date.getDate() - value); break;
    case 'w':  date.setDate(date.getDate() - value * 7); break;
    case 'mo': date.setMonth(date.getMonth() - value); break;
    case 'y':  date.setFullYear(date.getFullYear() - value); break;
  }
  return date;
}

function toDateStr(date) {
  const yyyy = date.getFullYear();
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const dd   = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function printUsage() {
  console.log(`
Usage:
  node src/cli/populate-ohlc.js [options]

Options:
  --from=YYYY-MM-DD   Start date (required unless --range is set)
  --to=YYYY-MM-DD     End date   (default: today)
  --range=<N><unit>   Relative range from today: e.g. 5mo, 10d, 1y, 2y
  --symbol=CODE       Process a single stock only (e.g. --symbol=BBCA)
  --limit=N           Cap number of stocks fetched (for testing)
  --create-table      Auto-create stock_ohlc_prices table if it doesn't exist

Examples:
  node src/cli/populate-ohlc.js --range=1y
  node src/cli/populate-ohlc.js --from=2024-01-01 --to=2024-12-31
  node src/cli/populate-ohlc.js --symbol=BBCA --range=6mo
  node src/cli/populate-ohlc.js --range=1y --limit=5 --create-table
`);
}

async function createTableIfNeeded(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_ohlc_prices (
      trade_date        DATE          NOT NULL,
      stock_code        VARCHAR(10)   NOT NULL,
      open              INTEGER       NOT NULL DEFAULT 0,
      high              INTEGER       NOT NULL DEFAULT 0,
      low               INTEGER       NOT NULL DEFAULT 0,
      close             INTEGER       NOT NULL DEFAULT 0,
      volume            BIGINT        NOT NULL DEFAULT 0,
      value             BIGINT        NOT NULL DEFAULT 0,
      frequency         INTEGER       NOT NULL DEFAULT 0,
      foreign_buy       BIGINT        NOT NULL DEFAULT 0,
      foreign_sell      BIGINT        NOT NULL DEFAULT 0,
      foreign_flow      BIGINT        NOT NULL DEFAULT 0,
      dividend          NUMERIC(18,4) NOT NULL DEFAULT 0,
      share_outstanding BIGINT        NOT NULL DEFAULT 0,
      created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      PRIMARY KEY (trade_date, stock_code)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_stock_ohlc_prices_stock_code ON stock_ohlc_prices (stock_code)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_stock_ohlc_prices_trade_date ON stock_ohlc_prices (trade_date DESC)`);
  console.log('✅ Table stock_ohlc_prices is ready.\n');
}

async function run() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const fromArg       = args.find(a => a.startsWith('--from='))?.split('=')[1];
  const toArg         = args.find(a => a.startsWith('--to='))?.split('=')[1];
  const rangeArg      = args.find(a => a.startsWith('--range='))?.split('=')[1];
  const symbolArg     = args.find(a => a.startsWith('--symbol='))?.split('=')[1]?.toUpperCase();
  const limitArg      = args.find(a => a.startsWith('--limit='))?.split('=')[1];
  const createTable   = args.includes('--create-table');

  // Resolve date range
  let startDate, endDate;

  if (fromArg) {
    startDate = new Date(fromArg);
    endDate   = toArg ? new Date(toArg) : new Date();
  } else if (rangeArg) {
    startDate = parseRelativeRange(rangeArg);
    endDate   = new Date();
  } else {
    console.error('❌ Error: --from=YYYY-MM-DD or --range=<N><unit> is required.\n');
    printUsage();
    process.exit(1);
  }

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);

  const startStr = toDateStr(startDate);
  const endStr   = toDateStr(endDate);

  if (startDate > endDate) {
    console.error(`❌ Error: start date (${startStr}) must be before end date (${endStr}).`);
    process.exit(1);
  }

  console.log('🚀 OHLC Population Started');
  console.log(`📅 Date range : ${startStr} → ${endStr}`);
  console.log(`⏱️  Delay      : ${DELAY_MS}ms per symbol`);

  try {
    // Auto-create table if requested
    if (createTable) {
      await createTableIfNeeded(pool);
    }

    // Load symbols
    let symbolsQuery = 'SELECT code FROM stocks WHERE is_active = true ORDER BY code ASC';
    const queryParams = [];

    if (symbolArg) {
      symbolsQuery = 'SELECT code FROM stocks WHERE code = $1';
      queryParams.push(symbolArg);
    } else if (limitArg) {
      symbolsQuery += ` LIMIT ${parseInt(limitArg, 10)}`;
    }

    const stocksRes = await pool.query(symbolsQuery, queryParams);
    const symbols   = stocksRes.rows.map(r => r.code);

    if (symbols.length === 0) {
      console.log('⚠️  No active stocks found. Exiting.');
      process.exit(0);
    }

    console.log(`📦 Stocks to process: ${symbols.length}\n`);

    let totalUpserted = 0;
    let totalErrors   = 0;

    // Process each symbol — fetch newest → oldest (one API call per symbol)
    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      const prefix = `[${String(i + 1).padStart(String(symbols.length).length)}/${symbols.length}] ${symbol}`;

      process.stdout.write(`${prefix}: fetching ${startStr} → ${endStr}... `);

      try {
        // fetchOHLC(symbol, startDate, endDate) handles date reversal internally
        const candles = await fetchOHLC(symbol, startStr, endStr);

        if (candles.length === 0) {
          process.stdout.write(`⚠️  no data\n`);
        } else {
          const count = await upsertStockPrices(pool, symbol, candles);
          totalUpserted += count;
          process.stdout.write(`✅ ${count} candles upserted\n`);
        }
      } catch (err) {
        totalErrors++;
        process.stdout.write(`\n`);
        console.error(`  ❌ Error: ${err.message}`);

        // Auth failure = abort
        if (err.message.includes('expired') || err.message.includes('Login failed') || err.message.includes('token')) {
          console.error('\n🛑 Authentication failure. Please run "npm run login" first.');
          process.exit(1);
        }
      }

      // Delay between symbols (skip delay after last symbol)
      if (i < symbols.length - 1) {
        await sleep(DELAY_MS);
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log(`✅ Done! ${totalUpserted} total candles upserted | ${totalErrors} errors`);
    console.log('='.repeat(50));

  } catch (err) {
    console.error(`\n💥 Fatal Error: ${err.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
