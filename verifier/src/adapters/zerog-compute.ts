import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { JsonRpcProvider, Wallet } from "ethers";
import type { Address } from "viem";
import type { ZeroGPort } from "../ports.js";

/** 0G mainnet, where the Router-served Decisions of ADR 0004 are answered and verified. */
export const ZG_MAINNET = { chainId: 16661n, rpc: "https://evmrpc.0g.ai" } as const;

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

/**
 * The broker for check 4 on 0G mainnet (ADR 0004). processResponse reads the provider's on-chain service record and
 * its public signature endpoint, so a throwaway wallet with no funds is enough: the Verifier key never touches mainnet.
 */
export async function mainnetComputeBroker(rpcUrl: string = ZG_MAINNET.rpc): Promise<ComputeBroker> {
  const provider = new JsonRpcProvider(rpcUrl);
  const { chainId } = await provider.getNetwork();
  if (chainId !== ZG_MAINNET.chainId) throw new Error(`ZG_MAINNET_RPC_URL ${rpcUrl} is chain ${chainId}, not 0G mainnet (${ZG_MAINNET.chainId})`);
  // A random HD wallet, as in the 0G docs; the cast bridges the SDK's own ethers types.
  return createZGComputeNetworkBroker(Wallet.createRandom().connect(provider) as unknown as Wallet);
}
