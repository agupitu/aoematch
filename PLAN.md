# Plan: migrar AoE III Draft a Firebase (plan Blaze)

**Objetivo.** Que la página quede siempre prendida y no pierda datos, con las mismas funciones de
hoy: torneos, inscripciones, armador de equipos, llaves, horarios, chat por sala y equipo, draft en
vivo con reloj, ingreso con Google y Steam.

**Arquitectura.** Firebase Hosting sirve la web y las imágenes del juego. La API Express pasa entera
a una sola Cloud Function (`api`) detrás de `/api/**`, así el frontend sigue llamando a las mismas
rutas. Firestore reemplaza a SQLite: la API lee y escribe con el Admin SDK, y el cliente solo lee
directo el chat y un documento de aviso por partido. Firebase Auth reemplaza las sesiones por cookie:
Google nativo y Steam con token propio. El WebSocket se reemplaza por escuchas de Firestore (chat,
avisos de cambio) y Realtime Database (presencia). El reloj del draft pasa a Cloud Tasks.

**Estado.** 29 tareas pendientes, 124 h en total (unos 21 días de 6 h para una persona sola).
T02, T03, T04 y T05 están hechas en la rama `feat/firebase`. No hay datos para migrar: la base de Render
se borra en cada apagado.

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
| T05 | Las rutas todavía no la usan: siguen sobre SQLite y cada una pasa a `data/` en su tarea (T15 a T23). `db.js`, `schema.sql`, `cargarCatalogo()` y las tablas `civs` y `maps` se borran en T33, cuando no quede SQL. | — |

**Lógica que se reutiliza**

| Área | Se reutiliza sin cambios de lógica | Dónde |
|---|---|---|
| Draft | Plan de pasos, patrón serpiente, reglas de civs, elección automática, validaciones | `functions/src/draft.js` |
| Llaves | Siembra 1-8 / 4-5 / 2-7 / 3-6, nombres de ronda, avance de ganador y perdedor | `functions/src/brackets.js` |
| Armador | Serpiente por rating + 4000 intercambios por nivel y horario | `functions/src/teambuilder.js` |
| Horarios | Máscaras de 30 min, ventanas, próxima fecha real | `functions/src/availability.js` |
| Steam | Verificación OpenID 2.0 y perfil por API | `functions/src/routes/auth.js` |
| Web | Todas las pantallas; cambian `api.ts`, `auth.tsx`, `ws.ts`, `types.ts`, `Login.tsx`, `Profile.tsx`, `MatchRoom.tsx`, `TournamentPage.tsx` | `web/src/` |

No hay pruebas automáticas en el repo: T06 y T21 agregan las primeras.

## Tareas

Dificultad 1 (trivial) a 5 (arquitectura / riesgo alto). Rol: **J** = junior con revisión de
senior; **S** = senior. Tiempo: horas efectivas del rol asignado, con prueba y revisión incluidas
(1 d = 6 h).

