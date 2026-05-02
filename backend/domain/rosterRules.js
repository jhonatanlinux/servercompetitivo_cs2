const STEAMID64_RE = /^7656119\d{10}$/;

function normalizePlayer(player = {}) {
  return {
    steamid: String(player.steamid || player.steamId || '').trim(),
    name: String(player.name || player.playerName || '').trim(),
  };
}

function normalizeRoster(players) {
  return (Array.isArray(players) ? players : [])
    .map(normalizePlayer)
    .filter((player) => player.name || player.steamid)
    .slice(0, 5);
}

function validateRoster(players, options = {}) {
  const roster = normalizeRoster(players);
  const issues = [];
  const seen = new Set();

  if (options.requireFive && roster.length !== 5) {
    issues.push(`Roster deve ter exatamente 5 jogadores; recebido ${roster.length}.`);
  }

  for (const player of roster) {
    if (options.requireSteamId && !STEAMID64_RE.test(player.steamid)) {
      issues.push(`SteamID64 invalido ou ausente para ${player.name || 'player sem nome'}.`);
    }
    if (player.steamid) {
      if (seen.has(player.steamid)) issues.push(`SteamID duplicado: ${player.steamid}.`);
      seen.add(player.steamid);
    }
  }

  return { roster, ok: issues.length === 0, issues };
}

function validateMatchRosters(config = {}, options = {}) {
  const ct = validateRoster(config.playersCT, options);
  const t = validateRoster(config.playersT, options);
  const overlap = new Set(ct.roster.map((player) => player.steamid).filter(Boolean));
  const issues = [...ct.issues.map((issue) => `CT: ${issue}`), ...t.issues.map((issue) => `T: ${issue}`)];

  for (const player of t.roster) {
    if (player.steamid && overlap.has(player.steamid)) issues.push(`SteamID em ambos os times: ${player.steamid}.`);
  }

  return { ok: issues.length === 0, issues, playersCT: ct.roster, playersT: t.roster };
}

module.exports = {
  STEAMID64_RE,
  normalizePlayer,
  normalizeRoster,
  validateRoster,
  validateMatchRosters,
};
