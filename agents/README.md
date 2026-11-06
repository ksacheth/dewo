# agents: M4 @dewo/agents (Requester and Worker agents, I2/I3 formats).

## Running the agents

From `agents/`, with a `.env` copied from `.env.example`:

```bash
pnpm requester   # the Requester and its API (POST /missions on REQUESTER_PORT, used by the web UI)
pnpm worker      # one Worker; run one process per Policy (WORKER_POLICY, own WORKER_PRIVATE_KEY)
```

Both read the escrow and registry addresses, and the escrow's deploy block, from `../chain/deployments/*.json`, and use
the real Arkiv board through `src/shared/arkiv-board.ts` (on top of `@dewo/board`; the tests run the same adapters
against `@dewo/board/mock`). Each key must be funded where it writes: Hedera (HBAR, and USDC to stake or lock a bounty),
Rabdi (Arkiv entities) and, for Workers, Galileo (Episode Submission and Storage). Records are kept in
`AGENT_STATE_DIR` (default `.state/`, gitignored), so a restarted agent resumes its Missions.

## Demo Policies (ADR 0004)

`policies/*.json` all use `0gm-1.0-35b-a3b` on the mainnet TeeML provider
`0xf4FB8d2bD856e672b5f9848b0eD235A20079B250` and set `requestOptions: { "chat_template_kwargs": { "enable_thinking": false } }`,
which `buildRequest` merges into every request body (it cannot override `model`, `temperature` or `messages`), so the
Verifier's rebuild covers it. A Worker validates its Policy at startup and refuses to run with a missing `{{frame}}` or
`{{history}}` placeholder, a zero or malformed `providerAddress`, a `TBD` model, or `requestOptions` that are not an
object or that set a reserved field.

## 0G Compute: Router or broker

`src/shared/zg-inference.ts` picks the adapter from `ZG_INFERENCE` (see `.env.example`):

- `router` (default): `src/shared/zg-router.ts` sends each Decision to `POST {ZG_ROUTER_URL}/chat/completions` with the
  Worker's own `ZG_ROUTER_API_KEY` and headers `X-0G-Provider-Trust-Mode: private` and `X-0G-Provider-Address: <Policy providerAddress>`.
  The serving provider (`x_0g_trace.provider`, `X-Provider`) must be the pinned one, the chat ID comes from `ZG-Res-Key`
  (fallback: body `id` without `chatcmpl-`), and `processResponse` runs on a mainnet broker built once on a throwaway
  wallet (`ZG_MAINNET_RPC_URL`). A failed completion, a provider mismatch, or a `processResponse` that is not `true`
  throws, so the Episode safe-stops; a failed receipt fetch is logged and the Decision is kept without `receipt`.
- `broker`: the older direct broker flow (`src/shared/zg-compute.ts`) on Galileo with `WORKER_PRIVATE_KEY`.

**Balance for the skip rule.** "0G balance covers a full Decision Cap" reads `BalancesPort.zeroG()`, in 0G. The source
is pluggable (`src/shared/zg-balance.ts`): with the Router it is the account's `total_balance` from
`GET /v1/account/balance`, which needs a management key (`ZG_ROUTER_MANAGEMENT_KEY`, `mk-`, scope `account:read`;
the `sk-` key gets 403). Without one the check is off (reported as unlimited, with a warning). With the broker it is
the on-chain ledger balance. A per-key credit limit set on pc.0g.ai is not readable through any documented endpoint, so a
key that hits its limit fails at inference time (402) and the Episode safe-stops (TODO).

**Live check.** `ZG_ROUTER_API_KEY=sk-... pnpm check:router [frame.png]` (from `agents/`) sends one frame through a demo
Policy with the Router adapter, verifies it on mainnet, and prints the reply, the receipt signer and whether the
Verifier's rebuild matches. It needs a Private-mode Router API key and costs one Decision. Without a PNG path it renders a
frame with the pinned sim.

## Live 0G spikes

`ZG_PRIVATE_KEY=0x... pnpm spike:0g storage|compute|all` (from `agents/`) runs the 0G Storage round trip (#7) and one Compute call with a real sim frame through the broker path, checking `processResponse` and inspecting what the signed receipt commits to (#3, #48). Compute needs a funded ledger: at least 3 0G to create it plus 1 0G locked per provider (0G docs). Defaults to the `qwen/qwen3.8-omni-flash` provider; override with `ZG_PROVIDER` / `ZG_MODEL`.
