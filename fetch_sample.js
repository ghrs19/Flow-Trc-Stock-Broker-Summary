const { fetchBrokerSummary } = require('./src/lib/stockbit');
const pool = require('./src/db');

async function main() {
  const stockCode = 'AADI';
  const date = '2025-11-10';
  
  try {
    console.log(`Fetching summary for ${stockCode} on ${date}...`);
    const result = await fetchBrokerSummary(stockCode, date);
    
    // Find AR and AG in the results
    const arBuy = result.buyRows.find(r => r.broker_code === 'AR');
    const arRaw = result.raw.brokers_buy?.find(r => r.netbs_broker_code === 'AR' || r.broker_code === 'AR');
    
    const agSell = result.sellRows.find(r => r.broker_code === 'AG');
    const agRaw = result.raw.brokers_sell?.find(r => r.netbs_broker_code === 'AG' || r.broker_code === 'AG');

    console.log('\n--- BROKER AR (SIMULATED JSON VS NORMALIZED) ---');
    console.log('Raw from API:', JSON.stringify(arRaw, null, 2));
    console.log('Normalized Row:', JSON.stringify(arBuy, null, 2));

    console.log('\n--- BROKER AG (SIMULATED JSON VS NORMALIZED) ---');
    console.log('Raw from API:', JSON.stringify(agRaw, null, 2));
    console.log('Normalized Row:', JSON.stringify(agSell, null, 2));

    // Also look for AT
    const atBuy = result.buyRows.find(r => r.broker_code === 'AT');
    const atRaw = result.raw.brokers_buy?.find(r => r.netbs_broker_code === 'AT' || r.broker_code === 'AT');
    console.log('\n--- BROKER AT ---');
    console.log('Raw from API:', JSON.stringify(atRaw, null, 2));
    console.log('Normalized Row:', JSON.stringify(atBuy, null, 2));

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
