import { test, expect, checkingId, savingsId } from './fixtures';
import type { Page } from '@playwright/test';

const url = `/accounts/${checkingId}/budget-preview`;
async function setup(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-22T12:00:00'));
  const category = { id: '44444444-4444-4444-8444-444444444444', name: 'General', is_archived: false, is_system: false };
  const state = {
    fail: false, copies: 0, yearCopies: 0,
    lines: [{ id: 'expense', name: 'Groceries', line_type: 'expense', cents: 80000 }, { id: 'income', name: 'Salary', line_type: 'income', cents: 620000 }].map(line => ({
      ...line, category_id: category.id, category_name: category.name,
      months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, amount_cents: line.cents, checked_at: null as string | null })),
    })),
  };
  await page.route('**/categories', route => route.fulfill({ json: { categories: [category] } }));
  await page.route('**/accounts/*/budget?*', route => route.fulfill({ json: { lines: state.lines, actuals: [] } }));
  await page.route('**/budget-lines/*/months', route => {
    if (state.fail) return route.fulfill({ status: 503, json: { title: 'Save unavailable' } });
    const input = route.request().postDataJSON();
    const line = state.lines.find(line => route.request().url().includes(`/${line.id}/`))!;
    Object.assign(line.months[input.month - 1], { amount_cents: input.amountCents, checked_at: input.checked ? '2026-10-22' : null });
    return route.fulfill({ status: 204 });
  });
  await page.route('**/accounts/*/budget/lines', route => {
    const input = route.request().postDataJSON();
    state.lines.push({ ...state.lines[0], id: 'new', name: input.name, line_type: input.lineType, months: state.lines[0].months.map(m => ({ ...m, amount_cents: 0 })) });
    return route.fulfill({ status: 201, json: {} });
  });
  await page.route('**/budget-lines/expense/copy-january', route => {
    state.copies++;
    expect(route.request().postData()).toBeNull();
    state.lines[0].months.forEach(m => m.amount_cents = state.lines[0].months[0].amount_cents);
    return route.fulfill({ status: 204 });
  });
  await page.route('**/budget-lines/expense/replicate', route => {
    expect(route.request().postDataJSON()).toEqual({ fromMonth: 10, amountCents: 80000 });
    state.copies++;
    return route.fulfill({ status: 204 });
  });
  await page.route('**/budget-lines/expense', route => {
    expect(route.request().method()).toBe('DELETE');
    state.lines = state.lines.filter(line => line.id !== 'expense');
    return route.fulfill({ status: 204 });
  });
  await page.route('**/accounts/*/budget/copy-next-year', route => {
    expect(route.request().postDataJSON()).toEqual({ sourceYear: 2026, confirmed: true });
    state.yearCopies++;
    return route.fulfill({ status: 201, json: { targetYear: 2027, copiedCount: state.lines.length } });
  });
  return state;
}

test('preview edits persist in both independent budget screens', async ({ page }) => {
  await setup(page);
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Budget preview', exact: true })).toBeVisible();
  const amount = page.getByRole('textbox', { name: 'Groceries month 10 amount', exact: true });
  await amount.fill('900');
  await amount.press('Tab');
  const flag = page.getByRole('checkbox', { name: 'Mark Groceries month 10 entered', exact: true });
  await flag.check();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(amount).toHaveValue('$900.00');
  await expect(flag).toBeChecked();
  await page.goto(`/accounts/${checkingId}/budget`);
  await expect(page.getByRole('heading', { name: 'Budget', exact: true })).toBeVisible();
  await expect(amount).toHaveValue('$900.00');
  await expect(flag).toBeChecked();
  await expect(page.getByRole('region', { name: 'Editable budget grid' })).toBeVisible();
});

test('monthly summary, annual editor and report tabs stay focused and contained', async ({ page }, testInfo) => {
  const state = await setup(page);
  state.lines[0].months[10].amount_cents = 100000;
  await page.goto(url);
  const summary = page.getByRole('region', { name: 'Plan summary' });
  await expect(summary).toContainText('$5,400.00');
  await expect(page.getByRole('region', { name: 'Monthly budget comparison', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect(summary).toContainText('$5,200.00');
  await expect(page.getByRole('textbox', { name: 'Groceries month 11 amount', exact: true })).toHaveValue('$1000.00');
  await page.locator('label').filter({ hasText: /^Full year$/ }).click();
  await expect(page.getByRole('textbox', { name: 'Groceries month 1 amount', exact: true })).toBeAttached();
  await expect(page.getByRole('textbox', { name: 'Groceries month 12 amount', exact: true })).toBeAttached();
  await page.getByRole('tab', { name: 'Planned vs actual', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Planned vs actual', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Trends', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Monthly budget comparison', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Monthly budget trends', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Budget plan', exact: true }).click();
  await page.locator('label').filter({ hasText: /^Month$/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const editor = page.getByRole('region', { name: 'Monthly budget editor' });
  await expect(editor).toBeVisible();
  expect(await editor.evaluate(el => el.clientWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('budget-preview.png'), fullPage: true });
});

test('preview adds validated lines and retains copy and delete actions', async ({ page }) => {
  const state = await setup(page);
  await page.goto(url);
  await page.getByRole('button', { name: 'Add budget line', exact: true }).click();
  await page.getByRole('button', { name: 'Add line', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a name and choose a category');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Utilities');
  await page.getByRole('textbox', { name: 'Category', exact: true }).click();
  await page.getByRole('option', { name: 'General', exact: true }).click();
  await page.getByRole('button', { name: 'Add line', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Utilities month 10 amount', exact: true })).toBeVisible();
  for (const name of ['Copy January to Feb–Dec', 'Copy from current month (Oct)']) {
    await page.getByRole('button', { name: 'Actions for Groceries', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  }
  expect(state.copies).toBe(2);
  await page.getByRole('button', { name: 'Copy to 2027', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm copy to 2027', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Year', exact: true })).toHaveValue('2027');
  expect(state.yearCopies).toBe(1);
  await page.getByRole('button', { name: 'Actions for Groceries', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete line', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Delete budget line', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Groceries month 10 amount', exact: true })).toHaveCount(0);
});

test('preview disables writes for viewer, inactive and all-account scopes', async ({ page, finance }) => {
  await setup(page);
  finance.accounts[0].permission = 'viewer';
  for (const id of [checkingId, savingsId, 'all']) {
    await page.goto(`/accounts/${id}/budget-preview`);
    await expect(page.getByRole('button', { name: 'Add budget line', exact: true })).toBeDisabled();
    for (const amount of await page.getByRole('textbox', { name: 'Groceries month 10 amount', exact: true }).all()) await expect(amount).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Copy to 2027', exact: true })).toBeDisabled();
  }
});

test('preview recovers failed saves and explains empty budgets', async ({ page }) => {
  const state = await setup(page);
  await page.goto(url);
  state.fail = true;
  const amount = page.getByRole('textbox', { name: 'Groceries month 10 amount', exact: true });
  await amount.fill('900');
  await amount.press('Tab');
  await expect(page.getByRole('alert')).toContainText('Reload the saved budget');
  await expect(page.getByText('All changes saved', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Actions for Groceries', exact: true })).toBeDisabled();
  state.fail = false;
  await page.getByRole('button', { name: 'Reload saved budget', exact: true }).click();
  await expect(amount).toHaveValue('$800.00');
  state.lines = [];
  await page.reload();
  await expect(page.getByText('No budget lines yet.', { exact: false })).toBeVisible();
});
