# Flow Trc — Broker Summary Populate

Fetches broker summary data from Stockbit API and populates it into the `broker_summaries` table in Neon PostgreSQL.

## Features

-   **Interactive Login**: CLI with masked password input and mobile app approval (V6 API).
-   **Historical Sync**: Two modes for populating historical data (Stock-first or Date-first).
-   **Date-First Iteration**: Processes all stocks for a specific date before moving to the previous date (Day -1 by default).
-   **Auto Broker Registration**: Automatically registers unknown broker codes observed in trade data.
-   **Anti-Throttling**: Configurable delay between requests to avoid rate limits.
-   **Secure Storage**: Tokens and metadata (Player ID, Expiry) are stored securely in the PostgreSQL `settings` table. No local `.token_cache.json` files.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your DATABASE_URL and STOCKBIT_PLAYER_ID
```

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `STOCKBIT_PLAYER_ID` | Device/player ID for Stockbit (used to identify your session) |
| `POPULATE_DELAY_MS` | Delay between requests in bulk/bulk-history mode (default: 2100) |
| `PORT` | Express server port (default: 3002) |
| `API_KEY` | API key for the dashboard/SSE endpoints |

## Usage

### 1. Authentication (Stockbit Login)

Before running any population scripts, you must authorize the application:

```bash
# Interactive login (only asks if token is expired)
npm run login

# Force a completely fresh login (even if token is still valid)
npm run login -- --force
```

**Mobile App Approval**: If prompted, you must open your Stockbit mobile app and tap "Approve" (Setujui) to authorize this CLI as a new device.

### 2. Filling Historical Data

#### Option A: Stock-first (Original)
Populates data for each stock across the entire date range before moving to the next stock.

```bash
# Populate all available history
npm run populate:history

# Test with a limit (e.g., process only the first 10 stocks)
npm run populate:history -- --limit=10
```

#### Option B: Date-first (Recommended for range)
Processes all active stocks for a specific date, then moves to the previous date. Starts from yesterday (Day -1) by default.

```bash
# Populate by date first (backward iteration starting from yesterday)
npm run populate:history:date -- --range=5mo

# Populate backward from a specific date
npm run populate:history:date -- --range=5mo --start=2026-01-26

# Test with a limit (e.g., process only first 5 stocks per date)
npm run populate:history:date -- --range=1w --limit=5
```

### 3. Daily Population (Automated)

Fetches all active stocks from the `stocks` table for a specific snapshot:

```bash
npm run populate              # today (WIB)
# or
node src/cron-populate.js --yesterday  # yesterday (WIB)
node src/cron-populate.js --date=2026-03-31  # specific date
```

### 3b. One-shot Sequential Daily Pipeline

Runs these steps synchronously (in order, no async parallel):
1) force login
2) populate OHLC for today
3) populate broker summary for today

```bash
npm run populate:daily:sequential
```

Required env:
- `STOCKBIT_USERNAME` (or `STOCKBIT_EMAIL`)
- `STOCKBIT_PASSWORD`

### 3c. Schedule with PM2 (Weekdays 17:30)

If your project root is `/home/projects/broker_call`, run:

```bash
pm2 start npm \
  --name "populate-daily-sequential-1730-weekdays" \
  --cwd /home/projects/broker_call \
  --cron "30 17 * * 1-5" \
  --no-autorestart \
  -- run populate:daily:sequential
```

Useful checks:

```bash
pm2 status
pm2 logs populate-daily-sequential-1730-weekdays
pm2 show populate-daily-sequential-1730-weekdays
```

Persist PM2 process list across reboot:

```bash
pm2 save
pm2 startup
```

### 4. Single Stock / Debug

```bash
npm run populate:one BBCA --date=2026-03-31
```

Single stock with range:

```bash
# Relative range
npm run populate:one:range -- BBCA --range=1mo

# Explicit range
npm run populate:one:range -- --symbol=BBCA --from=2026-03-01 --to=2026-03-31

# Today only
npm run populate:one:range -- BBCA --today
```

Notes:
- Use exactly one date selector: `--today`, `--range=<N><unit>`, or `--from=YYYY-MM-DD`.
- Add `--force` to re-fetch even if data already exists for that date.

### 5. Fetch OHLC Data

Fetches daily OHLC candles (open, high, low, close, volume, etc.) into `stock_ohlc_prices`.

```bash
# 1 year range for all active stocks
npm run populate:ohlc -- --range=1y

# Today only
npm run populate:ohlc -- --today

# Specific date range
npm run populate:ohlc -- --from=2024-01-01 --to=2024-12-31

# Single stock
npm run populate:ohlc -- --symbol=BBCA --range=6mo

# First run (auto-create table + indexes)
npm run populate:ohlc -- --range=1y --create-table

# Test mode (limit number of stocks)
npm run populate:ohlc -- --range=1y --limit=5
```

Notes:
- Run `npm run login` first if your session is expired.
- You must provide one of `--today`, `--range=<N><unit>`, or `--from=YYYY-MM-DD`.

## Database Schema

The implementation relies on:
-   **`stocks`**: List of symbols (using `code` as primary key).
-   **`broker_summaries`**: The main table storing summary data (using `trade_date`).
-   **`brokers`**: Master list of brokers (auto-populated if a code is missing).
-   **`settings`**: Stores `stockbit_access_token`, `stockbit_refresh_token`, `stockbit_token_expires_at`, and `stockbit_player_id`.

## Security

-   **Zero Password Storage**: Your Stockbit password is never stored in the database or files. It is only used once to obtain temporary JWT tokens.
-   **Token Persistence**: Access and Refresh tokens are stored in the `settings` table in your PostgreSQL database, allowing multiple instances (local, VPS) to share the same session.

## Data Source

All requests use fixed Stockbit parameters:
- **Investor Type**: All Investor (`INVESTOR_TYPE_ALL`)
- **Market Board**: All Board (`MARKET_BOARD_ALL`)
- **Transaction Type**: Gross (`TRANSACTION_TYPE_GROSS`)
