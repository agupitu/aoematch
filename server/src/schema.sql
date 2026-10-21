PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- catálogos

CREATE TABLE IF NOT EXISTS civs (
  id       INTEGER PRIMARY KEY,
  slug     TEXT NOT NULL UNIQUE,
  name_es  TEXT NOT NULL,
  name_en  TEXT NOT NULL,
  grp      TEXT NOT NULL,
  flag     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS maps (
  id       INTEGER PRIMARY KEY,
  slug     TEXT NOT NULL UNIQUE,
  name_es  TEXT NOT NULL,
  img      TEXT NOT NULL
);

-- ------------------------------------------------------------------ cuentas

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE,
  pass_hash     TEXT,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  discord       TEXT,
  steam_id64    TEXT UNIQUE,
  steam_name    TEXT,
  steam_avatar  TEXT,
  xbox_tag      TEXT,
  aoe3_profile  TEXT,            -- id de perfil en el leaderboard oficial / FFP
  rating_1v1    INTEGER,
  rating_team   INTEGER,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

-- Disponibilidad semanal recurrente, en minutos UTC desde el lunes 00:00.
-- Un bloque = [start_min, end_min). El cliente convierte a la zona del usuario.
CREATE TABLE IF NOT EXISTS availability (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_min  INTEGER NOT NULL,
  end_min    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_avail_user ON availability(user_id);

-- Excepciones puntuales: "este sábado no puedo" / "este jueves sí".
CREATE TABLE IF NOT EXISTS availability_exceptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,             -- YYYY-MM-DD (UTC)
  start_min  INTEGER NOT NULL,          -- minutos desde 00:00 UTC de ese día
  end_min    INTEGER NOT NULL,
  available  INTEGER NOT NULL DEFAULT 1 -- 1 = puedo, 0 = no puedo
);
CREATE INDEX IF NOT EXISTS idx_avail_exc_user ON availability_exceptions(user_id, day);

-- ----------------------------------------------------------------- torneos

CREATE TABLE IF NOT EXISTS tournaments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT,
  rules_md       TEXT,
  banner_url     TEXT,
  organizer_id   INTEGER NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'borrador',
                 -- borrador | inscripcion | armado | en_curso | finalizado | cancelado
  format         TEXT NOT NULL DEFAULT 'eliminacion_simple',
                 -- eliminacion_simple | eliminacion_doble | liga | grupos_playoff | suizo
  team_size      INTEGER NOT NULL DEFAULT 1,     -- jugadores por equipo (1 = 1v1)
  max_teams      INTEGER,
  best_of        INTEGER NOT NULL DEFAULT 3,     -- al mejor de N por serie
  best_of_final  INTEGER,                        -- opcional: final distinta
  group_count    INTEGER NOT NULL DEFAULT 0,     -- grupos_playoff
  group_advance  INTEGER NOT NULL DEFAULT 2,     -- clasifican por grupo
  swiss_rounds   INTEGER NOT NULL DEFAULT 0,
  third_place    INTEGER NOT NULL DEFAULT 0,

  -- draft de mapas
  map_mode       TEXT NOT NULL DEFAULT 'ban_hasta_uno',
                 -- fijo | aleatorio | ban_hasta_uno | ban_pick
  map_bans       INTEGER NOT NULL DEFAULT 1,     -- bans por equipo en ban_pick
  map_repeat     INTEGER NOT NULL DEFAULT 0,     -- repetir mapa dentro de la serie

  -- draft de civilizaciones
  civ_mode       TEXT NOT NULL DEFAULT 'snake',
                 -- libre | aleatorio | snake | ciega
  civ_bans       INTEGER NOT NULL DEFAULT 0,     -- bans de civ por equipo antes del snake
  civ_pattern    TEXT,                           -- ej "1-2-2-1"; NULL = automático
  civ_repeat_series INTEGER NOT NULL DEFAULT 1,  -- ¿puede repetirse una civ entre partidas?
  civ_repeat_team   INTEGER NOT NULL DEFAULT 0,  -- ¿dos del mismo equipo la misma civ?
  civ_mirror        INTEGER NOT NULL DEFAULT 1,  -- ¿ambos equipos la misma civ en la misma partida?
  draft_timer_s     INTEGER NOT NULL DEFAULT 60, -- 0 = sin reloj

  -- inscripciones
  entry_fee_cents INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'ARS',
  payment_link    TEXT,
  payment_notes   TEXT,
  allow_solo      INTEGER NOT NULL DEFAULT 1,    -- aceptar jugadores sueltos
  reg_opens_at    TEXT,
  reg_closes_at   TEXT,
  starts_at       TEXT,

  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tournament_maps (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  map_id        INTEGER NOT NULL REFERENCES maps(id),
  PRIMARY KEY (tournament_id, map_id)
);

CREATE TABLE IF NOT EXISTS tournament_civs (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  civ_id        INTEGER NOT NULL REFERENCES civs(id),
  PRIMARY KEY (tournament_id, civ_id)
);

CREATE TABLE IF NOT EXISTS tournament_admins (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (tournament_id, user_id)
);

-- ----------------------------------------------------------------- equipos

CREATE TABLE IF NOT EXISTS teams (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  tag           TEXT,
  logo_url      TEXT,
  captain_id    INTEGER REFERENCES users(id),
  seed          INTEGER,
  auto_built    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_teams_tournament ON teams(tournament_id);

CREATE TABLE IF NOT EXISTS team_members (
  team_id   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'jugador',   -- capitan | jugador | suplente
  PRIMARY KEY (team_id, user_id)
);

-- ------------------------------------------------------------ inscripciones

CREATE TABLE IF NOT EXISTS registrations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id       INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL DEFAULT 'solo',   -- solo | equipo
  status        TEXT NOT NULL DEFAULT 'pendiente',
                -- pendiente | confirmada | rechazada | retirada
  paid          INTEGER NOT NULL DEFAULT 0,
  paid_at       TEXT,
  payment_ref   TEXT,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tournament_id, user_id)
);

