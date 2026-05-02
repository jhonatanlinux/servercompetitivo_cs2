import { useMemo, useState } from 'react';
import type { EventSetupConfig, LaunchConfig, ServerStatus } from '../types';

type PlayerEntry = LaunchConfig['playersCT'][number];

type SetupPageProps = {
  config: LaunchConfig;
  eventSetup: EventSetupConfig;
  status: ServerStatus | null;
  onConfigChange: (config: LaunchConfig) => void;
  onLaunch: (profile?: 'competitive' | 'mix') => void;
  onLaunchBotLab: () => void;
  onStop: () => void;
  active: boolean;
};

const profileStorageKey = 'mtpro.setupProfiles.v1';

export function SetupPage({ config, eventSetup, status, onConfigChange, onLaunch, onLaunchBotLab, onStop, active }: SetupPageProps) {
  const [profiles, setProfiles] = useState<Record<string, LaunchConfig>>(() => loadProfiles());
  const set = <K extends keyof LaunchConfig>(key: K, value: LaunchConfig[K]) => {
    onConfigChange({ ...config, [key]: value });
  };
  const checks = useMemo(() => buildPrematchChecks(config, status), [config, status]);
  const readinessReport = useMemo(() => buildReadinessReport(config, checks), [config, checks]);

  const applyEventTeam = (side: 'CT' | 'T', teamName: string) => {
    const eventTeam = eventSetup.teams.find((team) => team.name === teamName || team.shortName === teamName);
    if (!eventTeam) return;
    const keyName = side === 'CT' ? 'teamCT' : 'teamT';
    const keyPlayers = side === 'CT' ? 'playersCT' : 'playersT';
    onConfigChange({
      ...config,
      [keyName]: eventTeam.name,
      [keyPlayers]: eventTeam.players.filter((player) => player.name || player.steamid)
    });
  };

  const rosterSlots = (players: PlayerEntry[]) => {
    const slots = players.length >= 5 ? [...players] : [...players, ...Array.from({ length: 5 - players.length }, () => ({ steamid: '', name: '' }))];
    return slots.length ? slots : Array.from({ length: 5 }, () => ({ steamid: '', name: '' }));
  };

  const updateRoster = (team: 'CT' | 'T', index: number, field: keyof PlayerEntry, value: string) => {
    const key = team === 'CT' ? 'playersCT' : 'playersT';
    const next = rosterSlots(config[key]).map((player, slotIndex) => (
      slotIndex === index ? { ...player, [field]: value } : player
    ));
    set(key, next as LaunchConfig[typeof key]);
  };

  const clearRoster = (team: 'CT' | 'T') => {
    set(team === 'CT' ? 'playersCT' : 'playersT', [] as LaunchConfig['playersCT']);
  };

  const saveProfile = () => {
    const fallback = `${config.eventName || 'evento'}-${config.teamCT || 'ct'}-vs-${config.teamT || 'tr'}`.toLowerCase().replace(/\s+/g, '-');
    const name = window.prompt('Nome do perfil', fallback);
    if (!name) return;
    const next = { ...profiles, [name]: config };
    persistProfiles(next);
    setProfiles(next);
    window.alert('Perfil salvo.');
  };

  const loadProfile = (name: string) => {
    const profile = profiles[name];
    if (!profile) return;
    onConfigChange({ ...config, ...profile });
  };

  const deleteProfile = (name: string) => {
    if (!name) return;
    const next = { ...profiles };
    delete next[name];
    persistProfiles(next);
    setProfiles(next);
    window.alert('Perfil excluido.');
  };

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(readinessReport);
      window.alert('Relatorio copiado.');
    } catch {
      window.alert('Nao foi possivel copiar o relatorio.');
    }
  };

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-title">Evento</div>
        <div className="form-grid three">
          <label>
            Nome do evento
            <input value={config.eventName} onChange={(event) => set('eventName', event.target.value)} />
          </label>
          <label>
            Time CT
            <input value={config.teamCT} onChange={(event) => set('teamCT', event.target.value)} />
          </label>
          <label>
            Time T
            <input value={config.teamT} onChange={(event) => set('teamT', event.target.value)} />
          </label>
        </div>
        <div className="form-grid two">
          <label>
            Puxar time do evento para CT
            <select value="" onChange={(event) => { if (event.target.value) applyEventTeam('CT', event.target.value); event.target.value = ''; }}>
              <option value="">Selecionar time cadastrado</option>
              {eventSetup.teams.map((team) => (
                <option key={team.id} value={team.name}>{team.name}</option>
              ))}
            </select>
          </label>
          <label>
            Puxar time do evento para T
            <select value="" onChange={(event) => { if (event.target.value) applyEventTeam('T', event.target.value); event.target.value = ''; }}>
              <option value="">Selecionar time cadastrado</option>
              {eventSetup.teams.map((team) => (
                <option key={team.id} value={team.name}>{team.name}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div className="section-title">Perfis salvos</div>
          <div className="inline-actions">
            <button className="ghost-action compact" type="button" onClick={saveProfile}>Salvar perfil</button>
          </div>
        </div>
        <div className="profile-list">
          {Object.keys(profiles).length ? Object.keys(profiles).sort().map((name) => (
            <div className="profile-card" key={name}>
              <strong>{name}</strong>
              <div className="inline-actions">
                <button className="ghost-action compact" type="button" onClick={() => loadProfile(name)}>Carregar</button>
                <button className="ghost-action compact danger-outline" type="button" onClick={() => deleteProfile(name)}>Excluir</button>
              </div>
            </div>
          )) : <div className="empty-state">Nenhum perfil salvo ainda.</div>}
        </div>
      </section>

      <section className="panel roster-panel">
        <div className="panel-heading">
          <div className="section-title">Lineup da serie atual</div>
          <div className="roster-actions">
            <button className="ghost-action mini" type="button" onClick={() => clearRoster('CT')}>Limpar CT</button>
            <button className="ghost-action mini" type="button" onClick={() => clearRoster('T')}>Limpar T</button>
          </div>
        </div>
        <div className="roster-grid">
          <RosterEditor side="CT" title={config.teamCT || 'Time CT'} players={rosterSlots(config.playersCT)} onChange={(index, field, value) => updateRoster('CT', index, field, value)} />
          <RosterEditor side="T" title={config.teamT || 'Time T'} players={rosterSlots(config.playersT)} onChange={(index, field, value) => updateRoster('T', index, field, value)} />
        </div>
      </section>

      <section className="panel">
        <div className="section-title">Tipo de evento</div>
        <div className="preset-grid">
          {[
            ['competitive', 'Major / Pro Rules', 'MR12, OT MR3, demo, GOTV e sv_pure 1.'],
            ['competitive', 'LAN Tournament', 'Competitivo flexivel para torneios locais.'],
            ['mix', 'Mix / Showmatch', 'Skins liberadas e operacao mais leve.'],
            ['competitive', 'Treino / Practice', 'Servidor aberto para testes e aquecimento.']
          ].map(([profile, title, detail]) => (
            <button key={title} type="button" className={config.profile === profile && title.includes('Major') ? 'preset-card on' : 'preset-card'} onClick={() => set('profile', profile as LaunchConfig['profile'])}>
              <span className="preset-kicker">{profile === 'mix' ? 'Showmatch' : 'Oficial'}</span>
              <strong>{title}</strong>
              <span>{detail}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-title">Opcoes</div>
        <div className="toggle-grid">
          <label className="switch-row"><span>GOTV</span><input type="checkbox" checked={config.gotv} onChange={(event) => set('gotv', event.target.checked)} /></label>
          <label className="switch-row"><span>Gravar demo</span><input type="checkbox" checked={config.demo} onChange={(event) => set('demo', event.target.checked)} /></label>
          <label className="switch-row"><span>Warmup ao iniciar</span><input type="checkbox" checked={config.warmup} onChange={(event) => set('warmup', event.target.checked)} /></label>
          <label className="switch-row"><span>Skins personalizadas</span><input type="checkbox" checked={config.skins} onChange={(event) => set('skins', event.target.checked)} /></label>
        </div>
        <div className="form-grid three">
          <label>Senha do servidor<input value={config.svPass} onChange={(event) => set('svPass', event.target.value)} placeholder="vazio = sem senha" /></label>
          <label>Max rounds<select value={config.maxRounds} onChange={(event) => set('maxRounds', event.target.value)}><option value="24">24 - MR12</option><option value="30">30 - MR15</option></select></label>
          <label>Timeout duracao (s)<input type="number" min="10" max="300" value={config.timeoutDur} onChange={(event) => set('timeoutDur', event.target.value)} /></label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div className="section-title">Pre-match</div>
          <div className="inline-actions">
            <button className="ghost-action compact" type="button" onClick={() => onConfigChange({ ...config })}>Verificar prontidao</button>
            <button className="ghost-action compact" type="button" onClick={copyReport}>Copiar relatorio</button>
          </div>
        </div>
        <div className="prematch-grid-react">
          {checks.map((check) => (
            <article key={check.label} className={`prematch-card-react ${check.state}`}>
              <b>{check.label}</b>
              <span>{check.detail}</span>
            </article>
          ))}
        </div>
        <pre className="report-box">{readinessReport}</pre>
      </section>

      <section className="panel">
        <div className="section-title">Iniciar</div>
        <div className="ops-checklist-react">
          {checks.map((check) => (
            <span key={`chip-${check.label}`} className={check.state === 'ok' ? 'feed-chip live' : check.state === 'warn' ? 'feed-chip' : 'feed-chip danger-chip'}>
              {check.label}
            </span>
          ))}
        </div>
        <div className="action-row">
          <button className="primary-action" disabled={active} type="button" onClick={() => onLaunch('competitive')}>Iniciar competitivo</button>
          <button className="blue-action" disabled={active} type="button" onClick={() => onLaunch('mix')}>Iniciar mix</button>
          <button className="bot-action" type="button" onClick={onLaunchBotLab}>Bot Lab competitivo</button>
          <button className="danger-action" disabled={!active} type="button" onClick={onStop}>Encerrar sessao</button>
        </div>
      </section>
    </div>
  );
}

function RosterEditor({ side, title, players, onChange }: { side: 'CT' | 'T'; title: string; players: PlayerEntry[]; onChange: (index: number, field: keyof PlayerEntry, value: string) => void; }) {
  return (
    <div className={`roster-card roster-${side.toLowerCase()}`}>
      <div className="roster-head">
        <strong>{title}</strong>
        <span>{side}</span>
      </div>
      <div className="roster-row roster-row-head"><span>#</span><span>Player</span><span>SteamID64</span></div>
      {players.map((player, index) => (
        <div className="roster-row" key={`${side}-${index}`}>
          <span className="roster-num">{index + 1}</span>
          <input value={player.name} placeholder={`Player ${index + 1}`} onChange={(event) => onChange(index, 'name', event.target.value)} />
          <input value={player.steamid} placeholder="76561198000000000" inputMode="numeric" onChange={(event) => onChange(index, 'steamid', event.target.value)} />
        </div>
      ))}
    </div>
  );
}

function loadProfiles(): Record<string, LaunchConfig> {
  try {
    const raw = window.localStorage.getItem(profileStorageKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistProfiles(profiles: Record<string, LaunchConfig>) {
  try {
    window.localStorage.setItem(profileStorageKey, JSON.stringify(profiles));
  } catch {
    window.alert('Nao foi possivel salvar o perfil neste navegador.');
  }
}

function buildPrematchChecks(config: LaunchConfig, status: ServerStatus | null) {
  const plugins = status?.plugins || {};
  return [
    { label: 'Backend', state: status ? 'ok' : 'fail', detail: status ? 'API respondendo em 3001' : 'API offline' },
    { label: 'CS2 DS', state: status?.cs2Exe ? 'ok' : 'warn', detail: status?.cs2Exe || 'Servidor sera localizado no launch' },
    { label: 'MatchZy', state: plugins.matchzy ? 'ok' : config.useMatchzy ? 'fail' : 'warn', detail: plugins.matchzy ? 'Plugin detectado' : config.useMatchzy ? 'Plugin nao detectado' : 'Nao obrigatorio no manual' },
    { label: 'CounterStrikeSharp', state: plugins.counterStrikeSharp ? 'ok' : 'fail', detail: plugins.counterStrikeSharp ? 'Detectado' : 'Nao detectado' },
    { label: 'Times', state: config.teamCT && config.teamT ? 'ok' : 'warn', detail: config.teamCT && config.teamT ? `${config.teamCT} vs ${config.teamT}` : 'Preencha os nomes dos times' },
    { label: 'Lineups', state: config.playersCT.filter(hasPlayer).length === 5 && config.playersT.filter(hasPlayer).length === 5 ? 'ok' : 'warn', detail: `CT ${config.playersCT.filter(hasPlayer).length}/5 | T ${config.playersT.filter(hasPlayer).length}/5` },
    { label: 'GOTV', state: config.gotv ? 'ok' : 'warn', detail: config.gotv ? 'Porta 27020 habilitada' : 'GOTV desligado' },
    { label: 'Demo', state: config.demo ? 'ok' : 'warn', detail: config.demo ? 'Gravacao ligada' : 'Demo desligada' },
    { label: 'RCON', state: status?.rcon ? 'ok' : 'warn', detail: status?.rcon ? 'Conectado' : 'Nao conectado' },
    { label: 'Skins', state: config.skins ? 'warn' : 'ok', detail: config.skins ? 'Skins ON' : 'sv_pure competitivo' }
  ] as Array<{ label: string; state: 'ok' | 'warn' | 'fail'; detail: string }>;
}

function buildReadinessReport(config: LaunchConfig, checks: Array<{ label: string; state: 'ok' | 'warn' | 'fail'; detail: string }>) {
  const ok = checks.filter((check) => check.state === 'ok').length;
  const warn = checks.filter((check) => check.state === 'warn').length;
  const fail = checks.filter((check) => check.state === 'fail').length;
  return [
    'RELATORIO PRE-MATCH',
    `Evento: ${config.eventName || 'CS2 LAN'}`,
    `Times: ${config.teamCT || 'Time CT'} vs ${config.teamT || 'Time T'}`,
    `Preset: ${(config.profile || 'competitive').toUpperCase()} | Serie: BO${config.numMaps || 1} | Mapas: ${(config.maps || []).join(', ') || config.map || 'nao definido'}`,
    `Resumo: OK ${ok} | Avisos ${warn} | Falhas ${fail}`,
    ...checks.map((check) => `- ${check.state.toUpperCase()}: ${check.label} - ${check.detail}`)
  ].join('\n');
}

function hasPlayer(player: PlayerEntry) {
  return Boolean(player && (player.name || player.steamid));
}
