# Verifier image: built ON the pinned sim image so Replay runs the exact MuJoCo build Workers used (spike #4).
# Build the sim image first: docker build --platform linux/amd64 -t dewo-sim:0.2.0 sim/
# Then, from the repo root (the build needs ../agents and ../board):
#   docker build --platform linux/amd64 --build-arg SIM_VERSION=0.2.0 -f verifier/Dockerfile -t dewo-verifier .
ARG SIM_VERSION=0.2.0
FROM dewo-sim:${SIM_VERSION}

# Add Node 22 (same Debian bookworm base as python:3.12-slim) next to the sim; the sim ENTRYPOINT is cleared below.
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
    && corepack enable

WORKDIR /app
# The root lockfile pins every workspace package; web/package.json is copied only so the lockfile's importers all resolve.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY agents/package.json agents/
COPY board/package.json board/
COPY web/package.json web/
COPY verifier/package.json verifier/
RUN pnpm install --frozen-lockfile --filter verifier... --prod=false
COPY agents agents
COPY board board
COPY verifier verifier
WORKDIR /app/verifier

# Replay runs the bundled `sim` binary directly (no Docker socket inside the container).
ENV SIM_CMD=sim \
    NODE_ENV=production
ENTRYPOINT []
EXPOSE 7101 7102 7103
CMD ["pnpm", "dev"]
