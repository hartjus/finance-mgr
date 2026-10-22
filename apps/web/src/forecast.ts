export type ForecastMethod = "fixed" | "variable";
export type ForecastAmount = {
  category_id: string;
  category_name: string;
  line_type: "income" | "expense";
  amount_cents: string;
};
export type ForecastData = {
  month: string;
  today: string;
  cutoff: string;
  balance_cents: string;
  plans: ForecastAmount[];
  daily: (ForecastAmount & { date: string })[];
  methods?: { category_id: string; method: ForecastMethod }[];
};

type ForecastRow = {
  id: string;
  name: string;
  type: "income" | "expense";
  plan: number;
  actual: number;
  forecast: number;
  method: ForecastMethod | "mixed";
};

export function calculateForecast(data: ForecastData[]) {
  const { month, today } = data[0];
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const period =
    month < today.slice(0, 7)
      ? "past"
      : month > today.slice(0, 7)
        ? "future"
        : "current";
  const elapsed =
    period === "past"
      ? days
      : period === "future"
        ? 0
        : Number(today.slice(8, 10));
  const categories = new Map<string, ForecastRow>();
  const daily = Array.from({ length: days + 1 }, () => 0);
  for (const account of data) {
    const accountCategories = new Map<string, ForecastRow>();
    const methods = new Map(
      account.methods?.map((item) => [item.category_id, item.method]),
    );
    for (const [kind, rows] of [
      ["plan", account.plans],
      ["actual", account.daily],
    ] as const) {
      for (const row of rows) {
        const key = `${row.line_type}:${row.category_id}`;
        const entry = accountCategories.get(key) ?? {
          id: row.category_id,
          name: row.category_name,
          type: row.line_type,
          plan: 0,
          actual: 0,
          forecast: 0,
          method:
            row.line_type === "expense"
              ? (methods.get(row.category_id) ?? "fixed")
              : "fixed",
        };
        entry[kind] += Number(row.amount_cents);
        accountCategories.set(key, entry);
        if (kind === "actual" && row.line_type === "expense")
          daily[
            Number((row as ForecastData["daily"][number]).date.slice(8, 10))
          ] += Number(row.amount_cents);
      }
    }
    // Compute each account/expense category before aggregation: both the method and
    // max(plan, actual/pace) are account-specific and cannot be applied after summing.
    for (const [key, row] of accountCategories) {
      row.forecast =
        elapsed === days
          ? row.actual
          : period === "future"
            ? row.plan
            : row.type === "expense" && row.method === "variable"
              ? Math.max(row.plan, Math.round((row.actual * days) / elapsed))
              : Math.max(row.plan, row.actual);
      const existing = categories.get(key);
      if (!existing) categories.set(key, { ...row });
      else {
        existing.plan += row.plan;
        existing.actual += row.actual;
        existing.forecast += row.forecast;
        if (existing.method !== row.method) existing.method = "mixed";
      }
    }
  }
  const rows = [...categories.values()];
  // Income has no selectable method. Preserve its existing scope-level formula.
  for (const row of rows) {
    if (row.type === "income")
      row.forecast =
        elapsed === days
          ? row.actual
          : period === "future"
            ? row.plan
            : Math.max(row.plan, row.actual);
  }
  const total = (
    type: "expense" | "income",
    field: "plan" | "actual" | "forecast",
  ) =>
    rows
      .filter((row) => row.type === type)
      .reduce((sum, row) => sum + row[field], 0);
  const expenses = {
    plan: total("expense", "plan"),
    actual: total("expense", "actual"),
    forecast: total("expense", "forecast"),
  };
  const income = {
    plan: total("income", "plan"),
    actual: total("income", "actual"),
    forecast: total("income", "forecast"),
  };
  const balance = data.reduce(
    (sum, account) => sum + Number(account.balance_cents),
    0,
  );
  const remainingExpense = expenses.forecast - expenses.actual;
  const remainingIncome = income.forecast - income.actual;
  let cumulative = 0;
  const points = daily.map((amount, day) => {
    cumulative += amount;
    return {
      day,
      plan: Math.round((expenses.plan * day) / days),
      actual: day <= elapsed ? cumulative : null,
      forecast:
        period !== "past" && day >= elapsed
          ? expenses.actual +
            Math.round(
              (remainingExpense * (day - elapsed)) / (days - elapsed || 1),
            )
          : null,
    };
  });
  return {
    month,
    days,
    elapsed,
    period,
    rows,
    points,
    expenses,
    income,
    balance,
    remainingExpense,
    remainingIncome,
    closingBalance: balance + remainingIncome - remainingExpense,
  };
}
