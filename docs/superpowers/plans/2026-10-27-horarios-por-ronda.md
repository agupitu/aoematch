# Plan: horarios por ronda

> Para agentes: ejecutar con superpowers:subagent-driven-development (recomendado si se elige revisión por tarea) o superpowers:executing-plans, tarea por tarea. Los pasos usan checkboxes `- [ ]`.

**Objetivo.** Que cada jugador cargue sus horarios en el torneo, por ronda y dentro del rango de fechas que fija el organizador, en vez de una semana fija en el perfil. "Buscar horario" cruza los horarios de la ronda del partido. Si el equipo pasa de ronda, el jugador carga de nuevo.

**Diseño.** [`docs/superpowers/specs/2026-10-27-horarios-por-ronda-design.md`](../specs/2026-10-27-horarios-por-ronda-design.md), aprobado el 2026-10-27, y la maqueta [`…-mockup.html`](../specs/2026-10-27-horarios-por-ronda-mockup.html). Este plan no lo repite: lo baja a archivos, firmas y pruebas. Cada tarea se lee junto con el diseño.

**Arquitectura.** Tres módulos de lógica pura en `web/src/logica/` (`rondas.js`, `calendario.js`, `cruce.js`), que comparten la web, la demo y las pruebas. Dos subcolecciones nuevas con sus reglas: `tournaments/{slug}/rondas/{rondaId}` (fechas de la ronda, las escribe el staff) y `.../horarios/{uid}` (franjas, las escribe cada jugador). Un componente de calendario (`CalendarioRonda.tsx`) y tres pantallas que lo usan: el editor de fechas del staff (pestaña Llaves), "Mis horarios" (pestaña Horarios) y "Buscar horario" (sala del partido). El perfil y el armador de equipos dejan de usar horarios.

**Estado.** 15 tareas pendientes (T48 a T62, sigue la numeración de `PLAN.md`), 56 h en total: unos 9 días de 6 h para una persona sola. Nada hecho todavía.

## Restricciones globales

- Plan Spark: sin servidor. La web escribe directo en Firestore y `firestore.rules` es la única barrera.
- Fechas como texto ISO 8601 en UTC.
- Las reglas no tienen bucles: los topes van por `size()` y por claves (`blocks.size() <= 800`).
- Un documento no pasa de 1 MiB.
- Cambio de horario de verano dentro del rango: los límites de cada día se calculan con la zona para esa fecha, nunca con `offsetZona()` de `web/src/lib.ts` (mide el desfase de hoy).
- Regenerar llaves borra también `rondas` y `horarios`.
- Dónde va cada cosa: lógica pura en `web/src/logica/*.js`; datos de la web en `web/src/datos/*.ts`; Admin SDK en `functions/src/data/*.js`.
- Textos en castellano con voseo; estilos con los tokens del tema (`ink-*`, `gold-*`, `parch-*`). TypeScript estricto con `noUnusedLocals`: un import sin uso rompe `npm run build`.
- Comandos: lógica pura `npm --prefix web test`; reglas, datos y demo `npm test` (raíz, con emuladores); compilación `npm run build`.
- Un commit por tarea, con prefijo `feat:`, `fix:`, `refactor:`, `test:` o `docs:` y mensaje en castellano como el historial, y solo cuando el usuario lo autorice.

## Foco de revisión

Entradas que el diseño implica y ninguna tarea probaría sola; cada una tiene su prueba en la tarea que dice.

1. Cambio de horario de verano dentro del rango (Nueva York 2026-11-01 y 2026-03-08, Madrid 2026-10-25 y 2026-03-29, Santiago 2026-09-06): sin barras repetidas ni corridas; la hora que no existe queda apagada. → T49.
2. Zona con desfase de 45 minutos (Katmandú): ningún bloque desaparece por no caer en la grilla de 30 minutos. → T49 y T50.
3. El staff acorta el rango con horarios ya cargados: lo de afuera se ignora, no rompe. → T49 (`seleccionDeBloques`) y T50 (`recortarBloques`).
4. Tercer puesto, doble eliminación y grupos: una ronda por cuadro y número; el tercer puesto comparte ronda con la final. → T48.
5. Partido con rival por definir, ronda sin fechas, jugador sin horarios: avisos y "falta uno", nunca un error en pantalla. → T50 (`missing`), T57 y T62.

## Lo que ya está y se reutiliza

