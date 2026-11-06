# Spectator renderer. Built on top of the pinned image, which it does not change:
#   docker build --platform linux/amd64 -t dewo-sim-overview:0.1.0 sim/overview
FROM dewo-sim:0.1.0
COPY overview.py /opt/overview.py
ENTRYPOINT ["python", "/opt/overview.py"]
