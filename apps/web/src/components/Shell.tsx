import type { ReactNode } from 'react';
import type { ServerStatus, TabKey } from '../types';

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'setup', label: 'Setup' },
  { key: 'match', label: 'Match' },
  { key: 'veto', label: 'Veto' },
  { key: 'stats', label: 'Stats' },
  { key: 'event', label: 'Evento' },
  { key: 'console', label: 'Console' }
];

type ShellProps = {
  status: ServerStatus | null;
  tab: TabKey;
  onTabChange: (tab: TabKey) => void;
  children: ReactNode;
};

export function Shell({ status, tab, onTabChange, children }: ShellProps) {
  const matchStateLabel = formatMatchState(status?.matchState);
  return (
    <div className="app-shell">
      <div className="map-backdrop map-layer-one" />
      <div className="map-backdrop map-layer-two" />
      <header className="topbar">
        <div className="brand-row">
          <img className="brand-logo" src="/logo.jpeg" alt="MT PRO LEAGUE" />
          <div>
            <div className="brand-title">MT PRO LEAGUE</div>
            <div className="brand-subtitle">CS2 Tournament Manager</div>
          </div>
        </div>
        <div className="topbar-right">
          <div className="topbar-stat">
            <span>Servidor</span>
            <strong>{status?.active ? status.profile || 'Online' : 'Offline'}</strong>
          </div>
          <div className="topbar-stat state-stat">
            <span>Estado</span>
            <strong>{matchStateLabel}</strong>
          </div>
          <div className="status-pill">
            <span className={status?.active ? 'dot on' : 'dot'} />
            <span>{status?.active ? 'Ao vivo' : 'Standby'}</span>
            <small>{status?.rcon ? 'RCON conectado' : 'RCON off'}</small>
          </div>
        </div>
      </header>
      <nav className="nav-row" aria-label="Paginas do painel">
        {tabs.map((item) => (
          <button
            key={item.key}
            className={item.key === tab ? 'nav-tab on' : 'nav-tab'}
            type="button"
            onClick={() => onTabChange(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main className="page-wrap">{children}</main>
    </div>
  );
}

function formatMatchState(state?: string | null) {
  const labels: Record<string, string> = {
    idle: 'Standby',
    setup: 'Setup',
    warmup: 'Warmup',
    ready: 'Ready',
    knife: 'Knife',
    live: 'Live',
    paused: 'Pausado',
    tech_paused: 'Tech pause',
    restore_pending: 'Restore',
    ended: 'Encerrado',
    archived: 'Arquivado',
  };
  return state ? labels[state] || state : 'Standby';
}
