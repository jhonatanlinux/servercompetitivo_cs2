# MT PRO LEAGUE - Regras de Negocio

Este projeto trata skins, bots e transmissao como recursos do ambiente. Eles nao alteram a base competitiva da partida.

## Base competitiva obrigatoria

Todos os modos de jogo seguem a base `official-mr12-no-friendly-fire`:

- MR12: `mp_maxrounds 24`
- Start money: `$800`
- After round money: `$0`
- Max money: `$16000`
- Overtime: MR3 com `$10000`
- Buy anywhere: desligado
- Infinite ammo: desligado
- Respawn em round live: desligado
- Armor gratis: desligado
- Friendly fire: desligado
- Reducao de dano amigo por bala/granada/outros: `0`

## Modos suportados

- Competitivo sem skins: regra oficial + `sv_pure 1`.
- Competitivo com skins: regra oficial + plugins de skins + `sv_pure 0`.
- Mix sem skins: regra oficial + operacao flexivel.
- Mix com skins: regra oficial + plugins de skins + `sv_pure 0`.
- Bot Lab sem skins: regra oficial + bots reais.
- Bot Lab com skins: regra oficial + bots reais + plugins de skins.

## Fluxo de partida

Estados oficiais do backend:

- `idle`
- `setup`
- `warmup`
- `ready`
- `knife`
- `live`
- `paused`
- `tech_paused`
- `restore_pending`
- `ended`
- `archived`

Restore de round so deve acontecer a partir de estados competitivos vivos, como `live`, `paused` ou `tech_paused`.

## Operacao e auditoria

Acoes administrativas relevantes devem ser registradas no audit log:

- iniciar servidor
- iniciar via veto
- iniciar partida
- enviar comando RCON manual
- restaurar round
- encerrar sessao
- mudanca de estado da partida

O arquivo fica em `event-archive/audit-log.jsonl`.

## Roster

Para evento oficial:

- 5 jogadores por time.
- SteamID64 recomendado para cada jogador.
- O mesmo SteamID nao pode estar nos dois times.
- Spectador nao deve ocupar vaga de jogador.
- Coach/reserva devem ser tratados fora dos 5 slots oficiais.

## Veto

- MD1: um mapa final.
- MD3: tres mapas finais.
- MD5: cinco mapas finais.
- Eliminacao simples nao tem lower bracket nem segunda chance.

## Regra de ouro

Nenhum recurso visual ou plugin pode mudar a regra competitiva sem passar pelo ruleset central em `backend/domain/ruleSets.js`.