| Qué | Dónde |
|---|---|
| `terminado(m)`, `generarCuadro`, `cerrarPartido`; los partidos traen `stage_id`, `bracket`, `round` y `label` | `web/src/logica/llaves.js` |
| Ventanas "todos / falta uno" sobre la semana (se reescribe por ronda, mismo criterio) | `web/src/logica/horarios.js` |
| Modal "Buscar horario" y fecha a mano con `datetime-local` | `web/src/pages/MatchRoom.tsx` (`Agendar`) |
| Calendario de partidos del torneo (no cambia) | `web/src/components/MatchCalendar.tsx` |
| `esStaff(slug)`, `inscriptoVigente(slug)` | `firestore.rules` |
| Patrón de pruebas de reglas con emulador | `functions/test/reglas-partidos.test.js` |
| Capa de datos con Admin SDK (`escritor(w)`, `leer`, `consultar`, `ahora`) | `functions/src/data/base.js`, `torneos.js` |
| `borrarLlaves` (partidos, drafts, votos, salas, etapas) | `web/src/datos/llaves.ts` |
| `borrarTorneo` con `recursiveDelete`: ya se lleva las subcolecciones nuevas | `functions/src/data/torneos.js` |
| Tokens `ink-*`, `gold-*`, `parch-*` y clases `card`, `field`, `btn` | `web/src/index.css` |

## Tareas

Dificultad 1 (trivial) a 5 (arquitectura / riesgo alto). Rol: **J** = junior con revisión de senior; **S** = senior. Tiempo: horas efectivas del rol asignado, con prueba y revisión incluidas.

| ID | Tarea | Dif. | Rol | Tiempo | Depende de | Ola |
|---|---|---|---|---|---|---|
| **Fase 6 · Lógica pura, reglas y datos** |||||||
| T48 | `web/src/logica/rondas.js`: rondas del cuadro, ids, estado y "mis rondas" | 3 | J | 4 h | — | 0 |
| T49 | `web/src/logica/calendario.js`: días y barras por zona (con horario de verano), selección y rectángulo | 4 | S | 1 d | — | 0 |
| T50 | `web/src/logica/cruce.js`: recorte de bloques y ventanas por ronda | 3 | J | 4 h | — | 0 |
| T51 | `firestore.rules`: `rondas` y `horarios`, con sus pruebas | 5 | S | 1 d | decisión D1 | 0 |
| T52 | `functions/src/data/rondas.js`: capa de datos con Admin SDK | 2 | J | 2 h | — | 0 |
| T53 | `web/src/datos/rondas.ts`, tipos y borrado en `borrarLlaves` | 3 | S | 4 h | T48, T49, T51, decisión D1 | 1 |
| **Fase 7 · Pantallas** |||||||
| T54 | `web/src/components/CalendarioRonda.tsx`: el calendario de la maqueta | 4 | S | 1 d | T49 | 1 |
| T55 | `FechasDeRonda.tsx`: editor del staff en la pestaña Llaves | 3 | J | 4 h | T48, T49, T53 | 2 |
| T56 | `MisHorarios.tsx` y pestaña Horarios nueva | 3 | J | 4 h | T48, T49, T53, T54, T55 | 2 |
| T57 | "Buscar horario" por ronda en la sala del partido | 3 | J | 4 h | T48, T50, T53 | 2 |
| T58 | Perfil sin horarios: pantalla, datos y reglas de `users` | 2 | S | 2 h | T51, decisión D1 | 1 |
| T59 | Armador y tarjeta de equipo sin horarios | 2 | J | 2 h | decisión D1 | 0 |
| **Fase 8 · Demo, limpieza y prueba** |||||||
| T60 | Demo: fechas de ronda y horarios para la copa de muestra | 3 | J | 2 h | T48, T49, T52 | 1 |
| T61 | Borrar lo viejo y actualizar `docs/firestore-modelo.md` y `README.md` | 2 | J | 2 h | T55, T56, T57, T58, T59, decisión D1 | 3 |
| T62 | Prueba completa en emuladores y en el navegador | 2 | J | 4 h | T60, T61 | 4 |

## Olas de ejecución

```
Ola 0  ─ T48 ∥ T49 ∥ T50 ∥ T51 ∥ T52 ∥ T59      · 1 d   (T49 y T51 seniors; el resto juniors; T51 y T59 esperan a D1)
Ola 1  ─ T53 ∥ T54 ∥ T58 ∥ T60                  · 1 d   (T53, T54 y T58 seniors; el largo es T54)
Ola 2  ─ T55 → T56  ∥  T57                       · 8 h   (T55 y T56 comparten TournamentPage.tsx; T57 va en paralelo)
Ola 3  ─ T61                                     · 2 h
Ola 4  ─ T62                                     · 4 h
```

