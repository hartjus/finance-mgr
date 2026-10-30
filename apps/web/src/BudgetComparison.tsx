import { useState } from 'react';
import { Card, Group, SegmentedControl, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { money } from './api';

type Kind = 'income' | 'expense';
type Props = {
  year: number;
  month: number;
  view: string;
  loading: boolean;
  error: boolean;
  categories: { id: string; name: string }[];
  lines: { category_id: string; category_name: string; line_type: Kind; months: { month: number; amount_cents: number | string }[] }[];
  actuals: { category_id: string; line_type: Kind; month: number; amount_cents: number | string }[];
};

function difference(planned: number, actual: number, kind: Kind) {
  const delta = actual - planned;
  if (!planned && actual) return { amount: Math.abs(delta), label: 'No plan', color: 'orange' };
  if (!delta) return { amount: 0, label: 'On plan', color: 'dimmed' };
  const favorable = kind === 'expense' ? delta < 0 : delta > 0;
  const label = kind === 'expense'
    ? delta > 0 ? 'Over plan' : 'Remaining'
    : delta > 0 ? 'Above plan' : 'Below plan';
  return { amount: Math.abs(delta), label, color: favorable ? 'teal.8' : 'red.7' };
}

export function BudgetComparison({ year, month, view, loading, error, categories, lines, actuals }: Props) {
  const [kind, setKind] = useState<Kind>('expense');
  const includesMonth = (value: number) => view === 'year' || value === month;
  const rows = new Map<string, { id: string; name: string; planned: number; actual: number }>();
  const rowFor = (id: string, fallback?: string) => {
    if (!rows.has(id)) rows.set(id, { id, name: categories.find(category => category.id === id)?.name ?? fallback ?? 'Archived category', planned: 0, actual: 0 });
    return rows.get(id)!;
  };
  for (const line of lines) {
    if (line.line_type !== kind) continue;
    rowFor(line.category_id, line.category_name).planned += line.months
      .filter(item => includesMonth(item.month))
      .reduce((sum, item) => sum + Number(item.amount_cents), 0);
  }
  for (const actual of actuals) {
    if (actual.line_type === kind && includesMonth(actual.month)) rowFor(actual.category_id).actual += Number(actual.amount_cents);
  }
  const visibleRows = [...rows.values()].filter(row => row.planned !== 0 || row.actual !== 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const planned = visibleRows.reduce((sum, row) => sum + row.planned, 0);
  const actual = visibleRows.reduce((sum, row) => sum + row.actual, 0);
  const totalDifference = difference(planned, actual, kind);
  const period = view === 'year' ? `Full year ${year}` : `${new Date(year, month - 1).toLocaleString('en-US', { month: 'long' })} ${year}`;

  return <Stack gap="lg" className="budget-comparison">
    <div><Title order={2} size="h3">Planned vs actual</Title><Text c="dimmed" size="sm">See where your {kind === 'expense' ? 'spending' : 'income'} differs from your plan.</Text></div>
    <Group justify="space-between">
      <SegmentedControl aria-label="Comparison type" value={kind} onChange={value => setKind(value as Kind)} data={[{ label: 'Expenses', value: 'expense' }, { label: 'Income', value: 'income' }]} />
      <Text size="sm" fw={600}>{period}</Text>
    </Group>
    {loading ? <Text role="status">Loading comparison…</Text> : error ? <Text>Comparison unavailable. Reload the saved budget to try again.</Text> : <>
      <Card withBorder component="section" aria-label="Comparison summary">
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <div><Text c="dimmed" size="sm">Planned {kind === 'expense' ? 'spending' : 'income'}</Text><Text className="budget-comparison-metric">{money(planned)}</Text></div>
          <div><Text c="dimmed" size="sm">Actual {kind === 'expense' ? 'spending' : 'income'}</Text><Text className="budget-comparison-metric">{money(actual)}</Text></div>
          <div><Text c="dimmed" size="sm">{totalDifference.label}</Text><Text className="budget-comparison-metric" c={totalDifference.color}>{money(totalDifference.amount)}</Text></div>
        </SimpleGrid>
      </Card>
      <Text size="sm" c="dimmed">{view === 'year' ? 'January–December totals. ' : ''}{kind === 'expense' ? 'Remaining is planned spending minus actual spending. Over plan means you spent more than planned.' : 'Above or below plan compares actual income with planned income.'}</Text>
      {!visibleRows.length ? <Card withBorder><Text fw={600}>No {kind === 'expense' ? 'expenses' : 'income'} to compare</Text><Text c="dimmed" size="sm">There are no planned amounts or actuals for this period. Choose another month or review your budget plan.</Text></Card> :
        <Card withBorder p={0}>
          <Table className="budget-comparison-table" aria-label={`${kind} comparison for ${period}`}>
            <Table.Thead><Table.Tr><Table.Th>Category</Table.Th><Table.Th ta="right">Planned</Table.Th><Table.Th ta="right">Actual</Table.Th><Table.Th ta="right">Difference</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{visibleRows.map(row => {
              const delta = difference(row.planned, row.actual, kind);
              return <Table.Tr key={row.id}>
                <Table.Th scope="row">{row.name}</Table.Th>
                <Table.Td data-label="Planned">{money(row.planned)}</Table.Td>
                <Table.Td data-label="Actual">{money(row.actual)}</Table.Td>
                <Table.Td data-label="Difference"><Text fw={600} c={delta.color}>{money(delta.amount)}</Text><Text size="xs" c={delta.color}>{delta.label}</Text></Table.Td>
              </Table.Tr>;
            })}</Table.Tbody>
          </Table>
        </Card>}
    </>}
  </Stack>;
}
