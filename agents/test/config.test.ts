import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { requesterSettings } from "../src/requester/config";
import { DEFAULT_WINDOWS } from "../src/requester/requester";
import { deploymentFromEnv, privateKeyFromEnv, verifiersFromEnv } from "../src/shared/config";
import { workerSettings } from "../src/worker/config";
import { policy } from "./fakes";

const accounts = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()));
const verifierEnv = {
  VERIFIER_URLS: "http://localhost:7101, http://localhost:7102,http://localhost:7103",
  VERIFIER_PUBKEYS: accounts.map((a) => a.publicKey).join(","),
};

function deploymentsDir(file: string, body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "dewo-deployments-"));
  writeFileSync(join(dir, file), JSON.stringify(body));
  return dir;
}

describe("verifiersFromEnv", () => {
  it("pairs URLs with public keys in order, deriving each address", () => {
    expect(verifiersFromEnv(verifierEnv)).toEqual(
      accounts.map((a, i) => ({ url: `http://localhost:710${i + 1}`, address: a.address, publicKey: a.publicKey })),
    );
  });

  it("accepts VERIFIER_ADDRESSES only when it matches the public keys, in order", () => {
    const addresses = accounts.map((a) => a.address.toLowerCase()).join(",");
    expect(verifiersFromEnv({ ...verifierEnv, VERIFIER_ADDRESSES: addresses })).toHaveLength(3);
    const swapped = [accounts[1], accounts[0], accounts[2]].map((a) => a!.address).join(",");
    expect(() => verifiersFromEnv({ ...verifierEnv, VERIFIER_ADDRESSES: swapped })).toThrow(/VERIFIER_ADDRESSES/);
  });

  it("needs exactly 3 Verifiers and well-formed public keys", () => {
    expect(() => verifiersFromEnv({ ...verifierEnv, VERIFIER_URLS: "http://a,http://b" })).toThrow(/VERIFIER_URLS/);
    expect(() => verifiersFromEnv({ ...verifierEnv, VERIFIER_PUBKEYS: "" })).toThrow(/VERIFIER_PUBKEYS/);
    expect(() => verifiersFromEnv({ ...verifierEnv, VERIFIER_PUBKEYS: "0x04,0x04,0x04" })).toThrow(/VERIFIER_PUBKEYS/);
  });
});

describe("deploymentFromEnv", () => {
  const address = "0x9aae6a883b4d16bf53fa6339c606d18b47342631";
  const dir = deploymentsDir("hedera-testnet.json", { address, deployBlock: 42734243, abi: [] });
  const spec = { addressVar: "MISSION_ESCROW_ADDRESS", blockVar: "MISSION_ESCROW_DEPLOY_BLOCK", file: "hedera-testnet.json" };

  it("reads address and deployBlock from chain/deployments", () => {
    expect(deploymentFromEnv({ CHAIN_DEPLOYMENTS_DIR: dir }, spec)).toEqual({ address, deployBlock: 42734243n });
  });

  it("keeps the file's deployBlock when the env names the same contract", () => {
    const env = { CHAIN_DEPLOYMENTS_DIR: dir, MISSION_ESCROW_ADDRESS: address.toUpperCase().replace("0X", "0x") };
    expect(deploymentFromEnv(env, spec).deployBlock).toBe(42734243n);
  });

  it("needs a deploy block for a contract the file does not describe", () => {
    const other = "0x00000000000000000000000000000000000000dd";
    expect(() => deploymentFromEnv({ CHAIN_DEPLOYMENTS_DIR: dir, MISSION_ESCROW_ADDRESS: other }, spec)).toThrow(/MISSION_ESCROW_DEPLOY_BLOCK/);
    expect(deploymentFromEnv({ CHAIN_DEPLOYMENTS_DIR: dir, MISSION_ESCROW_ADDRESS: other, MISSION_ESCROW_DEPLOY_BLOCK: "7" }, spec)).toEqual({
      address: other,
      deployBlock: 7n,
    });
  });

  it("says what to set when there is no deployment file", () => {
    expect(() => deploymentFromEnv({ CHAIN_DEPLOYMENTS_DIR: "/nonexistent" }, spec)).toThrow(/MISSION_ESCROW_ADDRESS/);
  });
});

describe("privateKeyFromEnv", () => {
  it("accepts a key with or without 0x and rejects anything else", () => {
    const key = generatePrivateKey();
    expect(privateKeyFromEnv({ K: key }, "K")).toBe(key);
    expect(privateKeyFromEnv({ K: key.slice(2) }, "K")).toBe(key);
    expect(() => privateKeyFromEnv({}, "K")).toThrow(/K/);
    expect(() => privateKeyFromEnv({ K: "0x1234" }, "K")).toThrow(/K/);
  });
});

