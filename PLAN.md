# Plan: AoE III Draft en Firebase plan Spark (sin servidor)

**Objetivo.** Que la página quede siempre prendida, gratis, en el plan Spark de Firebase: torneos,
inscripciones, armador de equipos, llaves, horarios, chat por sala y equipo, draft de mapa y civs con
pick ciego, links de las partidas e ingreso con Google. El creador del torneo carga los resultados y
mueve las llaves.

**Arquitectura.** Spark no corre código de servidor: no hay Cloud Functions, Cloud Tasks ni Secret
Manager. Firebase Hosting sirve la web y las imágenes. La web lee y escribe Firestore directo con el
SDK de cliente, y `firestore.rules` decide quién escribe qué: es la única barrera de seguridad. La
lógica pura que hoy está en `functions/src` (llaves, armador, horarios) pasa a la web y corre en el
navegador de quien actúa: el del creador para llaves y resultados, el de cada jugador para su pick.
Firebase Auth solo con Google; el perfil de Steam se pega a mano y no se verifica. El tiempo real son
escuchas de Firestore sobre el partido, el draft y el chat; la presencia, Realtime Database. Sin reloj
en el draft: se espera a que elijan todos.

**Estado.** 16 tareas pendientes, 65 h en total (unos 11 días de 6 h para una persona sola; unos 5
días con dos seniors y un junior). Hechas en la rama `feat/firebase`: T02 a T27 sobre el plan Blaze
anterior, y T01, T34, T35 y T42 del plan Spark. No hay datos para migrar.

**Qué cambia del trabajo hecho.** Se aprovechan el modelo de datos (T04), la lógica de llaves,
armador y horarios (T18–T20), la demo (T24), el chat sobre Firestore (T25) y la web (T12, T27). Se
descartan la API Express como función (T02, T07–T09, T13–T17, T23), el ingreso con Steam por OpenID
y token propio (T11), el motor de draft viejo (T21), el reloj con Cloud Tasks (T22), los avisos de
`live/{matchId}` (T26) y la configuración de funciones de T29. Quién escribe qué deja de estar en
las rutas y pasa a `firestore.rules`.

**Pedido del 2026-10-26 que define el alcance.**
- El creador del torneo (y sus admins) es el único que carga resultados y actualiza las llaves. Los
  capitanes ya no reportan.
- En cada partido (llave) y en cada fase se pueden dejar links de las partidas (YouTube u otra).
- Draft: primero el mapa, que lo elige el equipo que perdió la partida anterior; el de la primera lo
  fija el creador o sale al azar. Después, bans de civ si el creador los configuró. Después cada
  jugador elige su civ sin ver las de nadie y se muestran todas cuando eligieron todos.

## Lo que ya está

**Fase 0 · Base del proyecto** (rama `feat/firebase`)

| ID | Qué quedó | Dónde |
|---|---|---|
| T02 | El backend vive en `functions/` y corre como la función `api` (São Paulo) en los emuladores. `npm run dev` levanta emuladores y Vite; `npm run emuladores`, solo los emuladores (UI en :4000). Mientras dure la migración la API sigue sobre SQLite (Node local), así que la web anda salvo el chat y el draft en vivo, que dependían del WebSocket. | `functions/src/app.js`, `functions/src/index.js`, `firebase.json`, `.firebaserc`, `tools/emuladores.mjs` |
| T02 | Java para los emuladores: `JAVA_HOME_EMULADORES` en `local.env` (en esta PC, el JDK de Android Studio). | `local.env` |
| T02 | `firestore.rules` y `database.rules.json` que niegan todo, e índices vacíos: los completan T06 y T05. | raíz |
| T03 | Catálogo en `functions/data/` leído por `catalogo.js`; banderas y minimapas en `web/public/assets/`. `/api/civs` y `/api/maps` responden igual que antes. | `functions/src/catalogo.js`, `tools/fetch-assets.mjs` |
| T04 | Modelo de datos completo: colecciones, ids, fechas, índices, transacciones y lectura desde el cliente. | `docs/firestore-modelo.md` |

**Fase 1 · Datos y seguridad**

| ID | Qué quedó | Dónde |
|---|---|---|
| T05 | Capa de datos sobre Firestore: un módulo por entidad (usuarios y Steam, torneos y etapas, inscripciones, equipos, partidos, drafts, salas y mensajes), `enTransaccion` con efectos que corren después del commit, `borrarTorneo` en cascada y los dos índices compuestos. 28 pruebas con `node:test` contra el emulador: `npm test`. | `functions/src/data/`, `functions/test/data.test.js`, `firestore.indexes.json` |
| T05 | Las rutas pasan a `data/` en su tarea (T15 a T23). `db.js`, `schema.sql`, `cargarCatalogo()` y las tablas `civs` y `maps` se borran en T33, cuando no quede SQL. | — |
| T06 | Reglas: el cliente solo lee `live/*` y los mensajes de las salas (`public_read` o su uid en `readers`); nadie escribe desde el cliente. En Realtime Database cada uno escribe solo su `presence/{sala}/{uid}` con nombre, avatar y hora. 11 pruebas con `@firebase/rules-unit-testing`. | `firestore.rules`, `database.rules.json`, `functions/test/rules.test.js` |
| T07 | Ids de usuarios, torneos, equipos, inscripciones, partidos, etapas, grupos, drafts y mensajes en texto en `web/src/types.ts`. Civ y mapa siguen en número. El `PATCH` de una inscripción manda `user_id` (es el id del doc). | `web/src/types.ts`, `web/src/pages/TournamentPage.tsx`, `web/src/pages/MatchRoom.tsx`, `web/src/components/DraftBoard.tsx`, `web/src/components/ChatPanel.tsx` |

