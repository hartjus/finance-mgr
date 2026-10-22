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
  const categories = new Map<
    string,
    {
      id: string;
      name: string;
      type: "income" | "expense";
      plan: number;
      actual: number;
      forecast: number;
    }
  >();
  const daily = Array.from({ length: days + 1 }, () => 0);
  for (const account of data) {
    for (const [kind, rows] of [
      ["plan", account.plans],
      ["actual", account.daily],
    ] as const) {
      for (const row of rows) {
        const key = `${row.line_type}:${row.category_id}`;
        const entry = categories.get(key) ?? {
          id: row.category_id,
          name: row.category_name,
          type: row.line_type,
          plan: 0,
          actual: 0,
          forecast: 0,
        };
        entry[kind] += Number(row.amount_cents);
        categories.set(key, entry);
        if (kind === "actual" && row.line_type === "expense")
          daily[
            Number((row as ForecastData["daily"][number]).date.slice(8, 10))
          ] += Number(row.amount_cents);
      }
    }
  }
  const rows = [...categories.values()].map((row) => ({
    ...row,
    forecast:
      elapsed === days
        ? row.actual
        : period === "future"
          ? row.plan
          : row.type === "expense"
            ? Math.max(row.plan, Math.round((row.actual * days) / elapsed))
            : Math.max(row.plan, row.actual),
  }));
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
