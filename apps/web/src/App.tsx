import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRoute } from "./routing";
import { Home, Settings } from "./screens";
import { ForecastScreen } from "./ForecastScreen";
import {
  ActionIcon,
  AppShell,
  Avatar,
  Burger,
  Badge,
  Button,
  Card,
  Center,
  Container,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NavLink,
  NumberInput,
  Paper,
  Pagination,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowsLeftRight,
  IconChartBar,
  IconChartLine,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconInfoCircle,
  IconLayoutDashboard,
  IconLogout,
  IconPencil,
  IconPlus,
  IconReceipt,
  IconReportMoney,
  IconSettings,
  IconTrash,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  api,
  dateOnly,
  money,
  type Account,
  type AnalysisRow,
  type Category,
  type Transaction,
  type User,
} from "./api";

const today = () => new Date().toISOString().slice(0, 10);

function Auth({ onUser }: { onUser: (user: User) => void }) {
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ setupRequired: boolean }>("/auth/setup-status").then((data) =>
      setSetupRequired(data.setupRequired),
    );
  }, []);
  const submit = async () => {
    try {
      setError("");
      const result = await api<{ user: User }>(
        setupRequired ? "/auth/setup" : "/auth/login",
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      onUser(result.user);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  if (setupRequired === null)
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" w={420}>
        <Stack>
          <div>
            <Title order={1}>
              {setupRequired ? "Set up Finance Manager" : "Welcome back"}
            </Title>
            <Text c="dimmed">
              {setupRequired
                ? "Create the first administrator account."
                : "Sign in to your finance ledger."}
            </Text>
          </div>
          <TextInput
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          <PasswordInput
            label="Password"
            description={setupRequired ? "At least 12 characters" : undefined}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <Text c="red" size="sm">
            {error}
          </Text>
          <Button onClick={submit}>
            {setupRequired ? "Create administrator" : "Sign in"}
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
}

function TransactionForm({
  account,
  categories,
  transaction,
  onSaved,
}: {
  account: Account;
  categories: Category[];
  transaction?: Transaction | null;
  onSaved: (keepOpen: boolean) => void;
}) {
  const [kind, setKind] = useState<"debit" | "credit">("debit");
  const [occurredOn, setOccurredOn] = useState(today());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [notes, setNotes] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (transaction) {
      setKind(Number(transaction.amount_cents) < 0 ? "debit" : "credit");
      setOccurredOn(transaction.occurred_on.split(/[T ]/)[0]);
      setAmount((Math.abs(Number(transaction.amount_cents)) / 100).toFixed(2));
      setDescription(transaction.description);
      setCategoryId(transaction.category_id);
      setIdentifier(transaction.identifier ?? "");
      setNotes(transaction.notes ?? "");
      setVersion(transaction.version);
    } else {
      setKind("debit");
      setOccurredOn(today());
      setAmount("");
      setDescription("");
      setCategoryId(null);
      setIdentifier("");
      setNotes("");
      setVersion(null);
    }
    setError("");
  }, [transaction]);
  const categoryOptions = categories
    .filter((category) => !category.is_archived)
    .map((category) => ({ value: category.id, label: category.name }));
  const save = async () => {
    try {
      if (!categoryId) throw new Error("Choose a category");
      if (!/^\d+\.\d{2}$/.test(amount))
        throw new Error("Enter an amount with exactly two decimal places");
      const cents = Math.round(Number(amount) * 100);
      if (!Number.isFinite(cents) || cents === 0)
        throw new Error("Enter an amount greater than zero");
      const payload = {
        occurredOn,
        amountCents: kind === "debit" ? -Math.abs(cents) : Math.abs(cents),
        description,
        categoryId,
        identifier: identifier || undefined,
        notes: notes || undefined,
        ...(transaction && version !== null ? { version } : {}),
      };
      await api(
        transaction
          ? `/transactions/${transaction.id}`
          : `/accounts/${account.id}/transactions`,
        {
          method: transaction ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      if (!transaction) {
        setKind("debit");
        setOccurredOn(today());
        setAmount("");
        setDescription("");
        setCategoryId(null);
        setIdentifier("");
        setNotes("");
        setVersion(null);
        setError("");
      }
      onSaved(!transaction);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const originalAmount = transaction ? Number(transaction.amount_cents) : 0;
  const proposedAmount =
    (kind === "debit" ? -1 : 1) * Math.round((Number(amount) || 0) * 100);
  const projected =
    Number(account.current_balance_cents) - originalAmount + proposedAmount;
  return (
    <Stack>
      <Group grow>
        <Button
          disabled={Boolean(transaction)}
          variant={kind === "debit" ? "filled" : "light"}
          color="red"
          onClick={() => setKind("debit")}
        >
          Debit
        </Button>
        <Button
          disabled={Boolean(transaction)}
          variant={kind === "credit" ? "filled" : "light"}
          color="green"
          onClick={() => setKind("credit")}
        >
          Credit
        </Button>
      </Group>
      <TextInput
        label="Date"
        type="date"
        value={occurredOn}
        onChange={(e) => setOccurredOn(e.currentTarget.value)}
      />
      <NumberInput
        label="Amount"
        prefix="$"
        value={amount}
        onChange={(value) => setAmount(String(value))}
        onBlur={() => {
          if (amount && Number.isFinite(Number(amount)))
            setAmount(Number(amount).toFixed(2));
        }}
        decimalScale={2}
        fixedDecimalScale
        allowDecimal
        allowNegative={false}
        hideControls
        placeholder="0.00"
        inputMode="decimal"
      />
      <TextInput
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
      />
      <Select
        label="Category"
        placeholder="Choose category"
        data={categoryOptions}
        value={categoryId}
        onChange={setCategoryId}
        searchable
        nothingFoundMessage="No matching categories"
      />
      <TextInput
        label="Identifier (optional)"
        value={identifier}
        onChange={(e) => setIdentifier(e.currentTarget.value)}
      />
      <Textarea
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.currentTarget.value)}
      />
      <Paper withBorder p="sm">
        <Text size="sm" c="dimmed">
          Projected balance
        </Text>
        <Text fw={700} c={kind === "debit" ? "red" : "green"}>
          {money(projected)}
        </Text>
      </Paper>
      <Text c="red" size="sm">
        {error}
      </Text>
      <Button leftSection={<IconPlus size={16} />} onClick={save}>
        {transaction ? "Save changes" : "Save transaction"}
      </Button>
    </Stack>
  );
}

const canDeleteTransaction = (account: Account, transaction: Transaction) =>
  account.permission !== "viewer" && account.is_active &&
  !transaction.reconciled_at && !transaction.transfer_id;
const canEditTransaction = (account: Account, transaction: Transaction) =>
  canDeleteTransaction(account, transaction) && transaction.status === "posted";

function Ledger({
  account,
  categories,
  refreshAccounts,
}: {
  account: Account;
  categories: Category[];
  refreshAccounts: () => Promise<void>;
}) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [entryOpen, setEntryOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [details, setDetails] = useState<Transaction | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(75);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 75,
    totalItems: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string>>(
    {},
  );
  const [loadError, setLoadError] = useState("");
  const requestId = useRef(0);
  const [dateFilter, setDateFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [reconciledFilter, setReconciledFilter] = useState<string | null>(null);
  const [descriptionFilter, setDescriptionFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({
        ...appliedFilters,
        page: String(page),
        pageSize: String(pageSize),
      });
      const result = await api<{
        transactions: Transaction[];
        pagination: typeof pagination;
      }>(`/accounts/${account.id}/ledger?${params.toString()}`);
      if (id !== requestId.current) return;
      setTransactions(result.transactions);
      setPagination(result.pagination);
      setPage(result.pagination.page);
    } catch (err) {
      if (id === requestId.current) {
        setLoadError((err as Error).message);
        setTransactions([]);
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [account.id, page, pageSize, appliedFilters]);
  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);
  const save = async (keepOpen: boolean) => {
    await load();
    await refreshAccounts();
    if (!keepOpen) setEntryOpen(false);
    setEditing(null);
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    await api(`/transactions/${deleting.id}`, { method: "DELETE" });
    setDeleting(null);
    await load();
    await refreshAccounts();
  };
  const variance =
    Number(account.reconciled_balance_cents) -
    Number(account.current_balance_cents);
  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group justify="space-between" align="start">
          <div>
            <Text c="dimmed">Accounts / {account.name}</Text>
            <Title order={1}>
              {account.name}{" "}
              <Text span c="dimmed" fw={400}>
                •• {account.account_number_last_four}
              </Text>
            </Title>
          </div>
          {account.permission !== "viewer" && account.is_active && (
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => {
                setEditing(null);
                setEntryOpen(true);
              }}
            >
              Add transaction
            </Button>
          )}
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Current balance
            </Text>
            <Title>{money(account.current_balance_cents)}</Title>
            <Text size="sm" c="dimmed">
              Variance: {money(variance)}
            </Text>
          </Card>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Reconciled balance
            </Text>
            <Title>{money(account.reconciled_balance_cents)}</Title>
            <Text size="sm" c="dimmed">
              Unreconciled Debits: {money(account.unreconciled_debits_cents)}
            </Text>
            <Text size="sm" c="dimmed">
              Unreconciled Credits: {money(account.unreconciled_credits_cents)}
            </Text>
          </Card>
        </SimpleGrid>
        <Card withBorder>
          <Stack gap="sm">
            <Text fw={600}>Filters</Text>
            <Group align="end">
              <TextInput
                label="Date"
                type="date"
                value={dateFilter}
                onChange={(event) => setDateFilter(event.currentTarget.value)}
              />
              <TextInput
                label="Description"
                placeholder="Contains..."
                value={descriptionFilter}
                onChange={(event) =>
                  setDescriptionFilter(event.currentTarget.value)
                }
              />
              <Select
                label="Category"
                placeholder="All categories"
                data={categories.map((category) => ({
                  value: category.id,
                  label: category.name,
                }))}
                value={categoryFilter}
                onChange={setCategoryFilter}
                clearable
                searchable
              />
              <Select
                label="Reconciled"
                placeholder="All transactions"
                data={[
                  { value: "true", label: "Reconciled" },
                  { value: "false", label: "Unreconciled" },
                ]}
                value={reconciledFilter}
                onChange={setReconciledFilter}
                clearable
              />
              <Button
                variant="light"
                onClick={() => {
                  const filters: Record<string, string> = {};
                  if (dateFilter) filters.occurredOn = dateFilter;
                  if (categoryFilter) filters.categoryId = categoryFilter;
                  if (reconciledFilter) filters.reconciled = reconciledFilter;
                  if (descriptionFilter.trim())
                    filters.description = descriptionFilter.trim();
                  setAppliedFilters(filters);
                  setPage(1);
                }}
              >
                Apply filters
              </Button>
              <Button
                variant="subtle"
                onClick={() => {
                  setDateFilter("");
                  setCategoryFilter(null);
                  setReconciledFilter(null);
                  setDescriptionFilter("");
                  setAppliedFilters({});
                  setPage(1);
                }}
              >
                Clear
              </Button>
            </Group>
          </Stack>
        </Card>
        {loadError && (
          <Group>
            <Text role="alert" c="red">
              {loadError}
            </Text>
            <Button variant="light" onClick={() => void load()}>
              Retry
            </Button>
          </Group>
        )}
        <Card withBorder p={0} style={{ overflowX: "auto" }}>
          <Table striped highlightOnHover miw={760}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th aria-label="Details" />{" "}
                <Table.Th>Description</Table.Th>
                <Table.Th>Category</Table.Th>
                <Table.Th ta="right">Amount</Table.Th>
                <Table.Th>Reconciled</Table.Th>
                <Table.Th ta="right">Balance</Table.Th>
                <Table.Th ta="right">Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {loading ? (
                <Table.Tr>
                  <Table.Td colSpan={8}>
                    <Center>
                      <Loader size="sm" />
                    </Center>
                  </Table.Td>
                </Table.Tr>
              ) : transactions.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={8}>
                    <Text ta="center" py="lg" c="dimmed">
                      {loadError
                        ? "Transactions could not be loaded."
                        : "No matching transactions."}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                transactions.map((transaction) => {
                  const editable = canEditTransaction(account, transaction);
                  const deletable = canDeleteTransaction(account, transaction);
                  return (
                    <Table.Tr key={transaction.id}>
                      <Table.Td>{dateOnly(transaction.occurred_on)}</Table.Td>
                      <Table.Td>
                        {(transaction.identifier || transaction.notes) && (
                          <ActionIcon
                            aria-label={`View details for ${transaction.description}`}
                            variant="subtle"
                            onClick={() => setDetails(transaction)}
                          >
                            <IconInfoCircle size={16} />
                          </ActionIcon>
                        )}
                      </Table.Td>
                      <Table.Td>{transaction.description}</Table.Td>
                      <Table.Td>
                        <Badge variant="light">
                          {transaction.category_name}
                        </Badge>
                      </Table.Td>
                      <Table.Td
                        ta="right"
                        className={
                          Number(transaction.amount_cents) < 0
                            ? "amount-debit"
                            : "amount-credit"
                        }
                      >
                        {money(transaction.amount_cents)}
                      </Table.Td>
                      <Table.Td>
                        {transaction.reconciled_at ? "✓" : "○"}
                      </Table.Td>
                      <Table.Td ta="right">
                        {money(transaction.running_balance_cents)}
                      </Table.Td>
                      <Table.Td ta="right">
                        {editable && (
                          <ActionIcon
                            aria-label={`Edit ${transaction.description}`}
                            variant="subtle"
                            onClick={() => {
                              setEditing(transaction);
                              setEntryOpen(true);
                            }}
                          >
                            <IconPencil size={16} />
                          </ActionIcon>
                        )}
                        {deletable && (
                          <ActionIcon
                            aria-label={`Delete ${transaction.description}`}
                            color="red"
                            variant="subtle"
                            onClick={() => setDeleting(transaction)}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })
              )}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
      <Group justify="space-between" align="end" mt="md" mb="md">
        <Stack gap="xs">
          <Text size="sm" aria-live="polite">
            {loading
              ? "Loading transactions…"
              : loadError
                ? "Pagination unavailable"
                : `Page ${pagination.page} of ${pagination.totalPages} · ${pagination.totalItems} transactions`}
          </Text>
          <Group gap="xs">
            <Button
              variant="default"
              disabled={
                loading || Boolean(loadError) || !pagination.hasPreviousPage
              }
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Pagination
              total={pagination.totalPages}
              value={page}
              onChange={setPage}
              withControls={false}
              siblings={1}
              boundaries={1}
              disabled={loading || Boolean(loadError)}
              getItemProps={(value) => ({ "aria-label": `Page ${value}` })}
            />
            <Button
              variant="default"
              disabled={
                loading || Boolean(loadError) || !pagination.hasNextPage
              }
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </Group>
        </Stack>
        <Select
          label="Results per page"
          data={["25", "50", "75", "100"]}
          value={String(pageSize)}
          onChange={(value) => {
            if (value) {
              setPageSize(Number(value));
              setPage(1);
            }
          }}
          w={160}
          allowDeselect={false}
        />
      </Group>
      <Modal
        opened={entryOpen}
        onClose={() => {
          setEntryOpen(false);
          setEditing(null);
        }}
        title={editing ? "Edit transaction" : "Add transaction"}
        size="lg"
      >
        <TransactionForm
          account={account}
          categories={categories}
          transaction={editing}
          onSaved={save}
        />
      </Modal>
      <Modal
        opened={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete transaction"
        centered
      >
        <Stack>
          <Text>
            Delete “{deleting?.description}”? This transaction will be removed
            from the ledger. This action cannot be undone.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button color="red" onClick={() => void confirmDelete()}>
              Delete transaction
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={Boolean(details)}
        onClose={() => setDetails(null)}
        title="Transaction details"
        centered
      >
        <Stack gap="xs">
          <Text>
            <strong>Date:</strong>{" "}
            {details ? dateOnly(details.occurred_on) : ""}
          </Text>
          <Text>
            <strong>Description:</strong> {details?.description}
          </Text>
          <Text>
            <strong>Category:</strong> {details?.category_name}
          </Text>
          <Text>
            <strong>Amount:</strong>{" "}
            {details ? money(details.amount_cents) : ""}
          </Text>
          <Text>
            <strong>Status:</strong> {details?.status}
          </Text>
          <Text>
            <strong>Reconciled:</strong>{" "}
            {details?.reconciled_at ? dateOnly(details.reconciled_at) : "No"}
          </Text>
          <Text>
            <strong>Identifier:</strong> {details?.identifier || "-"}
          </Text>
          <Text>
            <strong>Notes:</strong> {details?.notes || "-"}
          </Text>
        </Stack>
      </Modal>
    </Container>
  );
}

function Analysis({
  account,
  accounts,
  categories,
  onAccountChange,
}: {
  account: Account;
  accounts: Account[];
  categories: Category[];
  onAccountChange: (accountId: string) => void;
}) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    try {
      setError("");
      const result = await api<{ rows: AnalysisRow[] }>(
        `/accounts/${account.id}/analysis/monthly?year=${year}`,
      );
      setRows(result.rows);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [account.id, year]);
  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      {
        type: "debit" | "credit";
        categoryId: string;
        name: string;
        months: number[];
      }
    >();
    rows.forEach((row) => {
      const key = `${row.transaction_type}:${row.category_id}`;
      const group = groups.get(key) ?? {
        type: row.transaction_type,
        categoryId: row.category_id,
        name: row.category_name,
        months: Array(12).fill(0),
      };
      group.months[row.month - 1] += Number(row.amount_cents) / 100;
      groups.set(key, group);
    });
    return {
      debit: [...groups.values()].filter((group) => group.type === "debit"),
      credit: [...groups.values()].filter((group) => group.type === "credit"),
    };
  }, [rows]);
  const chartData = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const monthRows = rows.filter((row) => row.month === index + 1);
        const debits = monthRows
          .filter((row) => row.transaction_type === "debit")
          .reduce(
            (sum, row) => sum + Math.abs(Number(row.amount_cents)) / 100,
            0,
          );
        const credits = monthRows
          .filter((row) => row.transaction_type === "credit")
          .reduce((sum, row) => sum + Number(row.amount_cents) / 100, 0);
        return {
          month: new Date(2000, index, 1).toLocaleString("en-US", {
            month: "short",
          }),
          debits,
          credits,
          generalSpending: credits - debits,
        };
      }),
    [rows],
  );
  const categoryChartData = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const monthRows = rows.filter((row) => row.month === index + 1);
        const point: Record<string, string | number> = {
          month: new Date(2000, index, 1).toLocaleString("en-US", {
            month: "short",
          }),
        };
        selectedCategoryIds.forEach((categoryId) => {
          point[categoryId] = monthRows
            .filter((row) => row.category_id === categoryId)
            .reduce(
              (sum, row) => sum + Math.abs(Number(row.amount_cents)) / 100,
              0,
            );
        });
        return point;
      }),
    [rows, selectedCategoryIds],
  );
  const categoryColor = (categoryId: string) => {
    let hash = 0;
    for (const character of categoryId)
      hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return `hsl(${Math.abs(hash) % 360} 65% 45%)`;
  };
  const renderSection = (label: string, type: "debit" | "credit") => {
    const section = grouped[type];
    const totals = Array.from({ length: 12 }, (_, month) =>
      section.reduce((sum, row) => sum + row.months[month], 0),
    );
    const total = totals.reduce((sum, value) => sum + value, 0);
    return (
      <>
        <Table.Tr>
          <Table.Td colSpan={15}>
            <Text fw={700}>{label}</Text>
          </Table.Td>
        </Table.Tr>
        {section.map((row) => {
          const active = row.months.filter((value) => value !== 0);
          const rowTotal = row.months.reduce((sum, value) => sum + value, 0);
          const average = active.length ? rowTotal / active.length : 0;
          return (
            <Table.Tr key={`${type}-${row.categoryId}`}>
              <Table.Td>{row.name}</Table.Td>
              {row.months.map((value, index) => (
                <Table.Td ta="right" key={index}>
                  {money(value * 100)}
                </Table.Td>
              ))}
              <Table.Td ta="right">{money(rowTotal * 100)}</Table.Td>
              <Table.Td ta="right">{money(average * 100)}</Table.Td>
            </Table.Tr>
          );
        })}
        <Table.Tr>
          <Table.Td fw={700}>TOTAL</Table.Td>
          {totals.map((value, index) => (
            <Table.Td ta="right" fw={700} key={index}>
              {money(value * 100)}
            </Table.Td>
          ))}
          <Table.Td ta="right" fw={700}>
            {money(total * 100)}
          </Table.Td>
          <Table.Td ta="right" fw={700}>
            {money(
              (totals.filter((value) => value !== 0).length
                ? total / totals.filter((value) => value !== 0).length
                : 0) * 100,
            )}
          </Table.Td>
        </Table.Tr>
      </>
    );
  };
  const years = Array.from(
    { length: 11 },
    (_, index) => currentYear - 5 + index,
  ).map((value) => ({ value: String(value), label: String(value) }));
  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group justify="space-between" align="end">
          <div>
            <Text c="dimmed">Analysis / {account.name}</Text>
            <Title order={1}>Analysis</Title>
          </div>
          <Group align="end">
            <Select
              label="Account"
              aria-label="Analysis account"
              data={accounts.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              value={account.id}
              onChange={(value) => value && onAccountChange(value)}
              w={220}
            />
            <Select
              label="Year"
              aria-label="Analysis year"
              data={years}
              value={String(year)}
              onChange={(value) => value && setYear(Number(value))}
              w={140}
            />
          </Group>
        </Group>
        <Card withBorder p={0} style={{ overflowX: "auto" }}>
          {loading ? (
            <Center p="xl">
              <Loader size="sm" />
            </Center>
          ) : error ? (
            <Text c="red" p="md">
              {error}
            </Text>
          ) : (
            <Table striped withTableBorder miw={1250}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Category</Table.Th>
                  {Array.from({ length: 12 }, (_, index) => (
                    <Table.Th ta="right" key={index}>
                      {new Date(2000, index, 1).toLocaleString("en-US", {
                        month: "long",
                      })}
                    </Table.Th>
                  ))}
                  <Table.Th ta="right">Category Total</Table.Th>
                  <Table.Th ta="right">Average</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {renderSection("Debits", "debit")}
                {renderSection("Credits", "credit")}
              </Table.Tbody>
            </Table>
          )}
        </Card>
        <Card withBorder>
          <Title order={3}>Monthly cash flow</Title>
          <Text c="dimmed" size="sm" mb="md">
            Debits are shown as positive expense amounts. General Spending
            equals Total Credits minus Total Debits.
          </Text>
          <ResponsiveContainer width="100%" height={360}>
            <BarChart
              data={chartData}
              margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(value) => `$${value}`} />
              <ChartTooltip
                formatter={(value) => money(Number(value ?? 0) * 100)}
              />
              <Legend />
              <Bar
                dataKey="debits"
                name="Total Debits"
                fill="var(--mantine-color-red-6)"
              />
              <Bar
                dataKey="credits"
                name="Total Credits"
                fill="var(--mantine-color-green-6)"
              />
              <Bar
                dataKey="generalSpending"
                name="General Spending"
                fill="var(--mantine-color-blue-6)"
              />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card withBorder>
          <Group justify="space-between" align="end">
            <div>
              <Title order={3}>Category trends</Title>
              <Text c="dimmed" size="sm">
                Debits and credits are netted by category and shown as positive
                values.
              </Text>
            </div>
            <MultiSelect
              label="Categories"
              placeholder="Select categories"
              data={categories.map((category) => ({
                value: category.id,
                label: category.name,
              }))}
              value={selectedCategoryIds}
              onChange={setSelectedCategoryIds}
              searchable
              clearable
              w={320}
            />
          </Group>
          {selectedCategoryIds.length === 0 ? (
            <Text c="dimmed" ta="center" py="xl">
              Select one or more categories to display the trend chart.
            </Text>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <LineChart
                data={categoryChartData}
                margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis tickFormatter={(value) => `$${value}`} />
                <ChartTooltip
                  formatter={(value) => money(Number(value ?? 0) * 100)}
                />
                <Legend />
                {selectedCategoryIds.map((categoryId) => (
                  <Line
                    key={categoryId}
                    type="monotone"
                    dataKey={categoryId}
                    name={
                      categories.find((category) => category.id === categoryId)
                        ?.name ?? "Category"
                    }
                    stroke={categoryColor(categoryId)}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </Stack>
    </Container>
  );
}

function TransferForm({
  accounts,
  onSaved,
}: {
  accounts: Account[];
  onSaved: () => Promise<void>;
}) {
  const [sourceAccountId, setSourceAccountId] = useState<string | null>(null);
  const [destinationAccountId, setDestinationAccountId] = useState<
    string | null
  >(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("Account transfer");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const options = accounts
    .filter((account) => account.is_active)
    .map((account) => ({ value: account.id, label: account.name }));
  const save = async () => {
    try {
      setError("");
      if (!sourceAccountId || !destinationAccountId)
        throw new Error("Choose both accounts");
      if (sourceAccountId === destinationAccountId)
        throw new Error("Choose two different accounts");
      if (!/^\d+\.\d{2}$/.test(amount))
        throw new Error("Enter an amount with exactly two decimal places");
      const cents = Math.round(Number(amount) * 100);
      if (!Number.isFinite(cents) || cents <= 0)
        throw new Error("Enter an amount greater than zero");
      await api("/transfers", {
        method: "POST",
        body: JSON.stringify({
          sourceAccountId,
          destinationAccountId,
          occurredOn: today(),
          amountCents: cents,
          description,
          notes: notes || undefined,
        }),
      });
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Stack>
      <Select
        label="From account"
        placeholder="Choose source account"
        data={options}
        value={sourceAccountId}
        onChange={setSourceAccountId}
        searchable
        nothingFoundMessage="No matching accounts"
      />
      <Select
        label="To account"
        placeholder="Choose destination account"
        data={options}
        value={destinationAccountId}
        onChange={setDestinationAccountId}
        searchable
        nothingFoundMessage="No matching accounts"
      />
      <NumberInput
        label="Amount"
        prefix="$"
        value={amount}
        onChange={(value) => setAmount(String(value))}
        onBlur={() => {
          if (amount && Number.isFinite(Number(amount)))
            setAmount(Number(amount).toFixed(2));
        }}
        decimalScale={2}
        fixedDecimalScale
        allowDecimal
        allowNegative={false}
        hideControls
        placeholder="0.00"
        inputMode="decimal"
      />
      <TextInput
        label="Description"
        value={description}
        onChange={(event) => setDescription(event.currentTarget.value)}
      />
      <Textarea
        label="Notes (optional)"
        value={notes}
        onChange={(event) => setNotes(event.currentTarget.value)}
      />
      <Text c="red" size="sm">
        {error}
      </Text>
      <Button
        leftSection={<IconArrowsLeftRight size={16} />}
        onClick={() => void save()}
      >
        Transfer funds
      </Button>
    </Stack>
  );
}

type BudgetMonth = {
  month: number;
  amount_cents: number | string;
  checked_at: string | null;
};
type BudgetLine = {
  id: string;
  line_type: "income" | "expense";
  name: string;
  category_id: string;
  category_name: string;
  months: BudgetMonth[];
};
function Budget({
  account,
  scopeId,
  accounts,
  categories,
  onAccountChange,
}: {
  account: Account;
  scopeId: string;
  accounts: Account[];
  categories: Category[];
  onAccountChange: (accountId: string) => void;
}) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const [year, setYear] = useState(currentYear);
  const budgetAccountId = scopeId;
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [actuals, setActuals] = useState<
    {
      category_id: string;
      line_type: "income" | "expense";
      month: number;
      amount_cents: number | string;
    }[]
  >([]);
  const [newType, setNewType] = useState<"income" | "expense">("expense");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [deletingLine, setDeletingLine] = useState<BudgetLine | null>(null);
  const [error, setError] = useState("");
  const [loadingBudget, setLoadingBudget] = useState(true);
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [pendingSaves, setPendingSaves] = useState(0);
  const [copyYearOpen, setCopyYearOpen] = useState(false);
  const [budgetNotice, setBudgetNotice] = useState('');
  const budgetBusyRef = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  const saveFailed = useRef(false);
  const loadRequest = useRef(0);
  const budgetMounted = useRef(true);
  const budgetScope = useRef({ id: budgetAccountId, year });
  budgetScope.current = { id: budgetAccountId, year };
  const canWriteBudget = budgetAccountId !== 'all' && account.is_active && account.permission !== 'viewer';
  const budgetDisabled = !canWriteBudget || budgetBusy || loadingBudget || saveFailed.current;
  useEffect(() => { budgetMounted.current = true; return () => { budgetMounted.current = false; }; }, []);
  const load = async () => {
    if (!budgetMounted.current) return;
    const request = ++loadRequest.current;
    const isCurrent = () => budgetMounted.current && request === loadRequest.current && budgetScope.current.id === budgetAccountId && budgetScope.current.year === year;
    setLoadingBudget(true);
    try {
      const ids =
        budgetAccountId === "all"
          ? accounts.map((item) => item.id)
          : [budgetAccountId];
      const results = await Promise.all(
        ids.map((id) =>
          api<{ lines: BudgetLine[]; actuals: typeof actuals }>(
            `/accounts/${id}/budget?year=${year}`,
          ),
        ),
      );
      if (isCurrent()) {
        setLines(results.flatMap((result) => result.lines));
        setActuals(results.flatMap((result) => result.actuals));
        saveFailed.current = false;
        setError('');
      }
    } catch (err) {
      if (isCurrent()) { saveFailed.current = true; setError((err as Error).message); }
    } finally {
      if (isCurrent()) setLoadingBudget(false);
    }
  };
  useEffect(() => {
    setLines([]);
    setActuals([]);
    void load();
  }, [budgetAccountId, year, accounts.length]);
  const runBudgetAction = async (work: () => Promise<void>, allowFailed = false) => {
    if (budgetBusyRef.current) return;
    budgetBusyRef.current = true;
    setBudgetBusy(true);
    setError('');
    setBudgetNotice('');
    try {
      await saveQueue.current;
      if (saveFailed.current && !allowFailed) throw new Error('An amount could not be saved. Reload the saved budget and re-enter the change before copying.');
      await work();
    } catch (err) {
      if (budgetMounted.current) setError((err as Error).message);
    } finally {
      budgetBusyRef.current = false;
      if (budgetMounted.current) setBudgetBusy(false);
    }
  };
  const addLine = async () => {
    try {
      if (budgetAccountId === "all")
        throw new Error(
          "Select a specific account before adding a budget line",
        );
      if (!newName.trim() || !newCategory)
        throw new Error("Enter a name and choose a category");
      await api(`/accounts/${budgetAccountId}/budget/lines`, {
        method: "POST",
        body: JSON.stringify({
          year,
          lineType: newType,
          name: newName.trim(),
          categoryId: newCategory,
        }),
      });
      setNewName("");
      setNewCategory(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const changeMonth = (
    lineId: string,
    month: number,
    value: string | number,
  ) => {
    const amountCents = Math.max(0, Math.round((Number(value) || 0) * 100));
    setLines((current) =>
      current.map((line) =>
        line.id === lineId
          ? {
              ...line,
              months: line.months.map((item) =>
                item.month === month
                  ? { ...item, amount_cents: amountCents }
                  : item,
              ),
            }
          : line,
      ),
    );
  };
  const updateMonth = async (
    line: BudgetLine,
    month: number,
    amount: string,
    checked: boolean,
  ) => {
    const cents = Math.max(0, Math.round((Number(amount) || 0) * 100));
    setPendingSaves(count => count + 1);
    saveQueue.current = saveQueue.current.then(async () => {
      if (saveFailed.current) return;
      await api(`/budget-lines/${line.id}/months`, {
        method: "PATCH", body: JSON.stringify({ month, amountCents: cents, checked }),
      });
    }).catch(err => {
      saveFailed.current = true;
      if (budgetMounted.current) setError(`Amount was not saved: ${err.message}. Reload the saved budget before continuing.`);
    }).finally(() => { if (budgetMounted.current) setPendingSaves(count => count - 1); });
    await saveQueue.current;
  };
  const replicate = async (line: BudgetLine) => {
    const month = line.months.find((item) => item.month === currentMonth);
    if (!month) return;
    await api(`/budget-lines/${line.id}/replicate`, {
      method: "POST",
      body: JSON.stringify({
        amountCents: Number(month.amount_cents),
        fromMonth: currentMonth,
      }),
    });
    await load();
  };
  const deleteLine = async () => {
    if (!deletingLine) return;
    try {
      await api(`/budget-lines/${deletingLine.id}`, { method: "DELETE" });
      setDeletingLine(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const renderLines = (type: "expense" | "income") => {
    const section = lines.filter((line) => line.line_type === type);
    const totals = Array.from({ length: 12 }, (_, index) =>
      section.reduce(
        (sum, line) =>
          sum +
          Number(line.months[index]?.amount_cents ?? 0),
        0,
      ),
    );
    return (
      <>
        <Table.Tr>
          <Table.Td>
            <Text fw={700}>{type === "expense" ? "Expenses" : "Income"}</Text>
          </Table.Td>
          <Table.Td colSpan={14} />
        </Table.Tr>
        {section.map((line) => {
          const lineTotal = line.months.reduce(
            (sum, month) =>
              sum + Number(month.amount_cents),
            0,
          );
          return (
            <Table.Tr key={line.id}>
              <Table.Td>
                {line.name}
                <Text size="xs" c="dimmed">
                  {line.category_name}
                </Text>
                <Tooltip label="Replace February–December amounts with January; keep entered checkmarks">
                  <Button size="compact-xs" variant="subtle" mt={4}
                    aria-label={`Copy January for ${line.name}`} disabled={budgetDisabled}
                    onClick={() => void runBudgetAction(async () => {
                      await api(`/budget-lines/${line.id}/copy-january`, { method: 'POST' });
                      await load();
                    })}>Copy January</Button>
                </Tooltip>
              </Table.Td>
              {line.months.map((month) => (
                <Table.Td
                  key={month.month}
                  ta="center"
                  style={{
                    backgroundColor:
                      month.month % 2 === 1
                        ? "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))"
                        : undefined,
                  }}
                >
                  <Group
                    gap={2}
                    wrap="nowrap"
                    style={
                      month.checked_at
                        ? { opacity: 0.5, textDecoration: "line-through" }
                        : undefined
                    }
                  >
                    <NumberInput
                      value={Number(month.amount_cents) / 100}
                      aria-label={`${line.name} month ${month.month} amount`}
                      disabled={budgetDisabled}
                      decimalScale={2}
                      fixedDecimalScale
                      hideControls
                      prefix="$"
                      w={90}
                      onChange={(value) =>
                        changeMonth(line.id, month.month, value)
                      }
                      onBlur={() =>
                        void updateMonth(
                          line,
                          month.month,
                          String(Number(month.amount_cents) / 100),
                          Boolean(month.checked_at),
                        )
                      }
                    />
                    <input
                      aria-label={`Mark ${line.name} month ${month.month} entered`}
                      type="checkbox"
                      disabled={budgetDisabled}
                      checked={Boolean(month.checked_at)}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setLines((current) =>
                          current.map((item) =>
                            item.id === line.id
                              ? {
                                  ...item,
                                  months: item.months.map((value) =>
                                    value.month === month.month
                                      ? {
                                          ...value,
                                          checked_at: checked
                                            ? new Date().toISOString()
                                            : null,
                                        }
                                      : value,
                                  ),
                                }
                              : item,
                          ),
                        );
                        void updateMonth(
                          line,
                          month.month,
                          String(Number(month.amount_cents) / 100),
                          checked,
                        );
                      }}
                    />
                  </Group>
                </Table.Td>
              ))}
              <Table.Td ta="right" fw={700}>
                {money(lineTotal)}
              </Table.Td>
              <Table.Td>
                <Group gap={2} justify="flex-end">
                  <Tooltip label="Copy from current month">
                    <ActionIcon
                      aria-label={`Copy current month for ${line.name}`}
                      variant="subtle"
                      disabled={budgetDisabled}
                      onClick={() => void runBudgetAction(() => replicate(line))}
                    >
                      <IconCopy size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Delete budget line">
                    <ActionIcon
                      aria-label={`Delete ${line.name}`}
                      disabled={budgetDisabled}
                      color="red"
                      variant="subtle"
                      onClick={() => setDeletingLine(line)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Table.Td>
            </Table.Tr>
          );
        })}
        <Table.Tr>
          <Table.Td fw={700} c={type === "expense" ? "red" : "green"}>
            TOTAL
          </Table.Td>
          {totals.map((value, index) => (
            <Table.Td
              ta="center"
              fw={700}
              c={type === "expense" ? "red" : "green"}
              key={index}
              style={{
                backgroundColor:
                  index % 2 === 0
                    ? "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))"
                    : undefined,
              }}
            >
              {money(value)}
            </Table.Td>
          ))}
          <Table.Td
            ta="right"
            fw={700}
            c={type === "expense" ? "red" : "green"}
          >
            {money(totals.reduce((sum, value) => sum + value, 0))}
          </Table.Td>
          <Table.Td />
        </Table.Tr>
      </>
    );
  };
  const actualByCategoryMonth = (
    type: "income" | "expense",
    categoryId: string,
    month: number,
  ) =>
    Number(
      actuals.find(
        (actual) =>
          actual.line_type === type &&
          actual.category_id === categoryId &&
          actual.month === month,
      )?.amount_cents ?? 0,
    );
  const plannedByCategoryMonth = (
    type: "income" | "expense",
    categoryId: string,
    month: number,
  ) =>
    lines
      .filter(
        (line) => line.line_type === type && line.category_id === categoryId,
      )
      .reduce((sum, line) => {
        const item = line.months.find((value) => value.month === month);
        return sum + Number(item?.amount_cents ?? 0);
      }, 0);
  const actualByCategory = (type: "income" | "expense", categoryId: string) =>
    Array.from({ length: 12 }, (_, index) =>
      actualByCategoryMonth(type, categoryId, index + 1),
    ).reduce((sum, value) => sum + value, 0);
  const plannedByCategory = (type: "income" | "expense", categoryId: string) =>
    Array.from({ length: 12 }, (_, index) =>
      plannedByCategoryMonth(type, categoryId, index + 1),
    ).reduce((sum, value) => sum + value, 0);
  const monthNames = Array.from({ length: 12 }, (_, index) =>
    new Date(2000, index, 1).toLocaleString("en-US", { month: "short" }),
  );
  const chartData = monthNames.map((month, index) => {
    const monthNumber = index + 1;
    return {
      month,
      plannedExpenses:
        lines
          .filter((line) => line.line_type === "expense")
          .reduce(
            (sum, line) =>
              sum +
              Number(
                line.months.find((item) => item.month === monthNumber)
                  ?.amount_cents ?? 0,
              ),
            0,
          ) / 100,
      actualExpenses:
        actuals
          .filter(
            (actual) =>
              actual.line_type === "expense" && actual.month === monthNumber,
          )
          .reduce((sum, actual) => sum + Number(actual.amount_cents), 0) / 100,
      plannedIncome:
        lines
          .filter((line) => line.line_type === "income")
          .reduce(
            (sum, line) =>
              sum +
              Number(
                line.months.find((item) => item.month === monthNumber)
                  ?.amount_cents ?? 0,
              ),
            0,
          ) / 100,
      actualIncome:
        actuals
          .filter(
            (actual) =>
              actual.line_type === "income" && actual.month === monthNumber,
          )
          .reduce((sum, actual) => sum + Number(actual.amount_cents), 0) / 100,
    };
  });
  const cumulativeKeys = [
    "plannedExpenses",
    "actualExpenses",
    "plannedIncome",
    "actualIncome",
  ] as const;
  const runningCents = {
    plannedExpenses: 0,
    actualExpenses: 0,
    plannedIncome: 0,
    actualIncome: 0,
  };
  const cumulativeChartData = chartData.map((month) => {
    const cumulative = { ...month };
    for (const key of cumulativeKeys) {
      runningCents[key] += Math.round(month[key] * 100);
      cumulative[key] = runningCents[key] / 100;
    }
    return cumulative;
  });
  const years = [...new Set([...Array.from({ length: 11 }, (_, index) => currentYear - 5 + index), year])]
    .filter(value => value >= 1900 && value <= 2200).sort((a,b) => a-b)
    .map(value => ({ value: String(value), label: String(value) }));
  const budgetCategories = (type: "income" | "expense") =>
    categories.filter(
      (category) =>
        lines.some(
          (line) => line.line_type === type && line.category_id === category.id,
        ) ||
        actuals.some(
          (actual) =>
            actual.line_type === type && actual.category_id === category.id,
        ),
    );
  const renderPlannedActual = (type: "income" | "expense") => (
    <div>
      <Text fw={600} mt="md">
        {type === "expense" ? "Expenses" : "Income"}
      </Text>
      <Table miw={2100} withTableBorder aria-label={`${type} planned versus actual`}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th rowSpan={2}>Category</Table.Th>
            {monthNames.map((month, index) => (
              <Table.Th
                key={month}
                colSpan={3}
                ta="center"
                style={{
                  backgroundColor:
                    index % 2 === 0
                      ? "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))"
                      : undefined,
                }}
              >
                {month}
              </Table.Th>
            ))}
            <Table.Th rowSpan={2} ta="right">
              Year Planned
            </Table.Th>
            <Table.Th rowSpan={2} ta="right">
              Year Actual
            </Table.Th>
            <Table.Th rowSpan={2} ta="right">
              Year Variance
            </Table.Th>
          </Table.Tr>
          <Table.Tr>
            {monthNames.flatMap((month) => [
              <Table.Th
                key={`${month}-planned`}
                ta="right"
                style={{
                  backgroundColor:
                    monthNames.indexOf(month) % 2 === 0
                      ? "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))"
                      : undefined,
                }}
              >
                Planned
              </Table.Th>,
              <Table.Th
                key={`${month}-actual`}
                ta="right"
                style={{
                  backgroundColor:
                    monthNames.indexOf(month) % 2 === 0
                      ? "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))"
                      : undefined,
                }}
              >
                Actual
              </Table.Th>,
              <Table.Th
                key={`${month}-variance`}
                ta="right"
                style={{
                  backgroundColor:
                    monthNames.indexOf(month) % 2 === 0
                      ? "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))"
                      : undefined,
                }}
              >
                Variance
              </Table.Th>,
            ])}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {budgetCategories(type).map((category) => {
            const planned = plannedByCategory(type, category.id);
            const actual = actualByCategory(type, category.id);
            return (
              <Table.Tr key={`${type}-${category.id}`}>
                <Table.Td>{category.name}</Table.Td>
                {monthNames.map((_, index) => {
                  const month = index + 1;
                  const monthPlanned = plannedByCategoryMonth(
                    type,
                    category.id,
                    month,
                  );
                  const monthActual = actualByCategoryMonth(
                    type,
                    category.id,
                    month,
                  );
                  return (
                    <Fragment key={`${category.id}-${month}`}>
                      <Table.Td
                        ta="right"
                        style={{
                          backgroundColor:
                            index % 2 === 0
                              ? "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))"
                              : undefined,
                        }}
                      >
                        {money(monthPlanned)}
                      </Table.Td>
                      <Table.Td
                        ta="right"
                        style={{
                          backgroundColor:
                            index % 2 === 0
                              ? "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))"
                              : undefined,
                        }}
                      >
                        {money(monthActual)}
                      </Table.Td>
                      <Table.Td
                        ta="right"
                        style={{
                          backgroundColor:
                            index % 2 === 0
                              ? "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))"
                              : undefined,
                        }}
                      >
                        {money(monthActual - monthPlanned)}
                      </Table.Td>
                    </Fragment>
                  );
                })}
                <Table.Td ta="right" fw={700}>
                  {money(planned)}
                </Table.Td>
                <Table.Td ta="right" fw={700}>
                  {money(actual)}
                </Table.Td>
                <Table.Td ta="right" fw={700}>
                  {money(actual - planned)}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </div>
  );
  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group justify="space-between" align="end">
          <div>
            <Text c="dimmed">
              Budget /{" "}
              {budgetAccountId === "all" ? "All accounts" : account.name}
            </Text>
            <Title order={1}>Budget</Title>
          </div>
          <Group>
            <Select
              label="Account"
              data={[
                { value: "all", label: "All accounts" },
                ...accounts.map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
              value={budgetAccountId}
              disabled={budgetBusy || pendingSaves > 0}
              onChange={(value) => value && onAccountChange(value)}
              searchable
              w={220}
            />
            <Select
              label="Year"
              data={years}
              value={String(year)}
              disabled={budgetBusy || pendingSaves > 0}
              onChange={(value) => { if (value) { setBudgetNotice(''); setYear(Number(value)); } }}
              w={130}
            />
            <Button variant="light" leftSection={<IconCopy size={16} />}
              disabled={budgetDisabled || lines.length === 0 || year >= 2200}
              onClick={() => setCopyYearOpen(true)}>Copy to {year + 1}</Button>
          </Group>
        </Group>
        {budgetAccountId === 'all' && <Text size="sm" c="dimmed">Select one account to edit or copy its budget.</Text>}
        {budgetNotice && <Text role="status" c="teal">{budgetNotice}</Text>}
        {loadingBudget && <Text role="status">Loading budget…</Text>}
        {error && <Group><Text role="alert" c="red">{error}</Text><Button variant="light" disabled={budgetBusy || loadingBudget} onClick={() => void runBudgetAction(load, true)}>Reload saved budget</Button></Group>}
        <Card withBorder>
          <Group align="end">
            <Select
              label="Line type"
              data={[
                { value: "expense", label: "Expense" },
                { value: "income", label: "Income" },
              ]}
              value={newType}
              onChange={(value) =>
                value && setNewType(value as "income" | "expense")
              }
              w={130}
            />
            <TextInput
              label="Name"
              placeholder="Electricity"
              value={newName}
              onChange={(event) => setNewName(event.currentTarget.value)}
            />
            <Select
              label="Category"
              data={categories.map((category) => ({
                value: category.id,
                label: category.name,
              }))}
              value={newCategory}
              onChange={setNewCategory}
              searchable
              w={200}
            />
            <Button disabled={budgetDisabled} onClick={() => void runBudgetAction(addLine)}>Add line</Button>
          </Group>
        </Card>
        <Card
          withBorder
          p={0}
          className="budget-grid-scroll"
          role="region"
          aria-label="Editable budget grid"
          tabIndex={0}
        >
          <Table miw={1500} className="budget-editor-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Line</Table.Th>
                {monthNames.map((month, index) => (
                  <Table.Th
                    ta="center"
                    key={month}
                    style={{
                      backgroundColor:
                        index % 2 === 0
                          ? "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))"
                          : undefined,
                    }}
                  >
                    {month}
                  </Table.Th>
                ))}
                <Table.Th ta="right">Line Total</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {renderLines("expense")}
              {renderLines("income")}
            </Table.Tbody>
          </Table>
        </Card>
        <Card withBorder style={{ overflowX: "auto" }}>
          <Title order={3}>Planned vs Actual — {year}</Title>
          {renderPlannedActual("expense")}
          {renderPlannedActual("income")}
        </Card>
        <Card withBorder component="section" aria-label="Monthly budget comparison">
          <Title order={3}>Planned vs Actual by Month</Title>
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(value) => `$${value}`} />
              <ChartTooltip formatter={(value) => money(Number(value) * 100)} />
              <Legend />
              <Bar
                dataKey="plannedExpenses"
                name="Planned expenses"
                fill="#e03131"
              />
              <Bar
                dataKey="actualExpenses"
                name="Actual expenses"
                fill="#ff8787"
              />
              <Bar
                dataKey="plannedIncome"
                name="Planned income"
                fill="#2f9e44"
              />
              <Bar dataKey="actualIncome" name="Actual income" fill="#69db7c" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card withBorder component="section" aria-label="Monthly budget trends">
          <Title order={3}>Planned vs Actual — Cumulative by Month</Title>
          <Text size="sm" c="dimmed" mb="md">
            Year-to-date totals from January through each month across all
            categories for {year}. Dashed lines show planned amounts; solid
            lines show actual amounts. Expenses are shown as positive values.
          </Text>
          <ResponsiveContainer width="100%" height={360}>
            <LineChart
              data={cumulativeChartData}
              accessibilityLayer
              margin={{ top: 12, right: 16, bottom: 8, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(value) => `$${value}`} />
              <ChartTooltip formatter={(value) => money(Number(value) * 100)} />
              <Legend />
              <Line
                dataKey="plannedExpenses"
                name="Planned expenses"
                stroke="#e03131"
                strokeWidth={2}
                strokeDasharray="6 4"
                isAnimationActive={false}
              />
              <Line
                dataKey="actualExpenses"
                name="Actual expenses"
                stroke="#ff8787"
                strokeWidth={2}
                isAnimationActive={false}
              />
              <Line
                dataKey="plannedIncome"
                name="Planned income"
                stroke="#2f9e44"
                strokeWidth={2}
                strokeDasharray="6 4"
                isAnimationActive={false}
              />
              <Line
                dataKey="actualIncome"
                name="Actual income"
                stroke="#69db7c"
                strokeWidth={2}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Modal
          opened={copyYearOpen}
          onClose={() => { if (!budgetBusy) setCopyYearOpen(false); }}
          title="Copy budget to next year"
          centered
          closeOnClickOutside={!budgetBusy}
          closeOnEscape={!budgetBusy}
          withCloseButton={!budgetBusy}
        >
          <Stack>
            <Text>Copy all {lines.length} income and expense lines for {account.name} from {year} to {year + 1}?</Text>
            <Text size="sm">Names, categories and all twelve monthly amounts will be copied. Entered checkmarks will be reset. If {year + 1} already has budget lines, nothing will be copied or overwritten.</Text>
            {error && <Text c="red">{error}</Text>}
            <Group justify="flex-end">
              <Button variant="default" disabled={budgetBusy} onClick={() => setCopyYearOpen(false)}>Cancel</Button>
              <Button loading={budgetBusy} onClick={() => void runBudgetAction(async () => {
                const result = await api<{ targetYear: number; copiedCount: number }>(`/accounts/${budgetAccountId}/budget/copy-next-year`, {
                  method: 'POST', body: JSON.stringify({ sourceYear: year, confirmed: true }),
                });
                setCopyYearOpen(false);
                setBudgetNotice(`Copied ${result.copiedCount} lines to ${result.targetYear}. Entered checkmarks have been reset.`);
                setYear(result.targetYear);
              })}>Confirm copy to {year + 1}</Button>
            </Group>
          </Stack>
        </Modal>
        <Modal
          opened={Boolean(deletingLine)}
          onClose={() => setDeletingLine(null)}
          title="Delete budget line"
          centered
        >
          <Stack>
            <Text>
              Delete “{deletingLine?.name}”? Historical data will be retained.
              This action cannot be undone.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDeletingLine(null)}>
                Cancel
              </Button>
              <Button color="red" loading={budgetBusy} onClick={() => void runBudgetAction(deleteLine)}>
                Delete budget line
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </Container>
  );
}

function Reconciliation({
  account,
  accounts,
  categories,
  onAccountChange,
  onChanged,
}: {
  account: Account;
  accounts: Account[];
  categories: Category[];
  onAccountChange: (accountId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const load = async (preserveSelection = false) => {
    setLoading(true);
    try {
      setError("");
      setLoadFailed(false);
      const result = await api<{ transactions: Transaction[] }>(
        `/accounts/${account.id}/reconciliation`,
      );
      setTransactions(result.transactions);
      setSelectedIds((current) =>
        preserveSelection
          ? current.filter((id) =>
              result.transactions.some((transaction) => transaction.id === id),
            )
          : [],
      );
    } catch (err) {
      setError((err as Error).message);
      setLoadFailed(true);
      setTransactions([]);
      setSelectedIds([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [account.id]);
  const selected = transactions.filter((transaction) =>
    selectedIds.includes(transaction.id),
  );
  const selectedTotal = selected.reduce(
    (sum, transaction) => sum + Number(transaction.amount_cents),
    0,
  );
  const selectedDebits = selected
    .filter((transaction) => Number(transaction.amount_cents) < 0)
    .reduce((sum, transaction) => sum + Number(transaction.amount_cents), 0);
  const selectedCredits = selected
    .filter((transaction) => Number(transaction.amount_cents) > 0)
    .reduce((sum, transaction) => sum + Number(transaction.amount_cents), 0);
  const preview = Number(account.reconciled_balance_cents) + selectedTotal;
  const allSelected =
    transactions.length > 0 && selectedIds.length === transactions.length;
  const writable = account.is_active && account.permission !== "viewer";
  const mutationBlocked = loading || refreshing || saving || deletingBusy || entryOpen || Boolean(deleting) || loadFailed;
  const refreshAfterMutation = async () => {
    setRefreshing(true);
    try { await load(true); await onChanged(); }
    catch (err) { setError((err as Error).message); setLoadFailed(true); }
    finally { setRefreshing(false); }
  };
  const confirmDelete = async () => {
    if (!deleting || deletingBusy) return;
    setDeletingBusy(true);
    setDeleteError("");
    try {
      await api(`/transactions/${deleting.id}`, { method: "DELETE" });
      setSelectedIds(current => current.filter(id => id !== deleting.id));
      setDeleting(null);
      await refreshAfterMutation();
    } catch (err) { setDeleteError((err as Error).message); }
    finally { setDeletingBusy(false); }
  };
  const reconcile = async () => {
    if (!writable || mutationBlocked || !selectedIds.length) return;
    try {
      setSaving(true);
      setError("");
      await api(`/accounts/${account.id}/reconciliation`, {
        method: "POST",
        body: JSON.stringify({ transactionIds: selectedIds, confirmed: true }),
      });
      setConfirmOpen(false);
      await load();
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group justify="space-between" align="end">
          <div>
            <Text c="dimmed">Reconciliation / {account.name}</Text>
            <Title order={1}>Reconcile transactions</Title>
          </div>
          {account.is_active && account.permission !== "viewer" && (
            <Button
              leftSection={<IconPlus size={16} />}
              disabled={loading || refreshing || saving || deletingBusy}
              onClick={() => { setEditing(null); setEntryOpen(true); }}
            >
              Add transaction
            </Button>
          )}
          <Select
            label="Account"
            data={accounts.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
            value={account.id}
            onChange={(value) => value && onAccountChange(value)}
            searchable
            w={240}
          />
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Current reconciled balance
            </Text>
            <Title>{money(account.reconciled_balance_cents)}</Title>
            <Text size="sm" c="dimmed">
              Preview after selection: {money(preview)}
            </Text>
          </Card>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Selected transactions
            </Text>
            <Title>{selectedIds.length}</Title>
          </Card>
        </SimpleGrid>
        <Group justify="space-between">
          <Group>
            <Button
              variant="light"
              onClick={() =>
                setSelectedIds(
                  allSelected
                    ? []
                    : transactions.map((transaction) => transaction.id),
                )
              }
              disabled={!transactions.length || mutationBlocked}
            >
              {allSelected ? "Clear selection" : "Select all visible"}
            </Button>
            <Button
              variant="subtle"
              onClick={() => setSelectedIds([])}
              disabled={!selectedIds.length || mutationBlocked}
            >
              Clear selection
            </Button>
          </Group>
          <Button
            disabled={!selectedIds.length || !writable || mutationBlocked}
            onClick={() => setConfirmOpen(true)}
          >
            Save and reconcile
          </Button>
        </Group>
        {error && <Text c="red">{error}</Text>}
        {loadFailed && <Button variant="light" onClick={() => void refreshAfterMutation()}>Retry</Button>}
        <Card withBorder p={0} style={{ overflowX: "auto" }}>
          <Table striped highlightOnHover miw={850}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Select</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Description</Table.Th>
                <Table.Th>Category</Table.Th>
                <Table.Th ta="right">Amount</Table.Th>
                <Table.Th ta="right">Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {loading ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Center>
                      <Loader size="sm" />
                    </Center>
                  </Table.Td>
                </Table.Tr>
              ) : transactions.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text ta="center" c="dimmed" py="xl">
                      {loadFailed ? "Transactions could not be loaded." : "No unreconciled posted transactions."}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                transactions.map((transaction) => (
                  <Table.Tr
                    key={transaction.id}
                    style={
                      selectedIds.includes(transaction.id)
                        ? { backgroundColor: "var(--mantine-color-blue-light)" }
                        : undefined
                    }
                  >
                    <Table.Td>
                      <input
                        aria-label={`Select ${transaction.description}`}
                        type="checkbox"
                        disabled={mutationBlocked}
                        checked={selectedIds.includes(transaction.id)}
                        onChange={() =>
                          setSelectedIds((current) =>
                            current.includes(transaction.id)
                              ? current.filter((id) => id !== transaction.id)
                              : [...current, transaction.id],
                          )
                        }
                      />
                    </Table.Td>
                    <Table.Td>{dateOnly(transaction.occurred_on)}</Table.Td>
                    <Table.Td>{transaction.description}</Table.Td>
                    <Table.Td>
                      <Badge variant="light">{transaction.category_name}</Badge>
                    </Table.Td>
                    <Table.Td
                      ta="right"
                      className={
                        Number(transaction.amount_cents) < 0
                          ? "amount-debit"
                          : "amount-credit"
                      }
                    >
                      {money(transaction.amount_cents)}
                    </Table.Td>
                    <Table.Td ta="right">
                      {canEditTransaction(account, transaction) && (
                        <ActionIcon
                          aria-label={`Edit ${transaction.description}`}
                          variant="subtle"
                          disabled={refreshing || saving || deletingBusy}
                          onClick={() => { setEditing(transaction); setEntryOpen(true); }}
                        ><IconPencil size={16} /></ActionIcon>
                      )}
                      {canDeleteTransaction(account, transaction) && (
                        <ActionIcon
                          aria-label={`Delete ${transaction.description}`}
                          color="red"
                          variant="subtle"
                          disabled={refreshing || saving || deletingBusy}
                          onClick={() => { setDeleteError(""); setDeleting(transaction); }}
                        ><IconTrash size={16} /></ActionIcon>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </Card>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Selected total
            </Text>
            <Text fw={700}>{money(selectedTotal)}</Text>
          </Card>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Selected debits
            </Text>
            <Text fw={700} c="red">
              {money(selectedDebits)}
            </Text>
          </Card>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Selected credits
            </Text>
            <Text fw={700} c="green">
              {money(selectedCredits)}
            </Text>
          </Card>
        </SimpleGrid>
        <Modal
          opened={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title="Confirm reconciliation"
          centered
        >
          <Stack>
            <Text>
              Reconcile {selectedIds.length} selected transaction
              {selectedIds.length === 1 ? "" : "s"}? This action cannot be
              undone.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button loading={saving} onClick={() => void reconcile()}>
                Confirm and save
              </Button>
            </Group>
          </Stack>
        </Modal>
        <Modal
          opened={entryOpen}
          onClose={() => { setEntryOpen(false); setEditing(null); }}
          title={editing ? "Edit transaction" : "Add transaction"}
          size="lg"
        >
          <TransactionForm
            account={account}
            categories={categories}
            transaction={editing}
            onSaved={async () => {
              if (editing) setSelectedIds(current => current.filter(id => id !== editing.id));
              setEntryOpen(false);
              setEditing(null);
              await refreshAfterMutation();
            }}
          />
        </Modal>
        <Modal
          opened={Boolean(deleting)}
          onClose={() => { if (!deletingBusy) setDeleting(null); }}
          closeOnEscape={!deletingBusy}
          closeOnClickOutside={!deletingBusy}
          withCloseButton={!deletingBusy}
          title="Delete transaction"
          centered
        >
          <Stack>
            <Text>Delete “{deleting?.description}”? This transaction will be removed from the ledger.</Text>
            {deleteError && <Text c="red" role="alert">{deleteError}</Text>}
            <Group justify="flex-end">
              <Button variant="default" disabled={deletingBusy} onClick={() => setDeleting(null)}>Cancel</Button>
              <Button color="red" loading={deletingBusy} onClick={() => void confirmDelete()}>Delete transaction</Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </Container>
  );
}

type BulkEntry = {
  id: string;
  kind: "debit" | "credit";
  occurredOn: string;
  amount: string;
  description: string;
  categoryId: string | null;
  identifier: string;
  notes: string;
};
// UI-only draft keys; never persisted or used as security identifiers.
let nextBulkEntryId = 0;
const newBulkEntry = (): BulkEntry => ({
  id: `bulk-row-${++nextBulkEntryId}`,
  kind: "debit",
  occurredOn: today(),
  amount: "",
  description: "",
  categoryId: null,
  identifier: "",
  notes: "",
});

function BulkTransactions({
  account,
  accounts,
  categories,
  onSaved,
  onDirtyChange,
  onAccountChange,
}: {
  account: Account;
  accounts: Account[];
  categories: Category[];
  onSaved: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onAccountChange: (id: string) => void;
}) {
  const accountId = account.id;
  const [entries, setEntries] = useState<BulkEntry[]>(() => [newBulkEntry()]);
  const batchAttempt = useRef<{ payload: string; requestId: string } | null>(null);
  const saveInFlight = useRef(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const activeAccounts = accounts.filter((item) => item.is_active);
  const categoryOptions = categories
    .filter((category) => !category.is_archived)
    .map((category) => ({ value: category.id, label: category.name }));
  useEffect(() => {
    onDirtyChange(
      entries.some((entry) =>
        Boolean(
          entry.amount ||
          entry.description.trim() ||
          entry.categoryId ||
          entry.identifier.trim() ||
          entry.notes.trim() ||
          entry.occurredOn !== today(),
        ),
      ),
    );
  }, [entries, onDirtyChange]);
  const update = (id: string, changes: Partial<BulkEntry>) =>
    setEntries((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, ...changes } : entry,
      ),
    );
  const save = async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    try {
      setError("");
      setSaving(true);
      if (entries.length > 500) throw new Error("Save at most 500 rows at a time");
      const transactions = entries.map((entry, index) => {
        const row = `Row ${index + 1}: `;
        if (!entry.categoryId) throw new Error(row + "Choose a category");
        if (!/^\d+\.\d{2}$/.test(entry.amount))
          throw new Error(row + "Enter an amount with exactly two decimal places");
        const cents = Math.round(Number(entry.amount) * 100);
        if (!Number.isSafeInteger(cents) || cents <= 0)
          throw new Error(row + "Enter an amount greater than zero within the supported range");
        if (!entry.description.trim() || entry.description.trim().length > 500)
          throw new Error(row + "Enter a description of 1–500 characters");
        const date = new Date(entry.occurredOn);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.occurredOn) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== entry.occurredOn)
          throw new Error(row + "Enter a valid transaction date");
        if (entry.identifier.length > 255 || entry.notes.length > 5000)
          throw new Error(row + "Identifier or notes exceeds the allowed length");
        return {
          occurredOn: entry.occurredOn,
          amountCents: entry.kind === "debit" ? -cents : cents,
          description: entry.description.trim(),
          categoryId: entry.categoryId,
          identifier: entry.identifier || undefined,
          notes: entry.notes || undefined,
        };
      });
      const payload = JSON.stringify({ accountId, transactions });
      if (batchAttempt.current?.payload !== payload) {
        // Correlation ID only, not a security token; works without randomUUID.
        batchAttempt.current = { payload, requestId: `bulk-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}` };
      }
      await api(`/accounts/${accountId}/transactions/bulk`, {
        method: "POST",
        body: JSON.stringify({ requestId: batchAttempt.current.requestId, transactions }),
      });
      // The commit succeeded: never leave saved rows in the draft if refetch fails.
      setEntries([newBulkEntry()]);
      batchAttempt.current = null;
      onDirtyChange(false);
      try { await onSaved(); }
      catch { setError("All transactions were saved, but balances could not be refreshed. Reload the page; do not re-enter the batch."); }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
      saveInFlight.current = false;
    }
  };
  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <Group justify="space-between" align="end">
          <div>
            <Text c="dimmed">Transactions</Text>
            <Title order={1}>Bulk add transactions</Title>
            <Text c="dimmed">
              Enter multiple posted transactions quickly. Reconciliation is
              completed from the account ledger.
            </Text>
          </div>
          <Select
            label="Account"
            data={activeAccounts.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
            value={accountId}
            disabled={saving}
            onChange={(value) => value && onAccountChange(value)}
            searchable
            w={240}
          />
        </Group>
        <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Card withBorder p={0} style={{ overflowX: "auto" }}>
          <Table miw={1120} verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Type</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Amount</Table.Th>
                <Table.Th>Description</Table.Th>
                <Table.Th>Category</Table.Th>
                <Table.Th>Identifier</Table.Th>
                <Table.Th>Notes</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map((entry) => (
                <Table.Tr key={entry.id}>
                  <Table.Td>
                    <Group gap={4}>
                      <Button
                        size="compact-xs"
                        color="red"
                        variant={entry.kind === "debit" ? "filled" : "light"}
                        onClick={() => update(entry.id, { kind: "debit" })}
                      >
                        Debit
                      </Button>
                      <Button
                        size="compact-xs"
                        color="green"
                        variant={entry.kind === "credit" ? "filled" : "light"}
                        onClick={() => update(entry.id, { kind: "credit" })}
                      >
                        Credit
                      </Button>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <TextInput
                      aria-label="Transaction date"
                      type="date"
                      value={entry.occurredOn}
                      onChange={(event) =>
                        update(entry.id, {
                          occurredOn: event.currentTarget.value,
                        })
                      }
                      w={135}
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      aria-label="Transaction amount"
                      prefix="$"
                      value={entry.amount}
                      onChange={(value) =>
                        update(entry.id, { amount: String(value) })
                      }
                      onBlur={() =>
                        entry.amount &&
                        update(entry.id, {
                          amount: Number(entry.amount).toFixed(2),
                        })
                      }
                      decimalScale={2}
                      fixedDecimalScale
                      allowDecimal
                      allowNegative={false}
                      hideControls
                      placeholder="0.00"
                      w={110}
                    />
                  </Table.Td>
                  <Table.Td>
                    <TextInput
                      aria-label="Transaction description"
                      value={entry.description}
                      onChange={(event) =>
                        update(entry.id, {
                          description: event.currentTarget.value,
                        })
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <Select
                      aria-label="Transaction category"
                      data={categoryOptions}
                      value={entry.categoryId}
                      onChange={(value) =>
                        update(entry.id, { categoryId: value })
                      }
                      searchable
                      nothingFoundMessage="No matching categories"
                      w={170}
                    />
                  </Table.Td>
                  <Table.Td>
                    <TextInput
                      aria-label="Transaction identifier"
                      value={entry.identifier}
                      onChange={(event) =>
                        update(entry.id, {
                          identifier: event.currentTarget.value,
                        })
                      }
                      w={130}
                    />
                  </Table.Td>
                  <Table.Td>
                    <TextInput
                      aria-label="Transaction notes"
                      value={entry.notes}
                      onChange={(event) =>
                        update(entry.id, { notes: event.currentTarget.value })
                      }
                      w={160}
                    />
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon
                      aria-label="Remove transaction row"
                      color="red"
                      variant="subtle"
                      disabled={entries.length === 1}
                      onClick={() =>
                        setEntries((current) =>
                          current.filter((item) => item.id !== entry.id),
                        )
                      }
                    >
                      <IconX size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
        </fieldset>
        <Group>
          <Button
            variant="light"
            disabled={saving || entries.length >= 500}
            leftSection={<IconPlus size={16} />}
            onClick={() =>
              setEntries((current) => [...current, newBulkEntry()])
            }
          >
            Add row
          </Button>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Projected current balance
            </Text>
            <Text fw={700}>
              {money(
                Number(
                  activeAccounts.find((item) => item.id === accountId)
                    ?.current_balance_cents ?? 0,
                ) +
                  entries.reduce((sum, entry) => {
                    const cents = Number(entry.amount);
                    return Number.isFinite(cents)
                      ? sum +
                          (entry.kind === "debit"
                            ? -Math.abs(Math.round(cents * 100))
                            : Math.abs(Math.round(cents * 100)))
                      : sum;
                  }, 0),
              )}
            </Text>
          </Card>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Total debits
            </Text>
            <Text fw={700} c="red">
              {money(
                entries.reduce((sum, entry) => {
                  const cents = Number(entry.amount);
                  return Number.isFinite(cents) && entry.kind === "debit"
                    ? sum - Math.abs(Math.round(cents * 100))
                    : sum;
                }, 0),
              )}
            </Text>
          </Card>
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Total credits
            </Text>
            <Text fw={700} c="green">
              {money(
                entries.reduce((sum, entry) => {
                  const cents = Number(entry.amount);
                  return Number.isFinite(cents) && entry.kind === "credit"
                    ? sum + Math.abs(Math.round(cents * 100))
                    : sum;
                }, 0),
              )}
            </Text>
          </Card>
        </SimpleGrid>
        <Group justify="flex-end">
          <Text c="red" size="sm">
            {error}
          </Text>
          <Button loading={saving} onClick={() => void save()}>
            Save all transactions
          </Button>
        </Group>
      </Stack>
    </Container>
  );
}

export function App({
  theme,
  onThemeChange,
}: {
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [bulkDirty, setBulkDirty] = useState(false);
  const { path, route, navigate } = useRoute(bulkDirty);
  const go = (url: string) => {
    navigate(url);
    setMobileOpen(false);
  };
  const load = async () => {
    setError("");
    try {
      const session = await api<{ user: User }>("/auth/session");
      setUser(session.user);
    } catch {
      setUser(null);
      setAccounts([]);
      setCategories([]);
      setLoading(false);
      return;
    }
    try {
      const [a, c] = await Promise.all([
        api<{ accounts: Account[] }>("/accounts"),
        api<{ categories: Category[] }>("/categories"),
      ]);
      setAccounts(a.accounts);
      setCategories(c.categories);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    setBulkDirty(false);
  }, [path]);
  useEffect(() => {
    if (!bulkDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [bulkDirty]);
  const selected =
    (route.screen === "budget" || route.screen === "forecast") && route.accountId === "all"
      ? accounts[0]
      : accounts.find((a) => a.id === route.accountId);
  const fallback = selected ?? accounts.find((a) => a.is_active) ?? accounts[0];
  const accountPath = (screen: string, id = fallback?.id) =>
    id ? "/accounts/" + id + "/" + screen : "/settings/accounts";
  const nav = (label: string, url: string, icon: React.ReactNode) => (
    <Tooltip key={label} label={label} disabled={!collapsed} position="right">
      <NavLink
        component="a"
        href={url}
        aria-label={label}
        active={path === url}
        label={collapsed ? undefined : label}
        leftSection={icon}
        onClick={(event) => {
          if (
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.altKey &&
            event.button === 0
          ) {
            event.preventDefault();
            go(url);
          }
        }}
      />
    </Tooltip>
  );
  if (loading)
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  if (!user) return <Auth onUser={() => void load()} />;
  const usernameParts = user.email
    .split("@")[0]
    .split(/[._+\-]+/)
    .filter(Boolean);
  const initials = (
    usernameParts.length > 1
      ? usernameParts[0][0] + usernameParts[usernameParts.length - 1][0]
      : (usernameParts[0] ?? "?").slice(0, 2)
  ).toUpperCase();
  let content: React.ReactNode;
  if (error)
    content = (
      <Container py="xl">
        <Text role="alert" c="red">
          {error}
        </Text>
        <Button onClick={() => void load()}>Retry</Button>
      </Container>
    );
  else if (route.screen === "home")
    content = <Home accounts={accounts} navigate={go} />;
  else if (route.screen === "settings")
    content = (
      <Settings
        tab={route.tab!}
        accounts={accounts}
        categories={categories}
        theme={theme}
        onThemeChange={onThemeChange}
        navigate={go}
        onChanged={load}
      />
    );
  else if (route.screen === "transfer")
    content = (
      <Container size="sm" py="xl">
        <Title order={1} mb="lg">
          Transfer funds
        </Title>
        <TransferForm
          accounts={accounts}
          onSaved={async () => {
            await load();
            go("/");
          }}
        />
      </Container>
    );
  else if (!selected)
    content = (
      <Container py="xl">
        <Title order={1}>Page unavailable</Title>
        <Text>
          The page or account could not be found or is not accessible.
        </Text>
        <Button mt="md" onClick={() => go("/")}>
          Go home
        </Button>
      </Container>
    );
  else {
    const changeAccount = (id: string) => go(accountPath(route.screen, id));
    if (route.screen === "analysis")
      content = (
        <Analysis
          key={selected.id}
          account={selected}
          accounts={accounts}
          categories={categories}
          onAccountChange={changeAccount}
        />
      );
    else if (route.screen === "forecast")
      content = <ForecastScreen key={`${route.accountId}/${route.month}`} accounts={accounts} scopeId={route.accountId!} month={route.month!} navigate={go} />;
    else if (route.screen === "budget")
      content = (
        <Budget
          key={route.accountId}
          scopeId={route.accountId!}
          account={selected}
          accounts={accounts}
          categories={categories}
          onAccountChange={changeAccount}
        />
      );
    else if (route.screen === "reconcile")
      content = (
        <Reconciliation
          key={selected.id}
          account={selected}
          accounts={accounts}
          categories={categories}
          onAccountChange={changeAccount}
          onChanged={load}
        />
      );
    else if (route.screen === "bulk")
      content = (
        <BulkTransactions
          key={selected.id}
          account={selected}
          accounts={accounts}
          categories={categories}
          onAccountChange={changeAccount}
          onSaved={load}
          onDirtyChange={setBulkDirty}
        />
      );
    else
      content = (
        <Ledger
          key={selected.id}
          account={selected}
          categories={categories}
          refreshAccounts={load}
        />
      );
  }
  return (
    <AppShell
      header={{ height: 56, collapsed: false, offset: true }}
      navbar={{
        width: collapsed ? 76 : 250,
        breakpoint: "sm",
        collapsed: { mobile: !mobileOpen },
      }}
      padding={0}
    >
      <AppShell.Header>
        <Group h="100%" px="md">
          <Burger
            opened={mobileOpen}
            onClick={() => setMobileOpen(!mobileOpen)}
            hiddenFrom="sm"
            aria-label="Toggle navigation"
          />
          <Title order={3}>Finance Manager</Title>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar
        p={collapsed ? "xs" : "md"}
        style={{ overflow: "hidden" }}
      >
        <ActionIcon
          visibleFrom="sm"
          mb="md"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          variant="subtle"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <IconChevronRight size={18} />
          ) : (
            <IconChevronLeft size={18} />
          )}
        </ActionIcon>
        <Stack gap="xs" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {nav("Home", "/", <IconLayoutDashboard size={18} />)}
          {accounts.map((a) =>
            nav(a.name, accountPath("ledger", a.id), <IconWallet size={18} />),
          )}
          {nav("Bulk add", accountPath("bulk"), <IconReceipt size={18} />)}
          {nav("Reconcile", accountPath("reconcile"), <IconCheck size={18} />)}
          {nav("Xfer Funds", "/transfer", <IconArrowsLeftRight size={18} />)}
          {nav("Budget", accountPath("budget"), <IconReportMoney size={18} />)}
          {nav("Budget & forecast", accountPath(`forecast/${route.screen === 'forecast' ? route.month : new Date().toISOString().slice(0, 7)}`, route.screen === 'forecast' ? route.accountId : fallback?.id), <IconChartLine size={18} />)}
          {nav("Analysis", accountPath("analysis"), <IconChartBar size={18} />)}
          {nav("Settings", "/settings/general", <IconSettings size={18} />)}
        </Stack>
        <Stack gap="xs" pt="md" style={{ flexShrink: 0 }}>
          <Group
            gap="sm"
            wrap="nowrap"
            justify={collapsed ? "center" : undefined}
          >
            <Tooltip label={user.email} position="right">
              <Avatar
                radius="xl"
                color="blue"
                size={36}
                role="img"
                aria-label={`Signed in as ${user.email}`}
                style={{ flexShrink: 0 }}
              >
                {initials}
              </Avatar>
            </Tooltip>
            {!collapsed && (
              <Text size="sm" truncate title={user.email}>
                {user.email}
              </Text>
            )}
          </Group>
          <Button
            variant="subtle"
            aria-label="Sign out"
            leftSection={<IconLogout size={16} />}
            onClick={async () => {
              if (bulkDirty && !window.confirm("Discard unsaved transactions?"))
                return;
              try {
                await api("/auth/logout", { method: "POST" });
                setBulkDirty(false);
                setUser(null);
                setAccounts([]);
                setCategories([]);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            {collapsed ? undefined : "Sign out"}
          </Button>
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>{content}</AppShell.Main>
    </AppShell>
  );
}