| ID | Tarea | Dif. | Rol | Tiempo | Depende de | Ola |
|---|---|---|---|---|---|---|
| **Fase 0 · Base del proyecto** |||||||
| T01 | Proyecto en la consola: Blaze, alerta de gasto, Firestore, RTDB, Auth con Google | 1 | J | 1 h | — | 0 |
| **Fase 1 · Datos y seguridad** |||||||
| T06 | `firestore.rules` y `database.rules.json` con pruebas | 5 | S | 1 d | — | 0 |
| T07 | Ids de texto en `web/src/types.ts` y páginas | 2 | J | 4 h | — | 0 |
| **Fase 2 · Autenticación** |||||||
| T08 | Middleware de ID token, `/api/auth/me` y alta de usuario | 5 | S | 4 h | — | 0 |
| T09 | `web/src/firebase.ts`, `auth.tsx` y `api.ts` con token Bearer | 3 | S | 4 h | — | 0 |
| T10 | Google con `signInWithPopup`, `linkWithPopup` y desvincular | 3 | S | 2 h | T09 | 1 |
| T11 | Steam con `createCustomToken` | 5 | S | 1 d | T08, T09 | 1 |
| T12 | Login de prueba por email solo en el emulador | 2 | J | 1 h | T09 | 1 |
| T13 | Buscador de usuarios sobre Firestore | 2 | J | 1 h | T08, decisión D4 | 1 |
| T14 | Botones y mensajes de `Login.tsx` y `Profile.tsx` | 2 | J | 2 h | T10, T11 | 2 |
| **Fase 3 · API sobre Firestore** |||||||
| T15 | Horarios y cruce (`availability.js`, `routes/catalog.js`) | 3 | S | 4 h | T08 | 1 |
| T16 | Torneos: listado, alta, detalle, edición y borrado | 4 | S | 1 d | T08 | 1 |
| T17 | Inscripciones y equipos con transacciones | 4 | S | 1 d | T16 | 2 |
| T18 | Generación de llaves (`brackets.js`) | 4 | S | 2 d | T16 | 2 |
| T19 | `cerrarMatch`, tablas, suizo y playoffs | 5 | S | 4 h | T18 | 3 |
| T20 | Armador de equipos (`teambuilder.js`) | 3 | S | 4 h | T15, T17 | 3 |
| T21 | Motor de draft: núcleo sin I/O + una transacción por acción | 5 | S | 2 d | — | 0 |
| T22 | Reloj del draft con Cloud Tasks | 4 | S | 1 d? | T21 | 1 |
| T23 | Rutas de partido (`routes/matches.js`) | 4 | S | 1 d | T19, T21, T25, T26 | 4 |
| T24 | Seed de la demo con el Admin SDK | 3 | S | 1 d | T12, T17, T19, T20, T23, decisión D2 (solo producción) | 5 |
| **Fase 4 · Tiempo real** |||||||
| T25 | Chat: salas, mensajes por la API y avisos del sistema | 4 | S | 4 h | T06, T17 | 3 |
| T26 | Aviso de cambios en `live/{matchId}` (reemplaza `bus.js`) | 3 | S | 2 h | — | 0 |
| T27 | `web/src/live.ts` reemplaza `ws.ts` en `MatchRoom` y `TournamentPage` | 4 | S | 1 d | T09, T25, T26 | 4 |
| T28 | Presencia con Realtime Database | 3 | J | 2 h | T06, T09 | 1 |
| **Fase 5 · Publicación y cierre** |||||||
| T29 | Cabeceras de Hosting y opciones de funciones | 3 | S | 2 h | — | 0 |
| T30 | Deploy automático con GitHub Actions | 3 | S | 4 h | T01, T29 | 1 |
| T31 | Dominio propio | 1 | J | 1 h | T30, decisión D3 | 2 |
| T32 | Prueba completa en emuladores y en producción | 2 | J | 4 h | T14, T22, T24, T27, T28, T30 | 6 |
| T33 | Borrar Render, SQLite y WebSocket; actualizar README | 1 | J | 2 h | T32, decisión D5 | 6 |

Las dependencias con T02, T03, T04 y T05 ya están cumplidas y no figuran en la tabla.

## Olas de ejecución

```
Ola 0  ─ T21 ∥ T06 ∥ T08 ∥ T09 ∥ T26 ∥ T29 ∥ T01 ∥ T07      · 2 d    (T21 marca la ola; T01 y T07 junior)
Ola 1  ─ T11 ∥ T16 ∥ T22 ∥ T15 ∥ T30 ∥ T10 ∥ T12 ∥ T13 ∥ T28 · 1 d    (T12, T13 y T28 junior)
Ola 2  ─ T17 ∥ T18 ∥ T14 ∥ T31                            · 2 d    (T18 marca la ola; T14 y T31 junior)
Ola 3  ─ T19 ∥ T20 ∥ T25                                  · 4 h
Ola 4  ─ T23 ∥ T27                                        · 1 d
Ola 5  ─ T24                                              · 1 d
Ola 6  ─ T32  →  T33                                      · 6 h
```

- **Camino crítico:** T08 → T16 → T18 → T19 → T23 → T24 → T32 → T33 = 44 h (unos 7 días).
- **Equipo mínimo:** 2 seniors y 1 junior. Las olas 0 y 1 tienen mucho trabajo senior en paralelo
  (30 h y 28 h): con dos seniors se estiran a unos 3 d y 2,5 d; un tercer senior las deja en 2 d y
  1 d. Desde la ola 2 alcanzan dos (T17 ∥ T18) y lo demás está atado al camino crítico. El junior
  tiene 18 h en total: no hace falta más de uno.
