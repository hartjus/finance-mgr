import { test as base, expect } from "@playwright/test";
import type { Account } from "../apps/web/src/api";
export const checkingId = "22222222-2222-4222-8222-222222222222";
export const savingsId = "33333333-3333-4333-8333-333333333333";
export const test = base.extend<{
  finance: {
    accounts: Account[];
    authenticated: boolean;
    failAccounts: boolean;
  };
}>({
  finance: [
    async ({ page }, use) => {
      const account = {
        account_number_last_four: "1234",
        starting_balance_cents: "10000",
        current_balance_cents: "8750",
        reconciled_balance_cents: "10000",
        unreconciled_debits_cents: "-1250",
        unreconciled_credits_cents: "0",
        is_active: true,
        permission: "owner" as const,
      };
      const finance = {
        accounts: [
          { ...account, id: checkingId, name: "Checking" },
          {
            ...account,
            id: savingsId,
            name: "Savings",
            current_balance_cents: "-2500",
            reconciled_balance_cents: "0",
            is_active: false,
            permission: "viewer" as const,
          },
        ],
        authenticated: true,
        failAccounts: false,
      };
      const categories = [
        {
          id: "44444444-4444-4444-8444-444444444444",
          name: "Xfer Accounts",
          is_archived: false,
          is_system: true,
        },
      ];
      const transactions: Record<string, unknown>[] = [];
      await page.route("**/api/v1/**", async (route) => {
        const path = new URL(route.request().url()).pathname.replace(
          "/api/v1",
          "",
        );
        const method = route.request().method();
        const send = (json: unknown, status = 200) =>
          route.fulfill({ json, status });
        if (path === "/auth/setup-status")
          return send({ setupRequired: false });
        if (!finance.authenticated)
          return send({ title: "Sign in is required" }, 401);
        if (path === "/auth/session")
          return send({
            user: { id: "user", email: "owner@example.test", role: "admin" },
          });
        if (path === "/auth/logout") {
          finance.authenticated = false;
          return route.fulfill({ status: 204 });
        }
        if (path === "/accounts" && method === "GET")
          return finance.failAccounts
            ? send({ title: "Accounts temporarily unavailable" }, 503)
            : send({ accounts: finance.accounts });
        if (path === "/accounts" && method === "POST") {
          const input = route.request().postDataJSON();
          if (!input.name || !input.accountNumber)
            return send({ title: "Account name and number are required" }, 400);
          const created = {
            ...account,
            id: "55555555-5555-4555-8555-555555555555",
            name: input.name,
            current_balance_cents: input.startingBalanceCents,
            reconciled_balance_cents: input.startingBalanceCents,
          };
          finance.accounts.push(created);
          return send({ account: created }, 201);
        }
        if (path.startsWith("/accounts/") && method === "PATCH") {
          const current = finance.accounts.find((a) => path.endsWith(a.id));
          if (!current || current.permission !== "owner")
            return send({ title: "Forbidden" }, 403);
          const input = route.request().postDataJSON();
          if (input.name !== undefined) current.name = input.name;
          if (input.isActive !== undefined) current.is_active = input.isActive;
          return send({ account: current });
        }
        if (path === "/categories") {
          if (method === "POST")
            categories.push({
              ...categories[0],
              id: "new-category",
              name: route.request().postDataJSON().name,
              is_system: false,
            });
          return send({ categories });
        }
        if (path.endsWith("/ledger")) {
          const params = new URL(route.request().url()).searchParams;
          const pageSize = Number(params.get("pageSize") ?? 75);
          const rows = transactions.filter((t) =>
            path.includes(String(t.account_id)),
          );
          const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
          const page = Math.min(Number(params.get("page") ?? 1), totalPages);
          return send({
            transactions: rows.slice((page - 1) * pageSize, page * pageSize),
            pagination: {
              page,
              pageSize,
              totalItems: rows.length,
              totalPages,
              hasNextPage: page < totalPages,
              hasPreviousPage: page > 1,
            },
          });
        }
        if (path.endsWith("/reconciliation"))
          return send({
            transactions: transactions.filter((t) =>
              path.includes(String(t.account_id)),
            ),
          });
        if (path.endsWith("/analysis/monthly")) return send({ rows: [] });
        if (path.endsWith("/budget")) return send({ lines: [], actuals: [] });
        if (path.endsWith("/transactions") && method === "POST") {
          const input = route.request().postDataJSON();
          transactions.push({
            ...input,
            id: transactions.length
              ? `transaction-${transactions.length}`
              : "transaction",
            account_id: path.split("/")[2],
            occurred_on: input.occurredOn,
            amount_cents: input.amountCents,
            category_id: input.categoryId,
            category_name: "Xfer Accounts",
            status: "posted",
            reconciled_at: null,
            version: 1,
            running_balance_cents: 7516,
          });
          const account = finance.accounts.find(
            (a) => a.id === path.split("/")[2],
          );
          if (account)
            account.current_balance_cents =
              Number(account.current_balance_cents) + input.amountCents;
          return send({ transaction: transactions.at(-1) }, 201);
        }
        if (path === "/transactions/transaction" && method === "PATCH") {
          const input = route.request().postDataJSON();
          Object.assign(transactions[0], input, {
            occurred_on: input.occurredOn,
            amount_cents: input.amountCents,
            version: 2,
          });
          return send({ transaction: transactions[0] });
        }
        return send({ title: "Unexpected fixture request" }, 404);
      });
      await use(finance);
    },
    { auto: true },
  ],
});
export { expect };
