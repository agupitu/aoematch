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

**Estado.** 19 tareas pendientes, 101 h en total: 4 de cierre (T30–T33, 11 h; unos 2 días de 6 h
para una persona sola, el senior entra en T30) y 15 del draft suelto (Fase 8, T48–T62, 90 h). Hechas en la rama `feat/firebase`: T02 a T27 sobre el plan Blaze
anterior, y T01, T28, T34–T47 del plan Spark (falta cerrar T30, y T31–T33). No hay datos para migrar.

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

**Pedido del 2026-10-27 (Fase 8 · Draft suelto).** Pestaña **Draft** en el header para armar un
draft sin torneo: el creador fija jugadores por equipo, quién elige el mapa, bans de mapa y de civ,
modo de pick de civ (ciego o serpiente, sin tiempo) y si se puede repetir civ entre equipos y dentro
del equipo; comparte un link, la gente se reparte en dos equipos y hay chat de todos y de cada
equipo, que se borra al cerrar la sala. Las opciones de civ y el botón "Confirmar pick" del ciego
valen también para el draft de torneo. Diseño aprobado y maqueta en
`docs/superpowers/specs/2026-10-27-draft-suelto-design.md` y `...-mockup.html`.

**Antes de empezar la Fase 8.** La rama tiene cambios sin commitear de otra sesión (rondas y horarios
por etapa) en `firestore.rules`, `web/src/types.ts`, `web/src/pages/MatchRoom.tsx` y
`docs/firestore-modelo.md`. T50, T51, T52 y T61 tocan esos mismos archivos: esos cambios se commitean
antes de arrancar T50, o el merge se coordina a mano.

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
| T36 | `firestore.rules` de `matches` (leer todos; escribir el staff; los capitanes solo agendan), `matches/{id}/votos/{uid}` (cada jugador del partido, solo lo suyo: reemplaza a `schedule_votes`, que las reglas no pueden proteger por entrada), `drafts/{gameNo}` (lo crea un jugador o el staff con la partida anterior cerrada; después solo se puede elegir mapa, banear, anotarse en `picked` y revelar, cada uno en su turno), `drafts/{gameNo}/picks/{uid}` (el ajeno no se lee hasta `revealed`) y el chat (`rooms` y `messages`). **Cambios contra el plan:** revelar exige que `picked` tenga a todos los de `player_ids`, y anotarse exige que exista el pick propio (`existsAfter`), en vez de 8 `exists`; la sala de equipo no usa `readers`: quién lee sale del equipo y del staff; un mensaje lleva `created_at == request.time` y el `user` igual al perfil del autor; desde el cliente no hay mensajes del sistema. 21 pruebas en `functions/test/reglas-partidos.test.js`, con drafts armados por `planDeDraft`. | `firestore.rules`, `functions/test/reglas-partidos.test.js` |
| T37 | `web/src/datos/`: `base.ts` (leer, consultar, `leerPorIds` de a 30, `Rechazo`, `mensajeDeError`, `conMensaje`), `usuarios.ts` (`asegurarPerfil` crea el perfil la primera vez en una transacción, `actualizarPerfil`, horario), `torneos.ts` (`listarTorneos` con `getCountFromServer`, `crearTorneo` con slug libre en transacción, `detalleTorneo` con la forma de la API, `actualizarTorneo`, `horariosDelTorneo`), `inscripciones.ts` (`inscribirse`, `retirarse`, `sacarMiembro`, `marcarInscripcion`; si se va el capitán, el primero que queda pasa a serlo) y `partidos.ts` (`detallePartido`, `horariosDelPartido`, `agendar`). Ya no usan la API: `auth.tsx` (perfil), `Home`, `CreateTournament`, `TournamentPage` (detalle, inscripción, retiro, pagos, sacar miembro, horarios, configuración), `Profile` (horario) y `MatchRoom` (detalle y agenda). Probado en el navegador con la demo: listado, detalle, alta de perfil, inscripción con equipo nuevo, retiro, volver suelto, perfil, configuración y alta de torneo como Kaiser. Quedan en la API, para sus tareas: llaves y armador (T39), resultados (T40), draft (T43: el detalle del partido devuelve `draft: null` hasta entonces), chat (T46) y Steam (T38). | `web/src/datos/`, `web/src/pages/` |
| T39 | `web/src/datos/llaves.ts`: `generarLlaves` (borra partidos con sus drafts, picks y votos, salas de partido con sus mensajes y etapas; escribe el cuadro, las siembras y pasa el torneo a `en_curso`, en tandas de 450), `generarPlayoffs`, `siguienteRondaSuiza`, `proponerEquiposDelTorneo` y `confirmarEquipos` (en una transacción; ahora deja la inscripción con `kind: 'equipo'`). `TournamentPage.tsx` los usa en Llaves y Equipos; regenerar pide confirmación. Las reglas suman que el staff borre votos ajenos (al regenerar). Probado en el navegador como Kaiser: grupos de Clan Wars, regenerar el Ladder 1v1 (borró partido, draft y picks viejos, creó 7 partidos) y armador de la Copa Sudamericana (5 equipos). | `web/src/datos/llaves.ts`, `web/src/pages/TournamentPage.tsx` |
| T40 | Resultados solo del staff. Lógica pura en `web/src/logica/llaves.js`: `cargarPartidas` (guarda las partidas de la serie; con la serie definida la cierra y pasa ganador y perdedor; si una corrección cambia o borra el ganador, la reabre y saca al equipo de los partidos siguientes que no se jugaron, y si ya se jugaron avisa), `darWalkover` y `paraGanar`; 7 pruebas en `web/test/llaves.test.js`. `web/src/datos/resultados.ts`: `cargarPartida` y `walkover` en una transacción que relee todos los partidos del torneo; el torneo pasa a `finalizado` o vuelve a `en_curso`. En `MatchRoom.tsx`, "Cargar resultado" solo para el staff (partida, ganador o "sin ganador" para borrar, replay, walkover); si el draft de esa partida está revelado, guarda su mapa y sus civs. Los capitanes siguen pudiendo agendar. Probado en el navegador como Kaiser: dos partidas cierran la serie y el ganador pasa a la semi; corregir una la reabre y lo saca de la semi; walkover. Sin probar en el navegador: la copia de mapa y civs desde un draft revelado (lo cubre la lógica de T42). | `web/src/logica/llaves.js`, `web/src/datos/resultados.ts`, `web/src/pages/MatchRoom.tsx` |

