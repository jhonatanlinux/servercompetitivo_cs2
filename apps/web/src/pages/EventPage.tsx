import { MetricCard } from '../components/MetricCard';
import type { EventPlan, EventSetupConfig, EventStatsResponse, EventTeamConfig } from '../types';

type EventPageProps = {
  data: EventStatsResponse | null;
  eventSetup: EventSetupConfig;
  eventPlan: EventPlan;
  onEventSetupChange: (next: EventSetupConfig) => void;
  onSaveEventSetup: (next: EventSetupConfig) => void;
  onRefresh: () => void;
};

const formatLabels: Record<EventSetupConfig['format'], string> = {
  swiss: 'Sistema suico',
  groups: 'Fase de grupos',
  'double-elimination': 'Winner + Lower',
  'single-elimination': 'Eliminacao simples'
};

export function EventPage({ data, eventSetup, eventPlan, onEventSetupChange, onSaveEventSetup, onRefresh }: EventPageProps) {
  const topKills = data?.leaders.topKills?.[0];
  const topKD = data?.leaders.topKD?.[0];
  const teamCount = eventSetup.teams.length;
  const previewSummary = buildPreviewSummary(eventSetup);
  const previewPlan = buildPreviewPlan(eventSetup, eventPlan);
  const set = <K extends keyof EventSetupConfig>(key: K, value: EventSetupConfig[K]) => {
    onEventSetupChange({ ...eventSetup, [key]: value });
  };
  const updateTeam = (teamId: string, patch: Partial<EventTeamConfig>) => {
    set('teams', eventSetup.teams.map((team) => (team.id === teamId ? { ...team, ...patch } : team)));
  };
  const updatePlayer = (teamId: string, index: number, field: 'name' | 'steamid', value: string) => {
    set('teams', eventSetup.teams.map((team) => {
      if (team.id !== teamId) return team;
      const players = rosterSlots(team.players).map((player, playerIndex) => (
        playerIndex === index ? { ...player, [field]: value } : player
      )).filter((player) => player.name || player.steamid);
      return { ...team, players };
    }));
  };
  const addTeam = () => {
    const nextIndex = eventSetup.teams.length + 1;
    set('teams', [...eventSetup.teams, {
      id: `team-${Date.now()}-${nextIndex}`,
      name: `Time ${nextIndex}`,
      shortName: `T${nextIndex}`,
      seed: nextIndex,
      players: []
    }]);
  };
  const removeTeam = (teamId: string) => {
    set('teams', eventSetup.teams.filter((team) => team.id !== teamId));
  };

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-heading">
          <div className="section-title">Configuracao do evento</div>
          <div className="inline-actions">
            <span className="feed-chip">{formatLabels[eventSetup.format]}</span>
            <span className="feed-chip">{teamCount} times</span>
            <button className="primary-action compact" type="button" onClick={() => onSaveEventSetup(eventSetup)}>
              Salvar estrutura
            </button>
          </div>
        </div>

        <div className="form-grid three">
          <label>
            Nome oficial
            <input value={eventSetup.title} onChange={(event) => set('title', event.target.value)} />
          </label>
          <label>
            Slug / etapa
            <input value={eventSetup.slug} onChange={(event) => set('slug', event.target.value)} />
          </label>
          <label>
            Serie padrao
            <select value={eventSetup.seriesDefault} onChange={(event) => set('seriesDefault', event.target.value as EventSetupConfig['seriesDefault'])}>
              <option value="md1">MD1</option>
              <option value="md3">MD3</option>
              <option value="md5">MD5</option>
            </select>
          </label>
        </div>

        <div className="event-format-grid">
          {(Object.keys(formatLabels) as EventSetupConfig['format'][]).map((format) => (
            <button
              key={format}
              className={eventSetup.format === format ? 'event-format-card on' : 'event-format-card'}
              type="button"
              onClick={() => set('format', format)}
            >
              <strong>{formatLabels[format]}</strong>
              <span>{formatHint(format)}</span>
            </button>
          ))}
        </div>

        <div className="event-stage-grid">
          {eventSetup.format === 'groups' ? (
            <>
              <label>
                Numero de grupos
                <input type="number" min="2" max="8" value={eventSetup.groupCount} onChange={(event) => set('groupCount', Number(event.target.value || 2))} />
              </label>
              <label>
                Times por grupo
                <input type="number" min="4" max="16" value={eventSetup.teamsPerGroup} onChange={(event) => set('teamsPerGroup', Number(event.target.value || 4))} />
              </label>
              <label>
                Classificam por grupo
                <input type="number" min="1" max="8" value={eventSetup.advancePerGroup} onChange={(event) => set('advancePerGroup', Number(event.target.value || 2))} />
              </label>
            </>
          ) : null}

          {eventSetup.format === 'swiss' ? (
            <>
              <label>
                Rodadas do suico
                <input type="number" min="3" max="7" value={eventSetup.swissRounds} onChange={(event) => set('swissRounds', Number(event.target.value || 5))} />
              </label>
              <label>
                Times que avancam
                <input type="number" min="2" max="16" value={eventSetup.swissAdvance} onChange={(event) => set('swissAdvance', Number(event.target.value || 8))} />
              </label>
              <label className="switch-row event-switch">
                <span>Gerar fase final depois</span>
                <input type="checkbox" checked={eventSetup.upperLower} onChange={(event) => set('upperLower', event.target.checked)} />
              </label>
            </>
          ) : null}

          {eventSetup.format === 'double-elimination' ? (
            <label className="switch-row event-switch">
              <span>Winner e Lower habilitados</span>
              <input type="checkbox" checked={eventSetup.upperLower} onChange={(event) => set('upperLower', event.target.checked)} />
            </label>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div className="section-title">Times do evento</div>
          <div className="inline-actions">
            <span className="feed-chip">{teamCount} registrados</span>
            <button className="ghost-action compact" type="button" onClick={addTeam}>
              Novo time
            </button>
          </div>
        </div>
        <div className="event-team-stack">
          {eventSetup.teams.length ? eventSetup.teams.map((team, teamIndex) => (
            <article className="event-team-card" key={team.id}>
              <div className="event-team-head">
                <strong>Time {teamIndex + 1}</strong>
                <button className="ghost-action compact danger-outline" type="button" onClick={() => removeTeam(team.id)}>
                  Remover
                </button>
              </div>
              <div className="form-grid four">
                <label>
                  Nome
                  <input value={team.name} onChange={(event) => updateTeam(team.id, { name: event.target.value })} />
                </label>
                <label>
                  Sigla curta
                  <input value={team.shortName} onChange={(event) => updateTeam(team.id, { shortName: event.target.value })} />
                </label>
                <label>
                  Seed
                  <input type="number" min="1" value={team.seed ?? teamIndex + 1} onChange={(event) => updateTeam(team.id, { seed: Number(event.target.value || teamIndex + 1) })} />
                </label>
                <label>
                  Roster
                  <span className="field-hint">{team.players.length}/5 registrados</span>
                </label>
              </div>
              <div className="roster-card event-roster-card">
                <div className="roster-row roster-row-head">
                  <span>#</span>
                  <span>Player</span>
                  <span>SteamID64</span>
                </div>
                {rosterSlots(team.players).map((player, index) => (
                  <div className="roster-row" key={`${team.id}-${index}`}>
                    <span className="roster-num">{index + 1}</span>
                    <input
                      value={player.name}
                      placeholder={`Player ${index + 1}`}
                      onChange={(event) => updatePlayer(team.id, index, 'name', event.target.value)}
                    />
                    <input
                      value={player.steamid}
                      placeholder="76561198000000000"
                      inputMode="numeric"
                      onChange={(event) => updatePlayer(team.id, index, 'steamid', event.target.value)}
                    />
                  </div>
                ))}
              </div>
            </article>
          )) : <div className="empty-state">Nenhum time cadastrado ainda.</div>}
        </div>
        <label className="block-field">
          <span>Observacoes operacionais</span>
          <textarea
            rows={4}
            value={eventSetup.notes}
            onChange={(event) => set('notes', event.target.value)}
            placeholder="Ex.: 2 grupos de 6, top 3 avanca, playoffs em winner/lower."
          />
        </label>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div className="section-title">Preview da estrutura</div>
          <span className="feed-chip">{formatLabels[eventSetup.format]}</span>
        </div>
        <div className="event-summary-pills">
          {previewSummary.length ? previewSummary.map((item) => (
            <span className="feed-chip" key={item}>{item}</span>
          )) : <span className="muted-line">Salve a configuracao para gerar a estrutura.</span>}
        </div>
        <AnimatedStructurePreview eventSetup={eventSetup} eventPlan={previewPlan} />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div className="section-title">Estatisticas do evento</div>
          <button className="ghost-action" type="button" onClick={onRefresh}>Atualizar</button>
        </div>
        <div className="metric-grid">
          <MetricCard label="Partidas" value={data?.totals.matches ?? 0} />
          <MetricCard label="Demos" value={data?.totals.demos ?? 0} />
          <MetricCard label="Top kills" value={topKills?.name || '--'} detail={topKills ? `${topKills.kills} kills` : undefined} />
          <MetricCard label="Melhor KD" value={topKD?.name || '--'} detail={topKD ? `${topKD.kd} KD` : undefined} />
        </div>
      </section>

      <section className="panel">
        <div className="section-title">Resultados anteriores</div>
        <div className="results-list">
          {data?.matches.length ? data.matches.map((match) => (
            <article className="result-card" key={match.id}>
              <div>
                <small>{new Date(match.archivedAt).toLocaleString('pt-BR')}</small>
                <strong>{match.team1Name} {match.team1Score} x {match.team2Score} {match.team2Name}</strong>
                <span>{match.mapName || 'Mapa indefinido'} - Vencedor: {match.winner}</span>
              </div>
              <div className="download-row">
                {match.demos.length ? match.demos.map((demo) => (
                  <a key={demo.file} href={demo.url} download>{demo.file}</a>
                )) : <span>Sem demo</span>}
              </div>
            </article>
          )) : <div className="empty-state">Nenhuma partida arquivada ainda.</div>}
        </div>
      </section>
    </div>
  );
}

function formatHint(format: EventSetupConfig['format']) {
  if (format === 'swiss') return 'Ideal para etapa principal com pareamento por campanha.';
  if (format === 'groups') return 'Organiza o evento por grupos com classificacao controlada.';
  if (format === 'double-elimination') return 'Estrutura com winner bracket e lower bracket.';
  return 'Playoffs diretos, mais simples e rapido de operar.';
}

function rosterSlots(players: EventTeamConfig['players']) {
  const list = players.length >= 5 ? [...players] : [...players, ...Array.from({ length: 5 - players.length }, () => ({ steamid: '', name: '' }))];
  return list.slice(0, 5);
}

function AnimatedStructurePreview({
  eventSetup,
  eventPlan
}: {
  eventSetup: EventSetupConfig;
  eventPlan: EventPlan;
}) {
  if (!eventPlan.stages.length && !eventPlan.groups.length) {
    return <div className="empty-state">Nenhuma estrutura gerada ainda.</div>;
  }

  const seededTeams = [...eventSetup.teams]
    .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999) || a.name.localeCompare(b.name))
    .map((team, index) => ({
      label: team.shortName || team.name,
      fullName: team.name,
      seed: team.seed ?? index + 1
    }));
  const teamNames = seededTeams.map((team) => team.label).filter(Boolean);

  if (eventSetup.format === 'groups') {
    const groups = eventPlan.groups.length ? eventPlan.groups : [
      { name: 'Grupo A', teams: teamNames.slice(0, 4), advance: eventSetup.advancePerGroup },
      { name: 'Grupo B', teams: teamNames.slice(4, 8), advance: eventSetup.advancePerGroup }
    ];
    return (
      <div className="simple-structure-stack">
        <div className="simple-structure-callout">
          <strong>Fase de grupos</strong>
          <span>{eventSetup.groupCount} grupos, {eventSetup.advancePerGroup} classificado(s) por grupo e depois playoffs.</span>
        </div>
        <div className="animated-preview animated-groups">
          <div className="animated-preview-head">
            <span>Simulação</span>
            <strong>Entrada nos grupos e avanço para playoffs</strong>
          </div>
          <div className="animated-groups-grid">
            {groups.map((group, groupIndex) => (
              <article className="animated-group-lane" key={group.name}>
                <div className="animated-group-title">
                  <strong>{group.name}</strong>
                  <span>Top {group.advance}</span>
                </div>
                <div className="animated-group-team-list">
                  {group.teams.slice(0, Math.max(4, group.teams.length)).map((team, teamIndex) => (
                    <div
                      className={teamIndex < group.advance ? 'animated-team-chip advancing' : 'animated-team-chip'}
                      key={`${group.name}-${team}-${teamIndex}`}
                      style={{ animationDelay: `${groupIndex * 0.5 + teamIndex * 0.2}s` }}
                    >
                      <span>S{findSeed(seededTeams, team) || teamIndex + 1}</span>
                      <b>{team || `Seed ${teamIndex + 1}`}</b>
                    </div>
                  ))}
                </div>
              </article>
            ))}
            <article className="animated-playoff-target">
              <span>Playoffs</span>
              <strong>{groups.reduce((sum, group) => sum + group.advance, 0)} classificados</strong>
            </article>
          </div>
        </div>
        <div className="event-groups-grid">
          {eventPlan.groups.map((group) => (
            <article className="event-group-card" key={group.name}>
              <div className="event-group-head">
                <strong>{group.name}</strong>
                <span>Avancam {group.advance}</span>
              </div>
              <div className="event-group-teams">
                {group.teams.length ? group.teams.map((team) => <b key={team}>{team}</b>) : <small>Sem times</small>}
              </div>
            </article>
          ))}
        </div>
        <StageSummaryCards stages={eventPlan.stages} limit={3} />
      </div>
    );
  }

  if (eventSetup.format === 'swiss') {
    const swissTeams = teamNames.length ? teamNames : ['Seed 1', 'Seed 2', 'Seed 3', 'Seed 4', 'Seed 5', 'Seed 6', 'Seed 7', 'Seed 8'];
    return (
      <div className="simple-structure-stack">
        <div className="simple-structure-callout">
          <strong>Sistema suíço</strong>
          <span>{eventSetup.swissRounds} rodadas previstas, com {eventSetup.swissAdvance} times avançando para a fase final.</span>
        </div>
        <div className="animated-preview animated-swiss">
          <div className="animated-preview-head">
            <span>Simulação</span>
            <strong>Pareamentos mudando a cada rodada</strong>
          </div>
          <div className="animated-swiss-grid">
            {Array.from({ length: Math.min(eventSetup.swissRounds, 5) }, (_, roundIndex) => (
              <article className="animated-round-card" key={`round-${roundIndex + 1}`}>
                <strong>R{roundIndex + 1}</strong>
                <div className="animated-round-pairs">
                  {Array.from({ length: Math.max(2, Math.floor(swissTeams.length / 2)) }, (_, pairIndex) => {
                    const t1 = swissTeams[(pairIndex + roundIndex) % swissTeams.length];
                    const t2 = swissTeams[(pairIndex + roundIndex + 1 + roundIndex) % swissTeams.length];
                    return (
                      <div className={`animated-pair swiss-round-${(roundIndex % 3) + 1}`} key={`${roundIndex}-${pairIndex}`} style={{ animationDelay: `${roundIndex * 0.5 + pairIndex * 0.15}s` }}>
                        <b>S{findSeed(seededTeams, t1) || pairIndex + 1} {t1}</b>
                        <span>vs</span>
                        <b>S{findSeed(seededTeams, t2) || pairIndex + 2} {t2}</b>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        </div>
        <div className="simple-phase-grid">
          {Array.from({ length: eventSetup.swissRounds }, (_, index) => (
            <article className="simple-phase-card" key={`swiss-${index + 1}`}>
              <strong>Rodada {index + 1}</strong>
              <span>Pareamentos por campanha</span>
            </article>
          ))}
          <article className="simple-phase-card highlight">
            <strong>Playoffs</strong>
            <span>Entram os {eventSetup.swissAdvance} melhores</span>
          </article>
        </div>
      </div>
    );
  }

  if (eventSetup.format === 'double-elimination') {
    const winnerStages = eventPlan.stages.filter((stage) => /winner/i.test(stage.title));
    const lowerStages = eventPlan.stages.filter((stage) => /lower/i.test(stage.title));
    const finalStage = eventPlan.stages.find((stage) => /grande final/i.test(stage.title));
    const featuredTeams = (teamNames.length ? teamNames : ['Seed 1', 'Seed 2', 'Seed 3', 'Seed 4']).slice(0, 4);
    return (
      <div className="simple-structure-stack">
        <div className="simple-structure-callout">
          <strong>Winner + Lower</strong>
          <span>Quem perde no winner cai para o lower. No fim, os campeões das duas chaves jogam a grande final.</span>
        </div>
        <div className="animated-preview animated-double">
          <div className="animated-preview-head">
            <span>Simulação</span>
            <strong>Queda para lower e corrida até a grande final</strong>
          </div>
          <div className="animated-double-grid">
            <div className="animated-bracket-column winner-phase">
              <span>Winner</span>
              {featuredTeams.map((team, index) => (
                <div className="animated-team-chip winner" key={`winner-${team}-${index}`} style={{ animationDelay: `${index * 0.2}s` }}>
                  <span>S{findSeed(seededTeams, team) || index + 1}</span>
                  <b>{team}</b>
                </div>
              ))}
            </div>
            <div className="animated-bracket-arrow loss-path">
              <span>derrota</span>
            </div>
            <div className="animated-bracket-column lower-phase">
              <span>Lower</span>
              <div className="animated-team-chip lower pulse-delayed">
                <span>S{findSeed(seededTeams, featuredTeams[1]) || 2}</span>
                <b>{featuredTeams[1] || 'Seed 2'}</b>
              </div>
              <div className="animated-team-chip lower pulse-delayed-2">
                <span>S{findSeed(seededTeams, featuredTeams[2]) || 3}</span>
                <b>{featuredTeams[2] || 'Seed 3'}</b>
              </div>
            </div>
            <div className="animated-bracket-arrow final-path">
              <span>grande final</span>
            </div>
            <div className="animated-bracket-column highlight final-phase">
              <span>Final</span>
              <div className="animated-final-card">
                <b>S{findSeed(seededTeams, featuredTeams[0]) || 1} {featuredTeams[0] || 'Winner champ'}</b>
                <small>vs</small>
                <b>S{findSeed(seededTeams, featuredTeams[1]) || 2} {featuredTeams[1] || 'Lower champ'}</b>
              </div>
            </div>
          </div>
        </div>
        <div className="simple-lane-grid">
          <article className="simple-lane-card">
            <strong>Winner bracket</strong>
            <span>{winnerStages.length} etapa(s)</span>
            <small>{winnerStages.map((stage) => stage.title.replace(/^Winner bracket - /i, '')).join(' • ') || 'Aguardando'}</small>
          </article>
          <article className="simple-lane-card">
            <strong>Lower bracket</strong>
            <span>{lowerStages.length} etapa(s)</span>
            <small>{lowerStages.map((stage) => stage.title.replace(/^Lower bracket - /i, '')).join(' • ') || 'Aguardando'}</small>
          </article>
          <article className="simple-lane-card highlight">
            <strong>Grande final</strong>
            <span>{finalStage?.matches.length || 1} série</span>
            <small>{finalStage?.matches[0]?.team1 || 'Winner bracket champion'} vs {finalStage?.matches[0]?.team2 || 'Lower bracket champion'}</small>
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="simple-structure-stack">
      <div className="simple-structure-callout">
        <strong>Eliminação simples</strong>
        <span>Perdeu, está fora. Não existe lower bracket, repescagem ou segunda chance: o chaveamento segue direto até a final.</span>
      </div>
      <div className="animated-preview animated-single">
        <div className="animated-preview-head">
          <span>Simulação</span>
          <strong>Perdeu uma série, acabou o torneio para esse time</strong>
        </div>
        <div className="single-elim-warning">
          <div className="single-elim-path survive">
            <strong>Venceu</strong>
            <span>avança para a próxima fase</span>
          </div>
          <div className="single-elim-path eliminated">
            <strong>Perdeu</strong>
            <span>eliminação imediata</span>
          </div>
        </div>
        <div className="animated-single-grid">
          {eventPlan.stages.slice(0, 4).map((stage, stageIndex) => (
            <div className={`animated-single-column single-phase-${stageIndex + 1}`} key={stage.title}>
              <span>{stage.title}</span>
              {stage.matches.slice(0, 4).map((match, matchIndex) => (
                <div className="single-elim-match-stack" key={match.id} style={{ animationDelay: `${stageIndex * 0.35 + matchIndex * 0.18}s` }}>
                  <div className="animated-match-box">
                    <b>{decorateSeededLabel(match.team1, seededTeams)}</b>
                    <small>vs</small>
                    <b>{decorateSeededLabel(match.team2, seededTeams)}</b>
                  </div>
                  <div className="single-elim-outcome">
                    <span className="advance-tag">1 avança</span>
                    <span className="exit-tag">1 sai</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <StageSummaryCards stages={eventPlan.stages} />
    </div>
  );
}

function StageSummaryCards({ stages, limit = 4 }: { stages: EventPlan['stages']; limit?: number }) {
  return (
    <div className="simple-phase-grid">
      {stages.slice(0, limit).map((stage) => (
        <article className="simple-phase-card" key={stage.title}>
          <strong>{stage.title}</strong>
          <span>{stage.matches.length} confronto(s)</span>
          <small>{stage.subtitle || firstMatchLabel(stage)}</small>
        </article>
      ))}
    </div>
  );
}

function firstMatchLabel(stage: EventPlan['stages'][number]) {
  const first = stage.matches[0];
  if (!first) return 'Sem confrontos';
  return `${first.team1} vs ${first.team2}`;
}

function buildPreviewSummary(eventSetup: EventSetupConfig) {
  const teamCount = eventSetup.teams.length;
  if (eventSetup.format === 'single-elimination') {
    return [
      `${teamCount} time(s) cadastrados`,
      `${eventSetup.seriesDefault.toUpperCase()} como serie padrao`,
      'Perdeu uma serie, sai do evento'
    ];
  }
  if (eventSetup.format === 'double-elimination') {
    return [
      `${teamCount} time(s) cadastrados`,
      `${eventSetup.seriesDefault.toUpperCase()} como serie padrao`,
      'Winner bracket + Lower bracket'
    ];
  }
  if (eventSetup.format === 'groups') {
    return [
      `${teamCount} time(s) cadastrados`,
      `${eventSetup.groupCount} grupo(s)`,
      `${eventSetup.advancePerGroup} classificado(s) por grupo`
    ];
  }
  return [
    `${teamCount} time(s) cadastrados`,
    `${eventSetup.seriesDefault.toUpperCase()} como serie padrao`,
    `${eventSetup.swissRounds} rodada(s) do sistema suico`
  ];
}

function buildPreviewPlan(eventSetup: EventSetupConfig, persistedPlan: EventPlan): EventPlan {
  const seededTeams = eventSetup.teams
    .map((team, index) => ({ name: team.shortName || team.name, seed: team.seed ?? index + 1 }))
    .sort((a, b) => a.seed - b.seed)
    .map((team) => team.name)
    .filter(Boolean);

  if (eventSetup.format === 'single-elimination') {
    return {
      summary: buildPreviewSummary(eventSetup),
      groups: [],
      stages: buildSingleElimStages(seededTeams.length ? seededTeams : ['Seed 1', 'Seed 2', 'Seed 3', 'Seed 4'])
    };
  }

  if (eventSetup.format === 'double-elimination') {
    return {
      summary: buildPreviewSummary(eventSetup),
      groups: [],
      stages: buildDoubleElimStages(seededTeams.length ? seededTeams : ['Seed 1', 'Seed 2', 'Seed 3', 'Seed 4'])
    };
  }

  if (eventSetup.format === 'groups') {
    const groups = buildGroupPreview(eventSetup, seededTeams);
    return {
      summary: buildPreviewSummary(eventSetup),
      groups,
      stages: [
        ...groups.map((group) => ({
          title: `${group.name} - confrontos iniciais`,
          subtitle: `${group.teams.length} times`,
          matches: pairTeams(group.teams, group.name)
        })),
        ...buildSingleElimStages(Array.from({ length: Math.max(2, groups.length * eventSetup.advancePerGroup) }, (_, index) => `${index + 1}o classificado`), 'Playoffs')
      ]
    };
  }

  return {
    summary: buildPreviewSummary(eventSetup),
    groups: [],
    stages: persistedPlan.stages.length
      ? persistedPlan.stages
      : Array.from({ length: Math.min(eventSetup.swissRounds, 5) }, (_, index) => ({
          title: `Swiss Round ${index + 1}`,
          subtitle: 'Pareamentos por campanha',
          matches: pairTeams(rotateTeams(seededTeams.length ? seededTeams : ['Seed 1', 'Seed 2', 'Seed 3', 'Seed 4', 'Seed 5', 'Seed 6', 'Seed 7', 'Seed 8'], index), `R${index + 1}`)
        }))
  };
}

function buildSingleElimStages(teams: string[], prefix = ''): EventPlan['stages'] {
  const seeded = [...teams];
  while (seeded.length < Math.max(2, nextPow2Local(seeded.length))) seeded.push('BYE');
  const stages: EventPlan['stages'] = [];
  let roundTeams = seeded;
  let size = seeded.length;
  while (size >= 2) {
    const roundName = size === 2 ? 'Final' : size === 4 ? 'Semifinal' : size === 8 ? 'Quartas' : `Top ${size}`;
    stages.push({
      title: prefix ? `${prefix} - ${roundName}` : roundName,
      subtitle: `${size / 2} confronto(s)`,
      matches: pairTeams(roundTeams, roundName)
    });
    size = size / 2;
    roundTeams = Array.from({ length: size }, (_, index) => `Vencedor ${roundName} ${index + 1}`);
  }
  return stages;
}

function buildDoubleElimStages(teams: string[]): EventPlan['stages'] {
  const winner = buildSingleElimStages(teams, 'Winner bracket');
  const lowerBase = teams.slice(1, Math.max(3, teams.length - 1));
  const lower = buildSingleElimStages(lowerBase.length ? lowerBase : ['Lower seed 1', 'Lower seed 2'], 'Lower bracket');
  return [
    ...winner,
    ...lower,
    {
      title: 'Grande final',
      subtitle: 'Winner bracket vs Lower bracket',
      matches: [{ id: 'grand-final-1', label: 'Final M1', team1: 'Winner bracket champion', team2: 'Lower bracket champion' }]
    }
  ];
}

function buildGroupPreview(eventSetup: EventSetupConfig, teams: string[]) {
  const groups = Array.from({ length: eventSetup.groupCount }, (_, index) => ({
    name: `Grupo ${String.fromCharCode(65 + index)}`,
    teams: [] as string[],
    advance: eventSetup.advancePerGroup
  }));
  teams.forEach((team, index) => {
    groups[index % groups.length].teams.push(team);
  });
  return groups;
}

function pairTeams(teams: string[], label: string) {
  const padded = [...teams];
  if (padded.length % 2 !== 0) padded.push('BYE');
  const matches: EventPlan['stages'][number]['matches'] = [];
  for (let index = 0; index < padded.length; index += 2) {
    matches.push({
      id: `${label}-${index / 2 + 1}`,
      label: `${label} M${index / 2 + 1}`,
      team1: padded[index] || 'TBD',
      team2: padded[index + 1] || 'TBD'
    });
  }
  return matches;
}

function rotateTeams(teams: string[], offset: number) {
  return teams.map((_, index) => teams[(index + offset) % teams.length]);
}

function nextPow2Local(value: number) {
  let out = 1;
  while (out < Math.max(1, value)) out *= 2;
  return out;
}

function findSeed(teams: Array<{ label: string; fullName: string; seed: number }>, label?: string) {
  if (!label) return null;
  const found = teams.find((team) => team.label === label || team.fullName === label);
  return found ? found.seed : null;
}

function decorateSeededLabel(label: string, teams: Array<{ label: string; fullName: string; seed: number }>) {
  const seed = findSeed(teams, label);
  return seed ? `S${seed} ${label}` : label;
}
