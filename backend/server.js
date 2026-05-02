const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const rcon = require('./rcon');
const cfgGenerator = require('./cfgGenerator');
const { applyVetoToConfig, buildVetoConfig } = require('./vetoRules');
const {
  buildCompetitiveCommands,
  buildMatchzyCvars,
  buildStartMatchCommands,
  validateCompetitiveConfig,
} = require('./domain/ruleSets');
const { MATCH_STATES, canTransition, transitionMatch } = require('./domain/matchStateMachine');
const { validateMatchRosters } = require('./domain/rosterRules');
const { createAuditLogger } = require('./domain/auditLog');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = Number(process.env.CS2_PANEL_PORT || 3001);
const ROOT_DIR = path.join(__dirname, '..');
const WEB_DIST_DIR = path.join(ROOT_DIR, 'apps', 'web', 'dist');
const WEB_DIST_INDEX = path.join(WEB_DIST_DIR, 'index.html');
const CFG_DIR = path.join(ROOT_DIR, 'cs2-configs');
const DS_DIR = path.join(ROOT_DIR, 'cs2-ds');
const ARCHIVE_DIR = path.join(ROOT_DIR, 'event-archive');
const AUDIT_LOG_FILE = path.join(ARCHIVE_DIR, 'audit-log.jsonl');
const MARIADB_DIR = path.join(ROOT_DIR, 'mariadb');
const MARIADB_DATA_DIR = path.join(ROOT_DIR, 'mariadb-data');
const DEFAULT_RCON_PASSWORD = process.env.CS2_RCON_PASSWORD || 'cs2lan';
const SKIN_PLUGIN_PATTERNS = [
  /skin/i,
  /skins/i,
  /weapon.?paint/i,
  /weaponpaints/i,
  /paint/i,
  /glove/i,
  /knife/i,
  /agent/i,
  /^ws$/i,
];
const SKIN_PLUGIN_DEPENDENCIES = new Set([
  'WeaponPaints',
  'MenuManagerCore',
  'PlayerSettings',
]);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
if (fs.existsSync(WEB_DIST_INDEX)) {
  app.use(express.static(WEB_DIST_DIR));
}
fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
app.use('/event-archive', express.static(ARCHIVE_DIR));

let state = {
  active: false,
  config: null,
  startedAt: null,
  profile: null,
  processPid: null,
  cs2Exe: null,
  matchState: MATCH_STATES.IDLE,
  matchStateChangedAt: null,
};
let matchJson = null;
let serverProcess = null;
const audit = createAuditLogger(AUDIT_LOG_FILE);

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(msg);
  });
}

function log(message, level = 'info') {
  console.log(`[${level}] ${message}`);
  broadcast('log', { message, level, time: new Date().toLocaleTimeString('pt-BR') });
}

function auditAction(action, payload = {}) {
  const entry = audit.append(action, {
    matchState: state.matchState,
    active: state.active,
    eventName: state.config && state.config.eventName,
    teamCT: state.config && state.config.teamCT,
    teamT: state.config && state.config.teamT,
    ...payload,
  });
  broadcast('audit', entry);
  return entry;
}

function setMatchState(next, meta = {}) {
  try {
    const transition = transitionMatch(state.matchState, next, meta);
    state.matchState = transition.state;
    state.matchStateChangedAt = transition.changedAt;
    auditAction('match_state_change', transition);
    broadcast('status', { matchState: state.matchState, matchStateChangedAt: state.matchStateChangedAt });
    return transition;
  } catch (err) {
    log(`Fluxo de partida: ${err.message}`, 'warn');
    state.matchState = next;
    state.matchStateChangedAt = new Date().toISOString();
    return { state: next, warning: err.message };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForTcp(host, port, timeoutMs = 6000) {
  const net = require('net');
  const start = Date.now();
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = new net.Socket();
      socket.setTimeout(800);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('timeout', () => {
        socket.destroy();
        if (Date.now() - start >= timeoutMs) resolve(false);
        else setTimeout(attempt, 350);
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start >= timeoutMs) resolve(false);
        else setTimeout(attempt, 350);
      });
      socket.connect(port, host);
    };
    attempt();
  });
}

