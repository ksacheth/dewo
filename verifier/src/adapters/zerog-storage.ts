import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import type { Hex } from "viem";
import { StorageUnavailableError } from "../errors.js";
import { NotJson, type StoragePort } from "../ports.js";

/** What the verifier needs from the 0G indexer: the bytes stored under a root hash, Merkle-checked by the SDK. */
export interface BlobIndexer { downloadToBlob(root: string): Promise<[Blob, Error | null]> }

export interface StorageOptions {
  /** How long one download may take before 0G counts as unavailable (retryable, no Verdict). */
  timeoutMs?: number;
}
const DEFAULT_TIMEOUT_MS = 60_000;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The bytes under `root`, or StorageUnavailableError when the indexer errors, throws or does not answer in time.
 * Any error from the indexer counts as unavailable, including a root it cannot find: an honest Worker's upload may not have
 * reached the storage nodes yet, so only bytes that did arrive can be held against the Worker.
 */
async function downloadBlob(indexer: BlobIndexer, root: Hex, timeoutMs: number): Promise<Blob> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StorageUnavailableError(`0G Storage download of ${root} timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const [blob, error] = await Promise.race([indexer.downloadToBlob(root), timeout]);
    if (error) throw error;
    return blob;
  } catch (e) {
    if (e instanceof StorageUnavailableError) throw e;
    throw new StorageUnavailableError(`0G Storage download of ${root} failed: ${errorMessage(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 0G Storage download by root hash, parsed as JSON (the Worker uploads the Episode Log and Policy as JSON bytes). */
export function zeroGStorage(indexer: BlobIndexer, { timeoutMs = DEFAULT_TIMEOUT_MS }: StorageOptions = {}): StoragePort {
  return {
    async downloadJson(root: Hex): Promise<unknown> {
      const text = await (await downloadBlob(indexer, root, timeoutMs)).text();
      try {
        return JSON.parse(text);
      } catch {
        return new NotJson();
      }
    },
  };
}

export const indexerAt = (url: string): BlobIndexer => new Indexer(url) as unknown as BlobIndexer;