- **Camino crítico:** T49 → T53 → T55 → T56 → T61 → T62 = 6 + 4 + 4 + 4 + 2 + 4 = 24 h. T51 (1 d) → T53 da el mismo largo.
- **Equipo mínimo:** 2 personas, 1 senior y 1 junior. Las tareas S suman 24 h y las J 32 h. La Ola 0 abre seis ramas, pero desde la Ola 2 todo pasa por `TournamentPage.tsx` y queda una sola fila: un tercero no la acorta. Con esa pareja, unas 34 h. Con una sola persona, seguir el orden de la tabla (T48 a T62): todas las dependencias apuntan a IDs menores.
- **Duración total:** 26 h con paralelismo total (suma de las olas) y 56 h con una sola persona (suma de la columna Tiempo).

## Detalle de cada tarea

### Fase 6 · Lógica pura, reglas y datos

### T48 · `rondas.js` — dif. 3 · junior · 4 h

- [ ] `web/src/logica/rondas.js`, sin más dependencias que `terminado` de `./llaves.js` y `ordenarPor` de `./orden.js`: `rondaIdDe(m) → \`${m.stage_id}_${m.bracket}${m.round}\``; `rondasDelCuadro(partidos, etapas) → Ronda[]` con `Ronda = { id, stage_id, bracket, round, label, partidos }`, donde `label` es el del primer partido por `position` (o `Ronda ${round}`) y el orden es `idx` de la etapa, después W, L, F, después `round`.
- [ ] `estadoDeRonda(ronda, docRonda) → 'sin_fechas' | 'abierta' | 'jugada'`: `jugada` si todos sus partidos están `terminado`; si no, `abierta` cuando hay `docRonda` y `sin_fechas` cuando no.
- [ ] `misRondas(partidos, etapas, equipoId) → Ronda[]`: las rondas donde ese equipo tiene un partido sin cerrar (como `team_a_id` o `team_b_id`); sin equipo, `[]`.
- [ ] Pruebas en `web/test/rondas.test.js`, armando cuadros con `generarCuadro` e ids repetibles como `web/test/llaves.test.js`: (1) 8 equipos de eliminación simple → `[['Cuartos', 4], ['Semifinal', 2], ['Final', 1]]`, con ids `<etapa>_W1`, `_W2`, `_W3`; (2) con `third_place: 1` la ronda Final tiene 2 partidos y un solo id; (3) doble eliminación: los ids de W2 y L2 son distintos y el orden va W, L, F; (4) grupos + playoff: `Fecha 1` junta los partidos de los dos grupos y los playoffs (`cuadroDePlayoffs`) vienen después por `idx`; (5) `estadoDeRonda` en sus tres casos; (6) `misRondas` de un equipo que ganó cuartos (con `cerrarPartido`) devuelve solo Semifinal, y la de uno eliminado, `[]`; (7) con 6 equipos, el que pasa por *bye* no lista la primera ronda.
- [ ] Verificación: `npm --prefix web test` pasa, con las pruebas nuevas.

### T49 · `calendario.js` — dif. 4 · senior · 1 d

