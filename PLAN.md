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

**Estado.** 11 tareas pendientes, 33 h en total (unos 5,5 días de 6 h para una persona sola; unos 3
días con un senior y dos juniors). Hechas en la rama `feat/firebase`: T02 a T27 sobre el plan Blaze
anterior, y T01, T34–T37, T39, T40, T42 y T43 del plan Spark. No hay datos para migrar.

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

Las dependencias con tareas hechas ya están cumplidas y no figuran en la tabla. T29 quedó hecha y su
número no se reusa.

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

### T38 · Ingreso y Steam sin verificar — dif. 2 · junior · 2 h

- [ ] `Login.tsx` y `web/src/auth.tsx`: solo el botón de Google. Sacar Steam (el canje del token
      de Steam en `auth.tsx` y `/api/auth/steam/start` en `Login.tsx`). El perfil ya lo crea
      `asegurarPerfil` (`web/src/datos/usuarios.ts`, T37).
- [ ] `Profile.tsx`: campo `steam_url` para pegar el perfil de Steam (sumarlo a `actualizarPerfil`
      y a `User` en `types.ts`; las reglas ya lo validan). Aceptar solo
      `https://steamcommunity.com/id/...` o `/profiles/...`; mostrarlo como link en el perfil y en
      los equipos, con el aviso "no verificado".
- [ ] Sacar de `Profile.tsx` vincular y desvincular Steam y Google.

### T41 · Links de las partidas — dif. 2 · junior · 4 h

- [ ] Campo `vod_links: [{ label, url }]` en `matches/{matchId}` (por llave) y en
      `tournaments/{slug}/stages/{stageId}` (por fase). Máximo 20 por documento.
- [ ] Editor para el staff: agregar, cambiar y borrar; aceptar solo `http://` y `https://`.
- [ ] Mostrarlos en `Bracket.tsx` (ícono en cada partido con links), en `MatchRoom.tsx` y en la
      cabecera de cada fase en `TournamentPage.tsx`. Abren en otra pestaña con
      `rel="noopener noreferrer"`.
- [ ] `games[].replay_url` ya existe por partida: mostrarlo junto a estos links, no duplicarlo.

### Fase 7 · Draft nuevo

### T44 · Pulir la pantalla del draft — dif. 2 · junior · 4 h

- [ ] `DraftBoard.tsx` ya funciona con el draft nuevo (T43): mapa, bans, pick ciego con "eligió" /
      "falta", revelado y reiniciar. Falta el pulido: el mapa elegido grande arriba, el turno con el
      color del equipo, las civs baneadas aparte con el equipo que las baneó, y que en celular la
      grilla de civs no se corte.
- [ ] Mostrar la civ propia elegida antes de revelar ("Tu civ: …, podés cambiarla hasta que eligan
      todos").
- [ ] Sacar el draft viejo: tipos `DraftStep`, `CivPick` y `DraftState` de `types.ts` (y `draft`
      de `MatchDetail`), `ETIQUETA_PASO` de `lib.ts`.
- [ ] Probar como espectador (sin sesión): ve el tablero sin botones y no ve picks hasta revelar.

### T45 · Formulario del torneo — dif. 2 · junior · 2 h

- [ ] `TournamentForm.tsx`: sacar `map_mode`, `map_bans`, `civ_pattern`, el reloj por paso y la opción
      de pick ciego (ahora siempre es ciego).
- [ ] Sacar `civ_mirror` y `civ_repeat_team` (D6); `civ_repeat_series` queda.
- [ ] Sumar `civ_bans` (0 a 3 por equipo) y "primer mapa": fijo (`first_map_id`) o al azar.
- [ ] Mantener `map_repeat` y el pool de mapas y civs (`PoolPicker.tsx`).

### T46 · Tiempo real sin API — dif. 3 · junior · 4 h

- [ ] `web/src/live.ts`: `useLive` deja de escuchar `live/{matchId}` y escucha directo
      `matches/{matchId}` y el draft abierto con `onSnapshot`.
- [ ] `useChat`: escribir con `addDoc` en `rooms/{roomId}/messages` con `{ body, system: 0,
      created_at: serverTimestamp(), user: { id, display_name, avatar_url } }` tal como están en el
      perfil (las reglas de T36 lo comparan). Crear la sala con `setDoc` si no existe, con los campos
      que pide `salaNuevaValida` en `firestore.rules`. Quién puede escribir: mismo criterio que
      `puedeEscribirSala`.
- [ ] Los avisos del sistema que hoy publica la API ("cargó el resultado", "empezó el draft") se
      sacan: el cliente no puede escribir `system: true`.
- [ ] Cortar las escuchas al salir de la pantalla.

### T47 · Sacar el servidor — dif. 3 · senior · 4 h

- [ ] Borrar `functions/src/app.js`, `index.js`, `routes/`, `relojes.js`, `live.js`, `config.js`,
      `auth.js`, `draft.js`, `draft-core.js` y lo que quede sin uso; en `firebase.json`, la sección
      `functions`, el rewrite `/api/**` y los emuladores `functions` y `tasks`.
- [ ] Borrar `web/src/api.ts` y el proxy de `/api` de Vite.
- [ ] Demo: rehacer `functions/src/demo.js` y `functions/scripts/seed.js` sobre el modelo nuevo
      (draft con picks y `picked`, votos en `votos/{uid}`, `vod_links`, sin `live` ni `readers`). El seed sigue con el Admin SDK contra el emulador;
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
