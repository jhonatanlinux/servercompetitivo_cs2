import type { Backup, ScoreStatus } from '../types';
import { Scoreboard } from '../components/Scoreboard';

type MatchPageProps = {
  score: ScoreStatus | null;
  backups: Backup[];
  teamCT: string;
  teamT: string;
  onAction: (action: string) => void;
  onRefreshBackups: () => void;
  onRestoreRound: (round: number) => void;
  onRedoRound: () => void;
  onEndAndArchive: () => void;
};

const controls = [
  ['force-ready', 'Status ready'],
  ['knife', 'Knife round'],
  ['start-match', 'Iniciar partida'],
  ['unpause', 'Unpause'],
  ['pause', 'Pausar'],
  ['tech-pause', 'Pause tecnico'],
  ['tech-unpause', 'Retomar tecnico'],
  ['restart-warmup', 'Reiniciar warmup'],
  ['practice', 'Modo treino'],
  ['skins-on', 'Skins ON'],
  ['skins-off', 'Skins OFF'],
  ['status', 'Status MatchZy'],
  ['plugins', 'Listar plugins']
];

export function MatchPage({
  score,
  backups,
  teamCT,
  teamT,
  onAction,
  onRefreshBackups,
  onRestoreRound,
  onRedoRound,
  onEndAndArchive
}: MatchPageProps) {
  return (
    <div className="page-stack">
      <Scoreboard score={score} teamCT={teamCT} teamT={teamT} />

      <section className="panel">
        <div className="section-title">Operacao da partida</div>
        <div className="control-grid">
          {controls.map(([action, label]) => (
            <button key={action} className={`control-button action-${action}`} type="button" onClick={() => onAction(action)}>
              {label}
            </button>
          ))}
          <button className="control-button danger" type="button" onClick={onEndAndArchive}>
            Encerrar e arquivar
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div className="section-title">Restaurar round</div>
          <div className="inline-actions">
            <button className="ghost-action compact" type="button" onClick={onRefreshBackups}>
              Atualizar lista
            </button>
            <button className="ghost-action compact danger-outline" type="button" onClick={onRedoRound}>
              Refazer round atual
            </button>
          </div>
        </div>
        <div className="round-grid">
          {backups.length ? backups.map((backup) => (
            <div className="round-card" key={`${backup.file}-${backup.mtime}`}>
              <strong>R{backup.round ?? '?'}</strong>
              <span>{backup.kind}</span>
              <small>{backup.file}</small>
              <button
                className="ghost-action compact restore-button"
                type="button"
                disabled={!backup.round}
                onClick={() => backup.round && onRestoreRound(backup.round)}
              >
                Restaurar
              </button>
            </div>
          )) : <div className="empty-state">Nenhum backup de round disponivel.</div>}
        </div>
      </section>
    </div>
  );
}
