const fs = require('fs/promises');
const path = require('path');

const EXODUS_API = 'https://exodus.stockbit.com';
const TOKEN_CACHE_FILE = path.join(process.cwd(), '.token_cache.json');
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Origin': 'https://stockbit.com',
  'Referer': 'https://stockbit.com/',
  'X-DeviceType': 'Google Chrome',
  'X-Platform': 'PC',
  'X-AppVersion': '3.21.0',
  'Content-Type': 'application/json',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(statusCode, message) {
  if ([429, 500, 502, 503, 504].includes(statusCode)) return true;
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes('service_busy')
    || lower.includes('too many requests')
    || lower.includes('temporarily unavailable');
}

function decodeJwtExpiry(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp) return new Date(payload.exp * 1000);
    return null;
  } catch {
    return null;
  }
}

function formatTimeLeft(expiresAt) {
  if (!expiresAt) return 'unknown';
  const ms = expiresAt.getTime() - Date.now();
  if (ms <= 0) return 'EXPIRED';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

class StockbitAuth {
  constructor() {
    this.accessToken = '';
    this.refreshTokenValue = '';
    this.expiresAt = null;
    this.playerId = (process.env.STOCKBIT_PLAYER_ID || 'pc_browser_custom').trim();
    this._loaded = false;
    this._monitorInterval = null;
  }

  isTokenValid() {
    if (!this.accessToken) return false;
    if (!this.expiresAt) return true;
    return Date.now() < (this.expiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS);
  }

  getTokenInfo() {
    return {
      hasToken: Boolean(this.accessToken),
      hasRefreshToken: Boolean(this.refreshTokenValue),
      expiresAt: this.expiresAt ? this.expiresAt.toISOString() : null,
      timeLeft: formatTimeLeft(this.expiresAt),
      isValid: this.isTokenValid(),
    };
  }

  async saveToken() {
    const data = {
      access_token: this.accessToken,
      refresh_token: this.refreshTokenValue,
      expires_at: this.expiresAt ? this.expiresAt.toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    await fs.writeFile(TOKEN_CACHE_FILE, JSON.stringify(data, null, 2), 'utf8').catch(() => {});
  }

  async loadToken() {
    if (this._loaded) return;
    this._loaded = true;

    // Priority 1: STOCKBIT_TOKEN from env
    const envToken = (process.env.STOCKBIT_TOKEN || '').trim();
    if (envToken) {
      this.accessToken = envToken;
      this.expiresAt = decodeJwtExpiry(envToken);
      if (this.isTokenValid()) {
        console.log(`[stockbit] Token loaded from env (expires in ${formatTimeLeft(this.expiresAt)})`);
        return;
      }
      console.warn(`[stockbit] Token from env is expired`);
    }

    // Priority 2: .token_cache.json
    try {
      const raw = await fs.readFile(TOKEN_CACHE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      const cachedToken = String(parsed.access_token || '').trim();
      const cachedRefresh = String(parsed.refresh_token || '').trim();
      if (cachedRefresh) this.refreshTokenValue = cachedRefresh;
      if (cachedToken) {
        this.accessToken = cachedToken;
        this.expiresAt = decodeJwtExpiry(cachedToken);
        if (this.isTokenValid()) {
          console.log(`[stockbit] Token loaded from cache (expires in ${formatTimeLeft(this.expiresAt)})`);
          return;
        }
        console.warn(`[stockbit] Token from cache is expired`);
      }
    } catch {
      // no cache file
    }

    // Priority 3: Try refresh token (if available)
    if (this.refreshTokenValue) {
      try {
        await this.refreshToken();
        return;
      } catch (err) {
        console.warn(`[stockbit] Token refresh failed: ${err.message}`);
      }
    }

    // No valid token available
    if (!this.isTokenValid()) {
      throw new Error(
        'No valid Stockbit token available.\n' +
        'To fix: Copy your token from stockbit.com browser DevTools (Network tab → any API request → Authorization header) ' +
        'and set it as STOCKBIT_TOKEN in .env or POST it to /api/token'
      );
    }
  }

  async refreshToken() {
    if (!this.refreshTokenValue) {
      throw new Error('No refresh token available');
    }

    console.log('[stockbit] Refreshing token...');
    const res = await fetch(`${EXODUS_API}/login/refresh`, {
      method: 'POST',
      headers: {
        ...DEFAULT_HEADERS,
        'Authorization': `Bearer ${this.refreshTokenValue}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      this.refreshTokenValue = '';
      throw new Error(`Token refresh failed (${res.status}): ${body}`);
    }

    const json = await res.json();
    const newAccess = String(json?.data?.refresh?.access?.token || '').trim();
    const newRefresh = String(json?.data?.refresh?.refresh?.token || '').trim();

    if (!newAccess) {
      throw new Error('Refresh response missing access token');
    }

    this.accessToken = newAccess;
    if (newRefresh) this.refreshTokenValue = newRefresh;
    this.expiresAt = decodeJwtExpiry(newAccess);
    await this.saveToken();
    console.log(`[stockbit] Token refreshed (expires in ${formatTimeLeft(this.expiresAt)})`);
    return this.accessToken;
  }

  async updateToken(newToken, newRefreshToken) {
    this.accessToken = newToken.trim();
    if (newRefreshToken) this.refreshTokenValue = newRefreshToken.trim();
    this.expiresAt = decodeJwtExpiry(this.accessToken);
    await this.saveToken();
    console.log(`[stockbit] Token updated (expires in ${formatTimeLeft(this.expiresAt)})`);
    return this.getTokenInfo();
  }

  invalidate() {
    this.accessToken = '';
    this.expiresAt = null;
    this._loaded = false;
  }

  startTokenMonitor(intervalMs = 5 * 60 * 1000) {
    if (this._monitorInterval) return;
    console.log('[stockbit] Token monitor started (checks every 5m)');

    this._monitorInterval = setInterval(async () => {
      try {
        if (!this.expiresAt) return;

        const timeLeft = this.expiresAt.getTime() - Date.now();
        if (timeLeft <= 10 * 60 * 1000 && timeLeft > 0) {
          console.log(`[stockbit] Token expires in ${formatTimeLeft(this.expiresAt)}, refreshing proactively...`);
          if (this.refreshTokenValue) {
            await this.refreshToken();
          } else {
            console.warn('[stockbit] No refresh token — update STOCKBIT_TOKEN in .env or POST /api/token');
          }
        } else if (timeLeft > 0) {
          console.log(`[stockbit] Token valid (expires in ${formatTimeLeft(this.expiresAt)})`);
        } else {
          console.warn(`[stockbit] Token EXPIRED, attempting refresh...`);
          if (this.refreshTokenValue) {
            await this.refreshToken();
          } else {
            console.warn('[stockbit] No refresh token — update STOCKBIT_TOKEN in .env or POST /api/token');
          }
        }
      } catch (err) {
        console.error(`[stockbit] Token monitor refresh failed: ${err.message}`);
      }
    }, intervalMs);
  }

  stopTokenMonitor() {
    if (this._monitorInterval) {
      clearInterval(this._monitorInterval);
      this._monitorInterval = null;
      console.log('[stockbit] Token monitor stopped');
    }
  }

  async getHeaders() {
    await this.loadToken();

    if (!this.isTokenValid()) {
      // Try refresh before giving up
      if (this.refreshTokenValue) {
        try {
          await this.refreshToken();
        } catch {
          // refresh failed
        }
      }
      if (!this.isTokenValid()) {
        throw new Error(
          `Stockbit token expired (${formatTimeLeft(this.expiresAt)}). ` +
          'Update via POST /api/token or set STOCKBIT_TOKEN in .env'
        );
      }
    }

    return {
      ...DEFAULT_HEADERS,
      'Authorization': `Bearer ${this.accessToken}`,
      'X-Player-Id': this.playerId,
    };
  }
}

const auth = new StockbitAuth();

async function fetchStockbitJson(url, label, maxRetry = 3) {
  let attempt = 0;
  let lastErr = null;

  while (attempt <= maxRetry) {
    let statusCode = 0;
    let bodyText = '';
    try {
      const headers = await auth.getHeaders();
      const res = await fetch(url, { headers });
      statusCode = res.status;

      if (res.ok) {
        return await res.json();
      }

      bodyText = await res.text();
      if (statusCode === 401 && attempt < maxRetry) {
        auth.invalidate();
        attempt += 1;
        await sleep(750 * attempt);
        continue;
      }

      if (!shouldRetry(statusCode, bodyText) || attempt >= maxRetry) {
        throw new Error(`Stockbit API Error (${statusCode}) [${label}]: ${bodyText}`);
      }
    } catch (error) {
      lastErr = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!shouldRetry(statusCode, `${message} ${bodyText}`) || attempt >= maxRetry) {
        throw error;
      }
    }

    attempt += 1;
    const backoffMs = 1000 * Math.pow(2, attempt);
    await sleep(backoffMs);
  }

  throw lastErr || new Error(`Fetch failed after retry [${label}]`);
}

function normalizeSummaryData(data) {
  if (!data || typeof data !== 'object') return null;
  const maybeData = data.data;
  if (maybeData && typeof maybeData === 'object') {
    const brokerSummary = maybeData.broker_summary;
    const bandarDetector = maybeData.bandar_detector;
    if (brokerSummary && typeof brokerSummary === 'object') {
      return {
        ...brokerSummary,
        bandar_detector: (bandarDetector && typeof bandarDetector === 'object') ? bandarDetector : undefined,
      };
    }
    const marketDetector = maybeData.market_detector;
    if (marketDetector && typeof marketDetector === 'object') return marketDetector;
    return maybeData;
  }
  return data;
}

function normalizeBuyRow(row) {
  return {
    broker_code: row.netbs_broker_code || row.broker_code || row.code || '??',
    lot: Math.abs(Number(row.blot || row.lot || 0)),
    val: Number(row.bval || row.value || row.net_value || 0),
    avg_price: Math.round(Number(row.netbs_buy_avg_price || row.bavg || row.avg_price || 0)),
    lot_vol: Math.abs(Number(row.blotv || 0)),
    val_vol: Math.abs(Number(row.bvalv || 0)),
    freq: Number(row.freq || 0),
  };
}

function normalizeSellRow(row) {
  return {
    broker_code: row.netbs_broker_code || row.broker_code || row.code || '??',
    lot: Math.abs(Number(row.slot || row.lot || 0)),
    val: Math.abs(Number(row.sval || row.value || row.net_value || 0)),
    avg_price: Math.round(Number(row.netbs_sell_avg_price || row.savg || row.avg_price || 0)),
    lot_vol: Math.abs(Number(row.slotv || 0)),
    val_vol: Math.abs(Number(row.svalv || 0)),
    freq: Number(row.freq || 0),
  };
}

async function fetchBrokerSummary(symbol, date) {
  const query = new URLSearchParams({
    from: date,
    to: date,
    investor_type: 'INVESTOR_TYPE_ALL',
    market_board: 'MARKET_BOARD_REGULER',
    transaction_type: 'TRANSACTION_TYPE_NET',
    limit: '100',
  });
  const url = `${EXODUS_API}/marketdetectors/${symbol}?${query.toString()}`;
  const raw = await fetchStockbitJson(url, `summary:${symbol}:${date}`);
  const summary = normalizeSummaryData(raw);

  const buyRows = (summary?.brokers_buy || summary?.buy || []).map(normalizeBuyRow);
  const sellRows = (summary?.brokers_sell || summary?.sell || []).map(normalizeSellRow);

  return { buyRows, sellRows, raw: summary };
}

module.exports = {
  auth,
  fetchBrokerSummary,
  fetchStockbitJson,
};
