import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Container,
  Group,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconCheck, IconPencil, IconPlus, IconX } from "@tabler/icons-react";
import { api, type Account, type Category } from "./api";

export function AccountForm({
  onCreated,
}: {
  onCreated: (account: Account) => void;
}) {
  const [name, setName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [starting, setStarting] = useState("0.00");
  const [error, setError] = useState("");
  const save = async () => {
    try {
      const account = await api<{ account: Account }>("/accounts", {
        method: "POST",
        body: JSON.stringify({
          name,
          accountNumber,
          startingBalanceCents: Math.round(Number(starting) * 100),
        }),
      });
      onCreated(account.account);
      setName("");
      setAccountNumber("");
      setStarting("0.00");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Card withBorder>
      <Stack>
        <Title order={3}>Add account</Title>
        <TextInput
          label="Account name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <TextInput
          label="Account number"
          inputMode="numeric"
          value={accountNumber}
          onChange={(e) =>
            setAccountNumber(e.currentTarget.value.replace(/\D/g, ""))
          }
        />
        <TextInput
          label="Starting balance"
          prefix="$"
          value={starting}
          onChange={(e) => setStarting(e.currentTarget.value)}
        />
        <Text c="red" size="sm">
          {error}
        </Text>
        <Button onClick={save}>Save account</Button>
      </Stack>
    </Card>
  );
}

export function CategorySettings({
  categories,
  onChanged,
}: {
  categories: Category[];
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState("");
  const create = async () => {
    try {
      setError("");
      await api("/categories", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setName("");
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const saveEdit = async (categoryId: string) => {
    try {
      setError("");
      await api(`/categories/${categoryId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editingName }),
      });
      setEditingId(null);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const toggle = async (category: Category) => {
    try {
      setError("");
      await api(`/categories/${category.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isArchived: !category.is_archived }),
      });
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Container size="md" py="xl">
      <Stack gap="xl">
        <Title order={2}>Categories</Title>
        <Card withBorder>
          <Group align="end">
            <TextInput
              label="New category"
              placeholder="e.g. Groceries"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
              flex={1}
            />
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => void create()}
              disabled={!name.trim()}
            >
              Create category
            </Button>
          </Group>
          <Text c="red" size="sm" mt="sm">
            {error}
          </Text>
        </Card>
        <Card withBorder p={0} style={{ overflowX: "auto" }}>
          <Table miw={520} verticalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Category</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th ta="right">Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {categories.map((category) => (
                <Table.Tr key={category.id}>
                  <Table.Td>
                    {editingId === category.id ? (
                      <TextInput
                        aria-label={`Edit ${category.name}`}
                        value={editingName}
                        onChange={(e) => setEditingName(e.currentTarget.value)}
                      />
                    ) : (
                      <Group gap="xs">
                        <Text>{category.name}</Text>
                        {category.is_system && (
                          <Badge size="xs" variant="light">
                            System
                          </Badge>
                        )}
                      </Group>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Switch
                      checked={!category.is_archived}
                      onChange={() => void toggle(category)}
                      disabled={category.is_system}
                      label={category.is_archived ? "Disabled" : "Enabled"}
                      aria-label={`${category.name} enabled`}
                    />
                  </Table.Td>
                  <Table.Td ta="right">
                    {category.is_system ? (
                      <Text c="dimmed" size="sm">
                        Protected
                      </Text>
                    ) : editingId === category.id ? (
                      <Group justify="end" gap="xs">
                        <ActionIcon
                          aria-label="Save category"
                          onClick={() => void saveEdit(category.id)}
                        >
                          <IconCheck size={16} />
                        </ActionIcon>
                        <ActionIcon
                          aria-label="Cancel category edit"
                          variant="subtle"
                          onClick={() => setEditingId(null)}
                        >
                          <IconX size={16} />
                        </ActionIcon>
                      </Group>
                    ) : (
                      <ActionIcon
                        aria-label={`Edit ${category.name}`}
                        variant="subtle"
                        onClick={() => {
                          setEditingId(category.id);
                          setEditingName(category.name);
                        }}
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
    </Container>
  );
}