- **Una sola persona:** seguir las olas en orden y, dentro de cada ola, el orden de la tabla.
- **Duración total:** unos 9 días si cada ola se hace en paralelo completo (52 h sumando las olas),
  unos 11 con dos seniors, y unos 21 días con una sola persona (124 h, la suma de la columna Tiempo).

## Detalle de cada tarea

### Fase 0 · Base del proyecto

### T01 · Proyecto en la consola de Firebase — dif. 1 · junior · 1 h

- [ ] Crear el proyecto en console.firebase.google.com, pasarlo a Blaze y crear una alerta de
      presupuesto (por ejemplo USD 5) en Google Cloud Billing. La alerta avisa, no corta el gasto.
- [ ] Crear Firestore (modo producción) en `southamerica-east1` (D1). La ubicación de Firestore no se
      puede cambiar después.
- [ ] Crear Realtime Database en `us-central1`: RTDB no está disponible en São Paulo. Solo guarda la
      presencia (T28), así que la distancia no pesa.
- [ ] Authentication: habilitar Google. Email y contraseña queda apagado en producción (el login de
      prueba es solo del emulador, T12).
- [ ] Habilitar en Google Cloud las APIs de Cloud Tasks y Secret Manager. Anotar el id del proyecto
      en `.firebaserc` como alias `prod`.

### Fase 1 · Datos y seguridad

### T06 · Reglas de seguridad — dif. 5 · senior · 1 d

- [ ] `firestore.rules`: denegar todo por defecto; leer `live/{id}` lo puede cualquiera y
      `rooms/{room}/messages` según el doc de la sala (`public_read` o `request.auth.uid in readers`).
      Ninguna escritura desde el cliente: escribe la API.
- [ ] La sala de equipo solo la leen sus miembros y el staff del torneo (hoy `puedeAcceder` en
      `realtime.js`); la de partido y la general son públicas para leer.
- [ ] `database.rules.json`: cada usuario escribe solo `presence/{room}/{su uid}`; leer presencia es
      público.
- [ ] Pruebas con `@firebase/rules-unit-testing` contra el emulador: anónimo, miembro, rival y staff.
- [ ] Frontera: quién entra en `readers` lo mantienen T17 y T25; esta tarea solo lo lee.

### T07 · Ids de texto en el frontend — dif. 2 · junior · 4 h

- [ ] `web/src/types.ts`: los ids de usuarios, torneos, equipos, inscripciones, partidos, etapas,
      grupos, drafts y mensajes pasan de `number` a `string` (hay unos 44 campos `id` / `*_id`). Los
      de civ y mapa siguen siendo `number`.
- [ ] Buscar `Number(` y `parseInt(` sobre ids en `web/src` (parámetros de ruta, selects) y sacarlos.
- [ ] Revisar comparaciones `===` entre ids que mezclen número y texto.
- [ ] `TournamentPage.tsx`: el `PATCH .../registrations/${r.id}` pasa a mandar `r.user_id` (la
      inscripción ya no tiene id propio).
- [ ] Listo cuando `npm run build` compila sin errores de tipos.

### Fase 2 · Autenticación

### T08 · Sesión con Firebase Auth en la API — dif. 5 · senior · 4 h

- [ ] Nuevo `attachUser` en `functions/src/auth.js`: lee `Authorization: Bearer <idToken>`, lo
      valida con `getAuth().verifyIdToken()` y deja en `req.user` el doc `users/{uid}`. Reemplaza la
      cookie `aoem_session` y la tabla `sessions`. Nada de cookies: Hosting solo reenvía `__session`
      a las funciones.
- [ ] Primer ingreso: si no existe `users/{uid}`, crearlo con nombre, foto y email del token, como
      hoy hace `entrarCon` al insertar.
- [ ] `GET /api/auth/me` y `PATCH /api/auth/me` sobre el doc. `publicUser` igual que hoy.
- [ ] `requireAuth` no cambia. Se borran `/login`, `/logout`, `createSession`, `hashPassword` y
      `checkPassword`, y las dependencias `bcryptjs` y `cookie-parser` de `functions/package.json`
      (T02 las dejó porque el código todavía las usaba). `is_admin` sigue siendo un campo del doc.