- [ ] `web/src/logica/calendario.js`, JS puro que no importa `lib.ts` (lo usa también Node): `MIN_BARRA = 30`, `BARRAS_POR_DIA = 48` y `ajustarAGrilla(ms)` (hacia abajo, a múltiplos de 30 min en UTC).
- [ ] `instanteLocal(dia, minutos, zona) → ms | null`: instante UTC de esa hora local; `null` si la hora no existe (salto de verano); si se repite, el primero. Enfoque: candidatos con los desfases de la zona 24 h antes y 24 h después, quedarse con los que vuelven a dar esa hora local y tomar el menor. Un solo `Intl.DateTimeFormat` por zona (cache): 31 días son 1 488 llamadas. El resultado pasa por `ajustarAGrilla`.
- [ ] `rangoDeDias(desdeDia, hastaDia, zona) → { starts_at, ends_at }` (ISO UTC; `ends_at` es el inicio del día siguiente a `hastaDia`, excluyente; si la medianoche no existe, la primera hora local que existe) y `cantidadDeDias(desdeDia, hastaDia) → number`.
- [ ] `diasDelCalendario(starts_at, ends_at, zona) → Dia[]` con `Dia = { dia: 'YYYY-MM-DD', barras: { ms: number | null, hora: 'HH:MM', dentro: boolean }[48] }`: un elemento por día local que toca el rango (avanzando por fecha de calendario, no sumando 24 h); `dentro` = la barra existe y cae entera en `[starts_at, ends_at)`. Además `bloquesDeSeleccion(dias, sel) → Bloque[]` con `Bloque = { starts_at: ISO, ends_at: ISO }` (fusiona barras consecutivas, también entre días), `seleccionDeBloques(dias, bloques) → boolean[][]` (ignora lo que cae fuera del rango) y `rectangulo(base, dias, ancla, actual, modo) → boolean[][]` (`ancla` y `actual` son `{ d, i }`; solo toca barras `dentro`; no muta `base`).
- [ ] Pruebas en `web/test/calendario.test.js`: Buenos Aires `rangoDeDias('2026-11-14', '2026-11-16')` → `2026-11-14T03:00:00.000Z` a `2026-11-17T03:00:00.000Z`; `cantidadDeDias('2026-11-14', '2026-11-27') === 14`; Santiago `rangoDeDias('2026-09-06', '2026-09-06').starts_at === '2026-09-06T04:00:00.000Z'` (la medianoche no existe; confirmarlo contra `Intl`); Nueva York `instanteLocal('2026-11-01', 90)` → `Date.UTC(2026, 10, 1, 5, 30)` (se repite: el primero) y `instanteLocal('2026-03-08', 150)` → `null`; Madrid `instanteLocal('2026-10-25', 150)` → `Date.UTC(2026, 9, 25, 0, 30)` y `('2026-03-29', 150)` → `null`; en Katmandú toda barra con `ms` cae en múltiplo de 30 min UTC.
- [ ] Más pruebas: `bloquesDeSeleccion` fusiona la última barra de un día con la primera del siguiente; `seleccionDeBloques` ignora un bloque anterior a `starts_at`; `rectangulo` de `{ d: 0, i: 40 }` a `{ d: 2, i: 45 }` con `modo` true marca 3 × 6 barras y con `modo` false las borra. `npm --prefix web test` pasa.

### T50 · `cruce.js` — dif. 3 · junior · 4 h

- [ ] `web/src/logica/cruce.js`: `recortarBloques(bloques, starts_at, ends_at) → Bloque[]` con `Bloque = { starts_at: ISO, ends_at: ISO }`: recorta al rango, alinea a la grilla de 30 min en UTC (inicio hacia arriba, fin hacia abajo), ordena, fusiona y descarta lo vacío.
- [ ] `cruceDeRonda(jugadores, rango, { duracionMin = 90, ahora = new Date(), limite = 20 } = {}) → { windows, partial }`, con `jugadores: { id, blocks }[]`, `rango: { starts_at, ends_at }` y `Ventana = { starts_at, ends_at, count, missing: string[] }`. Mismo criterio que `ventanas()` de `horarios.js`: `windows` son tramos de al menos `duracionMin` donde pueden todos, fusionando los contiguos con la misma gente; `partial` (todos menos uno) solo si `windows` está vacío; menos de 2 jugadores, ambos vacíos.
- [ ] Lo anterior a `ahora` se corta en la próxima barra y los tramos que quedan más cortos que `duracionMin` se tiran. Orden: más gente primero, después más largas, después más temprano.
- [ ] Pruebas en `web/test/cruce.test.js`: (1) dos jugadores con 20:00–23:00 y 21:00–24:00 UTC del 2026-11-14 → una ventana 21:00–23:00Z, `count: 2`, `missing: []`; (2) tres jugadores donde solo dos coinciden → `windows: []` y `partial[0].missing` es el tercero; (3) un jugador sin bloques cuenta como que no puede, y con un solo jugador el resultado es `{ windows: [], partial: [] }`; (4) `recortarBloques` corta en `starts_at` un bloque que empieza antes del rango y devuelve `[]` para 12:15–12:45Z; (5) `ahora` a mitad de una ventana de 3 h deja el resto si alcanza y nada si no; (6) orden entre tres ventanas de distinto `count` y largo.
- [ ] Verificación: `npm --prefix web test` pasa.

### T51 · Reglas de `rondas` y `horarios` — dif. 5 · senior · 1 d

