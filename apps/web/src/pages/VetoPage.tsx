import type { LaunchConfig, SeriesKey, SideChoice, VetoConfig } from '../types';

const officialMapPool = ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass'];

type TeamKey = 'CT' | 'T';
type VetoAction = 'ban' | 'pick';

const seriesRules: Record<SeriesKey, { label: string; maps: number; hint: string; pattern: VetoAction[] }> = {
  md1: { label: 'MD1', maps: 1, hint: 'Seis bans. O mapa restante sera jogado.', pattern: ['ban', 'ban', 'ban', 'ban', 'ban', 'ban'] },
  md3: { label: 'MD3', maps: 3, hint: 'Ban, ban, pick, pick, ban, ban. O restante e decider.', pattern: ['ban', 'ban', 'pick', 'pick', 'ban', 'ban'] },
  md5: { label: 'MD5', maps: 5, hint: 'Ban, ban, quatro picks. O restante e decider.', pattern: ['ban', 'ban', 'pick', 'pick', 'pick', 'pick'] }
};

type Props = {
  config: LaunchConfig;
  veto: VetoConfig;
  active: boolean;
  onVetoChange: (veto: VetoConfig) => void;
  onStart: (veto: VetoConfig) => Promise<void>;
};

type Step = {
  index: number;
  team: TeamKey;
  action: VetoAction;
  map?: string;
};

function unique(items: string[]) {
  return items.filter((item, index) => item && items.indexOf(item) === index);
}

function mapLabel(map: string) {
  return map.replace('de_', '').replace('dust2', 'dust II').toUpperCase();
}

function teamName(team: TeamKey, config: LaunchConfig) {
  return team === 'CT' ? config.teamCT || 'Time CT' : config.teamT || 'Time TR';
}

function teamField(team: TeamKey, action: VetoAction): 'bansCT' | 'bansT' | 'picksCT' | 'picksT' {
  if (action === 'ban') return team === 'CT' ? 'bansCT' : 'bansT';
  return team === 'CT' ? 'picksCT' : 'picksT';
}

function buildSteps(series: SeriesKey, vetoFirst: TeamKey): Step[] {
  const pattern = seriesRules[series].pattern;
  const second: TeamKey = vetoFirst === 'CT' ? 'T' : 'CT';
  return pattern.map((action, index) => ({
    index,
    action,
    team: index % 2 === 0 ? vetoFirst : second
  }));
}

function normalizeVeto(veto: VetoConfig): VetoConfig {
  const series = seriesRules[veto.series] ? veto.series : 'md1';
  const pool = unique(veto.pool?.length ? veto.pool : officialMapPool);
  const vetoFirst = veto.vetoFirst === 'T' ? 'T' : 'CT';
  const steps = buildSteps(series, vetoFirst);
  const limits = {
    bansCT: steps.filter((step) => step.team === 'CT' && step.action === 'ban').length,
    bansT: steps.filter((step) => step.team === 'T' && step.action === 'ban').length,
    picksCT: steps.filter((step) => step.team === 'CT' && step.action === 'pick').length,
    picksT: steps.filter((step) => step.team === 'T' && step.action === 'pick').length
  };
  const bansCT = unique(veto.bansCT || []).filter((map) => pool.includes(map)).slice(0, limits.bansCT);
  const bansT = unique(veto.bansT || []).filter((map) => pool.includes(map)).slice(0, limits.bansT);
  const banned = [...bansCT, ...bansT];
  const picksCT = unique(veto.picksCT || []).filter((map) => pool.includes(map) && !banned.includes(map)).slice(0, limits.picksCT);
  const picksT = unique(veto.picksT || []).filter((map) => pool.includes(map) && !banned.includes(map)).slice(0, limits.picksT);
  const picked = [...picksCT, ...picksT];
  const maps = [...picked, ...pool.filter((map) => !banned.includes(map) && !picked.includes(map))].slice(0, seriesRules[series].maps);

  return {
    ...veto,
    series,
    pool,
    bansCT,
    bansT,
    picksCT,
    picksT,
    maps,
    startMap: maps[0] || pool[0],
    sideChoice: veto.sideChoice || 'knife',
    sideTeam: veto.sideTeam || 'CT',
    vetoFirst
  };
}

function completedSteps(veto: VetoConfig): Step[] {
  const steps = buildSteps(veto.series, veto.vetoFirst === 'T' ? 'T' : 'CT');
  const cursors = { bansCT: 0, bansT: 0, picksCT: 0, picksT: 0 };
  return steps.map((step) => {
    const field = teamField(step.team, step.action);
    const map = veto[field][cursors[field]];
    cursors[field] += 1;
    return { ...step, map };
  });
}

