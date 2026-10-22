import { test, expect, checkingId, savingsId } from "./fixtures";

const category = "44444444-4444-4444-8444-444444444444";
const entry = {
  category_id: category,
  category_name: "Car payment",
  line_type: "expense",
};
const report = (methods: unknown[], month = "2026-10") => ({
  month,
  today: "2026-10-10",
  cutoff: "2026-10-10",
  balance_cents: "200000",
  methods,
  plans: [{ ...entry, amount_cents: "45000" }],
  daily:
    month === "2026-10"
      ? [{ ...entry, date: "2026-10-01", amount_cents: "45000" }]
      : [],
});

test("fixed default persists variable selection across months and sums mixed account forecasts", async ({
  page,
  finance,
}) => {
  finance.accounts[1].is_active = true;
  finance.accounts[1].permission = "editor";
  const methods: Record<string, string> = {};
  await page.route("**/accounts/*/forecast?*", (route) => {
    const url = new URL(route.request().url());
    const account = url.pathname.split("/").at(-2)!;
    return route.fulfill({
      json: report(
        methods[account]
          ? [{ category_id: category, method: methods[account] }]
          : [],
        url.searchParams.get("month")!,
      ),
    });
  });
  await page.route("**/accounts/*/forecast-methods/*", (route) => {
    expect(route.request().method()).toBe("PUT");
    const account = new URL(route.request().url()).pathname.split("/").at(-3)!;
    methods[account] = route.request().postDataJSON().method;
    return route.fulfill({
      json: { category_id: category, method: methods[account] },
    });
  });
  await page.goto(`/accounts/${checkingId}/forecast/2026-10`);
  const method = page.getByRole("textbox", {
    name: "Car payment forecast method",
  });
  const spending = page.getByRole("region", {
    name: "Forecast spending",
    exact: true,
  });
  await expect(method).toHaveValue("Fixed");
  await expect(spending).toContainText("$450.00");
  await method.click();
  await page.getByRole("option", { name: "Variable", exact: true }).click();
  await expect(method).toHaveValue("Variable");
  await expect(spending).toContainText("$1,395.00");
  await expect(
    page.getByRole("region", { name: "Spending pace" }),
  ).toContainText("forecast $1,395.00");
  await expect(
    page.getByRole("region", { name: "Cash outlook" }),
  ).toContainText("$1,055.00");
  await page.reload();
  await expect(method).toHaveValue("Variable");
  await page.getByLabel("Month", { exact: true }).fill("2026-11");
  await expect(method).toHaveValue("Variable");
  await expect(spending).toContainText("$450.00");
  await page.getByLabel("Month", { exact: true }).fill("2026-10");
  await page.getByRole("textbox", { name: "Account", exact: true }).click();
  await page.getByRole("option", { name: "Savings", exact: true }).click();
  await expect(method).toHaveValue("Fixed");
  await expect(spending).toContainText("$450.00");
  await page.getByRole("textbox", { name: "Account", exact: true }).click();
  await page.getByRole("option", { name: "All accounts", exact: true }).click();
  await expect(spending).toContainText("$1,845.00");
  await expect(
    page.getByRole("table", { name: "Forecast categories" }),
  ).toContainText("mixed");
  await expect(method).toHaveCount(0);
  await page.getByRole("textbox", { name: "Account", exact: true }).click();
  await page.getByRole("option", { name: "Checking", exact: true }).click();
  await method.click();
  await page.getByRole("option", { name: "Fixed", exact: true }).click();
  await expect(method).toHaveValue("Fixed");
  await expect(spending).toContainText("$450.00");
  await page.reload();
  await expect(method).toHaveValue("Fixed");
});

test("failed method save preserves previous forecast and a retry succeeds", async ({
  page,
}) => {
  await page.route("**/accounts/*/forecast?*", (route) =>
    route.fulfill({ json: report([]) }),
  );
  let fail = true;
  await page.route("**/accounts/*/forecast-methods/*", (route) =>
    fail
      ? route.fulfill({ status: 503, json: { title: "Save unavailable" } })
      : route.fulfill({ json: { category_id: category, method: "variable" } }),
  );
  await page.goto(`/accounts/${checkingId}/forecast/2026-10`);
  const method = page.getByRole("textbox", {
    name: "Car payment forecast method",
  });
  await method.click();
  await page.getByRole("option", { name: "Variable", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Save unavailable");
  await expect(method).toHaveValue("Fixed");
  await expect(
    page.getByRole("region", { name: "Forecast spending", exact: true }),
  ).toContainText("$450.00");
  fail = false;
  await method.click();
  await page.getByRole("option", { name: "Variable", exact: true }).click();
  await expect(method).toHaveValue("Variable");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("in-flight save disables controls and cannot leak into a different account", async ({
  page,
  finance,
}) => {
  finance.accounts[1].is_active = true;
  finance.accounts[1].permission = "editor";
  await page.route("**/accounts/*/forecast?*", (route) =>
    route.fulfill({ json: report([]) }),
  );
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  await page.route("**/accounts/*/forecast-methods/*", async (route) => {
    writes++;
    await pending;
    await route.fulfill({
      json: { category_id: category, method: "variable" },
    });
  });
  await page.goto(`/accounts/${checkingId}/forecast/2026-10`);
  const method = page.getByRole("textbox", {
    name: "Car payment forecast method",
  });
  await method.click();
  await page.getByRole("option", { name: "Variable", exact: true }).click();
  await expect(method).toBeDisabled();
  await expect(page.getByRole("status")).toContainText(
    "Saving forecast method",
  );
  await page.getByRole("textbox", { name: "Account", exact: true }).click();
  await page.getByRole("option", { name: "Savings", exact: true }).click();
  await expect(method).toHaveValue("Fixed");
  const response = page.waitForResponse((response) =>
    response.url().includes("/forecast-methods/"),
  );
  release();
  await response;
  await expect(method).toHaveValue("Fixed");
  await expect(method).toBeEnabled();
  expect(writes).toBe(1);
});

test("viewer and inactive account methods are read-only", async ({
  page,
  finance,
}) => {
  finance.accounts[0].permission = "viewer";
  finance.accounts[1].permission = "owner"; // Still inactive.
  await page.route("**/accounts/*/forecast?*", (route) =>
    route.fulfill({ json: report([]) }),
  );
  for (const id of [checkingId, savingsId]) {
    await page.goto(`/accounts/${id}/forecast/2026-10`);
    await expect(
      page.getByRole("table", { name: "Forecast categories" }),
    ).toContainText("fixed");
    await expect(
      page.getByRole("textbox", { name: "Car payment forecast method" }),
    ).toHaveCount(0);
    await expect(
      page.getByText("This account is read-only.", { exact: false }),
    ).toBeVisible();
  }
});
