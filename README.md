# Flow Trc — Broker Summary Populate

Fetches broker summary data from Stockbit API and populates it into the `broker_summaries` table in Neon PostgreSQL.

## Features

-   **Interactive Login**: CLI with masked password input and mobile app approval (V6 API).
-   **Automated Login**: Support for environment credentials (`.env`) for headless execution.
-   **Historical Sync**: Two modes for populating historical data (Stock-first or Date-first).
-   **OHLC Population**: Dedicated script to fetch daily candle data into `stock_ohlc_prices`.
-   **Stock Master Sync**: Synchronize the `stocks` table from `idxstocks_filtered.json`.
-   **Auto Broker Registration**: Automatically registers unknown broker codes observed in trade data.
-   **Anti-Throttling**: Configurable delay between requests to avoid rate limits.
-   **Secure Storage**: Tokens and metadata are stored securely in the PostgreSQL `settings` table.

## Setup

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Configure Environment**:
    ```bash
    cp .env.example .env
    # Edit .env with your DATABASE_URL and STOCKBIT credentials
    ```

3.  **Sync Stock Master**:
    Before populating summaries, ensure your stock list is up to date:
    ```bash
    npm run sync:stocks
    ```

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `STOCKBIT_USERNAME` | Stockbit email/username (for automated login) |
| `STOCKBIT_PASSWORD` | Stockbit password (for automated login) |
| `STOCKBIT_PLAYER_ID` | Device/player ID for Stockbit |
| `POPULATE_DELAY_MS` | Delay between requests in bulk mode (default: 2100) |

## Usage

### 1. Authentication (Stockbit Login)

Before running any population scripts, you must authorize the application:

```bash
# Interactive login (asks for email/pass if token is expired)
npm run login

# Force a fresh login using credentials from .env (headless)
npm run login -- --force --env

# Force a fresh interactive login
npm run login -- --force
```

**Mobile App Approval**: If prompted, you must open your Stockbit mobile app and tap "Approve" (Setujui) to authorize this CLI as a new device.

### 2. Filling Historical Data

#### Option A: Date-first (Recommended for ranges)
Processes all active stocks for a specific date, then moves to the previous date.

```bash
# Populate 5 months backward starting from yesterday
npm run populate:history:date -- --range=5mo

# Populate backward starting from a specific date
npm run populate:history:date -- --range=5mo --start=2026-01-26

# Specific date range
npm run populate:history:date -- --from=2026-01-01 --to=2026-01-31

# Test with a limit (e.g., process only first 5 stocks per date)
npm run populate:history:date -- --range=1w --limit=5
```

#### Option B: Stock-first
Populates data for each stock across the entire date range before moving to the next stock.

```bash
# Populate all available history
npm run populate:history -- --range=1y

# Test with a limit (e.g., process only the first 10 stocks)
npm run populate:history -- --limit=10
```

### 3. Daily Population (Automated)

#### Standard (Broker Summary Only)
Fetches all active stocks for a specific snapshot:

```bash
npm run populate              # today (WIB)
npm run populate -- --yesterday  # yesterday (WIB)
npm run populate -- --date=2026-03-31  # specific date
```

#### Sequential Pipeline (OHLC + Broker Summary)
Runs these steps synchronously: `force login` (via env) → `populate OHLC` → `populate broker summary`.

```bash
npm run populate:daily:sequential
```

### 4. Single Stock / Debug

```bash
# Single date
npm run populate:one BBCA --date=2026-03-31

# Relative range
npm run populate:one:range -- BBCA --range=1mo

# Explicit range
npm run populate:one:range -- --symbol=BBCA --from=2026-03-01 --to=2026-03-31

# Today only
npm run populate:one:range -- BBCA --today
```

### 5. Fetch OHLC Data

Fetches daily OHLC candles (open, high, low, close, volume) into `stock_ohlc_prices`.

```bash
# 1 year range for all active stocks
npm run populate:ohlc -- --range=1y

# Today only
npm run populate:ohlc -- --today

# Specific date range
npm run populate:ohlc -- --from=2024-01-01 --to=2024-12-31

# Single stock
npm run populate:ohlc -- --symbol=BBCA --range=6mo
```

## Database Schema

The implementation relies on:
-   **`stocks`**: List of symbols (using `code` as primary key).
-   **`broker_summaries`**: The main table storing summary data.
-   **`stock_ohlc_prices`**: Table for daily price and volume data.
-   **`brokers`**: Master list of brokers (auto-populated if a code is missing).
-   **`settings`**: Stores tokens and session metadata.

## Security

-   **Zero Password Storage**: Your Stockbit password is never stored in the database.
-   **Token Persistence**: Access and Refresh tokens are stored in the `settings` table, allowing multiple instances to share the same session.

## Data Source

All broker summary requests use fixed Stockbit parameters:
- **Investor Type**: All Investor
- **Market Board**: All Board
- **Transaction Type**: Gross