export function VetoPage({ config, veto, active, onVetoChange, onStart }: Props) {
  const normalized = normalizeVeto(veto);
  const rules = seriesRules[normalized.series];
  const steps = completedSteps(normalized);
  const currentStep = steps.find((step) => !step.map);
  const selected = [...normalized.bansCT, ...normalized.bansT, ...normalized.picksCT, ...normalized.picksT];
  const available = normalized.pool.filter((map) => !selected.includes(map));
  const vetoComplete = !currentStep;
  const mapsReady = vetoComplete && normalized.maps?.length === rules.maps;

  const update = (next: VetoConfig) => onVetoChange(normalizeVeto(next));

  const resetVeto = (next?: Partial<VetoConfig>) => {
    update({
      ...normalized,
      ...next,
      bansCT: [],
      bansT: [],
      picksCT: [],
      picksT: []
    });
  };

  const chooseMap = (map: string) => {
    if (!currentStep) return;
    const field = teamField(currentStep.team, currentStep.action);
    update({ ...normalized, [field]: [...normalized[field], map] });
  };

  const undoLast = () => {
    const last = [...steps].reverse().find((step) => step.map);
    if (!last) return;
    const field = teamField(last.team, last.action);
    update({ ...normalized, [field]: normalized[field].slice(0, -1) });
  };

  const setSide = (sideChoice: SideChoice) => {
    update({ ...normalized, sideChoice });
  };

  return (
    <div className="page-stack veto-page simple-veto">
      <section className="panel simple-veto-header">
        <div>
          <div className="section-title">Veto</div>
          <h2>{config.teamCT} vs {config.teamT}</h2>
          <p>Fluxo guiado: escolha o formato, escolha quem inicia o veto e selecione um mapa por vez.</p>
        </div>
        <div className="simple-veto-summary">
          <span>Resultado</span>
          <strong>{rules.label}</strong>
          <small>{mapsReady ? `${normalized.maps?.map(mapLabel).join(' / ')}` : 'Aguardando veto'}</small>
        </div>
      </section>

      <section className="panel simple-veto-grid">
        <div>
          <div className="section-title">1. Formato da partida</div>
          <div className="format-choice-grid">
            {(Object.keys(seriesRules) as SeriesKey[]).map((series) => (
              <button
                key={series}
                className={normalized.series === series ? 'on' : ''}
                type="button"
                onClick={() => resetVeto({ series })}
              >
                <strong>{seriesRules[series].label}</strong>
                <span>{seriesRules[series].hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="section-title">2. Quem inicia o veto</div>
          <div className="starter-choice-grid">
            {(['CT', 'T'] as TeamKey[]).map((team) => (
              <button
                key={team}
                className={normalized.vetoFirst === team ? 'on' : ''}
                type="button"
                onClick={() => resetVeto({ vetoFirst: team })}
              >
                <span>{team}</span>
                <strong>{teamName(team, config)}</strong>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel current-veto-panel">
        <div className="current-veto-call">
          <span>{currentStep ? `Passo ${currentStep.index + 1} de ${steps.length}` : 'Veto completo'}</span>
          <strong>
            {currentStep
              ? `${teamName(currentStep.team, config)} ${currentStep.action === 'ban' ? 'bane' : 'escolhe'} um mapa`
              : 'Mapa(s) definidos para iniciar a partida'}
          </strong>
        </div>
        <div className="veto-map-pick-grid">
          {normalized.pool.map((map) => {
            const step = steps.find((item) => item.map === map);
            const disabled = !currentStep || !available.includes(map);
            return (
              <button
                key={map}
                className={`${step?.action || ''} ${normalized.maps?.includes(map) ? 'final' : ''}`}
                type="button"
                disabled={disabled}
                onClick={() => chooseMap(map)}
              >
                <strong>{mapLabel(map)}</strong>
                <span>
                  {step
                    ? `${step.action === 'ban' ? 'BAN' : 'PICK'} ${step.team}`
                    : normalized.maps?.includes(map) && vetoComplete
                      ? 'MAPA'
                      : 'Disponivel'}
                </span>
              </button>
            );
          })}
        </div>
        <div className="veto-admin-actions">
          <button className="ghost-action" type="button" onClick={undoLast} disabled={!steps.some((step) => step.map)}>
            Desfazer ultimo
          </button>
          <button className="ghost-action" type="button" onClick={() => resetVeto()}>
            Reiniciar veto
          </button>
        </div>
      </section>

      <section className="panel simple-veto-grid">
        <div>
          <div className="section-title">Ordem do veto</div>
          <div className="veto-timeline">
            {steps.map((step) => (
              <div key={step.index} className={step.map ? 'done' : currentStep?.index === step.index ? 'now' : ''}>
                <span>{String(step.index + 1).padStart(2, '0')}</span>
                <strong>{step.action === 'ban' ? 'Ban' : 'Pick'} {step.team}</strong>
                <small>{step.map ? mapLabel(step.map) : 'Pendente'}</small>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="section-title">3. Lado inicial</div>
          <div className="side-choice-grid">
            <button className={normalized.sideChoice === 'knife' ? 'on' : ''} type="button" onClick={() => setSide('knife')}>
              Knife round
              <span>Os players dao .ready e decidem lado na faca.</span>
            </button>
            <button className={normalized.sideChoice === 'ct' ? 'on' : ''} type="button" onClick={() => setSide('ct')}>
              CT inicia CT
              <span>{config.teamCT} comeca de CT.</span>
            </button>
            <button className={normalized.sideChoice === 't' ? 'on' : ''} type="button" onClick={() => setSide('t')}>
              CT inicia TR
              <span>{config.teamCT} comeca de TR.</span>
            </button>
          </div>
        </div>
      </section>

      <section className="panel veto-start-panel">
        <div>
          <div className="section-title">Start jogo</div>
          <p>
            Ao iniciar, o painel envia mapas e lados para o MatchZy, ativa o plugin de skins e depois fica a cargo dos players usarem .ready.
          </p>
        </div>
        <button className="primary-action" type="button" disabled={!mapsReady || active} onClick={() => onStart(normalized)}>
          {active ? 'Servidor em uso' : mapsReady ? 'Start jogo' : 'Complete o veto'}
        </button>
      </section>
    </div>
  );
}
