import { afterEach, describe, expect, it, vi } from "vitest";
import { brokerLedger, routerCredit, uncheckedCredit } from "../src/shared/zg-balance";
import { inferenceConfig, routerBalance } from "../src/shared/zg-inference";
import { shouldSkip } from "../src/worker/skip";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("inferenceConfig", () => {
  it("defaults to the Router on mainnet", () => {
    expect(inferenceConfig({ ZG_ROUTER_API_KEY: "sk-1" })).toEqual({
      kind: "router",
      routerUrl: "https://router-api.0g.ai/v1",
      apiKey: "sk-1",
      managementKey: undefined,
      mainnetRpcUrl: "https://evmrpc.0g.ai",
      timeoutMs: 180_000,
    });
  });

  it("reads the Router timeout in seconds and rejects a bad one", () => {
    expect(inferenceConfig({ ZG_ROUTER_API_KEY: "sk-1", ZG_ROUTER_TIMEOUT_SECONDS: "45" })).toMatchObject({ timeoutMs: 45_000 });
    expect(() => inferenceConfig({ ZG_ROUTER_API_KEY: "sk-1", ZG_ROUTER_TIMEOUT_SECONDS: "0" })).toThrow(/ZG_ROUTER_TIMEOUT_SECONDS/);
    expect(() => inferenceConfig({ ZG_ROUTER_API_KEY: "sk-1", ZG_ROUTER_TIMEOUT_SECONDS: "soon" })).toThrow(/ZG_ROUTER_TIMEOUT_SECONDS/);
  });

  it("takes the Router URL, management key and mainnet RPC from the environment", () => {
    expect(
      inferenceConfig({ ZG_INFERENCE: "router", ZG_ROUTER_API_KEY: "sk-1", ZG_ROUTER_URL: "http://r/v1", ZG_ROUTER_MANAGEMENT_KEY: "mk-1", ZG_MAINNET_RPC_URL: "http://rpc" }),
    ).toMatchObject({ routerUrl: "http://r/v1", managementKey: "mk-1", mainnetRpcUrl: "http://rpc" });
  });

  it("needs a Router API key, and does not echo other secrets in the error", () => {
    expect(() => inferenceConfig({ ZG_ROUTER_MANAGEMENT_KEY: "mk-secret" })).toThrow(/ZG_ROUTER_API_KEY/);
    expect(() => inferenceConfig({ ZG_ROUTER_MANAGEMENT_KEY: "mk-secret" })).not.toThrow(/mk-secret/);
  });

  it("selects the legacy broker on Galileo", () => {
    expect(inferenceConfig({ ZG_INFERENCE: "broker", WORKER_PRIVATE_KEY: "0xabc" })).toEqual({
      kind: "broker",
      rpcUrl: "https://evmrpc-testnet.0g.ai",
      privateKey: "0xabc",
    });
    expect(() => inferenceConfig({ ZG_INFERENCE: "broker" })).toThrow(/WORKER_PRIVATE_KEY/);
  });

  it("rejects an unknown adapter", () => {
    expect(() => inferenceConfig({ ZG_INFERENCE: "direct" })).toThrow(/"router" or "broker"/);
  });
});

describe("0G Compute balance sources", () => {
  it("reads the Router account balance with the management key, in 0G", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ address: "0x1", deposit_balance: "2000000000000000000", total_balance: "1500000000000000000" })));
    vi.stubGlobal("fetch", fetch);
    expect(await routerCredit({ url: "https://router.test/v1/", managementKey: "mk-1" })()).toBe(1.5);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://router.test/v1/account/balance");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer mk-1");
  });

  it("fails loudly when the Router refuses the balance read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("insufficient_scope", { status: 403 })));
    await expect(routerCredit({ url: "https://router.test/v1", managementKey: "mk-1" })()).rejects.toThrow(/403/);
  });

  it("reads the broker ledger in 0G", async () => {
    expect(await brokerLedger({ ledger: { getLedger: async () => ({ totalBalance: 3_000_000_000_000_000_000n }) } })()).toBe(3);
  });

  it("is unlimited, with one warning, when the balance cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const balance = uncheckedCredit("no key");
    expect(await balance()).toBe(Number.POSITIVE_INFINITY);
    await balance();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("uses the Router balance only when a management key is configured", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = inferenceConfig({ ZG_ROUTER_API_KEY: "sk-1" });
    if (config.kind !== "router") throw new Error("expected router");
    expect(await routerBalance(config)()).toBe(Number.POSITIVE_INFINITY);
  });

  it("feeds the skip rule: a Router balance below the Mission's maxSteps Decisions skips the Mission", () => {
    const verifiers = ["0x0000000000000000000000000000000000000001"] as const;
    const base = { missionVerifiers: verifiers, trustedVerifiers: verifiers, missionTask: "rover" as const, policyTask: "rover" as const, price: 1, maxBounty: 10, secondsLeftToBid: 60, hasUnfinishedWin: false, walletBalance: 10, stake: 1, txFees: 0.05, zeroGPerDecision: 0.0001, maxSteps: 60, limitsReachable: true };
    expect(shouldSkip({ ...base, zgBalance: 0.0059 })).toBe("ZG_BALANCE_CANNOT_COVER_EPISODE");
    expect(shouldSkip({ ...base, zgBalance: 0.006 })).toBeNull();
    expect(shouldSkip({ ...base, zgBalance: Number.POSITIVE_INFINITY })).toBeNull();
  });
});
