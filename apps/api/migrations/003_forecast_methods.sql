-- Absence of a preference means Fixed; no existing plan or ledger data is changed.
CREATE TABLE account_category_forecast_methods (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'fixed' CHECK (method IN ('fixed', 'variable')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, category_id)
);
