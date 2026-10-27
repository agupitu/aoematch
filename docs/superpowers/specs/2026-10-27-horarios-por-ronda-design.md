# Horarios por ronda — diseño

Fecha: 2026-10-27 · Estado: borrador, falta la aprobación del usuario · Rama de trabajo: `feat/firebase`

## Para qué

Hoy cada jugador pinta en su **perfil** una semana fija (336 bloques de 30 minutos en UTC) y con eso la app
cruza horarios. Lo leen tres lugares: el armador de equipos, la pestaña Horarios del torneo y "Buscar horario"
de la sala del partido (todos sobre `users/{uid}.availability`).

Una semana fija no describe un torneo: cada ronda se juega en fechas distintas y la disponibilidad cambia de
una ronda a otra. El pedido, en palabras del usuario:

> "cuando podes jugar se deberia poder poner en el torneo, no en el perfil. y que sea un calendario con las
> fechas disponibles para jugar cada etapa. Es decir si clasifica a la siguiente etapa debe colocar otra vez
> los horarios."

También pidió que la grilla muestre todas las horas ("ahora llega hasta 21h nomás"). Causa: la columna de
etiquetas mide 336 px y la grilla 383 px (el `gap` de 1 px no se contó), así que la etiqueta 21h queda a la
altura de las ~18:20 y de 22h a 24h no hay etiquetas.

## Lo que decidió el usuario

1. Los horarios se cargan en el **torneo**, no en el perfil.
2. "Etapa" es cada **ronda** del cuadro (octavos, cuartos, semifinal, final).
3. El **organizador fija el rango de fechas de cada ronda**; el jugador marca horarios dentro de ese rango.
4. Si el equipo pasa a la ronda siguiente, el jugador **carga de nuevo**: la ronda nueva arranca vacía.
5. Calendario: **grilla por día** (la opción A de las maquetas), con **columnas angostas** para que entren más
   días y las **barritas redondeadas** de media hora de la grilla actual. Las barras de :30 van más claras que
   las de en punto, para distinguir las horas. Eje de horas completo.
6. Aprobó la maqueta final: [`2026-10-27-horarios-por-ronda-mockup.html`](2026-10-27-horarios-por-ronda-mockup.html)
   (abrirla en el navegador). El selector 7/14/21 días y el botón "Pintadas: media hora más clara" son solo de
   la maqueta.

## Suposiciones mías que el usuario no objetó

Se le avisaron y no dijo nada en contra; se confirman al leer este documento.

- Cada jugador carga lo suyo, solo para la ronda en la que está su equipo.
- Liga, grupos y suizo siguen la misma regla: una ronda es una fecha ("Fecha 3", "Ronda 2").
- El perfil pierde la sección "Cuándo podés jugar". Los horarios semanales ya guardados no se migran.
- El armador de equipos y la tarjeta de equipo dejan de usar horarios (al armar equipos todavía no hay ronda).
- En la pestaña Horarios salen el mapa de calor y las "mejores ventanas" de todos los inscriptos.
- Pintar con arrastre en rectángulo (una pasada marca varios días a la vez).
- Las barras pintadas usan el gold del tema (`gold-500`, `#c2973f`); el naranja de la maqueta era de ejemplo.
- Cada día del rango va de 00:00 a 24:00 en la zona horaria del organizador que guarda las fechas.

## Objetivos, no objetivos, anti-objetivos

**Objetivos**

- El jugador carga sus horarios por ronda, en el torneo.
- El organizador fija desde qué día hasta qué día se juega cada ronda.
- "Buscar horario" cruza los horarios de los jugadores del partido **en esa ronda** y propone horas con fecha
  real.
- El perfil queda sin horarios.
- La grilla muestra las 24 horas, bien alineadas.

**No objetivos (por ahora)**

- Migrar los horarios semanales viejos.
- Copiar horarios de una ronda a otra, o plantillas semanales.
- Avisos (mail, notificación) cuando se abren las fechas o falta cargar.
- Un panel del organizador con quién cargó y quién no.
- Las "excepciones" por día (`users.exceptions`): ninguna pantalla las usó.
- Agendar solo: el capitán o el staff siguen confirmando.

**Anti-objetivos (sería un fracaso aunque funcione)**

