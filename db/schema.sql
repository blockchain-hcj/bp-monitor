CREATE TABLE IF NOT EXISTS spread_events (
  event_time TIMESTAMPTZ NOT NULL,
  symbol TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (event_time, symbol, event_id)
);

CREATE INDEX IF NOT EXISTS spread_events_symbol_time_idx
  ON spread_events (symbol, event_time DESC);

CREATE INDEX IF NOT EXISTS spread_events_time_idx
  ON spread_events (event_time DESC);

CREATE INDEX IF NOT EXISTS idx_spread_payload_exchange_a
  ON spread_events ((payload->>'exchange_a'));

CREATE INDEX IF NOT EXISTS idx_spread_payload_exchange_b
  ON spread_events ((payload->>'exchange_b'));
