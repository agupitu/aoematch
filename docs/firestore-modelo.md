# Modelo de datos en Firestore

Cómo pasan las 25 tablas de `functions/src/schema.sql` a Firestore (tarea T04 del `PLAN.md`). Es la
referencia para la capa de datos (T05), las reglas (T06) y todas las rutas que se migran después.

## Principios

- **Escribe solo la API.** Las rutas de Express usan el Admin SDK, que no pasa por las reglas. El
  cliente lee directo solo tres cosas: los mensajes del chat, el aviso de cambios de cada partido y
  la presencia (en Realtime Database). Todo lo demás lo pide a la API. Así siguen en el servidor los
  permisos de hoy y el ocultamiento de picks ciegos de `estadoDraft`.
- **Lo que hoy es una tabla hija chica va adentro del documento padre**, como array o mapa: pools de
  mapas y civs, premios, miembros de equipo, grupos, partidas de una serie, acciones del draft, votos
  de horario. Se lee y escribe de una vez y entra cómodo en el límite de 1 MiB por documento.
- **Las consultas leen poco y filtran en memoria.** Un torneo tiene como mucho unos cientos de
  partidos, equipos e inscripciones: se lee la colección del torneo entera y se filtra en JS, como
  hacen hoy los `WHERE status IN (...)`. Eso deja solo dos índices compuestos.
- **El catálogo no va a la base.** Civs y mapas salen de `functions/src/catalogo.js` (T03); los
  documentos guardan solo sus ids numéricos.
- **No hay datos para migrar.** La base de Render se borra en cada apagado y la local se vuelve a
  sembrar con `npm run seed` (T24).

## Ids

| Entidad | Id del documento | Antes |
|---|---|---|
| Usuario | uid de Firebase Auth | entero autoincremental |
| Torneo | slug (`copa-aoe-iii-draft-2v2`) | entero; el slug era aparte |
| Inscripción | uid del usuario (dentro del torneo) | entero |
| Equipo, partido, etapa, mensaje | id automático de Firestore (20 caracteres) | entero |
| Draft | número de partida como texto (`"1"`, `"2"`), dentro del partido | entero |
| Sala de chat | `torneo_{slug}`, `partido_{matchId}`, `equipo_{teamId}` | entero |
| Civ, mapa | entero del catálogo, sin cambios | entero |

El slug de un torneo no cambia después de creado (`aplicarCampos` no lo toca), así que sirve de id.
`buscarTorneo(idOrSlug)` pasa a ser un solo `get`.

Para el frontend (T07): todos los ids pasan a texto salvo civ y mapa. `PATCH
/api/tournaments/:id/registrations/:regId` pasa a recibir el uid del inscripto en `:regId`
(`TournamentPage.tsx` hoy manda `r.id`; pasa a mandar `r.user_id`).

## Fechas

- Se quedan como texto ISO 8601 en UTC las fechas que hoy maneja la app como texto y compara como
  texto: `reg_opens_at`, `reg_closes_at`, `starts_at`, `scheduled_at`, `paid_at`, `deadline_at`,
  `finished_at`, `slot_utc` y los `created_at` de las entidades. La API las devuelve igual que hoy.
- Van como `Timestamp` solo donde Firestore lo necesita: `created_at` de los mensajes (se ordena con
  `serverTimestamp()` y lo lee el cliente), `at` de `live/*` y `expiresAt` de `authStates` (la
  política TTL solo borra por `Timestamp`).

## Colecciones

### `users/{uid}`

| Campo | Tipo | Viene de |
|---|---|---|
| `display_name`, `avatar_url`, `timezone`, `discord`, `xbox_tag` | texto | `users` |
| `display_name_lower` | texto | nuevo, para el buscador (T13) |
| `steam_id64`, `steam_name`, `steam_avatar` | texto o null | `users` |
| `google_sub`, `google_email` | texto o null | `users` |
| `google_unlinked_at` | ms o ausente | nuevo: cuándo se desvinculó Google; un token emitido antes no la vuelve a anotar (T10) |
| `email` | texto o null | `users`; solo lo tienen las cuentas de demo del emulador |
| `rating_1v1`, `rating_team` | entero o null | `users` |
| `is_admin` | entero `0/1` | `users` (`publicUser` lo devuelve como bool, igual que hoy) |
| `created_at` | texto ISO | `users` |

