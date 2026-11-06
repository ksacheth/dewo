/**
 * Starting values for the Post Mission form's limits (#66). The Requester picks them; these are not protocol constants.
 * maxSteps is also the Worker's worst-case 0G bill, so it bounds an Episode for every Mission.
 */
export const DEFAULT_MAX_STEPS = 60
/** Protocol ceiling on maxSteps, the same as MissionEscrow.MAX_STEPS and @dewo/agents MAX_STEPS: createMission rejects more. */
export const MAX_STEPS = 200
export const DEFAULT_MAX_COLLISIONS = 0
