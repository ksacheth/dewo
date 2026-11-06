import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Outcome, awardTypes, verdictTypes, signAward, signVerdict, eip712Domain } from "../src/sign.js";

// Well-known test key (anvil #0) and its address.
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const MISSION = "0x" + "11".repeat(32);
const WORKER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

const domain = eip712Domain(ESCROW);

describe("EIP-712 signing", () => {
  it("uses the frozen domain from the PRD (I5)", () => {
    expect(domain).toEqual({ name: "Dewo", version: "1", chainId: 296, verifyingContract: ESCROW });
  });

  it("signs an Award the contract can recover to the verifier address", async () => {
    const message = { missionId: MISSION as `0x${string}`, worker: WORKER, price: 5_000_000n, stake: 1_700_000n };
    const signature = await signAward(KEY, ESCROW, message);
    const signer = await recoverTypedDataAddress({ domain, types: awardTypes, primaryType: "Award", message, signature });
    expect(signer).toBe(ADDRESS);
    expect(privateKeyToAccount(KEY).address).toBe(ADDRESS);
  });

  it("an Award signature does not recover to the verifier if the stake is changed", async () => {
    const message = { missionId: MISSION as `0x${string}`, worker: WORKER, price: 5_000_000n, stake: 1_700_000n };
    const signature = await signAward(KEY, ESCROW, message);
    const signer = await recoverTypedDataAddress({
      domain, types: awardTypes, primaryType: "Award", message: { ...message, stake: 0n }, signature,
    });
    expect(signer).not.toBe(ADDRESS);
  });

  it("signs a Verdict with outcome ordering Pass=0, Fail=1, NoShow=2", async () => {
    expect([Outcome.Pass, Outcome.Fail, Outcome.NoShow]).toEqual([0, 1, 2]);
    expect(Object.keys(Outcome)).toEqual(["Pass", "Fail", "NoShow"]);
    const message = { missionId: MISSION as `0x${string}`, outcome: Outcome.NoShow, evidenceHash: ("0x" + "ab".repeat(32)) as `0x${string}` };
    const signature = await signVerdict(KEY, ESCROW, message);
    const signer = await recoverTypedDataAddress({ domain, types: verdictTypes, primaryType: "Verdict", message, signature });
    expect(signer).toBe(ADDRESS);
  });

  it("two verifiers signing the same Verdict yield distinct signers (2-of-3 stand-in)", async () => {
    const k2 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
    const message = { missionId: MISSION as `0x${string}`, outcome: Outcome.Pass, evidenceHash: ("0x" + "cd".repeat(32)) as `0x${string}` };
    const sigs = [await signVerdict(KEY, ESCROW, message), await signVerdict(k2, ESCROW, message)];
    const signers = await Promise.all(sigs.map((signature) => recoverTypedDataAddress({ domain, types: verdictTypes, primaryType: "Verdict", message, signature })));
    expect(new Set(signers).size).toBe(2);
  });
});