### T09 · Cliente de Firebase en la web — dif. 3 · senior · 4 h

- [ ] `web/src/firebase.ts`: `initializeApp` con la config de `import.meta.env`; en dev,
      `connectAuthEmulator`, `connectFirestoreEmulator` y `connectDatabaseEmulator`.
- [ ] `web/src/auth.tsx`: `onIdTokenChanged` para saber quién está y después `GET /api/auth/me`
      para el perfil. `logout` pasa a ser `signOut`.
- [ ] `web/src/api.ts`: agrega `Authorization: Bearer ${await auth.currentUser?.getIdToken()}` y se
      va `credentials: 'include'`.
- [ ] Frontera: la validación del token en el servidor es T08. Esta tarea se da por probada contra
      `/api/auth/me` cuando T08 esté.

### T10 · Google con Firebase Auth — dif. 3 · senior · 2 h

- [ ] `Login.tsx`: el botón de Google llama a `signInWithPopup(auth, new GoogleAuthProvider())` en
      vez de navegar a `/api/auth/google`.
- [ ] `Profile.tsx`: vincular usa `linkWithPopup`. Si esa cuenta de Google ya está en otro usuario
      llega `auth/credential-already-in-use`: mostrar lo mismo que hoy con `?google=ocupado`.
- [ ] `POST /api/auth/google/unlink` queda en el servidor y usa
      `getAuth().updateUser(uid, { providersToUnlink: ['google.com'] })`, con la regla de hoy (no
      soltar el único acceso).
- [ ] Borrar `/api/auth/google` y `/google/return` de `routes/auth.js` y las variables
      `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Firebase usa su propio cliente OAuth; el que se
      configuró para Render deja de usarse.

### T11 · Steam con token propio — dif. 5 · senior · 1 d

- [ ] `POST /api/auth/steam/start` guarda `authStates/{nonce}` con
      `{ uid | null, link, expiresAt: +10 min }` y devuelve la URL de Steam con
      `return_to = /api/auth/steam/return?state=<nonce>`. Hace falta porque la vuelta de Steam es una
      redirección del navegador y no trae el token.
- [ ] `GET /api/auth/steam/return`: reusar la verificación de hoy (`check_authentication`,
      `is_valid:true`, id de 17 dígitos) y `perfilSteam`. El uid sale de `steamIds/{id64}`; si es
      nuevo, `getAuth().createUser()`; si es vincular, va al uid del estado, con el caso "ocupado".
- [ ] Emitir `getAuth().createCustomToken(uid)` y redirigir a `/entrar#token=...` (en el hash no
      llega a ningún servidor). La web hace `signInWithCustomToken` y limpia el hash.
- [ ] En producción la cuenta de servicio de las funciones necesita el rol *Service Account Token
      Creator* para firmar el token; en el emulador no hace falta.
- [ ] `POST /api/auth/steam/unlink`: borra `steamIds/{id64}` y los campos `steam_*`, con la regla de
      hoy.
- [ ] Política TTL de Firestore sobre `authStates.expiresAt` para que los estados viejos se borren
      solos.

### T12 · Login de prueba solo en el emulador — dif. 2 · junior · 1 h

- [ ] `Login.tsx`: el formulario de email y contraseña usa `signInWithEmailAndPassword` y solo se
      muestra con `import.meta.env.DEV`.
- [ ] `/api/auth/providers` devuelve `dev_login: true` solo si `FUNCTIONS_EMULATOR === 'true'`.
- [ ] Las cuentas `@demo.aoematch` con `demo1234` las crea el seed (T24) en el emulador de Auth.
- [ ] En producción el proveedor de email y contraseña queda apagado (T01).

### T13 · Buscador de usuarios — dif. 2 · junior · 1 h

- [ ] Antes hay que cerrar la decisión D4.
- [ ] `GET /api/auth/users?q=`: si D4 es "empieza con", consultar `display_name_lower >= q` y
      `< q + '\uf8ff'` con `limit(20)`. Hoy es `LIKE '%q%'` sobre `display_name` y `steam_name`.
- [ ] `display_name_lower` se escribe en el alta (T08) y en `PATCH /api/auth/me`.
- [ ] Misma respuesta que hoy (`avatar_url` cae en `steam_avatar` si falta).

