const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMatchzyCvars, buildStartMatchCommands } = require('../domain/ruleSets');
const { buildVetoConfig } = require('../vetoRules');
const { MATCH_STATES, canTransition, transitionMatch } = require('../domain/matchStateMachine');
const { validateMatchRosters } = require('../domain/rosterRules');

test('official ruleset keeps competitive economy and friendly fire off', () => {
  const cvars = buildMatchzyCvars({ skins: true, maxRounds: 24, timeoutDur: 30, botScenario: true }, 10);

  assert.equal(cvars.mp_startmoney, '800');
  assert.equal(cvars.mp_afterroundmoney, '0');
  assert.equal(cvars.mp_overtime_startmoney, '10000');
  assert.equal(cvars.mp_friendlyfire, '0');
  assert.equal(cvars.ff_damage_reduction_bullets, '0');
  assert.equal(cvars.sv_pure, '0');
  assert.equal(cvars.matchzy_autoready_simulation_enabled, 'false');
});

test('start match command always resets into official competitive rules', () => {
  const commands = buildStartMatchCommands({ maxRounds: 24, timeoutDur: 30, skins: false });

  assert.ok(commands.includes('mp_warmup_end'));
  assert.ok(commands.includes('mp_startmoney 800'));
  assert.ok(commands.includes('mp_afterroundmoney 0'));
  assert.ok(commands.includes('mp_friendlyfire 0'));
  assert.equal(commands.at(-1), 'mp_restartgame 1');
});

test('veto rules produce correct map counts by series', () => {
  assert.equal(buildVetoConfig({ series: 'md1' }).maps.length, 1);
  assert.equal(buildVetoConfig({ series: 'md3' }).maps.length, 3);
  assert.equal(buildVetoConfig({ series: 'md5' }).maps.length, 5);
});

test('single elimination concept has no lower bracket in veto layer', () => {
  const veto = buildVetoConfig({ series: 'md1', bansCT: ['de_nuke'], bansT: ['de_dust2'] });

  assert.equal(veto.numMaps, 1);
  assert.equal(veto.skipVeto, true);
  assert.ok(!('lowerBracket' in veto));
});

test('match state machine blocks impossible restore before live', () => {
  assert.equal(canTransition(MATCH_STATES.WARMUP, MATCH_STATES.RESTORE_PENDING), false);
  assert.throws(() => transitionMatch(MATCH_STATES.WARMUP, MATCH_STATES.RESTORE_PENDING));
  assert.equal(transitionMatch(MATCH_STATES.LIVE, MATCH_STATES.PAUSED).state, MATCH_STATES.PAUSED);
});

test('roster validation catches duplicates across teams', () => {
  const result = validateMatchRosters({
    playersCT: [{ name: 'A', steamid: '76561198000000001' }],
    playersT: [{ name: 'B', steamid: '76561198000000001' }],
  }, { requireFive: false, requireSteamId: true });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /ambos os times/i.test(issue)));
});