**Fase 2 · Autenticación**

| ID | Qué quedó | Dónde |
|---|---|---|
| T08 | `attachUser` valida `Authorization: Bearer <idToken>` con `verifyIdToken` y deja en `req.user` el doc `users/{uid}`; la primera vez lo crea con nombre, foto y email (o `google_sub` y `google_email` si entró con Google). Un token vencido o trucho cuenta como anónimo. `GET` y `PATCH /api/auth/me` leen y escriben Firestore. 7 pruebas en `npm test`. | `functions/src/auth.js`, `functions/src/routes/auth.js`, `functions/test/auth.test.js` |
| T08 | Puente: sin token válido, el usuario sale de la cookie y de SQLite como antes (`req.usuarioFirebase` dice de cuál salió), así la web sigue entrando hasta que pase a Firebase (T09 a T12). `/login`, `/logout`, las sesiones por cookie, `bcryptjs` y `cookie-parser` se borran en T33. | — |
| T10 | Google entra y se vincula con Firebase Auth en la web (`signInWithPopup`, `linkWithPopup`); la API anota `google_sub` y `google_email` cuando el token trae Google y los borra al desvincular (`providersToUnlink`), sin que un token viejo los vuelva a poner. Se fueron las rutas de Google por servidor y `GOOGLE_CLIENT_*`. 5 pruebas. | `functions/src/auth.js`, `functions/src/routes/auth.js`, `web/src/pages/Login.tsx`, `web/src/pages/Profile.tsx`, `functions/test/google.test.js` |
| T10 | Sin probar en el navegador integrado: abre la ventana del emulador de Auth en la misma pestaña y el popup no puede volver. Se prueba en un navegador común (T32). | — |
| T11 | Steam con token propio: `POST /api/auth/steam/start` guarda el estado en `authStates` (TTL en `firestore.indexes.json`), la vuelta verifica el OpenID y que la respuesta sea para este sitio, crea la cuenta en Auth la primera vez y redirige a `/entrar#token=...`; la web entra con `signInWithCustomToken` y va al perfil. Vincular, "ocupado" y desvincular sobre Firestore. El `GET /api/auth/steam` de entonces lo borró T14. 12 pruebas con Steam simulado; la vuelta probada en el navegador. | `functions/src/routes/auth.js`, `web/src/auth.tsx`, `functions/test/steam.test.js` |
| T09 | La web usa el SDK de Firebase (emuladores en dev, proyecto `demo-aoe3draft`). `api.ts` espera a que Firebase recupere la sesión y manda el token; `auth.tsx` sigue a `onIdTokenChanged` y saca el perfil de `/api/auth/me`. Probado en el navegador: entrar con Firebase, crear un torneo, navegar con la sesión y salir. El login por email de las cuentas de demo pasó a `signInWithEmailAndPassword` en T12. | `web/src/firebase.ts`, `web/src/api.ts`, `web/src/auth.tsx` |
| T12 | El formulario de email y contraseña entra con `signInWithEmailAndPassword` y solo se muestra con `import.meta.env.DEV`. `/api/auth/providers` devuelve `dev_login: true` solo si `FUNCTIONS_EMULATOR === 'true'`. Las cuentas `@demo.aoematch` / `demo1234` las crea el seed (T24): el formulario queda listo, el seed no. | `web/src/pages/Login.tsx`, `web/src/auth.tsx`, `functions/src/routes/auth.js`, `functions/test/auth.test.js` |
| T14 | Steam entra y se vincula con botones que llaman a `POST /api/auth/steam/start` (`{ link: true }` para vincular) y navegan a la `url`. Se borró `GET /api/auth/steam`. El perfil muestra `?google=ok` como `?steam=ok`. En `/entrar#token=...` se ve "Entrando…" en vez del formulario. Falta la prueba en un navegador común. | `web/src/pages/Login.tsx`, `web/src/pages/Profile.tsx`, `functions/src/routes/auth.js`, `functions/test/steam.test.js` |

**Fase 3 · API sobre Firestore**

