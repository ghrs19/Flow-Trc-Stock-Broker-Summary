-- Stock daily OHLC price data sourced from Stockbit Chartbit API
CREATE TABLE IF NOT EXISTS stock_ohlc_prices (
  trade_date        DATE          NOT NULL,
  stock_code        VARCHAR(10)   NOT NULL,
  open              INTEGER       NOT NULL DEFAULT 0,
  high              INTEGER       NOT NULL DEFAULT 0,
  low               INTEGER       NOT NULL DEFAULT 0,
  close             INTEGER       NOT NULL DEFAULT 0,
  volume            BIGINT        NOT NULL DEFAULT 0,
  value             BIGINT        NOT NULL DEFAULT 0,
  frequency         INTEGER       NOT NULL DEFAULT 0,
  foreign_buy       BIGINT        NOT NULL DEFAULT 0,
  foreign_sell      BIGINT        NOT NULL DEFAULT 0,
  foreign_flow      BIGINT        NOT NULL DEFAULT 0,
  dividend          NUMERIC(18,4) NOT NULL DEFAULT 0,
  share_outstanding BIGINT        NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  PRIMARY KEY (trade_date, stock_code),
  CONSTRAINT fk_stock_prices_stock FOREIGN KEY (stock_code) REFERENCES stocks (code)
);

-- Index for common query patterns
CREATE INDEX IF NOT EXISTS idx_stock_ohlc_prices_stock_code ON stock_ohlc_prices (stock_code);
CREATE INDEX IF NOT EXISTS idx_stock_ohlc_prices_trade_date ON stock_ohlc_prices (trade_date DESC);