function q(value) {
  return String(value ?? '').replace(/"/g, "'");
}

function eventChatLines(c) {
  const eventName = q(c.eventName || 'MT PRO LEAGUE');
  const teamCT = q(c.teamCT || 'Team CT');
  const teamT = q(c.teamT || 'Team T');
  const maps = Array.isArray(c.maps) && c.maps.length ? c.maps.join(', ') : (c.map || 'de_mirage');
  return [
    `say "========== ${eventName} ========== "`,
    `say "Confronto: ${teamCT} vs ${teamT}"`,
    `say "Formato: MR12 | OT MR3 $10000 | Minimo ready: ${normalizeMinReady(c, c.useMatchzy)}"`,
    `say "Mapas: ${q(maps)}"`,
  ];
}

function normalizeMinReady(input, useMatchzy) {
  const raw = Number(input.minReady);
  const requested = Number.isFinite(raw) && raw > 0 ? raw : (useMatchzy ? 10 : 1);
  return useMatchzy ? Math.max(10, requested) : Math.max(1, requested);
}

function buildBotPlayers(prefix, start) {
  const players = {};
  const base = BigInt(start);
  for (let i = 1; i <= 5; i += 1) {
    players[String(base + BigInt(i))] = `${prefix} ${i}`;
  }
  return players;
}

function normalizeConfig(input) {
  const botScenario = input.botScenario === true;
  const profile = input.profile === 'mix' ? 'mix' : 'competitive';
  const skins = input.skins !== undefined ? input.skins === true : input.profile === 'mix';
  const maxRounds = Number(input.maxRounds || 24);
  const timeoutDur = Number(input.timeoutDur || 30);
  const rconPort = Number(input.rconPort || input.port || 27015);
  const rconPassword = input.rconPassword || input.password || DEFAULT_RCON_PASSWORD;
  const useMatchzy = input.useMatchzy !== false;
  const veto = buildVetoConfig(input.veto || { series: input.series, maps: input.maps, sideChoice: input.sideChoice });

  return {
    ...input,
    botScenario,
    profile,
    skins,
    customSkins: skins,
    autoDemo: input.demo !== false,
    unlimitedWarmup: input.warmup !== false,
    serverPassword: input.svPass || input.serverPassword || '',
    rconHost: input.rconHost || input.host || '127.0.0.1',
    rconPort,
    rconPassword,
    maxRounds,
    timeoutDur,
    map: input.map || veto.startMap || 'de_mirage',
    maps: Array.isArray(input.maps) && input.maps.length ? input.maps : veto.maps,
    minReady: normalizeMinReady(input, useMatchzy),
    numMaps: Number(input.numMaps || veto.numMaps || 1),
    useMatchzy,
    veto,
    gotv: input.gotv !== false,
    overtime: true,
    rosterValidation: validateMatchRosters(input, { requireFive: false, requireSteamId: false }),
    ruleWarnings: validateCompetitiveConfig({ ...input, maxRounds, timeoutDur, useMatchzy, minReady: normalizeMinReady(input, useMatchzy) }),
  };
}

function findCs2Exe() {
  const candidates = [
    path.join(DS_DIR, 'game', 'bin', 'win64', 'cs2.exe'),
    'D:\\CS2\\game\\bin\\win64\\cs2.exe',
    'D:\\CS2\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function getGameDir(cs2Exe) {
  return path.resolve(path.dirname(cs2Exe), '..', '..');
}

function getCsgoDir(cs2Exe) {
  return path.join(getGameDir(cs2Exe), 'csgo');
}

function copyGeneratedConfigs(cs2Exe) {
  const cfgTarget = path.join(getCsgoDir(cs2Exe), 'cfg');
  fs.mkdirSync(cfgTarget, { recursive: true });
  for (const name of ['server.cfg', 'warmup.cfg', 'match.cfg', 'knife.cfg', 'practice.cfg']) {
    fs.copyFileSync(path.join(CFG_DIR, name), path.join(cfgTarget, name));
  }
  log(`Configs copiados para ${cfgTarget}`, 'ok');
}

function saveMatchJsonSnapshot() {
  if (!matchJson) return;
  try {
    fs.mkdirSync(CFG_DIR, { recursive: true });
    fs.writeFileSync(path.join(CFG_DIR, 'matchzy_match.json'), JSON.stringify(matchJson, null, 2), 'utf8');
  } catch (err) {
    log(`Nao consegui gravar matchzy_match.json local (${err.code || err.message}); seguindo com JSON em memoria.`, 'warn');
  }
}

function isSkinPluginName(name) {
  return SKIN_PLUGIN_DEPENDENCIES.has(name) || SKIN_PLUGIN_PATTERNS.some((pattern) => pattern.test(name));
}

function pluginDirs(cs2Exe) {
  const plugins = path.join(getCsgoDir(cs2Exe), 'addons', 'counterstrikesharp', 'plugins');
  const disabled = path.join(getCsgoDir(cs2Exe), 'addons', 'counterstrikesharp', 'disabled_plugins');
  return { plugins, disabled };
}

function getPluginHealth(cs2Exe) {
  const csgoDir = getCsgoDir(cs2Exe);
  const metamod = path.join(csgoDir, 'addons', 'metamod');
  const css = path.join(csgoDir, 'addons', 'counterstrikesharp');
  const { plugins, disabled } = pluginDirs(cs2Exe);
  const pluginNames = fs.existsSync(plugins)
    ? fs.readdirSync(plugins, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  const disabledNames = fs.existsSync(disabled)
    ? fs.readdirSync(disabled, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];

  return {
    metamod: fs.existsSync(metamod),
    counterStrikeSharp: fs.existsSync(css),
    plugins: pluginNames,
    disabledPlugins: disabledNames,
    matchzy: pluginNames.some((name) => /matchzy/i.test(name)),
    skins: pluginNames.some(isSkinPluginName),
    disabledSkins: disabledNames.some(isSkinPluginName),
  };
}

function moveDirIfPossible(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to)) return false;
  fs.renameSync(from, to);
  return true;
}

function setSkinPluginsEnabled(cs2Exe, enabled) {
  const { plugins, disabled } = pluginDirs(cs2Exe);
  if (!fs.existsSync(plugins) && !fs.existsSync(disabled)) {
    log('CounterStrikeSharp plugins ainda nao encontrados; pulando alternancia de skin plugin.', 'warn');
    return [];
  }

  fs.mkdirSync(plugins, { recursive: true });
  fs.mkdirSync(disabled, { recursive: true });
  const moved = [];

  if (enabled) {
    for (const entry of fs.readdirSync(disabled, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isSkinPluginName(entry.name)) continue;
      const from = path.join(disabled, entry.name);
      const to = path.join(plugins, entry.name);
      if (moveDirIfPossible(from, to)) moved.push(`ON ${entry.name}`);
    }
  } else {
    for (const entry of fs.readdirSync(plugins, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isSkinPluginName(entry.name)) continue;
      const from = path.join(plugins, entry.name);
      const to = path.join(disabled, entry.name);
      if (moveDirIfPossible(from, to)) moved.push(`OFF ${entry.name}`);
    }
  }

  if (moved.length) log(`Skin plugins: ${moved.join(', ')}`, enabled ? 'ok' : 'warn');
  else log(enabled ? 'Skin plugins: nenhum plugin para reativar.' : 'Skin plugins: nenhum plugin de skin detectado.', 'info');
  return moved;
}

async function ensureMariaDbForSkins() {
  if (await waitForTcp('127.0.0.1', 3306, 1200)) {
    log('MariaDB skins ja esta online em 127.0.0.1:3306.', 'ok');
    return true;
  }

  const exe = path.join(MARIADB_DIR, 'bin', 'mariadbd.exe');
  if (!fs.existsSync(exe)) {
    log('MariaDB nao encontrado. WeaponPaints precisa do banco para aplicar skins.', 'error');
    return false;
  }

  fs.mkdirSync(MARIADB_DATA_DIR, { recursive: true });
  log('Iniciando MariaDB antes do servidor CS2 para o WeaponPaints...', 'warn');
  const child = spawn(exe, [
    `--datadir=${MARIADB_DATA_DIR}`,
    '--port=3306',
    '--bind-address=127.0.0.1',
    '--console',
  ], {
    cwd: ROOT_DIR,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();

  const ready = await waitForTcp('127.0.0.1', 3306, 9000);
  if (ready) log('MariaDB skins online. WeaponPaints pode conectar.', 'ok');
  else log('MariaDB nao ficou pronto a tempo. Skins podem nao aplicar.', 'error');
  return ready;
}

async function send(cmd) {
  log('> ' + cmd, 'info');
  if (!rcon.connected()) {
    log('[SIM] RCON offline', 'warn');
    return { ok: false, simulated: true };
  }
  const result = await rcon.send(cmd);
  if (!result.ok) log(`RCON erro: ${result.error}`, 'error');
  return result;
}

async function sendMany(cmds, delayMs = 250) {
  for (const cmd of cmds) {
    await send(cmd);
    await sleep(delayMs);
  }
}

function playerCountsFromStatus(text) {
  const match = String(text || '').match(/players\s*:\s*(\d+)\s+humans,\s*(\d+)\s+bots/i);
  return {
    humans: match ? Number(match[1]) : 0,
    bots: match ? Number(match[2]) : 0,
  };
}

async function ensureBotLabBots() {
  const statusBefore = await send('status');
  const counts = statusBefore.ok ? playerCountsFromStatus(statusBefore.response) : { humans: 0, bots: 0 };
  const targetBots = Math.max(0, 10 - counts.humans);
  if (counts.bots === targetBots) {
    log(`Bot Lab: ${counts.humans} humano(s) + ${counts.bots} bot(s) confirmados.`, 'ok');
    return counts.bots;
  }

  if (counts.bots > targetBots) {
    log(`Bot Lab: ${counts.bots} bots para ${counts.humans} humano(s); reajustando para ${targetBots}.`, 'warn');
    await sendMany(['bot_kick', 'bot_quota 0'], 300);
    await sleep(1000);
  } else {
    log(`Bot Lab: ${counts.bots}/${targetBots} bots encontrados; adicionando bots restantes.`, 'warn');
  }

  const missing = counts.bots > targetBots ? targetBots : Math.max(0, targetBots - counts.bots);
  const cmds = [
    'bot_quota_mode normal',
    'bot_join_team any',
    'bot_join_after_player 0',
    'bot_difficulty 3',
  ];

  for (let i = 0; i < missing; i += 1) {
    cmds.push(i % 2 === 0 ? 'bot_add_ct' : 'bot_add_t');
  }
  cmds.push(`bot_quota ${targetBots}`);

  await sendMany(cmds, 180);
  await sleep(1200);
  const statusAfter = await send('status');
  const after = statusAfter.ok ? playerCountsFromStatus(statusAfter.response) : { humans: 0, bots: 0 };
  const targetAfter = Math.max(0, 10 - after.humans);
  if (after.bots === targetAfter) log(`Bot Lab: ${after.humans} humano(s) + ${after.bots} bot(s) confirmados apos reforco.`, 'ok');
  else log(`Bot Lab: ainda ha ${after.humans} humano(s) + ${after.bots}/${targetAfter} bot(s). Confira o TAB e o console do CS2.`, 'error');
  return after.bots;
}

function scheduleBotLabReinforcement() {
  [10000, 25000, 40000].forEach((delayMs) => {
    setTimeout(() => {
      if (!state.config || !state.config.botScenario || !rcon.connected()) return;
      ensureBotLabBots().catch((err) => log(`Bot Lab reforco falhou: ${err.message}`, 'error'));
    }, delayMs);
  });
}

async function connectRconWithRetry(c, attempts = 80) {
  for (let i = 1; i <= attempts; i += 1) {
    if (!serverProcess) {
      return { ok: false, error: 'CS2 DS encerrou antes de abrir o RCON' };
    }
    const result = await rcon.connect(c.rconHost, c.rconPort, c.rconPassword);
    if (result.ok) {
      log(`RCON conectado em ${c.rconHost}:${c.rconPort}`, 'ok');
      return result;
    }
    log(`Aguardando RCON (${i}/${attempts}): ${result.error}`, 'warn');
    await sleep(1500);
  }
  return { ok: false, error: 'RCON nao conectou dentro do tempo esperado' };
}

function startServerProcess(c, cs2Exe) {
  if (serverProcess && !serverProcess.killed) {
    log(`Servidor ja esta em execucao (PID ${serverProcess.pid}).`, 'warn');
    return;
  }

  const args = [
    '-dedicated',
    '-console',
    '-usercon',
    '-ip', '0.0.0.0',
    '-port', String(c.rconPort),
    '-maxplayers', '12',
    '-maxplayers_override', '12',
    '+game_type', '0',
    '+game_mode', '1',
    '+sv_lan', '1',
    '+sv_lan_ss', '1',
    '+host_info_show', '2',
    '+rcon_password', c.rconPassword,
    '+map', c.map,
    '+exec', 'server.cfg',
  ];

  if (c.gotv) {
    args.push('+tv_enable', '1', '+tv_port', '27020');
  }

  log(`Iniciando CS2 DS: ${cs2Exe}`, 'ok');
  log(`Perfil: ${c.profile === 'mix' ? 'MIX COM SKINS' : 'COMPETITIVO SEM SKINS'}`, c.profile === 'mix' ? 'ok' : 'info');
  serverProcess = spawn(cs2Exe, args, {
    cwd: getGameDir(cs2Exe),
    windowsHide: false,
    detached: false,
    stdio: 'ignore',
  });

  state.processPid = serverProcess.pid;
  state.cs2Exe = cs2Exe;

  serverProcess.on('exit', (code, signal) => {
    log(`CS2 DS encerrado (code=${code ?? '-'} signal=${signal ?? '-'})`, 'warn');
    serverProcess = null;
    state.active = false;
    state.processPid = null;
    setMatchState(MATCH_STATES.IDLE, { reason: 'server_exit', code, signal });
    rcon.disconnect().catch(() => {});
    broadcast('status', { active: false, rcon: false });
  });
}

async function stopServerProcess() {
  if (rcon.connected()) {
    await send('quit');
    await sleep(1000);
    await rcon.disconnect();
  }

  if (serverProcess && !serverProcess.killed) {
    const pid = serverProcess.pid;
    await new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve());
    });
    log(`Processo CS2 DS finalizado (PID ${pid}).`, 'warn');
  }
  serverProcess = null;
  state.processPid = null;
}

function buildMatchzyJson(c) {
  const minReady = normalizeMinReady(c, true);
  const mapSide = c.sideChoice === 'ct' ? 'team1_ct' : c.sideChoice === 't' ? 'team2_ct' : 'knife';
  const buildPlayers = (list) => {
    const out = {};
    if (Array.isArray(list)) {
      list.forEach((p) => {
        if (p.steamid) out[p.steamid] = p.name || p.steamid;
      });
    }
    return out;
  };

  const config = {
    matchid: Date.now(),
    num_maps: c.numMaps,
    maplist: c.maps.slice(0, Math.max(c.numMaps, 1)),
    players_per_team: 5,
    min_players_to_ready: minReady,
    min_spectators_to_ready: 0,
    skip_veto: Boolean(c.skipVeto),
    veto_first: c.veto && c.veto.vetoFirst === 'T' ? 'team2' : 'team1',
    map_sides: Array.from({ length: Math.max(Number(c.numMaps) || 1, 1) }, () => (c.botScenario ? 'team1_ct' : mapSide)),
    clinch_series: true,
    maxRounds: c.maxRounds,
    overtimeMode: 'enabled',
    overtimeSegments: 3,
    team1: {
      id: 'team1',
      name: c.teamCT || 'Team CT',
      tag: (c.teamCT || 'CT').slice(0, 4).toUpperCase(),
      players: c.botScenario ? buildBotPlayers('BOT CT', '76561199000010000') : buildPlayers(c.playersCT),
    },
    team2: {
      id: 'team2',
      name: c.teamT || 'Team T',
      tag: (c.teamT || 'T').slice(0, 4).toUpperCase(),
      players: c.botScenario ? buildBotPlayers('BOT TR', '76561199000020000') : buildPlayers(c.playersT),
    },
  };

  config.cvars = buildMatchzyCvars(c, minReady);

  return config;
}

async function launchMatchzy(c) {
  matchJson = buildMatchzyJson(c);
  saveMatchJsonSnapshot();
  log('matchzy_match.json gerado', 'ok');

  const url = `http://127.0.0.1:${PORT}/api/matchzy/serve`;
  await send(`matchzy_loadmatch_url "${url}"`);
  log('MatchZy: match carregado pelo painel.', 'ok');
}

async function setupCompetitiveBotLab(c) {
  log('Bot Lab: preparando 5 CT x 5 TR para teste competitivo.', 'warn');
  const setupCmds = [
    'sv_hibernate_when_empty 0',
    'mp_limitteams 0',
    'mp_autoteambalance 0',
    'mp_humanteam any',
    'mp_spectators_max 10',
    'bot_kick',
    'bot_quota 0',
    'bot_quota_mode normal',
    'bot_join_team any',
    'bot_join_after_player 0',
    'bot_difficulty 3',
    'bot_stop 0',
    'bot_freeze 0',
    'bot_zombie 0',
    'bot_defer_to_human_goals 0',
    'bot_defer_to_human_items 0',
    ...buildCompetitiveCommands(c),
    `mp_teamname_1 "${q(c.teamCT || 'BOT CT')}"`,
    `mp_teamname_2 "${q(c.teamT || 'BOT TR')}"`,
    'mp_respawn_on_death_ct 0',
    'mp_respawn_on_death_t 0',
    'mp_warmup_pausetimer 0',
    'mp_warmuptime 9999',
    'mp_warmup_start',
  ];
  const botCmds = [
    'bot_join_team any',
    'bot_quota_mode normal',
    'bot_quota 10',
  ];
  const matchzyCmds = [
    'matchzy_minimum_ready_required 10',
    'matchzy_autoready_enabled true',
    'matchzy_autoready_simulation_enabled false',
    'matchzy_autoready_simulation_allow_start_without_humans false',
    'matchzy_autoready_simulation_knife_use_safe_mode false',
  ];
  await sendMany(setupCmds, 200);
  await sendMany(botCmds, 200);
  await sleep(1500);
  await sendMany(botCmds, 120);
  await sendMany(matchzyCmds, 200);
  await send('css_plugins list');
  await ensureBotLabBots();
  await sleep(6500);
  await ensureBotLabBots();
  scheduleBotLabReinforcement();
  await send('mp_restartgame 1');
  log('Bot Lab: 10 bots ativos. Entre como espectador para acompanhar.', 'ok');
}

