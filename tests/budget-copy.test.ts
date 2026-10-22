import { describe, expect, it, vi } from "vitest";
import {
  copyBudgetYear,
  copyJanuary,
  createBudgetLine,
} from "../apps/api/src/budget-copy";

const access = {
  rowCount: 1,
  rows: [{ is_active: true, permission: "editor" }],
};
const empty = { rowCount: 0, rows: [] };
describe("budget copy transactions", () => {
  it("copies saved January including zero and preserves checkmarks", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT account_id"))
        return { rowCount: 1, rows: [{ account_id: "account" }] };
      if (sql.includes("SELECT a.is_active")) return access;
      if (sql.startsWith("SELECT id"))
        return { rowCount: 1, rows: [{ id: "line" }] };
      if (sql.startsWith("SELECT amount_cents"))
        return { rowCount: 1, rows: [{ amount_cents: "0" }] };
      return empty;
    });
    await copyJanuary({ query } as never, "user", "line");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("generate_series(2,12)"),
      ["line", "0"],
    );
    const insert = query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO budget_line_months"),
    )![0];
    expect(insert).not.toContain("checked_at");
    expect(query).toHaveBeenLastCalledWith("COMMIT");
  });
  it("copies lines and twelve monthly amounts atomically with new IDs and reset checks", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(access)
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ copied_count: 2 }] })
      .mockResolvedValue(empty);
    expect(
      await copyBudgetYear({ query } as never, "user", "account", 2026),
    ).toEqual({ sourceYear: 2026, targetYear: 2027, copiedCount: 2 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WITH source AS MATERIALIZED"),
      ["account", 2026, 2027],
    );
    const insert = query.mock.calls.find(([sql]) =>
      sql.includes("WITH source"),
    )![0];
    expect(insert).toContain("gen_random_uuid()");
    expect(insert).toContain("generate_series(1,12)");
    expect(insert).not.toContain("checked_at");
    expect(query).toHaveBeenLastCalledWith("COMMIT");
  });
  it("refuses a nonempty destination and rolls back without copying", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(access)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValue(empty);
    await expect(
      copyBudgetYear({ query } as never, "user", "account", 2026),
    ).rejects.toMatchObject({ status: 409, code: "BUDGET_EXISTS" });
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT"))).toBe(
      false,
    );
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
  });
  it("rejects empty sources and invalid years", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(access)
      .mockResolvedValue(empty);
    await expect(
      copyBudgetYear({ query } as never, "user", "account", 2026),
    ).rejects.toMatchObject({ code: "EMPTY_BUDGET" });
    for (const year of [1899, 2200, 2026.5])
      await expect(
        copyBudgetYear({ query } as never, "user", "account", year),
      ).rejects.toMatchObject({ code: "INVALID_YEAR" });
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
  });
  it.each([
    { rows: [] },
    { rows: [{ permission: "viewer", is_active: true }] },
    { rows: [{ permission: "owner", is_active: false }] },
  ])("rejects missing or read-only membership", async ({ rows }) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce({ rowCount: rows.length, rows })
      .mockResolvedValue(empty);
    await expect(
      copyBudgetYear({ query } as never, "user", "account", 2026),
    ).rejects.toMatchObject({ code: rows.length ? "FORBIDDEN" : "NOT_FOUND" });
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(query).toHaveBeenCalledTimes(3);
  });
  it("rolls back year copying and ordinary line creation on database failure", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(access)
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValue(empty);
    await expect(
      copyBudgetYear({ query } as never, "user", "account", 2026),
    ).rejects.toThrow("synthetic failure");
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
    const createQuery = vi
      .fn()
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(access)
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "new" }] })
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValue(empty);
    await expect(
      createBudgetLine({ query: createQuery } as never, "user", "account", {
        year: 2026,
        lineType: "expense",
        name: "Test",
        categoryId: "cat",
      }),
    ).rejects.toThrow("synthetic failure");
    expect(createQuery).toHaveBeenLastCalledWith("ROLLBACK");
  });
});
