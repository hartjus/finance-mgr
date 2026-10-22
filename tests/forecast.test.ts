import { describe, expect, it } from "vitest";
import { calculateForecast, type ForecastData } from "../apps/web/src/forecast";
import { parseRoute } from "../apps/web/src/routing";

const expense = {
  category_id: "food",
  category_name: "Food",
  line_type: "expense" as const,
};
const income = {
  category_id: "pay",
  category_name: "Pay",
  line_type: "income" as const,
};
const sample = (overrides: Partial<ForecastData> = {}): ForecastData => ({
  month: "2026-10",
  today: "2026-10-10",
  cutoff: "2026-10-10",
  balance_cents: "200000",
  methods: [{ category_id: "food", method: "variable" }],
  plans: [
    { ...expense, amount_cents: "30000" },
    { ...income, amount_cents: "100000" },
  ],
  daily: [
    { ...expense, date: "2026-10-02", amount_cents: "20000" },
    { ...income, date: "2026-10-03", amount_cents: "50000" },
  ],
  ...overrides,
});

describe("forecast calculations", () => {
  it("projects pace in cents and bridges balance with only remaining amounts", () => {
    const result = calculateForecast([sample()]);
    expect(result.expenses).toEqual({
      plan: 30000,
      actual: 20000,
      forecast: 62000,
    });
    expect(result.income).toEqual({
      plan: 100000,
      actual: 50000,
      forecast: 100000,
    });
    expect(result.closingBalance).toBe(208000);
    expect(result.points[10]).toMatchObject({ actual: 20000, forecast: 20000 });
    expect(result.points[11].actual).toBeNull();
    expect(result.points[31]).toMatchObject({
      plan: 30000,
      actual: null,
      forecast: 62000,
    });
  });
  it("keeps completed months actual and future months plan-only", () => {
    const past = calculateForecast([sample({ today: "2026-11-01" })]);
    expect(past.expenses.forecast).toBe(20000);
    expect(past.closingBalance).toBe(200000);
    expect(past.points.every((point) => point.forecast === null)).toBe(true);
    const future = calculateForecast([
      sample({ today: "2026-09-01", daily: [] }),
    ]);
    expect(future.elapsed).toBe(0);
    expect(future.expenses.forecast).toBe(30000);
    expect(future.points[31].forecast).toBe(30000);
  });
  it("treats the final calendar day as fully elapsed without phantom remaining income", () => {
    const result = calculateForecast([sample({ today: "2026-10-31" })]);
    expect(result.remainingIncome).toBe(0);
    expect(result.remainingExpense).toBe(0);
    expect(result.points[31].forecast).toBe(20000);
  });
  it("handles leap years, rounding and the first day without division by zero", () => {
    const result = calculateForecast([
      sample({
        month: "2024-02",
        today: "2024-02-03",
        plans: [],
        daily: [{ ...expense, date: "2024-02-01", amount_cents: "100" }],
      }),
    ]);
    expect(result.days).toBe(29);
    expect(result.expenses.forecast).toBe(967);
    expect(
      calculateForecast([sample({ today: "2026-10-01", daily: [] })]).expenses
        .forecast,
    ).toBe(30000);
  });
  it("includes unbudgeted and plan-only categories and aggregates accounts once", () => {
    const other = sample({
      plans: [],
      methods: [{ category_id: "unplanned", method: "variable" }],
      daily: [
        {
          ...expense,
          category_id: "unplanned",
          date: "2026-10-02",
          amount_cents: "100",
        },
      ],
    });
    const result = calculateForecast([sample(), other]);
    expect(result.rows.find((row) => row.id === "unplanned")).toMatchObject({
      plan: 0,
      actual: 100,
      forecast: 310,
    });
    expect(result.balance).toBe(400000);
    expect(result.expenses.forecast).toBe(62310);
    expect(calculateForecast([sample({ daily: [] })]).expenses.forecast).toBe(
      30000,
    );
    expect(
      calculateForecast([sample({ daily: [], plans: [] })]).expenses.forecast,
    ).toBe(0);
  });
  it("preserves the original route and validates forecast month routes", () => {
    expect(parseRoute("/accounts/all/budget")).toMatchObject({
      screen: "budget",
    });
    expect(parseRoute("/accounts/all/forecast/2026-10")).toEqual({
      screen: "forecast",
      accountId: "all",
      month: "2026-10",
    });
    expect(parseRoute("/accounts/all/forecast/2026-13").screen).toBe("missing");
  });

  it("defaults to Fixed and never paces fixed or unbudgeted expenses", () => {
    const fixed = sample({ methods: [] });
    expect(
      calculateForecast([fixed]).rows.find((row) => row.id === "food"),
    ).toMatchObject({ method: "fixed", forecast: 30000 });
    expect(
      calculateForecast([sample({ methods: undefined, plans: [] })]).expenses
        .forecast,
    ).toBe(20000);
    const over = sample({
      methods: [],
      daily: [{ ...expense, date: "2026-10-02", amount_cents: "47500" }],
    });
    expect(calculateForecast([over]).expenses.forecast).toBe(47500);
    expect(
      calculateForecast([sample({ ...over, daily: [] })]).expenses.forecast,
    ).toBe(30000);
  });

  it("calculates mixed methods per account before aggregating matching categories", () => {
    const fixed = sample({
      methods: [],
      plans: [{ ...expense, amount_cents: "45000" }],
      daily: [{ ...expense, date: "2026-10-01", amount_cents: "45000" }],
    });
    const result = calculateForecast([fixed, sample()]);
    expect(result.rows.find((row) => row.id === "food")).toMatchObject({
      method: "mixed",
      plan: 75000,
      actual: 65000,
      forecast: 107000,
    });
    expect(result.expenses.forecast).toBe(107000);
    expect(result.points[31].forecast).toBe(107000);
    expect(result.closingBalance).toBe(408000);
    // Even identical methods must apply their per-account floor before summing.
    const under = sample({ methods: [], daily: [] });
    const over = sample({
      methods: [],
      plans: [],
      daily: [{ ...expense, date: "2026-10-02", amount_cents: "50000" }],
    });
    expect(calculateForecast([under, over]).expenses.forecast).toBe(80000);
    expect(calculateForecast([under, over]).rows[0].method).toBe("fixed");
  });

  it.each(["fixed", "variable"] as const)(
    "preserves income and period rules with %s expenses",
    (method) => {
      const data = sample({
        methods: [
          { category_id: "food", method },
          { category_id: "pay", method: "variable" },
        ],
      });
      expect(calculateForecast([data]).income.forecast).toBe(100000);
      expect(
        calculateForecast([{ ...data, today: "2026-11-01" }]).expenses.forecast,
      ).toBe(20000);
      expect(
        calculateForecast([{ ...data, today: "2026-10-31" }]).expenses.forecast,
      ).toBe(20000);
      expect(
        calculateForecast([{ ...data, today: "2026-09-01", daily: [] }])
          .expenses.forecast,
      ).toBe(30000);
    },
  );
  it("preserves the existing income formula when combining accounts", () => {
    const one = sample({
      plans: [{ ...income, amount_cents: "100000" }],
      daily: [{ ...income, date: "2026-10-01", amount_cents: "150000" }],
    });
    const two = sample({
      plans: [{ ...income, amount_cents: "100000" }],
      daily: [],
    });
    expect(calculateForecast([one, two]).income).toEqual({
      plan: 200000,
      actual: 150000,
      forecast: 200000,
    });
  });
});
