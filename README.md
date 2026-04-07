# Flow Trc — Broker Summary Populate

Fetches broker summary data from Stockbit API and populates it into the `broker_summary` table in Neon PostgreSQL.

## Features

-   **Interactive Login**: CLI with masked password input and mobile app approval (V6 API).
-   **Historical Sync**: Populate historical data from newest to oldest based on existing price records.
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

Populates data for all active stocks from the newest available price date down to the oldest:

```bash
# Populate all available history
npm run populate:history

# Test with a limit (e.g., process only the first 10 stocks)
npm run populate:history -- --limit=10
```

### 3. Daily Population (Automated)

Fetches all active stocks from the `stocks` table for a specific snapshot:

```bash
npm run populate              # today (WIB)
# or
node src/cron-populate.js --yesterday  # yesterday (WIB)
node src/cron-populate.js --date=2026-03-31  # specific date
```

### 4. Single Stock / Debug

```bash
npm run populate:one BBCA --date=2026-03-31
```

## Database Schema

The implementation relies on:
-   `stocks`: List of symbols to process.
-   `price_ohlc_daily`: Used by `populate:history` to determine date ranges.
-   `brokers`: Master list of brokers (auto-populated if a code is missing).
-   `settings`: Stores `stockbit_access_token`, `stockbit_refresh_token`, `stockbit_token_expires_at`, and `stockbit_player_id`.

## Security

-   **Zero Password Storage**: Your Stockbit password is never stored in the database or files. It is only used once to obtain temporary JWT tokens.
-   **Token Persistence**: Access and Refresh tokens are stored in the `settings` table in your PostgreSQL database, allowing multiple instances (local, VPS) to share the same session.

## Data Source

All requests use fixed Stockbit parameters:
- **Investor Type**: All Investor (`INVESTOR_TYPE_ALL`)
- **Market Board**: Regular (`MARKET_BOARD_REGULER`)
- **Transaction Type**: Net (`TRANSACTION_TYPE_NET`)
