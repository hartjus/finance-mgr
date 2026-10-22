import { test, expect, checkingId, savingsId } from "./fixtures";
import type { Page } from "@playwright/test";

test("older year responses cannot replace the selected year; current-month copy still works", async ({
  page,
}) => {
  const state = await fixture(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/accounts/*/budget?year=2025", async (route) => {
    requested = true;
    await held;
    await route.fulfill({ json: { lines: [], actuals: [] } });
  });
  await page.route("**/budget-lines/expense/replicate", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      amountCents: 9000,
      fromMonth: 10,
    });
    state.years["2026"][0].months.slice(9).forEach((month) => {
      month.amount_cents = 9000;
    });
    await route.fulfill({ status: 204 });
  });
  await page.goto(`/accounts/${checkingId}/budget`);
  const year = page.getByRole("textbox", { name: "Year", exact: true });
  await year.click();
  await page.getByRole("option", { name: "2025", exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await expect(
    page.getByRole("button", { name: "Copy to 2026", exact: true }),
  ).toBeDisabled();
  await year.click();
  await page.getByRole("option", { name: "2026", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Copy January for Car payment",
      exact: true,
    }),
  ).toBeEnabled();
  const oldResponse = page.waitForResponse((response) =>
    response.url().endsWith("budget?year=2025"),
  );
  release();
  await oldResponse;
  await page
    .getByRole("button", {
      name: "Copy current month for Car payment",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: "Car payment month 12 amount",
      exact: true,
    }),
  ).toHaveValue("$90.00");
  await expect(year).toHaveValue("2026");
});
const categoryId = "44444444-4444-4444-8444-444444444444";
const makeLines = () =>
  [
    { id: "expense", name: "Car payment", line_type: "expense", cents: 45000 },
    { id: "income", name: "Salary", line_type: "income", cents: 300000 },
  ].map((line) => ({
    ...line,
    category_id: categoryId,
    category_name: "Synthetic category",
    months: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      amount_cents: i === 0 ? line.cents : i * 1000,
      checked_at: i < 2 ? "2026-01-01" : (null as string | null),
    })),
  }));
async function fixture(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-22T12:00:00"));
  const years: Record<string, ReturnType<typeof makeLines>> = {
    "2026": makeLines(),
  };
  const state = {
    years,
    januaryCopies: 0,
    yearCopies: 0,
    failYear: false,
    failMonth: false,
    waitMonth: Promise.resolve(),
  };
  await page.route("**/accounts/*/budget?*", (route) =>
    route.fulfill({
      json: {
        lines:
          years[new URL(route.request().url()).searchParams.get("year")!] ?? [],
        actuals: [],
      },
    }),
  );
  await page.route("**/budget-lines/*/months", async (route) => {
    await state.waitMonth;
    if (state.failMonth)
      return route.fulfill({
        status: 503,
        json: { title: "Month save failed" },
      });
    const input = route.request().postDataJSON();
    const id = route.request().url().split("/").at(-2);
    const line = Object.values(years)
      .flat()
      .find((line) => line.id === id)!;
    const month = line.months[input.month - 1];
    month.amount_cents = input.amountCents;
    month.checked_at = input.checked ? "2026-01-01" : null;
    return route.fulfill({ status: 204 });
  });
  await page.route("**/budget-lines/*/copy-january", (route) => {
    state.januaryCopies++;
    expect(route.request().postData()).toBeNull();
    expect(route.request().headers()["content-type"]).toBeUndefined();
    const id = route.request().url().split("/").at(-2);
    const line = Object.values(years)
      .flat()
      .find((line) => line.id === id)!;
    line.months.slice(1).forEach((month) => {
      month.amount_cents = line.months[0].amount_cents;
    });
    return route.fulfill({ status: 204 });
  });
  await page.route("**/accounts/*/budget/copy-next-year", (route) => {
    state.yearCopies++;
    const input = route.request().postDataJSON();
    expect(input.confirmed).toBe(true);
    if (state.failYear || years[input.sourceYear + 1]?.length)
      return route.fulfill({
        status: 409,
        json: {
          title:
            "Next year already has budget lines. Nothing was copied or overwritten.",
        },
      });
    const targetYear = input.sourceYear + 1;
    years[targetYear] = years[input.sourceYear].map((line) => ({
      ...line,
      id: `${targetYear}-${line.id}`,
      months: line.months.map((month) => ({ ...month, checked_at: null })),
    }));
    return route.fulfill({
      status: 201,
      json: { targetYear, copiedCount: years[targetYear].length },
    });
  });
  return state;
}