**Fase 7 · Draft nuevo**

| ID | Qué quedó | Dónde |
|---|---|---|
| T42 | `web/src/logica/draft.js`: `planDeDraft(torneo, partido, equipos, gameNo)` arma el documento del draft (`state` `mapa`/`bans`/`picks`/`listo`, `map_chooser_team_id`, `map_pool`, `map_id`, `civ_pool`, `ban_order`, `banned_civ_ids`, `player_ids`, `team_of`, `civs_usadas`, `revealed`); `elegirMapa`, `banear`, `turnoDeBan`, `civsPermitidas`, `validarPick`, `eligieronTodos` y `revelar` (que devuelve las civs para `games[].civs`). Mapa de la primera: `first_map_id` o uno del pool por hash del id del partido. Bans: en la primera arranca el equipo A. Juegan los primeros `team_size` de cada equipo, capitán primero. 13 pruebas en `web/test/draft.test.js`. | `web/src/logica/draft.js` |
| T43 | `web/src/datos/drafts.ts`: `partidaActual`, `abrirDraft` (transacción que lee torneo, partido y equipos y guarda `planDeDraft` con `picked: []`), `elegirMapaDelDraft` y `banearCiv` (transacciones), `elegirCiv` (batch del pick con `picked: arrayUnion`), `revelarSiEstanTodos`, `reiniciarDraft` (staff) y `civsDeLaPartida` (para T40); `useDraft(matchId, gameNo, uid)` escucha el draft, el pick propio y, con el revelado ya confirmado en el servidor, todos los picks, y revela cuando están todos. `DraftBoard.tsx` reescrito para el modelo nuevo (funcional: mapa, bans, picks con "eligió"/"falta", revelado, reiniciar) y `MatchRoom.tsx` sin la API de draft. Un draft del modelo viejo muestra "reiniciar". Probado en el navegador con Mitoe y Fifty: mapa al azar, un ban por equipo, pick ciego (el rival ve "eligió"), espejo permitido y revelado en vivo en la pestaña que revela. | `web/src/datos/drafts.ts`, `web/src/components/DraftBoard.tsx`, `web/src/pages/MatchRoom.tsx` |

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
| T38 | Ingreso solo con Google; link de Steam sin verificar en el perfil | 2 | J | 2 h | — | 0 |
| T41 | Links de las partidas por partido y por fase (`vod_links`) | 2 | J | 4 h | — | 0 |
| **Fase 7 · Draft nuevo** |||||||
| T44 | Pulir `DraftBoard.tsx` y sacar el draft viejo de `types.ts` y `lib.ts` | 2 | J | 4 h | — | 0 |
| T45 | `TournamentForm.tsx`: quitar modos viejos, sumar bans de civ y primer mapa fijo o al azar | 2 | J | 2 h | — | 0 |
| T46 | Tiempo real sin API: escuchas del partido y del draft; chat escrito desde el cliente | 3 | J | 4 h | — | 0 |
| T47 | Borrar la función `api`, Cloud Tasks y `live`; demo y `npm test` sobre el modelo nuevo | 3 | S | 4 h | T38, T44, T46 | 1 |
| **Fase 5 · Publicación y cierre** |||||||
| T30 | Deploy automático de Hosting y reglas con GitHub Actions | 3 | S | 4 h | T47 | 1 |
| T31 | Dominio propio | 1 | J | 1 h | T30, decisión D3 | 2 |
| T32 | Prueba completa en emuladores y en producción | 2 | J | 4 h | T28, T30, T41, T45 | 2 |
| T33 | Borrar Render, SQLite, `functions/` y lo que quedó viejo; actualizar README | 1 | J | 2 h | T32, decisión D5 | 3 |
| **Fase 8 · Draft suelto** |||||||
| T48 | `web/src/logica/draft.js`: modos ciego y serpiente, repetir entre equipos y dentro del equipo, confirmar pick | 4 | S | 1 d | — | 8.0 |
| T56 | `web/src/components/draft/`: mapa 1:1, grilla de civs con bandera, equipos con tilde, orden de serpiente, barra de confirmar | 3 | J | 1 d | — | 8.0 |
| T49 | `web/src/logica/draftSuelto.js`: configuración, lobby, fases y reinicio del draft suelto | 4 | S | 1 d | T48 | 8.1 |
| T50 | `firestore.rules`: opciones de civ del torneo, ciego con confirmar y compañeros, serpiente | 5 | S | 2 d? | T48 | 8.1 |
| T51 | `firestore.rules`: `quick_drafts`, sus picks y el chat del draft con borrado al cerrar | 5 | S | 2 d? | T49, T50 | 8.2 |
| T52 | `web/src/datos/drafts.ts`: confirmar pick, serpiente y picks de compañeros en el draft de torneo | 3 | S | 4 h | T48, T50 | 8.2 |
| T55 | Opciones de civ en `TournamentForm.tsx`, `CreateTournament.tsx`, `TournamentPage.tsx` y `datos/torneos.ts` | 2 | J | 4 h | T50 | 8.2 |
| T53 | `web/src/datos/draftsSueltos.ts`: crear, lobby, fases, picks, cerrar y `useDraftSuelto` | 4 | S | 1 d | T49, T51 | 8.3 |
| T54 | `web/src/live.ts`: salas `draft` y `draftteam`; borrar el chat al cerrar | 4 | S | 4 h | T51 | 8.3 |
| T57 | `DraftBoard.tsx` del torneo con los componentes nuevos, confirmar y serpiente | 3 | J | 1 d | T52, T56 | 8.3 |
| T58 | Pestaña "Draft" en `App.tsx` y pantalla de crear (`DraftNuevo.tsx`) | 2 | J | 1 d | T53 | 8.4 |
| T59 | `DraftSala.tsx`: lobby, link, lugares y espectadores | 3 | J | 1 d | T53, T56 | 8.4 |
| T61 | Documentar en `docs/firestore-modelo.md`, `PLAN.md` y `README.md` | 1 | J | 2 h | T53, T54 | 8.4 |
| T60 | `DraftSala.tsx`: fases en curso, chat con pestañas y cerrar sala | 3 | J | 1 d | T54, T59 | 8.5 |
| T62 | Prueba completa del draft con cuatro navegadores y en celular | 2 | J | 4 h | T55, T57, T60 | 8.6 |