async function setupNativeCompetitiveBotLab(c) {
  log('Bot Lab nativo: preparando 5 CT x 5 TR com bots reais.', 'warn');
  const setupCmds = [
    'sv_hibernate_when_empty 0',
    'mp_limitteams 0',
    'mp_autoteambalance 0',
    'mp_humanteam any',
    'mp_spectators_max 10',
    'bot_kick',
    'bot_quota 0',
    'bot_quota_mode normal',
    'bot_join_team any',
    'bot_join_after_player 0',
    'bot_difficulty 3',
    'bot_stop 0',
    'bot_freeze 0',
    'bot_zombie 0',
    'bot_defer_to_human_goals 0',
    'bot_defer_to_human_items 0',
    ...buildCompetitiveCommands(c),
    `mp_teamname_1 "${q(c.teamCT || 'BOT CT')}"`,
    `mp_teamname_2 "${q(c.teamT || 'BOT TR')}"`,
  ];
  const botCmds = [
    'bot_add_ct',
    'bot_add_ct',
    'bot_add_ct',
    'bot_add_ct',
    'bot_add_ct',
    'bot_add_t',
    'bot_add_t',
    'bot_add_t',
    'bot_add_t',
    'bot_add_t',
    'bot_join_team any',
    'bot_quota_mode normal',
    'bot_quota 10',
  ];
  await sendMany(setupCmds, 160);
  await sendMany(botCmds, 160);
  await sleep(1200);
  await send('exec match.cfg');
  await sleep(800);
  await sendMany([
    'mp_warmup_pausetimer 0',
    'mp_warmup_end',
    'mp_freezetime 0',
    'mp_restartgame 1',
  ], 180);
  log('Bot Lab nativo: bots reais ativos em modo competitivo.', 'ok');
}

async function configureRunningServer(c) {
  const cmds = [
    `hostname "${q(c.eventName || 'MT PRO LEAGUE')} | ${q(c.teamCT || 'CT')} vs ${q(c.teamT || 'T')}"`,
    `sv_password "${q(c.serverPassword || '')}"`,
    `rcon_password "${q(c.rconPassword)}"`,
    c.skins ? 'sv_pure 0' : 'sv_pure 1',
    'sv_lan 1',
    ...buildCompetitiveCommands(c),
    `mp_teamname_1 "${q(c.teamCT || 'Team CT')}"`,
    `mp_teamname_2 "${q(c.teamT || 'Team T')}"`,
    'mp_spectators_max 2',
    c.gotv ? 'tv_enable 1' : 'tv_enable 0',
    `matchzy_chat_prefix "[{Green}${q(c.eventName || 'MT PRO LEAGUE')}{Default}]"`,
    `matchzy_admin_chat_prefix "[{Red}ADMIN ${q(c.eventName || 'MT')}{Default}]"`,
    `matchzy_match_start_message "{Green}${q(c.eventName || 'MT PRO LEAGUE')}{Default}$$$${q(c.teamCT || 'Team CT')} vs ${q(c.teamT || 'Team T')}$$$MR12 | OT MR3 $10000"`,
    'matchzy_events_enabled true',
    `matchzy_remote_log_url "http://127.0.0.1:${PORT}/api/matchzy/webhook"`,
    `matchzy_minimum_ready_required ${normalizeMinReady(c, c.useMatchzy)}`,
    c.botScenario ? 'matchzy_autoready_enabled true' : 'matchzy_autoready_enabled false',
  ];

  await sendMany(cmds, 150);

  if (c.useMatchzy) {
    await launchMatchzy(c);
    await sendMany(eventChatLines(c), 350);
    if (c.botScenario) await setupCompetitiveBotLab(c);
  } else {
    await send(`changelevel ${c.map}`);
    await sleep(2000);
    if (c.botScenario) await setupNativeCompetitiveBotLab(c);
    else await send(c.warmup ? 'exec warmup.cfg' : 'exec match.cfg');
    await sendMany(eventChatLines(c), 350);
  }
}

app.get('/api/status', (req, res) => {
  const cs2Exe = state.cs2Exe || findCs2Exe();
  res.json({
    active: state.active,
    config: state.config,
    startedAt: state.startedAt,
    profile: state.profile,
    matchState: state.matchState,
    matchStateChangedAt: state.matchStateChangedAt,
    processPid: state.processPid,
    cs2Exe: state.cs2Exe,
    plugins: cs2Exe ? getPluginHealth(cs2Exe) : null,
    rcon: rcon.connected(),
  });
});

app.post('/api/rcon/connect', async (req, res) => {
  const c = normalizeConfig(req.body || {});
  log(`Conectando RCON ${c.rconHost}:${c.rconPort}...`, 'info');
  const result = await rcon.connect(c.rconHost, c.rconPort, c.rconPassword);
  if (result.ok) log('RCON conectado!', 'ok');
  else log('RCON falhou: ' + result.error, 'error');
  res.json(result);
});

app.post('/api/rcon/send', async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'vazio' });
  if (/^\s*matchzy_forceready\b/i.test(command)) {
    return res.status(403).json({ ok: false, error: 'forceready bloqueado: aguarde os 10 jogadores usarem .ready' });
  }
  auditAction('rcon_send', { command });
  res.json(await send(command));
});