### T14 · Pantallas de ingreso y perfil — dif. 2 · junior · 2 h

- [ ] `Login.tsx` y `Profile.tsx`: los enlaces `href="/api/auth/steam"` y `?link=1` pasan a botones
      que llaman a `POST /api/auth/steam/start` y navegan a la URL que devuelve.
- [ ] Mensajes para popup cerrado (`auth/popup-closed-by-user`: sin error visible), cuenta ocupada y
      error de Steam (`/entrar?steam=error` sigue existiendo).
- [ ] Estado de carga mientras vuelve de Steam y corre `signInWithCustomToken`.
- [ ] Probar en el emulador: entrar, vincular y desvincular con los dos proveedores.

### Fase 3 · API sobre Firestore

### T15 · Horarios y cruce — dif. 3 · senior · 4 h

- [ ] `routes/catalog.js`: `GET /availability/:userId`, `PUT /availability`, alta y baja de
      excepciones y `GET /overlap` sobre `users/{uid}.availability` y `.exceptions`. Cada excepción
      lleva un `id` propio para poder borrarla.
- [ ] `availability.js`: `mascaraUsuario` y `mascaras` reciben los docs ya leídos (un `getAll` para
      todos) en vez de consultar usuario por usuario. `ventanas`, `minutosEnComun` y `proximaFecha` no
      cambian.
- [ ] Mismas validaciones de hoy: minutos entre 0 y 10080, fecha `YYYY-MM-DD`.
- [ ] Frontera: el armador (T20) y el detalle de equipos (T16, T17) llaman a estas funciones; acá
      solo cambia de dónde salen los bloques.

### T16 · Torneos — dif. 4 · senior · 1 d

- [ ] `routes/tournaments.js`: listado, alta (el slug de `slugify` + `slugLibre` es el id del doc),
      detalle, edición y borrado sobre `data/torneos.js`.
- [ ] `detalle()` lee en paralelo el torneo, sus `teams`, `registrations`, `stages` y `matches`, y los
      usuarios con un `getAll`. El JSON de salida no cambia: lo consume `TournamentPage.tsx`.
- [ ] El listado usa los contadores `inscriptos`, `pagos` y `equipos` del doc en vez de los
      `COUNT(*)`; `premiosDe` usa `pagos`.
- [ ] Borrar un torneo: `recursiveDelete` del doc más los `teams`, `matches`, `rooms` y `live` con ese
      `tournament_id`. Firestore no borra en cascada.
- [ ] `setPool` y `setPremios` pasan a escribir arrays en el doc del torneo.

### T17 · Inscripciones y equipos — dif. 4 · senior · 1 d

- [ ] `register`, `withdraw`, `PATCH registrations/:regId` (`:regId` pasa a ser el uid del inscripto),
      `POST` y `PATCH teams`, y alta y baja de miembros, cada una en una transacción.
- [ ] En la misma transacción: contadores del torneo con `FieldValue.increment` y `readers` de la sala
      del equipo (`rooms/equipo_{id}`) cuando alguien entra o sale.
- [ ] Mismas reglas de hoy: cupo por equipo, `allow_solo`, solo capitán u organizador, el equipo se
      borra si queda vacío.
- [ ] `equipoCompleto` sigue calculando `overlap_min` con las funciones de T15.

### T18 · Generación de llaves — dif. 4 · senior · 2 d

- [ ] `brackets.js`: eliminación simple y doble, liga, grupos + playoff, suizo y tercer puesto,
      escribiendo en `matches` y `stages`.
- [ ] `next_match_id` y `loser_match_id` necesitan los ids antes de escribir: generarlos con
      `collection('matches').doc()` y escribir todo en un batch (máximo 500 escrituras; 64 equipos en
      doble eliminación quedan lejos).
- [ ] `ordenSiembra`, `nombreRonda` y la siembra 1-8, 4-5, 2-7, 3-6 no cambian; `limpiar()` borra
      los partidos previos del torneo en un batch aparte y `resolverBye` va dentro del batch que crea.
- [ ] `crearMatch` deja de crear la sala de chat del partido: la crea T25 cuando hace falta.
- [ ] Prueba: generar cada formato en el emulador y comparar con la versión SQLite (mismos cruces y
      mismos enlaces).