Las dependencias con tareas hechas ya están cumplidas y no figuran en la tabla. T29 quedó hecha y su
número no se reusa. Las olas de la Fase 8 se cuentan aparte (`8.n`).

## Olas de ejecución

```
Ola 0  ─ T28 ∥ T38 ∥ T41 ∥ T44 ∥ T45 ∥ T46        · 4 h    (todas junior, 18 h en total)
Ola 1  ─ T47 → T30                                · 1 d
Ola 2  ─ T32 ∥ T31                                · 4 h
Ola 3  ─ T33                                      · 2 h
```

- **Camino crítico:** T46 → T47 → T30 → T32 → T33 = 18 h (unos 3 días).
- **Equipo mínimo:** 1 senior y 2 juniors. La ola 0 es toda junior (18 h): con dos juniors son
  9 h cada uno; el senior entra en la ola 1 (T47 y T30 van en fila).
- **Una sola persona:** seguir las olas en orden.
- **Duración total:** unos 3 días con el equipo mínimo; 33 h con una sola persona.

### Olas de la Fase 8

```
Ola 8.0 ─ T48 ∥ T56                  · 1 d    (T48 senior, T56 junior)
Ola 8.1 ─ T49 ∥ T50                  · 2 d    (los dos seniors; T50 es la más larga)
Ola 8.2 ─ T51 ∥ T52 ∥ T55            · 2 d    (T51 y T52 seniors, T55 junior)
Ola 8.3 ─ T53 ∥ T54 ∥ T57            · 1 d    (T53 y T54 seniors, T57 junior)
Ola 8.4 ─ T58 ∥ T59 ∥ T61            · 1 d    (todas junior)
Ola 8.5 ─ T60                        · 1 d
Ola 8.6 ─ T62                        · 4 h
```

- **Camino crítico:** T48 → T50 → T51 → T53 → T59 → T60 → T62 = 52 h (unos 9 días de 6 h).
- **Equipo mínimo:** 2 seniors y 2 juniors. Las olas 8.1 a 8.3 piden dos seniors a la vez; la 8.4
  pide dos juniors (T61 es de 2 h y la toma quien termine primero). Más gente no acorta: T50 → T51
  edita `firestore.rules` en fila y todo el resto cuelga de ahí. Una sola persona: seguir el orden de
  la tabla (T48, T49, T50, T51, T52, T53, T54, T56, T55, T57, T58, T59, T60, T61, T62).
- **Duración total de la Fase 8:** unos 9 días con el equipo mínimo; 90 h (15 días de 6 h) con una
  sola persona.

## Detalle de cada tarea

### Fase 0 · Base del proyecto

### Fase 4 · Tiempo real

### T28 · Presencia — dif. 3 · junior · 2 h

- [x] `web/src/presence.ts`: al entrar a una sala, escribir `presence/{room}/{uid}` con
      `display_name` y `avatar_url` y registrar `onDisconnect().remove()`; al salir, borrarlo.
- [x] Hook `usePresencia(room)` que escucha `presence/{room}`; reemplaza a `useConectado` de
      `web/src/live.ts`, que hoy devuelve una lista vacía.
- [x] Los anónimos no escriben presencia.
- [x] `database.rules.json`: leer `presence/{room}` cualquiera; escribir `presence/{room}/{uid}` solo
      `auth.uid == $uid`, con solo esos dos campos de texto.

### Fase 6 · Sin servidor

### T38 · Ingreso y Steam sin verificar — dif. 2 · junior · 2 h

- [x] `Login.tsx` y `web/src/auth.tsx`: solo el botón de Google. Sacar Steam (el canje del token
      de Steam en `auth.tsx` y `/api/auth/steam/start` en `Login.tsx`). El perfil ya lo crea
      `asegurarPerfil` (`web/src/datos/usuarios.ts`, T37).
- [x] `Profile.tsx`: campo `steam_url` para pegar el perfil de Steam (sumarlo a `actualizarPerfil`
      y a `User` en `types.ts`; las reglas ya lo validan). Aceptar solo
      `https://steamcommunity.com/id/...` o `/profiles/...`; mostrarlo como link en el perfil y en
      los equipos, con el aviso "no verificado".
- [x] Sacar de `Profile.tsx` vincular y desvincular Steam y Google.

### T41 · Links de las partidas — dif. 2 · junior · 4 h

- [x] Campo `vod_links: [{ label, url }]` en `matches/{matchId}` (por llave) y en
      `tournaments/{slug}/stages/{stageId}` (por fase). Máximo 20 por documento.
- [x] Editor para el staff: agregar, cambiar y borrar; aceptar solo `http://` y `https://`.
- [x] Mostrarlos en `Bracket.tsx` (ícono en cada partido con links), en `MatchRoom.tsx` y en la
      cabecera de cada fase en `TournamentPage.tsx`. Abren en otra pestaña con
      `rel="noopener noreferrer"`.
