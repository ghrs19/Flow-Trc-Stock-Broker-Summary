async function getValidBrokerCodes(pool) {
  const result = await pool.query('SELECT code FROM brokers');
  return new Set(result.rows.map((r) => r.code));
}

async function stockExists(pool, stockCode) {
  const result = await pool.query('SELECT 1 FROM stocks WHERE symbol = $1', [stockCode]);
  return result.rows.length > 0;
}

async function upsertBrokerSummary(pool, stockCode, date, buyRows, sellRows) {
  const [validBrokers, hasStock] = await Promise.all([
    getValidBrokerCodes(pool),
    stockExists(pool, stockCode),
  ]);

  if (!hasStock) {
    throw new Error(`Stock ${stockCode} not found in stocks table`);
  }

  const filteredBuy = buyRows.filter((r) => validBrokers.has(r.broker_code));
  const filteredSell = sellRows.filter((r) => validBrokers.has(r.broker_code));

  const skippedBuy = buyRows.length - filteredBuy.length;
  const skippedSell = sellRows.length - filteredSell.length;
  if (skippedBuy > 0 || skippedSell > 0) {
    console.log(`  Skipped ${skippedBuy} buy + ${skippedSell} sell rows (broker code not in DB)`);
  }

  const client = await pool.connect();
  let count = 0;

  try {
    await client.query('BEGIN');

    for (const row of filteredBuy) {
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

    for (const row of filteredSell) {
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
