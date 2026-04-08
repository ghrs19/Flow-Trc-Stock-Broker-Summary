require('dotenv').config();
const pool = require('../db');
const { auth, fetchBrokerSummary } = require('../lib/stockbit');
const { upsertBrokerSummary } = require('../lib/upsert');

const DELAY_MS = parseInt(process.env.POPULATE_DELAY_MS || '2000', 10);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generates an array of YYYY-MM-DD strings between from and to (inclusive).
 * Skips weekends (Saturday/Sunday).
 * @param {Date} from 
 * @param {Date} to 
 * @returns {string[]}
 */
function generateDates(from, to) {
  const dates = [];
  let current = new Date(to);
  // Normalize to 00:00:00
  current.setHours(0, 0, 0, 0);
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);

  while (current >= start) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) { // Skip Sat (6) and Sun (0)
      const yyyy = current.getFullYear();
      const mm = String(current.getMonth() + 1).padStart(2, '0');
      const dd = String(current.getDate()).padStart(2, '0');
      dates.push(`${yyyy}-${mm}-${dd}`);
    }
    current.setDate(current.getDate() - 1);
  }
  return dates;
}

/**
 * Parses relative range like "5mo", "10d", "1y"
 * @param {string} rangeStr 
 * @returns {Date} Start date
 */
function parseRelativeRange(rangeStr) {
  const match = rangeStr.match(/^(\d+)(d|w|mo|y)$/);
  if (!match) throw new Error(`Invalid range format: ${rangeStr}. Use e.g. 5mo, 10d, 1y`);

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

async function run() {
  const args = process.argv.slice(2);
  const symbolLimit = args.find(a => a.startsWith('--limit='))?.split('=')[1];
  const rangeArg = args.find(a => a.startsWith('--range='))?.split('=')[1];
  const fromArg = args.find(a => a.startsWith('--from='))?.split('=')[1];
  const toArg = args.find(a => a.startsWith('--to='))?.split('=')[1];

  console.log('🚀 Starting Historical Broker Summary Population...');
  console.log(`⏱️  Delay between requests: ${DELAY_MS}ms`);

  let startDate, endDate;

  if (fromArg) {
    startDate = new Date(fromArg);
    endDate = toArg ? new Date(toArg) : new Date();
  } else if (rangeArg) {
    startDate = parseRelativeRange(rangeArg);
    endDate = new Date();
  } else {
    // Default to today
    startDate = new Date();
    endDate = new Date();
  }

  const dateList = generateDates(startDate, endDate);

  if (dateList.length === 0) {
    console.log('⚠️ No trading days found in the specified range. Exiting.');
    process.exit(0);
  }

  try {
    // 1. Fetch active stocks
    let stocksQuery = 'SELECT code FROM stocks WHERE is_active = true ORDER BY code ASC';
    if (symbolLimit) {
      stocksQuery += ` LIMIT ${parseInt(symbolLimit, 10)}`;
    }

    const stocksRes = await pool.query(stocksQuery);
    const symbols = stocksRes.rows.map(r => r.code);

    console.log(`📦 Found ${symbols.length} stocks to process.`);
    console.log(`📅 Dates to process: ${dateList.length} (Workdays from ${dateList[0]} back to ${dateList[dateList.length - 1]})`);

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      console.log(`\n--- [${i + 1}/${symbols.length}] Processing ${symbol} ---`);

      for (const date of dateList) {
        try {
          // Check if already populated
          const checkRes = await pool.query(
            'SELECT 1 FROM broker_summaries WHERE stock_code = $1 AND trade_date = $2 LIMIT 1',
            [symbol, date]
          );

          if (checkRes.rows.length > 0) {
            console.log(`  ⏭️  ${date}: Already exists. Skipping.`);
            continue;
          }

          process.stdout.write(`  ⏳ ${date}: Fetching... `);
          const brokersData = await fetchBrokerSummary(symbol, date);
          const count = await upsertBrokerSummary(pool, symbol, date, brokersData);

          process.stdout.write(`Done (${count} rows).\n`);

          // Throttling
          await sleep(DELAY_MS);
        } catch (err) {
          console.log(`\n  ❌ Error on ${date}: ${err.message}`);

          if (err.message.includes('expired') || err.message.includes('Login failed')) {
            console.error('\n🛑 Authentication failure. Please run "npm run login" first.');
            process.exit(1);
          }

          console.log('  Continuing to next date...');
        }
      }
    }

    console.log('\n✅ Historical population completed successfully!');

  } catch (err) {
    console.error(`\n💥 Fatal Error: ${err.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
