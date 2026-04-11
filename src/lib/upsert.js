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
  const result = await pool.query('SELECT 1 FROM stocks WHERE code = $1', [stockCode]);
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
        `INSERT INTO broker_summaries (
          trade_date, stock_code, broker_code, 
          buy_lot, buy_value, buy_avg_price,
          sell_lot, sell_value, sell_avg_price,
          buy_freq, sell_freq
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (trade_date, stock_code, broker_code)
        DO UPDATE SET
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


/**
 * Batch-upserts OHLC candle rows into stock_prices for a given symbol.
 * Always overwrites existing rows (ON CONFLICT DO UPDATE).
 *
 * @param {import('pg').Pool} pool
 * @param {string} stockCode
 * @param {Array<{date,open,high,low,close,volume,value,frequency,foreign_buy,foreign_sell,foreign_flow,dividend,share_outstanding}>} candles
 * @returns {Promise<number>} number of rows upserted
 */
async function upsertStockPrices(pool, stockCode, candles) {
  if (!candles || candles.length === 0) return 0;

  const client = await pool.connect();
  let count = 0;

  try {
    await client.query('BEGIN');

    for (const c of candles) {
      await client.query(
        `INSERT INTO stock_ohlc_prices (
          trade_date, stock_code,
          open, high, low, close,
          volume, value, frequency,
          foreign_buy, foreign_sell, foreign_flow,
          dividend, share_outstanding,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
        ON CONFLICT (trade_date, stock_code)
        DO UPDATE SET
          open              = EXCLUDED.open,
          high              = EXCLUDED.high,
          low               = EXCLUDED.low,
          close             = EXCLUDED.close,
          volume            = EXCLUDED.volume,
          value             = EXCLUDED.value,
          frequency         = EXCLUDED.frequency,
          foreign_buy       = EXCLUDED.foreign_buy,
          foreign_sell      = EXCLUDED.foreign_sell,
          foreign_flow      = EXCLUDED.foreign_flow,
          dividend          = EXCLUDED.dividend,
          share_outstanding = EXCLUDED.share_outstanding,
          updated_at        = NOW()`,
        [
          c.date, stockCode,
          c.open, c.high, c.low, c.close,
          c.volume, c.value, c.frequency,
          c.foreign_buy, c.foreign_sell, c.foreign_flow,
          c.dividend, c.share_outstanding,
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

module.exports = { upsertBrokerSummary, upsertStockPrices };

