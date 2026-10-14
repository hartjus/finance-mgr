import { test, expect, checkingId } from "./fixtures";

test("records and edits an unreconciled debit", async ({ page }) => {
  await page.goto(`/accounts/${checkingId}/ledger`);
  await page.getByRole("button", { name: "Add transaction" }).click();
  await page.getByLabel("Amount", { exact: true }).fill("12.34");
  await page
    .getByRole("dialog")
    .getByLabel("Description", { exact: true })
    .fill("Lunch");
  await page
    .getByRole("dialog")
    .getByLabel("Category", { exact: true })
    .click();
  await page.getByRole("option", { name: "Xfer Accounts" }).click();
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(
    page.getByRole("cell", { name: "Lunch", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit Lunch" }).click();
  await page.getByLabel("Amount", { exact: true }).fill("13.00");
  await page
    .getByRole("dialog")
    .getByLabel("Description", { exact: true })
    .fill("Lunch updated");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("cell", { name: "Lunch updated", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "-$13.00", exact: true }),
  ).toBeVisible();
});