app.post('/api/launch', async (req, res) => {
  const c = normalizeConfig(req.body || {});
  const cs2Exe = findCs2Exe();
  if (!cs2Exe) {
    const error = 'cs2.exe nao encontrado em D:\\SERVER_CS2\\cs2-ds nem em D:\\CS2';
    log(error, 'error');
    return res.status(500).json({ ok: false, error });
  }

  try {
    state.config = c;
    state.profile = c.profile;
    state.startedAt = new Date().toISOString();
    resetPlayerStats();

    matchJson = c.useMatchzy ? buildMatchzyJson(c) : null;
    cfgGenerator.saveAll(c);
    saveMatchJsonSnapshot();
    copyGeneratedConfigs(cs2Exe);
    const wantsSkins = c.skins === true;
    const healthBefore = getPluginHealth(cs2Exe);
    if (!healthBefore.metamod || !healthBefore.counterStrikeSharp) {
      log('Metamod/CounterStrikeSharp nao detectados. Rode INSTALAR-PLUGINS-SKINS.bat antes de usar MatchZy/skins.', 'warn');
    }
    if (wantsSkins && !healthBefore.skins && !healthBefore.disabledSkins) {
      log('Modo Mix selecionado, mas nenhum plugin de skins foi detectado. Comandos !knife/!gloves nao vao responder.', 'warn');
    }
    if (wantsSkins) {
      const dbReady = await ensureMariaDbForSkins();
      if (!dbReady) {
        return res.status(500).json({ ok: false, error: 'MariaDB de skins nao iniciou. Abra INICIAR-MARIADB.bat e tente novamente.' });
      }
    }
    setSkinPluginsEnabled(cs2Exe, wantsSkins);

    if (c.botScenario && (serverProcess || rcon.connected())) {
      log('Bot Lab precisa reiniciar o CS2 DS para reservar 10 players + specs.', 'warn');
      await stopServerProcess();
      await sleep(1200);
    }

    startServerProcess(c, cs2Exe);
    const connected = await connectRconWithRetry(c);
    if (!connected.ok) {
      state.active = Boolean(serverProcess);
      broadcast('status', { active: state.active, rcon: false });
      return res.status(500).json({ ok: false, error: connected.error, serverStarted: state.active });
    }

    await send('css_plugins reload MTLiveStats');
    await sleep(500);
    resetPlayerStats();
    await configureRunningServer(c);

    state.active = true;
    setMatchState(c.warmup ? MATCH_STATES.WARMUP : MATCH_STATES.SETUP, { reason: 'launch' });
    auditAction('launch_server', { profile: c.profile, skins: c.skins, botScenario: c.botScenario, useMatchzy: c.useMatchzy });
    broadcast('status', { active: true, rcon: true });
    log('Servidor pronto para uso pelo painel.', 'ok');
    return res.json({ ok: true, profile: c.profile, pid: state.processPid });
  } catch (err) {
    log(`Erro ao iniciar: ${err.message}`, 'error');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/veto/start', async (req, res) => {
  try {
    const base = normalizeConfig(req.body && req.body.config ? req.body.config : req.body || {});
    const next = applyVetoToConfig(base, req.body && req.body.veto ? req.body.veto : base.veto);
    next.useMatchzy = true;
    next.skipVeto = true;
    next.botScenario = false;
    next.profile = 'mix';
    next.skins = true;
    next.customSkins = true;
    log(`Veto aplicado: ${next.veto.label} | mapas ${next.maps.join(', ')} | lado ${next.sideChoice}`, 'ok');
    const cs2Exe = findCs2Exe();
    if (!cs2Exe) return res.status(500).json({ ok: false, error: 'cs2.exe nao encontrado' });

    state.config = next;
    state.profile = next.profile;
    state.startedAt = new Date().toISOString();
    resetPlayerStats();
    matchJson = next.useMatchzy ? buildMatchzyJson(next) : null;
    cfgGenerator.saveAll(next);
    saveMatchJsonSnapshot();
    copyGeneratedConfigs(cs2Exe);
    const healthBefore = getPluginHealth(cs2Exe);
    if (!healthBefore.metamod || !healthBefore.counterStrikeSharp) {
      log('Metamod/CounterStrikeSharp nao detectados. Rode INSTALAR-PLUGINS-SKINS.bat antes de usar MatchZy/skins.', 'warn');
    }
    if (next.profile === 'mix' && !healthBefore.skins && !healthBefore.disabledSkins) {
      log('Veto com skins selecionado, mas nenhum plugin de skins foi detectado. Comandos !knife/!gloves nao vao responder.', 'warn');
    }
    const dbReady = await ensureMariaDbForSkins();
    if (!dbReady) {
      return res.status(500).json({ ok: false, error: 'MariaDB de skins nao iniciou. Abra INICIAR-MARIADB.bat e tente novamente.' });
    }
    setSkinPluginsEnabled(cs2Exe, true);
    if (serverProcess || rcon.connected()) {
      log('Veto com skins precisa reiniciar o CS2 DS para carregar plugins ativados.', 'warn');
      await stopServerProcess();
      await rcon.disconnect();
      await sleep(1200);
    }
    startServerProcess(next, cs2Exe);
    const connected = await connectRconWithRetry(next);
    if (!connected.ok) {
      state.active = Boolean(serverProcess);
      broadcast('status', { active: state.active, rcon: false });
      return res.status(500).json({ ok: false, error: connected.error, serverStarted: state.active });
    }
    await send('css_plugins reload MTLiveStats');
    await sleep(500);
    resetPlayerStats();
    await configureRunningServer(next);
    state.active = true;
    setMatchState(MATCH_STATES.WARMUP, { reason: 'veto_start' });
    auditAction('veto_start_server', { series: next.veto && next.veto.series, maps: next.maps, sideChoice: next.sideChoice });
    broadcast('status', { active: true, rcon: true });
    res.json({ ok: true, profile: next.profile, pid: state.processPid, config: next, veto: next.veto });
  } catch (err) {
    log(`Erro ao iniciar via veto: ${err.message}`, 'error');
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/matchzy/serve', (req, res) => {
  if (!matchJson) return res.status(404).json({ error: 'match nao gerado' });
  res.json(matchJson);
});

app.post('/api/session/stop', async (req, res) => {
  try {
    state.active = false;
    setMatchState(MATCH_STATES.IDLE, { reason: 'session_stop' });
    auditAction('stop_session');
    await stopServerProcess();
    await rcon.disconnect();
    log('Sessao encerrada', 'warn');
    broadcast('status', { active: false, rcon: false });
    res.json({ ok: true });
  } catch (err) {
    log(`Erro ao encerrar: ${err.message}`, 'error');
    res.status(500).json({ ok: false, error: err.message });
  }
});

const actions = {
  'force-ready': 'matchzy_status',
  'unpause': 'matchzy_unpause',
  'pause': 'matchzy_pause',
  'tech-pause': 'mp_pause_match',
  'tech-unpause': 'mp_unpause_match',
  'knife': 'matchzy_knife',
  'end-match': 'matchzy_endmatch',
  'restart-warmup': 'exec warmup.cfg',
  'practice': 'exec practice.cfg',
  'status': 'matchzy_status',
  'plugins': 'css_plugins list',
};

async function startCompetitiveMatchAction() {
  state.startedAt = new Date().toISOString();
  resetPlayerStats();
  setMatchState(MATCH_STATES.LIVE, { reason: 'operator_start_match' });
  broadcast('status', { active: state.active, rcon: rcon.connected(), matchReset: true });
  const cmds = buildStartMatchCommands(state.config || {});
  await sendMany(cmds, 120);
  auditAction('start_match', { commandCount: cmds.length });
  log('Partida competitiva iniciada com MR12, startmoney 800 e stats resetadas.', 'ok');
  return { ok: true, response: 'Partida competitiva iniciada e stats resetadas.' };
}

Object.entries(actions).forEach(([route, cmd]) => {
  app.post(`/api/action/${route}`, async (req, res) => {
    log(cmd, 'ok');
    auditAction('panel_action', { route, command: cmd });
    res.json(await send(cmd));
  });
});

app.post('/api/action/start-match', async (req, res) => {
  if (!rcon.connected()) return res.status(503).json({ ok: false, error: 'RCON nao conectado' });
  try {
    res.json(await startCompetitiveMatchAction());
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/audit-log', (req, res) => {
  res.json({ ok: true, entries: audit.read(300) });
});

app.get('/api/rulesets', (req, res) => {
  res.json({
    ok: true,
    active: 'official-mr12-no-friendly-fire',
    competitive: buildMatchzyCvars(state.config || {}, normalizeMinReady(state.config || {}, true)),
    warnings: state.config ? validateCompetitiveConfig(state.config) : [],
  });
});

app.post('/api/action/changemap', async (req, res) => {
  const { map } = req.body;
  log('changelevel ' + map, 'ok');
  res.json(await send('changelevel ' + map));
});

app.post('/api/action/sv-pure', async (req, res) => {
  const { value } = req.body;
  const cmd = `sv_pure ${value}`;
  log(cmd, value === '0' ? 'ok' : 'warn');
  res.json(await send(cmd));
});

app.post('/api/action/skin-profile', async (req, res) => {
  const cs2Exe = state.cs2Exe || findCs2Exe();
  if (!cs2Exe) return res.status(500).json({ ok: false, error: 'cs2.exe nao encontrado' });
  const enabled = req.body.enabled === true;
  const moved = setSkinPluginsEnabled(cs2Exe, enabled);
  await send(enabled ? 'sv_pure 0' : 'sv_pure 1');
  res.json({ ok: true, enabled, moved });
});

app.post('/api/action/say', async (req, res) => {
  const { message } = req.body;
  res.json(await send(`say ${message}`));
});

// =====================================================================
// MATCHZY: Live score, backups list, round restore, redo current round
// =====================================================================

function parseMatchzyStatus(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    const report = JSON.parse(text);
    const map = report.map || report.current_map || {};
    const team1 = report.team1 || report.team_1 || {};
    const team2 = report.team2 || report.team_2 || {};
    const state = report.game_state || report.gamestate || report.matchMode || report.phase || report.status || report.match_mode;
    return {
      raw: text,
      matchMode: String(state || report.matchzy_tournament_status || 'Idle'),
      seriesType: report.num_maps ? `BO${report.num_maps}` : null,
      mapName: map.name || map.mapname || report.map_name || report.current_map_name || report.mapName || null,
      mapNumber: report.map_number || report.current_map_number || null,
      mapTotal: report.num_maps || report.map_total || null,
      team1Name: team1.name || team1.team_name || report.team1_name || report.team1Name || null,
      team1Side: team1.side || report.team1_side || null,
      team1Score: Number.isFinite(Number(team1.score ?? report.team1_score)) ? Number(team1.score ?? report.team1_score) : null,
      team2Name: team2.name || team2.team_name || report.team2_name || report.team2Name || null,
      team2Side: team2.side || report.team2_side || null,
      team2Score: Number.isFinite(Number(team2.score ?? report.team2_score)) ? Number(team2.score ?? report.team2_score) : null,
      roundNumber: Number.isFinite(Number(report.round ?? report.round_number ?? report.roundNumber)) ? Number(report.round ?? report.round_number ?? report.roundNumber) : null,
      seriesScore: report.series_score || null,
      isLive: /live/i.test(String(state || report.matchzy_tournament_status || '')),
    };
  } catch (err) {}
  const out = {
    raw: text,
    matchMode: null,
    seriesType: null,
    mapName: null,
    mapNumber: null,
    mapTotal: null,
    team1Name: null, team1Side: null, team1Score: null,
    team2Name: null, team2Side: null, team2Score: null,
    roundNumber: null,
    seriesScore: null,
    isLive: false,
  };

  const m = (re) => { const x = text.match(re); return x ? x[1] : null; };

  out.matchMode   = m(/Match\s*(?:Mode|State)[^\n:]*[:\s]+([A-Za-z ]+)/i);
  out.seriesType  = m(/Series\s*Type[^\n:]*[:\s]+(\S+)/i);
  out.roundNumber = parseInt(m(/Round[^\n:]*[:\s]+(\d+)/i)) || null;
  const sm = m(/Series\s*Score[^\n:]*[:\s]+([\d\s\-]+)/i);
  out.seriesScore = sm ? sm.trim() : null;

  const mapM = text.match(/Map[^\n:]*[:\s]+(\S+)\s*\((\d+)\/(\d+)\)/i);
  if (mapM) { out.mapName = mapM[1]; out.mapNumber = +mapM[2]; out.mapTotal = +mapM[3]; }
  else      { out.mapName = m(/Map[^\n:]*[:\s]+(\S+)/i); }

  const t1 = text.match(/Team1[^\n]*?(?:\(([CT]+)\))?[^\n]*?:\s*([^\-\n]+?)(?:\s*-\s*Score[:\s]+|\s+Score[:\s]+)(\d+)/i);
  if (t1) { out.team1Side = t1[1] || null; out.team1Name = t1[2].trim(); out.team1Score = +t1[3]; }
  const t2 = text.match(/Team2[^\n]*?(?:\(([CT]+)\))?[^\n]*?:\s*([^\-\n]+?)(?:\s*-\s*Score[:\s]+|\s+Score[:\s]+)(\d+)/i);
  if (t2) { out.team2Side = t2[1] || null; out.team2Name = t2[2].trim(); out.team2Score = +t2[3]; }

  out.isLive = /Live/i.test(out.matchMode || '');
  return out;
}

function parseConVarValue(text, name) {
  if (!text || typeof text !== 'string') return null;
  const re = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(.*)`, 'i');
  const match = text.match(re);
  return match ? match[1].trim().replace(/^"|"$/g, '') : null;
}

function parseNativeBackup(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const get = (key) => {
      const match = text.match(new RegExp(`"${key}"\\s+"([^"]*)"`));
      return match ? match[1] : null;
    };
    let team1Score = 0;
    let team2Score = 0;
    const scoreBlocks = text.matchAll(/"[A-Za-z]*Score"\s*\{([\s\S]*?)\n\t\}/g);
    for (const block of scoreBlocks) {
      const t1 = block[1].match(/"team1"\s+"(\d+)"/);
      const t2 = block[1].match(/"team2"\s+"(\d+)"/);
      if (t1) team1Score += Number(t1[1]);
      if (t2) team2Score += Number(t2[1]);
    }
    return {
      team1Name: get('team1'),
      team2Name: get('team2'),
      mapName: get('map'),
      roundNumber: Number(get('round')) || null,
      team1Score,
      team2Score,
    };
  } catch (err) {
    return null;
  }
}

function latestNativeBackup() {
  return listRoundBackups({ currentOnly: true })
    .filter((b) => b.kind === 'native' || /backup_round/i.test(b.file))
    .sort((a, b) => new Date(b.mtime) - new Date(a.mtime))[0] || null;
}

