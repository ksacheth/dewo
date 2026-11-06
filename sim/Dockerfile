# Pinned simulator image: dewo-sim:<version>. Always build with --platform
# linux/amd64 (make image does) so a Mac (arm64) and a Linux box (amd64) run the
# exact same binaries:
#   docker build --platform linux/amd64 -t dewo-sim:0.1.0 sim/
FROM python:3.12.7-slim-bookworm

# Software rendering (OSMesa) so frames do not depend on any GPU or driver.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libosmesa6 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

ENV MUJOCO_GL=osmesa \
    PYOPENGL_PLATFORM=osmesa \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN uv sync --frozen --no-dev

ENTRYPOINT ["sim"]
