import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHAINS, evmClients } from "../src/shared/evm";

describe("CHAINS", () => {
  it("signs for the chains the contracts are deployed on (Galileo 16602, Hedera testnet 296)", () => {
    // export_deployments.py checks the chain id of each deployment: 296 for Hedera, 16602 for 0G Galileo.
    const exporter = readFileSync("../chain/script/export_deployments.py", "utf8");
    expect(exporter).toContain(`(${CHAINS.zeroG.chain.id}, "Deploy0G.s.sol"`);
    expect(exporter).toContain(`(${CHAINS.hedera.chain.id}, "DeployHedera.s.sol"`);
    expect(CHAINS.zeroG.chain.id).toBe(16602);
  });
});

describe("evmClients", () => {
  it("waits long enough for Hashio, whose eth_sendRawTransaction returns only after consensus (20 to 40 s)", () => {
    const clients = evmClients(CHAINS.hedera.chain, CHAINS.hedera.rpc, `0x${"11".repeat(32)}`);
    expect(clients.wallet.transport.timeout).toBeGreaterThanOrEqual(120_000);
    expect(clients.public.transport.timeout).toBeGreaterThanOrEqual(120_000);
  });
});
