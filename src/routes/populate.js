const express = require('express');
const pool = require('../db');
const { fetchBrokerSummary } = require('../lib/stockbit');
const { upsertBrokerSummary } = require('../lib/upsert');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { stock, date, key } = req.query;

    if (!key || key !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized: invalid or missing key' });
    }

    if (!stock) {
      return res.status(400).json({ error: 'Missing required parameter: stock' });
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Missing or invalid parameter: date (YYYY-MM-DD)' });
    }

    const symbol = stock.toUpperCase();
    console.log(`[api] Fetching broker summary for ${symbol} on ${date}...`);

    const brokersData = await fetchBrokerSummary(symbol, date);
    const count = await upsertBrokerSummary(pool, symbol, date, brokersData);

    console.log(`[api] Upserted ${count} rows for ${symbol} on ${date}`);

    res.json({
      success: true,
      symbol,
      date,
      rows_upserted: count,
    });
  } catch (err) {
    console.error('[api] Populate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
