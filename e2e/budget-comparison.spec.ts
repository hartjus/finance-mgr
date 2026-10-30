import { test, expect, checkingId, savingsId } from './fixtures';
import type { Page } from '@playwright/test';

async function setup(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00'));
  const categories = ['Food', 'Housing', 'Salary', 'Unplanned'].map(name => ({ id: name, name, is_system: false, is_archived: false }));
  const lines = [
    { category_id: 'Food', line_type: 'expense', amount: 10000 },
    { category_id: 'Housing', line_type: 'expense', amount: 20000 },
    { category_id: 'Salary', line_type: 'income', amount: 50000 },
  ].map(line => ({ ...line, id: line.category_id, name: line.category_id, category_name: line.category_id, months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, amount_cents: line.amount, checked_at: null })) }));
  const actuals = [
    { category_id: 'Food', line_type: 'expense', month: 10, amount_cents: 12000 },
    { category_id: 'Housing', line_type: 'expense', month: 10, amount_cents: 15000 },
    { category_id: 'Unplanned', line_type: 'expense', month: 10, amount_cents: 1000 },
    { category_id: 'Salary', line_type: 'income', month: 10, amount_cents: 45000 },
    { category_id: 'Salary', line_type: 'income', month: 11, amount_cents: 55000 },
  ];
  const state = { fail: false, empty: false, hold: Promise.resolve() };
  await page.route('**/categories', route => route.fulfill({ json: { categories } }));
  await page.route('**/accounts/*/budget?*', async route => {
    await state.hold;
    if (state.fail) return route.fulfill({ status: 503, json: { title: 'Comparison load failed' } });
    const empty = state.empty || new URL(route.request().url()).searchParams.get('year') === '2025';
    return route.fulfill({ json: { lines: empty ? [] : lines, actuals: empty ? [] : actuals } });
  });
  return state;
}
async function open(page: Page, account = checkingId) {
  await page.goto(`/accounts/${account}/budget-preview`);
  await page.getByRole('tab', { name: 'Planned vs actual', exact: true }).click();
}
async function chooseMonth(page: Page, name: string) {
  await page.getByRole('textbox', { name: 'Budget month', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('comparison explains expense and income differences for monthly and annual periods', async ({ page }, info) => {
  await setup(page);
  await open(page);
  await expect(page.getByRole('region', { name: 'Plan summary' })).toHaveCount(0);
  const summary = page.getByRole('region', { name: 'Comparison summary' });
  await expect(summary).toContainText('$300.00');
  await expect(summary).toContainText('$280.00');
  await expect(summary).toContainText('Remaining');
  const food = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Food', exact: true }) });
  await expect(food).toContainText('$20.00');
  await expect(food).toContainText('Over plan');
  await expect(page.getByRole('row').filter({ hasText: 'Housing' })).toContainText('Remaining');
  await expect(page.getByRole('row').filter({ hasText: 'Unplanned' })).toContainText('No plan');
  await page.screenshot({ path: info.outputPath('comparison.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('label').filter({ hasText: /^Income$/ }).click();
  await expect(summary).toContainText('Below plan');
  await expect(summary).toContainText('$50.00');
  await chooseMonth(page, 'November');
  await expect(summary).toContainText('Above plan');
  await page.locator('label').filter({ hasText: /^Full year$/ }).click();
  await expect(summary).toContainText('$6,000.00');
  await expect(summary).toContainText('$1,000.00');
  await expect(page.getByText('January–December totals.', { exact: false })).toBeVisible();
  await page.goto(`/accounts/${checkingId}/budget`);
  await expect(page.getByRole('heading', { name: 'Planned vs Actual — 2026', exact: true })).toBeVisible();
});

test('one shared period control keeps the plan and comparison on the same period', async ({ page }) => {
  await setup(page);
  await page.goto(`/accounts/${checkingId}/budget-preview`);
  await chooseMonth(page, 'November');
  await expect(page.getByRole('textbox', { name: 'Food month 11 amount', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Planned vs actual', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Budget month', exact: true })).toHaveValue('November');
  await expect(page.getByText('November 2026', { exact: true })).toBeVisible();
  await page.locator('label').filter({ hasText: /^Full year$/ }).click();
  await page.getByRole('tab', { name: 'Budget plan', exact: true }).click();
  await expect(page.getByText('2026 plan', { exact: true })).toBeVisible();
});

test('comparison aggregates all accounts and follows account and year selection', async ({ page }) => {
  await setup(page);
  await open(page, 'all');
  const summary = page.getByRole('region', { name: 'Comparison summary' });
  await expect(summary).toContainText('$600.00');
  await expect(summary).toContainText('$560.00');
  await page.getByRole('textbox', { name: 'Account', exact: true }).click();
  await page.getByRole('option', { name: 'Savings', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/accounts/${savingsId}/budget-preview$`));
  await page.getByRole('tab', { name: 'Planned vs actual', exact: true }).click();
  await expect(summary).toContainText('$300.00');
  await expect(summary).toContainText('$280.00');
  await page.getByRole('textbox', { name: 'Year', exact: true }).click();
  await page.getByRole('option', { name: '2025', exact: true }).click();
  await expect(page.getByText('No expenses to compare', { exact: true })).toBeVisible();
  await expect(summary).toContainText('$0.00');
});

test('comparison withholds totals during loading and errors and recovers empty state', async ({ page }) => {
  const state = await setup(page);
  let release!: () => void;
  state.hold = new Promise<void>(resolve => { release = resolve; });
  await open(page);
  await expect(page.getByText('Loading comparison…', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Comparison summary' })).toHaveCount(0);
  state.fail = true;
  release();
  await expect(page.getByText('Comparison unavailable.', { exact: false })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Comparison summary' })).toHaveCount(0);
  state.fail = false;
  state.empty = true;
  await page.getByRole('button', { name: 'Reload saved budget', exact: true }).click();
  await expect(page.getByText('No expenses to compare', { exact: true })).toBeVisible();
});