- [ ] Antes hay que cerrar la decisión D1 (`firestore.rules` tiene cambios sin commitear).
- [ ] En `firestore.rules`, dentro de `match /tournaments/{slug}`: `function rutaRonda(rondaId)` y `match /rondas/{rondaId}`: lectura pública; crear y editar solo `esStaff(slug)` con `rondaValida(d)` (claves `stage_id`, `bracket`, `round`, `label`, `from_day`, `to_day`, `zone`, `starts_at`, `ends_at`, `updated_at` con `hasOnly`; `bracket in ['W', 'L', 'F']`; `round` entero ≥ 1; textos con tope; `starts_at < ends_at`); borrar solo el staff.
- [ ] Dentro de esa ronda, `match /horarios/{userId}`: lectura pública; crear y editar si `yo() == userId`, `inscriptoVigente(slug)`, `exists(rutaRonda(rondaId))` y `horarioValido(d)` (`hasOnly(['user_id', 'blocks', 'updated_at'])`, `user_id == userId`, `blocks is list` y `blocks.size() <= 800`); borrar el dueño o el staff.
- [ ] Pruebas en `functions/test/reglas-rondas.test.js` con el patrón de `reglas-partidos.test.js` (torneo `copa`, organizador `org`, admin `adm`, inscripto vigente `a1`, retirado `ret`, ajeno `x`): un anónimo lee rondas y horarios; el staff crea y edita una ronda y `a1` no; `a1` escribe su horario y no el de otro; falla si la ronda no existe, si está retirado, si no está inscripto, con una clave de más y con 801 bloques; acepta 800; el dueño y el staff borran y un ajeno no.
- [ ] Verificación: `npm test` desde la raíz; pasan las pruebas nuevas y las que había.

### T52 · Capa de datos con Admin SDK — dif. 2 · junior · 2 h

- [ ] `functions/src/data/rondas.js`, siguiendo `torneos.js` y `base.js` (`escritor(w)`, `leer`, `consultar`, `ahora`): `refRonda(slug, rondaId)`, `guardarRonda(slug, rondaId, datos, w)` (agrega `updated_at`), `leerRonda(slug, rondaId, tx)`, `listarRondas(slug, tx)`, `guardarHorario(slug, rondaId, uid, blocks, w)` (guarda `{ user_id, blocks, updated_at }`) y `leerHorarios(slug, rondaId, uids, tx) → Map uid → blocks` (`[]` si no cargó).
- [ ] Pruebas en `functions/test/data.test.js`, `describe('rondas y horarios')`: guardar y leer una ronda; `listarRondas` devuelve las dos guardadas; `leerHorarios(['u1', 'u2', 'u3'])` con `u3` sin documento da `[]` para `u3`; `borrarTorneo` se lleva rondas y horarios (`recursiveDelete` ya lo hace: la prueba lo fija).
- [ ] La usan T60 y las pruebas; la web no la importa (tiene su propio módulo, T53).

### T53 · Datos de la web — dif. 3 · senior · 4 h

- [ ] Antes hay que cerrar la decisión D1 (toca `web/src/types.ts`).
- [ ] `web/src/types.ts`: agregar `Bloque`, `Dia`, `RondaDoc` (`{ id, stage_id, bracket, round, label, from_day, to_day, zone, starts_at, ends_at }`), `Ronda` y `Ventana` con las formas de T48, T49 y T50. `Window` se queda hasta T61.
- [ ] `web/src/datos/rondas.ts`: `listarRondas(slug) → Map<string, RondaDoc>`; `guardarFechasDeRonda(slug, ronda, desdeDia, hastaDia, zona)` (valida `1 ≤ cantidadDeDias ≤ 31` y `hasta ≥ desde`, arma `starts_at` y `ends_at` con `rangoDeDias`, `setDoc`); `horarioPropio(slug, rondaId, uid) → Bloque[]`; `guardarHorarioPropio(slug, ronda: RondaDoc, uid, bloques)` (recibe el documento de la ronda; `recortarBloques` a su rango y `setDoc`); `horariosDeLaRonda(slug, rondaId, uids) → Map<string, Bloque[]>` (un `getDoc` por uid, en paralelo). Errores con `conMensaje`.
- [ ] `web/src/datos/llaves.ts`, `borrarLlaves`: antes de borrar las etapas, listar `tournaments/{slug}/rondas` y los `horarios` de cada una, y sumar todas esas refs a `refs` (Firestore no borra en cascada).
- [ ] Sin pruebas unitarias nuevas (lo cubren T49 a T51 y T62). `npm run build` pasa.

### Fase 7 · Pantallas

### T54 · `CalendarioRonda.tsx` — dif. 4 · senior · 1 d

