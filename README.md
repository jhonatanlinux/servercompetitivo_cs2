# MT PRO LEAGUE - CS2 Manager

Painel web local para administrar servidores Counter-Strike 2 em ambiente competitivo (LAN/torneio). Foi pensado para a **MT PRO LEAGUE**, mas funciona em qualquer evento que use **MatchZy** + **CounterStrikeSharp**.

Repositorio: <https://github.com/jhonatanlinux/servercompetitivo_cs2>

![status](https://img.shields.io/badge/status-em%20produ%C3%A7%C3%A3o-success)
![cs2](https://img.shields.io/badge/CS2-1.41.5.6%2B-blue)
![css](https://img.shields.io/badge/CounterStrikeSharp-1.0.367-orange)

---

## O que ele faz

- **Inicia o servidor CS2** com perfil Competitivo (sem skins) ou Mix (com skins do WeaponPaints)
- **Carrega match no MatchZy** com times, mappool, série (MD1/MD3/MD5), veto opcional, SteamIDs
- **Controla a partida ao vivo** (force ready, knife, pause, tech pause, unpause, end match)
- **Mostra placar ao vivo** (Team CT × Team T, round atual, mapa, status: WARMUP / KNIFE / LIVE / PAUSED)
- **Estatísticas dos jogadores em tempo real** (K/D/A, ADR, HS%, KAST, Rating 2.0, MVPs, plants/defuses, first kills, clutches)
- **Restaura rounds** com 1 clique em caso de problema técnico (lista de backups + botão de pânico "Refazer round atual")
- **Console RCON** integrado com chips de comandos comuns
- **Liga/desliga skins** (`sv_pure 0/1` + ativa/desativa plugin de skins)
- **Configura GOTV** (porta 27020) e gravação de demo automaticamente
- Tudo via interface web local (`http://localhost:3001`)

---

## Stack

| Camada | Tecnologia |
| --- | --- |
| Servidor de jogo | Counter-Strike 2 Dedicated Server (`cs2.exe`) |
| Plugins do servidor | Metamod, CounterStrikeSharp 1.0.367, MatchZy Enhanced 1.4.21, WeaponPaints, MenuManagerCore, PlayerSettings |
| Persistência de skins | MariaDB local (porta 3306, base `cs2skins`) |
| Backend do painel | Node.js + Express + ws (WebSocket) + rcon-client |
| Front-end | HTML/CSS/JS vanilla (single file, sem build) |
| Comunicação servidor → painel | RCON (TCP 27015) + Webhooks HTTP do MatchZy |
| Identidade visual | Tema MT PRÓ LEAGUE (paleta dourado / vermelho / azul / preto) |

---

## Estrutura do projeto

```
D:\SERVER_CS2\
├── backend\                Node.js (server.js, rcon.js, cfgGenerator.js)
├── frontend\               index.html (single file) + logo.jpeg
├── cs2-ds\                 CS2 Dedicated Server (game files)
│   └── game\csgo\
│       ├── addons\
│       │   ├── metamod\
│       │   └── counterstrikesharp\
│       │       ├── plugins\          (WeaponPaints, MatchZy, MenuManagerCore, PlayerSettings)
│       │       ├── disabled_plugins\ (MatchZy.official-0.8.15 desativado)
│       │       ├── configs\plugins\WeaponPaints\WeaponPaints.json
│       │       └── gamedata\weaponpaints.json
│       ├── cfg\MatchZy\config.cfg
│       └── gameinfo.gi
├── cs2-configs\            Templates server.cfg, warmup.cfg, match.cfg, knife.cfg, practice.cfg
├── mariadb\                MariaDB 10.x portátil
├── mariadb-data\           Dados persistentes do banco
├── steamcmd\               SteamCMD para baixar/atualizar o CS2 DS
├── INICIAR.bat             Sobe MariaDB + backend + abre o painel
├── INICIAR-MARIADB.bat
├── backend.bat
├── ATUALIZAR-CS2-DS.bat
├── INSTALAR-PLUGINS-SKINS.bat
├── install-cs2-ds.bat
├── install-plugins.bat
├── install-cs2-plugins-skins.ps1
└── fix-gameinfo.ps1        Reaplica linha do Metamod no gameinfo.gi após updates do CS2
```

---

## Setup inicial (uma vez)

1. **Instale o Steam CS2 DS**:
   ```
   install-cs2-ds.bat
   ```
2. **Instale plugins (Metamod + CSS + MatchZy + WeaponPaints)**:
   ```
   INSTALAR-PLUGINS-SKINS.bat
   ```
3. **Crie o banco do WeaponPaints**:
   - Abra o MariaDB shell e rode:
     ```sql
     CREATE DATABASE cs2skins CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
     CREATE USER 'cs2skins'@'localhost' IDENTIFIED BY 'cs2skins';
     GRANT ALL PRIVILEGES ON cs2skins.* TO 'cs2skins'@'localhost';
     FLUSH PRIVILEGES;
     ```
4. **Instale dependências do backend**:
   ```
   cd backend && npm install
   ```

---

## Uso no dia a dia

```
INICIAR.bat
```

Esse `.bat` sobe o MariaDB, sobe o backend Node e abre `http://localhost:3001` no navegador. Daí no painel você:

1. Preenche **Nome do evento, Time CT, Time T**
2. Define **Modo de jogo** (MatchZy/Manual), **Série** (MD1/MD3/MD5), **Veto**
3. Seleciona o **mappool na ordem**
4. (opcional) Cola **SteamIDs** dos jogadores no avançado
5. Clica **Competitivo sem skins** ou **Mix com skins**
6. O painel inicia o servidor, conecta o RCON, e expõe os controles ativos

Durante a partida você tem na sidebar: Force ready, Knife round, Pause, Unpause, Tech pause, Iniciar partida, Reiniciar warmup, Status MatchZy, Encerrar match. No main: placar ao vivo, lista de rounds para restaurar, estatísticas dos jogadores e console RCON.

---

## API do backend

Tudo em `http://localhost:3001`. Aceita CORS.

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/api/status` | Estado geral: servidor ativo, perfil, RCON, plugins detectados |
| POST | `/api/launch` | Inicia o `cs2.exe` com a config dada e conecta o RCON |
| POST | `/api/session/stop` | Encerra processo do servidor + RCON |
| POST | `/api/rcon/connect` | Conecta o RCON (host, port, password) |
| POST | `/api/rcon/send` | Envia comando RCON livre |
| POST | `/api/action/<acao>` | Atalhos: `force-ready`, `knife`, `pause`, `unpause`, `tech-pause`, `tech-unpause`, `start-match`, `restart-warmup`, `practice`, `status`, `end-match`, `plugins` |
| POST | `/api/action/changemap` | `changelevel <map>` |
| POST | `/api/action/sv-pure` | Troca `sv_pure` (0 = mix, 1 = competitivo) |
| POST | `/api/action/skin-profile` | Move plugin de skins entre `plugins/` e `disabled_plugins/` |
| GET | `/api/matchzy/serve` | Devolve o `match.json` do MatchZy (consumido pelo `matchzy_loadmatch_url`) |
| GET | `/api/matchzy/score` | Placar parseado (`team1Name`, `team2Name`, `team1Score`, `team2Score`, `roundNumber`, `mapName`, `matchMode`, `isLive`) |
| GET | `/api/matchzy/backups` | Lista os arquivos de backup de round que o MatchZy gera |
| POST | `/api/matchzy/restore` | Restaura para um round (`{round}`) via `css_restore_round` |
| POST | `/api/matchzy/redo-round` | Botão de pânico: refaz o round atual |
| POST | `/api/matchzy/webhook` | Recebido pelo MatchZy a cada evento (kill, round_end, bomb_planted, etc.) |
| GET | `/api/matchzy/playerstats` | Stats agregadas dos jogadores (K/D/A, ADR, HS%, KAST, Rating 2.0, MVPs, plants, defuses, first kills, clutches) |
| POST | `/api/matchzy/playerstats/reset` | Zera as stats do mapa atual |

### WebSocket (`ws://localhost:3001`)

Eventos broadcast pelo backend:

| Evento | Quando dispara | Payload |
| --- | --- | --- |
| `log` | Cada linha de log do backend | `{message, level, time}` |
| `status` | Servidor liga/desliga, RCON conecta/cai | `{active, rcon}` |
| `playerstats` | Cada webhook do MatchZy processado | `{stats: [...], roundsPlayed}` |

---

## MatchZy webhook

Em `cs2-ds/game/csgo/cfg/MatchZy/config.cfg`:

```
matchzy_remote_log_url "http://127.0.0.1:3001/api/matchzy/webhook"
```

Sem isso o MatchZy não envia eventos e a tabela de estatísticas não atualiza.

---

## Manutenção

### CS2 atualizou e o servidor não sobe mais

Toda atualização do CS2 sobrescreve `csgo/gameinfo.gi`, removendo a linha que ativa o Metamod. Para corrigir:

```
fix-gameinfo.ps1
```

Esse script reaplica a linha `Game	csgo/addons/metamod` no `gameinfo.gi`.

### "Invalid function pointer" no log do CounterStrikeSharp

Significa que a signature do gamedata do WeaponPaints (ou de outro plugin) ficou desatualizada para a build atual do CS2. Atualize a signature em `addons/counterstrikesharp/gamedata/weaponpaints.json` (e na pasta do plugin) com base na build do `server.dll`.

### Comandos `!knife` e `!gloves` não abrem o menu

Verifica:
- `addons/counterstrikesharp/logs/log-WeaponPaints<data>.txt` para ver se o plugin carregou
- `configs/plugins/WeaponPaints/WeaponPaints.json` tem credenciais do banco corretas
- `configs/core.json` tem `"FollowCS2ServerGuidelines": false`

---

## Tema visual

Paleta MT PRÓ LEAGUE:

| Cor | Uso | Hex |
| --- | --- | --- |
| Dourado vibrante | Ações primárias, números, brand | `#FFB800` |
| Dourado claro | Highlights, hover de cor | `#FFD54A` |
| Dourado escuro | Sombras de gradiente | `#B8860B` |
| Vermelho MT | Time T, ações destrutivas, panic | `#E53935` |
| Vermelho claro | Hover de vermelho | `#FF5252` |
| Azul MT | Time CT, ação Mix | `#1E88E5` |
| Azul claro | Hover de azul | `#42A5F5` |
| Preto | Background | `#08090c` |

---

## Licença

Projeto privado de uso interno do evento **MT PRO LEAGUE**.

Plugins de terceiros mantêm suas próprias licenças:
- [CounterStrikeSharp](https://github.com/roflmuffin/CounterStrikeSharp) (GPL-3.0)
- [MatchZy](https://github.com/shobhit-pathak/MatchZy) (MIT)
- [WeaponPaints](https://github.com/Nereziel/cs2-WeaponPaints) (MIT)
- [Metamod:Source](https://www.sourcemm.net/) (zlib/libpng)

---

## Créditos

Painel web e integração: **MT PRO LEAGUE** team.
