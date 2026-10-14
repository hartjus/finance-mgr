CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('admin', 'user');
CREATE TYPE account_permission AS ENUM ('owner', 'editor', 'viewer');
CREATE TYPE transaction_status AS ENUM ('pending', 'posted');
CREATE TYPE budget_period_type AS ENUM ('monthly', 'yearly');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(320) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_expiry_idx ON sessions(user_id, expires_at);

CREATE TABLE idempotency_keys (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key varchar(255) NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  name varchar(120) NOT NULL,
  account_number_ciphertext bytea NOT NULL,
  account_number_iv bytea NOT NULL,
  account_number_auth_tag bytea NOT NULL,
  encryption_key_version integer NOT NULL DEFAULT 1,
  account_number_last_four varchar(4) NOT NULL CHECK (account_number_last_four ~ '^[0-9]{4}$'),
  starting_balance_cents bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_memberships (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission account_permission NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  is_archived boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  system_key varchar(50),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name),
  UNIQUE (user_id, system_key)
);

CREATE TABLE transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  occurred_on date NOT NULL,
  notes text,
  reverses_transfer_id uuid UNIQUE REFERENCES transfers(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  occurred_on date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
  currency char(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  description varchar(500) NOT NULL,
  identifier varchar(255),
  category_id uuid NOT NULL REFERENCES categories(id),
  notes text,
  status transaction_status NOT NULL DEFAULT 'posted',
  reconciled_at timestamptz,
  reconciled_by_user_id uuid REFERENCES users(id),
  transfer_id uuid REFERENCES transfers(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by_user_id uuid REFERENCES users(id),
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX transactions_ledger_idx ON transactions(account_id, occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX transactions_category_idx ON transactions(category_id, occurred_on);

CREATE TABLE budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  category_id uuid NOT NULL REFERENCES categories(id),
  period_type budget_period_type NOT NULL,
  period_start date NOT NULL,
  planned_amount_cents bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, category_id, period_type, period_start)
);
