import { test, expect, checkingId } from './fixtures';
import type { Page } from '@playwright/test';

async function fillRow(page: Page, index: number, description: string) {
  await page.getByLabel('Transaction amount', { exact: true }).nth(index).fill('12.34');
  await page.getByLabel('Transaction description', { exact: true }).nth(index).fill(description);
  await page.getByLabel('Transaction category', { exact: true }).nth(index).click();
  await page.getByRole('option', { name: 'Xfer Accounts', exact: true }).click();
}

test('invalid later row sends nothing; correction saves one atomic batch', async ({ page }) => {
  const calls: any[] = [];
  let singleCalls = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/transactions')) singleCalls++; });
  await page.route('**/transactions/bulk', async route => {
    calls.push(route.request().postDataJSON());
    await new Promise(resolve => setTimeout(resolve, 300));
    return route.fulfill({ status: 201, json: { createdCount: 2 } });
  });
  await page.goto(`/accounts/${checkingId}/bulk`);
  await fillRow(page, 0, 'First');
  await page.getByRole('button', { name: 'Add row', exact: true }).click();
  await fillRow(page, 1, '');
  await page.getByRole('button', { name: 'Save all transactions' }).click();
  await expect(page.getByText('Row 2: Enter a description of 1–500 characters')).toBeVisible();
  expect(calls).toHaveLength(0); expect(singleCalls).toBe(0);
  await expect(page.getByLabel('Transaction description', { exact: true }).nth(0)).toHaveValue('First');
  await page.getByLabel('Transaction description', { exact: true }).nth(1).fill('Second');
  await page.getByRole('button', { name: 'Credit', exact: true }).nth(1).click();
  await page.getByRole('button', { name: 'Save all transactions' }).click();
  await expect(page.getByLabel('Transaction description', { exact: true }).first()).toBeDisabled();
  await expect(page.getByLabel('Transaction description', { exact: true })).toHaveCount(1);
  expect(calls).toHaveLength(1); expect(singleCalls).toBe(0);
  expect(calls[0].transactions.map((row: any) => row.amountCents)).toEqual([-1234, 1234]);
  await expect(page.getByLabel('Transaction description', { exact: true })).toHaveValue('');
});

test('server rejection preserves draft and unchanged retry reuses the batch ID', async ({ page }) => {
  const calls: any[] = [];
  await page.route('**/transactions/bulk', route => {
    calls.push(route.request().postDataJSON());
    return calls.length === 1
      ? route.fulfill({ status: 422, json: { title: 'Row 1: choose an active category you own' } })
      : route.fulfill({ status: 201, json: { createdCount: 1 } });
  });
  await page.goto(`/accounts/${checkingId}/bulk`);
  await fillRow(page, 0, 'Preserve me');
  await page.getByRole('button', { name: 'Save all transactions' }).click();
  await expect(page.getByText('Row 1: choose an active category you own')).toBeVisible();
  await expect(page.getByLabel('Transaction description', { exact: true })).toHaveValue('Preserve me');
  await page.getByRole('button', { name: 'Save all transactions' }).click();
  await expect(page.getByLabel('Transaction description', { exact: true })).toHaveValue('');
  expect(calls[0]).toEqual(calls[1]);
});

test('lost response retries same receipt and successful save clears before refresh failure', async ({ page, finance }) => {
  const calls: any[] = [];
  await page.route('**/transactions/bulk', route => {
    calls.push(route.request().postDataJSON());
    if (calls.length === 1) return route.abort('failed');
    finance.failAccounts = true;
    return route.fulfill({ status: 201, json: { createdCount: 1 } });
  });
  await page.goto(`/accounts/${checkingId}/bulk`);
  await fillRow(page, 0, 'Retry safely');
  await page.getByRole('button', { name: 'Save all transactions' }).click();
  await expect(page.getByRole('button', { name: 'Save all transactions' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save all transactions' }).click();
  await expect(page.getByText('Accounts temporarily unavailable')).toBeVisible();
  finance.failAccounts = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByLabel('Transaction description', { exact: true })).toHaveValue('');
  expect(calls).toHaveLength(2); expect(calls[0]).toEqual(calls[1]);
  await page.getByRole('button', { name: 'Save all transactions' }).click();
  await expect(page.getByText('Row 1: Choose a category')).toBeVisible();
  expect(calls).toHaveLength(2);
});
