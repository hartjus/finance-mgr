import { test, expect, checkingId } from './fixtures';

test('Bulk Add works without randomUUID and keeps draft rows independent', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Checking' }).click();
  const toggle = page.getByRole('button', { name: 'Toggle navigation' });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole('link', { name: 'Bulk add', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bulk add transactions' })).toBeVisible();
  expect(await page.evaluate(() => typeof globalThis.crypto.randomUUID)).toBe('undefined');
  const descriptions = page.getByLabel('Transaction description', { exact: true });
  await expect(descriptions).toHaveCount(1);
  await descriptions.nth(0).fill('First');
  await page.getByRole('button', { name: 'Add row', exact: true }).click();
  await descriptions.nth(1).fill('Second');
  await page.getByRole('button', { name: 'Add row', exact: true }).click();
  await descriptions.nth(2).fill('Third');
  await page.getByRole('button', { name: 'Remove transaction row' }).nth(1).click();
  await expect(descriptions).toHaveCount(2);
  await expect(descriptions.nth(0)).toHaveValue('First');
  await expect(descriptions.nth(1)).toHaveValue('Third');
  await page.getByRole('button', { name: 'Add row', exact: true }).click();
  await descriptions.nth(2).fill('Fourth');
  await descriptions.nth(0).fill('First edited');
  await expect(descriptions.nth(1)).toHaveValue('Third');
  await expect(descriptions.nth(2)).toHaveValue('Fourth');
  // Clear dirty values before reload so this test does not exercise beforeunload.
  for (const input of await descriptions.all()) await input.fill('');
  await page.reload();
  await expect(page).toHaveURL(`/accounts/${checkingId}/bulk`);
  await expect(descriptions).toHaveCount(1);
  await expect(descriptions).toHaveValue('');
  expect(errors).toEqual([]);
});
