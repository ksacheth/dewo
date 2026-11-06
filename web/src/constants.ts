/**
 * Starting values for the Post Mission form's limits (#66). The Requester picks them; these are not protocol constants.
 * maxSteps is also the Worker's worst-case 0G bill, so it bounds an Episode for every Mission.
 */
export const DEFAULT_MAX_STEPS = 60
/** Protocol ceiling on maxSteps, the same as MissionEscrow.MAX_STEPS and @dewo/agents MAX_STEPS: createMission rejects more. */
export const MAX_STEPS = 200
export const DEFAULT_MAX_COLLISIONS = 0

/** A Course Seed starting with the ASCII bytes "dron" is a drone Course; the same rule as @dewo/agents taskOf and the sim. */
export const DRONE_SEED_PREFIX = "0x64726f6e"
export type Task = "rover" | "drone"
export const taskOf = (courseSeed: string): Task => (courseSeed.toLowerCase().startsWith(DRONE_SEED_PREFIX) ? "drone" : "rover")

/** Decision Cap: 60 Decisions per Episode for every Mission (spec 4.6, ADR 0003). */
export const DECISION_CAP = 60

/** Hedera EVM testnet: the chain the MissionEscrow lives on. */
export const HEDERA_TESTNET = { id: 296, hex: "0x128", name: "Hedera testnet", rpc: "https://testnet.hashio.io/api", explorer: "https://hashscan.io/testnet" }

/** The agents an Operator onboards in the demo. Workers are named after their Policy file. */
export const DEMO_AGENTS = [
  { id: "requester", role: "Requester", name: "Requester agent", note: "Posts Missions and pays Verifiers per Replay." },
  { id: "worker-careful", role: "Worker", name: "Careful", note: "Reliable, priced high." },
  { id: "worker-cheap-and-blind", role: "Worker", name: "Cheap and Blind", note: "Cheap, reckless." },
  { id: "worker-gambler", role: "Worker", name: "Gambler", note: "Lowest price, worst Reliability." },
] as const