- Desaparecen `pass_hash` (las contraseñas de demo las guarda el emulador de Auth) y la tabla
  `sessions` (la sesión es el ID token de Firebase).
- El perfil ya no guarda horarios: `availability` (la semana fija) y `exceptions` se sacaron. Los
  horarios se cargan por ronda dentro del torneo (`tournaments/{slug}/rondas/{rondaId}/horarios/{uid}`).
  Un perfil viejo que todavía los tenga los conserva, pero nadie los lee ni las reglas dejan
  escribirlos.
- **Hoy la presencia del WebSocket manda `publicUser` completo a todos los de la sala**, con
  `google_email` y `steam_id64`. La presencia nueva (T28) guarda solo `display_name` y `avatar_url`.

### `steamIds/{steam_id64}`

`{ uid, created_at }`. Garantiza que una cuenta de Steam quede en un solo usuario (hoy lo hace el
`UNIQUE` de `users.steam_id64`). Se crea y se borra en la misma transacción que actualiza
`users/{uid}`. Para Google no hace falta: Firebase Auth ya no deja la misma cuenta en dos usuarios.

### `authStates/{nonce}`

`{ uid | null, link: bool, expiresAt: Timestamp }`. Estado del ida y vuelta con Steam (T11), con
política TTL sobre `expiresAt` para que los viejos se borren solos.

### `tournaments/{slug}`

Todas las columnas de configuración de `tournaments` quedan como campos con el mismo nombre y tipo.
Las banderas (`third_place`, `map_repeat`, `civ_repeat_series`, `civ_repeat_team`, `civ_mirror`,
`allow_solo`) siguen siendo enteros `0/1`, porque así las manda y las lee `TournamentPage.tsx`; lo
mismo `auto_built` en equipos y `ready_a`/`ready_b` en drafts. `first_map_id` sigue siendo un id de
mapa. Además:

| Campo | Tipo | Viene de |
|---|---|---|
| `organizer_id` | uid | `tournaments.organizer_id` |
| `admin_ids` | `[uid]` | tabla `tournament_admins` (hoy no hay ruta para sumar admins; solo la usa el seed) |
| `map_ids` | `[int]` | tabla `tournament_maps` |
| `civ_ids` | `[int]` | tabla `tournament_civs` |
| `prizes` | `[{ position, label, kind, amount_cents, percent, extra }]` | tabla `tournament_prizes` (máximo 20, como hoy `setPremios`) |
| `inscriptos` | entero | contador nuevo: inscripciones con `status != 'retirada'` |
| `pagos` | entero | contador nuevo: las anteriores con `paid` |
| `equipos` | entero | contador nuevo: equipos del torneo |
| `orden` | texto ISO | nuevo: `starts_at ?? created_at`, para el `ORDER BY COALESCE(...)` del listado |

- Los contadores reemplazan los `COUNT(*)` del listado y de `premiosDe`. Se actualizan con
  `FieldValue.increment` en la misma transacción que cambia la inscripción o el equipo (T16, T17,
  T20). Si alguna vez se desajustan, se recalculan leyendo las subcolecciones.
- `orden` se reescribe cada vez que cambia `starts_at`.
- El nombre del organizador del listado (`organizer_name`) no se copia al torneo: el listado hace un
  `getAll` de los organizadores, que son pocos.

#### `tournaments/{slug}/registrations/{uid}`

`{ user_id, team_id, kind, status, paid, paid_at, payment_ref, note, created_at }`, con `paid` entero
`0/1` como hoy (el detalle lo devuelve como bool). El id del
documento reemplaza el `UNIQUE (tournament_id, user_id)`. El detalle las lee todas y las ordena por
`created_at`; el armador filtra en memoria las sueltas (`kind == 'solo'`, sin `team_id`, no
retiradas).

#### `tournaments/{slug}/stages/{stageId}`

