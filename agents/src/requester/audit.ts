// Tamper-evident spending log: every paid Replay is posted to a Hedera Consensus Service topic,
// so anyone can audit what the Requester agent spent, in order, without trusting its own logs.
import { Client, PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";

/** One line of the spending log, as posted to HCS (R7). */
export interface PaymentRecord {
  missionId: string;
  /** The Verifier's EVM address and the URL that was paid. */
  verifier: string;
  verifierUrl: string;
  outcome: string;
  /** USDC base units, as a string. */
  amount: string;
  payTo?: string;
  network?: string;
  asset?: string;
  /** Settlement transaction id from the x402 PAYMENT-RESPONSE header, when the Verifier sent one. */
  paymentTx?: string;
  /** ISO timestamp from the Requester's clock; HCS adds its own consensus timestamp. */
  at: string;
}

export interface AuditPort {
  recordPayment(record: PaymentRecord): Promise<void>;
}

export class HcsAudit implements AuditPort {
  constructor(
    private readonly client: Client,
    private readonly topicId: string,
  ) {}

  /** A testnet client paying with the Requester's Hedera account. */
  static client(accountId: string, privateKey: string): Client {
    return Client.forTestnet().setOperator(accountId, PrivateKey.fromString(privateKey));
  }

  /** Creates a new topic for this Requester's spending log; returns its id (e.g. 0.0.12345). */
  static async createTopic(client: Client, memo = "dewo requester spending log"): Promise<string> {
    const response = await new TopicCreateTransaction().setTopicMemo(memo).execute(client);
    const { topicId } = await response.getReceipt(client);
    if (!topicId) throw new Error("topic creation returned no topic id");
    return topicId.toString();
  }

  async recordPayment(record: PaymentRecord): Promise<void> {
    const response = await new TopicMessageSubmitTransaction()
      .setTopicId(this.topicId)
      .setMessage(JSON.stringify(record))
      .execute(this.client);
    await response.getReceipt(this.client);
  }
}
