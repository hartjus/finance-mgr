import { ActionIcon, Group, SegmentedControl, Select, Text } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

type Props = { year: number; month: number; view: string; onMonth: (month: number) => void; onView: (view: string) => void };

export function BudgetPeriodControl({ year, month, view, onMonth, onView }: Props) {
  const months = Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: new Date(year, index).toLocaleString('en-US', { month: 'long' }) }));
  return <Group className="budget-period-control" justify="space-between" align="end">
    <div><Text size="sm" fw={600} mb={4}>Viewing</Text><Group gap="xs">
      {view === 'month' && <ActionIcon variant="default" aria-label="Previous month" disabled={month === 1} onClick={() => onMonth(month - 1)}><IconChevronLeft size={18} /></ActionIcon>}
      {view === 'month' && <Select aria-label="Budget month" value={String(month)} data={months} onChange={value => value && onMonth(Number(value))} w={160} allowDeselect={false} />}
      {view === 'month' && <ActionIcon variant="default" aria-label="Next month" disabled={month === 12} onClick={() => onMonth(month + 1)}><IconChevronRight size={18} /></ActionIcon>}
      {view === 'year' && <Text fw={600} py={8}>Full year {year}</Text>}
    </Group></div>
    <SegmentedControl aria-label="Budget period" value={view} onChange={onView} data={[{ label: 'Month', value: 'month' }, { label: 'Full year', value: 'year' }]} />
  </Group>;
}
