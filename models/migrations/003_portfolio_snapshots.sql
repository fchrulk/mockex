-- Portfolio snapshot table for Spec 3: Portfolio & PnL Dashboard

CREATE TABLE mockex.portfolio_snapshots (
    id              SERIAL PRIMARY KEY,
    account_id      INTEGER NOT NULL REFERENCES mockex.paper_accounts(id),
    total_equity    NUMERIC(19,2) NOT NULL,
    cash_balance    NUMERIC(19,2) NOT NULL,
    unrealized_pnl  NUMERIC(19,2) NOT NULL DEFAULT 0,
    realized_pnl    NUMERIC(19,2) NOT NULL DEFAULT 0,
    btc_price       NUMERIC(18,2) NOT NULL,
    snapshot_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_snapshots_account_time
    ON mockex.portfolio_snapshots(account_id, snapshot_at);