### T19 · Cierre de partido y tablas — dif. 5 · senior · 4 h

- [ ] `cerrarMatch` en una transacción: cierra el partido y pasa el ganador (y el perdedor, en doble
      eliminación) al slot de `next_match_id` / `loser_match_id`. Dos reportes al mismo tiempo no
      pueden pisarse.
- [ ] `tablaGrupo` y `tablaDesde` trabajan sobre los partidos ya leídos.
- [ ] `siguienteRondaSuiza` y `generarPlayoffs` como transacción o batch.
- [ ] Frontera: quién llama a `cerrarMatch` al reportar resultados es T23.

### T20 · Armador de equipos — dif. 3 · senior · 4 h

- [ ] `teambuilder.js`: `proponerEquipos` lee las inscripciones sueltas y los usuarios con un
      `getAll`. El algoritmo (serpiente + 4000 intercambios) no cambia.
- [ ] `confirmarEquipos` en un batch: crea equipos y miembros, sus salas con `readers`, y actualiza
      inscripciones y contadores.
- [ ] Mismos errores de hoy (torneo 1v1, sin sueltos suficientes).

### T21 · Motor de draft — dif. 5 · senior · 2 d

- [ ] Partir `draft.js` en `draft-core.js` sin I/O (recibe torneo, partido, equipos y draft, y devuelve
      el draft nuevo) y `draft.js`, que lee, llama al núcleo y escribe.
- [ ] Pasan sin cambios: `construirPasos`, `parsePatron`, `patronPorDefecto`, `civsBloqueadas`,
      `jugadorDelSlot`, `elegirAutomatico` y `validarObjetivo`. `civsUsadasPorEquipo` lee de
      `match.games[]`.
- [ ] `aplicarAccion`, `marcarListo` y `porTimeout` como una sola transacción: leer draft, partido,
      torneo y equipos, calcular (incluida la cadena de `resolverAutomaticos`) y escribir una vez. Hoy
      se lee y escribe intercalado, y Firestore no lo permite.
- [ ] `finalizar` escribe `games[game_no]` con sus civs en el doc del partido, dentro de la misma
      transacción. `estadoDraft` sigue ocultando los picks ciegos del rival según `viewerTeamId`.
- [ ] Pruebas con `node:test` sobre el núcleo: snake 2v2, ciega, `ban_pick` con contrapick, mapa
      fijo en la partida 1 y timeout en cada tipo de paso.

### T22 · Reloj del draft — dif. 4 · senior · 1 d?

- [ ] Función `vencerPaso` con `onTaskDispatched`. Cada vez que cambia `deadline_at`, encolar
      `{ matchId, gameNo, step, deadline }` con `scheduleTime = deadline`, después del commit (una
      transacción se puede reintentar).
- [ ] Al dispararse: si el draft sigue `en_curso`, en el mismo `current_step` y con el mismo
      `deadline`, llama a `porTimeout` (T21); si no, no hace nada. Las tareas viejas o repetidas
      quedan sin efecto.
- [ ] Respaldo: `GET /api/matches/:id` y las acciones del draft resuelven los pasos vencidos antes de
      responder, por si una tarea se pierde.
- [ ] Reemplaza `iniciarRelojes()`, que revisaba cada 1 s. La precisión pasa a ser de unos segundos.
- [ ] Duda (de ahí el `?`): hasta dónde llega el emulador de Cloud Tasks. Si no alcanza, probar el
      respaldo en local y la cola en producción.

### T23 · Rutas de partido — dif. 4 · senior · 1 d

- [ ] `routes/matches.js`: detalle, crear draft, listo, acción, resultado por partida
      (`recalcularSerie`), resultado forzado, horarios y votos.
- [ ] Donde hoy hay `publish(...)` o `emitir()`, avisar en `live/{matchId}` (T26).
- [ ] `avisoSistema` (draft cerrado, serie cerrada, partido agendado) escribe en
      `rooms/partido_{id}/messages` con las funciones de T25.
- [ ] El detalle deja de traer `chat.general` y `chat.team`: el historial lo lee el cliente (T27).
- [ ] Mismos permisos: `puedeReportar`, staff y capitán.

