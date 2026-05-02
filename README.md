# MT PRO LEAGUE - CS2 Tournament Manager

Painel local para administrar eventos competitivos de Counter-Strike 2 com
MatchZy, CounterStrikeSharp, RCON, demos, backups de rounds e estatisticas em
tempo real.

## Stack atual

| Camada | Tecnologia |
| --- | --- |
| Frontend | React + TypeScript + Vite |
| Backend | Node.js + Express + WebSocket + RCON |
| Servidor de jogo | Counter-Strike 2 Dedicated Server |
| Plugins CS2 | Metamod, CounterStrikeSharp, MatchZy, WeaponPaints |
| Banco de skins | MariaDB local |

O frontend antigo em HTML/CSS/JS vanilla foi removido. A interface ativa fica em
`apps/web` e o backend serve o build gerado em `apps/web/dist`.

## Estrutura

```text
D:\SERVER_CS2\
|-- apps\
|   `-- web\                  Front React
|       |-- src\
|       |-- public\
|       |-- package.json
|       `-- vite.config.ts
|-- backend\                  API, RCON, MatchZy, WebSocket
|   |-- server.js
|   |-- cfgGenerator.js
|   |-- rcon.js
|   `-- vetoRules.js
|-- cs2-configs\              Templates de cfg
|-- cs2-ds\                   CS2 Dedicated Server
|-- docs\                     Documentacao e regras de negocio
|-- event-archive\            Historico, demos e arquivos encerrados
|-- mariadb\                  MariaDB portatil
|-- mariadb-data\             Dados locais do MariaDB
|-- steamcmd\                 SteamCMD para instalar/atualizar CS2 DS
|-- INICIAR.bat               Orquestrador principal
|-- install-cs2-ds.bat
|-- INSTALAR-PLUGINS-SKINS.bat
|-- ATUALIZAR-CS2-DS.bat
`-- fix-gameinfo.ps1
```

## Como iniciar

Execute:

```bat
INICIAR.bat
```

O script principal faz, nesta ordem:

1. Verifica `node` e `npm`.
2. Instala dependencias do backend se `node_modules` nao existir.
3. Instala dependencias do React se `node_modules` nao existir.
4. Valida/atualiza o CS2 Dedicated Server via SteamCMD.
5. Reaplica o Metamod no `gameinfo.gi` usando `fix-gameinfo.ps1`.
6. Inicia o MariaDB local quando `INICIAR-MARIADB.bat` existir.
7. Gera build atualizado do React.
8. Inicia o backend na porta `3001`.
9. Abre `http://localhost:3001`.

Para pular a validacao online do CS2 em um teste rapido:

```bat
set SKIP_CS2_UPDATE=1
INICIAR.bat
```

## Enderecos

| Uso | Endereco |
| --- | --- |
| Painel local | `http://localhost:3001` |
| API status | `http://localhost:3001/api/status` |
| WebSocket | `ws://localhost:3001` |
| CS2 local | `connect 127.0.0.1:27015` |
| GOTV local | `connect 127.0.0.1:27020` |

## Regras de negocio

As regras de negocio do projeto estao documentadas em:

```text
docs\REGRAS_NEGOCIO.md
```

Resumo das regras principais:

- Evento e partida sao entidades diferentes.
- Roster oficial pertence ao evento.
- Lineup pertence a partida.
- Spectator nao ocupa vaga de jogador.
- Partida nova nao herda placar, backups ou stats da anterior.
- Restore de round pertence somente a partida ativa.
- Resultado encerrado vai para historico do evento.
- Veto muda conforme MD1, MD3 ou MD5.
- Backend valida regras criticas; frontend apenas orienta o operador.

## Desenvolvimento do frontend

```bat
cd apps\web
npm install
npm run dev
```

Durante desenvolvimento, o Vite roda em `http://localhost:5173`. O backend segue
em `http://localhost:3001`.

Para gerar o build usado pelo backend:

```bat
cd apps\web
npm run build
```

## Desenvolvimento do backend

```bat
cd backend
npm install
npm start
```

## Rotas principais

| Metodo | Rota | Funcao |
| --- | --- | --- |
| GET | `/api/status` | Estado geral do painel, servidor e plugins |
| POST | `/api/launch` | Inicia o servidor CS2 com a config enviada |
| POST | `/api/session/stop` | Encerra a sessao atual |
| POST | `/api/rcon/connect` | Conecta RCON |
| POST | `/api/rcon/send` | Envia comando RCON |
| POST | `/api/action/:acao` | Acoes rapidas da partida |
| GET | `/api/matchzy/score` | Placar parseado do MatchZy |
| GET | `/api/matchzy/backups` | Lista backups de rounds |
| POST | `/api/matchzy/restore` | Restaura um round |
| POST | `/api/matchzy/webhook` | Recebe eventos do MatchZy |
| GET | `/api/matchzy/playerstats` | Estatisticas em tempo real |
| POST | `/api/match/end-archive` | Encerra e arquiva a partida |

## Manutencao

### CS2 atualizou e os plugins nao carregam

Execute:

```bat
powershell -ExecutionPolicy Bypass -File fix-gameinfo.ps1
```

O `INICIAR.bat` ja tenta fazer isso automaticamente apos validar o CS2 via
SteamCMD.

### WeaponPaints, !knife ou !gloves nao funcionam

Verifique:

- Se `WeaponPaints` aparece em `/api/status`.
- Se o MariaDB subiu corretamente.
- Se `WeaponPaints.json` tem host, usuario, senha e database corretos.
- Se `MenuManagerCore` e `PlayerSettings` estao carregados.
- Se `configs/core.json` permite menus do CounterStrikeSharp.

### Stats nao aparecem no painel

Verifique:

- Se o backend esta rodando em `http://localhost:3001`.
- Se o MatchZy esta enviando webhook para `/api/matchzy/webhook`.
- Se a partida atual nao esta usando dados de uma partida arquivada.
- Se spectators nao estao entrando como CT/TR.

## Limpeza da migracao

Removido:

- `frontend\index.html`
- `frontend\app.js`
- `frontend\styles.css`
- residuos temporarios do frontend antigo

Mantido:

- `apps\web` como frontend oficial.
- `backend` como API e integracao com o CS2.
- `cs2-configs`, `docs`, `event-archive`, `steamcmd`, `mariadb` e `cs2-ds`.

## Licenca

Projeto privado de uso interno da MT PRO LEAGUE.
