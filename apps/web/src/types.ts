export type TabKey = 'setup' | 'match' | 'veto' | 'stats' | 'event' | 'console';

export type SeriesKey = 'md1' | 'md3' | 'md5';

export type SideChoice = 'knife' | 'ct' | 't';

export type VetoConfig = {
  series: SeriesKey;
  label?: string;
  numMaps?: number;
  pool: string[];
  bansCT: string[];
  bansT: string[];
  picksCT: string[];
  picksT: string[];
  maps?: string[];
  startMap?: string;
  sideChoice: SideChoice;
  sideTeam: 'CT' | 'T';
  vetoFirst?: 'CT' | 'T';
};

export type ServerStatus = {
  active: boolean;
  profile?: string | null;
  startedAt?: string | null;
  matchState?: string | null;
  matchStateChangedAt?: string | null;
  rcon: boolean;
  cs2Exe?: string | null;
  plugins?: {
    metamod?: boolean;
    counterStrikeSharp?: boolean;
    plugins?: string[];
    disabledPlugins?: string[];
    matchzy?: boolean;
    skins?: boolean;
    disabledSkins?: boolean;
  } | null;
};

export type ScoreStatus = {
  matchMode?: string | null;
  mapName?: string | null;
  roundNumber?: number | null;
  team1Name?: string | null;
  team1Side?: string | null;
  team1Score?: number | null;
  team2Name?: string | null;
  team2Side?: string | null;
  team2Score?: number | null;
  isLive?: boolean;
};

export type Backup = {
  file: string;
  round: number | null;
  kind: 'native' | 'matchzy' | string;
  size: number;
  mtime: string;
};

export type PlayerStat = {
  steamid: string;
  name: string;
  team: string;
  kills: number;
  deaths: number;
  assists: number;
  adr: number;
  hsPct: number;
  kd: number;
  kast: number;
  rating: number;
  mvps: number;
  plants: number;
  defuses: number;
  clutchesWon: number;
  damage?: number;
  score?: number;
  money?: number;
  health?: number;
  armor?: number;
  alive?: boolean;
  isBot?: boolean;
  isSpectator?: boolean;
  source?: string;
};

export type EventMatch = {
  id: string;
  archivedAt: string;
  eventName: string;
  mapName?: string | null;
  roundNumber?: number | null;
  team1Name: string;
  team2Name: string;
  team1Score: number;
  team2Score: number;
  winner: string;
  players: PlayerStat[];
  demos: Array<{ file: string; url: string; size: number }>;
  backups: Array<{ file: string; url: string; round?: number | null; size: number }>;
};

export type EventStatsResponse = {
  ok: boolean;
  matches: EventMatch[];
  totals: {
    matches: number;
    demos: number;
    maps: number;
  };
  leaders: {
    topKills: PlayerStat[];
    topKD: PlayerStat[];
    topRating: PlayerStat[];
    topClutches: PlayerStat[];
  };
};

export type EventFormatKey = 'swiss' | 'groups' | 'double-elimination' | 'single-elimination';

export type EventSetupConfig = {
  title: string;
  slug: string;
  format: EventFormatKey;
  seriesDefault: 'md1' | 'md3' | 'md5';
  teams: EventTeamConfig[];
  groupCount: number;
  teamsPerGroup: number;
  advancePerGroup: number;
  swissRounds: number;
  swissAdvance: number;
  upperLower: boolean;
  notes: string;
};

export type EventTeamConfig = {
  id: string;
  name: string;
  shortName: string;
  seed?: number;
  players: Array<{ steamid: string; name: string }>;
};

export type EventPlanMatch = {
  id: string;
  label: string;
  team1: string;
  team2: string;
};

export type EventPlanSection = {
  title: string;
  subtitle?: string;
  matches: EventPlanMatch[];
};

export type EventPlanGroup = {
  name: string;
  teams: string[];
  advance: number;
};

export type EventPlan = {
  summary: string[];
  groups: EventPlanGroup[];
  stages: EventPlanSection[];
};

export type EventSetupResponse = {
  ok: boolean;
  setup: EventSetupConfig;
  plan: EventPlan;
};

export type LaunchConfig = {
  eventName: string;
  teamCT: string;
  teamT: string;
  profile: 'competitive' | 'mix';
  useMatchzy: boolean;
  maps: string[];
  map: string;
  numMaps: number;
  skipVeto: boolean;
  sideChoice?: SideChoice;
  veto?: VetoConfig;
  minReady: number;
  gotv: boolean;
  demo: boolean;
  warmup: boolean;
  skins: boolean;
  rconHost: string;
  rconPort: number;
  rconPassword: string;
  maxRounds: string;
  timeoutDur: string;
  svPass: string;
  playersCT: Array<{ steamid: string; name: string }>;
  playersT: Array<{ steamid: string; name: string }>;
  botScenario?: boolean;
};
