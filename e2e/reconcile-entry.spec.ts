import { test, expect, checkingId, savingsId } from "./fixtures";
import type { Page } from "@playwright/test";

async function fillEntry(page: Page, description: string, credit = false) {
  const dialog = page.getByRole("dialog");
  if (credit)
    await dialog.getByRole("button", { name: "Credit", exact: true }).click();
  await dialog.getByLabel("Amount", { exact: true }).fill("12.34");
  await dialog.getByLabel("Description", { exact: true }).fill(description);
  await dialog.getByLabel("Category", { exact: true }).click();
  await page.getByRole("option", { name: "Xfer Accounts" }).click();
}

test("ad-hoc debit and credit remain unreconciled and preserve reconciliation selections", async ({
  page,
}) => {
  await page.goto(`/accounts/${checkingId}/reconcile`);
  for (const [description, credit] of [
    ["Missing debit", false],
    ["Missing credit", true],
  ] as const) {
    await page
      .getByRole("button", { name: "Add transaction", exact: true })
      .click();
    await fillEntry(page, description, credit);
    const created = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().endsWith(`/accounts/${checkingId}/transactions`),
    );
    await page.getByRole("button", { name: "Save transaction" }).click();
    expect((await (await created).json()).transaction).toMatchObject({
      status: "posted",
      reconciled_at: null,
      amount_cents: credit ? 1234 : -1234,
    });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("checkbox", { name: `Select ${description}` }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("heading", { name: "$100.00", exact: true }),
    ).toBeVisible();
    if (!credit)
      await page
        .getByRole("checkbox", { name: "Select Missing debit" })
        .check();
  }
  await expect(
    page.getByRole("checkbox", { name: "Select Missing debit" }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("checkbox", { name: "Select Missing debit" }),
  ).toBeChecked();
  await expect(page).toHaveURL(`/accounts/${checkingId}/reconcile`);
  await page.reload();
  await expect(
    page.getByRole("cell", { name: "Missing credit", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Missing debit", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("invalid, cancelled and rejected reconciliation entries do not add rows", async ({
  page,
}) => {
  await page.goto(`/accounts/${checkingId}/reconcile`);
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(
    page.getByRole("dialog").getByText("Choose a category", { exact: true }),
  ).toBeVisible();
  await fillEntry(page, "Rejected entry");
  await page.route(`**/accounts/${checkingId}/transactions`, (route) =>
    route.fulfill({
      status: 403,
      json: { title: "You cannot update this account" },
    }),
  );
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(
    page.getByRole("dialog").getByText("You cannot update this account"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("No unreconciled posted transactions."),
  ).toBeVisible();
});

test("entry permission follows the selected reconciliation account", async ({
  page,
  finance,
}) => {
  finance.accounts[1].permission = "editor";
  finance.accounts[1].is_active = true;
  await page.goto(`/accounts/${checkingId}/reconcile`);
  await page.getByRole("textbox", { name: "Account", exact: true }).click();
  await page.getByRole("option", { name: "Savings", exact: true }).click();
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await fillEntry(page, "Savings entry");
  const created = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().endsWith(`/accounts/${savingsId}/transactions`),
  );
  await page.getByRole("button", { name: "Save transaction" }).click();
  expect((await created).status()).toBe(201);
  await expect(
    page.getByRole("cell", { name: "Savings entry", exact: true }),
  ).toBeVisible();
  finance.accounts[1].permission = "viewer";
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Add transaction", exact: true }),
  ).toHaveCount(0);
  finance.accounts[1].permission = "owner";
  finance.accounts[1].is_active = false;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Add transaction", exact: true }),
  ).toHaveCount(0);
});
