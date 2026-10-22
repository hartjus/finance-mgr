import { test, expect, checkingId, savingsId } from "./fixtures";

const amount = (type: "income" | "expense", cents: string) => ({
  category_id: type,
  category_name: type === "expense" ? "Groceries" : "Salary",
  line_type: type,
  amount_cents: cents,
});
function report(month = "2026-10") {
  return {
    month,
    today: "2026-10-10",
    cutoff: "2026-10-10",
    balance_cents: "200000",
    plans: [amount("expense", "30000"), amount("income", "100000")],
    daily:
      month === "2026-10"
        ? [
            { ...amount("expense", "20000"), date: "2026-10-02" },
            { ...amount("income", "50000"), date: "2026-10-03" },
          ]
        : [],
  };
}

test("new forecast displays real plans, scenario, account/month routes and preserves original budget", async ({
  page,
}) => {
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PATCH", "DELETE", "PUT"].includes(request.method()))
      mutations.push(request.url());
  });
  await page.route("**/accounts/*/forecast?*", (route) =>
    route.fulfill({
      json: report(new URL(route.request().url()).searchParams.get("month")!),
    }),
  );
  await page.goto(`/accounts/${checkingId}/forecast/2026-10`);
  await expect(
    page.getByRole("heading", { name: "Budget & forecast", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Forecast spending", exact: true }),
  ).toContainText("$620.00");
  await expect(
    page.getByRole("region", { name: "Forecast surplus", exact: true }),
  ).toContainText("$380.00");
  await expect(
    page.getByRole("region", { name: "Cash outlook", exact: true }),
  ).toContainText("$2,080.00");
  await expect(
    page.getByRole("region", { name: "Spending pace", exact: true }),
  ).toContainText("forecast $620.00");
  await expect(
    page.getByRole("table", { name: "Forecast categories" }),
  ).toContainText("Groceries");
  await page.screenshot({
    path: test.info().outputPath("forecast.png"),
    fullPage: true,
  });
  await page.getByText("Income", { exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Forecast categories" }),
  ).toContainText("Salary");
  await page.getByRole("button", { name: "Try a what-if scenario" }).click();
  await page
    .getByRole("textbox", { name: "Reduce remaining spending by ($)" })
    .fill("100");
  await expect(page.getByRole("dialog")).toContainText(
    "Scenario surplus: $480.00",
  );
  await expect(page.getByRole("dialog")).toContainText(
    "Scenario month-end balance: $2,180.00",
  );
  await page.getByRole("button", { name: "Close scenario" }).click();
  await expect(
    page.getByRole("region", { name: "Forecast spending", exact: true }),
  ).toContainText("$620.00");
  await page.getByRole("textbox", { name: "Account", exact: true }).click();
  await page.getByRole("option", { name: "All accounts", exact: true }).click();
  await expect(page).toHaveURL("/accounts/all/forecast/2026-10");
  await expect(
    page.getByRole("region", { name: "Forecast spending", exact: true }),
  ).toContainText("$1,240.00");
  await page.getByLabel("Month", { exact: true }).fill("2026-11");
  await page.reload();
  await expect(page).toHaveURL("/accounts/all/forecast/2026-11");
  await expect(
    page.getByRole("region", { name: "Forecast spending", exact: true }),
  ).toContainText("$600.00");
  await expect(
    page.getByRole("region", { name: "Cash outlook", exact: true }),
  ).toContainText("Future months need intervening cash flows");
  expect(mutations).toEqual([]);
  await page
    .getByRole("button", { name: "View plans", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL("/accounts/all/budget");
  await expect(
    page.getByRole("region", { name: "Editable budget grid" }),
  ).toBeVisible();
});

test("forecast handles errors, retry, empty months, viewer access and responsive dark layout", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("finance-theme", "dark"));
  let fail = true;
  await page.route("**/accounts/*/forecast?*", (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: { title: "Report temporarily unavailable" },
        })
      : route.fulfill({ json: { ...report(), plans: [], daily: [] } }),
  );
  await page.goto(`/accounts/${savingsId}/forecast/2026-10`);
  await expect(page.getByRole("alert")).toContainText(
    "Report temporarily unavailable",
  );
  fail = false;
  await page.getByRole("button", { name: "Retry forecast" }).click();
  await expect(
    page.getByText("No plans or transactions for this month"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit plan", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "View plans", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Forecast spending", exact: true }),
  ).toContainText("$0.00");
  await expect(
    page.getByRole("button", { name: "Try a what-if scenario" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Review transactions", exact: true })
    .click();
  await expect(page).toHaveURL(`/accounts/${savingsId}/ledger`);
  await page.goto("/accounts/not-accessible/forecast/2026-10");
  await expect(
    page.getByRole("heading", { name: "Page unavailable" }),
  ).toBeVisible();
});

test("a stale forecast response cannot replace a newer month", async ({
  page,
}) => {
  let release!: () => void;
  let requested!: () => void;
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/accounts/*/forecast?*", async (route) => {
    const month = new URL(route.request().url()).searchParams.get("month")!;
    if (month === "2026-10") {
      requested();
      await pending;
    }
    await route.fulfill({ json: report(month) });
  });
  await page.goto(`/accounts/${checkingId}/forecast/2026-10`);
  await started;
  await expect(page.getByRole("status")).toContainText("Loading forecast");
  await page.getByLabel("Month", { exact: true }).fill("2026-11");
  await expect(
    page.getByRole("region", { name: "Forecast spending", exact: true }),
  ).toContainText("$300.00");
  release();
  await page.waitForResponse((response) =>
    response.url().includes("/forecast?month=2026-10"),
  );
  await expect(
    page.getByRole("region", { name: "Forecast spending", exact: true }),
  ).toContainText("$300.00");
  await expect(
    page.getByText("Future plan · no actuals yet", { exact: false }),
  ).toBeVisible();
});