### T24 · Datos de demo — dif. 3 · senior · 1 d

- [ ] Para la parte de producción, antes hay que cerrar la decisión D2.
- [ ] `functions/scripts/seed.js` con el Admin SDK contra los emuladores (`FIRESTORE_EMULATOR_HOST`,
      `FIREBASE_AUTH_EMULATOR_HOST`): 24 usuarios en Auth con `@demo.aoematch` / `demo1234`, sus
      horarios, los tres torneos y la copa mockup con drafts a medio jugar y chat.
- [ ] Reusar las funciones migradas (T17, T19, T20, T21, T23) en vez de escribir documentos a mano,
      como hoy `seed.js` usa `generarLlaves` y `aplicarAccion`.
- [ ] `--reset` vacía los emuladores con sus endpoints REST
      (`DELETE /emulator/v1/projects/{id}/databases/(default)/documents` y `.../accounts`).
- [ ] Contra producción, solo con un flag explícito y si D2 lo pide.

### Fase 4 · Tiempo real

### T25 · Chat en Firestore — dif. 4 · senior · 4 h

- [ ] `POST /api/rooms/:room/messages` con las reglas de `puedeEscribir` de hoy (general: inscriptos
      y staff; partido: jugadores y staff; equipo: miembros y staff), texto recortado a 2000.
- [ ] `salaDeChat` crea `rooms/{kind}_{id}` con `public_read`, `readers` y `tournament_id`.
      `publicarMensaje` y `avisoSistema` escriben en `messages` con `created_at` del servidor y el
      nombre y avatar del autor copiados (el cliente no puede leer `users`).
- [ ] Crear las salas que hoy crean `POST /` (torneo), `register` y `POST teams`; las de partido se
      crean con el primer mensaje o aviso (ya no las crea `crearMatch`). Mantener `readers` al día es
      de T17.
- [ ] Se borran `realtime.js`, `bus.js` y la dependencia `ws`.

### T26 · Aviso de cambios — dif. 3 · senior · 2 h

- [ ] `functions/src/live.js` con `avisar(matchId, tipo)`, que hace
      `set({ [tipo]: FieldValue.increment(1), at: FieldValue.serverTimestamp() }, { merge: true })`
      en `live/{matchId}`. Tipos: `draft`, `match` y `votes`.
- [ ] Reemplaza `publish()` de `bus.js`. El cliente solo se entera de que algo cambió y le vuelve a
      pedir el estado a la API, así los picks ciegos siguen ocultos.
- [ ] Llamarlo siempre después del commit de cada transacción.

### T27 · Tiempo real en la web — dif. 4 · senior · 1 d

- [ ] `web/src/live.ts` reemplaza `ws.ts`: `useChat(room)` con `onSnapshot` sobre
      `rooms/{room}/messages` (`orderBy('created_at', 'desc')`, `limit(80)`) y
      `useLive(matchId, onCambio)` sobre `live/{matchId}`.
- [ ] `MatchRoom.tsx`: un cambio de `draft`, `match` o `votes` vuelve a pedir `GET /api/matches/:id`,
      como hoy hace `cargar()`.
- [ ] `TournamentPage.tsx`: el chat general usa `useChat`; enviar va por `POST /api/rooms/:room/messages`.
- [ ] `conectado` sale de `.info/connected` de RTDB.
- [ ] Sala de equipo sin permiso: mostrar el error en vez de quedar cargando.

### T28 · Presencia — dif. 3 · junior · 2 h

- [ ] `web/src/presence.ts`: al entrar a una sala, escribir `presence/{room}/{uid}` con nombre y
      avatar y registrar `onDisconnect().remove()`; al salir, borrarlo.
- [ ] Hook `usePresencia(room)` que escucha `presence/{room}` y devuelve la misma lista que hoy llega
      en el mensaje `presence`.
- [ ] Los anónimos no escriben presencia (hoy tampoco cuentan).
- [ ] Copiar el patrón de presencia de la documentación de Firebase; las reglas son de T06.

### Fase 5 · Publicación y cierre

### T29 · Cabeceras de Hosting y opciones de funciones — dif. 3 · senior · 2 h

