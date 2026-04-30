const fs = require('fs');
const path = require('path');
const CFG_DIR = path.join(__dirname, '..', 'cs2-configs');

// Mappool oficial CS2 Major (Active Duty - Janeiro 2026)
// Removidos: Vertigo (Jan 2025), Train (Jan 2026)
// Adicionados: Anubis voltou (Jan 2026), Overpass voltou (Jul 2025)
const OFFICIAL_MAPS = [
  { name: 'Ancient',  cmd: 'de_ancient'  },
  { name: 'Anubis',   cmd: 'de_anubis'   },
  { name: 'Dust2',    cmd: 'de_dust2'    },
  { name: 'Inferno',  cmd: 'de_inferno'  },
  { name: 'Mirage',   cmd: 'de_mirage'   },
  { name: 'Nuke',     cmd: 'de_nuke'     },
  { name: 'Overpass', cmd: 'de_overpass' },
];

function serverCfg(c) {
  const maxRounds = Number(c.maxRounds || 24);
  const timeoutDur = Number(c.timeoutDur || 30);
  return `// ============================================================
//  SERVER.CFG - CS2 LAN Manager
//  Regras: CS2 Major / ESL Pro League 2025-2026
//  Gerado em: ${new Date().toLocaleString('pt-BR')}
// ============================================================

hostname "${c.eventName || 'CS2 LAN'} | ${c.teamCT || 'Team CT'} vs ${c.teamT || 'Team T'}"
sv_password "${c.serverPassword || ''}"
rcon_password "${c.rconPassword || 'cs2lan'}"

sv_cheats 0
sv_lan 1
mp_competitive_official_5v5 1

// MR12 - padrao oficial CS2 Major desde Setembro 2023
mp_maxrounds ${maxRounds}
mp_halftime 1
mp_halftime_duration 15
mp_freezetime 15
mp_buytime 20
mp_buy_anywhere 0
mp_roundtime 1.92
mp_roundtime_defuse 1.92
mp_c4timer 40

// Overtime MR3 - $10.000 (Valve Major standard)
${c.overtime ? `mp_overtime_enable 1
mp_overtime_maxrounds 6
mp_overtime_startmoney 10000` : 'mp_overtime_enable 0'}

// Skins: armas permitidas, agent skins proibidas (regra Major)
${c.customSkins ? `sv_pure 0
sv_allowupload 1
sv_allowdownload 1
// AVISO: sv_pure 0 permite workshop skins
// Agent skins continuam proibidas por regra - aplicar manualmente` : `sv_pure 1`}

// Timeouts: 3 por time por regulacao, 30s cada (ESL/Major 2024-2025)
// Em OT: 1 timeout adicional por time por bloco de OT
mp_team_timeout_time ${timeoutDur}
mp_team_timeout_ot_each_half_limit 1
mp_pause_match_limit_rounds 0
mp_technical_timeout_per_team 1
mp_technical_timeout_duration_s 120

mp_teamname_1 "${c.teamCT || 'Team CT'}"
mp_teamname_2 "${c.teamT || 'Team T'}"
mp_team_intro_time 0

${c.gotv ? `tv_enable 1
tv_delay 60
tv_delaymapchange 1
tv_advertise_watchable 1` : 'tv_enable 0'}

sv_kick_players_with_cooldown 0
mp_disconnect_kills_players 0

exec warmup.cfg
`;
}

function warmupCfg(c) {
  const maps = OFFICIAL_MAPS.map(m => m.name).join(', ');
  return `// warmup.cfg
mp_warmup_pausetimer ${c.unlimitedWarmup ? 1 : 0}
mp_warmuptime ${c.unlimitedWarmup ? 9999 : 60}
mp_warmup_start
sv_infinite_ammo 1
mp_startmoney 65535
mp_buy_anywhere 1
mp_give_player_c4 1
mp_death_drop_gun 0
say "== Warmup iniciado - aguarde o admin iniciar =="
say "== Mappool oficial (Jan 2026): ${maps} =="
`;
}

function matchCfg(c) {
  const ts = new Date().toISOString().slice(0,19).replace(/[:.]/g,'-');
  const evt = c.eventName || 'CS2 LAN';
  const maxRounds = Number(c.maxRounds || 24);
  const timeoutDur = Number(c.timeoutDur || 30);
  return `// match.cfg - Partida oficial
// MR12 | Timeouts: 3x30s | OT: MR3 $10.000
mp_warmup_end
mp_restartgame 1
mp_maxrounds ${maxRounds}
mp_startmoney 800
mp_buy_anywhere 0
sv_infinite_ammo 0
mp_give_player_c4 1
mp_death_drop_gun 1
mp_freezetime 15
mp_buytime 20
mp_overtime_enable 1
mp_overtime_maxrounds 6
mp_overtime_startmoney 10000
mp_team_timeout_time ${timeoutDur}
mp_team_timeout_ot_each_half_limit 1
mp_pause_match_limit_rounds 0
mp_technical_timeout_per_team 1
mp_technical_timeout_duration_s 120
${c.autoDemo ? `tv_record "demo_${ts}"
say "== Demo gravando: demo_${ts} =="` : ''}
say "== PARTIDA INICIADA - ${evt} =="
say "== MR12 | 3 timeouts x 30s por time | OT $10.000 =="
`;
}

function knifeCfg() {
  return `// knife.cfg - Rodada de faca
mp_warmup_end
mp_give_player_c4 0
mp_startmoney 0
mp_buy_anywhere 0
sv_infinite_ammo 0
mp_death_drop_gun 0
mp_maxrounds 1
mp_roundtime 2
mp_freezetime 5
say "== KNIFE ROUND - Vencedor escolhe CT ou T! =="
`;
}

function practiceCfg() {
  return `// practice.cfg - Treino livre
sv_cheats 1
mp_warmup_pausetimer 1
sv_infinite_ammo 2
mp_buy_anywhere 1
mp_startmoney 65535
mp_freezetime 0
mp_roundtime 60
mp_roundtime_defuse 60
mp_respawn_on_death_t 1
mp_respawn_on_death_ct 1
mp_death_drop_gun 0
sv_grenade_trajectory_prac_pipreview 1
sv_grenade_trajectory_prac_trailtime 10
mp_limitteams 0
mp_autoteambalance 0
bot_quota 0
bot_kick
say "== Modo treino - sv_cheats 1 =="
`;
}

function saveAll(config) {
  if (!fs.existsSync(CFG_DIR)) fs.mkdirSync(CFG_DIR, { recursive: true });
  const files = {
    'server.cfg':   serverCfg(config),
    'warmup.cfg':   warmupCfg(config),
    'match.cfg':    matchCfg(config),
    'knife.cfg':    knifeCfg(),
    'practice.cfg': practiceCfg(),
  };
  Object.entries(files).forEach(([name, content]) => {
    fs.writeFileSync(path.join(CFG_DIR, name), content, 'utf8');
  });
  return Object.keys(files);
}

module.exports = { saveAll, serverCfg, warmupCfg, matchCfg, knifeCfg, practiceCfg, OFFICIAL_MAPS };