| ID | Qué quedó | Dónde |
|---|---|---|
| T15 | `availability.js` calcula sobre usuarios ya leídos (`users/{uid}.availability`). Rutas de horarios, excepciones (con id propio) y cruce sobre Firestore. Las rutas que siguen en SQLite usan `usuariosConHorario()` de `db.js`. 9 pruebas. | `functions/src/availability.js`, `functions/src/routes/catalog.js`, `functions/test/horarios.test.js` |
| T16 | Listado, alta (slug como id, con `-2`, `-3` si se repite), detalle, edición, borrado y horarios del torneo sobre Firestore, con la misma forma de JSON que antes. Lo que todavía es de SQLite (inscripciones, equipos, llaves, armador) quedó en `routes/tournaments-sqlite.js`, montado después. 13 pruebas. | `functions/src/routes/tournaments.js`, `functions/test/torneos.test.js` |
| T16 | El id de una inscripción ahora es el uid del inscripto. T07 manda `r.user_id` en el `PATCH` (es el mismo valor). | — |
| T17 | Inscripción, retiro, pagos, alta y edición de equipos y de sus integrantes sobre Firestore, cada una en una transacción que mantiene los contadores del torneo y los lectores de la sala del equipo. Un equipo que queda vacío se borra con su sala. 14 pruebas. | `functions/src/routes/tournaments.js`, `functions/test/inscripciones.test.js` |
| T18 | Llaves sobre Firestore: el cuadro se arma en memoria con los ids generados antes y se escribe por lotes (`escribirEnLotes`). Para 15 formatos y tamaños da los mismos cruces, enlaces, byes y siembras que la versión SQLite. Volver a generar borra partidos, drafts, avisos y salas de partido. La versión vieja quedó como `brackets-sqlite.js` (playoffs, suizo y partidos, hasta T19 y T23). 19 pruebas. | `functions/src/brackets.js`, `functions/test/llaves.test.js` |
| T19 | `cerrarMatch` en una transacción con todos los partidos del torneo; `tablaDesde`, `generarPlayoffs` y `siguienteRondaSuiza` sobre Firestore (los dos últimos en transacción), con sus rutas. Jugados hasta el final, simple, liga, grupos + playoff y suizo dan lo mismo que SQLite. **Cambio a propósito:** la doble eliminación con byes ahora termina (en SQLite quedaba trabada: el lugar que esperaba al perdedor de un partido ganado por bye no se llenaba nunca). 20 pruebas. | `functions/src/brackets.js`, `functions/test/cierre.test.js` |
| T20 | Armador sobre Firestore, mismo algoritmo con azar inyectable; confirmar crea equipos, salas, inscripciones y contador en una transacción. Rutas `autoteams` y `autoteams/confirm`. La sala de equipo se crea con `guardarSalaDeEquipo` de `data/salas.js`. 5 pruebas. | `functions/src/teambuilder.js`, `functions/test/armador.test.js` |
| T21 | Motor de draft partido en `draft-core.js` (reglas, sin base) y `draft.js` (una transacción por operación: crear, listo, acción, timeout). Dos acciones a la vez del mismo paso: entra una sola. El motor SQLite quedó como `draft-sqlite.js` para las rutas de partido hasta T23. 30 pruebas. | `functions/src/draft-core.js`, `functions/src/draft.js`, `functions/test/draft-core.test.js`, `functions/test/draft.test.js` |
| T23 | Rutas de partido sobre Firestore: detalle (sin `chat`; resuelve pasos vencidos antes de responder), draft, resultados (`recalcularSerie` cierra o reabre la serie), resultado forzado, horarios y votos, con avisos en `live` y en el chat. 15 pruebas, con un draft entero jugado por la API. | `functions/src/routes/matches.js`, `functions/test/partidos.test.js` |
| T24 | Demo en `functions/src/demo.js`: 40 cuentas en el emulador de Auth (`<nombre>@demo.aoematch` / `demo1234`), los cuatro torneos, cuartos jugados con drafts reales, semis agendadas (la primera con el draft abierto) y chat. `npm run seed` la siembra si no está; `npm run reset` vacía los emuladores y la vuelve a sembrar. Solo corre contra un proyecto `demo-*` (D2 sigue abierta). Tarda unos 30 s. 7 pruebas. | `functions/src/demo.js`, `functions/scripts/seed.js`, `functions/test/demo.test.js` |
| T22 | Reloj: cuando un paso estrena plazo, `draft.js` encola `{ matchId, step, deadline }` en Cloud Tasks (`relojes.js`); la función `vencerPaso` lo resuelve, o corta con error si llegó antes de tiempo para que la cola reintente. `resolverVencidos()` es el respaldo para las rutas de partido (T23). 7 pruebas; en el emulador el camino completo anda, pero la cola dispara en el acto sin esperar el horario (en producción sí espera). | `functions/src/relojes.js`, `functions/src/draft.js`, `functions/src/index.js`, `functions/test/reloj.test.js` |

**Fase 4 · Tiempo real**

| ID | Qué quedó | Dónde |
|---|---|---|
| T25 | Chat: `chat.js` decide quién lee y quién escribe cada sala, la crea cuando hace falta y publica avisos del sistema; `GET /api/rooms/:room` la abre y `POST /api/rooms/:room/messages` escribe. Se borraron `realtime.js` y la dependencia `ws`. 13 pruebas. | `functions/src/chat.js`, `functions/src/routes/rooms.js`, `functions/test/chat.test.js` |
| T26 | `avisar(matchId, tipo)` suma en `live/{matchId}` (`draft`, `match`, `votes`). `draft.js` avisa después de cada commit: `draft` siempre, `match` si cambió el estado o las partidas. | `functions/src/live.js` |
| T27 | `web/src/live.ts` reemplaza `ws.ts`: `useChat` abre cada sala en la API y escucha sus mensajes en Firestore, `useLive` vuelve a pedir el partido cuando cambia `live/{matchId}`, `useConectado` sale de Realtime Database. Probado en el navegador con la demo: chat del torneo y del partido, mensaje propio, y la página que se actualiza sola cuando el rival marca listo y escribe desde otra sesión. | `web/src/live.ts`, `web/src/pages/MatchRoom.tsx`, `web/src/pages/TournamentPage.tsx` |

