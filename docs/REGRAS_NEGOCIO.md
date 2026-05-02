# Regras de negocio - MT PRO LEAGUE CS2 Manager

Este documento define as regras que devem guiar novas telas, endpoints e automacoes do painel.

## 1. Separacao entre Evento, Serie e Partida

- Evento: campeonato completo. Guarda nome, formato, times oficiais, roster, seeds, grupos, chaveamento, historico e estatisticas acumuladas.
- Serie: confronto entre dois times dentro do evento. Define MD1, MD3 ou MD5, veto, mapas, lado inicial e resultado.
- Partida/mapa: execucao real no servidor CS2. Possui placar, rounds, backup de rounds, demo, stats e estado live.

Regra: configuracoes permanentes ficam no Evento. Configuracoes operacionais do jogo atual ficam em Setup/Veto/Match.

## 2. Roster oficial e lineup

- Roster oficial pertence ao Evento.
- Lineup da serie atual e uma copia operacional do roster oficial.
- Alterar lineup no Setup nao deve alterar automaticamente o roster oficial.
- Para alterar cadastro definitivo de jogadores, usar a pagina Evento.

Regra: o servidor deve iniciar uma serie usando a lineup congelada naquele momento.

## 3. Espectadores

- Spectator nao conta como player.
- Spectator nao pode ocupar vaga de CT/T.
- Spectator nao entra em stats de CT/T.
- Se exibido no front, deve aparecer como SPEC separado.

Regra: ready check, stats e validacao de lineup consideram apenas jogadores CT/T.

## 4. Ready check

- Competitivo oficial: exige 10 jogadores prontos, 5 por time.
- Bot Lab: bots podem preencher CT/T, mas spectator humano continua fora da contagem.
- Practice/treino pode permitir menos jogadores, mas deve estar claramente marcado como treino.

Regra: uma partida competitiva nao pode iniciar por acidente com menos de 10 jogadores validos.

## 5. Veto e mapas

- O formato da serie controla o fluxo de veto.
- MD1: veto ate sobrar 1 mapa.
- MD3: bans, picks e decider.
- MD5: bans, picks e decider conforme regra configurada.
- O lado inicial deve ser definido por knife ou por escolha explicita.

Regra: o front nao deve permitir Start jogo se o veto estiver incompleto.

## 6. Formatos de evento

- Eliminacao simples: perdeu a serie, esta fora do evento.
- Winner + Lower: perdeu no winner, cai para lower; perdeu no lower, esta fora.
- Grupos: classificacao por grupo, com numero de classificados definido no evento.
- Suico: pareamento por campanha; avancam os melhores conforme regra configurada.

Regra: o preview e o bracket devem sempre refletir o formato selecionado, mesmo antes de salvar.

## 7. Match live, historico e arquivos

- Placar ao vivo deve representar apenas a partida atual.
- Backups de rounds antigos nao devem aparecer na partida nova.
- Ao encerrar e arquivar, demos e resultados saem da area live e entram no historico do evento.
- Restore de round deve operar somente sobre backups disponiveis e deixar claro qual round sera restaurado.

Regra: dados de partida anterior nunca devem contaminar a partida atual.

## 8. Integridade operacional

- Acoes destrutivas exigem confirmacao: encerrar partida, restore, redo round, restart, changelevel e comandos RCON sensiveis.
- O painel deve distinguir servidor ativo, partida live e RCON conectado.
- O front nao deve esconder erro critico com estado visual de sucesso.

Regra: comandos perigosos precisam ser intencionais e rastreaveis no log.

## 9. Skins e modo competitivo

- Start via Veto pode forcar perfil com skins se essa for a regra do produto.
- Competitivo oficial deve deixar claro quando esta com `sv_pure 1`.
- Mix/showmatch pode liberar skins.

Regra: o perfil escolhido deve determinar plugins e cvars antes do servidor subir.

## 10. Evolucao do codigo

- Toda nova regra de negocio deve ficar no backend ou em modulo compartilhado, nao apenas escondida no componente visual.
- O React deve controlar experiencia e validacao de interface.
- O backend deve validar payloads recebidos antes de executar RCON ou gerar configs.
- O estado do evento deve ser persistido em arquivo/DB, nao depender de localStorage.

Regra: se uma decisao afeta resultado do campeonato, ela precisa ser persistida e auditavel.
