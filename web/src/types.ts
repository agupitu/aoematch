export type User = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  timezone: string;
  discord: string | null;
  steam_id64: string | null;
  steam_name: string | null;
  google_sub: string | null;
  google_email: string | null;
  xbox_tag: string | null;
  rating_1v1: number | null;
  rating_team: number | null;
  is_admin: boolean;
};

export type Civ = {
  id: number;
  slug: string;
  name_es: string;
  name_en: string;
  grp: string;
  flag: string;
};

export type GameMap = {
  id: number;
  slug: string;
  name_es: string;
  img: string;
  /** Dónde queda (`web/src/logica/mapas-info.js`): america, europa, asia, africa u otros. */
  region?: string;
  /** tierra, agua o ambos. */
  terreno?: string;
};


export type Member = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  timezone?: string;
  rating_1v1?: number | null;
  rating_team?: number | null;
  role?: string;
};

export type Team = {
  id: string;
  tournament_id: string;
  name: string;
  tag: string | null;
  logo_url: string | null;
  captain_id: string | null;
  seed: number | null;
  auto_built: number;
  /** 1 si lo creó el organizador: se entra pidiendo lugar y con su aprobación. */
  staff_made?: number;
  members: Member[];
};

/** Pedido de un inscripto suelto para entrar a un equipo del organizador. */
export type JoinRequest = { team_id: string; status: 'pendiente' | 'rechazado'; created_at?: string };

export type Registration = {
  id: string;
  user_id: string;
  team_id: string | null;
  team_name: string | null;
  kind: 'solo' | 'equipo';
  status: 'pendiente' | 'confirmada' | 'rechazada' | 'retirada';
  paid: boolean;
  paid_at: string | null;
  payment_ref: string | null;
  note: string | null;
  join_request?: JoinRequest | null;
  display_name: string;
  avatar_url: string | null;
  rating_1v1: number | null;
  rating_team: number | null;
  timezone: string;
};

/** Cómo se decide una serie: al mejor de N, o a N partidas que se juegan todas (`web/src/logica/series.js`). */
export type SerieModo = 'mejor_de' | 'fijas';

export type Match = {
  id: string;
  tournament_id: string;
  stage_id: string | null;
  group_id: string | null;
  bracket: 'W' | 'L' | 'F';
  round: number;
  position: number;
  label: string | null;
  team_a_id: string | null;
  team_b_id: string | null;
  team_a_name: string | null;
  team_b_name: string | null;
  winner_team_id: string | null;
  score_a: number;
  score_b: number;
  best_of: number;
  series_mode?: SerieModo;
  status: string;
  scheduled_at: string | null;
  vod_links?: VodLink[];
};

export type StandingRow = {
  team: Team;
  pj: number;
  pg: number;
  pp: number;
  gf: number;
  gc: number;
  pts: number;
};

export type Prize = {
  id: number;
  position: number;
  label: string;
  kind: 'fijo' | 'porcentaje';
  amount_cents: number;
  percent: number;
  extra: string | null;
  /** Lo que le toca a este puesto una vez resuelta la bolsa. */
  value_cents: number;
};

export type PrizePool = {
  mode: string;
  total_cents: number;
  collected_cents: number;
  paid_count: number;
  assigned_cents: number;
  assigned_pct: number;
};

export type VodLink = { label: string; url: string };

export type Stage = {
  id: string;
  name: string;
  type: string;
  idx: number;
  vod_links?: VodLink[];
  groups: { id: string; name: string; standings: StandingRow[] }[];
};

export type Tournament = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  rules_md: string | null;
  banner_url: string | null;
  organizer_id: string;
  status: string;
  format: string;
  team_size: number;
  max_teams: number | null;
  best_of: number;
  best_of_final: number | null;
  series_mode?: SerieModo;
  group_count: number;
  group_advance: number;
  swiss_rounds: number;
  third_place: number;
  map_repeat: number;
  first_map_id: number | null;
  first_map: GameMap | null;
  civ_bans: number;
  civ_repeat_series: number;
  entry_fee_cents: number;
  currency: string;
  payment_link: string | null;
  payment_notes: string | null;
  allow_solo: number;
  reg_opens_at: string | null;
  reg_closes_at: string | null;
  starts_at: string | null;
  prize_pool_mode: string;
  prize_pool_cents: number;
  prize_pool_pct: number;
  prize_notes: string | null;
  prizes: Prize[];
  prize_pool: PrizePool;
  organizer: { id: string; display_name: string };
  maps: GameMap[];
  civs: Civ[];
  teams: Team[];
  registrations: Registration[];
  stages: Stage[];
  matches: Match[];
  standings: StandingRow[] | null;
  me: { is_staff: boolean; registration: Registration | null; team_id: string | null } | null;
};

export type ChatMessage = {
  id: string;
  body: string;
  system: boolean;
  created_at: string;
  user: { id: string; display_name: string; avatar_url: string | null } | null;
};

export type MatchDetail = Match & {
  tournament: {
    id: string;
    slug: string;
    name: string;
    team_size: number;
    best_of: number;
  };
  teams: {
    a: { id: string; name: string; roster: Member[] } | null;
    b: { id: string; name: string; roster: Member[] } | null;
  };
  games: {
    id: string;
    game_no: number;
    map_id: number | null;
    map: GameMap | null;
    winner_team_id: string | null;
    replay_url: string | null;
    civs: { user_id: string; team_id: string; civ_id: number; name_es: string; flag: string; display_name: string }[];
  }[];
  me: { team_id: string | null; is_staff: boolean; can_report: boolean; is_captain: boolean };
};

/** Franja en la que puede jugar un jugador: instantes UTC en texto ISO. */
export type Bloque = { starts_at: string; ends_at: string };

/** Un día del calendario de una ronda, en la zona de quien lo mira (`web/src/logica/calendario.js`). */
export type Dia = {
  dia: string;
  barras: { ms: number | null; hora: string; dentro: boolean }[];
};

/** tournaments/{slug}/rondas/{rondaId}: las fechas que fija el staff para una ronda. */
export type RondaDoc = {
  id: string;
  stage_id: string;
  bracket: 'W' | 'L' | 'F';
  round: number;
  label: string | null;
  from_day: string;
  to_day: string;
  zone: string;
  starts_at: string;
  ends_at: string;
};

/** Una ronda del cuadro con sus partidos (`web/src/logica/rondas.js`). */
export type Ronda = {
  id: string;
  stage_id: string;
  bracket: 'W' | 'L' | 'F';
  round: number;
  label: string;
  partidos: Match[];
};

/** Tramo en el que pueden jugar los jugadores de un partido (`web/src/logica/cruce.js`). */
export type Ventana = { starts_at: string; ends_at: string; count: number; missing: string[] };
