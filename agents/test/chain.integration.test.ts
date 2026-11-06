// Runs the escrow and registry adapters against M2's real contracts on a local Anvil chain.
// Skipped unless DEWO_CHAIN_OUT points at a compiled chain/out (forge build) and anvil is installed:
//   DEWO_CHAIN_OUT=../chain/out pnpm vitest run test/chain.integration.test.ts
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestClient, http, parseAbi, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { erc20Abi, missionEscrowAbi } from "../src/shared/abi";
import { EscrowContract } from "../src/shared/escrow";
import { PayoutClaimer } from "../src/shared/payout-claim";
import { evmClients, type EvmClients } from "../src/shared/evm";
import { RegistryContract } from "../src/shared/registry";
import { SEED } from "./fakes";

const SEED_2: Hex = `0x${"22".repeat(32)}`;
const SEED_3: Hex = `0x${"33".repeat(32)}`;

const OUT = process.env.DEWO_CHAIN_OUT;
const PORT = 18545;
const RPC = `http://127.0.0.1:${PORT}`;
// Throwaway local test keys; the test funds them on Anvil itself.
const KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1d1706367c2e68ca870fc3faaa8920e1b4b4c",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a8eb0da47c2ea4a0b29fc8bb14a12c1a1e0e6e5d",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
];
const [deployerKey, requesterKey, workerKey, ...verifierKeys] = KEYS as [Hex, Hex, Hex, Hex, Hex, Hex];
const verifiers = verifierKeys.map((key) => privateKeyToAccount(key));
// A fresh Anvil chain: scanning from genesis is a handful of blocks.
const ANVIL_SCAN = { fromBlock: 0n };

const artifact = (file: string, name: string) =>
  JSON.parse(readFileSync(join(OUT!, file, `${name}.json`), "utf8")) as { abi: Abi; bytecode: { object: Hex } };

