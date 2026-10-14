import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Container,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { AccountForm, CategorySettings } from "./settingsForms";
import { api, money, type Account, type Category } from "./api";
import type { SettingsTab } from "./routing";

export function Home({
  accounts,
  navigate,
}: {
  accounts: Account[];
  navigate: (path: string) => void;
}) {
  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <div>
          <Title order={1}>Home</Title>
          <Text c="dimmed">Your accounts at a glance</Text>
        </div>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Card withBorder>
            <Text c="dimmed">Accounts</Text>
            <Title order={2}>{accounts.length}</Title>
            <Text size="sm">
              {accounts.filter((a) => a.is_active).length} active
            </Text>
          </Card>
          <Card withBorder>
            <Text c="dimmed">Total current balance</Text>
            <Title order={2}>
              {money(
                accounts.reduce(
                  (sum, a) => sum + Number(a.current_balance_cents),
                  0,
                ),
              )}
            </Title>
          </Card>
          <Card withBorder>
            <Text c="dimmed">Total reconciled balance</Text>
            <Title order={2}>
              {money(
                accounts.reduce(
                  (sum, a) => sum + Number(a.reconciled_balance_cents),
                  0,
                ),
              )}
            </Title>
          </Card>
        </SimpleGrid>
        <Text size="sm" c="dimmed">
          Totals include all accessible accounts, including inactive accounts.
        </Text>
        {!accounts.length ? (
          <Card withBorder>
            <Stack>
              <Title order={2}>No accounts yet</Title>
              <Text>
                Create your first account in Settings → Accounts to begin
                tracking.
              </Text>
              <Button onClick={() => navigate("/settings/accounts")}>
                Manage accounts
              </Button>
            </Stack>
          </Card>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {accounts.map((account) => (
              <Card
                key={account.id}
                withBorder
                component="section"
                aria-label={account.name}
              >
                <Stack>
                  <Group justify="space-between">
                    <div>
                      <Title order={2} style={{ overflowWrap: "anywhere" }}>
                        {account.name}
                      </Title>
                      <Text c="dimmed">
                        •• {account.account_number_last_four}
                      </Text>
                    </div>
                    <Badge color={account.is_active ? "green" : "gray"}>
                      {account.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </Group>
                  <Group justify="space-between">
                    <div>
                      <Text size="sm" c="dimmed">
                        Current balance
                      </Text>
                      <Text fw={700}>
                        {money(account.current_balance_cents)}
                      </Text>
                    </div>
                    <div>
                      <Text size="sm" c="dimmed">
                        Reconciled balance
                      </Text>
                      <Text fw={700}>
                        {money(account.reconciled_balance_cents)}
                      </Text>
                    </div>
                  </Group>
                  <Button
                    variant="light"
                    onClick={() => navigate(`/accounts/${account.id}/ledger`)}
                  >
                    Open {account.name}
                  </Button>
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
        )}
      </Stack>
    </Container>
  );
}

export function Settings({
  tab,
  accounts,
  categories,
  theme,
  onThemeChange,
  navigate,
  onChanged,
}: {
  tab: SettingsTab;
  accounts: Account[];
  categories: Category[];
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
  navigate: (path: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const update = async (
    account: Account,
    changes: { name?: string; isActive?: boolean },
  ) => {
    setError("");
    setSaving(true);
    try {
      await api(`/accounts/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      setEditing(null);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Title order={1}>Settings</Title>
        <Tabs
          value={tab}
          onChange={(value) => value && navigate(`/settings/${value}`)}
          keepMounted={false}
        >
          <Tabs.List>
            <Tabs.Tab value="general">General</Tabs.Tab>
            <Tabs.Tab value="categories">Categories</Tabs.Tab>
            <Tabs.Tab value="accounts">Accounts</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="general" pt="lg">
            <Card withBorder>
              <Select
                label="Appearance"
                description="Choose how Finance Manager is displayed."
                data={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
                value={theme}
                onChange={(value) =>
                  value && onThemeChange(value as "light" | "dark")
                }
              />
            </Card>
          </Tabs.Panel>
          <Tabs.Panel value="categories" pt="lg">
            <CategorySettings categories={categories} onChanged={onChanged} />
          </Tabs.Panel>
          <Tabs.Panel value="accounts" pt="lg">
            <Stack>
              <Group justify="space-between">
                <Title order={2}>Accounts</Title>
                <Button onClick={() => setAdding(true)}>Add account</Button>
              </Group>
              {!accounts.length && (
                <Text c="dimmed">
                  No accounts yet. Add an account to begin tracking.
                </Text>
              )}
              {error && (
                <Text role="alert" c="red">
                  {error}
                </Text>
              )}
              {accounts.map((account) => (
                <Card withBorder key={account.id}>
                  <Stack>
                    <Group justify="space-between">
                      <div>
                        <Text fw={600} style={{ overflowWrap: "anywhere" }}>
                          {account.name}
                        </Text>
                        <Text c="dimmed" size="sm">
                          •• {account.account_number_last_four} ·{" "}
                          {account.is_active ? "Active" : "Inactive"} ·{" "}
                          {account.permission}
                        </Text>
                        <Text>{money(account.current_balance_cents)}</Text>
                      </div>
                      <Button
                        variant="light"
                        onClick={() =>
                          navigate(`/accounts/${account.id}/ledger`)
                        }
                      >
                        View {account.name}
                      </Button>
                    </Group>
                    {account.permission === "owner" && (
                      <Group>
                        <Button
                          variant="subtle"
                          onClick={() => {
                            setName(account.name);
                            setEditing(account);
                            setError("");
                          }}
                        >
                          Rename {account.name}
                        </Button>
                        <Button
                          variant="subtle"
                          disabled={saving}
                          onClick={() =>
                            void update(account, {
                              isActive: !account.is_active,
                            })
                          }
                        >
                          {account.is_active ? "Deactivate" : "Reactivate"}{" "}
                          {account.name}
                        </Button>
                      </Group>
                    )}
                  </Stack>
                </Card>
              ))}
            </Stack>
          </Tabs.Panel>
        </Tabs>
        <Modal
          opened={adding && tab === "accounts"}
          onClose={() => setAdding(false)}
          title="Add account"
        >
          <AccountForm
            onCreated={async () => {
              setAdding(false);
              await onChanged();
            }}
          />
        </Modal>
        <Modal
          opened={Boolean(editing) && tab === "accounts"}
          onClose={() => setEditing(null)}
          title="Rename account"
        >
          <Stack>
            <TextInput
              label="Account name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              maxLength={120}
            />
            {error && (
              <Text role="alert" c="red">
                {error}
              </Text>
            )}
            <Button
              loading={saving}
              disabled={!name.trim()}
              onClick={() =>
                editing && void update(editing, { name: name.trim() })
              }
            >
              Save name
            </Button>
          </Stack>
        </Modal>
      </Stack>
    </Container>
  );
}
