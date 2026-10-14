import { test, expect, checkingId, savingsId } from "./fixtures";

test("Home summarizes accounts and opens the chosen ledger", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "$62.50", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Savings" })).toContainText(
    "Inactive",
  );
  await expect(page.getByRole("region", { name: "Checking" })).toContainText(
    "•• 1234",
  );
  await page.getByRole("button", { name: "Open Savings" }).click();
  await expect(page).toHaveURL(`/accounts/${savingsId}/ledger`);
  await expect(
    page.getByRole("button", { name: "Add transaction" }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: /Savings/ })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("empty Home points to Accounts settings", async ({ page, finance }) => {
  finance.accounts.length = 0;
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "No accounts yet" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Manage accounts" }).click();
  await expect(
    page.getByRole("tab", { name: "Accounts", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});
for (const screen of ["ledger", "analysis", "budget", "reconcile", "bulk"]) {
  test(`refresh restores ${screen} and its account`, async ({ page }) => {
    await page.goto(`/accounts/${checkingId}/${screen}`);
    if (screen === "ledger")
      await expect(
        page.getByRole("heading", { name: /Checking/ }),
      ).toBeVisible();
    else
      await expect(
        page.getByRole("textbox", {
          name: screen === "analysis" ? "Analysis account" : "Account",
          exact: true,
        }),
      ).toHaveValue("Checking");
    await page.reload();
    await expect(page).toHaveURL(`/accounts/${checkingId}/${screen}`);
    if (screen === "ledger")
      await expect(
        page.getByRole("heading", { name: /Checking/ }),
      ).toBeVisible();
    else
      await expect(
        page.getByRole("textbox", {
          name: screen === "analysis" ? "Analysis account" : "Account",
          exact: true,
        }),
      ).toHaveValue("Checking");
    await expect(
      page.getByRole("heading", { name: "Page unavailable" }),
    ).toHaveCount(0);
  });
}
test("settings tabs restore and keep preferences and categories separate", async ({
  page,
}) => {
  await page.goto("/settings/general");
  await expect(page.getByRole("textbox", { name: "Appearance" })).toBeVisible();
  await page.getByRole("tab", { name: "Categories", exact: true }).click();
  await expect(page.getByLabel("Appearance")).toHaveCount(0);
  await page.getByLabel("New category").fill("Groceries");
  await page.getByRole("button", { name: "Create category" }).click();
  await expect(
    page.getByRole("cell", { name: "Groceries", exact: true }),
  ).toBeVisible();
  for (const tab of ["Accounts", "General", "Categories"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.reload();
    await expect(
      page.getByRole("tab", { name: tab, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("account creation and owner management live in settings", async ({
  page,
}) => {
  await page.goto("/settings/accounts");
  await expect(
    page.locator("nav").getByRole("button", { name: "Add account" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Rename Savings" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Rename Checking" }).click();
  await page.getByLabel("Account name").fill("Daily");
  await page.getByRole("button", { name: "Save name" }).click();
  await page.getByRole("button", { name: "Deactivate Daily" }).click();
  await expect(
    page.getByRole("button", { name: "Reactivate Daily" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(
    page.getByText("Account name and number are required"),
  ).toBeVisible();
  await page.getByLabel("Account name").fill("Holiday");
  // Generate input in-browser to keep full account numbers out of fixtures/reports.
  await page
    .getByLabel("Account number")
    .evaluate((element: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(
        element,
        String(Math.floor(Math.random() * 90000000) + 10000000),
      );
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await page.getByLabel("Starting balance").fill("25.00");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(
    page.getByRole("button", { name: "View Holiday" }),
  ).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Holiday" })).toContainText(
    "$25.00",
  );
});
test("unknown routes, inaccessible accounts, authentication and load errors", async ({
  page,
  finance,
}) => {
  for (const path of ["/missing", "/accounts/not-owned/ledger"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Page unavailable" }),
    ).toBeVisible();
  }
  finance.authenticated = false;
  await page.goto("/settings/categories");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  finance.authenticated = true;
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Categories", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  finance.failAccounts = true;
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Accounts temporarily unavailable",
  );
  finance.failAccounts = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
});
test("dirty bulk entry guards browser history and mobile navigation works", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Checking" }).click();
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("link", { name: "Bulk add", exact: true }).click();
  await page.getByLabel("Transaction description").fill("Draft");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(`/accounts/${checkingId}/bulk`);
  await expect(page.getByLabel("Transaction description")).toHaveValue("Draft");
  page.once("dialog", (dialog) => dialog.accept());
  await page.goBack();
  await expect(page).toHaveURL(`/accounts/${checkingId}/ledger`);
});
