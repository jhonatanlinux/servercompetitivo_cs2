const OFFICIAL_COMPETITIVE_RULESET = Object.freeze({
  id: 'official-mr12-no-friendly-fire',
  label: 'Official MR12',
  description: 'MR12, OT MR3 $10000, economia oficial e dano amigo desativado.',
  playersPerTeam: 5,
  maxSpectators: 2,
  minReady: 10,
  cvars: Object.freeze({
    mp_competitive_official_5v5: '1',
    mp_maxrounds: '24',
    mp_startmoney: '800',
    mp_afterroundmoney: '0',
    mp_maxmoney: '16000',
    mp_halftime: '1',
    mp_halftime_duration: '15',
    mp_freezetime: '15',
    mp_buytime: '20',
    mp_buy_anywhere: '0',
    sv_infinite_ammo: '0',
    mp_roundtime: '1.92',
    mp_roundtime_defuse: '1.92',
    mp_c4timer: '40',
    mp_free_armor: '0',
    mp_respawn_on_death_ct: '0',
    mp_respawn_on_death_t: '0',
    mp_give_player_c4: '1',
    mp_death_drop_gun: '1',
    mp_playercashawards: '1',
    mp_teamcashawards: '1',
    mp_friendlyfire: '0',
    ff_damage_reduction_bullets: '0',
    ff_damage_reduction_grenade: '0',
    ff_damage_reduction_grenade_self: '1',
    ff_damage_reduction_other: '0',
    mp_overtime_enable: '1',
    mp_overtime_maxrounds: '6',
    mp_overtime_startmoney: '10000',
    mp_team_timeout_ot_each_half_limit: '1',
    mp_pause_match_limit_rounds: '0',
    mp_technical_timeout_per_team: '1',
    mp_technical_timeout_duration_s: '120',
  }),
});

function withRuntimeRuleOverrides(config = {}) {
  return {
    ...OFFICIAL_COMPETITIVE_RULESET.cvars,
    mp_maxrounds: String(config.maxRounds || OFFICIAL_COMPETITIVE_RULESET.cvars.mp_maxrounds),
    mp_team_timeout_time: String(config.timeoutDur || 30),
    sv_pure: config.skins ? '0' : '1',
  };
}

function cvarsToCommands(cvars) {
  return Object.entries(cvars).map(([name, value]) => `${name} ${value}`);
}

function buildCompetitiveCommands(config = {}) {
  return cvarsToCommands(withRuntimeRuleOverrides(config));
}

function buildMatchzyCvars(config = {}, minReady = OFFICIAL_COMPETITIVE_RULESET.minReady) {
  return {
    ...withRuntimeRuleOverrides(config),
    matchzy_minimum_ready_required: String(minReady),
    matchzy_autoready_enabled: config.botScenario ? 'true' : 'false',
    matchzy_autoready_simulation_enabled: 'false',
    matchzy_autoready_simulation_allow_start_without_humans: 'false',
    matchzy_autoready_simulation_knife_use_safe_mode: 'false',
    bot_quota: config.botScenario ? '10' : '0',
    bot_quota_mode: 'normal',
    bot_difficulty: config.botScenario ? '3' : '2',
  };
}

function buildStartMatchCommands(config = {}) {
  return [
    'css_plugins reload MTLiveStats',
    'mp_warmup_end',
    ...buildCompetitiveCommands(config),
    'mp_restartgame 1',
  ];
}

function buildWarmupSafetyCommands() {
  return [
    'mp_friendlyfire 0',
    'ff_damage_reduction_bullets 0',
    'ff_damage_reduction_grenade 0',
    'ff_damage_reduction_other 0',
  ];
}

function validateCompetitiveConfig(config = {}) {
  const issues = [];
  if (Number(config.maxRounds || 24) !== 24) issues.push('Regra oficial esperada: MR12 / mp_maxrounds 24.');
  if (Number(config.timeoutDur || 30) < 10) issues.push('Timeout muito curto para operacao competitiva.');
  if (config.useMatchzy !== false && Number(config.minReady || 10) < 10) issues.push('MatchZy deve exigir 10 ready em partida 5v5.');
  return issues;
}

module.exports = {
  OFFICIAL_COMPETITIVE_RULESET,
  withRuntimeRuleOverrides,
  cvarsToCommands,
  buildCompetitiveCommands,
  buildMatchzyCvars,
  buildStartMatchCommands,
  buildWarmupSafetyCommands,
  validateCompetitiveConfig,
};
