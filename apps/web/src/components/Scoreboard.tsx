import type { ScoreStatus } from '../types';

type ScoreboardProps = {
  score: ScoreStatus | null;
  teamCT: string;
  teamT: string;
};

export function Scoreboard({ score, teamCT, teamT }: ScoreboardProps) {
  const leftName = score?.team1Name || teamCT || 'Team CT';
  const rightName = score?.team2Name || teamT || 'Team T';
  const leftScore = score?.team1Score ?? 0;
  const rightScore = score?.team2Score ?? 0;
  const mapName = (score?.mapName || '--').replace('de_', '');
  const mode = score?.matchMode || 'Offline';

  return (
    <section className="panel scoreboard-panel">
      <div className="score-title-row">
        <div className="section-title">Placar ao vivo</div>
        <span className={score?.isLive ? 'feed-chip live' : 'feed-chip'}>{score?.isLive ? 'Live feed' : 'Standby'}</span>
      </div>
      <div className={score?.isLive ? 'scoreboard is-live' : 'scoreboard'}>
        <div className="score-team">
          <div className="team-stripe ct-stripe" />
          <span className="team-kicker">Counter-Terrorists</span>
          <strong>{leftName}</strong>
          <span className="side-tag ct">{score?.team1Side || 'CT'}</span>
        </div>
        <div className="score-center">
          <span className={score?.isLive ? 'live-badge live' : 'live-badge'}>{mode}</span>
          <div className="score-numbers">
            <b>{leftScore}</b>
            <span>:</span>
            <b>{rightScore}</b>
          </div>
          <div className="score-meta">
            <span>Round {score?.roundNumber ?? '--'}</span>
            <span>Mapa {mapName}</span>
          </div>
        </div>
        <div className="score-team right">
          <div className="team-stripe tr-stripe" />
          <span className="team-kicker">Terrorists</span>
          <strong>{rightName}</strong>
          <span className="side-tag tr">{score?.team2Side || 'T'}</span>
        </div>
      </div>
    </section>
  );
}
