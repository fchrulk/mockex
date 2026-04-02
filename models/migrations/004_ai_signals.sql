-- AI signals table for Spec 5: AI Trading Signals

CREATE TABLE mockex.ai_signals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      INTEGER NOT NULL REFERENCES mockex.paper_accounts(id),
    signal_type     VARCHAR(30) NOT NULL,
    source          VARCHAR(10) NOT NULL CHECK (source IN ('rule', 'claude')),
    direction       VARCHAR(7) NOT NULL CHECK (direction IN ('buy', 'sell', 'neutral')),
    strength        VARCHAR(10),
    confidence      INTEGER CHECK (confidence BETWEEN 0 AND 100),
    price_at_signal NUMERIC(18,2) NOT NULL,
    indicators_data JSONB,
    reasoning       TEXT,
    outcome         VARCHAR(10) CHECK (outcome IN ('correct', 'incorrect', 'pending')),
    outcome_price   NUMERIC(18,2),
    outcome_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_signals_account_time ON mockex.ai_signals(account_id, created_at DESC);
CREATE INDEX idx_signals_outcome ON mockex.ai_signals(outcome) WHERE outcome = 'pending';
