import { test, expect, checkingId } from './fixtures';

test('checking all budget items preserves plans and editing checked amounts updates them', async ({ page }) => {
  const categoryId = '44444444-4444-4444-8444-444444444444';
  const lines = [
    { id: 'expense-a', name: 'Expense A', type: 'expense', cents: 10000 },
    { id: 'expense-b', name: 'Expense B', type: 'expense', cents: 5000 },
    { id: 'income', name: 'Income A', type: 'income', cents: 30000 },
  ].map(line => ({ id: line.id, name: line.name, line_type: line.type, category_id: categoryId, category_name: 'Xfer Accounts',
    months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, amount_cents: i === 0 ? line.cents : 0, checked_at: null as string | null })),
  }));
  const actuals = [
    { category_id: categoryId, line_type: 'expense', month: 1, amount_cents: 4000 },
    { category_id: categoryId, line_type: 'income', month: 1, amount_cents: 25000 },
  ];
  await page.route('**/accounts/*/budget?*', route => route.fulfill({ json: { lines, actuals } }));
  await page.route('**/budget-lines/*/months', route => {
    const id = route.request().url().split('/').at(-2);
    const input = route.request().postDataJSON();
    const month = lines.find(line => line.id === id)!.months[input.month - 1];
    month.amount_cents = input.amountCents;
    month.checked_at = input.checked ? '2026-01-01' : null;
    return route.fulfill({ status: 204 });
  });
  await page.goto(`/accounts/${checkingId}/budget`);
  const grid = page.getByRole('region', { name: 'Editable budget grid' });
  const totals = grid.getByRole('row').filter({ has: page.getByRole('cell', { name: 'TOTAL', exact: true }) });
  const expense = page.getByRole('table', { name: 'expense planned versus actual' }).locator('tbody tr').first();
  const income = page.getByRole('table', { name: 'income planned versus actual' }).locator('tbody tr').first();
  async function assertTotals(planned = '$150.00', variance = '-$110.00') {
    await expect(totals.nth(0).locator('td').nth(1)).toHaveText(planned);
    await expect(totals.nth(0).locator('td').nth(13)).toHaveText(planned);
    await expect(totals.nth(1).locator('td').nth(1)).toHaveText('$300.00');
    await expect(expense.locator('td').nth(1)).toHaveText(planned);
    await expect(expense.locator('td').nth(2)).toHaveText('$40.00');
    await expect(expense.locator('td').nth(3)).toHaveText(variance);
    await expect(expense.locator('td').nth(37)).toHaveText(planned);
    await expect(expense.locator('td').nth(39)).toHaveText(variance);
    await expect(income.locator('td').nth(1)).toHaveText('$300.00');
    await expect(income.locator('td').nth(2)).toHaveText('$250.00');
    await expect(income.locator('td').nth(3)).toHaveText('-$50.00');
  }
  async function assertCharts(planned: string) {
    const bar = page.getByRole('region', { name: 'Monthly budget comparison' });
    await bar.scrollIntoViewIfNeeded();
    // Hover January's plot band rather than an animated bar, which can have
    // zero height or be covered by a grid line at narrow viewport sizes.
    const plot = bar.locator('.recharts-cartesian-grid');
    await expect(plot).toBeVisible();
    const bounds = (await plot.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 24, bounds.y + bounds.height / 2);
    for (const amount of [planned, '$40.00', '$300.00', '$250.00']) await expect(bar.locator('.recharts-tooltip-wrapper')).toContainText(amount);
    const trend = page.getByRole('region', { name: 'Monthly budget trends' });
    await trend.scrollIntoViewIfNeeded();
    await trend.locator('.recharts-dot[name="Actual income"]').nth(1).hover();
    for (const amount of [planned, '$40.00', '$300.00', '$250.00']) await expect(trend.locator('.recharts-tooltip-wrapper')).toContainText(amount);
  }
  await assertTotals();
  for (const name of ['Expense A', 'Expense B', 'Income A']) {
    await grid.getByRole('checkbox', { name: `Mark ${name} month 1 entered`, exact: true }).check();
    await assertTotals();
  }
  await assertCharts('$150.00');
  await page.reload();
  for (const name of ['Expense A', 'Expense B', 'Income A']) await expect(grid.getByRole('checkbox', { name: `Mark ${name} month 1 entered`, exact: true })).toBeChecked();
  await assertTotals();
  const checkedRow = grid.getByRole('row').filter({ has: page.getByRole('checkbox', { name: 'Mark Expense A month 1 entered', exact: true }) });
  const amount = checkedRow.locator('td').nth(1).locator('input').first();
  await amount.fill('125.00');
  await amount.press('Tab');
  await expect(checkedRow.locator('td').nth(13)).toHaveText('$125.00');
  await assertTotals('$175.00', '-$135.00');
  await assertCharts('$175.00');
  await grid.getByRole('checkbox', { name: 'Mark Expense A month 1 entered', exact: true }).uncheck();
  await assertTotals('$175.00', '-$135.00');
  await page.reload();
  await assertTotals('$175.00', '-$135.00');
  await expect(grid.getByRole('checkbox', { name: 'Mark Expense A month 1 entered', exact: true })).not.toBeChecked();
});