**Fase 5 · Publicación y cierre**

| ID | Qué quedó | Dónde |
|---|---|---|
| T29 | `Cache-Control: public, max-age=604800, immutable` para `/assets/**`; `maxInstances: 3` y 512 MiB para `api`; parámetro `PUBLIC_URL` (vacío: se deduce del pedido) y secreto `STEAM_API_KEY`. | `firebase.json`, `functions/src/index.js`, `functions/src/config.js` |
| T29 | Sin verificar en local: el emulador de Hosting no aplica ninguna cabecera configurada. Se mira en el primer deploy (T30). | — |
| T29 | `web/.env.production` no se creó (los permisos de esta PC no dejan escribir archivos `.env`): las variables `VITE_FIREBASE_*` van en el entorno del deploy (T30) o en ese archivo, creado a mano. Sin ellas, la web de producción se corta al cargar con un mensaje claro. | `web/src/firebase.ts` |

**Fase 0 · Base del proyecto** (plan Spark)

| ID | Qué quedó | Dónde |
|---|---|---|
| T01 | Proyecto `aoe-3-draft-2eea7` (número 122691877670) en Spark: Firestore en `southamerica-east1`, Realtime Database en `us-central1`, Auth con Google y app web registrada. Alias `prod` en `.firebaserc`. La config de la app web va fija en `web/src/firebase.ts` (no es secreta; las `VITE_FIREBASE_*` la reemplazan si están), porque esta PC no deja escribir `.env`. | `.firebaserc`, `web/src/firebase.ts` |

**Fase 6 · Sin servidor** (plan Spark)

| ID | Qué quedó | Dónde |
|---|---|---|
| T34 | Lógica pura en `web/src/logica/`: `llaves.js` (cuadros, avance, tabla, y nuevas `cerrarPartido`, `cuadroDePlayoffs` y `rondaSuiza`, que devuelven lo que hay que escribir), `armador.js` (`proponerEquipos(torneo, sueltos)`), `horarios.js`, `catalogo.js` y `orden.js`. El catálogo (`civs.json`, `maps.json`) pasó a `web/src/logica/datos/`; `npm run assets` lo escribe ahí. `functions/src` (`brackets.js`, `teambuilder.js`, `availability.js`, `catalogo.js`) importa de la web, así la API sigue andando hasta T47. `web/tsconfig.json` con `allowJs`. Pruebas con `node:test` (no Vitest: sin dependencias nuevas) en `web/test/`: `npm --prefix web test`; `npm test` las corre después de las de `functions/`. | `web/src/logica/`, `web/test/` |
| T35 | `firestore.rules` con escrituras del cliente para `users` (dueño, campos de perfil, `steam_url` validado, sin `is_admin`; `rating_1v1` y `rating_team` los edita el dueño, como hoy `PATCH /me`), `users/{uid}/privado`, `tournaments` (crea quien queda de organizador; los admins no tocan `admin_ids` ni `organizer_id`), `stages` (staff), `registrations` (alta, retiro, vuelta y cambio de equipo del dueño; pago y estado del staff; el capitán suma y saca de su equipo) y `teams` (equipo propio de uno, sumarse con lugar, irse, capitán, staff). Leer: todo eso, cualquiera. Los contadores `inscriptos`, `pagos` y `equipos` ya no los puede mantener nadie desde el cliente: T37 los saca. 29 pruebas en `functions/test/reglas-torneos.test.js`. | `firestore.rules`, `functions/test/reglas-torneos.test.js` |

**Fase 7 · Draft nuevo**

| ID | Qué quedó | Dónde |
|---|---|---|
| T42 | `web/src/logica/draft.js`: `planDeDraft(torneo, partido, equipos, gameNo)` arma el documento del draft (`state` `mapa`/`bans`/`picks`/`listo`, `map_chooser_team_id`, `map_pool`, `map_id`, `civ_pool`, `ban_order`, `banned_civ_ids`, `player_ids`, `team_of`, `civs_usadas`, `revealed`); `elegirMapa`, `banear`, `turnoDeBan`, `civsPermitidas`, `validarPick`, `eligieronTodos` y `revelar` (que devuelve las civs para `games[].civs`). Mapa de la primera: `first_map_id` o uno del pool por hash del id del partido. Bans: en la primera arranca el equipo A. Juegan los primeros `team_size` de cada equipo, capitán primero. 13 pruebas en `web/test/draft.test.js`. | `web/src/logica/draft.js` |

**Lógica que se reutiliza**