async function getNativeStatusFallback() {
  const status = await send('status');
  const team1 = await send('mp_teamname_1');
  const team2 = await send('mp_teamname_2');
  const backup = latestNativeBackup();
  const parsedBackup = backup ? parseNativeBackup(backup.path) : null;
  const mapMatch = status.response && status.response.match(/Map "([^"]+)"/i);
  return {
    raw: status.response || '',
    matchMode: parsedBackup ? 'Live' : 'Warmup',
    seriesType: state.config && state.config.numMaps ? `BO${state.config.numMaps}` : null,
    mapName: (parsedBackup && parsedBackup.mapName) || (mapMatch && mapMatch[1]) || (state.config && state.config.map) || null,
    mapNumber: 1,
    mapTotal: state.config && state.config.numMaps ? state.config.numMaps : 1,
    team1Name: (parsedBackup && parsedBackup.team1Name) || parseConVarValue(team1.response, 'mp_teamname_1') || (state.config && state.config.teamCT) || null,
    team1Side: 'CT',
    team1Score: parsedBackup ? parsedBackup.team1Score : 0,
    team2Name: (parsedBackup && parsedBackup.team2Name) || parseConVarValue(team2.response, 'mp_teamname_2') || (state.config && state.config.teamT) || null,
    team2Side: 'T',
    team2Score: parsedBackup ? parsedBackup.team2Score : 0,
    roundNumber: parsedBackup ? parsedBackup.roundNumber + 1 : null,
    seriesScore: null,
    isLive: Boolean(parsedBackup),
    source: backup ? 'native-backup' : 'native-status',
  };
}

app.get('/api/matchzy/score', async (req, res) => {
  if (!rcon.connected()) return res.status(503).json({ ok: false, error: 'RCON nao conectado' });
  const r = await send('matchzy_status');
  if (!r.ok) return res.status(500).json({ ok: false, error: r.error });
  const parsed = parseMatchzyStatus(r.response);
  if (!parsed || parsed.matchMode === 'none' || !parsed.matchMode || parsed.team1Score == null) {
    const fallback = await getNativeStatusFallback();
    return res.json({ ok: true, status: fallback, raw: r.response, fallback: true });
  }
  res.json({ ok: true, status: parsed, raw: r.response, fallback: false });
});

function listRoundBackups(options = {}) {
  const candidates = [
    path.join(__dirname, '..', 'cs2-ds', 'game', 'csgo'),
    path.join(__dirname, '..', 'cs2-ds', 'game', 'csgo', 'MatchZyDataBackup'),
    path.join(__dirname, '..', 'cs2-ds', 'game', 'csgo', 'MatchZy', 'backups'),
    path.join(__dirname, '..', 'cs2-ds', 'game', 'csgo', 'MatchZy'),
    path.join(__dirname, '..', 'cs2-ds', 'game', 'csgo', 'addons', 'counterstrikesharp', 'plugins', 'MatchZy', 'backups'),
  ];
  const seen = new Map();
  const minTime = options.currentOnly && state.startedAt
    ? new Date(state.startedAt).getTime() - 5000
    : options.currentOnly
      ? Date.now() - (6 * 60 * 60 * 1000)
      : null;
  for (const dir of candidates) {
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (!/^backup.*round.*\.(json|txt|cfg)$/i.test(f) && !/round\d+.*\.(json|txt|cfg)$/i.test(f) && !/^matchzy_.*round.*\.(json|txt|cfg)$/i.test(f)) continue;
        const full = path.join(dir, f);
        let stat = null;
        try { stat = fs.statSync(full); } catch (e) {}
        if (!stat || !stat.isFile()) continue;
        if (minTime && stat.mtime.getTime() < minTime) continue;
        const rm = f.match(/round[_-]?(\d+)/i);
        const round = rm ? parseInt(rm[1]) : null;
        const key = full.toLowerCase();
        if (seen.has(key)) continue;
        seen.set(key, {
          file: f,
          path: full,
          dir,
          round,
          kind: /^backup_round/i.test(f) ? 'native' : 'matchzy',
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }
    } catch (e) {}
  }
  return [...seen.values()].sort((a, b) => (b.round || 0) - (a.round || 0));
}

app.get('/api/matchzy/backups', (req, res) => {
  try {
    const backups = listRoundBackups({ currentOnly: true });
    res.json({ ok: true, backups });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/matchzy/restore', async (req, res) => {
  if (!rcon.connected()) return res.status(503).json({ ok: false, error: 'RCON nao conectado' });
  if (!canTransition(state.matchState, MATCH_STATES.RESTORE_PENDING)) {
    return res.status(409).json({ ok: false, error: `restore bloqueado no estado atual: ${state.matchState}` });
  }
  const round = parseInt(req.body && req.body.round);
  if (!Number.isFinite(round) || round < 0) return res.status(400).json({ ok: false, error: 'round invalido' });
  const backup = listRoundBackups({ currentOnly: true }).find((b) => b.round === round)
    || listRoundBackups().find((b) => b.round === round);
  const cmd = backup && backup.kind === 'native'
    ? `mp_backup_restore_load_file ${backup.file}`
    : `css_restore_round ${round}`;
  log(`RESTORE ROUND ${round} -> ${cmd}`, 'warn');
  setMatchState(MATCH_STATES.RESTORE_PENDING, { reason: 'restore_round', round });
  auditAction('restore_round', { round, command: cmd, file: backup && backup.file });
  const r = await send(cmd);
  res.json({ ok: r.ok, command: cmd, file: backup && backup.file, response: r.response, error: r.error });
});

app.post('/api/matchzy/redo-round', async (req, res) => {
  if (!rcon.connected()) return res.status(503).json({ ok: false, error: 'RCON nao conectado' });
  if (!canTransition(state.matchState, MATCH_STATES.RESTORE_PENDING)) {
    return res.status(409).json({ ok: false, error: `redo bloqueado no estado atual: ${state.matchState}` });
  }
  setMatchState(MATCH_STATES.RESTORE_PENDING, { reason: 'redo_round' });
  const st = await send('matchzy_status');
  if (!st.ok) return res.status(500).json({ ok: false, error: 'matchzy_status falhou: ' + st.error });
  const parsed = parseMatchzyStatus(st.response);
  const round = parsed && parsed.roundNumber;
  if (!round) return res.status(500).json({ ok: false, error: 'nao consegui detectar round atual' });
  const cmd = `css_restore_round ${round}`;
  log(`PANIC: refazer round atual (${round}) -> ${cmd}`, 'warn');
  const r = await send(cmd);
  res.json({ ok: r.ok, round, command: cmd, response: r.response, error: r.error });
});

function archiveIndexFile() {
  return path.join(ARCHIVE_DIR, 'index.json');
}

function eventSetupFile() {
  return path.join(ARCHIVE_DIR, 'event-setup.json');
}

function defaultEventSetup() {
  return {
    title: 'MT PRO LEAGUE',
    slug: 'stage-1',
    format: 'double-elimination',
    seriesDefault: 'md3',
    teams: [],
    groupCount: 2,
    teamsPerGroup: 4,
    advancePerGroup: 2,
    swissRounds: 5,
    swissAdvance: 8,
    upperLower: true,
    notes: '',
  };
}

function normalizeEventTeams(rawTeams) {
  const seen = new Set();
  const normalized = [];
  for (const entry of Array.isArray(rawTeams) ? rawTeams : []) {
    const team = typeof entry === 'string'
      ? { id: safePart(entry, 'team'), name: String(entry || '').trim(), shortName: String(entry || '').trim(), players: [] }
      : {
          id: safePart(entry && entry.id ? entry.id : entry && entry.name, 'team'),
          name: String((entry && entry.name) || '').trim(),
          shortName: String((entry && (entry.shortName || entry.name)) || '').trim(),
          seed: entry && entry.seed != null ? clampInt(entry.seed, 1, 999, undefined) : undefined,
          players: Array.isArray(entry && entry.players)
            ? entry.players.map((player) => ({
                steamid: String((player && player.steamid) || '').trim(),
                name: String((player && player.name) || '').trim(),
              })).filter((player) => player.name || player.steamid)
            : [],
        };
    if (!team.name) continue;
    if (seen.has(team.id)) continue;
    seen.add(team.id);
    normalized.push(team);
  }
  return normalized;
}

function clampInt(value, min, max, fallback) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

function normalizeEventSetup(input) {
  const base = defaultEventSetup();
  const teams = normalizeEventTeams(input && input.teams);
  const format = ['swiss', 'groups', 'double-elimination', 'single-elimination'].includes(input && input.format)
    ? input.format
    : base.format;
  return {
    ...base,
    ...input,
    title: String((input && input.title) || base.title).trim() || base.title,
    slug: safePart((input && input.slug) || base.slug, 'stage-1'),
    format,
    seriesDefault: ['md1', 'md3', 'md5'].includes(input && input.seriesDefault) ? input.seriesDefault : base.seriesDefault,
    teams,
    groupCount: clampInt(input && input.groupCount, 2, 8, base.groupCount),
    teamsPerGroup: clampInt(input && input.teamsPerGroup, 2, 16, base.teamsPerGroup),
    advancePerGroup: clampInt(input && input.advancePerGroup, 1, 8, base.advancePerGroup),
    swissRounds: clampInt(input && input.swissRounds, 3, 7, base.swissRounds),
    swissAdvance: clampInt(input && input.swissAdvance, 2, 16, base.swissAdvance),
    upperLower: input && input.upperLower !== false,
    notes: String((input && input.notes) || '').trim(),
  };
}

function nextPow2(n) {
  let value = 1;
  while (value < Math.max(1, n)) value *= 2;
  return value;
}

function buildSeededTeams(teams) {
  const slots = nextPow2(teams.length || 2);
  const seeded = [...teams];
  while (seeded.length < slots) seeded.push('BYE');
  return seeded;
}

function buildRoundMatches(teams, roundLabel) {
  const matches = [];
  for (let i = 0; i < teams.length; i += 2) {
    matches.push({
      id: `${safePart(roundLabel, 'round')}-${i / 2 + 1}`,
      label: `${roundLabel} M${i / 2 + 1}`,
      team1: teams[i] || 'TBD',
      team2: teams[i + 1] || 'TBD',
    });
  }
  return matches;
}

function buildSingleEliminationStages(teams, prefix = 'Playoffs') {
  const seeded = buildSeededTeams(teams);
  const stages = [];
  let size = seeded.length;
  let roundTeams = seeded;
  while (size >= 2) {
    const roundName = size === 2 ? 'Final' : size === 4 ? 'Semifinal' : size === 8 ? 'Quartas' : `Top ${size}`;
    stages.push({
      title: `${prefix} - ${roundName}`,
      subtitle: `${size / 2} confronto(s)`,
      matches: buildRoundMatches(roundTeams, roundName),
    });
    size = size / 2;
    roundTeams = Array.from({ length: size }, (_, index) => `Vencedor ${roundName} ${index + 1}`);
  }
  return stages;
}

function chunkTeams(teams, count) {
  const groups = Array.from({ length: count }, () => []);
  teams.forEach((team, index) => {
    groups[index % count].push(team);
  });
  return groups;
}

function buildGroupPlan(setup) {
  const teamNames = setup.teams.map((team) => team.name);
  const groupTeams = chunkTeams(teamNames, setup.groupCount);
  const groups = groupTeams.map((teams, index) => ({
    name: `Grupo ${String.fromCharCode(65 + index)}`,
    teams,
    advance: setup.advancePerGroup,
  }));
  const stages = groups.map((group) => ({
    title: `${group.name} - confrontos iniciais`,
    subtitle: `${group.teams.length} times`,
    matches: buildRoundMatches(group.teams.length % 2 === 0 ? group.teams : [...group.teams, 'BYE'], group.name),
  }));
  const playoffTeams = Math.max(2, groups.length * setup.advancePerGroup);
  stages.push(...buildSingleEliminationStages(Array.from({ length: playoffTeams }, (_, index) => `${index + 1}o classificado`), 'Playoffs'));
  return { groups, stages };
}

function buildSwissPlan(setup) {
  const teams = setup.teams.length ? setup.teams.map((team) => team.name) : ['Seed 1', 'Seed 2', 'Seed 3', 'Seed 4', 'Seed 5', 'Seed 6', 'Seed 7', 'Seed 8'];
  const seeded = buildSeededTeams(teams);
  const stages = [];
  for (let round = 1; round <= setup.swissRounds; round += 1) {
    const stageTeams = round === 1
      ? seeded
      : Array.from({ length: seeded.length }, (_, index) => {
          const bucket = index < seeded.length / 2 ? '1-0 / 2-0' : '0-1 / 1-2';
          return `${bucket} Seed ${index + 1}`;
        });
    stages.push({
      title: `Swiss Round ${round}`,
      subtitle: `${seeded.length / 2} confronto(s) previstos`,
      matches: buildRoundMatches(stageTeams, `R${round}`),
    });
  }
  const playoffs = Math.max(2, Math.min(nextPow2(setup.swissAdvance), seeded.length));
  stages.push(...buildSingleEliminationStages(Array.from({ length: playoffs }, (_, index) => `${index + 1}o do swiss`), 'Playoffs'));
  return { groups: [], stages };
}

function buildDoubleEliminationPlan(setup) {
  const seeds = buildSeededTeams(setup.teams.length ? setup.teams.map((team) => team.name) : ['Seed 1', 'Seed 2', 'Seed 3', 'Seed 4']);
  const upperStages = buildSingleEliminationStages(seeds, 'Winner bracket');
  const lowerTeamCount = Math.max(2, seeds.length - 2);
  const lowerStages = setup.upperLower
    ? buildSingleEliminationStages(Array.from({ length: lowerTeamCount }, (_, index) => `Lower seed ${index + 1}`), 'Lower bracket')
    : [];
  const finalStage = {
    title: 'Grande final',
    subtitle: setup.upperLower ? 'Winner bracket vs Lower bracket' : 'Final do evento',
    matches: [{ id: 'grand-final-1', label: 'Final', team1: 'Winner bracket champion', team2: setup.upperLower ? 'Lower bracket champion' : 'Finalista 2' }],
  };
  return { groups: [], stages: [...upperStages, ...lowerStages, finalStage] };
}

function buildEventPlan(setupInput) {
  const setup = normalizeEventSetup(setupInput);
  let groups = [];
  let stages = [];
  if (setup.format === 'groups') ({ groups, stages } = buildGroupPlan(setup));
  else if (setup.format === 'swiss') ({ groups, stages } = buildSwissPlan(setup));
  else if (setup.format === 'double-elimination') ({ groups, stages } = buildDoubleEliminationPlan(setup));
  else stages = buildSingleEliminationStages(setup.teams.length ? setup.teams.map((team) => team.name) : ['Seed 1', 'Seed 2', 'Seed 3', 'Seed 4'], 'Bracket');

  const summary = [
    `${setup.teams.length} time(s) cadastrados`,
    `${setup.seriesDefault.toUpperCase()} como serie padrao`,
    setup.format === 'groups'
      ? `${setup.groupCount} grupos de ate ${setup.teamsPerGroup} times`
      : setup.format === 'swiss'
        ? `${setup.swissRounds} rodada(s) do sistema suico`
        : setup.format === 'double-elimination'
          ? 'Winner bracket + Lower bracket'
          : 'Bracket de eliminacao simples',
  ];
  return { setup, plan: { summary, groups, stages } };
}

function readEventSetup() {
  try {
    const raw = fs.readFileSync(eventSetupFile(), 'utf8');
    return normalizeEventSetup(JSON.parse(raw));
  } catch (e) {
    return defaultEventSetup();
  }
}

function writeEventSetup(setup) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  fs.writeFileSync(eventSetupFile(), JSON.stringify(normalizeEventSetup(setup), null, 2));
}

