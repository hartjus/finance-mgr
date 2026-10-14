import { test, expect, checkingId } from "./fixtures";

test('new filter results cannot be overwritten by a slower previous page request', async ({ page }) => {
  let release: (() => void) | undefined;
  await page.route(`**/accounts/${checkingId}/ledger?*`, async route => {
    const params = new URL(route.request().url()).searchParams;
    const pageNumber = Number(params.get('page'));
    if (pageNumber === 2) await new Promise<void>(resolve => { release = resolve; });
    const filtered = params.has('description');
    const totalItems = filtered ? 0 : 151;
    await route.fulfill({ json: { transactions: [], pagination: { page: pageNumber, pageSize: 75, totalItems, totalPages: filtered ? 1 : 3, hasNextPage: !filtered && pageNumber < 3, hasPreviousPage: pageNumber > 1 } } });
  });
  await page.goto(`/accounts/${checkingId}/ledger`);
  await expect(page.getByText('Page 1 of 3 · 151 transactions')).toBeVisible();
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect.poll(()=>Boolean(release)).toBe(true);
  await page.getByRole('textbox',{name:'Description',exact:true}).fill('none');
  await page.getByRole('button',{name:'Apply filters'}).click();
  await expect(page.getByText('Page 1 of 1 · 0 transactions')).toBeVisible();
  const oldResponse = page.waitForResponse(r=>r.url().includes('page=2'));
  release!();
  await oldResponse;
  await expect(page.getByText('Page 1 of 1 · 0 transactions')).toBeVisible();
  await expect(page.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
});

test("ledger supports next previous numbered pages sizes filters and deletion clamping", async ({
  page,
}) => {
  let count = 151;
  let fail = false;
  await page.route(`**/accounts/${checkingId}/ledger?*`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (fail)
      return route.fulfill({
        status: 503,
        json: { title: "Ledger temporarily unavailable" },
      });
    const description = params.get("description");
    const totalItems = description === "none" ? 0 : description ? 2 : count;
    const pageSize = Number(params.get("pageSize"));
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const current = Math.min(Number(params.get("page")), totalPages);
    const transactions = Array.from(
      {
        length: Math.max(
          0,
          Math.min(pageSize, totalItems - (current - 1) * pageSize),
        ),
      },
      (_, i) => {
        const n = (current - 1) * pageSize + i + 1;
        return {
          id: `row-${n}`,
          occurred_on: "2026-01-01",
          amount_cents: 100,
          description: `Entry ${n}`,
          category_id: "category",
          category_name: "Test",
          status: "posted",
          reconciled_at: null,
          transfer_id: null,
          version: 1,
          running_balance_cents: (252 - n) * 100,
        };
      },
    );
    return route.fulfill({
      json: {
        transactions,
        pagination: {
          page: current,
          pageSize,
          totalItems,
          totalPages,
          hasNextPage: current < totalPages,
          hasPreviousPage: current > 1,
        },
      },
    });
  });
  await page.route("**/transactions/row-*", (route) => {
    count--;
    return route.fulfill({ status: 204 });
  });
  await page.goto(`/accounts/${checkingId}/ledger`);
  await expect(
    page.getByRole("textbox", { name: "Results per page" }),
  ).toHaveValue("75");
  await expect(page.getByText("Page 1 of 3 · 151 transactions")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Previous", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("cell", { name: "Entry 75", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Entry 76", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Entry 1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Page 3", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Delete Entry 151", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete transaction", exact: true })
    .click();
  await expect(page.getByText("Page 2 of 2 · 150 transactions")).toBeVisible();
  await page.getByRole("textbox", { name: "Results per page" }).click();
  await page.getByRole("option", { name: "25", exact: true }).click();
  await expect(page.getByText("Page 1 of 6 · 150 transactions")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("match");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("Page 1 of 1 · 2 transactions")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("none");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("No matching transactions.")).toBeVisible();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByText("Page 1 of 6 · 150 transactions")).toBeVisible();
  fail = true;
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Ledger temporarily unavailable",
  );
  fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Page 2 of 6 · 150 transactions")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
