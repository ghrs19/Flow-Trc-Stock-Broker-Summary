async function ensureBrokersExist(pool, brokerCodes) {
  if (!brokerCodes || brokerCodes.size === 0) return;

  const codes = Array.from(brokerCodes);
  
  // Find which codes are already there
  const result = await pool.query(
    'SELECT code FROM brokers WHERE code = ANY($1)',
    [codes]
  );
  const existingSet = new Set(result.rows.map(r => r.code));
  const missingCodes = codes.filter(c => !existingSet.has(c));

  if (missingCodes.length === 0) return;

  console.log(`  🆕 Registering ${missingCodes.length} new brokers found in summary: ${missingCodes.join(', ')}`);

  // Insert missing brokers
  // Note: We use a simple loop or a single multi-row insert.
  // We'll use a single query for efficiency.
  const values = [];
  const params = [];
  missingCodes.forEach((code, i) => {
    const baseIndex = i * 2;
    values.push(`($${baseIndex + 1}, $${baseIndex + 2})`);
    params.push(code, `Unknown Broker (${code})`);
  });

  await pool.query(
    `INSERT INTO brokers (code, name) VALUES ${values.join(', ')} ON CONFLICT (code) DO NOTHING`,
    params
  );
}

async function stockExists(pool, stockCode) {
  const result = await pool.query('SELECT 1 FROM stocks WHERE symbol = $1', [stockCode]);
  return result.rows.length > 0;
}

async function upsertBrokerSummary(pool, stockCode, date, brokersData) {
  // 1. Gather all unique broker codes present in this batch
  const uniqueCodes = new Set(brokersData.map(r => r.broker_code));

  // 2. Ensure both stock and brokers exist
  const [hasStock] = await Promise.all([
    stockExists(pool, stockCode),
    ensureBrokersExist(pool, uniqueCodes)
  ]);

  if (!hasStock) {
    throw new Error(`Stock ${stockCode} not found in stocks table`);
  }

  const client = await pool.connect();
  let count = 0;

  try {
    await client.query('BEGIN');

    for (const row of brokersData) {
      await client.query(
        `INSERT INTO broker_summary (
          date, stock_code, broker_code, broker_type,
          buy_lot, buy_value, buy_avg_price,
          sell_lot, sell_value, sell_avg_price,
          buy_freq, sell_freq
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (date, stock_code, broker_code)
        DO UPDATE SET
          broker_type = EXCLUDED.broker_type,
          buy_lot = EXCLUDED.buy_lot,
          buy_value = EXCLUDED.buy_value,
          buy_avg_price = EXCLUDED.buy_avg_price,
          sell_lot = EXCLUDED.sell_lot,
          sell_value = EXCLUDED.sell_value,
          sell_avg_price = EXCLUDED.sell_avg_price,
          buy_freq = EXCLUDED.buy_freq,
          sell_freq = EXCLUDED.sell_freq`,
        [
          date,
          stockCode,
          row.broker_code,
          row.broker_type,
          row.buy_lot,
          row.buy_value,
          row.buy_avg_price,
          row.sell_lot,
          row.sell_value,
          row.sell_avg_price,
          row.buy_freq,
          row.sell_freq
        ]
      );
      count++;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return count;
}

module.exports = { upsertBrokerSummary };
