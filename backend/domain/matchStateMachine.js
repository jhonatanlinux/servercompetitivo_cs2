const MATCH_STATES = Object.freeze({
  IDLE: 'idle',
  SETUP: 'setup',
  WARMUP: 'warmup',
  READY: 'ready',
  KNIFE: 'knife',
  LIVE: 'live',
  PAUSED: 'paused',
  TECH_PAUSED: 'tech_paused',
  RESTORE_PENDING: 'restore_pending',
  ENDED: 'ended',
  ARCHIVED: 'archived',
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [MATCH_STATES.IDLE]: [MATCH_STATES.SETUP, MATCH_STATES.WARMUP],
  [MATCH_STATES.SETUP]: [MATCH_STATES.WARMUP, MATCH_STATES.IDLE],
  [MATCH_STATES.WARMUP]: [MATCH_STATES.READY, MATCH_STATES.KNIFE, MATCH_STATES.LIVE, MATCH_STATES.ENDED],
  [MATCH_STATES.READY]: [MATCH_STATES.KNIFE, MATCH_STATES.LIVE, MATCH_STATES.WARMUP],
  [MATCH_STATES.KNIFE]: [MATCH_STATES.LIVE, MATCH_STATES.WARMUP, MATCH_STATES.ENDED],
  [MATCH_STATES.LIVE]: [MATCH_STATES.PAUSED, MATCH_STATES.TECH_PAUSED, MATCH_STATES.RESTORE_PENDING, MATCH_STATES.ENDED],
  [MATCH_STATES.PAUSED]: [MATCH_STATES.LIVE, MATCH_STATES.TECH_PAUSED, MATCH_STATES.ENDED],
  [MATCH_STATES.TECH_PAUSED]: [MATCH_STATES.LIVE, MATCH_STATES.PAUSED, MATCH_STATES.ENDED],
  [MATCH_STATES.RESTORE_PENDING]: [MATCH_STATES.PAUSED, MATCH_STATES.LIVE, MATCH_STATES.ENDED],
  [MATCH_STATES.ENDED]: [MATCH_STATES.ARCHIVED, MATCH_STATES.WARMUP, MATCH_STATES.IDLE],
  [MATCH_STATES.ARCHIVED]: [MATCH_STATES.IDLE, MATCH_STATES.SETUP],
});

function canTransition(from, to) {
  return Boolean(ALLOWED_TRANSITIONS[from] && ALLOWED_TRANSITIONS[from].includes(to));
}

function transitionMatch(current, next, meta = {}) {
  const from = current || MATCH_STATES.IDLE;
  if (!MATCH_STATES[next.toUpperCase?.()] && !Object.values(MATCH_STATES).includes(next)) {
    throw new Error(`Estado de partida invalido: ${next}`);
  }
  if (!canTransition(from, next)) {
    throw new Error(`Transicao de partida invalida: ${from} -> ${next}`);
  }
  return {
    state: next,
    previousState: from,
    changedAt: new Date().toISOString(),
    ...meta,
  };
}

function inferStateFromScore(status) {
  if (!status) return MATCH_STATES.IDLE;
  if (status.isLive) return MATCH_STATES.LIVE;
  if (/knife/i.test(String(status.matchMode || ''))) return MATCH_STATES.KNIFE;
  if (/pause/i.test(String(status.matchMode || ''))) return MATCH_STATES.PAUSED;
  if (/warmup/i.test(String(status.matchMode || ''))) return MATCH_STATES.WARMUP;
  return MATCH_STATES.SETUP;
}

module.exports = {
  MATCH_STATES,
  ALLOWED_TRANSITIONS,
  canTransition,
  transitionMatch,
  inferStateFromScore,
};
