import type { Address } from "viem";
import type { ZeroGPort } from "../ports.js";

/** The slice of the 0G compute broker the Verifier uses (`createZGComputeNetworkBroker(signer)`). */
export interface ComputeBroker {
  inference: { processResponse(providerAddress: string, chatID?: string, content?: string): Promise<boolean | null> };
}

/**
 * Check 4's 0G signature leg. Anything but an explicit `true` is not valid: `false` is a bad signature, `null` means
 * verification was skipped, and an error means we could not confirm it. NOTE: this proves 0G produced answer `chatID`;
 * it does not bind the request or response text to it (spike #2).
 */
export function zeroGCompute(broker: ComputeBroker): ZeroGPort {
  return {
    async verifyResponse(providerAddress: Address, chatID: string) {
      try {
        return (await broker.inference.processResponse(providerAddress, chatID)) === true;
      } catch {
        return false;
      }
    },
  };
}