function safePart(value, fallback = 'item') {
  const cleaned = String(value || fallback)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function readEventArchive() {
  try {
    const raw = fs.readFileSync(archiveIndexFile(), 'utf8');
    const data = JSON.parse(raw);
    return { matches: Array.isArray(data.matches) ? data.matches : [] };
  } catch (e) {
    return { matches: [] };
  }
}

function writeEventArchive(data) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  fs.writeFileSync(archiveIndexFile(), JSON.stringify(data, null, 2));
}

function copyFileToArchive(sourcePath, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(sourcePath, destPath);
  return fs.statSync(destPath);
}

function moveFileToArchive(sourcePath, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  try {
    fs.renameSync(sourcePath, destPath);
  } catch (err) {
    fs.copyFileSync(sourcePath, destPath);
    fs.unlinkSync(sourcePath);
  }
  return fs.statSync(destPath);
}

function publicArchiveUrl(matchId, fileName) {
  return `/event-archive/${encodeURIComponent(matchId)}/${encodeURIComponent(fileName)}`;
}

function findDemoFiles(startedAt) {
  const dirs = [
    path.join(DS_DIR, 'game', 'csgo'),
    path.join(DS_DIR, 'game', 'csgo', 'demos'),
    path.join(DS_DIR, 'game', 'csgo', 'MatchZy'),
    path.join(DS_DIR, 'game', 'csgo', 'MatchZy', 'demos'),
    path.join(DS_DIR, 'game', 'csgo', 'addons', 'counterstrikesharp', 'plugins', 'MatchZy'),
    path.join(DS_DIR, 'game', 'csgo', 'addons', 'counterstrikesharp', 'plugins', 'MatchZy', 'demos'),
  ];
  const minTime = startedAt ? new Date(startedAt).getTime() - 60 * 1000 : Date.now() - (12 * 60 * 60 * 1000);
  const seen = new Map();
  for (const dir of dirs) {
    try {
      for (const file of fs.readdirSync(dir)) {
        if (!/\.dem$/i.test(file)) continue;
        const full = path.join(dir, file);
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        if (minTime && stat.mtime.getTime() < minTime) continue;
        const key = full.toLowerCase();
        if (!seen.has(key)) {
          seen.set(key, { file, path: full, dir, size: stat.size, mtime: stat.mtime.toISOString() });
        }
      }
    } catch (e) {}
  }
  return [...seen.values()].sort((a, b) => new Date(b.mtime) - new Date(a.mtime)).slice(0, 5);
}

async function getCurrentMatchSnapshot() {
  if (rcon.connected()) {
    const r = await send('matchzy_status');
    const parsed = r.ok ? parseMatchzyStatus(r.response) : null;
    if (parsed && parsed.matchMode !== 'none' && parsed.team1Score != null) {
      return { ...parsed, source: 'matchzy-status' };
    }
  }
  return getNativeStatusFallback();
}

function buildEventLeaders(matches) {
  const players = new Map();
  for (const match of matches) {
    for (const p of match.players || []) {
      const key = p.steamid || `${p.name}-${p.team || ''}`;
      const agg = players.get(key) || {
        steamid: p.steamid || key,
        name: p.name || 'Player',
        team: p.team || '',
        maps: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        damage: 0,
        mvps: 0,
        plants: 0,
        defuses: 0,
        clutchesWon: 0,
        ratingTotal: 0,
      };
      agg.maps += 1;
      agg.kills += Number(p.kills || 0);
      agg.deaths += Number(p.deaths || 0);
      agg.assists += Number(p.assists || 0);
      agg.damage += Number(p.damage || 0);
      agg.mvps += Number(p.mvps || 0);
      agg.plants += Number(p.plants || 0);
      agg.defuses += Number(p.defuses || 0);
      agg.clutchesWon += Number(p.clutchesWon || 0);
      agg.ratingTotal += Number(p.rating || 0);
      agg.team = p.team || agg.team;
      players.set(key, agg);
    }
  }
  const list = [...players.values()].map((p) => ({
    ...p,
    kd: p.deaths ? Math.round((p.kills / p.deaths) * 100) / 100 : p.kills,
    rating: p.maps ? Math.round((p.ratingTotal / p.maps) * 100) / 100 : 0,
  }));
  const by = (field) => [...list].sort((a, b) => b[field] - a[field] || b.kills - a.kills).slice(0, 10);
  return {
    topKills: by('kills'),
    topKD: by('kd'),
    topRating: by('rating'),
    topClutches: by('clutchesWon'),
  };
}

async function archiveCurrentMatch() {
  if (rcon.connected()) {
    await sendMany([
      'say "[MT PRO LEAGUE] Partida encerrada pelo painel. Salvando demo e estatisticas..."',
      'matchzy_endmatch',
      'tv_stoprecord',
    ], 350);
    await sleep(1200);
  }

  const status = await getCurrentMatchSnapshot();
  const backups = listRoundBackups({ currentOnly: true });
  const demos = findDemoFiles(state.startedAt);
  const players = snapshotPlayerStats();
  const archivedAt = new Date().toISOString();
  const cfg = state.config || {};
  const eventName = cfg.eventName || 'MT PRO LEAGUE';
  const team1Name = status.team1Name || cfg.teamCT || 'Team CT';
  const team2Name = status.team2Name || cfg.teamT || 'Team T';
  const matchId = `${archivedAt.replace(/[:.]/g, '-')}-${safePart(team1Name)}-vs-${safePart(team2Name)}`;
  const matchDir = path.join(ARCHIVE_DIR, matchId);
  fs.mkdirSync(matchDir, { recursive: true });

  const archivedDemos = [];
  demos.forEach((demo, index) => {
    const destName = `${String(index + 1).padStart(2, '0')}-${safePart(path.basename(demo.file, path.extname(demo.file)), 'demo')}.dem`;
    const dest = path.join(matchDir, destName);
    const stat = copyFileToArchive(demo.path, dest);
    archivedDemos.push({ file: destName, originalFile: demo.file, size: stat.size, mtime: demo.mtime, url: publicArchiveUrl(matchId, destName) });
  });

  const archivedBackups = [];
  backups.forEach((backup, index) => {
    const ext = path.extname(backup.file) || '.txt';
    const destName = `round-${String(backup.round ?? index).padStart(2, '0')}-${safePart(path.basename(backup.file, ext), 'backup')}${ext}`;
    const dest = path.join(matchDir, destName);
    const stat = moveFileToArchive(backup.path, dest);
    archivedBackups.push({ file: destName, originalFile: backup.file, round: backup.round, kind: backup.kind, size: stat.size, mtime: backup.mtime, url: publicArchiveUrl(matchId, destName) });
  });

  const team1Score = Number(status.team1Score || 0);
  const team2Score = Number(status.team2Score || 0);
  const winner = team1Score === team2Score ? 'Empate' : (team1Score > team2Score ? team1Name : team2Name);
  const match = {
    id: matchId,
    archivedAt,
    startedAt: state.startedAt,
    eventName,
    mapName: status.mapName || cfg.map || null,
    roundNumber: status.roundNumber || null,
    team1Name,
    team2Name,
    team1Score,
    team2Score,
    winner,
    source: status.source || null,
    players,
    demos: archivedDemos,
    backups: archivedBackups,
  };

  const metaName = 'match.json';
  fs.writeFileSync(path.join(matchDir, metaName), JSON.stringify({ ...match, config: cfg }, null, 2));
  match.metaUrl = publicArchiveUrl(matchId, metaName);

  const archive = readEventArchive();
  archive.matches = [match, ...archive.matches.filter((m) => m.id !== matchId)];
  writeEventArchive(archive);

  state.active = false;
  state.config = null;
  state.startedAt = null;
  state.profile = null;
  matchJson = null;
  resetPlayerStats();
  broadcast('status', { active: false, rcon: rcon.connected(), archivedMatch: match });
  return match;
}