- Que un partido quede trabado porque alguien no cargó horarios: la fecha a mano sigue disponible.
- Que alguien pueda escribir horarios de otro jugador, o de un torneo donde no está inscripto.
- Que los horarios se corran una hora por un cambio de horario de verano dentro del rango.
- Que queden restos: la grilla semanal, `availability` en el perfil o textos que manden "al perfil".

## Comportamiento

### Organizador (staff)

En la pestaña **Llaves**, arriba del cuadro y solo para el staff, un bloque "Fechas de cada ronda":

- Una fila por ronda del cuadro, con "Desde" y "Hasta" (campos de fecha) y un estado: *sin fechas*, *abierta*
  (tiene fechas y queda algún partido sin cerrar) o *jugada* (todos los partidos cerrados, `finalizado` o
  `walkover`).
- Las rondas salen de los partidos: se agrupan por `stage_id`, `bracket` (W, L, F) y `round`; el nombre es el
  `label` del primer partido de la ronda ("Octavos", "Perdedores · Ronda 2", "Fecha 3"). Van ordenadas por
  `idx` de la etapa, después W, L, F, después número de ronda. El tercer puesto comparte ronda (y fechas) con
  la final; los grupos comparten la fecha N.
- Rango de 1 a 31 días, "hasta" no anterior a "desde". Se puede editar siempre, también con la ronda en
  juego.
- Una ronda sin fechas no abre calendario a los jugadores.
- Un botón "Guardar fechas". El staff puede dejar todas las rondas cargadas desde el principio, porque el
  cuadro se genera completo.

### Jugador

En la pestaña **Horarios** del torneo, arriba de todo, un bloque "Mis horarios · \<ronda\>" por cada ronda en
la que su equipo tiene un partido sin cerrar. Solo para inscriptos vigentes con equipo.

- Si la ronda no tiene fechas: aviso "El organizador todavía no fijó las fechas de \<ronda\>".
- Si tiene: el calendario de abajo y un botón "Guardar horarios" (explícito, como el perfil de hoy).
- Cuando el equipo gana y pasa de ronda, el bloque de la ronda nueva aparece vacío y hay que cargar de nuevo.
- Un equipo con *bye* no tiene partido en esa ronda (se cierra solo como `walkover`): no aparece.

**El calendario** (la maqueta es la referencia visual; esto es lo que no se ve en una captura):

- Una columna por día del rango, en la zona horaria del jugador (`users.timezone`). Cada columna tiene 48
  barras de 30 minutos: 7 px de alto, 1 px entre barras, radio de 2 px, como la grilla actual.
- Columnas angostas: el ancho se reparte entre los días, con un mínimo (~28 px). Si el rango no entra, scroll
  horizontal con las etiquetas de hora fijas a la izquierda. En la maqueta, 14 días son ~44 px por columna.
- Cabecera de tres líneas: mes (solo en la primera columna y el día 1), día de la semana, número. Cada lunes
  la columna lleva un margen mayor para separar semanas.
- Barras de en punto en `ink-800`, de :30 en `ink-700`, hover `ink-600`. Pintadas: `gold-500`, todas del mismo
  color.
- Etiquetas 00h…23h, una por hora, centradas en la barra de en punto.
- Pintar: clic o arrastre en rectángulo, desde la barra donde se apretó hasta la actual. Si esa barra estaba
  apagada el rectángulo enciende, si estaba prendida borra. Resumen: "Marcado en la ronda: X h".
- Si por la zona del jugador el primer o el último día queda cortado respecto del rango, las barras fuera del
  rango se ven apagadas y no se pintan.
- La grilla semanal actual (`web/src/components/AvailabilityGrid.tsx`) se reemplaza; el mapa de calor deja de
  existir, así que no hace falta conservar esa parte.

### "Buscar horario" (sala del partido)

Lo que ve el capitán o el staff no cambia: ventanas en las que pueden **todos** los jugadores de los dos equipos
durante la duración elegida (90 min por defecto) y, si no hay, las que dejan afuera a uno, diciendo quién; botón
"Agendar". Cambia de dónde sale:

- La fuente son los horarios de **la ronda del partido**, recortados al rango de la ronda.
- Las ventanas son rangos con fecha real (ya no "la próxima vez que cae ese minuto de la semana").
- Se descartan los tramos que ya pasaron.
- Sin ventanas, el aviso manda a cargar horarios en la pestaña Horarios del torneo (hoy dice "en el perfil").
- Sin fechas de ronda, o con un equipo "por definir": un aviso y la fecha a mano (`datetime-local`), que se
  conserva.

### Perfil

Sin la sección "Cuándo podés jugar" ni su botón. La zona horaria se queda: es la que usa el calendario.

### Armador de equipos y tarjeta de equipo

Dejan de usar horarios. El armador reparte solo por nivel (serpiente más intercambios). Salen el control
"Prioridad", el "Cruce semanal" de cada propuesta y el "Horario en común del equipo" de las tarjetas.

### Pestaña Horarios, el resto

Se conserva el calendario de partidos ("Partidos"). Salen "Cuándo puede jugar la mayoría" y "Mejores ventanas".

## Restricciones del proyecto

- **Plan Spark, sin servidor.** La web escribe directo en Firestore y `firestore.rules` es la única barrera.
  Cada escritura nueva necesita su regla y su prueba de reglas (`functions/test/`).
- **Dónde va cada cosa.** Lógica pura en `web/src/logica/*.js` (la comparten la web, la demo
  `functions/src/demo.js` y las pruebas); acceso a datos de la web en `web/src/datos/*.ts` y su gemelo con
  Admin SDK en `functions/src/data/*.js`.
- **Fechas como texto ISO 8601 en UTC** (`docs/firestore-modelo.md`, sección "Fechas").
- **Las reglas no tienen bucles:** no se puede validar una lista elemento por elemento. Los topes van por
  `size()` y por claves; el recorte real se hace al leer.
- **Un documento no pasa de 1 MiB.**
- **Cambio de horario de verano dentro del rango.** `offsetZona()` de `web/src/lib.ts` mide el desfase "de
  hoy" y no alcanza para fechas puntuales: los límites de cada día se calculan con la zona (`Intl`) para esa
  fecha.
- **Regenerar llaves** borra partidos, etapas, votos y salas (`borrarLlaves` en `web/src/datos/llaves.ts`).
  Tiene que borrar también las fechas de ronda y los horarios, que quedarían huérfanos.
- **Producción:** hubo un primer deploy a mano el 2026-10-27 (`PLAN.md`, T30) con la lista de torneos vacía,
  así que casi seguro no hay perfiles con `availability`. Si los hay, se ignoran; no se borran. El workflow
  `.github/workflows/deploy.yml` existe solo en `feat/firebase`: publica las reglas nuevas cuando la rama
  llegue a `master`.
- Textos en castellano con voseo ("Guardá", "Pintá"), igual que el resto de la web. Estilos con los tokens
  del tema (`web/src/index.css`: `ink-*`, `gold-*`, `parch-*`).

## Modelo de datos (propuesta mía, ajustable)

Una **ronda** es la terna (`stage_id`, `bracket`, `round`) de los partidos. Clave: `{stage_id}_{bracket}{round}`
(por ejemplo `Zk3…_W2`; solo letras, números y guion bajo).

`tournaments/{slug}/rondas/{rondaId}` — lo escribe el staff.

```
{ stage_id, bracket, round, label,
  from_day: '2026-11-14', to_day: '2026-11-27',   // lo que ve y edita el staff
  zone: 'America/Argentina/Buenos_Aires',         // zona del staff que guardó
  starts_at: ISO UTC,   // 00:00 de from_day en `zone`
  ends_at:   ISO UTC,   // 24:00 de to_day en `zone`, excluyente
  updated_at }
```

`tournaments/{slug}/rondas/{rondaId}/horarios/{uid}` — lo escribe el jugador.

```
{ user_id, blocks: [{ starts_at: ISO UTC, ends_at: ISO UTC }], updated_at }
```

Los bloques van alineados a :00 y :30, ordenados, fusionados y recortados al rango.

Reglas:

- `rondas/{rondaId}`: lectura pública; crear, editar y borrar solo el staff del torneo; `bracket` en `W/L/F`,
  `round` entero ≥ 1, `starts_at < ends_at`.