`{ idx, name, type, created_at, groups: [{ id, name, team_ids }] }`. Los grupos y sus equipos (tablas
`groups` y `group_teams`) van adentro de la etapa; `id` del grupo es la letra (`A`, `B`…), única
dentro de la etapa. Las búsquedas de hoy ("la etapa de grupos", "la etapa suiza") leen todas las
etapas del torneo, que son una o dos, y filtran.

#### `tournaments/{slug}/rondas/{rondaId}`

Las fechas en las que se juega una ronda del cuadro; las fija el staff. Una **ronda** es la terna
(`stage_id`, `bracket`, `round`) de los partidos, y su id es `{stage_id}_{bracket}{round}` (por ejemplo
`Zk3…_W2`; ver `web/src/logica/rondas.js`). El tercer puesto comparte ronda con la final y los grupos
comparten la fecha N. Solo hay documento para las rondas a las que el staff ya les puso fechas.

| Campo | Tipo | Para qué |
|---|---|---|
| `stage_id`, `bracket`, `round`, `label` | texto, `W`/`L`/`F`, entero, texto | qué ronda es |
| `from_day`, `to_day` | `YYYY-MM-DD` | lo que ve y edita el staff |
| `zone` | texto | zona del staff que guardó: cada día va de 00:00 a 24:00 en esa zona |
| `starts_at`, `ends_at` | texto ISO UTC | el rango real; `ends_at` es excluyente |
| `updated_at` | texto ISO | |

#### `tournaments/{slug}/rondas/{rondaId}/horarios/{uid}`

Los horarios que cargó un jugador para esa ronda: `{ user_id, blocks: [{ starts_at, ends_at }],
updated_at }`, con los instantes en ISO UTC, alineados a la grilla de 30 minutos, ordenados, fusionados
y recortados al rango de la ronda. Lo escribe cada jugador (inscripto, sin retirarse y solo si la ronda ya
tiene fechas); lo borra el dueño o el staff. Si el equipo pasa a la ronda siguiente, esa ronda empieza
sin horarios: se carga de nuevo. Las reglas no pueden recorrer la lista: validan la forma y el tope
(`blocks.size() <= 800`, 31 días de barras alternadas son 744). Al regenerar las llaves el staff borra
las rondas con sus horarios.

### `teams/{teamId}`

| Campo | Tipo | Viene de |
|---|---|---|
| `tournament_id` | slug | `teams` |
| `name`, `tag`, `logo_url` | texto | `teams` |
| `captain_id` | uid | `teams` |
| `seed` | entero o null | `teams` |
| `auto_built` | entero `0/1` | `teams` |
| `created_at` | texto ISO | `teams` |
| `members` | `[{ user_id, role }]` | tabla `team_members` |
| `member_ids` | `[uid]` | nuevo: los mismos uid, para `array-contains` |

Va en la raíz y no dentro del torneo porque los partidos, las salas y `equipoDelUsuario` lo buscan solo
por id. Nombre y avatar de los miembros no se copian: la API los completa con un `getAll` de `users`.
El orden de hoy (`COALESCE(seed, 9999), id`) se aplica en memoria.

### `matches/{matchId}`

Todas las columnas de `matches` con el mismo nombre (`tournament_id` es el slug; los `*_team_id`,
`next_match_id` y `loser_match_id` son ids de texto; `group_id` es la letra del grupo). Además:

| Campo | Tipo | Viene de |
|---|---|---|
| `games` | `[{ game_no, map_id, winner_team_id, replay_url, notes, civs: [{ user_id, team_id, civ_id }] }]` | tablas `match_games` y `game_civs` (una entrada por partida de la serie) |
| `schedule_votes` | `[{ user_id, slot_utc, vote }]` | tabla `match_schedule_votes`; se reemplaza la entrada del mismo usuario y horario, como el `INSERT OR REPLACE` de hoy |

- Va en la raíz por lo mismo que los equipos: `/api/matches/:id` y la sala `partido_{id}` solo traen
  el id.
- Las consultas de `brackets.js` por etapa, grupo, llave, ronda o estado leen los partidos del torneo
  (`where('tournament_id', '==', slug)`) y filtran en memoria.
- Los votos van en array y no en mapa porque `slot_utc` tiene puntos y `update()` los tomaría como
  rutas de campo.

#### `matches/{matchId}/drafts/{gameNo}`