app.post('/api/match/end-archive', async (req, res) => {
  try {
    const match = await archiveCurrentMatch();
    log(`Partida arquivada: ${match.team1Name} ${match.team1Score} x ${match.team2Score} ${match.team2Name}`, 'ok');
    res.json({ ok: true, match });
  } catch (err) {
    log(`Erro ao arquivar partida: ${err.message}`, 'error');
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/event/setup', (req, res) => {
  try {
    const generated = buildEventPlan(readEventSetup());
    res.json({ ok: true, setup: generated.setup, plan: generated.plan });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/event/setup', (req, res) => {
  try {
    const generated = buildEventPlan(req.body || {});
    writeEventSetup(generated.setup);
    res.json({ ok: true, setup: generated.setup, plan: generated.plan });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/event/matches', (req, res) => {
  try {
    const archive = readEventArchive();
    res.json({
      ok: true,
      matches: archive.matches,
      totals: {
        matches: archive.matches.length,
        demos: archive.matches.reduce((sum, m) => sum + ((m.demos || []).length), 0),
        maps: archive.matches.length,
      },
      leaders: buildEventLeaders(archive.matches),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/event/matches/:id', (req, res) => {
  const archive = readEventArchive();
  const match = archive.matches.find((m) => m.id === req.params.id);
  if (!match) return res.status(404).json({ ok: false, error: 'partida nao encontrada' });
  res.json({ ok: true, match });
});


// =====================================================================
// PLAYER STATS (from MatchZy webhooks) - live K/D/A/ADR/HS/KAST/Rating
// =====================================================================

let playerStats = new Map();  // steamid -> stats
let lastKnownRound = 0;
let liveStatsSnapshot = null;
let lastLiveStatsLogAt = 0;
let liveMoneyByPlayer = new Map();
const LIVE_STATS_MAX_AGE_MS = 10000;

function getOrCreatePlayer(steamid, name, team) {
  if (!steamid) return null;
  let p = playerStats.get(String(steamid));
  if (!p) {
    p = {
      steamid: String(steamid),
      name: name || '',
      team: normalizeTeam(team),
      kills: 0, deaths: 0, assists: 0,
      damage: 0, hsKills: 0,
      mvps: 0, plants: 0, defuses: 0,
      firstKills: 0, firstDeaths: 0,
      clutchesWon: 0,
      kastRounds: 0,
      score: 0,
    };
    playerStats.set(String(steamid), p);
  }
  if (name) p.name = name;
  const nt = normalizeTeam(team);
  if (nt) p.team = nt;
  return p;
}

function normalizeTeam(team) {
  if (team == null) return '';
  const s = String(team).toUpperCase();
  if (s === 'CT' || s === '3' || s === 'TEAM1' || s === 'COUNTER-TERRORIST') return 'CT';
  if (s === 'T' || s === '2' || s === 'TEAM2' || s === 'TERRORIST') return 'T';
  if (s === '1' || s === 'SPEC' || s === 'SPECTATOR' || s === 'SPECTATORS' || s === 'UNASSIGNED' || s === '0') return 'SPEC';
  return s;
}

function configuredSteamIds() {
  const cfg = state.config || {};
  const ids = new Set();
  [...(cfg.playersCT || []), ...(cfg.playersT || [])].forEach((player) => {
    if (player && player.steamid) ids.add(String(player.steamid));
  });
  return ids;
}

function shouldExposeLivePlayer(player) {
  if (!player || (player.team !== 'CT' && player.team !== 'T')) return false;
  if (player.isSpectator === true) return false;

  const roster = configuredSteamIds();
  if (roster.size > 0 && !player.isBot) {
    return roster.has(String(player.steamid));
  }

  return true;
}

function sortLivePlayers(a, b) {
  if (a.team !== b.team) return a.team === 'CT' ? -1 : 1;
  if (a.isBot !== b.isBot) return a.isBot ? 1 : -1;
  return b.score - a.score || b.kills - a.kills || a.deaths - b.deaths;
}

function capLiveStatsToFivePerTeam(stats) {
  const result = [];
  for (const team of ['CT', 'T']) {
    const teamPlayers = stats.filter((player) => player.team === team).sort(sortLivePlayers);
    result.push(...teamPlayers.slice(0, 5));
  }
  return result.sort(sortLivePlayers);
}

function enforceFivePerTeamWithBots(stats) {
  if (!state.config || !state.config.botScenario || !rcon.connected()) return;

  for (const team of ['CT', 'T']) {
    const players = stats.filter((player) => player.team === team).sort(sortLivePlayers);
    if (players.length <= 5) continue;

    const excess = players.slice(5).filter((player) => player.isBot);
    excess.forEach((bot) => {
      send(`bot_kick "${q(bot.name)}"`).catch((err) => log(`Falha ao remover bot excedente ${bot.name}: ${err.message}`, 'error'));
    });

    const humans = players.filter((player) => !player.isBot).length;
    const targetBots = Math.max(0, 10 - humans);
    send(`bot_quota ${targetBots}`).catch((err) => log(`Falha ao ajustar bot_quota ${targetBots}: ${err.message}`, 'error'));
    log(`Bot Lab: limitando ${team} a 5 jogadores; removendo ${excess.length} bot(s) excedente(s).`, 'warn');
  }
}

function resetPlayerStats() {
  playerStats = new Map();
  lastKnownRound = 0;
  liveStatsSnapshot = null;
  liveMoneyByPlayer = new Map();
  log('Stats de jogadores zeradas (novo mapa).', 'info');
  broadcast('playerstats', { stats: [], roundsPlayed: 0 });
}

function calcRating2(p, totalRounds) {
  if (!totalRounds || totalRounds <= 0) return 0;
  const kpr = p.kills / totalRounds;
  const dpr = p.deaths / totalRounds;
  const adr = p.damage / totalRounds;
  const apr = p.assists / totalRounds;
  const kast = (p.kastRounds / totalRounds) * 100;
  const impact = Math.max(0, 2.13 * kpr + 0.42 * apr - 0.41);
  const rating = 0.0073 * kast + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * impact + 0.0032 * adr + 0.1587;
  return Math.max(0, rating);
}

function snapshotPlayerStats() {
  const totalRounds = Math.max(lastKnownRound, 1);
  const arr = [];
  playerStats.forEach((p) => {
    if (p.team !== 'CT' && p.team !== 'T') return;
    const adr = p.damage / totalRounds;
    const kd = p.deaths ? (p.kills / p.deaths) : p.kills;
    const hsPct = p.kills ? (p.hsKills / p.kills) * 100 : 0;
    const kast = (p.kastRounds / totalRounds) * 100;
    arr.push({
      steamid: p.steamid,
      name: p.name,
      team: p.team,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      damage: p.damage,
      adr: Math.round(adr * 10) / 10,
      hsKills: p.hsKills,
      hsPct: Math.round(hsPct * 10) / 10,
      kd: Math.round(kd * 100) / 100,
      kast: Math.round(kast * 10) / 10,
      rating: Math.round(calcRating2(p, totalRounds) * 100) / 100,
      mvps: p.mvps,
      plants: p.plants,
      defuses: p.defuses,
      firstKills: p.firstKills,
      firstDeaths: p.firstDeaths,
      clutchesWon: p.clutchesWon,
      score: p.score,
    });
  });
  arr.sort((a, b) => b.rating - a.rating || b.kills - a.kills);
  return arr;
}

function parseServerStatusPlayers(text) {
  if (!text || typeof text !== 'string') return [];
  if (state.config && state.config.botScenario) return [];
  const players = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*\d+.*'([^']*)'/);
    if (!match) continue;
    const name = match[1];
    if (!name || name === 'SourceTV') continue;
    players.push({
      steamid: `status-${players.length + 1}`,
      name,
      team: 'SPEC',
      kills: 0,
      deaths: 0,
      assists: 0,
      damage: 0,
      adr: 0,
      hsKills: 0,
      hsPct: 0,
      kd: 0,
      kast: 0,
      rating: 0,
      mvps: 0,
      plants: 0,
      defuses: 0,
      firstKills: 0,
      firstDeaths: 0,
      clutchesWon: 0,
      score: 0,
    });
  }
  return players;
}

function normalizeLiveStat(player) {
  const deaths = Number(player.deaths || 0);
  const kills = Number(player.kills || 0);
  const damage = Number(player.damage || 0);
  const rounds = Math.max(lastKnownRound, 1);
  const team = normalizeTeam(player.team);
  const steamid = String(player.steamid || player.userId || player.name || Math.random());
  const health = Number(player.health || 0);
  const alive = Boolean(player.alive);
  const rawMoney = Number(player.money || 0);
  const previousMoney = liveMoneyByPlayer.get(steamid);
  const pluginDeadMoneyLooksInvalid = state.config?.botScenario && !alive && rawMoney === 16000;
  const money = pluginDeadMoneyLooksInvalid
    ? (Number.isFinite(previousMoney) ? previousMoney : 800)
    : rawMoney;

  if (Number.isFinite(money) && !pluginDeadMoneyLooksInvalid) {
    liveMoneyByPlayer.set(steamid, money);
  }

  return {
    steamid,
    name: String(player.name || 'Player'),
    team,
    kills,
    deaths,
    assists: Number(player.assists || 0),
    damage,
    adr: Number.isFinite(Number(player.adr)) && Number(player.adr) > 0
      ? Math.round(Number(player.adr) * 10) / 10
      : Math.round((damage / rounds) * 10) / 10,
    hsKills: Number(player.hsKills || 0),
    hsPct: Math.round(Number(player.hsPct || 0) * 10) / 10,
    kd: deaths ? Math.round((kills / deaths) * 100) / 100 : kills,
    kast: Math.round(Number(player.kast || 0) * 10) / 10,
    rating: Math.round(Number(player.rating || 0) * 100) / 100,
    mvps: Number(player.mvps || 0),
    plants: Number(player.plants || 0),
    defuses: Number(player.defuses || 0),
    firstKills: Number(player.firstKills || 0),
    firstDeaths: Number(player.firstDeaths || 0),
    clutchesWon: Number(player.clutchesWon || 0),
    score: Number(player.score || 0),
    money,
    health,
    armor: Number(player.armor || 0),
    alive,
    isBot: Boolean(player.isBot),
    isSpectator: team === 'SPEC' || Boolean(player.isSpectator),
    source: 'live-plugin',
  };
}

function currentLiveStats() {
  if (!liveStatsSnapshot) return null;
  if (Date.now() - liveStatsSnapshot.receivedAt > LIVE_STATS_MAX_AGE_MS) return null;
  return liveStatsSnapshot;
}

function pickPlayer(obj) {
  if (!obj) return null;
  if (obj.steamid || obj.steam_id || obj.steamId) {
    return { steamid: obj.steamid || obj.steam_id || obj.steamId, name: obj.name || obj.player_name, team: obj.team || obj.side };
  }
  if (obj.player) return pickPlayer(obj.player);
  return null;
}

function handleMatchzyEvent(ev) {
  if (!ev || typeof ev !== 'object') return;
  const t = (ev.event || ev.type || '').toLowerCase();
  if (!t) return;

  if (t === 'series_start' || t === 'map_started' || t === 'map_start') {
    resetPlayerStats();
    return;
  }

  if (t === 'round_end' || t === 'round_ended' || t === 'round_finished') {
    lastKnownRound = ev.round || ev.round_number || ev.roundNumber || (lastKnownRound + 1);
    if (Array.isArray(ev.players)) {
      ev.players.forEach((pl) => {
        const ref = pickPlayer(pl) || pl;
        const p = getOrCreatePlayer(ref.steamid, ref.name, pl.team || ref.team);
        if (!p) return;
        if (typeof pl.damage === 'number')        p.damage = pl.damage;
        if (typeof pl.damage_total === 'number')  p.damage = pl.damage_total;
        if (typeof pl.kills === 'number')         p.kills = pl.kills;
        if (typeof pl.deaths === 'number')        p.deaths = pl.deaths;
        if (typeof pl.assists === 'number')       p.assists = pl.assists;
        if (typeof pl.hs_kills === 'number')      p.hsKills = pl.hs_kills;
        if (typeof pl.headshot_kills === 'number')p.hsKills = pl.headshot_kills;
        if (typeof pl.score === 'number')         p.score = pl.score;
        if (typeof pl.mvps === 'number')          p.mvps = pl.mvps;
        if (typeof pl.first_kills === 'number')   p.firstKills = pl.first_kills;
        if (typeof pl.first_deaths === 'number')  p.firstDeaths = pl.first_deaths;
        if (typeof pl.clutches_won === 'number')  p.clutchesWon = pl.clutches_won;
        if (typeof pl.kast === 'number' && pl.kast <= lastKnownRound) p.kastRounds = pl.kast;
        if (typeof pl.kast_rounds === 'number')   p.kastRounds = pl.kast_rounds;
        if (pl.had_kast === true || pl.kast === true) p.kastRounds++;
      });
    }
    return;
  }

  if (t === 'player_death' || t === 'player_died') {
    const attacker = pickPlayer(ev.attacker) || pickPlayer(ev);
    const victim   = pickPlayer(ev.victim) || pickPlayer(ev.player);
    const assister = pickPlayer(ev.assister);
    const headshot = !!(ev.headshot || ev.is_headshot);

    if (attacker && victim && attacker.steamid && victim.steamid && attacker.steamid !== victim.steamid) {
      const a = getOrCreatePlayer(attacker.steamid, attacker.name, attacker.team);
      a.kills++;
      if (headshot) a.hsKills++;
    }
    if (victim && victim.steamid) {
      const v = getOrCreatePlayer(victim.steamid, victim.name, victim.team);
      v.deaths++;
    }
    if (assister && assister.steamid) {
      const ag = getOrCreatePlayer(assister.steamid, assister.name, assister.team);
      ag.assists++;
    }
    return;
  }

  if (t === 'player_damage' || t === 'damage' || t === 'player_hurt' || t === 'hurt') {
    const attacker = pickPlayer(ev.attacker) || pickPlayer(ev);
    const dmg = ev.damage || ev.dmg || ev.damage_health || 0;
    if (attacker && attacker.steamid && dmg > 0) {
      const a = getOrCreatePlayer(attacker.steamid, attacker.name, attacker.team);
      a.damage += dmg;
    }
    return;
  }

  if (t === 'bomb_planted') {
    const ref = pickPlayer(ev) || pickPlayer(ev.player);
    if (ref) { const p = getOrCreatePlayer(ref.steamid, ref.name, ref.team); if (p) p.plants++; }
    return;
  }

  if (t === 'bomb_defused') {
    const ref = pickPlayer(ev) || pickPlayer(ev.player);
    if (ref) { const p = getOrCreatePlayer(ref.steamid, ref.name, ref.team); if (p) p.defuses++; }
    return;
  }

  if (t === 'round_mvp' || t === 'mvp') {
    const ref = pickPlayer(ev) || pickPlayer(ev.player);
    if (ref) { const p = getOrCreatePlayer(ref.steamid, ref.name, ref.team); if (p) p.mvps++; }
    return;
  }

  if (t === 'first_kill') {
    const att = pickPlayer(ev.attacker) || pickPlayer(ev);
    const vic = pickPlayer(ev.victim);
    if (att && att.steamid) { const p = getOrCreatePlayer(att.steamid, att.name, att.team); if (p) p.firstKills++; }
    if (vic && vic.steamid) { const p = getOrCreatePlayer(vic.steamid, vic.name, vic.team); if (p) p.firstDeaths++; }
    return;
  }

  if (t === 'clutch_win' || t === 'clutch_won') {
    const ref = pickPlayer(ev) || pickPlayer(ev.player);
    if (ref) { const p = getOrCreatePlayer(ref.steamid, ref.name, ref.team); if (p) p.clutchesWon++; }
    return;
  }

  if (t === 'series_end' || t === 'map_result' || t === 'map_end' || t === 'map_ended') {
    if (Array.isArray(ev.players)) {
      ev.players.forEach((pl) => {
        const ref = pickPlayer(pl) || pl;
        const p = getOrCreatePlayer(ref.steamid, ref.name, pl.team || ref.team);
        if (!p) return;
        if (typeof pl.kills === 'number')        p.kills = pl.kills;
        if (typeof pl.deaths === 'number')       p.deaths = pl.deaths;
        if (typeof pl.assists === 'number')      p.assists = pl.assists;
        if (typeof pl.damage === 'number')       p.damage = pl.damage;
        if (typeof pl.headshot_kills === 'number') p.hsKills = pl.headshot_kills;
        if (typeof pl.hs_kills === 'number')     p.hsKills = pl.hs_kills;
        if (typeof pl.mvps === 'number')         p.mvps = pl.mvps;
        if (typeof pl.score === 'number')        p.score = pl.score;
        if (typeof pl.kast === 'number')         p.kastRounds = pl.kast;
        if (typeof pl.first_kills === 'number')  p.firstKills = pl.first_kills;
        if (typeof pl.first_deaths === 'number') p.firstDeaths = pl.first_deaths;
        if (typeof pl.clutches_won === 'number') p.clutchesWon = pl.clutches_won;
        if (typeof pl.plants === 'number')       p.plants = pl.plants;
        if (typeof pl.defuses === 'number')      p.defuses = pl.defuses;
      });
    }
    return;
  }
}

app.post('/api/matchzy/webhook', (req, res) => {
  try {
    const ev = req.body || {};
    handleMatchzyEvent(ev);
    res.json({ ok: true });
    broadcast('playerstats', { stats: snapshotPlayerStats(), roundsPlayed: lastKnownRound });
  } catch (err) {
    log(`Webhook erro: ${err.message}`, 'error');
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/live-stats', (req, res) => {
  try {
    const body = req.body || {};
    const rawStats = Array.isArray(body.players)
      ? body.players.map(normalizeLiveStat).filter(shouldExposeLivePlayer)
      : [];
    rawStats.sort(sortLivePlayers);
    enforceFivePerTeamWithBots(rawStats);
    const stats = capLiveStatsToFivePerTeam(rawStats);
    liveStatsSnapshot = {
      source: body.source || 'counterstrikesharp',
      receivedAt: Date.now(),
      gameTime: body.time || null,
      stats,
    };
    if (Date.now() - lastLiveStatsLogAt > 10000) {
      log(`Live stats recebido: ${stats.length} players (${liveStatsSnapshot.source}).`, stats.length ? 'ok' : 'warn');
      lastLiveStatsLogAt = Date.now();
    }
    broadcast('playerstats', {
      stats,
      roundsPlayed: lastKnownRound,
      source: liveStatsSnapshot.source,
      live: true,
    });
    res.json({ ok: true, players: stats.length });
  } catch (err) {
    log(`Live stats erro: ${err.message}`, 'error');
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/live-stats', (req, res) => {
  const live = currentLiveStats();
  if (!live) return res.json({ ok: true, live: false, stats: [], roundsPlayed: lastKnownRound });
  res.json({ ok: true, live: true, source: live.source, stats: live.stats, roundsPlayed: lastKnownRound, ageMs: Date.now() - live.receivedAt });
});

app.get('/api/matchzy/playerstats', async (req, res) => {
  const live = currentLiveStats();
  if (live && live.stats.length) {
    return res.json({ ok: true, stats: live.stats, roundsPlayed: lastKnownRound, source: live.source, live: true });
  }
  const stats = snapshotPlayerStats();
  if (stats.length || !rcon.connected()) {
    return res.json({ ok: true, stats, roundsPlayed: lastKnownRound, source: stats.length ? 'matchzy-events' : undefined, live: false });
  }
  const status = await send('status');
  if (!status.ok) return res.json({ ok: true, stats: [], roundsPlayed: lastKnownRound, live: false });
  const parsed = parseServerStatusPlayers(status.response);
  res.json({ ok: true, stats: parsed, roundsPlayed: lastKnownRound, source: parsed.length ? 'server-status' : undefined, live: false });
});

app.post('/api/matchzy/playerstats/reset', (req, res) => {
  resetPlayerStats();
  res.json({ ok: true });
});

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'connected', data: { active: state.active, profile: state.profile } }));
});

wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Porta ${PORT} ja esta em uso. O painel provavelmente ja esta aberto em http://localhost:${PORT}\n`);
    process.exit(0);
  }
  throw err;
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Porta ${PORT} ja esta em uso. O painel provavelmente ja esta aberto em http://localhost:${PORT}\n`);
    process.exit(0);
  }
  throw err;
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/event-archive/')) return next();
  if (fs.existsSync(WEB_DIST_INDEX)) return res.sendFile(WEB_DIST_INDEX);
  return next();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  CS2 LAN Manager: http://localhost:${PORT}\n`);
});