| Área | Se reutiliza sin cambios de lógica | Dónde |
|---|---|---|
| Draft | Plan de pasos, patrón serpiente, reglas de civs, elección automática, validaciones | `functions/src/draft-core.js` |
| Llaves | Siembra 1-8 / 4-5 / 2-7 / 3-6, nombres de ronda, avance de ganador y perdedor | `functions/src/brackets.js` |
| Armador | Serpiente por rating + 4000 intercambios por nivel y horario | `functions/src/teambuilder.js` |
| Horarios | Máscaras de 30 min, ventanas, próxima fecha real | `functions/src/availability.js` |
| Steam | Verificación OpenID 2.0 y perfil por API | `functions/src/routes/auth.js` |
| Web | Todas las pantallas; cambian `api.ts`, `auth.tsx`, `ws.ts`, `types.ts`, `Login.tsx`, `Profile.tsx`, `MatchRoom.tsx`, `TournamentPage.tsx` | `web/src/` |

## Tareas

Dificultad 1 (trivial) a 5 (arquitectura / riesgo alto). Rol: **J** = junior con revisión de
senior; **S** = senior. Tiempo: horas efectivas del rol asignado, con prueba y revisión incluidas
(1 d = 6 h).

| ID | Tarea | Dif. | Rol | Tiempo | Depende de | Ola |
|---|---|---|---|---|---|---|
| **Fase 4 · Tiempo real** |||||||
| T28 | Presencia con Realtime Database | 3 | J | 2 h | — | 0 |
| **Fase 6 · Sin servidor** |||||||
| T36 | `firestore.rules` de partidos, draft con pick ciego y chat | 5 | S | 1 d | — | 0 |
| T37 | `web/src/datos/`: lecturas y escrituras con el SDK de cliente; reemplaza `api.ts` | 3 | S | 1 d | — | 0 |
| T38 | Ingreso solo con Google; link de Steam sin verificar en el perfil | 2 | J | 2 h | T37 | 1 |
| T39 | Panel del creador: llaves, playoffs, suizo y armador corriendo en su navegador | 4 | S | 1 d | T37 | 1 |
| T40 | Resultados por el creador: ganador por partida, cerrar serie y avanzar la llave | 4 | S | 1 d | T39 | 2 |
| T41 | Links de las partidas por partido y por fase (`vod_links`) | 2 | J | 4 h | T37 | 1 |
| **Fase 7 · Draft nuevo** |||||||
| T43 | Draft sobre Firestore: crear, elegir mapa, banear, pick ciego y revelar | 4 | S | 1 d | T36 | 1 |
| T44 | `DraftBoard.tsx` y `MatchRoom.tsx` para el draft nuevo | 2 | J | 1 d | T43 | 2 |
| T45 | `TournamentForm.tsx`: quitar modos viejos, sumar bans de civ y primer mapa fijo o al azar | 2 | J | 2 h | — | 0 |
| T46 | Tiempo real sin API: escuchas del partido y del draft; chat escrito desde el cliente | 3 | J | 4 h | T36 | 1 |
| T47 | Borrar la función `api`, Cloud Tasks y `live`; demo y `npm test` sobre el modelo nuevo | 3 | S | 4 h | T38, T40, T44, T46 | 3 |
| **Fase 5 · Publicación y cierre** |||||||
| T30 | Deploy automático de Hosting y reglas con GitHub Actions | 3 | S | 4 h | T47 | 3 |
| T31 | Dominio propio | 1 | J | 1 h | T30, decisión D3 | 4 |
| T32 | Prueba completa en emuladores y en producción | 2 | J | 4 h | T28, T30, T41, T45 | 4 |
| T33 | Borrar Render, SQLite, `functions/` y lo que quedó viejo; actualizar README | 1 | J | 2 h | T32, decisión D5 | 5 |

Las dependencias con tareas hechas ya están cumplidas y no figuran en la tabla. T29 quedó hecha y su
número no se reusa.

## Olas de ejecución

```
Ola 0  ─ T36 ∥ T37 ∥ T28 ∥ T45              · 1 d    (T36 y T37 seniors; T28 y T45 junior)
Ola 1  ─ T43 ∥ T39 ∥ T38 ∥ T41 ∥ T46        · 1 d    (T43 y T39 seniors; el resto junior)
Ola 2  ─ T44 ∥ T40                          · 1 d
Ola 3  ─ T47 → T30                          · 1 d
Ola 4  ─ T32 ∥ T31                          · 4 h
Ola 5  ─ T33                                · 2 h
```

- **Camino crítico:** T36 → T43 → T44 → T47 → T30 → T32 → T33 = 32 h (unos 5 días).
- **Equipo mínimo:** 2 seniors y 1 junior. En las olas 0 y 1 hay dos tareas senior de un día en
  paralelo; un tercer senior no acelera porque T47 espera a las dos ramas.
- **Una sola persona:** seguir las olas en orden.
- **Duración total:** 32 h con el equipo mínimo (suma de las olas); 65 h con una sola persona.

## Detalle de cada tarea

### Fase 0 · Base del proyecto

### Fase 4 · Tiempo real

### T28 · Presencia — dif. 3 · junior · 2 h