- [ ] `web/src/components/CalendarioRonda.tsx`, controlado: `{ dias: Dia[]; seleccion: boolean[][]; onChange: (s: boolean[][]) => void; soloLectura?: boolean }`. Reemplaza a `AvailabilityGrid.tsx`, que se borra en T61.
- [ ] Visual igual a la maqueta: barras de 7 px con 1 px entre sí y `rounded-[2px]`; en punto `bg-ink-800`, de :30 `bg-ink-700`, hover `bg-ink-600`, pintadas `bg-gold-500`; etiquetas 00h…23h, una por hora, centradas en la barra de en punto; cabecera de tres líneas (mes en la primera columna y el día 1, día de la semana, número); margen mayor antes de cada lunes; barras no `dentro` apagadas (`opacity-30`, sin cursor de pintar).
- [ ] Columnas de ancho flexible con mínimo de 28 px; si no entran, el contenedor hace scroll horizontal y la columna de etiquetas queda `sticky left-0`.
- [ ] Pintar: `mousedown` guarda `base` (copia de `seleccion`), `ancla` y `modo = !seleccion[d][i]`; `mouseenter` llama `onChange(rectangulo(base, dias, ancla, actual, modo))`; `mouseup` y `blur` de la ventana sueltan. `select-none`.
- [ ] Verificación a mano: lado a lado con la maqueta con 14 y 21 días, y con 31 para el scroll. No hay pruebas de componente (el repo no tiene entorno de React para pruebas); la lógica ya está probada en T49.

### T55 · Editor de fechas de ronda (staff) — dif. 3 · junior · 4 h

- [ ] `web/src/components/FechasDeRonda.tsx` con `{ t: Tournament; onDone: () => void }`: carga `listarRondas(t.id)` y arma las filas con `rondasDelCuadro(t.matches, t.stages)`.
- [ ] Una fila por ronda: `label`, dos `<input type="date" className="field">` ("Desde", "Hasta", con `from_day` y `to_day` si existen) y un `Badge` con `estadoDeRonda` (`sin fechas` neutral, `abierta` gold, `jugada` good). Botón "Guardar fechas" (`btn btn-primary`) que guarda las filas modificadas con `guardarFechasDeRonda(t.id, ronda, desde, hasta, zona)`; `zona = user.timezone || zonaDelNavegador()`.
- [ ] Errores en `Alerta`: una sola fecha ("Completá desde y hasta"), `hasta` anterior a `desde`, más de 31 días. No se puede volver a "sin fechas" (decisión de este plan).
- [ ] Montarlo en `Llaves` de `web/src/pages/TournamentPage.tsx` para el staff y con partidos generados, debajo de los botones y antes de `t.standings`, con la ayuda "Los jugadores cargan horarios solo dentro de este rango. Cada día va de 00:00 a 24:00 en tu zona (\<zona\>)".
- [ ] Verificación a mano en T62.

### T56 · "Mis horarios" en la pestaña Horarios — dif. 3 · junior · 4 h

- [ ] `web/src/components/MisHorarios.tsx` con `{ t: Tournament }`: si no hay usuario, no es inscripto vigente o no tiene `t.me.team_id`, no muestra nada. Con equipo: `misRondas(t.matches, t.stages, t.me.team_id)`; las rondas con documento en `listarRondas(t.id)` llevan calendario, y si ninguna lo tiene, un `Alerta tone="info"` "El organizador todavía no fijó las fechas de \<primera ronda\>".
- [ ] Cada ronda con fechas: título "Mis horarios · \<label\>", `dias = diasDelCalendario(starts_at, ends_at, tz)` con `tz = user.timezone || zonaDelNavegador()`, `CalendarioRonda`, "Marcado en la ronda: X h" (30 min por barra, formato con `horas` de `lib.ts`) y "Guardar horarios" (`btn btn-primary`, deshabilitado sin cambios) que llama `guardarHorarioPropio(t.id, doc, user.id, bloquesDeSeleccion(dias, seleccion))` con el documento de la ronda. Estado inicial: `seleccionDeBloques(dias, await horarioPropio(...))`.
- [ ] Reescribir `Horarios` en `TournamentPage.tsx`: `MisHorarios` arriba y la tarjeta "Partidos" con `MatchCalendar`. Salen "Cuándo puede jugar la mayoría" y "Mejores ventanas" con su estado (`duracion`, `data`, `heat`, `ids`), los imports de `AvailabilityGrid`, `horariosDelTorneo`, `rangoSemana`, `offsetZona` y `Window`, y `horariosDelTorneo` de `web/src/datos/torneos.ts` con los imports de `horarios.js` que queden sin uso (`minutosEnComun` lo saca T59).
- [ ] `TournamentPage` toma la pestaña inicial de `?tab=` (`useSearchParams`, solo valores de `Pestania`) para que T57 enlace a `/t/<slug>?tab=horarios`.
- [ ] Mismo archivo que T55: va después.

### T57 · "Buscar horario" por ronda — dif. 3 · junior · 4 h

