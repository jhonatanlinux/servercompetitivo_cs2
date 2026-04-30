const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const rcon = require('./rcon');
const cfgGenerator = require('./cfgGenerator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = Number(process.env.CS2_PANEL_PORT || 3001);
const ROOT_DIR = path.join(__dirname, '..');
const CFG_DIR = path.join(ROOT_DIR, 'cs2-configs');
const DS_DIR = path.join(ROOT_DIR, 'cs2-ds');
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
app.use(express.static(path.join(ROOT_DIR, 'frontend')));

let state = {
  active: false,
  config: null,
  startedAt: null,
  profile: null,
  processPid: null,
  cs2Exe: null,
};
let matchJson = null;
let serverProcess = null;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function q(value) {
  return String(value ?? '').replace(/"/g, "'");
}

function normalizeConfig(input) {
  const profile = input.profile === 'mix' || input.skins ? 'mix' : 'competitive';
  const maxRounds = Number(input.maxRounds || 24);
  const timeoutDur = Number(input.timeoutDur || 30);
  const rconPort = Number(input.rconPort || input.port || 27015);
  const rconPassword = input.rconPassword || input.password || DEFAULT_RCON_PASSWORD;

  return {
    ...input,
    profile,
    skins: profile === 'mix',
    customSkins: profile === 'mix',
    autoDemo: input.demo !== false,
    unlimitedWarmup: input.warmup !== false,
    serverPassword: input.svPass || input.serverPassword || '',
    rconHost: input.rconHost || input.host || '127.0.0.1',
    rconPort,
    rconPassword,
    maxRounds,
    timeoutDur,
    map: input.map || 'de_mirage',
    maps: Array.isArray(input.maps) && input.maps.length ? input.maps : [input.map || 'de_mirage'],
    minReady: Number(input.minReady || 1),
    numMaps: Number(input.numMaps || 1),
    useMatchzy: input.useMatchzy !== false,
    gotv: input.gotv !== false,
    overtime: true,
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

async function connectRconWithRetry(c, attempts = 40) {
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
    '-maxplayers_override', '10',
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
  const buildPlayers = (list) => {
    const out = {};
    if (Array.isArray(list)) {
      list.forEach((p) => {
        if (p.steamid) out[p.steamid] = p.name || p.steamid;
      });
    }
    return out;
  };

  return {
    matchid: `match_${Date.now()}`,
    num_maps: c.numMaps,
    maplist: c.maps.slice(0, Math.max(c.numMaps, 1)),
    players_per_team: 5,
    min_players_to_ready: c.minReady,
    min_spectators_to_ready: 0,
    skip_veto: Boolean(c.skipVeto),
    veto_first: 'team1',
    side_type: 'standard',
    clinch_series: true,
    team1: {
      name: c.teamCT || 'Team CT',
      tag: (c.teamCT || 'CT').slice(0, 4).toUpperCase(),
      players: buildPlayers(c.playersCT),
    },
    team2: {
      name: c.teamT || 'Team T',
      tag: (c.teamT || 'T').slice(0, 4).toUpperCase(),
      players: buildPlayers(c.playersT),
    },
    cvars: {
      mp_maxrounds: String(c.maxRounds),
      mp_overtime_enable: '1',
      mp_overtime_maxrounds: '6',
      mp_overtime_startmoney: '10000',
      mp_team_timeout_time: String(c.timeoutDur),
      mp_technical_timeout_duration_s: '120',
      sv_pure: c.skins ? '0' : '1',
    },
  };
}

async function launchMatchzy(c) {
  matchJson = buildMatchzyJson(c);
  saveMatchJsonSnapshot();
  log('matchzy_match.json gerado', 'ok');

  const url = `http://127.0.0.1:${PORT}/api/matchzy/serve`;
  await send(`matchzy_loadmatch_url "${url}"`);
  log('MatchZy: match carregado pelo painel.', 'ok');
}

async function configureRunningServer(c) {
  const cmds = [
    `hostname "${q(c.eventName || 'MT PRO LEAGUE')} | ${q(c.teamCT || 'CT')} vs ${q(c.teamT || 'T')}"`,
    `sv_password "${q(c.serverPassword || '')}"`,
    `rcon_password "${q(c.rconPassword)}"`,
    c.skins ? 'sv_pure 0' : 'sv_pure 1',
    'sv_lan 1',
    'mp_competitive_official_5v5 1',
    `mp_maxrounds ${c.maxRounds}`,
    'mp_halftime 1',
    'mp_overtime_enable 1',
    'mp_overtime_maxrounds 6',
    'mp_overtime_startmoney 10000',
    `mp_team_timeout_time ${c.timeoutDur}`,
    'mp_technical_timeout_per_team 1',
    'mp_technical_timeout_duration_s 120',
    'mp_freezetime 15',
    'mp_buytime 20',
    'mp_roundtime_defuse 1.92',
    `mp_teamname_1 "${q(c.teamCT || 'Team CT')}"`,
    `mp_teamname_2 "${q(c.teamT || 'Team T')}"`,
    c.gotv ? 'tv_enable 1' : 'tv_enable 0',
  ];

  await sendMany(cmds, 150);

  if (c.useMatchzy) {
    await launchMatchzy(c);
  } else {
    await send(`changelevel ${c.map}`);
    await sleep(2000);
    await send(c.warmup ? 'exec warmup.cfg' : 'exec match.cfg');
  }
}

app.get('/api/status', (req, res) => {
  const cs2Exe = state.cs2Exe || findCs2Exe();
  res.json({
    active: state.active,
    config: state.config,
    startedAt: state.startedAt,
    profile: state.profile,
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

    matchJson = c.useMatchzy ? buildMatchzyJson(c) : null;
    cfgGenerator.saveAll(c);
    saveMatchJsonSnapshot();
    copyGeneratedConfigs(cs2Exe);
    const healthBefore = getPluginHealth(cs2Exe);
    if (!healthBefore.metamod || !healthBefore.counterStrikeSharp) {
      log('Metamod/CounterStrikeSharp nao detectados. Rode INSTALAR-PLUGINS-SKINS.bat antes de usar MatchZy/skins.', 'warn');
    }
    if (c.profile === 'mix' && !healthBefore.skins && !healthBefore.disabledSkins) {
      log('Modo Mix selecionado, mas nenhum plugin de skins foi detectado. Comandos !knife/!gloves nao vao responder.', 'warn');
    }
    setSkinPluginsEnabled(cs2Exe, c.profile === 'mix');

    startServerProcess(c, cs2Exe);
    const connected = await connectRconWithRetry(c);
    if (!connected.ok) {
      state.active = Boolean(serverProcess);
      broadcast('status', { active: state.active, rcon: false });
      return res.status(500).json({ ok: false, error: connected.error, serverStarted: state.active });
    }

    await configureRunningServer(c);

    state.active = true;
    broadcast('status', { active: true, rcon: true });
    log('Servidor pronto para uso pelo painel.', 'ok');
    return res.json({ ok: true, profile: c.profile, pid: state.processPid });
  } catch (err) {
    log(`Erro ao iniciar: ${err.message}`, 'error');
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/matchzy/serve', (req, res) => {
  if (!matchJson) return res.status(404).json({ error: 'match nao gerado' });
  res.json(matchJson);
});

app.post('/api/session/stop', async (req, res) => {
  try {
    state.active = false;
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
  'force-ready': 'matchzy_forceready',
  'unpause': 'matchzy_unpause',
  'pause': 'matchzy_pause',
  'tech-pause': 'mp_pause_match',
  'tech-unpause': 'mp_unpause_match',
  'knife': 'matchzy_knife',
  'end-match': 'matchzy_endmatch',
  'restart-warmup': 'exec warmup.cfg',
  'start-match': 'exec match.cfg',
  'practice': 'exec practice.cfg',
  'status': 'matchzy_status',
  'plugins': 'css_plugins list',
};

Object.entries(actions).forEach(([route, cmd]) => {
  app.post(`/api/action/${route}`, async (req, res) => {
    log(cmd, 'ok');
    res.json(await send(cmd));
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

app.get('/api/matchzy/score', async (req, res) => {
  if (!rcon.connected()) return res.status(503).json({ ok: false, error: 'RCON nao conectado' });
  const r = await send('matchzy_status');
  if (!r.ok) return res.status(500).json({ ok: false, error: r.error });
  const parsed = parseMatchzyStatus(r.response);
  res.json({ ok: true, status: parsed, raw: r.response });
});

function listRoundBackups() {
  const candidates = [
    path.join(__dirname, '..', 'cs2-ds', 'game', 'csgo', 'MatchZy', 'backups'),
    path.join(__dirname, '..', 'cs2-ds', 'game', 'csgo', 'MatchZy'),
    path.join(__dirname, '..', 'cs2-ds', 'game', 'csgo', 'addons', 'counterstrikesharp', 'plugins', 'MatchZy', 'backups'),
  ];
  const seen = new Map();
  for (const dir of candidates) {
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (!/^backup.*round.*\.(json|txt|cfg)$/i.test(f) && !/round\d+.*\.(json|txt|cfg)$/i.test(f)) continue;
        const full = path.join(dir, f);
        let stat = null;
        try { stat = fs.statSync(full); } catch (e) {}
        if (!stat || !stat.isFile()) continue;
        const rm = f.match(/round[_-]?(\d+)/i);
        const round = rm ? parseInt(rm[1]) : null;
        if (seen.has(f)) continue;
        seen.set(f, {
          file: f,
          path: full,
          dir,
          round,
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
    const backups = listRoundBackups();
    res.json({ ok: true, backups });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/matchzy/restore', async (req, res) => {
  if (!rcon.connected()) return res.status(503).json({ ok: false, error: 'RCON nao conectado' });
  const round = parseInt(req.body && req.body.round);
  if (!round || round < 1) return res.status(400).json({ ok: false, error: 'round invalido' });
  const cmd = `css_restore_round ${round}`;
  log(`RESTORE ROUND ${round} -> ${cmd}`, 'warn');
  const r = await send(cmd);
  res.json({ ok: r.ok, command: cmd, response: r.response, error: r.error });
});

app.post('/api/matchzy/redo-round', async (req, res) => {
  if (!rcon.connected()) return res.status(503).json({ ok: false, error: 'RCON nao conectado' });
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


// =====================================================================
// PLAYER STATS (from MatchZy webhooks) - live K/D/A/ADR/HS/KAST/Rating
// =====================================================================

let playerStats = new Map();  // steamid -> stats
let lastKnownRound = 0;

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
  return s;
}

function resetPlayerStats() {
  playerStats = new Map();
  lastKnownRound = 0;
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

app.get('/api/matchzy/playerstats', (req, res) => {
  res.json({ ok: true, stats: snapshotPlayerStats(), roundsPlayed: lastKnownRound });
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  CS2 LAN Manager: http://localhost:${PORT}\n`);
});