- [ ] `web/src/presence.ts`: al entrar a una sala, escribir `presence/{room}/{uid}` con
      `display_name` y `avatar_url` y registrar `onDisconnect().remove()`; al salir, borrarlo.
- [ ] Hook `usePresencia(room)` que escucha `presence/{room}`; reemplaza a `useConectado` de
      `web/src/live.ts`, que hoy devuelve una lista vacía.
- [ ] Los anónimos no escriben presencia.
- [ ] `database.rules.json`: leer `presence/{room}` cualquiera; escribir `presence/{room}/{uid}` solo
      `auth.uid == $uid`, con solo esos dos campos de texto.

### Fase 6 · Sin servidor

### T36 · Reglas de partidos, draft y chat — dif. 5 · senior · 1 d

- [ ] `matches/{matchId}`: leer cualquiera; escribir resultados, `games`, estado, horario fijado y
      `vod_links` solo el staff del torneo (`get` del torneo por `tournament_id`). Votos de horario:
      cada jugador de los dos equipos, solo su propia entrada de `schedule_votes`.
- [ ] `matches/{matchId}/drafts/{gameNo}`: lo crea un jugador del partido o el staff, solo si la
      partida anterior tiene ganador; campos de `planDeDraft` (`web/src/logica/draft.js`, T42). Mapa: un miembro del equipo de `map_chooser_team_id`, con un
      `map_id` del pool. Bans: el equipo de `ban_order[banned_civ_ids.size()]` (miembro según `team_of`), con una civ
      de `civ_pool`.
- [ ] Pick ciego en `drafts/{gameNo}/picks/{uid}`: crear o cambiar solo el dueño, si está en
      `player_ids`, la civ está en `civ_pool`, no en `banned_civ_ids` ni en `civs_usadas[uid]`, y el draft no está revelado. Leer: el
      dueño siempre; los demás solo con `revealed == true`.
- [ ] `revealed: true` lo pone cualquiera de `player_ids`, solo si existen los picks de todos. Las
      reglas no tienen bucles: `(n < 1 || exists(pick0)) && … && (n < 8 || exists(pick7))`. Son hasta
      8 `exists` más el `get` del draft, justo bajo el límite de 10 accesos por pedido. Máximo 4
      jugadores por equipo.
- [ ] Chat `rooms/{roomId}/messages`: escribir con sesión según `puedeEscribir` (hoy en
      `functions/src/chat.js`): sala del torneo, inscriptos y staff; de partido, jugadores y staff;
      de equipo, `readers`. `user` del mensaje igual al autor; `system` siempre falso desde el
      cliente.
- [ ] Pruebas en un archivo junto a `functions/test/reglas-torneos.test.js` (T35), con un draft 2v2
      entero: nadie lee el pick ajeno antes de
      revelar, revelar con un pick faltante falla, y después todos los leen.

### T37 · Capa de datos en la web — dif. 3 · senior · 1 d

- [ ] `web/src/datos/` con un módulo por entidad (`usuarios.ts`, `torneos.ts`, `inscripciones.ts`,
      `equipos.ts`, `partidos.ts`, `salas.ts`) sobre el SDK de cliente; copiar nombres y formas de
      `functions/src/data/*.js` para que las pantallas reciban los mismos objetos que hoy da la API.
- [ ] Reemplazar las llamadas de `web/src/api.ts` en `Home.tsx`, `CreateTournament.tsx`,
      `TournamentPage.tsx`, `Profile.tsx` y `MatchRoom.tsx`. Llaves, armador y resultados quedan para
      T39 y T40; el draft, para T43.
- [ ] Lo que la API completaba al leer: nombres y avatares de miembros (`where(documentId(), 'in',
      ...)` de a 30) y excepciones de horario vencidas (filtrar al leer).
- [ ] Escrituras de varios documentos en `writeBatch` o `runTransaction`, igual que hoy en la API
      (inscribirse con equipo, sumar miembro).
- [ ] Un `permission-denied` se muestra en la pantalla con mensaje en castellano.

### T38 · Ingreso y Steam sin verificar — dif. 2 · junior · 2 h

- [ ] `Login.tsx` y `web/src/auth.tsx`: solo el botón de Google. Sacar Steam y las llamadas a
      `/api/auth/*`; el perfil `users/{uid}` lo crea el cliente la primera vez que entra.
- [ ] `Profile.tsx`: campo `steam_url` para pegar el perfil de Steam. Aceptar solo
      `https://steamcommunity.com/id/...` o `/profiles/...`; mostrarlo como link en el perfil y en
      los equipos, con el aviso "no verificado".
- [ ] Sacar de `Profile.tsx` vincular y desvincular Steam y Google.

### T39 · Panel del creador — dif. 4 · senior · 1 d

- [ ] En `TournamentPage.tsx`, solo para el organizador y `admin_ids`: generar llaves, playoffs desde
      grupos, siguiente ronda suiza y armador, con `generarCuadro`, `cuadroDePlayoffs` y `rondaSuiza` (`web/src/logica/llaves.js`) y
      `proponerEquipos` (`web/src/logica/armador.js`) corriendo en su navegador.
