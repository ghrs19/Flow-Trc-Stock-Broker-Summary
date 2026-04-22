require('dotenv').config();
const pool = require('../db');
const { fetchBrokerSummary } = require('../lib/stockbit');
const { upsertBrokerSummary } = require('../lib/upsert');

const DELAY_MS = parseInt(process.env.POPULATE_DELAY_MS || '2000', 10);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toDateStr(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseRelativeRange(rangeStr) {
  const match = rangeStr.match(/^(\d+)(d|w|mo|y)$/);
  if (!match) throw new Error(`Invalid range format: "${rangeStr}". Use e.g. 10d, 2w, 5mo, 1y`);

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const date = new Date();
  date.setHours(0, 0, 0, 0);

  switch (unit) {
    case 'd': date.setDate(date.getDate() - value); break;
    case 'w': date.setDate(date.getDate() - (value * 7)); break;
    case 'mo': date.setMonth(date.getMonth() - value); break;
    case 'y': date.setFullYear(date.getFullYear() - value); break;
  }

  return date;
}

function generateWorkdays(startDate, endDate) {
  const dates = [];
  const current = new Date(endDate);
  current.setHours(0, 0, 0, 0);

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  while (current >= start) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      dates.push(toDateStr(current));
    }
    current.setDate(current.getDate() - 1);
  }

  return dates;
}

function printUsage() {
  console.log(`
Usage:
  node src/cli/populate-one-range.js <SYMBOL> [options]
  node src/cli/populate-one-range.js --symbol=<SYMBOL> [options]

Options:
  --today             Populate only today (workday only)
  --range=<N><unit>   Relative range from today: e.g. 10d, 2w, 5mo, 1y
  --from=YYYY-MM-DD   Start date
  --to=YYYY-MM-DD     End date (default: today when --from is used)
  --force             Re-fetch even if rows already exist for that date
  --help, -h          Show this help

Examples:
  node src/cli/populate-one-range.js BBCA --range=1mo
  node src/cli/populate-one-range.js --symbol=BBCA --from=2026-03-01 --to=2026-03-31
  node src/cli/populate-one-range.js BBCA --today
`);
}

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const positionalSymbol = args.find(a => !a.startsWith('--'));
  const symbolArg = args.find(a => a.startsWith('--symbol='))?.split('=')[1];
  const rangeArg = args.find(a => a.startsWith('--range='))?.split('=')[1];
  const fromArg = args.find(a => a.startsWith('--from='))?.split('=')[1];
  const toArg = args.find(a => a.startsWith('--to='))?.split('=')[1];
  const todayOnly = args.includes('--today');
  const force = args.includes('--force');

  const symbol = (symbolArg || positionalSymbol || '').trim().toUpperCase();
  if (!symbol) {
    throw new Error('Symbol is required. Use positional <SYMBOL> or --symbol=<SYMBOL>.');
  }

  const selectors = [todayOnly, Boolean(rangeArg), Boolean(fromArg)].filter(Boolean).length;
  if (selectors !== 1) {
    throw new Error('Provide exactly one date selector: --today, --range=<N><unit>, or --from=YYYY-MM-DD.');
  }

  if (todayOnly && (toArg || rangeArg || fromArg)) {
    throw new Error('--today cannot be combined with --from, --to, or --range.');
  }

  let startDate;
  let endDate;

  if (todayOnly) {
    startDate = new Date();
    endDate = new Date();
  } else if (rangeArg) {
    startDate = parseRelativeRange(rangeArg);
    endDate = new Date();
  } else {
    startDate = new Date(fromArg);
    endDate = toArg ? new Date(toArg) : new Date();
  }

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('Invalid date format. Use YYYY-MM-DD for --from/--to.');
  }

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);

  if (startDate > endDate) {
    throw new Error(`Start date (${toDateStr(startDate)}) must be before end date (${toDateStr(endDate)}).`);
  }

  return { symbol, startDate, endDate, force };
}

async function run() {
  try {
    const { symbol, startDate, endDate, force } = parseArgs();
    const dates = generateWorkdays(startDate, endDate);

    if (dates.length === 0) {
      console.log('⚠️ No workdays in the requested range. Nothing to process.');
      process.exit(0);
    }

    console.log('🚀 Single Stock Broker Summary Range Population');
    console.log(`📌 Symbol     : ${symbol}`);
    console.log(`📅 Date range : ${toDateStr(startDate)} → ${toDateStr(endDate)}`);
    console.log(`🗓️ Workdays   : ${dates.length}`);
    console.log(`⏱️ Delay      : ${DELAY_MS}ms`);
    console.log(`🔁 Mode       : ${force ? 'force re-fetch' : 'skip existing dates'}\n`);

    let success = 0;
    let skipped = 0;
    let failed = 0;
    let totalRows = 0;

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const progress = `[${i + 1}/${dates.length}]`;

      try {
        if (!force) {
          const checkRes = await pool.query(
            'SELECT 1 FROM broker_summaries WHERE stock_code = $1 AND trade_date = $2 LIMIT 1',
            [symbol, date]
          );

          if (checkRes.rows.length > 0) {
            console.log(`${progress} ${date}: ⏭️  already exists`);
            skipped++;
            continue;
          }
        }

        process.stdout.write(`${progress} ${date}: fetching... `);
        const brokersData = await fetchBrokerSummary(symbol, date);
        const count = await upsertBrokerSummary(pool, symbol, date, brokersData);
        process.stdout.write(`✅ ${count} rows\n`);
        success++;
        totalRows += count;
      } catch (err) {
        failed++;
        process.stdout.write(`\n`);
        console.error(`${progress} ${date}: ❌ ${err.message}`);

        if (err.message.includes('expired') || err.message.includes('Login failed') || err.message.includes('token')) {
          console.error('\n🛑 Authentication failure. Please run "npm run login" first.');
          process.exit(1);
        }
      }

      if (i < dates.length - 1) {
        await sleep(DELAY_MS);
      }
    }

    console.log('\n' + '='.repeat(58));
    console.log(`✅ Done | success: ${success} | skipped: ${skipped} | failed: ${failed} | rows: ${totalRows}`);
    console.log('='.repeat(58));
  } catch (err) {
    console.error(`\n💥 Error: ${err.message}`);
    printUsage();
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
