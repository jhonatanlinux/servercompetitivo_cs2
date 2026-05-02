import { useEffect, useMemo, useState } from 'react';
import { api } from './api/client';
import { Shell } from './components/Shell';
import { BroadcastPage } from './pages/BroadcastPage';
import { ConsolePage } from './pages/ConsolePage';
import { EventPage } from './pages/EventPage';
import { MatchPage } from './pages/MatchPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { SetupPage } from './pages/SetupPage';
import { StatsPage } from './pages/StatsPage';
import { VetoPage } from './pages/VetoPage';
import type { Backup, EventPlan, EventSetupConfig, EventStatsResponse, LaunchConfig, PlayerStat, ScoreStatus, ServerStatus, TabKey, VetoConfig } from './types';

const officialMapPool = ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass'];

const defaultConfig: LaunchConfig = {
  eventName: 'MT PRO LEAGUE',
  teamCT: 'Team Alpha',
  teamT: 'Team Beta',
  profile: 'competitive',
  useMatchzy: true,
  maps: ['de_mirage'],
  map: 'de_mirage',
  numMaps: 1,
  skipVeto: false,
  minReady: 10,
  gotv: true,
  demo: true,
  warmup: true,
  skins: false,
  rconHost: '127.0.0.1',
  rconPort: 27015,
  rconPassword: 'cs2lan',
  maxRounds: '24',
  timeoutDur: '30',
  svPass: '',
  playersCT: [],
  playersT: [],
  botScenario: false
};

const defaultVeto: VetoConfig = {
  series: 'md1',
  pool: officialMapPool,
  bansCT: [],
  bansT: [],
  picksCT: [],
  picksT: [],
  maps: ['de_mirage'],
  startMap: 'de_mirage',
  sideChoice: 'knife',
  sideTeam: 'CT',
  vetoFirst: 'CT'
};

const defaultEventSetup: EventSetupConfig = {
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
  notes: ''
};

