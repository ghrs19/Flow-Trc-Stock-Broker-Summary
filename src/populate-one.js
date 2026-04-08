const pool = require('./db');
const { fetchBrokerSummary } = require('./lib/stockbit');
const { upsertBrokerSummary } = require('./lib/upsert');

function parseArgs() {
  const args = process.argv.slice(2);
  let stock = null;
  let date = null;

  for (const arg of args) {
    if (arg.startsWith('--date=')) {
      date = arg.split('=')[1];
    } else if (!arg.startsWith('--')) {
      stock = arg.toUpperCase();
    }
  }

  if (!stock) {
    console.error('Usage: node src/populate-one.js <SYMBOL> --date=YYYY-MM-DD');
    console.error('Example: node src/populate-one.js BBCA --date=2026-04-07');
    process.exit(1);
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Missing or invalid --date parameter (YYYY-MM-DD)');
    process.exit(1);
  }

  return { stock, date };
}

async function run() {
  const { stock, date } = parseArgs();

  console.log(`Fetching broker summary for ${stock} on ${date}...`);

  try {
    const brokersData = await fetchBrokerSummary(stock, date);
    const count = await upsertBrokerSummary(pool, stock, date, brokersData);

    console.log(`Done: ${count} rows upserted for ${stock} on ${date}`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