describe.skipIf(!OUT)("escrow + registry adapters against M2's contracts (Anvil)", () => {
  let anvil: ChildProcess;
  let deployer: EvmClients;
  let token: Hex;
  let escrowAddress: Hex;
  let registryAddress: Hex;
  const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(RPC) });
  const clientsFor = (key: Hex) => evmClients(foundry, RPC, key);

  async function deploy(file: string, name: string, args: unknown[] = []): Promise<Hex> {
    const { abi, bytecode } = artifact(file, name);
    const hash = await deployer.wallet.deployContract({ abi, bytecode: bytecode.object, args });
    const receipt = await deployer.public.waitForTransactionReceipt({ hash });
    return receipt.contractAddress!;
  }

  async function signBoth(digest: Hex): Promise<Hex[]> {
    return Promise.all(verifiers.slice(0, 2).map((v) => v.sign({ hash: digest })));
  }

  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(PORT), "--silent"]);
    for (let i = 0; i < 50; i++) {
      try {
        await testClient.getAutomine();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    // HTS system contract stand-in: answers every call with int64(22), HTS "SUCCESS".
    await testClient.setCode({ address: "0x0000000000000000000000000000000000000167", bytecode: "0x601660005260206000f3" });
    // Fund every key explicitly rather than trusting which ones Anvil pre-funds.
    for (const key of KEYS) {
      await testClient.setBalance({ address: privateKeyToAccount(key).address, value: 10n ** 21n });
    }
    deployer = clientsFor(deployerKey);
    token = await deploy("EscrowFixture.sol", "TestToken");
    escrowAddress = await deploy("MissionEscrow.sol", "MissionEscrow", [token]);
    registryAddress = await deploy("EpisodeRegistry.sol", "EpisodeRegistry");
    const mint = parseAbi(["function mint(address to, uint256 amount)"]);
    for (const key of [requesterKey, workerKey]) {
      const to = privateKeyToAccount(key).address;
      const hash = await deployer.wallet.writeContract({ address: token, abi: mint, functionName: "mint", args: [to, 100_000_000n] });
      await deployer.public.waitForTransactionReceipt({ hash });
    }
  }, 30_000);

  afterAll(() => anvil?.kill());

  it("creates, awards, stakes, submits and settles a Mission", async () => {
    const requester = new EscrowContract(clientsFor(requesterKey), escrowAddress, ANVIL_SCAN);
    const worker = new EscrowContract(clientsFor(workerKey), escrowAddress, ANVIL_SCAN);
    const registry = new RegistryContract(clientsFor(workerKey), registryAddress);
    const workerAddress = privateKeyToAccount(workerKey).address;
    const now = Number((await deployer.public.getBlock()).timestamp);

    const { missionId } = await requester.createMission(
      {
        maxBounty: 10_000_000n,
        difficultyClass: "medium",
        riskWeightBps: 7500,
        courseSeed: SEED,
        maxSteps: 40,
        maxCollisions: 1,
        deadlines: { biddingClosesAt: now + 60, stakeWindow: 30, episodeWindow: 300, rescueAt: now + 3600 },
      },
      verifiers.map((v) => v.address),
    );
    expect(await requester.findMission(SEED)).toBe(missionId);
    expect(await requester.findMission(`0x${"99".repeat(32)}` as Hex)).toBeNull();
    const posted = await worker.getMission(missionId);
    expect(posted).toMatchObject({ award: null, stakedAt: null, settled: false });
    expect(posted.terms).toMatchObject({ maxBounty: 10_000_000n, difficultyClass: "medium", riskWeightBps: 7500, courseSeed: SEED, maxSteps: 40, maxCollisions: 1 });
    expect(posted.terms.deadlines).toEqual({ biddingClosesAt: now + 60, stakeWindow: 30, episodeWindow: 300, rescueAt: now + 3600 });

    await testClient.increaseTime({ seconds: 61 });
    await testClient.mine({ blocks: 1 });
    const awardDigest = await deployer.public.readContract({
      address: escrowAddress,
      abi: missionEscrowAbi,
      functionName: "awardDigest",
      args: [missionId as Hex, workerAddress, 6_000_000n, 1_700_000n],
    });
    await requester.award(missionId, { worker: workerAddress, price: 6_000_000n, stake: 1_700_000n }, await signBoth(awardDigest));
    expect((await worker.getMission(missionId)).award).toMatchObject({ worker: workerAddress, price: 6_000_000n, stake: 1_700_000n });

    await worker.stake(missionId, 1_700_000n);
    expect((await worker.getMission(missionId)).stakedAt).not.toBeNull();

    expect(await registry.isSubmitted(missionId, workerAddress)).toBe(false);
    await registry.submitEpisode(missionId, `0x${"11".repeat(32)}` as Hex, `0x${"22".repeat(32)}` as Hex, 7);
    expect(await registry.isSubmitted(missionId, workerAddress)).toBe(true);

    const evidence = `0x${"ee".repeat(32)}` as Hex;
    const verdictDigest = await deployer.public.readContract({
      address: escrowAddress,
      abi: missionEscrowAbi,
      functionName: "verdictDigest",
      args: [missionId as Hex, 0, evidence],
    });
    await requester.settle(missionId, "Pass", evidence, await signBoth(verdictDigest));
    expect((await worker.getMission(missionId)).settled).toBe(true);

    const balance = await deployer.public.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [workerAddress] });
    expect(balance).toBe(100_000_000n + 6_000_000n); // got the price; the stake came back
  }, 60_000);

  it("rescues a Mission nobody bid on once rescueAt has passed", async () => {
    const requester = new EscrowContract(clientsFor(requesterKey), escrowAddress, ANVIL_SCAN);
    const now = Number((await deployer.public.getBlock()).timestamp);
    const { missionId } = await requester.createMission(
      {
        maxBounty: 1_000_000n,
        difficultyClass: "easy",
        riskWeightBps: 5000,
        courseSeed: SEED_2,
        maxSteps: 60,
        maxCollisions: 0,
        deadlines: { biddingClosesAt: now + 60, stakeWindow: 30, episodeWindow: 300, rescueAt: now + 3600 },
      },
      verifiers.map((v) => v.address),
    );
    await testClient.increaseTime({ seconds: 3601 });
    await testClient.mine({ blocks: 1 });
    await requester.rescue(missionId);
    expect((await requester.getMission(missionId)).settled).toBe(true);
  }, 60_000);

  it("parks a payout the token refuses, then withdraws it once delivery works (R11)", async () => {
    const requester = new EscrowContract(clientsFor(requesterKey), escrowAddress, ANVIL_SCAN);
    const worker = new EscrowContract(clientsFor(workerKey), escrowAddress, ANVIL_SCAN);
    const workerAddress = privateKeyToAccount(workerKey).address;
    const balanceOf = (account: Hex) =>
      deployer.public.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] });
    const block = async (blocked: boolean) => {
      const hash = await deployer.wallet.writeContract({
        address: token,
        abi: parseAbi(["function setBlocked(address account, bool isBlocked, uint8 mode)"]),
        functionName: "setBlocked",
        args: [workerAddress, blocked, 0], // 0: the transfer reverts, like an unassociated HTS account
      });
      await deployer.public.waitForTransactionReceipt({ hash });
    };

    const now = Number((await deployer.public.getBlock()).timestamp);
    const { missionId, txHash } = await requester.createMission(
      {
        maxBounty: 10_000_000n,
        difficultyClass: "easy",
        riskWeightBps: 5000,
        courseSeed: SEED_3,
        maxSteps: 60,
        maxCollisions: 0,
        deadlines: { biddingClosesAt: now + 60, stakeWindow: 30, episodeWindow: 300, rescueAt: now + 3600 },
      },
      verifiers.map((v) => v.address),
    );
    expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);
    await testClient.increaseTime({ seconds: 61 });
    await testClient.mine({ blocks: 1 });
    const awardDigest = await deployer.public.readContract({
      address: escrowAddress,
      abi: missionEscrowAbi,
      functionName: "awardDigest",
      args: [missionId as Hex, workerAddress, 6_000_000n, 1_700_000n],
    });
    expect((await requester.award(missionId, { worker: workerAddress, price: 6_000_000n, stake: 1_700_000n }, await signBoth(awardDigest))).txHash).toMatch(/^0x/);
    await worker.stake(missionId, 1_700_000n);

    const evidence = `0x${"ee".repeat(32)}` as Hex;
    const verdictDigest = await deployer.public.readContract({
      address: escrowAddress,
      abi: missionEscrowAbi,
      functionName: "verdictDigest",
      args: [missionId as Hex, 0, evidence],
    });
    const before = await balanceOf(workerAddress);
    await block(true);
    await requester.settle(missionId, "Pass", evidence, await signBoth(verdictDigest)); // does not revert: the payout is parked
    expect(await balanceOf(workerAddress)).toBe(before);
    expect(await worker.owed(workerAddress)).toBe(7_700_000n);

    // While the token still refuses, the claimer logs and keeps the amount owed.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const claimer = new PayoutClaimer(worker, workerAddress, "worker test");
    await claimer.claim();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
    expect(await worker.owed(workerAddress)).toBe(7_700_000n);

    await block(false);
    await claimer.claim(); // still due after the failure, so it retries and succeeds
    expect(await worker.owed(workerAddress)).toBe(0n);
    expect(await balanceOf(workerAddress)).toBe(before + 7_700_000n);
    expect((await worker.getMission(missionId)).settled).toBe(true);
  }, 60_000);
});