- [ ] Cada generación se escribe en un `writeBatch` (hasta 500 escrituras; una doble eliminación de
      64 equipos son unas 127). Si ya hay partidos, pedir confirmación y borrarlos antes.
- [ ] Armador: proponer, mostrar y, al confirmar, crear equipos, inscripciones y salas de equipo en
      una transacción, como hoy `teambuilder.js`.
- [ ] Quien no es staff no ve los botones; si fuerza la escritura, la niegan las reglas de T35.

### T40 · Resultados por el creador — dif. 4 · senior · 1 d

- [ ] En la llave y en `MatchRoom.tsx`, solo para el staff: cargar el ganador de cada partida de la
      serie y copiar las civs reveladas del draft a `games[].civs`.
- [ ] Al llegar al mejor de N, cerrar la serie y avanzar ganador y perdedor (`next_match_id`,
      `loser_match_id`) en una `runTransaction` con `cerrarPartido` de `web/src/logica/llaves.js`, que devuelve los
      cambios de cada partido y si el torneo terminó. Cambiar un resultado
      cerrado reabre la serie y saca al equipo del partido siguiente si no empezó (como
      `recalcularSerie` en `functions/src/routes/matches.js`).
- [ ] Byes: el avance del partido con bye va en la misma transacción.
- [ ] Sacar el reporte de los capitanes y el "resultado forzado": todo resultado lo carga el staff.

### T41 · Links de las partidas — dif. 2 · junior · 4 h

- [ ] Campo `vod_links: [{ label, url }]` en `matches/{matchId}` (por llave) y en
      `tournaments/{slug}/stages/{stageId}` (por fase). Máximo 20 por documento.
- [ ] Editor para el staff: agregar, cambiar y borrar; aceptar solo `http://` y `https://`.
- [ ] Mostrarlos en `Bracket.tsx` (ícono en cada partido con links), en `MatchRoom.tsx` y en la
      cabecera de cada fase en `TournamentPage.tsx`. Abren en otra pestaña con
      `rel="noopener noreferrer"`.
- [ ] `games[].replay_url` ya existe por partida: mostrarlo junto a estos links, no duplicarlo.

### Fase 7 · Draft nuevo

### T43 · Draft sobre Firestore — dif. 4 · senior · 1 d

- [ ] `web/src/datos/drafts.ts`: crear `drafts/{gameNo}` con `planDeDraft` de T42 (`state: 'mapa' |
      'bans' | 'picks' | 'listo'`), elegir mapa, banear (transacción que verifica el turno) y guardar
      el pick propio en `picks/{uid}`.
- [ ] Al guardar un pick, el cliente intenta poner `revealed: true` y `state: 'listo'`; si las reglas
      lo niegan porque falta alguien, no pasa nada. Cada cliente que escucha el draft reintenta
      cuando llega un pick nuevo.
- [ ] Copiar los picks a `games[].civs` lo hace el staff al cargar el resultado (T40) con lo que
      devuelve `revelar`, no el jugador.
- [ ] Sin reloj: el staff puede borrar el draft y reiniciarlo, o cargar el resultado sin draft.

### T44 · Pantalla del draft — dif. 2 · junior · 1 d

- [ ] `DraftBoard.tsx` en tres etapas. Mapa: el equipo que elige ve la grilla, el otro ve
      "eligiendo". Bans: turno visible para los dos. Picks: cada jugador ve las civs y su elección; de
      los demás, solo "eligió" o "falta".
- [ ] Cuando `revealed` pasa a verdadero, mostrar todas las civs juntas.
- [ ] Sacar de `MatchRoom.tsx` el reloj, "listo" y los modos viejos.
- [ ] Espectadores (sin sesión o de otro partido) ven el tablero sin botones.

### T45 · Formulario del torneo — dif. 2 · junior · 2 h

- [ ] `TournamentForm.tsx`: sacar `map_mode`, `map_bans`, `civ_pattern`, el reloj por paso y la opción
      de pick ciego (ahora siempre es ciego).
- [ ] Sacar `civ_mirror` y `civ_repeat_team` (D6); `civ_repeat_series` queda.
- [ ] Sumar `civ_bans` (0 a 3 por equipo) y "primer mapa": fijo (`first_map_id`) o al azar.
- [ ] Mantener `map_repeat` y el pool de mapas y civs (`PoolPicker.tsx`).

### T46 · Tiempo real sin API — dif. 3 · junior · 4 h

- [ ] `web/src/live.ts`: `useLive` deja de escuchar `live/{matchId}` y escucha directo
      `matches/{matchId}` y el draft abierto con `onSnapshot`.
- [ ] `useChat`: escribir con `addDoc` en `rooms/{roomId}/messages`, copiando nombre y avatar del
      autor; crear la sala con `setDoc` si no existe (deciden las reglas de T36).
- [ ] Los avisos del sistema que hoy publica la API ("cargó el resultado", "empezó el draft") se
      sacan: el cliente no puede escribir `system: true`.
- [ ] Cortar las escuchas al salir de la pantalla.

### T47 · Sacar el servidor — dif. 3 · senior · 4 h

