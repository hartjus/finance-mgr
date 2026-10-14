export type User = { id: string; email: string; role: 'admin' | 'user' };
export type MoneyValue = number | string;
export type Account = { id: string; name: string; account_number_last_four: string; starting_balance_cents: MoneyValue; current_balance_cents: MoneyValue; reconciled_balance_cents: MoneyValue; unreconciled_debits_cents: MoneyValue; unreconciled_credits_cents: MoneyValue; is_active: boolean; permission: 'owner' | 'editor' | 'viewer' };
export type Category = { id: string; name: string; is_archived: boolean; is_system: boolean };
export type Transaction = { id: string; occurred_on: string; amount_cents: MoneyValue; description: string; category_id: string; category_name: string; identifier: string | null; notes: string | null; status: 'pending' | 'posted'; reconciled_at: string | null; transfer_id: string | null; version: number; running_balance_cents: MoneyValue };
export type AnalysisRow = { transaction_type: 'debit' | 'credit'; category_id: string; category_name: string; month: number; amount_cents: MoneyValue };

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api/v1${path}`, { ...options, credentials: 'include', headers });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) throw new Error(data.title ?? 'Request failed');
  return data as T;
}
export const money = (cents: MoneyValue) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents) / 100);
export const dateOnly = (value: string) => {
  const datePart = value.split(/[T ]/)[0];
  const [year, month, day] = datePart.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return datePart;
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(year, month - 1, day));
};
