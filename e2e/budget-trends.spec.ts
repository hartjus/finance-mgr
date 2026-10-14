import { test, expect, checkingId, savingsId } from "./fixtures";

test("cumulative trend lines carry monthly totals forward and follow account and year scope", async ({
  page,
}) => {
  const year = new Date().getFullYear();
  await page.route("**/accounts/*/budget?*", (route) => {
    const url = new URL(route.request().url());
    const factor = url.pathname.includes(savingsId) ? 2 : 1;
    const line = (
      id: string,
      type: string,
      cents: number,
      checked = false,
    ) => ({
      id,
      name: id,
      line_type: type,
      category_id: id,
      category_name: id,
      months: Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        amount_cents: index < 2 ? String(cents * factor) : "0",
        checked_at: checked ? "2026-01-01" : null,
      })),
    });
    const actual = (id: string, type: string, cents: number, month = 1) => ({
      category_id: id,
      line_type: type,
      month,
      amount_cents: String(cents * factor),
    });
    return route.fulfill({
      json:
        Number(url.searchParams.get("year")) !== year
          ? { lines: [], actuals: [] }
          : {
              lines: [
                line("expense-a", "expense", 10000),
                line("expense-b", "expense", 5000),
                line("already-entered", "expense", 90000, true),
                line("income", "income", 30000),
              ],
              actuals: [
                actual("expense-a", "expense", 4000),
                actual("expense-b", "expense", 3000),
                actual("income", "income", 25000),
                actual("expense-a", "expense", 1000, 2),
                actual("income", "income", 5000, 2),
              ],
            },
    });
  });
  await page.goto(`/accounts/${checkingId}/budget`);
  const chart = page.getByRole("region", { name: "Monthly budget trends" });
  await expect(
    page.getByRole("heading", {
      name: "Planned vs Actual by Month",
      exact: true,
    }),
  ).toBeVisible();
  await chart.scrollIntoViewIfNeeded();
  await expect(chart.locator(".recharts-line-curve")).toHaveCount(4);
  for (const label of [
    "Planned expenses",
    "Actual expenses",
    "Planned income",
    "Actual income",
  ]) {
    await expect(chart.getByText(label, { exact: true }).first()).toBeVisible();
  }
  const tooltip = chart.locator(".recharts-tooltip-wrapper");
  await chart.locator('.recharts-dot[name="Actual income"]').first().hover();
  for (const amount of ["$150.00", "$70.00", "$300.00", "$250.00"])
    await expect(tooltip).toContainText(amount);
  await chart.locator('.recharts-dot[name="Actual income"]').nth(1).hover();
  await expect(tooltip).toContainText("Feb");
  for (const amount of ["$300.00", "$80.00", "$600.00", "$300.00"])
    await expect(tooltip).toContainText(amount);
  await chart.locator('.recharts-dot[name="Actual income"]').nth(2).hover();
  await expect(tooltip).toContainText("Mar");
  for (const amount of ["$300.00", "$80.00", "$600.00"])
    await expect(tooltip).toContainText(amount);
  await page.getByRole("textbox", { name: "Account", exact: true }).click();
  await page.getByRole("option", { name: "All accounts", exact: true }).click();
  await chart.scrollIntoViewIfNeeded();
  await chart.locator('.recharts-dot[name="Actual income"]').first().hover();
  for (const amount of ["$450.00", "$210.00", "$900.00", "$750.00"])
    await expect(tooltip).toContainText(amount);
  await chart.locator('.recharts-dot[name="Actual income"]').nth(1).hover();
  for (const amount of ["$900.00", "$240.00", "$1,800.00"])
    await expect(tooltip).toContainText(amount);
  await page.getByRole("textbox", { name: "Year", exact: true }).click();
  await page
    .getByRole("option", { name: String(year - 1), exact: true })
    .click();
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toContainText(String(year - 1));
  await chart.locator('.recharts-dot[name="Actual income"]').first().hover();
  await expect(tooltip.locator(".recharts-tooltip-item-value")).toHaveText([
    "$0.00",
    "$0.00",
    "$0.00",
    "$0.00",
  ]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
