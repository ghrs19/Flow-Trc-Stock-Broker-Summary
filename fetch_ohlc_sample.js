require('dotenv').config();
const { fetchStockbitJson } = require('./src/lib/stockbit');

const EXODUS_API = 'https://exodus.stockbit.com';

async function fetchOHLC(symbol, params) {
  const query = new URLSearchParams(params);
  const url = `${EXODUS_API}/chartbit/${symbol}/price/daily?${query.toString()}`;
  console.log(`\n[fetch] ${url}`);
  return fetchStockbitJson(url, `ohlc:${symbol}`);
}

async function tryVariant(label, symbol, params) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`VARIANT: ${label}`);
  console.log('='.repeat(60));
  try {
    const raw = await fetchOHLC(symbol, params);
    const chartbit = raw?.data?.chartbit;
    console.log(`message    : ${raw?.message}`);
    console.log(`chartbit   : ${JSON.stringify(chartbit?.slice(0, 2) ?? 'N/A')}`);
    console.log(`count      : ${Array.isArray(chartbit) ? chartbit.length : 'N/A'}`);
    console.log(`last_data  : ${raw?.data?.last_data}`);
    console.log(`prev_ts    : ${raw?.data?.previous_timestamp}`);
    if (Array.isArray(chartbit) && chartbit.length > 0) {
      console.log('\n✅ DATA FOUND! First candle:');
      console.log(JSON.stringify(chartbit[0], null, 2));
      console.log('\nLast candle:');
      console.log(JSON.stringify(chartbit[chartbit.length - 1], null, 2));
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }
}

async function main() {
  const symbol = 'BBCA';

  // Variant 1: Exact user-provided params (from=newer, to=older = reverse chronological)
  await tryVariant('Exact user params (from newer → to older)', symbol, {
    from: '2025-02-17', to: '2024-02-18', limit: '0'
  });

  // Variant 2: Normal order
  await tryVariant('Normal order (from older → to newer)', symbol, {
    from: '2025-01-01', to: '2025-02-17', limit: '0'
  });

  // Variant 3: With limit=30
  await tryVariant('With limit=30, normal order', symbol, {
    from: '2025-01-01', to: '2025-02-17', limit: '30'
  });

  // Variant 4: Only from (no to)
  await tryVariant('Only from param', symbol, {
    from: '2025-02-17', limit: '30'
  });

  // Variant 5: Using previous_timestamp as pagination (1735491600 = ~Dec 29 2024)
  await tryVariant('Using previous_timestamp=1735491600 as "to"', symbol, {
    from: '2025-02-17', to: '1735491600', limit: '0'
  });

  // Variant 6: Unix timestamps for both
  // 2025-01-01 = 1735689600, 2025-02-17 = 1739750400
  await tryVariant('Unix timestamps from=1735689600 to=1739750400', symbol, {
    from: '1735689600', to: '1739750400', limit: '0'
  });
}

main().catch(console.error);
