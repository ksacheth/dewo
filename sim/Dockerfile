# Pinned simulator image: dewo-sim:<version>. Always build with --platform
# linux/amd64 (make image does) so a Mac (arm64) and a Linux box (amd64) run the
# exact same binaries:
#   docker build --platform linux/amd64 -t dewo-sim:0.3.0 sim/
FROM python:3.12.7-slim-bookworm@sha256:60d9996b6a8a3689d36db740b49f4327be3be09a21122bd02fb8895abb38b50d

# Software rendering (OSMesa) so frames do not depend on any GPU or driver.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libosmesa6=22.3.6-1+deb12u2 \
        libglapi-mesa=22.3.6-1+deb12u2 \
        libllvm15=1:15.0.6-4+b1 \
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