- [ ] `web/src/datos/partidos.ts`: reescribir `horariosDelPartido(m, duracion = 90)` → `{ estado: 'ok' | 'sin_fechas' | 'falta_rival'; users: { id, display_name }[]; duration_min: number; windows: Ventana[]; partial: Ventana[] }`. `falta_rival` si `m.teams.a` o `m.teams.b` es null; `sin_fechas` si no existe `rondas/${rondaIdDe(m)}`; si no, lee `horariosDeLaRonda` de los jugadores de los dos equipos y llama a `cruceDeRonda(...)`. Sale el import de `horarios.js`.
- [ ] `web/src/pages/MatchRoom.tsx`, `Agendar`: ventanas como "Sáb 14 nov 18:00 – 21:00" (`fechaCorta(w.starts_at, tz)` más la hora de fin) con "Agendar" → `guardar(w.starts_at)`; "Falta uno" igual, con `missing`. Con estado `ok` y sin ventanas, un `Alerta tone="info"` con `Link` a `/t/${m.tournament.slug}?tab=horarios` ("Pedí que carguen sus horarios en la pestaña Horarios del torneo"). Con `sin_fechas` o `falta_rival`, un aviso propio; la fecha a mano (`datetime-local`) y "Quitar" quedan. Sacar `offsetZona`, `rangoSemana` y `Window` de los imports.
- [ ] Verificación a mano en T62; la lógica ya está probada en T50.

### T58 · Perfil sin horarios — dif. 2 · senior · 2 h

- [ ] Antes hay que cerrar la decisión D1 (mismos archivos con cambios sin commitear) y terminar T51 (`firestore.rules`).
- [ ] `web/src/pages/Profile.tsx`: sacar la sección "Cuándo podés jugar", `bloques`, `sucio`, `guardarHorarios`, `totalMin`, el `horarioDe(...)` del `useEffect` y los imports que queden sin uso (`guardarHorario`, `horarioDe`, `AvailabilityGrid`, `Bloque`, `horas`).
- [ ] `web/src/datos/usuarios.ts`: sacar `horarioDe`, `guardarHorario`, el tipo `Bloque`, `availability: []` y `exceptions: []` de `asegurarPerfil`, y el import de `ordenarPor` si queda sin uso. `functions/src/data/usuarios.js`: sacar los dos campos del alta.
- [ ] `firestore.rules`: sacar `'availability'` y `'exceptions'` de `camposDePerfil()` y las dos líneas de `perfilValido`.
- [ ] Pruebas: en `functions/test/data.test.js` la de alta ya no afirma `availability` (pasa a `undefined`); en `functions/test/reglas-torneos.test.js`, el helper `perfil()` sin esos campos y un caso nuevo: crear un perfil con `availability` falla. `npm test` pasa.

### T59 · Armador y tarjeta de equipo sin horarios — dif. 2 · junior · 2 h

- [ ] Antes hay que cerrar la decisión D1 (toca `web/src/types.ts`).
- [ ] `web/src/logica/armador.js`: `proponerEquipos(torneo, sueltos, { iteraciones = 4000, rnd = Math.random } = {})` sin `pesoSolape`; `puntaje(equipos)` mide solo el desvío de rating; salen `solapeEquipo`, el import de `horarios.js` y `overlap_min` de cada equipo propuesto.
- [ ] `web/src/datos/llaves.ts`: `proponerEquiposDelTorneo(t)` sin `pesoSolape`. `web/src/pages/TournamentPage.tsx`: en `Equipos`, fuera el estado `peso`, el control "Prioridad", la línea "Cruce semanal" y la mención de horarios del texto; en `TeamCard`, fuera "Horario en común del equipo". `web/src/datos/torneos.ts`: `equipoCompleto` sin `overlap_min`, sin `conHorario` y sin el import de `minutosEnComun`. `web/src/types.ts`: sin `Team.overlap_min`.
- [ ] Pruebas en `web/test/armador-horarios.test.js`: borrar "con el mismo nivel, junta a los que comparten horario"; agregar "con el mismo nivel reparte en serpiente sin mirar horarios": cuatro jugadores de rating 1500 con horarios disjuntos dan `[['ah1', 'ah4'], ['ah2', 'ah3']]` y `overlap_min` queda `undefined`.
- [ ] Verificación: `npm --prefix web test` y `npm run build` pasan.

### Fase 8 · Demo, limpieza y prueba

### T60 · Demo con rondas y horarios — dif. 3 · junior · 2 h

