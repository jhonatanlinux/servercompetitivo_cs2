const OFFICIAL_MAP_POOL = ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass'];

const SERIES_CONFIG = {
  md1: { label: 'MD1', numMaps: 1, bansPerTeam: 3, picksCT: 0, picksT: 0 },
  md3: { label: 'MD3', numMaps: 3, bansPerTeam: 2, picksCT: 1, picksT: 1 },
  md5: { label: 'MD5', numMaps: 5, bansPerTeam: 1, picksCT: 2, picksT: 2 },
};

function normalizeSeries(value) {
  const key = String(value || 'md1').toLowerCase();
  return SERIES_CONFIG[key] ? key : 'md1';
}

function cleanMapList(maps, fallback = OFFICIAL_MAP_POOL) {
  const unique = [];
  const incoming = Array.isArray(maps) && maps.length ? maps : fallback;
  for (const map of incoming) {
    const value = String(map || '').trim();
    if (value && !unique.includes(value)) unique.push(value);
  }
  return unique.length ? unique : [...fallback];
}

function normalizeSide(value) {
  const side = String(value || 'knife').toLowerCase();
  if (side === 'ct' || side === 't' || side === 'knife') return side;
  return 'knife';
}

function buildVetoConfig(input = {}) {
  const series = normalizeSeries(input.series);
  const rules = SERIES_CONFIG[series];
  const pool = cleanMapList(input.pool || input.maps);
  const banned = cleanMapList([...(input.bansCT || []), ...(input.bansT || [])], []).filter((map) => pool.includes(map));
  const picked = cleanMapList([...(input.picksCT || []), ...(input.picksT || [])], []).filter((map) => pool.includes(map) && !banned.includes(map));
  const remaining = pool.filter((map) => !banned.includes(map) && !picked.includes(map));
  const maps = [...picked, ...remaining].slice(0, rules.numMaps);

  return {
    series,
    label: rules.label,
    numMaps: rules.numMaps,
    pool,
    bansCT: cleanMapList(input.bansCT || [], []).filter((map) => pool.includes(map)).slice(0, rules.bansPerTeam),
    bansT: cleanMapList(input.bansT || [], []).filter((map) => pool.includes(map)).slice(0, rules.bansPerTeam),
    picksCT: cleanMapList(input.picksCT || [], []).filter((map) => pool.includes(map)).slice(0, rules.picksCT),
    picksT: cleanMapList(input.picksT || [], []).filter((map) => pool.includes(map)).slice(0, rules.picksT),
    maps,
    startMap: maps[0] || pool[0],
    sideChoice: normalizeSide(input.sideChoice),
    sideTeam: input.sideTeam === 'T' ? 'T' : 'CT',
    vetoFirst: input.vetoFirst === 'T' ? 'T' : 'CT',
    skipVeto: true,
  };
}

function applyVetoToConfig(config, vetoInput) {
  const veto = buildVetoConfig(vetoInput || config.veto || {});
  return {
    ...config,
    veto,
    numMaps: veto.numMaps,
    maps: veto.maps,
    map: veto.startMap,
    skipVeto: true,
    sideChoice: veto.sideChoice,
  };
}

module.exports = {
  OFFICIAL_MAP_POOL,
  SERIES_CONFIG,
  buildVetoConfig,
  applyVetoToConfig,
};
