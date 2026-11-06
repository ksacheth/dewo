// Env parsing shared by the Requester and Worker entry points. Every reader fails at startup with the name of the
// setting to fix, so a typo never surfaces later as a revert, a wrong Verifier set or a silent full-history scan.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isAddress } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import type { Hex } from "../formats";

export type Env = Record<string, string | undefined>;

export function requiredEnv(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`set ${name} (see agents/.env.example)`);
  return value;
}

export function listFromEnv(env: Env, name: string): string[] {
  return (env[name] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

/** A 32-byte hex key, with or without the 0x prefix (some of our .env files store it bare). */
export function privateKeyFromEnv(env: Env, name: string): Hex {
  const raw = requiredEnv(env, name);
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${name} must be a 32-byte hex private key`);
  return key as Hex;
}

/** What a numeric setting must be, and how the error message says it. */
export interface NumberRule {
  valid: (n: number) => boolean;
  says: string;
}

export const AT_LEAST_ZERO: NumberRule = { valid: (n) => n >= 0, says: "0 or more" };
export const POSITIVE: NumberRule = { valid: (n) => n > 0, says: "a positive number" };
export const wholeNumber = (min: number, max = Number.MAX_SAFE_INTEGER): NumberRule => ({
  valid: (n) => Number.isInteger(n) && n >= min && n <= max,
  says: `a whole number from ${min}${max === Number.MAX_SAFE_INTEGER ? "" : ` to ${max}`}`,
});

/** `fallback` when unset; otherwise the value must parse and follow `rule`. */
export function numberFromEnv(env: Env, name: string, fallback: number, rule: NumberRule): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !rule.valid(value)) throw new Error(`${name} must be ${rule.says}, got ${JSON.stringify(raw)}`);
  return value;
}

export interface VerifierEndpoint {
  url: string;
  address: Hex;
  publicKey: Hex;
}

const PUBLIC_KEY = /^0x04[0-9a-fA-F]{128}$/;

/**
 * The 3 Verifiers in one fixed order (D5/D7): VERIFIER_URLS paired with VERIFIER_PUBKEYS, addresses derived from the
 * keys. VERIFIER_ADDRESSES is optional and, when set, must name the same Verifiers in the same order.
 */
export function verifiersFromEnv(env: Env): VerifierEndpoint[] {
  const urls = listFromEnv(env, "VERIFIER_URLS");
  if (urls.length !== 3) throw new Error(`VERIFIER_URLS must list exactly 3 Verifier URLs, got ${urls.length}`);
  const keys = verifierPubKeysFromEnv(env);
  const verifiers = urls.map((url, i) => ({ url: url.replace(/\/+$/, ""), address: publicKeyToAddress(keys[i]!), publicKey: keys[i]! }));
  checkDeclaredAddresses(env, verifiers);
  return verifiers;
}

function verifierPubKeysFromEnv(env: Env): Hex[] {
  const keys = listFromEnv(env, "VERIFIER_PUBKEYS");
  if (keys.length !== 3 || keys.some((key) => !PUBLIC_KEY.test(key))) {
    throw new Error("VERIFIER_PUBKEYS must list 3 uncompressed secp256k1 public keys (0x04...), in VERIFIER_URLS order");
  }
  return keys as Hex[];
}

/** VERIFIER_ADDRESSES is optional; when set it must name the same Verifiers in the same order. */
function checkDeclaredAddresses(env: Env, verifiers: readonly VerifierEndpoint[]): void {
  const declared = listFromEnv(env, "VERIFIER_ADDRESSES");
  if (declared.length === 0) return;
  const derived = verifiers.map((verifier) => verifier.address.toLowerCase());
  if (declared.map((address) => address.toLowerCase()).join(",") !== derived.join(",")) {
    throw new Error("VERIFIER_ADDRESSES does not match VERIFIER_PUBKEYS (same Verifiers, same order); leave it empty to derive it");
  }
}

interface DeploymentRecord {
  address: string;
  deployBlock?: number;
}

function readDeployment(env: Env, file: string): DeploymentRecord | null {
  const path = join(env.CHAIN_DEPLOYMENTS_DIR ?? "../chain/deployments", file);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as DeploymentRecord) : null;
}

/** A deployed contract's address: `addressVar` wins, else `address` from chain/deployments/<file>. */
export function deployedAddress(env: Env, addressVar: string, file: string): Hex {
  const address = env[addressVar]?.trim() || readDeployment(env, file)?.address;
  if (!address) throw new Error(`set ${addressVar}, or export chain/deployments/${file} (CHAIN_DEPLOYMENTS_DIR)`);
  if (!isAddress(address, { strict: false })) throw new Error(`${addressVar} is not an EVM address: ${address}`);
  return address as Hex;
}

/**
 * Address plus the block it was deployed in, where log scans start (Hashio rejects ranges over 7 days). The block comes
 * from `blockVar`, else from the deployment file when it describes the same contract.
 */
export function deploymentFromEnv(env: Env, spec: { addressVar: string; blockVar: string; file: string }): { address: Hex; deployBlock: bigint } {
  const address = deployedAddress(env, spec.addressVar, spec.file);
  const block = env[spec.blockVar]?.trim();
  if (block) {
    if (!/^\d+$/.test(block)) throw new Error(`${spec.blockVar} must be a block number, got ${JSON.stringify(block)}`);
    return { address, deployBlock: BigInt(block) };
  }
  const recorded = recordedDeployBlock(env, spec.file, address);
  if (recorded === null) throw new Error(`set ${spec.blockVar} to the block ${address} was deployed in (chain/deployments/${spec.file} does not describe it)`);
  return { address, deployBlock: recorded };
}

/** The file's deployBlock, if the file describes `address`. */
function recordedDeployBlock(env: Env, file: string, address: Hex): bigint | null {
  const recorded = readDeployment(env, file);
  const describesIt = recorded?.deployBlock !== undefined && recorded.address.toLowerCase() === address.toLowerCase();
  return describesIt ? BigInt(recorded.deployBlock!) : null;
}