- [ ] `functions/src/demo.js`: sacar `bloquesAleatorios`, `availability` de `crearUsuario` y `COMUNES` con su uso en `sembrarMockup`.
- [ ] En `sembrarMockup`, después de agendar las semis: `guardarRonda` para Semifinal y Final de la copa de muestra (`rondaIdDe(partido)`; `from_day`/`to_day` de hoy + 1 a hoy + 3 y de hoy + 6 a hoy + 7, en `America/Argentina/Buenos_Aires`, con `rangoDeDias`) y `guardarHorario` para los jugadores de las dos semis con bloques de 20:00–23:00 locales (`instanteLocal`) en dos de los tres días: en la semi 1 cargan los cuatro y en la semi 2 falta uno.
- [ ] `functions/test/demo.test.js`: caso nuevo: la copa de muestra tiene las rondas de Semifinal y Final; `cruceDeRonda` con los jugadores de la semi 1 da al menos una ventana con `count: 4`, y con los de la semi 2 da `windows: []` y `partial[0].missing.length === 1`.
- [ ] `npm test` pasa, incluido "correrla de nuevo no duplica nada".

### T61 · Limpieza y documentación — dif. 2 · junior · 2 h

- [ ] Antes hay que cerrar la decisión D1 (`README.md` y `docs/firestore-modelo.md` tienen cambios sin commitear).
- [ ] Borrar `web/src/logica/horarios.js` y `web/src/components/AvailabilityGrid.tsx`; en `web/test/armador-horarios.test.js` sacar el `describe('cruce de horarios')` y lo que quede sin uso; sacar de `web/src/lib.ts` lo que ya nadie importa (con `grep` primero: `DIAS`, `MINUTOS_SEMANA`, `BLOQUE`, `mod`, `utcALocal`, `localAUtc`, `etiquetaSemana`, `rangoSemana`, `offsetZona`, `horas` si quedó sin uso) y `Window` de `web/src/types.ts`.
- [ ] `docs/firestore-modelo.md`: `users` sin `availability` ni `exceptions` (ni la nota de excepciones vencidas); secciones nuevas `tournaments/{slug}/rondas/{rondaId}` y `.../horarios/{uid}` con los campos del diseño; en "Tamaños", fuera la fila de 336 bloques y entra "horarios: hasta 800 bloques"; en "De dónde sale cada tabla", `availability` y `availability_exceptions` pasan a "sin destino: ahora son horarios por ronda".
- [ ] `README.md`: "Armador de equipos" sin horarios ni control deslizante, y "Horarios" explicando el flujo por ronda (el organizador fija fechas, cada jugador pinta, "Buscar horario").
- [ ] Verificación: `npm run build` y `npm test` pasan.

### T62 · Prueba completa — dif. 2 · junior · 4 h

- [ ] `npm test` (raíz) y `npm run build` en verde.
- [ ] `npm run dev` y `npm run seed`. Como organizador (`kaiser@demo.aoematch` / `demo1234`) en `/t/copa-aoematch-mockup`, pestaña Llaves → "Fechas de cada ronda": ver Semifinal y Final cargadas por la demo, editar una, y provocar los errores (una sola fecha, `hasta` antes que `desde`, 32 días).
- [ ] Como jugador de una semi, pestaña Horarios → "Mis horarios · Semifinal": pintar con rectángulo, guardar, recargar y ver que quedó; comprobar las 24 etiquetas 00h–23h, las barras de :30 más claras, 14 y 31 días (scroll con etiquetas fijas); con la zona del perfil en `America/New_York` y un rango 31 oct – 2 nov, el 1 de noviembre se ve sin barras repetidas.
- [ ] En la sala de la semi: "Buscar horario" muestra ventanas con fecha y "Agendar" fija `scheduled_at`; la semi con un jugador sin horarios muestra "Falta uno"; la final, con el rival por definir, muestra su aviso; una ronda sin fechas muestra el aviso y deja la fecha a mano.
- [ ] En `ladder-1v1-de-otono`: poner fechas, "Regenerar llaves" y confirmar en la UI de los emuladores (`:4000`) que `rondas` y `horarios` quedaron vacías. Capturas con el navegador integrado como prueba.

## Decisiones abiertas

- **D1 · Cambios sin commitear del usuario.** `git status` muestra la baja de `aoe3_profile` en `README.md`, `docs/firestore-modelo.md`, `firestore.rules`, `functions/src/data/usuarios.js`, `web/src/datos/usuarios.ts`, `web/src/pages/Profile.tsx` y `web/src/types.ts`. Este plan toca esos mismos archivos y un commit por tarea mezclaría esas líneas con las nuevas. Hay que commitearlos antes de empezar, o decir cómo tratarlos. Bloquea T51, T53, T58, T59 y T61.
