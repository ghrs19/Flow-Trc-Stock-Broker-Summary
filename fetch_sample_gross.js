const { fetchStockbitJson } = require('./src/lib/stockbit');
const pool = require('./src/db');

async function fetchBrokerSummaryCustom(symbol, date, type) {
  const EXODUS_API = 'https://exodus.stockbit.com';
  const query = new URLSearchParams({
    from: date,
    to: date,
    investor_type: 'INVESTOR_TYPE_ALL',
    market_board: 'MARKET_BOARD_REGULER',
    transaction_type: type,
    limit: '100',
  });
  const url = `${EXODUS_API}/marketdetectors/${symbol}?${query.toString()}`;
  return await fetchStockbitJson(url, `summary:${symbol}:${date}:${type}`);
}

async function main() {
  const stockCode = 'AADI';
  const date = '2025-11-10';
  
  try {
    console.log(`Fetching GROSS summary for ${stockCode} on ${date}...`);
    const rawResult = await fetchBrokerSummaryCustom(stockCode, date, 'TRANSACTION_TYPE_GROSS');
    
    // The data structure might be slightly different for GROSS
    const data = rawResult.data?.broker_summary || rawResult.data || {};
    
    const arRaw = (data.brokers_buy || data.buy || []).find(r => r.netbs_broker_code === 'AR' || r.broker_code === 'AR' || r.code === 'AR');
    const agRaw = (data.brokers_sell || data.sell || []).find(r => r.netbs_broker_code === 'AG' || r.broker_code === 'AG' || r.code === 'AG');
    const atRaw = (data.brokers_buy || data.buy || []).find(r => r.netbs_broker_code === 'AT' || r.broker_code === 'AT' || r.code === 'AT');

    console.log('\n--- RAW GROSS DATA ---');
    console.log('Broker AR:', JSON.stringify(arRaw, null, 2));
    console.log('Broker AG:', JSON.stringify(agRaw, null, 2));
    console.log('Broker AT:', JSON.stringify(atRaw, null, 2));

    if (data.brokers_buy?.[0]) {
        console.log('\nFirst Buy Row Sample:', JSON.stringify(data.brokers_buy[0], null, 2));
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
