import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { PlayerStat, ScoreStatus, ServerStatus } from '../types';

type BroadcastPageProps = {
  initialScore: ScoreStatus | null;
  initialStats: PlayerStat[];
  initialStatus: ServerStatus | null;
};

export function BroadcastPage({ initialScore, initialStats, initialStatus }: BroadcastPageProps) {
  const [score, setScore] = useState<ScoreStatus | null>(initialScore);
  const [stats, setStats] = useState<PlayerStat[]>(initialStats);
  const [status, setStatus] = useState<ServerStatus | null>(initialStatus);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const loadSnapshot = async () => {
    const [scoreResult, statsResult, statusResult] = await Promise.allSettled([
      api.score(),
      api.playerStats(),
      api.status()
    ]);

    if (scoreResult.status === 'fulfilled') setScore(scoreResult.value.status);
    if (statsResult.status === 'fulfilled') setStats(statsResult.value.stats);
    if (statusResult.status === 'fulfilled') setStatus(statusResult.value);
    setLastUpdate(new Date());
  };

  useEffect(() => {
    void loadSnapshot();
    const timer = window.setInterval(loadSnapshot, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const wsPort = window.location.port === '5173' ? '3001' : (window.location.port || '3001');
    const ws = new WebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:${wsPort}`);
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'status') {
          setStatus((old) => old ? { ...old, ...message.data } : message.data);
        }
        if (message.type === 'playerstats') {
          setStats(message.data.stats || []);
          setLastUpdate(new Date());
        }
      } catch {
        // Broadcast view should stay silent for malformed websocket messages.
      }
    };
    return () => ws.close();
  }, []);

  const ctPlayers = useMemo(() => rankPlayers(stats.filter((player) => player.team === 'CT')), [stats]);
  const tPlayers = useMemo(() => rankPlayers(stats.filter((player) => player.team === 'T')), [stats]);
  const specs = useMemo(() => stats.filter((player) => player.team !== 'CT' && player.team !== 'T'), [stats]);
  const leaders = useMemo(() => rankPlayers(stats.filter((player) => player.team === 'CT' || player.team === 'T')).slice(0, 3), [stats]);

  const leftName = score?.team1Name || 'Time CT';
  const rightName = score?.team2Name || 'Time T';
  const mapName = (score?.mapName || 'de_mirage').replace('de_', '').toUpperCase();
  const live = Boolean(score?.isLive || status?.active);

  return (
    <main className="broadcast-page">
      <div className="broadcast-bg broadcast-bg-one" />
      <div className="broadcast-bg broadcast-bg-two" />

      <header className="broadcast-header">
        <div className="broadcast-brand">
          <img src="/logo.jpeg" alt="MT PRO LEAGUE" />
          <div>
            <strong>MT PRO LEAGUE</strong>
            <span>CS2 LIVE BROADCAST</span>
          </div>
        </div>
        <div className={live ? 'broadcast-live on' : 'broadcast-live'}>
          <i />
          {live ? 'AO VIVO' : 'STANDBY'}
        </div>
      </header>

      <section className="broadcast-score">
        <BroadcastTeam side="CT" name={leftName} players={ctPlayers} />
        <div className="broadcast-score-center">
          <span>{score?.matchMode || 'Aguardando partida'}</span>
          <div>
            <b>{score?.team1Score ?? 0}</b>
            <i>:</i>
            <b>{score?.team2Score ?? 0}</b>
          </div>
          <small>Round {score?.roundNumber ?? '--'} | {mapName}</small>
        </div>
        <BroadcastTeam side="T" name={rightName} players={tPlayers} alignRight />
      </section>

      <section className="broadcast-main">
        <BroadcastTable title={leftName} side="CT" players={ctPlayers} />
        <div className="broadcast-leaders">
          <span className="broadcast-section-label">DESTAQUES</span>
          {leaders.length ? leaders.map((player, index) => (
            <article className="leader-card" key={player.steamid}>
              <small>#{index + 1}</small>
              <strong>{player.name}</strong>
              <div>
                <span>{player.kills} K</span>
                <span>{player.deaths} D</span>
                <span>{player.rating.toFixed(2)} RT</span>
              </div>
            </article>
          )) : <div className="broadcast-empty">Aguardando primeiro dado do servidor.</div>}
          <footer>
            <span>{status?.rcon ? 'RCON conectado' : 'RCON offline'}</span>
            <span>{lastUpdate ? lastUpdate.toLocaleTimeString('pt-BR') : '--:--'}</span>
          </footer>
        </div>
        <BroadcastTable title={rightName} side="T" players={tPlayers} />
      </section>

      {specs.length ? (
        <aside className="broadcast-specs">
          <span>SPEC</span>
          {specs.map((player) => <b key={player.steamid}>{player.name}</b>)}
        </aside>
      ) : null}
    </main>
  );
}

function BroadcastTeam({ side, name, players, alignRight = false }: { side: 'CT' | 'T'; name: string; players: PlayerStat[]; alignRight?: boolean }) {
  const alive = players.filter((player) => player.alive !== false).length;
  return (
    <div className={alignRight ? `broadcast-team ${side.toLowerCase()} right` : `broadcast-team ${side.toLowerCase()}`}>
      <span>{side === 'CT' ? 'COUNTER-TERRORISTS' : 'TERRORISTS'}</span>
      <strong>{name}</strong>
      <small>{alive}/{players.length || 5} vivos</small>
    </div>
  );
}

function BroadcastTable({ title, side, players }: { title: string; side: 'CT' | 'T'; players: PlayerStat[] }) {
  return (
    <div className={`broadcast-table ${side.toLowerCase()}`}>
      <h2>{title}</h2>
      <div className="broadcast-row head">
        <span>Player</span>
        <span>$</span>
        <span>HP</span>
        <span>K/D/A</span>
        <span>ADR</span>
        <span>RT</span>
      </div>
      {players.length ? players.map((player) => (
        <div className={player.alive === false ? 'broadcast-row dead' : 'broadcast-row'} key={player.steamid}>
          <span>
            <i className={player.alive === false ? 'player-state dead' : 'player-state'} />
            <b>{player.name}</b>
          </span>
          <span>{formatMoney(player.money)}</span>
          <span>{formatHealth(player)}</span>
          <span>{player.kills}/{player.deaths}/{player.assists}</span>
          <span>{player.adr.toFixed(1)}</span>
          <span>{player.rating.toFixed(2)}</span>
        </div>
      )) : <div className="broadcast-empty">Aguardando players.</div>}
    </div>
  );
}

function rankPlayers(players: PlayerStat[]) {
  return [...players].sort((a, b) => b.kills - a.kills || b.rating - a.rating || a.deaths - b.deaths);
}

function formatMoney(value?: number) {
  if (value == null || Number.isNaN(value)) return '--';
  return `$${Math.max(0, Math.round(value)).toLocaleString('en-US')}`;
}

function formatHealth(player: PlayerStat) {
  if (player.health == null && player.armor == null) return '--';
  return `${Math.max(0, player.health ?? 0)}/${Math.max(0, player.armor ?? 0)}`;
}
