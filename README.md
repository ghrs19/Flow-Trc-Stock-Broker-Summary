# Flow Trc — Broker Summary Populate

Fetches broker summary data from Stockbit API and populates it into the `broker_summary` table in Neon PostgreSQL.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your credentials
```

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `STOCKBIT_TOKEN` | JWT access token (optional, fallback if no `.token_cache.json`) |
| `STOCKBIT_PLAYER_ID` | Device/player ID for Stockbit |
| `PORT` | Express server port (default: 3002) |
| `API_KEY` | API key for the populate and token endpoints |
| `POPULATE_DELAY_MS` | Delay between requests in bulk mode (default: 2100) |

## Usage

### Single Stock (CLI)

```bash
node src/populate-one.js BBCA --date=2026-03-31
```

### Bulk Populate (CLI)

Fetches all active stocks from the `stocks` table in the DB:

```bash
node src/cron-populate.js              # today (WIB)
node src/cron-populate.js --yesterday  # yesterday (WIB)
node src/cron-populate.js -1           # yesterday (shorthand)
node src/cron-populate.js --date=2026-03-31  # specific date
```

### API Server

```bash
npm start
```

#### Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/populate?stock=BBCA&date=2026-04-07&key=API_KEY` | Single stock |
| `GET` | `/api/populate-all?key=API_KEY` | All stocks, today (WIB) |
| `GET` | `/api/populate-all?key=API_KEY&date=yesterday` | All stocks, yesterday |
| `GET` | `/api/populate-all?key=API_KEY&date=-1` | All stocks, yesterday (shorthand) |
| `GET` | `/api/populate-all?key=API_KEY&date=2026-04-07` | All stocks, specific date |
| `GET` | `/api/token` | Token status |
| `POST` | `/api/token` | Update token `{ key, token, refresh_token }` |

`/api/populate-all` uses **Server-Sent Events (SSE)** — streams progress per stock in real-time.

## Parameters

All requests use fixed Stockbit parameters:
- **Investor Type**: All Investor (`INVESTOR_TYPE_ALL`)
- **Market Board**: Regular (`MARKET_BOARD_REGULER`)
- **Transaction Type**: Net (`TRANSACTION_TYPE_NET`)

## Auth / Token Management

Token lifecycle (inspired by [stockbit-haka-haki](https://github.com/nofendian17/stockbit-haka-haki)):

1. **`.token_cache.json`** — primary (persists access + refresh tokens, auto-updated)
2. **`STOCKBIT_TOKEN`** from `.env` — fallback (optional, only if no cache)
3. **Refresh token** via `POST /login/refresh` — extends session without re-login
4. **Token monitor** (server mode) — checks every 5 min, proactively refreshes 10 min before expiry
5. **JWT decode** — reads `exp` claim directly from token, no external API needed

### How to get tokens (first time)

1. Login to [stockbit.com](https://stockbit.com) in your browser
2. Open DevTools → Network tab → enable **Preserve log**
3. Logout, then login again (Google or email/password)
4. Find the `login/v6/...` request in Network tab → Response
5. Copy `data.login.token_data.access.token` and `data.login.token_data.refresh.token`
6. POST both tokens to the running server:

```bash
curl -X POST http://localhost:3002/api/token \
  -H "Content-Type: application/json" \
  -d '{"key":"YOUR_API_KEY","token":"ACCESS_TOKEN","refresh_token":"REFRESH_TOKEN"}'
```

Once a refresh token is saved, the token auto-renews indefinitely via `.token_cache.json`.

### Token management at runtime

```bash
# Check token status
curl http://localhost:3002/api/token

# Update access token only
curl -X POST http://localhost:3002/api/token \
  -H "Content-Type: application/json" \
  -d '{
    "key": "YOUR_API_KEY",
    "token": "eyJhbGciOiJSUzI1NiIs..."
  }'

# Update access token + refresh token (recommended)
curl -X POST http://localhost:3002/api/token \
  -H "Content-Type: application/json" \
  -d '{
    "key": "YOUR_API_KEY",
    "token": "eyJhbGciOiJSUzI1NiIs...",
    "refresh_token": "eyJhbGciOiJSUzI1NiIs..."
  }'
```

- **`key`** — API key dari `.env` (wajib)
- **`token`** — access token JWT dari Stockbit (wajib)
- **`refresh_token`** — refresh token JWT (opsional, tapi disarankan agar auto-renew aktif)