- `rondas/{rondaId}/horarios/{uid}`: lectura pública (el horario del perfil ya era público); crear y editar
  solo si `uid` es quien escribe, está inscripto y no retirado (`inscriptoVigente`), la ronda existe y el
  documento trae solo `user_id`, `blocks`, `updated_at` con `blocks.size()` hasta ~800 (31 días × 24 barras
  alternadas = 744); borrar el dueño o el staff.
- No hacen falta índices nuevos: todo se lee por id. Para un partido son hasta 9 lecturas (la ronda y los
  horarios de hasta 8 jugadores); para "Mis horarios", la colección `rondas` del torneo (pocos documentos) y
  mis propios horarios por id.

Cruce: máscara de barras de 30 minutos sobre el rango de la ronda, por jugador; ventanas con todos y, si no
hay, con todos menos uno (misma lógica que hoy en `web/src/logica/horarios.js`, pero sobre el rango de la
ronda en vez de la semana). Orden: más gente primero, después más largas, después más temprano.

## Casos borde

- El staff cambia el rango con horarios ya cargados: lo que queda fuera del rango nuevo se ignora al cruzar y
  al mostrar; no se borra.
- Un jugador cambia de equipo o se retira: sus horarios quedan, pero el cruce usa los integrantes actuales de
  los equipos del partido.
- Un jugador sin horarios cargados aparece como que no puede (entra en "falta uno").
- Cambio de horario de verano: ese día tiene 46 o 50 barras de 30 minutos reales. Cómo se dibuja es del
  constructor (ver abajo); el cruce trabaja en UTC y no se rompe.
- Zonas con desfase que no es múltiplo de 30 minutos (por ejemplo Nepal): ya pasaba con la grilla actual; se
  acepta el redondeo a la barra más cercana.
- Ronda sin fechas, o jugada y reabierta por una corrección del staff: sin fechas no hay calendario; con
  fechas, el calendario se muestra mientras quede un partido sin cerrar.

## Qué queda para quien construye

- La forma exacta de documentos, campos y reglas: lo de arriba es un punto de partida.
- Cómo enlazar la sala del partido con la pestaña Horarios (hoy `TournamentPage` guarda la pestaña en estado,
  sin parámetro en la URL; las rutas son `/t/:slug` y `/m/:id`).
- Estructura de componentes y archivos; qué de `web/src/lib.ts` (`DIAS`, `BLOQUE`, `utcALocal`, `rangoSemana`…)
  deja de usarse y se saca.
- Cómo dibujar el día de cambio de horario.
- Orden de las ventanas, textos exactos, estados vacíos y de carga.
- Si "Mis horarios" muestra todas las rondas pendientes o solo la más próxima.

## Qué se actualiza además del código

- **Documentos:** `docs/firestore-modelo.md` (`users` sin `availability` ni `exceptions`; subcolecciones nuevas;
  tamaños; tabla "De dónde sale cada tabla") y `README.md` (secciones "Armador de equipos" y "Horarios").
- **Reglas y modelo de usuario:** sacar `availability` y `exceptions` de `camposDePerfil` y de `perfilValido`
  en `firestore.rules`, y de los altas de perfil (`web/src/datos/usuarios.ts`, `functions/src/data/usuarios.js`).
- **Pruebas existentes a cambiar:** `web/test/armador-horarios.test.js` (cruce semanal; el caso del armador que
  junta a los que comparten horario), `functions/test/data.test.js` (línea 40, `availability` vacío),
  `functions/test/reglas-torneos.test.js` (el `perfil()` con `availability` y `exceptions`) y revisar
  `functions/test/demo.test.js`.
- **Pruebas nuevas:** el cruce por ronda (recorte al rango, descartar lo pasado, falta uno, DST), la lógica de
  pintado en rectángulo si se extrae, y las reglas de `rondas` y `horarios` (staff, dueño, inscripto, ronda
  existente, topes).
- **Demo** (`functions/src/demo.js`): sacar `availability` de los perfiles; fijar fechas de ronda y horarios
  para la copa de muestra (semis y final), así "Buscar horario" tiene algo que mostrar.
- **Cómo verificar:** `npm test` desde la raíz (emuladores) y `npm run build`; a mano con `npm run dev` y
  `npm run seed` (cuenta organizadora `kaiser@demo.aoematch`, clave `demo1234`).
