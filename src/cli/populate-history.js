require('dotenv').config();
const pool = require('../db');
const { auth, fetchBrokerSummary } = require('../lib/stockbit');
const { upsertBrokerSummary } = require('../lib/upsert');

const DELAY_MS = parseInt(process.env.POPULATE_DELAY_MS || '2000', 10);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const args = process.argv.slice(2);
  const symbolLimit = args.find(a => a.startsWith('--limit='))?.split('=')[1];
  
  console.log('🚀 Starting Historical Broker Summary Population...');
  console.log(`⏱️  Delay between requests: ${DELAY_MS}ms`);

  try {
    // 1. Fetch active stocks
    let stocksQuery = 'SELECT symbol FROM stocks WHERE is_active = true ORDER BY symbol ASC';
    if (symbolLimit) {
      stocksQuery += ` LIMIT ${parseInt(symbolLimit, 10)}`;
    }
    
    const stocksRes = await pool.query(stocksQuery);
    const symbols = stocksRes.rows.map(r => r.symbol);
    
    console.log(`📦 Found ${symbols.length} stocks to process.`);

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      console.log(`\n--- [${i + 1}/${symbols.length}] Processing ${symbol} ---`);

      // 2. Fetch available dates for this stock (Newest to Oldest)
      const dateRes = await pool.query(
        'SELECT DISTINCT date FROM price_ohlc_daily WHERE stock_symbol = $1 ORDER BY date DESC',
        [symbol]
      );
      const dates = dateRes.rows.map(r => r.date.toISOString().split('T')[0]);

      if (dates.length === 0) {
        console.log(`  ⚠️ No price data found for ${symbol}. Skipping.`);
        continue;
      }

      console.log(`  📅 Found ${dates.length} dates. Starting from ${dates[0]} to ${dates[dates.length - 1]}...`);

      for (const date of dates) {
        try {
          // Check if already populated to save time/requests (optional but recommended)
          const checkRes = await pool.query(
            'SELECT 1 FROM broker_summary WHERE stock_code = $1 AND date = $2 LIMIT 1',
            [symbol, date]
          );
          
          if (checkRes.rows.length > 0) {
            console.log(`  ⏭️  ${date}: Already exists. Skipping.`);
            continue;
          }

          process.stdout.write(`  ⏳ ${date}: Fetching... `);
          const { buyRows, sellRows } = await fetchBrokerSummary(symbol, date);
          const count = await upsertBrokerSummary(pool, symbol, date, buyRows, sellRows);
          
          process.stdout.write(`Done (${count} rows).\n`);
          
          // Throttling
          await sleep(DELAY_MS);
        } catch (err) {
          console.log(`\n  ❌ Error on ${date}: ${err.message}`);
          
          // If it's an auth error, we should probably stop the whole process
          if (err.message.includes('expired') || err.message.includes('Login failed')) {
            console.error('\n🛑 Authentication failure. Please run "npm run login" first.');
            process.exit(1);
          }
          
          // For other errors (like 404 on a specific day), we can continue to next date
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
