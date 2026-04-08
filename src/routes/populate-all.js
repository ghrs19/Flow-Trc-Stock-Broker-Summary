const express = require('express');
const pool = require('../db');
const { fetchBrokerSummary } = require('../lib/stockbit');
const { upsertBrokerSummary } = require('../lib/upsert');

const router = express.Router();
const DELAY_MS = parseInt(process.env.POPULATE_DELAY_MS, 10) || 2100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveDate(dateParam) {
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return dateParam;
  }

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  if (dateParam === 'yesterday' || dateParam === '-1') {
    now.setDate(now.getDate() - 1);
  }
  return now.toISOString().slice(0, 10);
}

async function getActiveStocks() {
  const result = await pool.query(
    `SELECT code FROM stocks WHERE is_active = true ORDER BY code`
  );
  return result.rows.map((row) => row.code);
}

// GET /api/populate-all?key=API_KEY
// GET /api/populate-all?key=API_KEY&date=yesterday
// GET /api/populate-all?key=API_KEY&date=-1
// GET /api/populate-all?key=API_KEY&date=2026-04-07
router.get('/', async (req, res) => {
  const { key, date: dateParam } = req.query;

  if (!key || key !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing key' });
  }

  const date = resolveDate(dateParam);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let stocks;
  try {
    stocks = await getActiveStocks();
  } catch (err) {
    send('error', { error: err.message });
    res.end();
    return;
  }

  send('start', { date, total: stocks.length, delay_ms: DELAY_MS });
  console.log(`[api] Bulk populate started: ${stocks.length} stocks for ${date}`);

  const startTime = Date.now();
  let success = 0;
  let failed = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < stocks.length; i++) {
    const symbol = stocks[i];

    try {
      const brokersData = await fetchBrokerSummary(symbol, date);
      const count = await upsertBrokerSummary(pool, symbol, date, brokersData);

      if (count > 0) {
        send('progress', { index: i + 1, total: stocks.length, symbol, rows: count, status: 'ok' });
        success++;
      } else {
        send('progress', { index: i + 1, total: stocks.length, symbol, rows: 0, status: 'skipped' });
        skipped++;
      }
    } catch (err) {
      send('progress', { index: i + 1, total: stocks.length, symbol, error: err.message, status: 'error' });
      errors.push({ symbol, error: err.message });
      failed++;
    }

    if (i < stocks.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  send('done', { date, success, failed, skipped, duration_s: duration, errors });
  console.log(`[api] Bulk populate done: ${success} ok, ${failed} failed, ${skipped} skipped (${duration}s)`);
  res.end();
});

module.exports = router;