- [ ] Borrar `functions/src/app.js`, `index.js`, `routes/`, `relojes.js`, `live.js`, `config.js`,
      `auth.js`, `draft.js`, `draft-core.js` y lo que quede sin uso; en `firebase.json`, la sección
      `functions`, el rewrite `/api/**` y los emuladores `functions` y `tasks`.
- [ ] Borrar `web/src/api.ts` y el proxy de `/api` de Vite.
- [ ] Demo: rehacer `functions/src/demo.js` y `functions/scripts/seed.js` sobre el modelo nuevo
      (draft con picks, `vod_links`, sin `live`). El seed sigue con el Admin SDK contra el emulador;
      puede pasar a `tools/`.
- [ ] `npm test` corre las pruebas de lógica (`web/test/`) y de reglas (T35, T36); borrar las que
      probaban rutas y los reexports de `functions/src` hacia `web/src/logica/`.

### Fase 5 · Publicación y cierre

### T30 · Deploy automático — dif. 3 · senior · 4 h

- [ ] `.github/workflows/deploy.yml`: en cada push a `master`, Node 22, `npm ci`, `npm run assets`,
      `npm run build` y `firebase deploy --only hosting,firestore,database --project prod`. Sin
      `functions`: Spark no las deja publicar.
- [ ] La config de la app web ya está en `web/src/firebase.ts` (T01): el build no necesita
      variables.
- [ ] Autenticación con una cuenta de servicio en el secreto `FIREBASE_SERVICE_ACCOUNT`, con los
      roles de Hosting y reglas.
- [ ] Si falla la descarga de `npm run assets`, el deploy sigue.
- [ ] Primer deploy a mano desde la PC. Verificar con
      `curl -I https://PROYECTO.web.app/assets/flags/Flag_German.png` que llegue el `Cache-Control`
      de T29.

### T31 · Dominio propio — dif. 1 · junior · 1 h

- [ ] Antes hay que cerrar la decisión D3.
- [ ] Hosting → Agregar dominio personalizado; cargar los registros TXT y A en el proveedor. El
      certificado lo emite Firebase.
- [ ] Authentication → Configuración → Dominios autorizados: agregar el dominio.

### T32 · Prueba completa — dif. 2 · junior · 4 h

- [ ] En los emuladores con la demo y después en producción: entrar con Google y cargar el link de
      Steam.
- [ ] Crear un torneo 2v2, inscribirse solo y con equipo, correr el armador y generar las llaves.
- [ ] Draft con cuatro navegadores: mapa por el perdedor, bans, picks ciegos; desde la consola del
      navegador, leer el pick ajeno antes de revelar debe dar `permission-denied`.
- [ ] Como jugador común, escribir un resultado desde la consola del navegador debe fallar.
- [ ] Como creador, cargar resultados hasta cerrar la serie, ver que el ganador avanza y dejar links
      en un partido y en una fase.
- [ ] Chat de equipo: una cuenta del equipo rival no lo ve. Chat y presencia en vivo.

### T33 · Limpieza y README — dif. 1 · junior · 2 h

- [ ] Antes hay que cerrar la decisión D5.
- [ ] Borrar `render.yaml`, `Dockerfile`, `schema.sql`, `db.js`, `brackets-sqlite.js` (y sus
      comparaciones en las pruebas), la carpeta `server/` y lo que quede de `functions/` que no sea
      catálogo, demo o pruebas.
- [ ] Sacar dependencias sin uso: `express`, `cookie-parser`, `bcryptjs`, `firebase-functions`, `ws`.
- [ ] Revisar el `engines` de la raíz (`>=23.4.0` era por `node:sqlite`).
- [ ] `README.md`: arrancar (emuladores, Java, `npm test`), variables, ingreso con Google, publicar y
      cómo está armado (sin servidor, reglas como seguridad).
- [ ] Dar de baja Render si D5 lo indica.

## Decisiones abiertas

| ID | Decisión | Opciones | Bloquea |
|---|---|---|---|
| D1 | Región | **Cerrada: Firestore en `southamerica-east1`, Realtime Database en `us-central1`.** | — |
| D2 | ¿Demo en producción? | Sembrarla para mostrar la página, o arrancar vacío. | T47 (parte de producción) |
| D3 | Dominio | Cuál comprar y en qué registrador. | T31 |
| D4 | Buscador de usuarios | **Cerrada: empieza con** (prefijo sobre `display_name_lower`). | — |
| D5 | Render al terminar | Darlo de baja, o dejarlo un tiempo como respaldo. | T33 |
| D6 | Civ repetida en el pick ciego | **Cerrada (2026-10-26): se permite.** Espejo y civ repetida en el mismo equipo valen. | — |
| D7 | Plan de Firebase | **Cerrada (2026-10-26): Spark.** Blaze no se pudo pagar con la tarjeta en dólares de Brubank. | — |
| D8 | Steam | **Cerrada: link pegado a mano, sin verificar.** | — |
| D9 | Quién elige mapa | **Cerrada: el que perdió la partida anterior; la primera, fija del creador o al azar.** | — |
| D10 | Bans de civ | **Cerrada: los configura el creador (0 a 3 por equipo).** | — |
| D11 | Reloj del draft | **Cerrada: sin reloj.** El staff reinicia el draft o carga el resultado. | — |
