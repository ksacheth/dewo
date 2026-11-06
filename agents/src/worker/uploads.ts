import type { Hex } from "../formats";
import type { StoragePort } from "./ports";

export interface Document {
  /** The root computed locally (StoragePort.rootOf), the one the Episode Submission names. */
  root: Hex;
  bytes: Uint8Array;
}

/**
 * The 0G Storage uploads of a flown Episode, kept across ticks: a later tick rejoins an upload still in flight instead of
 * starting another, so an upload stuck waiting for a storage node to sync never piles up copies of itself. A failed upload is
 * forgotten, so the next tick starts it again.
 */
export class PendingUploads {
  private readonly inFlight = new Map<Hex, Promise<Hex>>();

  constructor(private readonly storage: StoragePort) {}

  /** True once every document is stored, false if that takes longer than `waitMs`; rejects when an upload fails. */
  async storedWithin(documents: readonly Document[], waitMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), Math.max(0, waitMs));
    });
    try {
      return await Promise.race([Promise.all(documents.map((d) => this.upload(d))).then(() => true as const), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private upload({ root, bytes }: Document): Promise<Hex> {
    let pending = this.inFlight.get(root);
    if (!pending) {
      pending = this.storage.upload(bytes).then((stored) => {
        if (stored.toLowerCase() !== root.toLowerCase()) throw new Error(`0G Storage stored ${stored}, but the Episode names ${root}`);
        return stored;
      });
      pending.catch(() => this.inFlight.delete(root));
      this.inFlight.set(root, pending);
    }
    return pending;
  }
}
