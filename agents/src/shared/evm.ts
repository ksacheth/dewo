// viem clients for the two EVM chains, and a write helper that simulates first (so a call the
// contract would reject fails without spending gas) and waits for the receipt.
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Account,
  type Chain,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hederaTestnet, zeroGGalileoTestnet } from "viem/chains";

export const CHAINS = {
  hedera: { chain: hederaTestnet, rpc: "https://testnet.hashio.io/api" },
  zeroG: { chain: zeroGGalileoTestnet, rpc: "https://evmrpc-testnet.0g.ai" },
};

export interface EvmClients {
  public: PublicClient;
  wallet: WalletClient<Transport, Chain, Account>;
}

export function evmClients(chain: Chain, rpc: string, privateKey: Hex): EvmClients {
  const transport = http(rpc);
  return {
    public: createPublicClient({ chain, transport }) as PublicClient,
    wallet: createWalletClient({ chain, transport, account: privateKeyToAccount(privateKey) }),
  };
}

/** Simulates, sends and waits; throws if the transaction reverts. */
export async function send<
  const abi extends Abi,
  name extends ContractFunctionName<abi, "nonpayable" | "payable">,
>(
  clients: EvmClients,
  call: {
    address: Hex;
    abi: abi;
    functionName: name;
    args: ContractFunctionArgs<abi, "nonpayable" | "payable", name>;
  },
): Promise<TransactionReceipt> {
  const { request } = await clients.public.simulateContract({ ...call, account: clients.wallet.account } as never);
  const hash = await clients.wallet.writeContract(request as never);
  const receipt = await clients.public.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${String(call.functionName)} reverted in ${hash}`);
  return receipt;
}
