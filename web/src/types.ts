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
  aoe3_profile: string | null;
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

export type GameMap = { id: number; slug: string; name_es: string; img: string };

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
  members: Member[];
  overlap_min: number | null;
};

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
  display_name: string;
  avatar_url: string | null;
  rating_1v1: number | null;
  rating_team: number | null;
  timezone: string;
};

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
  status: string;
  scheduled_at: string | null;
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

export type Stage = {
  id: string;
  name: string;
  type: string;
  idx: number;
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
  group_count: number;
  group_advance: number;
  swiss_rounds: number;
  third_place: number;
  map_mode: string;
  map_bans: number;
  map_repeat: number;
  first_map_id: number | null;
  first_map: GameMap | null;
  civ_mode: string;
  civ_bans: number;
  civ_pattern: string | null;
  civ_pattern_efectivo: string;
  civ_repeat_series: number;
  civ_repeat_team: number;
  civ_mirror: number;
  draft_timer_s: number;
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

export type DraftStep = {
  idx: number;
  kind: 'ban_mapa' | 'pick_mapa' | 'ban_civ' | 'pick_civ';
  side: 'a' | 'b' | null;
  slot: number | null;
  auto: boolean;
  blind?: boolean;
};

export type CivPick = {
  step_idx: number;
  team_id: string;
  side: 'a' | 'b' | null;
  slot: number | null;
  user_id: string | null;
  civ_id: number | null;
  hidden: boolean;
  auto: boolean;
};

export type DraftState = {
  id: string;
  match_id: string;
  game_no: number;
  state: 'espera' | 'en_curso' | 'finalizado';
  current_step: number;
  total_steps: number;
  deadline_at: string | null;
  timer_s: number;
  ready: { a: boolean; b: boolean };
  first_team_id: string | null;
  teams: { a: { id: string; roster: Member[] }; b: { id: string; roster: Member[] } };
  steps: DraftStep[];
  step: DraftStep | null;
  turn_team_id: string | null;
  pools: { maps: GameMap[]; civs: Civ[] };
  maps_banned: number[];
  map_picked: number | null;
  civs_banned: number[];
  civ_picks: CivPick[];
  rules: {
    map_mode: string;
    civ_mode: string;
    civ_pattern: string;
    civ_repeat_team: boolean;
    civ_mirror: boolean;
    civ_repeat_series: boolean;
    team_size: number;
  };
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
    map_mode: string;
    civ_mode: string;
    draft_timer_s: number;
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
  draft: DraftState | null;
  me: { team_id: string | null; is_staff: boolean; can_report: boolean; is_captain: boolean };
};

export type Window = {
  start_min: number;
  end_min: number;
  count: number;
  missing: string[];
  next_utc: string;
};
