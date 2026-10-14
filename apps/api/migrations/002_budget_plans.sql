CREATE TYPE budget_line_type AS ENUM ('income', 'expense');

CREATE TABLE budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  budget_year integer NOT NULL CHECK (budget_year BETWEEN 1900 AND 2200),
  line_type budget_line_type NOT NULL,
  name varchar(200) NOT NULL,
  category_id uuid NOT NULL REFERENCES categories(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX budget_lines_account_year_idx ON budget_lines(account_id, budget_year);

CREATE TABLE budget_line_months (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_line_id uuid NOT NULL REFERENCES budget_lines(id) ON DELETE CASCADE,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  checked_at timestamptz,
  UNIQUE (budget_line_id, month)
);
