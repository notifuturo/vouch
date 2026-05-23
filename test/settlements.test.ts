import { describe, it, expect } from "vitest";
import {
  InMemorySettlementStore,
  D1SettlementStore,
  paymentIdFromHeaders,
} from "../src/db/settlements.js";

describe("InMemorySettlementStore.markIfNew", () => {
  it("returns true the first time and false on replay", async () => {
    const store = new InMemorySettlementStore();
    expect(await store.markIfNew("pay-1")).toBe(true);
    expect(await store.markIfNew("pay-1")).toBe(false);
    expect(await store.markIfNew("pay-2")).toBe(true);
  });
});

describe("D1SettlementStore.markIfNew", () => {
  // Mock D1 whose INSERT OR IGNORE reports changes=1 for a new id, 0 for a dup.
  function mockDb() {
    const seen = new Set<string>();
    return {
      prepare() {
        let boundId = "";
        const stmt = {
          bind(id: string) {
            boundId = id;
            return stmt;
          },
          async run() {
            const isNew = !seen.has(boundId);
            seen.add(boundId);
            return { meta: { changes: isNew ? 1 : 0 } };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;
  }

  it("maps changes=1 to new and changes=0 to replay", async () => {
    const store = new D1SettlementStore(mockDb());
    expect(await store.markIfNew("0xabc", "stripe.com")).toBe(true);
    expect(await store.markIfNew("0xabc", "stripe.com")).toBe(false);
  });

  it("treats a missing meta as not-new (fail safe — no double side effect)", async () => {
    const db = { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } as unknown as D1Database;
    expect(await new D1SettlementStore(db).markIfNew("x")).toBe(false);
  });
});

describe("paymentIdFromHeaders", () => {
  const h = (map: Record<string, string>) => (name: string) => map[name];

  it("returns null when no payment header is present", async () => {
    expect(await paymentIdFromHeaders(h({}))).toBeNull();
  });

  it("is stable for identical proofs and distinct for different ones", async () => {
    const a = await paymentIdFromHeaders(h({ "x-payment": "proof-A" }));
    const a2 = await paymentIdFromHeaders(h({ "x-payment": "proof-A" }));
    const b = await paymentIdFromHeaders(h({ "x-payment": "proof-B" }));
    expect(a).toBe(a2);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
  });

  it("prefers x-payment, then falls back to v2 headers", async () => {
    const v1 = await paymentIdFromHeaders(h({ "x-payment": "P", "payment-signature": "Q" }));
    const onlyV1 = await paymentIdFromHeaders(h({ "x-payment": "P" }));
    const v2 = await paymentIdFromHeaders(h({ "payment-signature": "Q" }));
    expect(v1).toBe(onlyV1); // x-payment wins when both present
    expect(v1).not.toBe(v2);
  });
});