describe("workerSettings", () => {
  const key = generatePrivateKey();
  const me = privateKeyToAccount(key);
  const dir = mkdtempSync(join(tmpdir(), "dewo-policy-"));
  const policyPath = join(dir, "careful.json");
  writeFileSync(policyPath, JSON.stringify(policy));
  const env = {
    ...verifierEnv,
    WORKER_PRIVATE_KEY: key,
    WORKER_POLICY: policyPath,
    WORKER_COST_PER_DECISION: "0.05",
    WORKER_EXPECTED_DECISIONS: "15",
    WORKER_TX_FEES: "0.05",
    WORKER_MARGIN: "1.6",
    WORKER_ZG_PER_DECISION: "0.0001",
  };

  it("builds the Worker config from its key, Policy file, Verifiers and strategy", () => {
    const { config, privateKey } = workerSettings(env);
    expect(privateKey).toBe(key);
    expect(config).toEqual({
      address: me.address,
      publicKey: me.publicKey,
      policy,
      verifierPubKeys: accounts.map((a) => a.publicKey),
      strategy: { costPerDecision: 0.05, expectedDecisions: 15, txFees: 0.05, margin: 1.6, zeroGPerDecision: 0.0001 },
    });
  });

  it("refuses a WORKER_PUBKEY that is not the key's own", () => {
    expect(workerSettings({ ...env, WORKER_PUBKEY: me.publicKey }).config.publicKey).toBe(me.publicKey);
    expect(() => workerSettings({ ...env, WORKER_PUBKEY: accounts[0]!.publicKey })).toThrow(/WORKER_PUBKEY/);
  });

  it("rejects a strategy number that is not a positive number", () => {
    expect(() => workerSettings({ ...env, WORKER_MARGIN: "abc" })).toThrow(/WORKER_MARGIN/);
    expect(() => workerSettings({ ...env, WORKER_EXPECTED_DECISIONS: "0" })).toThrow(/WORKER_EXPECTED_DECISIONS/);
  });
});

describe("requesterSettings", () => {
  const key = generatePrivateKey();
  const env = {
    ...verifierEnv,
    REQUESTER_PRIVATE_KEY: key,
    REQUESTER_HEDERA_ACCOUNT_ID: "0.0.11333729",
    REQUESTER_HEDERA_PRIVATE_KEY: "302e020100300506032b657004220420aa",
    MAX_REPLAY_PRICE_UNITS: "100000",
    MAX_PAID_REPLAYS: "3",
  };

  it("builds the Requester config and its x402 payer from the env", () => {
    const settings = requesterSettings(env);
    expect(settings.config).toMatchObject({
      address: privateKeyToAccount(key).address,
      verifiers: accounts.map((a, i) => ({ url: `http://localhost:710${i + 1}`, address: a.address })),
      maxPaidReplays: 3,
    });
    expect(settings.payer).toMatchObject({ accountId: "0.0.11333729", maxAtomicAmountPerReplay: 100_000n });
    expect(settings.port).toBe(7000);
    expect(settings.hcsTopicId).toBeUndefined();
  });

  it("uses the spec windows unless REQUESTER_*_SECONDS override them (Hashio needs longer ones)", () => {
    expect(requesterSettings(env).config.windows).toEqual(DEFAULT_WINDOWS);
    const slow = requesterSettings({ ...env, REQUESTER_BIDDING_SECONDS: "120", REQUESTER_STAKE_SECONDS: "180", REQUESTER_SEED_RELEASE_SECONDS: "120", REQUESTER_EPISODE_SECONDS: "900", REQUESTER_RESCUE_SECONDS: "2400" });
    expect(slow.config.windows).toEqual({ ...DEFAULT_WINDOWS, biddingSeconds: 120, stakeWindow: 180, seedReleaseWindow: 120, episodeWindow: 900, rescueSeconds: 2400 });
  });

  it("refuses windows that do not fit before rescue (createMission would revert with InvalidTime)", () => {
    expect(() => requesterSettings({ ...env, REQUESTER_EPISODE_SECONDS: "3600" })).toThrow(/REQUESTER_RESCUE_SECONDS/);
    expect(() => requesterSettings({ ...env, REQUESTER_STAKE_SECONDS: "0" })).toThrow(/REQUESTER_STAKE_SECONDS/);
  });

  it("rejects a malformed Hedera account id or spending cap", () => {
    expect(() => requesterSettings({ ...env, REQUESTER_HEDERA_ACCOUNT_ID: "11333729" })).toThrow(/REQUESTER_HEDERA_ACCOUNT_ID/);
    expect(() => requesterSettings({ ...env, MAX_REPLAY_PRICE_UNITS: "0.1" })).toThrow(/MAX_REPLAY_PRICE_UNITS/);
    expect(() => requesterSettings({ ...env, MAX_PAID_REPLAYS: "-1" })).toThrow(/MAX_PAID_REPLAYS/);
  });
});
