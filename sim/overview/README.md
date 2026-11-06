# Spectator view

Whole-arena images for the web UI, from `make overview-image` and `scripts/overview-docker`. They are display only: not hashed, not sent to the model, not read by a Verifier. It runs as its own process in its own image, built on top of `dewo-sim` and kept outside `src/`, so the pinned image is byte-for-byte unchanged and a renderer crash or hang cannot touch an Episode. The Worker feeds it the poses `session` reports (`OVERVIEW_COMMAND`, on by default; empty turns it off). Check it end to end, including on the demo machine, with `pnpm --filter @dewo/agents overview-check`.

Keep this note here, not in `sim/README.md`: the pinned image's Dockerfile copies that file, so editing it changes the image ID.
