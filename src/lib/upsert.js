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

async function upsertBrokerSummary(pool, stockCode, date, buyRows, sellRows) {
  // 1. Gather all unique broker codes present in this batch
  const uniqueCodes = new Set([
    ...buyRows.map(r => r.broker_code),
    ...sellRows.map(r => r.broker_code)
  ]);

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

    for (const row of buyRows) {
      await client.query(
        `INSERT INTO broker_summary (date, stock_code, broker_code, side, lot, val, avg_price, lot_vol, val_vol, freq, type)
         VALUES ($1, $2, $3, 'B', $4, $5, $6, $7, $8, $9, 'net')
         ON CONFLICT (date, stock_code, broker_code, side)
         DO UPDATE SET
           lot = EXCLUDED.lot,
           val = EXCLUDED.val,
           avg_price = EXCLUDED.avg_price,
           lot_vol = EXCLUDED.lot_vol,
           val_vol = EXCLUDED.val_vol,
           freq = EXCLUDED.freq,
           type = EXCLUDED.type`,
        [date, stockCode, row.broker_code, row.lot, row.val, row.avg_price, row.lot_vol, row.val_vol, row.freq]
      );
      count++;
    }

    for (const row of sellRows) {
      await client.query(
        `INSERT INTO broker_summary (date, stock_code, broker_code, side, lot, val, avg_price, lot_vol, val_vol, freq, type)
         VALUES ($1, $2, $3, 'S', $4, $5, $6, $7, $8, $9, 'net')
         ON CONFLICT (date, stock_code, broker_code, side)
         DO UPDATE SET
           lot = EXCLUDED.lot,
           val = EXCLUDED.val,
           avg_price = EXCLUDED.avg_price,
           lot_vol = EXCLUDED.lot_vol,
           val_vol = EXCLUDED.val_vol,
           freq = EXCLUDED.freq,
           type = EXCLUDED.type`,
        [date, stockCode, row.broker_code, row.lot, row.val, row.avg_price, row.lot_vol, row.val_vol, row.freq]
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
