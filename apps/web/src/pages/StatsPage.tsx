import type { EventMatch, PlayerStat, ScoreStatus } from '../types';
import { Scoreboard } from '../components/Scoreboard';

type StatsPageProps = {
  score: ScoreStatus | null;
  stats: PlayerStat[];
  teamCT: string;
  teamT: string;
  history: EventMatch[];
};

export function StatsPage({ score, stats, teamCT, teamT, history }: StatsPageProps) {
  const ct = stats.filter((player) => player.team === 'CT');
  const tr = stats.filter((player) => player.team === 'T');
  const spec = stats.filter((player) => player.team !== 'CT' && player.team !== 'T');
  const live = stats.some((player) => player.source === 'live-plugin' || player.money != null || player.health != null);
  const latest = history.slice(0, 6);

  return (
    <div className="page-stack">
      <Scoreboard score={score} teamCT={teamCT} teamT={teamT} />
      <section className="panel">
        <div className="panel-heading">
          <div className="section-title">TAB ao vivo</div>
          <span className={live ? 'feed-chip live' : 'feed-chip'}>{live ? 'Plugin live' : 'Fallback'}</span>
        </div>
        <div className="stats-grid">
          <TeamStats side="CT" title={score?.team1Name || teamCT || 'Time CT'} players={ct} />
          <TeamStats side="T" title={score?.team2Name || teamT || 'Time T'} players={tr} />
        </div>
        {spec.length ? <SpecStats players={spec} /> : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div className="section-title">Ultimos jogos</div>
          <span className="feed-chip">{latest.length} arquivados</span>
        </div>
        <div className="match-history-grid">
          {latest.length ? latest.map((match) => (
            <article className="history-card" key={match.id}>
              <div className="history-top">
                <span>{new Date(match.archivedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                <b>{match.mapName?.replace('de_', '') || 'Mapa'}</b>
              </div>
              <div className="history-score">
                <strong>{match.team1Name}</strong>
                <span>{match.team1Score} : {match.team2Score}</span>
                <strong>{match.team2Name}</strong>
              </div>
              <div className="history-meta">
                <span>Vencedor: {match.winner}</span>
                {match.demos?.[0] ? <a href={match.demos[0].url} download>Demo</a> : <small>Sem demo</small>}
              </div>
            </article>
          )) : <div className="empty-state">Nenhum jogo arquivado ainda. Use "Encerrar e arquivar" ao fim da partida.</div>}
        </div>
      </section>
    </div>
  );
}

function SpecStats({ players }: { players: PlayerStat[] }) {
  return (
    <div className="spec-list">
      <span>SPEC</span>
      {players.map((player) => (
        <b key={player.steamid}>{player.name}</b>
      ))}
    </div>
  );
}

function TeamStats({ side, title, players }: { side: 'CT' | 'T'; title: string; players: PlayerStat[] }) {
  return (
    <div className={`team-table live-tab live-tab-${side.toLowerCase()}`}>
      <h3><span>{title}</span><b>{side}</b></h3>
      <div className="table-row head live-tab-row">
        <span>Player</span><span>$</span><span>HP</span><span>K/D/A</span><span>ADR</span><span>Score</span><span>Rating</span>
      </div>
      {players.length ? players.map((player) => (
        <div className={player.alive === false ? 'table-row live-tab-row dead' : 'table-row live-tab-row'} key={player.steamid}>
          <span className="player-cell">
            <i className={player.alive === false ? 'alive-dot dead' : 'alive-dot'} />
            <b>{player.name}</b>
            {player.isBot ? <small>BOT</small> : null}
          </span>
          <span>{formatMoney(player.money)}</span>
          <span>{formatVitals(player)}</span>
          <span>{player.kills}/{player.deaths}/{player.assists}</span>
          <span>{player.adr.toFixed(1)}</span>
          <span>{player.score ?? 0}</span>
          <span>{player.rating.toFixed(2)}</span>
        </div>
      )) : <div className="empty-state">Aguardando dados.</div>}
    </div>
  );
}

function formatMoney(value?: number) {
  if (value == null || Number.isNaN(value)) return '--';
  return `$${Math.max(0, Math.round(value)).toLocaleString('en-US')}`;
}

function formatVitals(player: PlayerStat) {
  if (player.health == null && player.armor == null) return '--';
  return `${Math.max(0, player.health ?? 0)} / ${Math.max(0, player.armor ?? 0)}`;
}
