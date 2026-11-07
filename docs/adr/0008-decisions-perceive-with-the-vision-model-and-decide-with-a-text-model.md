---
status: accepted
---

# Decisions perceive with the vision model and decide with a text model

The one verifiable vision model on 0G, `0gm-1.0-35b-a3b` (ADR 0004), describes a scene well but chooses actions badly in live Missions: it ignores the rules in the prompt and zig-zags. With thinking switched on, its replies come back slow or empty (the token cap is spent on reasoning). So a Policy may now split each Decision into two verifiable 0G chats. The vision model only describes the camera frame in text (the **Scene Description**), and a strong text model reads that description plus the recent moves and picks the Action. Both calls go through the Router in `private` trust mode, pinned to a TeeML provider, and both are checked by the Verifiers with `processResponse`.

The decide model is `glm-5.3` on mainnet provider `0xD179F4526064846dE9a9E9D93683AF75CB72E503` (type chatbot, verifiability TeeML). A Router call to it with `X-0G-Provider-Trust-Mode: private` succeeded and `processResponse` verified it, at 10 to 50 s per call. Two facts shape the format:

- `glm-5.3` ignores `chat_template_kwargs.enable_thinking: false` and writes its reasoning into the reply content. A reply can therefore name several actions, and can be cut off at `max_tokens`. The decide prompt must end with a required final line `ACTION: <WORD>`, and the answer parser (`parseDecideAction`) takes the **last** such line that is valid for the Mission's task, else the last valid action word anywhere in the reply, else STOP. Workers and Verifiers use this one function. Single-stage Policies keep `parseAction` (first valid word) unchanged.
- One live Router call failed with "fetch failed" after 66 s. A transient error should not end an Episode, so the Worker retries each 0G call of a two-stage Decision once before it safe-stops, and logs every failed attempt.

The Policy gains an optional two-stage form: `perceive: { model, providerAddress, promptTemplate, temperature, requestOptions }` (the prompt has `{{frame}}`) and `decide: { model, providerAddress, promptTemplate, temperature, requestOptions, memoryWindow }` (the prompt has `{{scene}}` and `{{history}}` and asks for the `ACTION:` line). A two-stage Policy has no top-level model fields; each stage carries its own. The single-stage form is unchanged, so existing Policies and Episode Logs still verify. The Policy hash is the keccak256 of the canonical JSON of the whole Policy, so it covers both stages with no change to the hash rule.

A two-stage Decision in the Episode Log keeps the decide call in the existing fields (`chatID`, `providerAddress`, `request`, `rawResponse`, `action`, `receipt`) and adds `perception: { chatID, providerAddress, request, rawResponse, receipt? }` for the perceive call. The `decision.made` event gains an optional `scene`, which the web shows in the Run view.

The Verifier checks a two-stage Decision as follows: the PNG in the perception request hashes to the Replay frame; the perception request equals the one rebuilt from `Policy.perceive` and that PNG; the perception provider is `Policy.perceive.providerAddress` and `processResponse` is true for its chat; the decide request equals the one rebuilt from `Policy.decide`, the logged perception `rawResponse` and the history; the decide provider is `Policy.decide.providerAddress` and `processResponse` is true for its chat; and `parseDecideAction(rawResponse) == action`. A two-stage Policy whose Decision has no `perception`, or a single-stage Policy whose Decision has one, fails.

## Considered Options

- Vision model only, with thinking on: rejected. Replies were slow or empty, and the decisions it did give were no better.
- A stronger vision model from the Router `standard` tier (Gemini, Claude, GPT): rejected, for the same reason as in ADR 0004. Those models carry no attestation or signature, so a Verifier could not check the Decision.
- A deterministic controller that reads the sim state: rejected. The Policy is the Worker's product and must be a model call; a hand-written controller would also make Workers indistinguishable and take the model out of the loop the Verifiers are checking.
- Replace the single-stage form: rejected. Existing Policies, logs and the three single-model demo Workers must keep working and verifying.

## Consequences

- **Two verified chats per Decision.** Every Decision costs two Router calls and two `processResponse` checks. The Worker's per-Decision cost and its 0G balance check count both calls (`callsPerDecision`): the strategy's `costPerDecision` and `zeroGPerDecision` are read as per call and doubled for a two-stage Policy.
- **Latency.** With `glm-5.3` at 10 to 50 s per call, plus a vision call and a possible retry, a Decision can take a minute or more. Episode windows and the Router timeout must allow for it, and `maxSteps` should be chosen with it in mind.
- **Request binding is still open (#48) for both calls.** As in ADR 0004, the private tier seals traffic, so a Verifier proves that the registered TEE model answered each chat but not yet that it answered the exact request rebuilt from the Policy. This now applies to the perceive and the decide chat alike.
- **Retry once, then safe-stop.** Each 0G call is tried twice. If both attempts fail, the Episode safe-stops and no Decision is faked. Retries are errors only: a reply that parses badly is never asked again (no re-rolling).
- **The Scene Description is Worker evidence, not ground truth.** A Verifier proves the decide chat was asked about the logged scene, and the perceive chat saw the Replay frame. It does not judge whether the description is accurate.
- **Two providers to depend on.** A Policy now relies on both providers being up. More verifiable providers can be added as 0G lists them.
