# agents: M4 @dewo/agents (Requester and Worker agents, I2/I3 formats).

## Demo Policies need filling in

`policies/*.json` ship with placeholder values: `model` is `TBD-...` and `providerAddress` is the zero
address, because the real 0G providers are chosen during testnet setup. Fill both in before running a
Worker. A Worker validates its Policy at startup and refuses to run with a missing `{{frame}}` or
`{{history}}` placeholder, a zero or malformed `providerAddress`, or a `TBD` model.

## Live 0G spikes

`ZG_PRIVATE_KEY=0x... pnpm spike:0g storage|compute|all` (from `agents/`) runs the 0G Storage round trip (#7) and one Compute call with a real sim frame through the broker path, checking `processResponse` and inspecting what the signed receipt commits to (#3, #48). Compute needs a funded ledger: at least 3 0G to create it plus 1 0G locked per provider (0G docs). Defaults to the `qwen/qwen3.8-omni-flash` provider; override with `ZG_PROVIDER` / `ZG_MODEL`.