-- ------------------------------------------------------------------- fases

CREATE TABLE IF NOT EXISTS stages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  idx           INTEGER NOT NULL,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,   -- grupos | liga | eliminacion_simple | eliminacion_doble | suizo
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS groups (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id  INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  name      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_teams (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  team_id  INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, team_id)
);

-- ---------------------------------------------------------------- partidos

CREATE TABLE IF NOT EXISTS matches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  stage_id      INTEGER REFERENCES stages(id) ON DELETE CASCADE,
  group_id      INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  bracket       TEXT NOT NULL DEFAULT 'W',  -- W = ganadores, L = perdedores, F = gran final
  round         INTEGER NOT NULL DEFAULT 1,
  position      INTEGER NOT NULL DEFAULT 1,
  label         TEXT,
  team_a_id     INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  team_b_id     INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  winner_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  score_a       INTEGER NOT NULL DEFAULT 0,
  score_b       INTEGER NOT NULL DEFAULT 0,
  best_of       INTEGER NOT NULL DEFAULT 3,
  status        TEXT NOT NULL DEFAULT 'pendiente',
                -- pendiente | agendado | draft | en_juego | reportado | finalizado | walkover
  scheduled_at  TEXT,
  next_match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
  next_slot     TEXT,                       -- 'a' | 'b'
  loser_match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
  loser_slot    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);

-- Propuestas de horario para un partido (sale del cruce de disponibilidades).
CREATE TABLE IF NOT EXISTS match_schedule_votes (
  match_id  INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_utc  TEXT NOT NULL,                  -- ISO 8601 UTC
  vote      INTEGER NOT NULL DEFAULT 1,     -- 1 = puedo, 0 = no
  PRIMARY KEY (match_id, user_id, slot_utc)
);

CREATE TABLE IF NOT EXISTS match_games (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id       INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  game_no        INTEGER NOT NULL,
  map_id         INTEGER REFERENCES maps(id),
  winner_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  replay_url     TEXT,
  notes          TEXT,
  UNIQUE (match_id, game_no)
);

CREATE TABLE IF NOT EXISTS game_civs (
  game_id INTEGER NOT NULL REFERENCES match_games(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  civ_id  INTEGER REFERENCES civs(id),
  PRIMARY KEY (game_id, user_id)
);

-- ------------------------------------------------------------------- draft

CREATE TABLE IF NOT EXISTS drafts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id      INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  game_no       INTEGER NOT NULL DEFAULT 1,
  state         TEXT NOT NULL DEFAULT 'espera',  -- espera | en_curso | finalizado
  steps_json    TEXT NOT NULL,                   -- plan completo de pasos
  current_step  INTEGER NOT NULL DEFAULT 0,
  first_team_id INTEGER REFERENCES teams(id),
  deadline_at   TEXT,
  ready_a       INTEGER NOT NULL DEFAULT 0,
  ready_b       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  UNIQUE (match_id, game_no)
);

CREATE TABLE IF NOT EXISTS draft_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id   INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  step_idx   INTEGER NOT NULL,
  team_id    INTEGER REFERENCES teams(id),
  user_id    INTEGER REFERENCES users(id),      -- quién ejecutó la acción
  for_user_id INTEGER REFERENCES users(id),     -- a qué jugador le corresponde la civ
  kind       TEXT NOT NULL,                     -- ban_mapa | pick_mapa | ban_civ | pick_civ
  target_id  INTEGER NOT NULL,                  -- map_id o civ_id
  auto       INTEGER NOT NULL DEFAULT 0,        -- 1 = por timeout / aleatorio
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (draft_id, step_idx)
);

-- -------------------------------------------------------------------- chat

CREATE TABLE IF NOT EXISTS chat_rooms (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  match_id      INTEGER REFERENCES matches(id) ON DELETE CASCADE,
  team_id       INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,   -- torneo | partido | equipo
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rooms_match ON chat_rooms(match_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  system     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msgs_room ON chat_messages(room_id, id);
