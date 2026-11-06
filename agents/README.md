# agents: M4 @dewo/agents (Requester and Worker agents, I2/I3 formats).

## Demo Policies need filling in

`policies/*.json` ship with placeholder values: `model` is `TBD-...` and `providerAddress` is the zero
address, because the real 0G providers are chosen during testnet setup. Fill both in before running a
Worker. A Worker validates its Policy at startup and refuses to run with a missing `{{frame}}` or
`{{history}}` placeholder, a zero or malformed `providerAddress`, or a `TBD` model.
