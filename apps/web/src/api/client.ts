import type { Backup, EventSetupConfig, EventSetupResponse, EventStatsResponse, LaunchConfig, PlayerStat, ScoreStatus, ServerStatus, VetoConfig } from '../types';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data as T;
}

export const api = {
  status: () => request<ServerStatus>('/api/status'),
  score: () => request<{ ok: true; status: ScoreStatus }>('/api/matchzy/score'),
  backups: () => request<{ ok: true; backups: Backup[] }>('/api/matchzy/backups'),
  playerStats: () => request<{ ok: true; stats: PlayerStat[]; roundsPlayed: number; live?: boolean; source?: string }>('/api/matchzy/playerstats'),
  eventMatches: () => request<EventStatsResponse>('/api/event/matches'),
  eventSetup: () => request<EventSetupResponse>('/api/event/setup'),
  saveEventSetup: (setup: EventSetupConfig) => request<EventSetupResponse>('/api/event/setup', {
    method: 'POST',
    body: JSON.stringify(setup)
  }),
  launch: (config: LaunchConfig) => request<{ ok: true; profile: string; pid?: number }>('/api/launch', {
    method: 'POST',
    body: JSON.stringify(config)
  }),
  startVeto: (payload: { config: LaunchConfig; veto: VetoConfig }) =>
    request<{ ok: true; profile: string; pid?: number; config: LaunchConfig; veto: VetoConfig }>('/api/veto/start', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  stopSession: () => request<{ ok: true }>('/api/session/stop', { method: 'POST', body: '{}' }),
  connectRcon: (payload: { rconHost: string; rconPort: number; rconPassword: string }) =>
    request<{ ok: true }>('/api/rcon/connect', { method: 'POST', body: JSON.stringify(payload) }),
  action: (name: string) => request<{ ok: boolean; response?: string }>(`/api/action/${name}`, { method: 'POST', body: '{}' }),
  restoreRound: (round: number) => request<{ ok: boolean; response?: string; command?: string; file?: string }>(
    '/api/matchzy/restore',
    {
      method: 'POST',
      body: JSON.stringify({ round })
    }
  ),
  redoRound: () => request<{ ok: boolean; response?: string; command?: string; round?: number }>('/api/matchzy/redo-round', {
    method: 'POST',
    body: '{}'
  }),
  sendCommand: (command: string) => request<{ ok: boolean; response?: string; simulated?: boolean }>('/api/rcon/send', {
    method: 'POST',
    body: JSON.stringify({ command })
  }),
  endAndArchive: () => request<{ ok: true }>('/api/match/end-archive', { method: 'POST', body: '{}' })
};