- [ ] `firebase.json` ya tiene `public: web/dist` y los rewrites de `/api/**` y `**` (T02). Falta la
      cabecera `Cache-Control: public, max-age=604800, immutable` para `/assets/**`.
- [ ] `functions/src/index.js` ya fija la región `southamerica-east1` (T02). Sumar
      `maxInstances: 3` a `setGlobalOptions` para poner techo al gasto, y 512 MiB de memoria para
      `api`. La cola de Cloud Tasks de T22 va en la misma región.
- [ ] `STEAM_API_KEY` con `defineSecret` y `PUBLIC_URL` con `defineString`; los lee `origen()` de
      `routes/auth.js`.
- [ ] La config web (`VITE_FIREBASE_*`) va en `web/.env.production`; no es secreta.

### T30 · Deploy automático — dif. 3 · senior · 4 h

- [ ] `.github/workflows/deploy.yml`: en cada push a `master`, Node 22, `npm ci`, `npm run assets`,
      `npm run build` y `firebase deploy --only hosting,functions,firestore,database --project prod`.
- [ ] Autenticación con una cuenta de servicio guardada en el secreto `FIREBASE_SERVICE_ACCOUNT`, con
      los roles que pide `firebase deploy` para Hosting, funciones, reglas y secretos.
- [ ] Si falla la descarga de `npm run assets`, el deploy sigue, como hoy en Render.
- [ ] El primer deploy se hace a mano desde la PC para confirmar permisos y cuotas.

### T31 · Dominio propio — dif. 1 · junior · 1 h

- [ ] Antes hay que cerrar la decisión D3.
- [ ] Hosting → Agregar dominio personalizado; cargar los registros TXT y A en el proveedor del
      dominio. El certificado lo emite Firebase.
- [ ] Authentication → Configuración → Dominios autorizados: agregar el dominio.
- [ ] `PUBLIC_URL = https://DOMINIO` (T29) para que Steam vuelva al dominio.

### T32 · Prueba completa — dif. 2 · junior · 4 h

- [ ] En los emuladores con la demo (T24) y después en producción: entrar con Google y con Steam,
      vincular y desvincular.
- [ ] Crear un torneo 2v2, inscribirse solo y con equipo, correr el armador y generar las llaves.
- [ ] Draft con dos navegadores: bans, picks, modo ciega y un reloj vencido que elige solo (esperar
      sin tocar).
- [ ] Chat de equipo: una cuenta del equipo rival no lo ve. Chat y presencia se actualizan en vivo.
- [ ] Reportar resultados hasta cerrar la serie y ver que el ganador avanza en la llave.
- [ ] Anotar cada falla con los pasos para reproducirla.

### T33 · Limpieza y README — dif. 1 · junior · 2 h

- [ ] Antes hay que cerrar la decisión D5.
- [ ] Borrar `render.yaml`, `Dockerfile`, `schema.sql`, `db.js`, `cargarCatalogo()` (con su llamada en
      `app.js`) y la carpeta `server/` (solo quedó su `node_modules`). Antes, confirmar con
      `grep -rn "from './db.js'\|from '../db.js'" functions/src` que no quede SQL. Revisar el `engines` de la raíz (`>=23.4.0` era por `node:sqlite`).
- [ ] `README.md`: rehacer Arrancar (emuladores y Java), la tabla de variables, Ingreso con Google,
      Publicarlo y Cómo está armado.
- [ ] Dar de baja el servicio en Render si D5 lo indica.

## Decisiones abiertas

| ID | Decisión | Opciones | Bloquea |
|---|---|---|---|
| D1 | Región de Firestore, funciones y Cloud Tasks | **Cerrada: `southamerica-east1` (São Paulo).** Realtime Database va en `us-central1` porque no existe en São Paulo. | — |
| D2 | ¿Demo en producción? | Sembrar la demo para mostrar la página, o arrancar vacío para torneos reales. | T24 (parte de producción) |
| D3 | Dominio | Cuál comprar y en qué registrador. | T31 |
| D4 | Buscador de usuarios | Firestore no busca "contiene". "Empieza con" (consulta por prefijo), o traer todos los usuarios a la función y filtrar (sirve mientras sean unos pocos miles). | T13 |
| D5 | Render al terminar | Darlo de baja, o dejarlo un tiempo como respaldo. | T33 |
