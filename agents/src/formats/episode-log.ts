// I3: the Episode Log a Worker uploads to 0G Storage and Verifiers replay.

export type Hex = `0x${string}`;

export const ACTIONS = ["FORWARD", "TURN_LEFT", "TURN_RIGHT", "STOP"] as const;
export type Action = (typeof ACTIONS)[number];

export interface EpisodeHeader {
  missionId: string;
  worker: Hex;
  /** 0G Storage root of the revealed Policy. */
  policyRoot: Hex;
  /** The Mission's public Seed Commitment, hash(seed + salt). */
  seedCommitment: Hex;
}

export interface Decision {
  step: number;
  /** sha256 of the camera frame PNG, as reported by the simulator. */
  frameHash: Hex;
  /** 0G receipt for this call (the ZG-Res-Key response header). */
  chatID: string;
  providerAddress: Hex;
  /** The exact request body sent to 0G, so a Verifier can rebuild and compare it. */
  request: unknown;
  rawResponse: string;
  action: Action;
  /**
   * The provider's TEE signature for this chat, fetched by the Worker right after the call
   * (0G `GET /v1/proxy/signature/{chatID}`). A Verifier checks it locally:
   * recoverAddress(hashMessage(text), signature) == the provider's TEE signer. No per-step call to 0G.
   */
  receipt?: ChatReceipt;
}

export interface ChatReceipt {
  text: string;
  signature: Hex;
}

export interface EpisodeLog {
  header: EpisodeHeader;
  decisions: Decision[];
}