- [x] `games[].replay_url` ya existe por partida: mostrarlo junto a estos links, no duplicarlo.

### Fase 7 · Draft nuevo

### T44 · Pulir la pantalla del draft — dif. 2 · junior · 4 h

- [x] `DraftBoard.tsx` ya funciona con el draft nuevo (T43): mapa, bans, pick ciego con "eligió" /
      "falta", revelado y reiniciar. Falta el pulido: el mapa elegido grande arriba, el turno con el
      color del equipo, las civs baneadas aparte con el equipo que las baneó, y que en celular la
      grilla de civs no se corte.
- [x] Mostrar la civ propia elegida antes de revelar ("Tu civ: …, podés cambiarla hasta que eligan
      todos").
- [x] Sacar el draft viejo: tipos `DraftStep`, `CivPick` y `DraftState` de `types.ts` (y `draft`
      de `MatchDetail`), `ETIQUETA_PASO` de `lib.ts`.
- [x] Probar como espectador (sin sesión): ve el tablero sin botones y no ve picks hasta revelar.
      Cubierto por el código (sin uid no hay botones ni picks ajenos). Falta la pasada en el navegador (T32).

### T45 · Formulario del torneo — dif. 2 · junior · 2 h

- [x] `TournamentForm.tsx`: sacar `map_mode`, `map_bans`, `civ_pattern`, el reloj por paso y la opción
      de pick ciego (ahora siempre es ciego).
- [x] Sacar `civ_mirror` y `civ_repeat_team` (D6); `civ_repeat_series` queda.
- [x] Sumar `civ_bans` (0 a 3 por equipo) y "primer mapa": fijo (`first_map_id`) o al azar.
- [x] Mantener `map_repeat` y el pool de mapas y civs (`PoolPicker.tsx`).

### T46 · Tiempo real sin API — dif. 3 · junior · 4 h

- [x] `web/src/live.ts`: `useLive` deja de escuchar `live/{matchId}` y escucha directo
      `matches/{matchId}` y el draft abierto con `onSnapshot`.
- [x] `useChat`: escribir con `addDoc` en `rooms/{roomId}/messages` con `{ body, system: 0,
      created_at: serverTimestamp(), user: { id, display_name, avatar_url } }` tal como están en el
      perfil (las reglas de T36 lo comparan). Crear la sala con `setDoc` si no existe, con los campos
      que pide `salaNuevaValida` en `firestore.rules`. Quién puede escribir: mismo criterio que
      `puedeEscribirSala`.
- [x] Los avisos del sistema que hoy publica la API ("cargó el resultado", "empezó el draft") se
      sacan: el cliente no puede escribir `system: true`.
- [x] Cortar las escuchas al salir de la pantalla.

### T47 · Sacar el servidor — dif. 3 · senior · 4 h · hecha

- [x] Borrados la API (`app.js`, `index.js`, `routes/`, `auth.js`, `config.js`), el reloj
      (`relojes.js`), `live.js`, el draft viejo (`draft.js`, `draft-core.js`), `chat.js`, los
      reexports hacia la web (`brackets.js`, `teambuilder.js`, `availability.js`, `catalogo.js`) y
      también SQLite (`db.js`, `schema.sql`, `brackets-sqlite.js`). En `functions/src` quedan
      `data/` (Admin SDK) y `demo.js`. `firebase.json` sin `functions`, sin `/api/**` y sin los
      emuladores `functions` y `tasks`; `firestore.rules` sin `live/{matchId}`.
- [x] Borrados `web/src/api.ts` y el proxy de Vite.
- [x] Demo sobre el modelo nuevo con la lógica de la web: llaves con `generarCuadro`, cada partida
      de los cuartos con su draft (mapa, bans, picks ciegos, revelado, `picked`) y la serie cerrada
      con `cargarPartidas`; la primera semi con el draft abierto en bans. Sin contadores ni `live`.
      `functions/data/drafts.js` pasa a `guardarDraft` / `guardarPick`. El seed sigue en
      `functions/scripts/seed.js`.
- [x] `npm test`: 89 pruebas en `functions/` (datos, demo y reglas) y 48 de lógica en `web/test/`.
      Borradas las pruebas de rutas. `functions/package.json` queda solo con `firebase-admin`.
- [x] De paso: en `web/src/live.ts`, un anónimo en un partido cuya sala de chat nadie abrió veía
      "No tenés permiso"; ahora ve la sala vacía.

### Fase 5 · Publicación y cierre

### T30 · Deploy automático — dif. 3 · senior · 4 h

- [x] `.github/workflows/deploy.yml`: en cada push y PR, Node 22 + Java 21, `npm ci`, `npm test`
      (emuladores) y `npm run build`; en push a `master`, además `npm run assets` (si falla,
      sigue), `npm run build` y `firebase deploy --only hosting,firestore,database --project prod`.
      El job de publicar usa el entorno `produccion` de GitHub.
- [x] Sin variables de build: la config de la app web está en `web/src/firebase.ts` (T01).
- [x] `firestore.indexes.json`: fuera el TTL de `authStates` (ya no existe) y dos índices para las
      consultas del cliente (`registrations` por `status` + `paid`, `rooms` por `tournament_id` +
      `kind`). `engines` de la raíz pasa a `>=22` (era por `node:sqlite`).
- [x] Deploy en seco contra `prod` desde la PC: reglas de Firestore y Realtime Database compilan en
      el proyecto real.
- [ ] Vos: en la consola de Google Cloud del proyecto, IAM → Cuentas de servicio → crear una con el
      rol "Administrador de Firebase", generar una clave JSON y pegarla entera en GitHub →
      Settings → Secrets and variables → Actions → `FIREBASE_SERVICE_ACCOUNT`.
- [x] Primer deploy a mano desde la PC (2026-10-27): Hosting, reglas e índices de Firestore y
      reglas de Realtime Database en `aoe-3-draft-2eea7`. Verificado: la web carga en
      https://aoe-3-draft-2eea7.web.app sin errores (lista de torneos vacía), las rutas de la SPA
      devuelven el `index.html`, `/assets/**` llega con `Cache-Control: public, max-age=604800,
      immutable`, y las reglas de producción rechazan escrituras anónimas (Firestore 403,
      Realtime Database 401) y dejan leer torneos.
- [ ] Vos: entrar con Google en la web publicada (no se puede probar sin tu cuenta).

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

### Fase 8 · Draft suelto

Nombres que usan todas las tareas (propuesta de este plan; el diseño deja la estructura al
constructor, pero tienen que ser los mismos en lógica, reglas y pantallas):

- Colección `quick_drafts/{draftId}`: id aleatorio de 10 caracteres, `get` abierto y `list` cerrado.
  Configuración: `creator_id`, `team_size` (1–4), `map_chooser` (`a` | `b` | `creator` | `random`),
  `map_bans` (0–3), `civ_bans` (0–3), `map_ids`, `civ_pick_mode`, `civ_repeat_enemy` (0/1),
  `civ_repeat_team` (0/1). Estado: `state` (`lobby` | `bans_mapa` | `mapa` | `bans_civ` | `picks` |
  `listo`), `closing` y `closed` (0/1), `slots` (`{ a: [uid|null…], b: [uid|null…] }`). Al empezar,
  los mismos campos que el draft de partida (`team_a_id` = `'a'`, `team_b_id` = `'b'`, `player_ids`,
  `team_of`, `civ_pool`, `ban_order`, `banned_civ_ids`, `picked`, `revealed`, `map_pool`, `map_id`,
  `map_chooser_team_id`) más `banned_map_ids` y `map_ban_order`.
- Subcolección `quick_drafts/{draftId}/picks/{uid}` y, en torneos, `matches/{id}/drafts/{n}/picks/{uid}`:
  `{ civ_id, confirmed }` (0/1).
- Campos nuevos que comparten el torneo, el draft de partida y el suelto: `civ_pick_mode`
  (`'ciego'` | `'serpiente'`, por defecto ciego), `civ_repeat_enemy` y `civ_repeat_team` (por defecto
  1 y 1). En el draft: `team_players` (`{ teamId: [uid…] }`), `pick_order` (uids, serpiente), `picks`
  (`[{ user_id, civ_id }]`, serpiente) y `civs_by_team` (`{ teamId: [civ_id…] }`, para que las reglas
  comparen sin recorrer listas).
- Chat: `rooms/draft_{id}` y `rooms/draftteam_{id}_{a|b}`; en `useChat`, `draft:{id}` y
  `draftteam:{id}:{a|b}`.

### T48 · Lógica compartida de civ — dif. 4 · senior · 1 d

- [ ] `web/src/logica/draft.js`: `planDeDraft` lee `civ_pick_mode`, `civ_repeat_enemy` y
      `civ_repeat_team` del torneo (por defecto `'ciego'`, 1, 1) y los copia al documento junto con
      `team_players`. Un draft ya abierto, sin esos campos, se trata como ciego, sí, sí.
- [ ] Ciego: `validarPick` suma "no repetir dentro del equipo" (civ ya elegida por un compañero) cuando
      `civ_repeat_team` es 0; nueva `confirmarPick(draft, uid, picks)` (exige pick propio y que no
      esté confirmado); el pick se cambia hasta confirmar; `revelar` y `eligieronTodos` cuentan
      confirmados.
- [ ] Serpiente: `ordenSerpiente(teamSize, primero, segundo)` (ABBA por jugador; dentro del equipo,
      por orden de `team_players`), `turnoDePick(draft)` y `elegirCivSerpiente(draft, uid, civId)`:
      valida turno, pool, baneadas y las dos opciones de repetición; agrega a `picks` y
      `civs_by_team`; el último pick pasa a `listo`. `revelar` devuelve las civs también en serpiente.
- [ ] `validarOpcionesDeCiv(opciones, civIds, jugadores)`: error si no alcanzan las civs para completar
      todos los picks con los bans y las opciones elegidas.
- [ ] Pruebas en `web/test/draft.test.js` (con `torneo()` y `equipo()`): orden para 1, 2, 3 y 4 por
      equipo, exclusividad, repetir en el equipo, confirmar definitivo, pool insuficiente, draft viejo
      sin campos nuevos.
- [ ] Ya existe y no se rehace: bans alternados, `elegirMapa`, `civs_usadas` (`civ_repeat_series`).

### T56 · Componentes compartidos del draft — dif. 3 · junior · 1 d

- [ ] Carpeta `web/src/components/draft/`, componentes que solo reciben props (sin leer datos):
      `MapaCuadrado` (tarjeta `aspect-square` con `mapa.img` de fondo, etiqueta "MAPA ELEGIDO",
      nombre y quién lo eligió) y `BansDeMapa` (caja chica debajo con el ban de cada equipo).
- [ ] `GrillaDeCivs`, sacada de la grilla de `DraftBoard.tsx`: bandera `civ.flag` y nombre; estados
      elegida, baneada, tomada por el rival (con quién la tomó) y no disponible; clickeable o no.
- [ ] `EquiposDelDraft` (dos columnas con el color del equipo, fila por jugador: bandera y civ si se
      ve; "✓ Ya eligió" o "Eligiendo…" para los rivales; "Sin confirmar" para el propio; modo
      "lugares" para el lobby) y `OrdenDeSerpiente` (fila de turnos con el actual resaltado).
- [ ] `BarraDeConfirmar` (civ elegida, "Cambiar", "Confirmar pick"), fija abajo.
- [ ] Colores y clases del sitio (`gold`, `moss`, `ink`, `card`, `btn`); en celular las columnas se
      apilan y la grilla no se corta. Referencia: `docs/superpowers/specs/2026-10-27-draft-suelto-mockup.html`.
- [ ] Frontera: no se toca `DraftBoard.tsx` (lo hace T57); T56 no importa nada de `datos/`.

### T49 · Lógica del draft suelto — dif. 4 · senior · 1 d

- [ ] `web/src/logica/draftSuelto.js`, pura como `draft.js`: `crearDraftSuelto(config, creatorId)`
      valida (team_size 1–4, bans 0–3, pool de mapas mayor que 2 × `map_bans`, `validarOpcionesDeCiv`
      de T48) y devuelve el documento en `state: 'lobby'` con `slots` vacíos.
- [ ] Lobby: `unirse(draft, uid, equipo)` (un lugar por usuario; cambiar de lugar vale hasta empezar),
      `salirDelLugar`, `sacarJugador(draft, creatorId, uid)` y `puedeEmpezar` (todos los lugares
      ocupados).
- [ ] `empezar(draft, creatorId)` arma lo que arma `planDeDraft` (`player_ids`, `team_of`,
      `team_players`, `civ_pool` = todas, `map_pool`, `ban_order`, `pick_order`) y pasa a la primera fase
      que no esté vacía. Arranca el equipo que no elige el mapa; con `creator` o `random`, el A.
- [ ] `banearMapa`, `elegirMapaSuelto` (equipo del turno, o solo el creador con `creator`),
      `mapaAlAzar(draft)` (hash del id y los bans, como `hash` de `draft.js`) y `reiniciar(draft)`
      (vuelve a `lobby` con los mismos jugadores y la misma configuración). Bans de civ, picks y
      revelado: las funciones de T48.
- [ ] Pruebas en `web/test/draftSuelto.test.js`: lobby, empezar con lugares vacíos, quién arranca con
      cada `map_chooser`, bans de mapa que dejan un solo mapa, reinicio.

### T50 · Reglas del draft con las opciones nuevas (torneo) — dif. 5 · senior · 2 d?

- [ ] `torneoValido` en `firestore.rules`: `civ_pick_mode in ['ciego','serpiente']`, `civ_repeat_enemy` y
      `civ_repeat_team` en 0/1, todos opcionales. En `web/src/types.ts`, los tres en `Tournament`.
- [ ] `picks/{userId}` del ciego: escribe solo el dueño y mientras `confirmed` no sea 1; `confirmed`
      solo 0 o 1; con `civ_repeat_team` en 0, no vale la civ de un compañero (recorrer `team_players`,
      hasta 3 compañeros, cuidando el tope de 10 accesos por regla). Lee el dueño, sus compañeros
      (`team_of`) o cualquiera con `revealed`.
- [ ] `seAnota` exige además el pick propio con `confirmed == 1` (`existsAfter` y `getAfter`); `revela`
      igual. Picks sin `confirmed` de drafts viejos cuentan como confirmados si su uid está en `picked`.
- [ ] Serpiente: nueva `eligeSerpiente(r, d)`: cambian solo `picks`, `civs_by_team` y `state`;
      `yo() == r.pick_order[n]`; la civ en `civ_pool`, no baneada y, según las opciones, fuera de
      `civs_by_team` del otro equipo y del propio; `listo` en el último.
- [ ] Pruebas en `functions/test/reglas-partidos.test.js`: el rival no lee el pick, el compañero sí; no
      se cambia tras confirmar; turno equivocado falla; exclusividad y repetir en equipo; torneo sin
      los campos nuevos sigue andando.
- [ ] Frontera: las funciones se escriben recibiendo el draft (`d`), no la ruta, para que T51 las
      reuse. La rama del staff (cualquier cambio en `matches/.../drafts`) se mantiene solo ahí.

### T51 · Reglas del draft suelto y su chat — dif. 5 · senior · 2 d?

- [ ] `quick_drafts/{id}`: `allow get: if true`, `allow list: if false`. Crear: con sesión,
      `creator_id == yo()`, `state == 'lobby'`, configuración válida, `slots` vacíos,
      `revealed == false`, `closing`/`closed` en 0 y el documento no existe.
- [ ] Un update por paso, como `eligeMapa` y `banea` de hoy: lugar propio en `lobby` (`slots`, solo mi
      uid), `sacaJugador` y `empieza` (creador, lugares completos), `baneaMapa`, `eligeMapaSuelto`
      (equipo del turno; el creador con `creator`; con `random`, un jugador y un mapa del pool
      restante), bans de civ, `seAnota`, `revela` y `eligeSerpiente` de T50, `reinicia` y `cierra`
      (creador). El creador no tiene ninguna otra escritura.
- [ ] `quick_drafts/{id}/picks/{uid}`: las mismas reglas del ciego de T50 leyendo el draft suelto.
- [ ] Chat: `salaNuevaValida`, `puedeLeerSala` y `puedeEscribirSala` aceptan `kind: 'draft'` (lee
      cualquiera; escriben jugadores y creador) y `kind: 'draft_equipo'` (solo jugadores de ese
      equipo). El creador lee y borra mensajes y salas de todo el draft solo con `closing == 1` y
      `closed == 0`; después marca `closed`.
- [ ] Pruebas en `functions/test/reglas-draft-suelto.test.js` (nuevo, mismo arranque que
      `reglas-partidos.test.js`): no se lista; secreto del ciego; turnos; el creador no escribe de más;
      chat de equipo cerrado al rival y al creador árbitro, abierto para borrar en `closing`.
- [ ] Frontera: arranca cuando T50 está mergeada (mismo archivo de reglas). La documentación la hace T61.

### T52 · Datos del draft de torneo — dif. 3 · senior · 4 h

- [ ] `web/src/datos/drafts.ts`: `abrirDraft` ya guarda `planDeDraft`; verificar que copia
      `civ_pick_mode`, `civ_repeat_enemy` y `civ_repeat_team` (T48).
- [ ] `elegirCiv` guarda `{ civ_id, confirmed: 0 }` sin anotarse; nueva `confirmarCiv(draft, matchId,
      uid)` en un batch: `confirmed: 1` y `picked: arrayUnion(uid)`. Cambiar la civ antes de confirmar
      sigue andando.
- [ ] Nueva `elegirCivSerpiente(matchId, gameNo, uid, civId)` en transacción (relee el draft) con
      `elegirCivSerpiente` de T48; escribe `picks`, `civs_by_team` y `state`.
- [ ] `useDraft`: además del pick propio, escucha los de los compañeros (`team_of`); `EstadoDraft` suma
      `equipo: Record<uid, civId>`. Casos: espectador sin sesión (no lee picks) y jugador sin pick.
- [ ] `revelarSiEstanTodos` y el efecto de `useDraft` revelan cuando todos confirmaron, no cuando todos
      eligieron.

### T55 · Opciones de civ en torneos — dif. 2 · junior · 4 h

- [ ] `web/src/components/TournamentForm.tsx`, pestaña Draft: selector "Modo de pick de civ" (Ciego /
      Serpiente) y dos `Check`: "Repetir civ entre equipos" (apagado e inactivo en ciego, con el hint
      "en ciego siempre se puede") y "Repetir civ dentro del equipo" (vuelve `civ_repeat_team`, que T45
      había sacado). Corregir el texto de ayuda que hoy dice que los picks son siempre ciegos.
- [ ] `Borrador` y `BORRADOR_INICIAL`: `civ_pick_mode: 'ciego'`, `civ_repeat_enemy: true`,
      `civ_repeat_team: true`.
- [ ] `CreateTournament.tsx` y `TournamentPage.tsx` (guardar y editar la configuración): mandar 0/1 como
      `civ_repeat_series`; en la ficha, `Dato` para modo, repetir entre equipos y repetir en el equipo
      junto a "Bans de civ por equipo".
- [ ] `web/src/datos/torneos.ts`: sumar los tres campos a las listas de campos permitidos (líneas de
      `civ_repeat_series`) y a los valores por defecto. El tipo `Tournament` ya lo agregó T50.
- [ ] Torneos viejos sin los campos: se ven y se editan como ciego, sí, sí.

### T53 · Datos del draft suelto — dif. 4 · senior · 1 d

- [ ] `web/src/datos/draftsSueltos.ts`: `crearDraftSuelto(config)` genera el id (10 caracteres con
      `crypto.getRandomValues`) y escribe en `quick_drafts/{id}` en una transacción que falla si ya
      existe (reintenta con otro); `leerDraftSuelto`.
- [ ] Acciones en transacción que relee el draft, con `conMensaje` y errores `Rechazo` como
      `datos/drafts.ts`: `unirseAlLugar`, `salirDelLugar`, `sacarJugador`, `empezarDraft`,
      `banearMapaSuelto`, `elegirMapaSuelto`, `banearCivSuelto`, `reiniciarDraftSuelto` y
      `cerrarDraft` (marca `closing`, llama a `borrarChatDelDraft` de T54 y marca `closed`).
- [ ] Picks: `elegirCivSuelto`, `confirmarCivSuelto`, `elegirCivSerpienteSuelto` y `revelarSuelto`, con
      la forma de las de T52 pero sobre `quick_drafts`.
- [ ] `useDraftSuelto(id, uid)` como `useDraft`: documento, pick propio y de compañeros, todos los
      picks una vez revelado, `error`. Sin sesión: solo lectura, y las acciones fallan con
      "Tenés que entrar".
- [ ] Frontera: la lógica es la de T49 y T48; acá no se escribe ninguna regla de juego.

### T54 · Chat del draft — dif. 4 · senior · 4 h

- [ ] `web/src/live.ts`: `PREFIJOS` suma `draft` y `draftteam`; `parsearSala` entiende `draft:{id}` y
      `draftteam:{id}:{a|b}`; `datosDeSala` arma `{ kind, draft_id, team_id, public_read, name,
      created_at }` como pide `salaNuevaValida` (T51).
- [ ] `borrarChatDelDraft(draftId)`: lista los mensajes de las tres salas y los borra en tandas de
      450 con `writeBatch` (patrón de `generarLlaves` en `datos/llaves.ts`); después borra las salas.
      Idempotente: si se corta, `closing` queda en 1 y se puede reintentar.
- [ ] `useChat`/`enviar`: la sala de equipo del draft solo la crea un jugador de ese equipo; un
      anónimo ve la general vacía (como hoy).
- [ ] Evaluar el vencimiento automático (TTL) de Firestore sobre `messages` como respaldo (D14); si
      no está en Spark o no es gratis, no se hace.
- [ ] Sin pruebas de interfaz en el repo: se prueba en T62.

### T57 · DraftBoard de torneo con los componentes nuevos — dif. 3 · junior · 1 d

- [ ] `web/src/components/DraftBoard.tsx`: reemplazar mapa, equipos y grilla por los de T56: mapa 1:1 a
      la izquierda, equipos y bans al costado, civs debajo (como la maqueta).
- [ ] Ciego: elegir una civ solo la marca y aparece `BarraDeConfirmar`; confirmar llama a `confirmarCiv`
      (T52). Rivales con tilde, compañeros con la civ a la vista (`estado.equipo`).
- [ ] Serpiente: `OrdenDeSerpiente`, aviso "te toca", civs bloqueadas según las opciones y
      `elegirCivSerpiente`.
- [ ] Sacar "Tu civ…, podés cambiarla hasta que elijan todos" (ahora hay confirmar); mantener el
      "Reiniciar" del staff.
- [ ] Casos: espectador sin botones; draft viejo sin `civ_pick_mode` se trata como ciego; revelado.

### T58 · Pestaña Draft y pantalla de crear — dif. 2 · junior · 1 d

- [ ] `web/src/App.tsx`: `NavLink` "Draft" a `/draft`, visible siempre, junto a "Torneos" y "Crear
      torneo"; ruta `/draft`.
- [ ] `web/src/pages/DraftNuevo.tsx`: formulario en dos columnas como la maqueta (opciones a la
      izquierda, resumen fijo a la derecha): jugadores por equipo, equipos (2 fijo), quién elige el
      mapa, bans de mapa, bans de civ, modo de pick, repetir entre equipos (solo serpiente) y dentro del
      equipo.
- [ ] Pool de mapas con `MapPicker` de `PoolPicker.tsx` (todos por defecto, con buscador).
- [ ] "Crear y copiar link": `crearDraftSuelto` (T53), copia `…/d/{id}` al portapapeles y navega a la
      sala; muestra el error de `validarOpcionesDeCiv` si falta pool. Sin sesión, el botón dice "Entrá
      para crear" y manda a `/entrar`.
- [ ] Frontera: la ruta `/d/:id` la agrega T59 en su propia línea del `<Routes>` de `App.tsx`; si chocan
      al mergear, quedan las dos.

### T59 · Sala: lobby y espectadores — dif. 3 · junior · 1 d

- [ ] `web/src/pages/DraftSala.tsx` y la ruta `/d/:id`: carga con `useDraftSuelto`; "Este draft no
      existe" si el id no está; con `closed`, solo el resultado.
- [ ] Lobby: link con "Copiar link"; `EquiposDelDraft` en modo lugares: "Unirme" en cada lugar libre,
      salir y cambiar de equipo; sin sesión, botón de entrar que vuelve a la sala.
- [ ] Creador: "Empezar" (inactivo hasta completar los lugares), sacar jugador, "Reiniciar" y "Cerrar
      sala", con `confirm` como el reinicio de `DraftBoard.tsx`.
- [ ] Nombre y avatar de cada jugador con `leerPorIds('users', …)` de `datos/base.ts`; "conectado" con
      `usePresencia('draft:{id}')` (opcional).
- [ ] Frontera: las fases en curso las hace T60; acá, al empezar, la pantalla muestra "Draft en curso".

### T61 · Documentación — dif. 1 · junior · 2 h

- [ ] `docs/firestore-modelo.md`: secciones `quick_drafts/{draftId}` y `quick_drafts/{id}/picks/{uid}`,
      campos nuevos del torneo y del draft de partida, salas `draft_` y `draftteam_` y la ventana de
      lectura del creador al cerrar. Actualizar también `matches/{matchId}/drafts/{gameNo}`, que hoy
      describe el modelo viejo de pasos.
- [ ] `PLAN.md`: tildar T48–T62 y dejar las decisiones D12 a D14 en su estado final.
- [ ] `README.md`: mencionar la pestaña Draft y las opciones de civ.

### T60 · Sala en curso — dif. 3 · junior · 1 d

- [ ] En `DraftSala.tsx`, según `state`, con los componentes de T56: `bans_mapa` y `mapa` (grilla de
      mapas del pool con los baneados tachados, clic para banear o elegir según el turno; con
      `map_chooser == 'random'`, el navegador que da el último ban escribe el mapa), `bans_civ`,
      `picks` (ciego con confirmar, o serpiente con orden) y `listo` (resultado).
- [ ] Banner de fases (Mapa, Bans, Picks, Revelado) y aviso de turno ("Banea Equipo B", "te toca"), igual
      que el `aviso` de `DraftBoard.tsx`.
- [ ] `ChatPanel` (ya existe) a la derecha con dos salas: "Todos" (`draft:{id}`) y el equipo propio
      (`draftteam:{id}:{a|b}`) para los jugadores; espectadores y creador árbitro solo "Todos". Aviso
      "El chat se borra al cerrar la sala".
- [ ] "Cerrar sala" (creador): confirmar, `cerrarDraft` (T53), mostrar el progreso y poder reintentar si
      falla; después, solo el resultado.
- [ ] Celular: columnas apiladas; el chat pasa a pestaña o cajón.

### T62 · Prueba completa del draft — dif. 2 · junior · 4 h

- [ ] Emuladores (`npm run dev`) con cuatro navegadores: draft suelto 2v2 en ciego (lobby, empezar,
      bans de mapa y de civ, elegir y confirmar). Los rivales ven el tilde y no la civ, el compañero la
      ve y el revelado es a la vez.
- [ ] Draft suelto en serpiente sin repetir entre equipos: orden A, B, B, A; la civ tomada queda
      bloqueada para el rival y no para el compañero si se permite repetir en el equipo.
- [ ] Desde la consola de un navegador rival: leer el pick ajeno antes de revelar, escribir fuera de
      turno y listar `quick_drafts` deben dar `permission-denied`.
- [ ] Chat: el general lo ve todo el que tenga el link, el de equipo solo ese equipo; al cerrar la sala
      no quedan mensajes (verificar en la UI de los emuladores, :4000).
- [ ] Torneo en ciego con "Confirmar pick", torneo en serpiente (con la demo) y un torneo existente
      sin los campos nuevos.
- [ ] Celular (ancho 375): mapa, grilla y chat sin cortes. Anotar en este plan lo que falle.

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
| D12 | Equipos del draft suelto | **Cerrada (2026-10-27): dos fijos.** Más de dos queda fuera. | — |
| D13 | Chat de equipo al cerrar el draft suelto | **Cerrada (2026-10-27): el creador lee y borra todas las salas solo durante el cierre.** Si no se acepta esa ventana, la salida es un contador de mensajes. | — |
| D14 | TTL de Firestore como respaldo del chat | Hay que verificar que esté disponible y gratis en Spark; si no, no se hace. | T54 (solo esa viñeta) |
