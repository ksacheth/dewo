---
status: accepted
---

# Decisions run on mainnet 0G Compute through the Router, pinned to a TeeML provider

Every Decision sends the camera frame to a vision model, and the Verifiers must be able to prove each answer came from that model. The Galileo testnet broker has no working vision provider: its only one (`qwen/qwen3.8-omni-flash`) is a relay whose upstream key is blocked, and the in-TEE `glm-5.3` is text-only and unreachable. The 0G team told us to use mainnet. So Workers call `0gm-1.0-35b-a3b` through the 0G Compute Router (`https://router-api.0g.ai/v1`), with the trust mode set to `private` and the provider pinned to mainnet provider `0xf4FB8d2bD856e672b5f9848b0eD235A20079B250`. That provider is TeeML: the model runs inside an Intel TDX enclave, takes images, and is registered on the mainnet broker. Everything else stays where it is: the escrow on Hedera testnet, the Episode Registry and Episode Logs on 0G Galileo.

We chose this because it is the only verifiable vision model on 0G today, and a Verifier can check each Decision without trusting the Router. Each response carries the provider (`X-Provider`, `x_0g_trace.provider`) and the chat ID (`ZG-Res-Key`). `broker.inference.processResponse(provider, chatID)` against mainnet returns `true` from an unfunded wallet, and the provider's signed receipt recovers to its TEE signer. In the test on 2026-11-06, a real rover frame came back `TURN_RIGHT` in 2.3 s for $0.000007.

## Considered Options

- Wait for the testnet Qwen relay to be fixed: rejected. It is unavailable, and its proof is TeeTLS (the relay is attested, the model runs at Alibaba), weaker than TeeML.
- Text observations (distances, heading) sent to the in-TEE `glm-5.3` on testnet: rejected for now. That provider is unreachable, and the change gives up the vision story. It remains the fallback if mainnet becomes unavailable.
- Router vision models in the `standard` tier (Gemini, Claude, GPT): rejected. They carry no attestation or signature, so a Verifier could not check a Decision at all.
- Calling the mainnet provider directly through the broker (no Router): deferred. It needs real mainnet 0G in each Worker's ledger, and the payoff is unknown (see the request-binding consequence below). It is the path to remove the Router from the trust story.

## Consequences

- **Request binding is still open (#48).** In the private tier the Router encrypts traffic into the enclave (`X-0g-E2ee: sealed`), and the signed receipt (`zg-sig-v1/e2ee-ct:<hash>:<hash>`) covers the ciphertext, not the plaintext request and response. A Verifier can prove that the registered TEE model answered in that chat, but not yet that it answered the exact request rebuilt from the Policy and the Replay frame (ADR 0001). Until this is solved it is listed as a known limitation.
- **Liveness depends on the Router.** If it is down, Episodes safe-stop. Correctness does not depend on it, because verification reads the chain and the provider directly.
- **Workers pay in Router credit, not from an on-chain ledger.** Each Worker uses its own pc.0g.ai API key (trust mode Private, allowed model `0gm-1.0-35b-a3b`, a credit limit). The "0G balance covers a full Decision Cap" skip rule becomes a credit-balance check. A Decision costs about $0.000007.
- **Verifiers need no 0G and no accounts.** They need only a mainnet RPC for `processResponse` and the provider's public signature endpoint. The Episode Registry and Storage reads stay on Galileo, so the RPC configuration splits by purpose.
- **One model and one provider.** The demo Policies all use `0gm-1.0-35b-a3b` and differ by prompt, memory window and pricing. There is no failover if that provider goes down. More verifiable vision providers can be added as 0G lists them.
- **The model reasons by default.** Requests must set `chat_template_kwargs: {"enable_thinking": false}`, or the token cap is spent on thinking and the reply is empty. This setting is part of the Policy's committed request, so it is covered by the request rebuild.

## Update (2026-11-06, ADR 0006)

There is no fixed Decision Cap any more: the credit-balance skip rule checks the Mission's own `maxSteps` Decisions.
