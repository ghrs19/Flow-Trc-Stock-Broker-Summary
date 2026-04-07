const express = require('express');
require('dotenv').config();

const populateRouter = require('./routes/populate');
const populateAllRouter = require('./routes/populate-all');
const { auth } = require('./lib/stockbit');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

app.use('/api/populate', populateRouter);
app.use('/api/populate-all', populateAllRouter);

app.get('/api/token', (req, res) => {
  res.json({ token: auth.getTokenInfo() });
});

app.post('/api/token', async (req, res) => {
  try {
    const { key, token, refresh_token } = req.body || {};

    if (!key || key !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized: invalid or missing key' });
    }

    if (!token || typeof token !== 'string' || token.trim().length < 10) {
      return res.status(400).json({ error: 'Missing or invalid token in request body' });
    }

    const info = await auth.updateToken(token, refresh_token);
    res.json({ success: true, token: info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    message: 'Broker Summary Populate API',
    endpoints: {
      populate: 'GET /api/populate?stock=BBCA&date=2026-04-07&key=API_KEY',
      populateAll: 'GET /api/populate-all?key=API_KEY[&date=yesterday|-1|YYYY-MM-DD]',
      tokenStatus: 'GET /api/token',
      tokenUpdate: 'POST /api/token { key, token, refresh_token }',
    },
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  try {
    await auth.loadToken();
    auth.startTokenMonitor();
  } catch (err) {
    console.warn(`[startup] Token load warning: ${err.message}`);
  }
});