`{ game_no, state, steps, current_step, first_team_id, deadline_at, ready_a, ready_b, created_at,
finished_at, actions: [{ step_idx, team_id, user_id, for_user_id, kind, target_id, auto, created_at }] }`.

- El id `"1"`, `"2"`… reemplaza el `UNIQUE (match_id, game_no)`. "El último draft del partido" es
  `orderBy('game_no', 'desc').limit(1)`.
- `steps_json` pasa a ser el array `steps` sin serializar. `actions` reemplaza la tabla
  `draft_actions`; su `UNIQUE (draft_id, step_idx)` se respeta porque solo se agrega la acción del
  paso actual dentro de la transacción (T21).
- Tamaño: `ban_hasta_uno` agrega un paso por mapa del pool menos uno; con los 174 mapas del catálogo
  serían unos 190 pasos y otras tantas acciones, muy por debajo de 1 MiB.

### `rooms/{roomId}` y `rooms/{roomId}/messages/{id}`

Sala: `{ kind, tournament_id, match_id, team_id, name, public_read, readers, created_at }`.

| Sala | id | `public_read` | `readers` |
|---|---|---|---|
| General del torneo | `torneo_{slug}` | sí | vacío |
| Partido | `partido_{matchId}` | sí | vacío |
| Equipo | `equipo_{teamId}` | no | miembros del equipo + organizador + `admin_ids` |

Mensaje: `{ body, system, created_at: Timestamp, user: { id, display_name, avatar_url } | null }`.

- Nombre y avatar del autor van copiados en el mensaje porque el cliente lee los mensajes directo y
  no puede leer `users`. Un cambio de avatar no actualiza los mensajes viejos.
- Quién puede **escribir** (hoy `puedeEscribir`) lo decide la API en
  `POST /api/rooms/:room/messages` (T25); las reglas solo controlan la lectura (T06).
- `readers` lo mantienen al día las mismas transacciones que cambian el equipo (T17, T20).
- Las salas de partido se crean cuando hacen falta (primer mensaje o primer aviso del sistema), no
  al generar las llaves como hoy `crearMatch`. Así la generación de una doble eliminación de 64
  equipos (unos 127 partidos) entra en un solo batch de 500 escrituras.

### `live/{matchId}`

`{ draft: int, match: int, votes: int, at: Timestamp }`. Lo sube la API después de cada cambio (T26);
el cliente lo escucha y, cuando cambia, vuelve a pedir el estado a la API (T27). Reemplaza los
`publish()` de `bus.js`.

### Realtime Database: `presence/{roomId}/{uid}`

`{ display_name, avatar_url, at }`, con `onDisconnect().remove()` (T28). Cada usuario escribe solo su
propia entrada.

## De dónde sale cada tabla

| Tabla SQLite | Destino |
|---|---|
| `civs`, `maps` | `functions/src/catalogo.js` |
| `users` | `users/{uid}` |
| `sessions` | Firebase Auth (ID token) |
| `availability`, `availability_exceptions` | sin destino: los horarios pasaron a ser por ronda, `tournaments/{slug}/rondas/{rondaId}/horarios/{uid}` |
| `tournaments` | `tournaments/{slug}` |
| `tournament_maps`, `tournament_civs` | `tournaments/{slug}.map_ids` y `.civ_ids` |
| `tournament_prizes` | `tournaments/{slug}.prizes` |
| `tournament_admins` | `tournaments/{slug}.admin_ids` |
| `teams`, `team_members` | `teams/{teamId}` con `members` y `member_ids` |
| `registrations` | `tournaments/{slug}/registrations/{uid}` |
| `stages`, `groups`, `group_teams` | `tournaments/{slug}/stages/{stageId}` con `groups` |
| `matches` | `matches/{matchId}` |
| `match_schedule_votes` | `matches/{matchId}.schedule_votes` |
| `match_games`, `game_civs` | `matches/{matchId}.games` |
| `drafts`, `draft_actions` | `matches/{matchId}/drafts/{gameNo}` con `actions` |
| `chat_rooms`, `chat_messages` | `rooms/{roomId}` y `rooms/{roomId}/messages` |
| — | `steamIds`, `authStates`, `live`, `tournaments/{slug}/rondas` y sus `horarios` (nuevas) |

