# make replay-check            replay the recorded run twice with the local uv env
# make replay-check DOCKER=1   same, inside the pinned dewo-sim image
VERSION ?= 0.1.0
FIX := tests/fixtures
OUT := .replay-check

ifdef DOCKER
SIM = docker run --rm --platform linux/amd64 -v $(CURDIR)/$(FIX):/fix:ro dewo-sim:$(VERSION)
COURSE = /fix/course_medium.json
ACTIONS = /fix/actions_medium.json
else
SIM = uv run --project . sim
COURSE = $(FIX)/course_medium.json
ACTIONS = $(FIX)/actions_medium.json
endif

.PHONY: image test replay-check

image:
	docker build --platform linux/amd64 -t dewo-sim:$(VERSION) .

test:
	uv run --project . pytest -q

replay-check:
	@mkdir -p $(OUT)
	$(SIM) replay --course $(COURSE) --actions $(ACTIONS) > $(OUT)/run1.json
	$(SIM) replay --course $(COURSE) --actions $(ACTIONS) > $(OUT)/run2.json
	diff $(OUT)/run1.json $(OUT)/run2.json
	python3 -c "import json,sys; sys.exit(0 if json.load(open('$(OUT)/run1.json'))==json.load(open('$(FIX)/expected_medium.json')) else 1)" \
	  || (echo "MISMATCH: differs from the recorded golden run"; exit 1)
	@echo "replay-check OK: two runs identical and equal to the golden recording"