test("Copy January waits for the input save, updates Feb-Dec, preserves flags and supports zero", async ({
  page,
}) => {
  const state = await fixture(page);
  let release!: () => void;
  state.waitMonth = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto(`/accounts/${checkingId}/budget`);
  await page
    .getByRole("textbox", { name: "Car payment month 1 amount", exact: true })
    .fill("475.00");
  const copy = page.getByRole("button", {
    name: "Copy January for Car payment",
    exact: true,
  });
  await copy.click();
  await expect(copy).toBeDisabled();
  expect(state.januaryCopies).toBe(0);
  release();
  await expect.poll(() => state.januaryCopies).toBe(1);
  await expect(copy).toBeEnabled();
  for (let month = 1; month <= 12; month++)
    await expect(
      page.getByRole("textbox", {
        name: `Car payment month ${month} amount`,
        exact: true,
      }),
    ).toHaveValue("$475.00");
  await expect(
    page.getByRole("checkbox", {
      name: "Mark Car payment month 2 entered",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", {
      name: "Mark Car payment month 3 entered",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("textbox", { name: "Salary month 2 amount", exact: true }),
  ).toHaveValue("$10.00");
  await page.reload();
  await expect(
    page.getByRole("textbox", {
      name: "Car payment month 12 amount",
      exact: true,
    }),
  ).toHaveValue("$475.00");
  await page
    .getByRole("textbox", { name: "Salary month 1 amount", exact: true })
    .fill("0.00");
  await page
    .getByRole("button", { name: "Copy January for Salary", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Salary month 12 amount", exact: true }),
  ).toHaveValue("$0.00");
});

test("year copy confirms all lines and monthly values, resets flags and opens the next year", async ({
  page,
}) => {
  const state = await fixture(page);
  const before = structuredClone(state.years["2026"]);
  await page.goto(`/accounts/${checkingId}/budget`);
  await page.getByRole("button", { name: "Copy to 2027", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.yearCopies).toBe(0);
  await page.getByRole("button", { name: "Copy to 2027", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Entered checkmarks will be reset",
  );
  await page
    .getByRole("button", { name: "Confirm copy to 2027", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Year", exact: true }),
  ).toHaveValue("2027");
  await expect(
    page.getByText(
      "Copied 2 lines to 2027. Entered checkmarks have been reset.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", {
      name: "Car payment month 1 amount",
      exact: true,
    }),
  ).toHaveValue("$450.00");
  await expect(
    page.getByRole("textbox", {
      name: "Car payment month 12 amount",
      exact: true,
    }),
  ).toHaveValue("$110.00");
  await expect(
    page.getByRole("checkbox", {
      name: "Mark Car payment month 1 entered",
      exact: true,
    }),
  ).not.toBeChecked();
  expect(state.years["2026"]).toEqual(before);
  expect(
    state.years["2027"].map((line) => line.months.map((m) => m.amount_cents)),
  ).toEqual(before.map((line) => line.months.map((m) => m.amount_cents)));
  await page.reload();
  await page.getByRole("textbox", { name: "Year", exact: true }).click();
  await page.getByRole("option", { name: "2027", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Salary month 1 amount", exact: true }),
  ).toHaveValue("$3000.00");
  await expect(
    page.getByRole("checkbox", {
      name: "Mark Salary month 1 entered",
      exact: true,
    }),
  ).not.toBeChecked();
});

test("occupied destination and failed amount saves never result in a copy", async ({
  page,
}) => {
  const state = await fixture(page);
  state.failYear = true;
  await page.goto(`/accounts/${checkingId}/budget`);
  await page.getByRole("button", { name: "Copy to 2027", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm copy to 2027", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Nothing was copied or overwritten",
  );
  expect(state.years["2027"]).toBeUndefined();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  state.failMonth = true;
  await page
    .getByRole("textbox", { name: "Car payment month 1 amount", exact: true })
    .fill("500.00");
  await page
    .getByRole("button", { name: "Copy January for Car payment", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Reload the saved budget",
  );
  expect(state.januaryCopies).toBe(0);
  state.failMonth = false;
  await page.getByRole("button", { name: "Reload saved budget" }).click();
  await expect(
    page.getByRole("textbox", {
      name: "Car payment month 1 amount",
      exact: true,
    }),
  ).toHaveValue("$450.00");
});

test("copy actions require a writable specific account and source lines", async ({
  page,
  finance,
}) => {
  const state = await fixture(page);
  finance.accounts[0].permission = "viewer";
  for (const id of [checkingId, savingsId, "all"]) {
    await page.goto(`/accounts/${id}/budget`);
    await expect(
      page.getByRole("button", { name: "Copy to 2027", exact: true }),
    ).toBeDisabled();
    for (const copy of await page
      .getByRole("button", {
        name: "Copy January for Car payment",
        exact: true,
      })
      .all())
      await expect(copy).toBeDisabled();
  }
  finance.accounts[0].permission = "owner";
  state.years["2026"] = [];
  await page.goto(`/accounts/${checkingId}/budget`);
  await expect(
    page.getByRole("button", { name: "Copy to 2027", exact: true }),
  ).toBeDisabled();
});
