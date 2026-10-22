import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Modal,
  NumberInput,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconArrowUpRight,
  IconChartLine,
  IconInfoCircle,
} from "@tabler/icons-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, money, type Account } from "./api";
import {
  calculateForecast,
  type ForecastData,
  type ForecastMethod,
} from "./forecast";

export function ForecastScreen({
  accounts,
  scopeId,
  month,
  navigate,
}: {
  accounts: Account[];
  scopeId: string;
  month: string;
  navigate: (path: string) => void;
}) {
  const [data, setData] = useState<ForecastData[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [type, setType] = useState("expense");
  const [scenario, setScenario] = useState(false);
  const [reduction, setReduction] = useState<number | string>(0);
  const [savingMethod, setSavingMethod] = useState<string | null>(null);
  const [methodError, setMethodError] = useState("");
  const saveInFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const ids = (scopeId === "all" ? accounts.map((a) => a.id) : [scopeId]).join(
    ",",
  );
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    setScenario(false);
    setReduction(0);
    Promise.all(
      ids
        .split(",")
        .map((id) =>
          api<ForecastData>(`/accounts/${id}/forecast?month=${month}`),
        ),
    )
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [ids, month, retry]);
  const selected = accounts.find((a) => a.id === scopeId);
  const writable = selected?.is_active && selected.permission !== "viewer";
  const saveMethod = async (categoryId: string, method: ForecastMethod) => {
    if (!writable || saveInFlight.current) return;
    saveInFlight.current = true;
    setSavingMethod(categoryId);
    setMethodError("");
    try {
      const saved = await api<{ category_id: string; method: ForecastMethod }>(
        `/accounts/${scopeId}/forecast-methods/${categoryId}`,
        {
          method: "PUT",
          body: JSON.stringify({ method }),
        },
      );
      if (mounted.current) {
        setData(
          (current) =>
            current?.map((account) => ({
              ...account,
              methods: [
                ...(account.methods ?? []).filter(
                  (item) => item.category_id !== categoryId,
                ),
                saved,
              ],
            })) ?? null,
        );
        setReduction(0);
      }
    } catch (err) {
      if (mounted.current)
        setMethodError(
          `Could not save forecast method: ${(err as Error).message}. The displayed method is unchanged; retry or reload to verify.`,
        );
    } finally {
      saveInFlight.current = false;
      if (mounted.current) setSavingMethod(null);
    }
  };
  const openPlan = () => navigate(`/accounts/${scopeId}/budget`);
  const history = () =>
    navigate(`/accounts/${selected?.id ?? accounts[0].id}/ledger`);
  const model = data ? calculateForecast(data) : null;
  const rows =
    model?.rows
      .filter((row) => row.type === type)
      .sort(
        (a, b) =>
          b.forecast - b.plan - (a.forecast - a.plan) ||
          a.name.localeCompare(b.name),
      ) ?? [];
  const attention = model?.rows
    .filter((row) => row.type === "expense" && row.forecast > row.plan)
    .sort((a, b) => b.forecast - b.plan - (a.forecast - a.plan))[0];
  const delta = Math.min(
    model?.remainingExpense ?? 0,
    Math.max(0, Math.round(Number(reduction || 0) * 100)),
  );
  const actualLabel =
    model?.period === "past" ? "Final actual" : "Actual to date";
  return (
    <Container size="xl" py="xl" className="forecast-screen">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap="sm">
              <Title order={1}>Budget &amp; forecast</Title>
              <Badge variant="light">New version</Badge>
            </Group>
            <Text c="dimmed">Know where you stand. See what comes next.</Text>
          </div>
          <Group align="flex-end">
            <Select
              label="Account"
              value={scopeId}
              data={[
                { value: "all", label: "All accounts" },
                ...accounts.map((a) => ({ value: a.id, label: a.name })),
              ]}
              onChange={(id) =>
                id && navigate(`/accounts/${id}/forecast/${month}`)
              }
              w={200}
            />
            <TextInput
              label="Month"
              type="month"
              min="1900-01"
              max="2200-12"
              value={month}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (
                  /^(19\d{2}|20\d{2}|21\d{2}|2200)-(0[1-9]|1[0-2])$/.test(value)
                )
                  navigate(`/accounts/${scopeId}/forecast/${value}`);
              }}
              w={175}
            />
            <Button variant="light" onClick={openPlan}>
              {writable ? "Edit plan" : "View plans"}
            </Button>
          </Group>
        </Group>
        {error ? (
          <Alert color="red" title="Could not load forecast" role="alert">
            <Text>{error}</Text>
            <Button mt="sm" onClick={() => setRetry((value) => value + 1)}>
              Retry forecast
            </Button>
          </Alert>
        ) : !model ? (
          <Group role="status">
            <Loader size="sm" />
            <Text>Loading forecast…</Text>
          </Group>
        ) : (
          <>
            <Text size="sm" c="dimmed">
              {model.period === "past"
                ? "Completed month"
                : model.period === "future"
                  ? "Future plan · no actuals yet"
                  : `Through ${data![0].cutoff} (UTC)`}{" "}
              · Transfers excluded from income and spending
            </Text>
            {!model.rows.length && (
              <Alert
                icon={<IconInfoCircle size={18} />}
                title="No plans or transactions for this month"
              >
                Choose another month or open Budget to create a plan. Your
                existing budget is unchanged.
              </Alert>
            )}
            <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }}>
              {[
                {
                  title: "Planned income",
                  value: model.income.plan,
                  detail: `${actualLabel}: ${money(model.income.actual)}`,
                  color: "teal",
                },
                {
                  title: "Planned spending",
                  value: model.expenses.plan,
                  detail: `${actualLabel}: ${money(model.expenses.actual)}`,
                  color: "indigo",
                },
                {
                  title:
                    model.period === "past"
                      ? "Final spending"
                      : "Forecast spending",
                  value: model.expenses.forecast,
                  detail: `${money(Math.abs(model.expenses.forecast - model.expenses.plan))} ${model.expenses.forecast > model.expenses.plan ? "over" : "under"} plan`,
                  color:
                    model.expenses.forecast > model.expenses.plan
                      ? "orange"
                      : "teal",
                },
                {
                  title:
                    model.period === "past"
                      ? "Final surplus"
                      : "Forecast surplus",
                  value: model.income.forecast - model.expenses.forecast,
                  detail: `Plan ${money(model.income.plan - model.expenses.plan)}`,
                  color: "teal",
                },
              ].map((item) => (
                <Card
                  key={item.title}
                  withBorder
                  radius="md"
                  padding="lg"
                  component="section"
                  aria-label={item.title}
                >
                  <Text fw={600} size="sm" c="dimmed">
                    {item.title}
                  </Text>
                  <Text className="forecast-metric" c={item.color}>
                    {money(item.value)}
                  </Text>
                  <Text size="sm">{item.detail}</Text>
                </Card>
              ))}
            </SimpleGrid>
            <div className="forecast-columns">
              <Card
                withBorder
                radius="md"
                padding="lg"
                component="section"
                aria-label="Spending pace"
              >
                <Title order={3}>Spending pace</Title>
                <Text size="sm" c="dimmed" mb="md">
                  Cumulative spending · {month} · USD
                </Text>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart
                    data={model.points}
                    margin={{ top: 20, right: 15, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="day"
                      type="number"
                      domain={[0, model.days]}
                      tickCount={5}
                    />
                    <YAxis
                      width={65}
                      tickFormatter={(value) => `$${Number(value) / 100}`}
                    />
                    <Tooltip
                      formatter={(value) => money(Number(value))}
                      labelFormatter={(day) => `Day ${day}`}
                    />
                    <Legend />
                    {model.period === "current" && (
                      <ReferenceLine
                        x={model.elapsed}
                        label="Today"
                        stroke="var(--mantine-color-dimmed)"
                        strokeDasharray="3 3"
                      />
                    )}
                    <Line
                      type="linear"
                      dataKey="plan"
                      name="Plan"
                      stroke="#6366f1"
                      dot={false}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                    <Line
                      type="linear"
                      dataKey="actual"
                      name="Actual"
                      stroke="#0d9488"
                      dot={false}
                      strokeWidth={3}
                      isAnimationActive={false}
                    />
                    <Line
                      type="linear"
                      dataKey="forecast"
                      name="Forecast"
                      stroke="#0d9488"
                      strokeDasharray="5 4"
                      dot={false}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <Text size="xs" c="dimmed">
                  Month-end: plan {money(model.expenses.plan)} ·{" "}
                  {model.period === "past" ? "actual" : "forecast"}{" "}
                  {money(model.expenses.forecast)}
                </Text>
              </Card>
              <Card
                withBorder
                radius="md"
                padding="lg"
                component="section"
                aria-label="Cash outlook"
              >
                <Group>
                  <IconChartLine size={22} />
                  <Title order={3}>Cash outlook</Title>
                </Group>
                <Text size="sm" c="dimmed" mt="xs">
                  {model.period === "past"
                    ? "Recorded month-end balance"
                    : "Estimated month-end balance"}
                </Text>
                {model.period === "future" ? (
                  <Text mt="lg">
                    Cash outlook is available for the current and completed
                    months. Future months need intervening cash flows to
                    estimate a balance.
                  </Text>
                ) : (
                  <>
                    <Text
                      className="forecast-metric"
                      c={model.closingBalance < 0 ? "red" : "teal"}
                    >
                      {money(model.closingBalance)}
                    </Text>
                    <Stack gap="sm" mt="md">
                      <Group justify="space-between">
                        <Text size="sm">Balance at cutoff</Text>
                        <Text fw={600}>{money(model.balance)}</Text>
                      </Group>
                      <Group justify="space-between">
                        <Text size="sm">Remaining income</Text>
                        <Text>{money(model.remainingIncome)}</Text>
                      </Group>
                      <Group justify="space-between">
                        <Text size="sm">Remaining spending</Text>
                        <Text>{money(model.remainingExpense)}</Text>
                      </Group>
                    </Stack>
                    {model.closingBalance < 0 && (
                      <Badge color="red" mt="md">
                        Projected shortfall
                      </Badge>
                    )}
                  </>
                )}
                <Text size="xs" c="dimmed" mt="lg">
                  Includes posted transfers in the balance. Estimates do not
                  predict bill dates or the lowest balance within the month.
                </Text>
              </Card>
            </div>
            <div className="forecast-columns">
              <Card withBorder radius="md" padding="lg">
                <Group justify="space-between" mb="md">
                  <Title order={3}>Where the plan is drifting</Title>
                  <SegmentedControl
                    aria-label="Category type"
                    value={type}
                    onChange={setType}
                    data={[
                      { label: "Expenses", value: "expense" },
                      { label: "Income", value: "income" },
                    ]}
                  />
                </Group>
                <div
                  className="forecast-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Category comparison"
                >
                  {methodError && (
                    <Alert color="red" role="alert" mb="sm">
                      {methodError}
                    </Alert>
                  )}
                  {savingMethod && (
                    <Text role="status" size="sm">
                      Saving forecast method…
                    </Text>
                  )}
                  <Table miw={760} aria-label="Forecast categories">
                    <Table.Thead>
                      <Table.Tr>
                        {[
                          "Category",
                          ...(type === "expense" ? ["Method"] : []),
                          "Monthly plan",
                          actualLabel,
                          model.period === "past" ? "Final" : "Forecast",
                          "Vs plan",
                        ].map((label) => (
                          <Table.Th key={label}>{label}</Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {rows.map((row) => {
                        const variance = row.forecast - row.plan;
                        const adverse =
                          type === "expense" ? variance > 0 : variance < 0;
                        return (
                          <Table.Tr key={row.id}>
                            <Table.Td>
                              <Text fw={500}>{row.name}</Text>
                              {!row.plan && (
                                <Text size="xs" c="dimmed">
                                  Unbudgeted
                                </Text>
                              )}
                              <Progress
                                aria-label={`${row.name} actual versus plan`}
                                value={
                                  row.plan
                                    ? Math.min(
                                        100,
                                        (row.actual / row.plan) * 100,
                                      )
                                    : row.actual
                                      ? 100
                                      : 0
                                }
                                color={adverse ? "orange" : "teal"}
                                size={4}
                                mt={6}
                              />
                            </Table.Td>
                            {type === "expense" && (
                              <Table.Td>
                                {writable ? (
                                  <Select
                                    aria-label={`${row.name} forecast method`}
                                    data={[
                                      { value: "fixed", label: "Fixed" },
                                      { value: "variable", label: "Variable" },
                                    ]}
                                    value={row.method}
                                    disabled={savingMethod !== null}
                                    allowDeselect={false}
                                    w={120}
                                    onChange={(value) =>
                                      value &&
                                      value !== row.method &&
                                      void saveMethod(
                                        row.id,
                                        value as ForecastMethod,
                                      )
                                    }
                                  />
                                ) : (
                                  <Badge
                                    variant="light"
                                    color={
                                      row.method === "mixed" ? "gray" : "blue"
                                    }
                                  >
                                    {row.method}
                                  </Badge>
                                )}
                              </Table.Td>
                            )}
                            <Table.Td>{money(row.plan)}</Table.Td>
                            <Table.Td>{money(row.actual)}</Table.Td>
                            <Table.Td>{money(row.forecast)}</Table.Td>
                            <Table.Td>
                              <Badge
                                color={adverse ? "orange" : "teal"}
                                variant="light"
                              >
                                {variance === 0
                                  ? "On plan"
                                  : `${variance > 0 ? "+" : "−"}${money(Math.abs(variance))}`}
                              </Badge>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </div>
                {type === "expense" && (
                  <Text size="xs" c="dimmed" mt="sm">
                    Methods are saved per account and category, shared with
                    account members, and apply across months. Unconfigured
                    categories use Fixed.{" "}
                    {scopeId === "all"
                      ? "Select an account to edit. Mixed means accounts use different methods."
                      : !writable
                        ? "This account is read-only."
                        : ""}
                  </Text>
                )}
                {!rows.length && (
                  <Text c="dimmed" mt="md">
                    No {type === "expense" ? "expenses" : "income"} for this
                    month.
                  </Text>
                )}
              </Card>
              <Card
                withBorder
                radius="md"
                padding="lg"
                component="section"
                aria-label="Plan insights"
              >
                <Title order={3}>
                  {model.period === "past"
                    ? "Review this month"
                    : "Adjust before month-end"}
                </Title>
                <Text mt="md">
                  {attention
                    ? `${attention.name} ${model.period === "past" ? "finished" : "is forecast"} ${money(attention.forecast - attention.plan)} over plan.`
                    : "No expense categories are forecast over plan."}
                </Text>
                <Stack mt="lg" gap="sm">
                  <Button
                    rightSection={<IconArrowUpRight size={16} />}
                    onClick={history}
                  >
                    {scopeId === "all"
                      ? `Review ${accounts[0].name} history`
                      : "Review transactions"}
                  </Button>
                  <Button variant="light" onClick={openPlan}>
                    {writable ? "Adjust plan" : "View plans"}
                  </Button>
                  <Button
                    variant="subtle"
                    disabled={
                      model.period === "past" || model.remainingExpense <= 0
                    }
                    onClick={() => setScenario(true)}
                  >
                    Try a what-if scenario
                  </Button>
                </Stack>
                {scopeId === "all" && (
                  <Text size="xs" c="dimmed" mt="sm">
                    Select an account to review its history or edit its plan.
                  </Text>
                )}
                <Text size="xs" c="dimmed" mt="sm">
                  Plan links open the existing Budget screen. Select the
                  matching year there.
                </Text>
              </Card>
            </div>
            <Card withBorder radius="md" padding="md">
              <Text fw={600} size="sm">
                How estimates work
              </Text>
              <Text size="sm" c="dimmed">
                Actuals come from posted transaction history through the cutoff.
                Fixed expenses use the greater of plan or actual spending,
                without extrapolation. Variable expenses use the greater of plan
                or daily spending pace. Each account/expense category is
                calculated separately before combining accounts. Income uses the
                greater of plan or received income. Completed months and the
                final calendar day use actuals; future months use plans. The
                plan line spreads spending evenly across the month. Use Fixed
                for bills paid early in the month. These are estimates, not
                scheduled payments.
              </Text>
            </Card>
            <Modal
              opened={scenario}
              onClose={() => setScenario(false)}
              title="What if I spend less?"
              centered
            >
              <Stack>
                <Text size="sm">
                  Try reducing the remaining forecast spending. This does not
                  change any budget or transaction.
                </Text>
                <NumberInput
                  label="Reduce remaining spending by ($)"
                  value={reduction}
                  onChange={setReduction}
                  min={0}
                  max={model.remainingExpense / 100}
                  decimalScale={2}
                  fixedDecimalScale
                />
                <Text>
                  Scenario surplus:{" "}
                  {money(
                    model.income.forecast - model.expenses.forecast + delta,
                  )}
                </Text>
                {model.period !== "future" && (
                  <Text>
                    Scenario month-end balance:{" "}
                    {money(model.closingBalance + delta)}
                  </Text>
                )}
                <Text size="xs" c="dimmed">
                  Reduction capped at {money(model.remainingExpense)}. Scenario
                  is not saved.
                </Text>
                <Button
                  onClick={() => {
                    setReduction(0);
                    setScenario(false);
                  }}
                >
                  Close scenario
                </Button>
              </Stack>
            </Modal>
          </>
        )}
      </Stack>
    </Container>
  );
}
