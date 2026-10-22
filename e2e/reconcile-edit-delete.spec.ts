import { test, expect, checkingId, savingsId } from './fixtures';
import type { Page } from '@playwright/test';

async function setup(page: Page) {
  const row = (id: string, amount: number) => ({
    id, account_id: checkingId, occurred_on: '2026-01-05', amount_cents: amount,
    description: id, category_id: '44444444-4444-4444-8444-444444444444', category_name: 'Xfer Accounts',
    identifier: 'ref', notes: 'original notes', status: 'posted', reconciled_at: null as string | null,
    transfer_id: null as string | null, version: 3,
  });
  const state = { rows: [row('First', -1250), row('Second', 500)], patchError: 0, deleteError: 0, failLoad: false, patches: [] as any[], deletes: 0, accountReads: 0, deleteDelay: 0 };
  page.on('request', request => { if (request.url().endsWith('/api/v1/accounts') && request.method() === 'GET') state.accountReads++; });
  await page.route('**/accounts/*/reconciliation', route => {
    if (state.failLoad) return route.fulfill({ status: 503, json: { title: 'Refresh unavailable' } });
    return route.fulfill({ json: { transactions: route.request().url().includes(checkingId) ? state.rows : [] } });
  });
  await page.route('**/transactions/*', async route => {
    const id = route.request().url().split('/').at(-1);
    const row = state.rows.find(r => r.id === id)!;
    if (route.request().method() === 'PATCH') {
      if (state.patchError) return route.fulfill({ status: state.patchError, json: { title: 'This transaction has changed; refresh and try again' } });
      const input = route.request().postDataJSON();
      state.patches.push(input);
      Object.assign(row, { description: input.description, amount_cents: input.amountCents, occurred_on: input.occurredOn, identifier: input.identifier, notes: input.notes, version: row.version + 1 });
      return route.fulfill({ json: { transaction: row } });
    }
    if (route.request().method() === 'DELETE') {
      state.deletes++;
      if (state.deleteDelay) await new Promise(resolve => setTimeout(resolve, state.deleteDelay));
      expect(route.request().postData()).toBeNull();
      expect(route.request().headers()['content-type']).toBeUndefined();
      if (state.deleteError) return route.fulfill({ status: state.deleteError, json: { title: 'This transaction cannot be deleted' } });
      state.rows = state.rows.filter(r => r.id !== id);
      return route.fulfill({ status: 204 });
    }
    return route.fallback();
  });
  return state;
}

test('reconciliation edit reuses history validation and deselects changed row only', async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/accounts/${checkingId}/reconcile`);
  await page.getByRole('button', { name: 'Select all visible' }).click();
  await page.getByRole('button', { name: 'Edit First', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Amount', { exact: true })).toHaveValue('$12.50');
  await expect(dialog.getByRole('button', { name: 'Credit', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Notes (optional)', { exact: true })).toHaveValue('original notes');
  await dialog.getByLabel('Amount', { exact: true }).fill('0');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.getByText('Enter an amount greater than zero')).toBeVisible();
  expect(state.patches).toHaveLength(0);
  await dialog.getByLabel('Amount', { exact: true }).fill('20.00');
  await dialog.getByLabel('Description', { exact: true }).fill('Updated');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.patches[0]).toMatchObject({ version: 3, amountCents: -2000, description: 'Updated' });
  await expect(page.getByRole('checkbox', { name: 'Select Updated', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select Second', exact: true })).toBeChecked();
  await expect(page.getByText('Preview after selection: $105.00')).toBeVisible();
  expect(state.rows[0].reconciled_at).toBeNull();
  await expect.poll(() => state.accountReads).toBeGreaterThan(1);
  await page.reload();
  await expect(page.getByRole('cell', { name: 'Updated', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reconciliation delete requires confirmation and removes only its selection', async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/accounts/${checkingId}/reconcile`);
  await page.getByRole('button', { name: 'Select all visible' }).click();
  await page.getByRole('button', { name: 'Delete First', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  expect(state.deletes).toBe(0);
  await expect(page.getByRole('checkbox', { name: 'Select First', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Delete First', exact: true }).click();
  state.deleteDelay = 500;
  await page.getByRole('dialog').getByRole('button', { name: 'Delete transaction', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Delete transaction', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Select First', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Select Second', exact: true })).toBeChecked();
  await expect(page.getByText('Preview after selection: $105.00')).toBeVisible();
  expect(state.deletes).toBe(1);
  await expect.poll(() => state.accountReads).toBeGreaterThan(1);
  await page.reload();
  await expect(page.getByRole('cell', { name: 'First', exact: true })).toHaveCount(0);
});

test('edit conflicts and delete rejection preserve rows and selections', async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/accounts/${checkingId}/reconcile`);
  await page.getByRole('checkbox', { name: 'Select First', exact: true }).check();
  await page.getByRole('button', { name: 'Edit First', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Description', { exact: true }).fill('Cancelled edit');
  await page.keyboard.press('Escape');
  expect(state.patches).toHaveLength(0);
  await expect(page.getByRole('checkbox', { name: 'Select First', exact: true })).toBeChecked();
  state.patchError = 409;
  await page.getByRole('button', { name: 'Edit First', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Description', { exact: true }).fill('Not saved');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog').getByText('This transaction has changed; refresh and try again')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('checkbox', { name: 'Select First', exact: true })).toBeChecked();
  state.deleteError = 403;
  await page.getByRole('button', { name: 'Delete First', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete transaction', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('This transaction cannot be deleted');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('checkbox', { name: 'Select First', exact: true })).toBeChecked();
  expect(state.rows).toHaveLength(2);
});

test('reconciliation actions match history permission and lock rules', async ({ page, finance }) => {
  const state = await setup(page);
  state.rows[0].transfer_id = 'transfer';
  state.rows[1].reconciled_at = '2026-01-06';
  await page.goto(`/accounts/${checkingId}/reconcile`);
  for (const action of ['Edit First', 'Delete First', 'Edit Second', 'Delete Second']) await expect(page.getByRole('button', { name: action, exact: true })).toHaveCount(0);
  state.rows[0].transfer_id = null;
  state.rows[1].reconciled_at = null;
  finance.accounts[0].permission = 'viewer';
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit First', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete First', exact: true })).toHaveCount(0);
  finance.accounts[0].permission = 'editor'; finance.accounts[0].is_active = false;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit First', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete First', exact: true })).toHaveCount(0);
  finance.accounts[0].is_active = true;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit First', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Account', exact: true }).click();
  await page.getByRole('option', { name: 'Savings', exact: true }).click();
  await expect(page).toHaveURL(`/accounts/${savingsId}/reconcile`);
  await expect(page.getByRole('button', { name: 'Edit First', exact: true })).toHaveCount(0);
});

test('failed post-delete refresh blocks stale reconciliation and supports retry', async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/accounts/${checkingId}/reconcile`);
  await page.getByRole('button', { name: 'Select all visible' }).click();
  await page.getByRole('button', { name: 'Delete First', exact: true }).click();
  state.failLoad = true;
  await page.getByRole('dialog').getByRole('button', { name: 'Delete transaction', exact: true }).click();
  await expect(page.getByText('Refresh unavailable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save and reconcile' })).toBeDisabled();
  state.failLoad = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Select Second', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select First', exact: true })).toHaveCount(0);
});