export function App() {
  const broadcastRoute = window.location.pathname === '/transmissao' || window.location.pathname === '/overlay';
  const [tab, setTab] = useState<TabKey>('setup');
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [score, setScore] = useState<ScoreStatus | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [stats, setStats] = useState<PlayerStat[]>([]);
  const [eventStats, setEventStats] = useState<EventStatsResponse | null>(null);
  const [config, setConfig] = useState<LaunchConfig>(defaultConfig);
  const [veto, setVeto] = useState<VetoConfig>(defaultVeto);
  const [eventSetup, setEventSetup] = useState<EventSetupConfig>(() => {
    return defaultEventSetup;
  });
  const [eventPlan, setEventPlan] = useState<EventPlan>({ summary: [], groups: [], stages: [] });
  const [logs, setLogs] = useState<string[]>([]);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [command, setCommand] = useState('');

  const loadStatus = async () => {
    try {
      setStatus(await api.status());
    } catch {
      setStatus(null);
    }
  };

  const loadLiveData = async () => {
    const tasks = [
      api.backups().then((data) => setBackups(data.backups)),
      api.playerStats().then((data) => setStats(data.stats))
    ];
    if (status?.rcon) {
      tasks.push(api.score().then((data) => setScore(data.status)));
    } else {
      setScore(null);
    }
    await Promise.allSettled(tasks);
  };

  const loadEventStats = async () => {
    try {
      setEventStats(await api.eventMatches());
    } catch {
      setEventStats(null);
    }
  };

  const loadEventSetup = async () => {
    try {
      const response = await api.eventSetup();
      setEventSetup(response.setup);
      setEventPlan(response.plan);
    } catch {
      setEventSetup(defaultEventSetup);
      setEventPlan({ summary: [], groups: [], stages: [] });
    }
  };

  useEffect(() => {
    loadStatus();
    loadEventStats();
    loadEventSetup();
    const timer = window.setInterval(loadStatus, 4000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const wsPort = window.location.port === '5173' ? '3001' : (window.location.port || '3001');
    const ws = new WebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:${wsPort}`);
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'log') {
          const line = `[${message.data.time || '--:--'}] ${message.data.message}`;
          setLogs((old) => [...old, line].slice(-500));
        }
        if (message.type === 'status') {
          setStatus((old) => old ? { ...old, ...message.data } : message.data);
        }
      } catch {
        // Ignore malformed websocket payloads.
      }
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    if (tab === 'match' || tab === 'stats') {
      loadLiveData();
      const timer = window.setInterval(loadLiveData, 4000);
      if (tab === 'stats') loadEventStats();
      return () => window.clearInterval(timer);
    }
    if (tab === 'event') {
      loadEventStats();
    }
  }, [status?.rcon, tab]);

  const active = Boolean(status?.active);
  const page = useMemo(() => {
    if (tab === 'setup') {
      return (
        <SetupPage
          config={config}
          eventSetup={eventSetup}
          status={status}
          active={active}
          onConfigChange={setConfig}
          onLaunch={async (profile = 'competitive') => {
            const next = { ...config, profile };
            setScore(null);
            setBackups([]);
            setStats([]);
            setConfig(next);
            await api.launch(next);
            setLogs((old) => [`Servidor iniciado (${profile}).`, ...old]);
            await loadStatus();
          }}
          onLaunchBotLab={async () => {
            const next: LaunchConfig = {
              ...config,
              eventName: `${config.eventName || 'MT PRO LEAGUE'} - BOT LAB`,
              teamCT: config.teamCT && config.teamCT !== 'Team Alpha' ? config.teamCT : 'BOT CT',
              teamT: config.teamT && config.teamT !== 'Team Beta' ? config.teamT : 'BOT TR',
              profile: 'mix',
              skins: config.skins,
              useMatchzy: true,
              gotv: true,
              demo: true,
              warmup: true,
              minReady: 10,
              botScenario: true
            };
            setScore(null);
            setBackups([]);
            setStats([]);
            setConfig(next);
            await api.launch(next);
            setLogs((old) => ['Bot Lab competitivo iniciado. Entre como SPEC para acompanhar.', ...old]);
            await Promise.allSettled([loadStatus(), loadLiveData()]);
            setTab('match');
          }}
          onStop={async () => {
            await api.stopSession();
            setLogs((old) => ['Sessao encerrada.', ...old]);
            await loadStatus();
          }}
        />
      );
    }

    if (tab === 'match') {
      return (
        <MatchPage
          score={score}
          backups={backups}
          teamCT={config.teamCT}
          teamT={config.teamT}
          onAction={async (action) => {
            if (action === 'skins-on') await api.sendCommand('sv_pure 0');
            else if (action === 'skins-off') await api.sendCommand('sv_pure 1');
            else await api.action(action);
            setLogs((old) => [`Acao enviada: ${action}`, ...old]);
          }}
          onRefreshBackups={loadLiveData}
          onRestoreRound={async (round) => {
            if (!window.confirm(`Restaurar o round ${round}? A partida deve voltar pausada apos o restore.`)) return;
            const response = await api.restoreRound(round);
            setLogs((old) => [`Restore solicitado para R${round}.`, response.response || response.command || 'OK', ...old]);
            window.setTimeout(() => { void loadLiveData(); }, 1500);
          }}
          onRedoRound={async () => {
            if (!window.confirm('Refazer o round atual do zero?')) return;
            const response = await api.redoRound();
            setLogs((old) => [`Redo solicitado para R${response.round ?? '?'}.`, response.response || response.command || 'OK', ...old]);
            window.setTimeout(() => { void loadLiveData(); }, 1500);
          }}
          onEndAndArchive={async () => {
            if (!window.confirm('Encerrar e arquivar a partida atual?')) return;
            await api.endAndArchive();
            setLogs((old) => ['Partida encerrada e arquivada.', ...old]);
            await Promise.allSettled([loadStatus(), loadEventStats(), loadLiveData()]);
            setTab('event');
          }}
        />
      );
    }

    if (tab === 'stats') {
      return <StatsPage score={score} stats={stats} teamCT={config.teamCT} teamT={config.teamT} history={eventStats?.matches || []} />;
    }

    if (tab === 'veto') {
      return (
        <VetoPage
          config={config}
          veto={veto}
          active={active}
          onVetoChange={setVeto}
          onStart={async (nextVeto) => {
            setScore(null);
            setBackups([]);
            setStats([]);
            const response = await api.startVeto({ config: { ...config, profile: 'mix', skins: true }, veto: nextVeto });
            setConfig(response.config);
            setVeto(response.veto);
            setLogs((old) => [`Veto aplicado: ${response.veto.label || response.veto.series}. Aguardando .ready dos players.`, ...old]);
            await Promise.allSettled([loadStatus(), loadLiveData()]);
            setTab('match');
          }}
        />
      );
    }

    if (tab === 'event') {
      return (
        <EventPage
          data={eventStats}
          eventSetup={eventSetup}
          eventPlan={eventPlan}
          onEventSetupChange={setEventSetup}
          onSaveEventSetup={async (nextSetup) => {
            const response = await api.saveEventSetup(nextSetup);
            setEventSetup(response.setup);
            setEventPlan(response.plan);
            setLogs((old) => ['Configuracao do evento salva.', ...old]);
          }}
          onRefresh={loadEventStats}
        />
      );
    }

    if (tab === 'console') {
      return (
        <ConsolePage
          rconHost={config.rconHost}
          rconPort={config.rconPort}
          rconPassword={config.rconPassword}
          rconConnected={Boolean(status?.rcon)}
          logs={logs}
          consoleLogs={consoleLogs}
          command={command}
          onRconChange={(field, value) => {
            setConfig((old) => ({ ...old, [field]: field === 'rconPort' ? Number(value || 0) : value }));
          }}
          onConnect={async () => {
            await api.connectRcon({
              rconHost: config.rconHost,
              rconPort: config.rconPort,
              rconPassword: config.rconPassword
            });
            setLogs((old) => ['RCON conectado.', ...old]);
            await loadStatus();
          }}
          onCommandChange={setCommand}
          onSendCommand={async (commandOverride) => {
            const next = (commandOverride ?? command).trim();
            if (!next) return;
            const response = await api.sendCommand(next);
            setConsoleLogs((old) => [...old, `> ${next}`, response.response || (response.simulated ? '[simulado - RCON offline]' : 'OK')].slice(-500));
            if (!commandOverride) setCommand('');
          }}
        />
      );
    }

    return <PlaceholderPage title="Veto" />;
  }, [active, backups, command, config, consoleLogs, eventPlan, eventSetup, eventStats, logs, score, stats, status, tab, veto]);

  if (broadcastRoute) {
    return <BroadcastPage initialScore={score} initialStats={stats} initialStatus={status} />;
  }

  return (
    <Shell status={status} tab={tab} onTabChange={setTab}>
      {page}
    </Shell>
  );
}
