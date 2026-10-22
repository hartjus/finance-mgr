// Membership, active state and category relevance are checked again in the
// writing statement. Locks serialize concurrent account/membership/category changes.
export const saveForecastMethodSql = `WITH eligible_forecast_category AS (
  SELECT a.id AS account_id,c.id AS category_id
  FROM accounts a JOIN account_memberships m ON m.account_id=a.id
  JOIN categories c ON c.id=$2
  WHERE a.id=$1 AND m.user_id=$3 AND m.permission IN ('owner','editor')
    AND a.is_active AND NOT c.is_system
    AND (EXISTS (SELECT 1 FROM budget_lines l WHERE l.account_id=a.id AND l.category_id=c.id AND l.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM transactions t WHERE t.account_id=a.id AND t.category_id=c.id AND t.deleted_at IS NULL))
  FOR SHARE OF a,m,c
) INSERT INTO account_category_forecast_methods (account_id,category_id,method)
  SELECT account_id,category_id,$4 FROM eligible_forecast_category
  ON CONFLICT (account_id,category_id) DO UPDATE SET method=EXCLUDED.method,updated_at=now()
  RETURNING category_id,method`;