## Consultas e índices

| Para qué | Consulta | Índice |
|---|---|---|
| Listado de torneos por estado | `tournaments` `where status ==` `orderBy orden desc` | compuesto: `status` ↑, `orden` ↓ |
| Listado sin filtro | `tournaments` `orderBy orden desc` | automático |
| Detalle del torneo | `get` del torneo; `teams` y `matches` `where tournament_id ==`; subcolecciones `registrations` y `stages` completas; `getAll` de `users` | automáticos |
| Equipo de un usuario en un torneo | `teams` `where tournament_id ==` + `where member_ids array-contains uid` | compuesto: `tournament_id` ↑, `member_ids` (array) |
| Equipo de un usuario en un partido | `get` del partido + `getAll` de sus dos equipos | — |
| Último draft de un partido | `drafts` `orderBy game_no desc limit 1` | automático |
| Historial de una sala | `messages` `orderBy created_at desc limit 80` | automático |
| Buscador de usuarios (si D4 = "empieza con") | `users` `orderBy display_name_lower` con `startAt(q)` / `endAt(q + '')` `limit 20` | automático |
| Ingreso con Steam | `get` de `steamIds/{id64}` | — |
| Borrar un torneo | `recursiveDelete` del torneo; `teams`, `matches` y `rooms` `where tournament_id ==` (los partidos con `recursiveDelete` por sus drafts); `live/{matchId}` de esos partidos | automáticos |

Los dos índices compuestos van en `firestore.indexes.json` (T05). La consulta de equipos con
`array-contains` es la única que no se resuelve en memoria leyendo el torneo: la usan las rutas que
solo necesitan "mi equipo" sin cargar el detalle entero.

## Transacciones y batches

Firestore exige que en una transacción todas las lecturas vayan antes que las escrituras, y acepta
como máximo 500 escrituras por transacción o batch.

| Operación | Cómo | Documentos que escribe |
|---|---|---|
| Inscribirse, retirarse, marcar pago | transacción | inscripción, equipo, contadores del torneo, `readers` de la sala del equipo |
| Crear equipo, sumar o sacar miembro, cambiar capitán | transacción | equipo, inscripciones, contadores, sala del equipo |
| Confirmar el armador de equipos | batch | equipos, inscripciones, contadores, salas |
| Generar llaves | un batch para borrar lo anterior y otro para crear | partidos (ids generados antes con `doc()` para los enlaces), etapas, `seed` de equipos, estado del torneo |
| Cerrar un partido | transacción | partido, siguiente partido, partido del perdedor, estado del torneo si fue el último |
| Acción del draft, listo, timeout | transacción | draft, partido (estado y `games` al terminar) |
| Voto de horario | transacción | partido |
| Mensaje de chat | escritura simple | mensaje (y la sala si no existía) |
| Aviso de cambios | escritura simple, después del commit | `live/{matchId}` |

Los efectos fuera de la base (encolar la tarea del reloj, avisar en `live`) van siempre después del
commit, porque una transacción se puede reintentar.

## Tamaños

| Documento | Lo más grande que puede llegar a tener |
|---|---|
| `users` | solo campos de texto y números |
| `rondas/{rondaId}/horarios/{uid}` | 800 bloques de 30 minutos como mucho (31 días de barras alternadas son 744) |
| `tournaments` | 174 `map_ids`, 24 `civ_ids`, 20 premios |
| `matches` | `best_of` partidas con hasta 8 civs cada una, y los votos de horario de 8 jugadores |
| `drafts` | unos 190 pasos y 190 acciones (pool con todos los mapas) |

Todos quedan lejos de 1 MiB.

## Lectura desde el cliente (lo que cubren las reglas, T06)

| Ruta | Quién lee | Quién escribe |
|---|---|---|
| `rooms/{roomId}/messages` | cualquiera si la sala es `public_read`; si no, solo los uid de `readers` | nadie (escribe la API) |
| `live/{matchId}` | cualquiera | nadie (escribe la API) |
| RTDB `presence/{roomId}` | cualquiera | cada usuario, solo su `presence/{roomId}/{uid}` |
| Todo lo demás | nadie | nadie |
