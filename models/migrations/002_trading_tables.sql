-- Paper trading tables for Spec 2: Trading Engine

CREATE TABLE mockex.paper_accounts (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL DEFAULT 'Default',
    initial_balance NUMERIC(19,2) NOT NULL DEFAULT 100000.00,
    cash_balance    NUMERIC(19,2) NOT NULL DEFAULT 100000.00,
    reserved_balance NUMERIC(19,2) NOT NULL DEFAULT 0.00,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    reset_at        TIMESTAMPTZ
);

CREATE TABLE mockex.paper_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      INTEGER NOT NULL REFERENCES mockex.paper_accounts(id),
    symbol          VARCHAR(20) NOT NULL DEFAULT 'BTCUSDT',
    side            VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
    order_type      VARCHAR(10) NOT NULL CHECK (order_type IN ('market', 'limit', 'stop')),
    quantity        NUMERIC(18,8) NOT NULL,
    price           NUMERIC(18,2),
    stop_price      NUMERIC(18,2),
    status          VARCHAR(10) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'open', 'filled', 'cancelled')),
    filled_qty      NUMERIC(18,8) NOT NULL DEFAULT 0,
    avg_fill_price  NUMERIC(18,2),
    fee             NUMERIC(18,8) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE mockex.paper_trades (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      INTEGER NOT NULL REFERENCES mockex.paper_accounts(id),
    order_id        UUID NOT NULL REFERENCES mockex.paper_orders(id),
    symbol          VARCHAR(20) NOT NULL DEFAULT 'BTCUSDT',
    side            VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
    quantity        NUMERIC(18,8) NOT NULL,
    price           NUMERIC(18,2) NOT NULL,
    fee             NUMERIC(18,8) NOT NULL,
    realized_pnl    NUMERIC(18,2),
    executed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE mockex.paper_positions (
    id              SERIAL PRIMARY KEY,
    account_id      INTEGER NOT NULL REFERENCES mockex.paper_accounts(id),
    symbol          VARCHAR(20) NOT NULL DEFAULT 'BTCUSDT',
    side            VARCHAR(5) NOT NULL CHECK (side IN ('long')),
    quantity        NUMERIC(18,8) NOT NULL,
    entry_price     NUMERIC(18,2) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id, symbol)
);

CREATE INDEX idx_orders_account_status ON mockex.paper_orders(account_id, status);
CREATE INDEX idx_trades_account ON mockex.paper_trades(account_id, executed_at DESC);
