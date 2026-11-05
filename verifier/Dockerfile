# Verifier service. The sim image is pinned so Replay is bit-identical to the Worker's run (spike #4).
# SIM_VERSION must match the dewo-sim tag M1 publishes.
ARG SIM_VERSION=latest
FROM dewo-sim:${SIM_VERSION} AS sim

FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY package.json ./
RUN pnpm install --prod=false
COPY . .
ENV NODE_ENV=production
EXPOSE 7101 7102 7103
CMD ["pnpm", "dev"]
