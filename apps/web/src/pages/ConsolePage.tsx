type ConsolePageProps = {
  rconHost: string;
  rconPort: number;
  rconPassword: string;
  rconConnected: boolean;
  logs: string[];
  consoleLogs: string[];
  command: string;
  onRconChange: (field: 'rconHost' | 'rconPort' | 'rconPassword', value: string) => void;
  onConnect: () => void;
  onCommandChange: (value: string) => void;
  onSendCommand: (commandOverride?: string) => void;
};

const quickCommands = [
  ['status', 'status'],
  ['matchzy_status', 'mz status'],
  ['matchzy_listready', 'mz ready'],
  ['matchzy_unpause', 'mz unpause'],
  ['matchzy_pause', 'mz pause'],
  ['matchzy_knife', 'mz knife'],
  ['matchzy_endmatch', 'mz endmatch'],
  ['css_plugins list', 'plugins'],
  ['mp_warmup_end', 'warmup_end'],
  ['mp_restartgame 1', 'restart'],
  ['mp_unpause_match', 'unpause'],
  ['bot_kick', 'bot_kick'],
  ['sv_pure 0', 'sv_pure 0'],
  ['sv_pure 1', 'sv_pure 1'],
  ['changelevel de_mirage', 'Mirage'],
  ['changelevel de_inferno', 'Inferno'],
  ['changelevel de_dust2', 'Dust2'],
  ['changelevel de_nuke', 'Nuke'],
  ['changelevel de_anubis', 'Anubis'],
  ['changelevel de_ancient', 'Ancient'],
  ['changelevel de_overpass', 'Overpass']
];

export function ConsolePage({
  rconHost,
  rconPort,
  rconPassword,
  rconConnected,
  logs,
  consoleLogs,
  command,
  onRconChange,
  onConnect,
  onCommandChange,
  onSendCommand
}: ConsolePageProps) {
  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-heading">
          <div className="section-title">Conexao RCON</div>
          <div className="inline-actions">
            <span className={rconConnected ? 'feed-chip live' : 'feed-chip'}>
              {rconConnected ? 'RCON conectado' : 'RCON desconectado'}
            </span>
          </div>
        </div>
        <div className="form-grid three">
          <label>Host<input value={rconHost} onChange={(event) => onRconChange('rconHost', event.target.value)} /></label>
          <label>Porta<input value={rconPort} onChange={(event) => onRconChange('rconPort', event.target.value)} /></label>
          <label>Senha<input value={rconPassword} onChange={(event) => onRconChange('rconPassword', event.target.value)} /></label>
        </div>
        <button className="primary-action compact" type="button" onClick={onConnect}>Conectar</button>
      </section>

      <section className="panel">
        <div className="section-title">Atalhos</div>
        <div className="chip-grid">
          {quickCommands.map(([cmd, label]) => (
            <button key={cmd} className="console-chip" type="button" onClick={() => onSendCommand(cmd)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-title">Log do sistema</div>
        <div className="console-box log-stream">
          {logs.length ? logs.map((line, index) => <div key={`${line}-${index}`}>{line}</div>) : <div>Aguardando eventos.</div>}
        </div>
      </section>

      <section className="panel">
        <div className="section-title">Console RCON</div>
        <div className="console-box">
          {consoleLogs.length ? consoleLogs.map((line, index) => <div key={`${line}-${index}`}>{line}</div>) : <div>Console pronto.</div>}
        </div>
        <div className="command-row">
          <input value={command} onChange={(event) => onCommandChange(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onSendCommand()} placeholder="Comando RCON..." />
          <button className="primary-action compact" type="button" onClick={() => onSendCommand()}>Enviar</button>
        </div>
      </section>
    </div>
  );
}
