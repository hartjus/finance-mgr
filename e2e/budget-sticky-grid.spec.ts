import { test, expect, checkingId } from './fixtures';

for (const theme of ['light', 'dark']) {
  test(`budget labels stick on independent scroll axes and inputs remain editable (${theme})`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('finance-theme', value), theme);
    const lines = Array.from({ length: 30 }, (_, index) => ({
      id: `line-${index}`, name: `Budget line ${index}`, line_type: 'expense',
      category_id: 'category', category_name: 'Synthetic category',
      months: Array.from({ length: 12 }, (_, month) => ({ month: month + 1, amount_cents: '10000', checked_at: null })),
    }));
    await page.route('**/accounts/*/budget?*', route => route.fulfill({ json: { lines, actuals: [] } }));
    const writes: unknown[] = [];
    await page.route('**/budget-lines/*/months', route => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ status: 204 });
    });
    await page.goto(`/accounts/${checkingId}/budget`);
    const grid = page.getByRole('region', { name: 'Editable budget grid' });
    await expect(grid.locator('tbody tr')).toHaveCount(34);
    await grid.scrollIntoViewIfNeeded();
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', theme);
    const corner = grid.getByRole('columnheader', { name: 'Line', exact: true });
    const month = grid.getByRole('columnheader', { name: 'Jun', exact: true });
    const first = grid.locator('tbody tr').nth(1).locator('td').first();
    const before = { corner: (await corner.boundingBox())!, month: (await month.boundingBox())!, first: (await first.boundingBox())! };
    await grid.evaluate(el => { el.scrollLeft = 300; });
    await expect.poll(async () => Math.abs((await first.boundingBox())!.x - before.first.x)).toBeLessThan(2);
    expect(Math.abs((await corner.boundingBox())!.x - before.corner.x)).toBeLessThan(2);
    expect((await month.boundingBox())!.x).toBeLessThan(before.month.x - 250);
    expect(Math.abs((await month.boundingBox())!.y - before.month.y)).toBeLessThan(2);
    await grid.evaluate(el => { el.scrollTop = 300; });
    await expect.poll(async () => Math.abs((await month.boundingBox())!.y - before.month.y)).toBeLessThan(2);
    expect((await first.boundingBox())!.y).toBeLessThan(before.first.y - 250);
    expect(Math.abs((await corner.boundingBox())!.y - before.corner.y)).toBeLessThan(2);
    const row = grid.locator('tbody tr').nth(9);
    const cell = row.locator('td').nth(6);
    await cell.evaluate(el => {
      const scroller = el.closest('.budget-grid-scroll')!;
      const firstCell = el.parentElement!.firstElementChild!;
      const header = scroller.querySelector('thead')!;
      const bounds = scroller.getBoundingClientRect();
      scroller.scrollLeft += el.getBoundingClientRect().left - bounds.left - firstCell.getBoundingClientRect().width - 8;
      scroller.scrollTop += el.getBoundingClientRect().top - bounds.top - header.getBoundingClientRect().height - 8;
    });
    const input = cell.locator('input').first();
    await input.fill('123.45');
    await input.press('Tab');
    await expect.poll(() => writes.length).toBeGreaterThan(0);
    expect(writes.at(-1)).toMatchObject({ month: 6, amountCents: 12345 });
    const label = row.locator('td').first();
    expect(await label.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    expect(await corner.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
