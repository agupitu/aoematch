# Draft suelto: pestaña "Draft" para armar un draft sin torneo

Fecha: 2026-10-27. Rama de trabajo: `feat/firebase` (plan Spark, sin servidor).
Maqueta de las pantallas: [`2026-10-27-draft-suelto-mockup.html`](2026-10-27-draft-suelto-mockup.html) (abrir en el navegador).

## Intención

Hoy el draft de mapa y civs solo existe adentro de un torneo (`matches/{id}/drafts/{n}`, lógica en
`web/src/logica/draft.js`). Se quiere una pestaña nueva en el header, **Draft**, para armar un draft
directamente: el creador fija cuántos jugadores hay por equipo y las reglas, comparte un link, la gente
entra, se reparte en dos equipos y hacen el draft. Sirve para partidas amistosas sin montar un torneo.

Las opciones de civ nuevas (modo serpiente, repetir civ entre equipos, repetir civ dentro del equipo,
confirmar pick en ciego) valen también para los drafts de partidas de torneo y se configuran en el
formulario del torneo.

## Metas

- Crear un draft suelto desde la pestaña "Draft", compartir un link y que entren jugadores con su sesión.
- El creador configura: jugadores por equipo, quién elige el mapa, bans de mapa, bans de civ, pool de
  mapas, modo de pick de civ y las dos opciones de repetición.
- Dos modos de pick de civ: **ciego** (todos eligen, confirman, se revela al confirmar todos) y
  **serpiente** (por turnos, sin tiempo).
- Chat por equipo y chat de todos dentro del draft. El chat desaparece cuando se cierra la sala.
- Misma lógica y mismas reglas de Firestore para el draft de torneo y el suelto: una sola implementación.
- Pantallas como la maqueta: mapa elegido a la izquierda en cuadrado 1:1 con su imagen de fondo, civs con
  bandera, tilde de "ya eligió" para los rivales.

## No metas

- **Sin cronómetro.** La decisión D11 de `PLAN.md` se mantiene: nadie pasa por tiempo.
- Más de dos equipos.
- Series al mejor de N en el draft suelto: es un solo draft.
- Cambios en el draft de torneo aparte de las opciones de civ: no se le agregan bans de mapa ni el chat de
  este diseño (el torneo ya tiene su chat de partido).
- Limpieza automática de drafts viejos, listado de "mis drafts", notificaciones, espectadores en el chat.

## Anti-metas (lo que sería un fracaso aunque "ande")

- Que un rival pueda ver una civ ciega antes de la revelación, por la pantalla o leyendo la base directo.
- Que alguien pueda dar un paso fuera de su turno, o repetir civ cuando la opción lo prohíbe, saltándose la web.
- Que el draft de torneo existente deje de funcionar o exija migrar datos: los torneos ya creados, sin los
  campos nuevos, siguen andando con ciego, repetir sí, repetir sí. Lo único que cambia para ellos es la
  experiencia del ciego (confirmar pick, compañeros que se ven las civs), que el usuario pidió para todo
  draft ciego.
- Que el chat de una sala cerrada siga guardado.

## Restricciones

- Plan Spark: no hay funciones de servidor. La web escribe directo en Firestore y `firestore.rules` es la
  única barrera. Cada regla del draft se escribe en la web (para avisar en pantalla) y se repite en las reglas.
- Se entra con la sesión que ya existe en el sitio (`web/src/auth.tsx`). Sin sesión se puede mirar, no
  participar.
- Convenciones del repo: código y comentarios en español, campos de Firestore en inglés `snake_case`,
  lógica pura en `web/src/logica/` con pruebas `node:test` en `web/test/`, pruebas de reglas en
  `functions/test/` (se corren con `npm test` contra el emulador), modelo documentado en
  `docs/firestore-modelo.md`.
- Cuotas de Spark: no hay problema con un draft (decenas de escrituras), pero no se mantienen escuchas ni
  consultas de más.

## Decisiones tomadas por el usuario

**Configuración que fija el creador:**

| Opción | Valores |
|---|---|
| Jugadores por equipo | 1 a 4 |
| Quién elige el mapa | Equipo A, Equipo B, el creador, o al azar |
| Bans de mapa | sí/no y cuántos por equipo |
| Bans de civ | sí/no y cuántos por equipo |
| Modo de pick de civ | ciego o serpiente |
| Repetir civ entre equipos | solo en serpiente. En ciego siempre se puede repetir |
| Repetir civ dentro del equipo | opción en ambos modos |

- Las civs las elige cada jugador (no el capitán por todos), también en serpiente.
- Ciego: cuando todos eligieron, se revelan. Los compañeros de equipo ven la civ de los suyos; los rivales
  solo ven un tilde de "ya eligió". Elegir no alcanza: hay que apretar un botón **Confirmar pick**, y recién
  ahí a los demás les aparece el tilde.
- Serpiente: por turnos, sin tiempo. Con "no repetir entre equipos", la civ que elige un equipo queda fuera
  para el equipo rival.
- Las opciones de civ (modo, repetir entre equipos, repetir en el equipo) también se configuran al crear
  un torneo.
- Chat: uno por equipo y uno de todos. Si no se puede borrar al cerrar la sala, el chat se descarta (ver
  "Chat": sí se puede).
- La pestaña se llama **Draft**. Diseño profesional; el mapa elegido va a la izquierda, cuadrado, con la
  imagen del mapa de fondo; las civs llevan bandera.

## Decisiones mías (revisar)

Elegidas por falta de respuesta o por necesidad. El constructor las toma como firmes salvo que el usuario las cambie.

1. **Dos equipos fijos.** El usuario no respondió si debía haber más. La maqueta que aprobó muestra 2.
2. **Se entra con la sesión del sitio.** Cualquiera con el link puede mirar el draft; para ocupar un lugar o
   escribir hay que haber entrado. El link lleva un id aleatorio difícil de adivinar; no se puede listar ni
   buscar drafts.
3. **Confirmar es definitivo.** Antes de confirmar se puede cambiar la civ; después no. Si alguien confirmó mal,
   el creador reinicia (punto 8).
4. **Orden de las fases:** lobby, bans de mapa, elección de mapa, bans de civ, picks, listo.
   Se saltean las que valen cero.
5. **Quién empieza:** los bans de mapa y de civ alternan y arranca el equipo que **no** elige el mapa. Si el
   mapa lo elige el creador o el azar, arranca el Equipo A. En serpiente, el equipo que arrancó los bans elige
   civ primero.
6. **Quién actúa por un equipo:** en bans y en elegir mapa, cualquier jugador del equipo cuando es su turno
   (como en el draft de torneo hoy). Si el mapa lo elige "el creador", solo él, juegue o no.
7. **Orden de serpiente:** alterna por turnos de jugador, en patrón ABBA (para 2 por equipo: A1, B1, B2, A2;
   para 3: A1, B1, B2, A2, A3, B3; para 4: A1, B1, B2, A2, A3, B3, B4, A4). Dentro de un equipo, por orden de
   lugar en la sala. El primero es el equipo que arrancó los bans.
8. **El creador puede reiniciar el draft** (vuelve al lobby con los mismos jugadores y la misma
   configuración; borra bans, picks y mapa). No hay tiempo, así que es la salida si alguien abandona. También
   puede sacar a un jugador del lobby.
9. **El creador no está obligado a ocupar un lugar**: puede ser árbitro. Siempre puede: empezar, reiniciar,
   sacar jugadores y cerrar la sala.
10. **Lobby:** los jugadores eligen su lugar en Equipo A o B y pueden cambiarlo mientras no empiece. El draft
    empieza cuando el creador aprieta "Empezar" con todos los lugares ocupados. Después nadie entra ni sale.
11. **Pool de civs: todas (24).** Pool de mapas: por defecto todos los del catálogo (174), con el selector que
    ya existe en `PoolPicker.tsx` (buscador y selección por grupo); el creador saca o suma. El "34" de la
    maqueta era un número de ejemplo.
12. **"Al azar" para el mapa** lo resuelve el navegador que da el último ban (o el creador al empezar si no hay
    bans); las reglas solo comprueban que el mapa esté en el pool restante. Spark no permite garantizar azar real.
13. **Después de cerrar, el resultado queda**: el link sigue mostrando mapa, bans y civs de cada uno (solo
    lectura), sin chat.
14. **Español de las etiquetas y de los modos**: `ciego` y `serpiente`.
15. **Celular:** las columnas se apilan; el chat pasa a ser una pestaña o cajón.
16. **Las opciones nuevas del torneo, por defecto, reproducen el comportamiento actual** (ciego, repetir entre
    equipos sí, repetir dentro del equipo sí, según D6).
17. **Privacidad del chat de equipo al cerrar (a revisar con atención).** Para borrarlo desde el navegador del
    creador hace falta que pueda listarlo, así que durante el cierre tiene lectura de todas las salas. Se
    descartaron otras salidas por más complejas: ids de mensaje predecibles con contador (obliga a permitir
    actualizar la sala en cada mensaje) o que cada equipo borre el suyo (no es confiable si alguien está
    desconectado). Si el usuario no acepta esa ventana, queda la salida del contador.
18. **Ciego en torneos:** "Confirmar pick" y compañeros que se ven las civs aplican a todo draft ciego,
    torneos incluidos (pedido del usuario). Los datos de los torneos existentes no se migran.
19. **Staff y creador:** ver "Permisos del creador (suelto) y del staff (torneo)".

## Reglas del draft

Valen igual para el draft suelto y el de torneo, salvo lo que se dice de bans de mapa y lobby (solo suelto).

- **Bans:** cada equipo banea su cantidad, alternados. Solo cosas del pool que no estén baneadas. Un solo
  ban por vez: dos clics a la vez no banean dos.
- **Elegir mapa:** del pool restante, por el que corresponda (equipo, creador o azar).
- **Ciego:**
  - Seleccionar una civ guarda el pick propio (cambiable mientras no se confirme).
  - Confirmar marca el pick como definitivo y suma al jugador a la lista pública de "ya eligieron" (sin decir qué civ).
  - Un jugador solo puede leer su pick y los de su equipo. Los de los rivales, recién cuando el draft se reveló.
    Esto vale siempre en ciego, también en torneo y aunque "repetir dentro del equipo" esté permitido: hoy
    en torneo solo el dueño lee su pick, y eso cambia.
  - Cuando confirmaron todos, cualquiera de los jugadores revela. Hasta ahí, el servidor de reglas no deja
    leer picks ajenos.
  - Con "no repetir dentro del equipo": una civ ya seleccionada por un compañero (confirmada o no) no se puede
    seleccionar. Es el motivo por el que los compañeros se ven.
  - Entre equipos siempre se puede repetir.
- **Serpiente:**
  - Cada pick es público al instante y solo lo hace el jugador al que le toca.
  - Con "no repetir entre equipos": no se puede elegir una civ que ya tiene un jugador del equipo rival.
  - Con "no repetir dentro del equipo": ídem para los compañeros.
  - El draft termina con el último pick.
- Al crear (suelto) o al abrir (torneo) se valida que queden civs suficientes para completar los picks
  según las opciones de repetición y los bans, y que queden mapas después de los bans.

### Permisos del creador (suelto) y del staff (torneo)

- **Suelto:** el creador no puede escribir libremente en el draft. Solo puede: empezar, reiniciar, sacar a
  un jugador del lobby, elegir el mapa cuando el mapa lo elige "el creador", y cerrar la sala. No lee picks
  ciegos ajenos salvo que sea compañero de equipo.
- **Torneo:** el staff del torneo conserva el permiso que tiene hoy sobre el draft de partida (corregir,
  reiniciar, borrar picks). No es meta quitarlo. Se escribe como una rama aparte de las reglas, para que no
  exista en el draft suelto.

## Chat (solo draft suelto)

Sí es posible con Spark, con estas condiciones:

- Salas: una de todos y una por equipo. Se reutiliza el chat que ya existe (`rooms/{roomId}/messages`,
  `web/src/live.ts` con `useChat`, `ChatPanel.tsx`). Las reglas de `rooms` se extienden para estas salas.
- Chat de todos: lo lee cualquiera con el link; lo escriben los jugadores y el creador.
- Chat de equipo: solo lo leen y escriben los jugadores de ese equipo (el equipo sale del propio draft, como
  hoy sale del equipo en torneos). El creador solo ve el chat de su equipo si juega.
- **Borrado al cerrar:** como no hay servidor, "Cerrar sala" lo hace el navegador del creador: borra todos los
  mensajes y las salas del draft en tandas y deja el draft marcado como cerrado. Para poder listar los
  mensajes de los chats de equipo que no lee, las reglas le dan al creador lectura y borrado de **todas** las
  salas del draft, pero solo mientras el draft está en estado "cerrándose" (el creador lo marca primero). La
  web nunca muestra esos mensajes; un cliente modificado sí podría leerlos en esa ventana (ver decisión 17).
  Fuera de esa ventana el creador lee solo el chat de su propio equipo, si juega. Si el creador nunca cierra,
  el chat queda guardado.
  El constructor puede evaluar como respaldo el vencimiento automático de Firestore sobre los mensajes
  (TTL): hay que verificar que esté disponible y gratis en Spark; si no, se omite.
- Si el borrado se corta a la mitad (conexión), la sala queda "cerrándose" y se puede reintentar.

## Pantallas

La maqueta es el diseño a seguir. Puntos que importan:

- Pestaña **Draft** en el header (`web/src/App.tsx`), al lado de "Torneos" y "Crear torneo".
  Rutas nuevas: una para crear y una para la sala por id.
- **Crear:** formulario en dos columnas con un resumen fijo a la derecha y el botón "Crear y copiar link".
- **Sala:**
  - Arriba: título, fases (Mapa, Bans, Picks, Revelado), "Copiar link" y "Cerrar sala" (creador).
  - A la izquierda: tarjeta cuadrada 1:1 con el mapa elegido (imagen de fondo, nombre, quién lo eligió) y debajo
    los bans de mapa.
  - Al centro: equipos con sus jugadores, bandera y estado; bans de civ; grilla de civs con bandera
    (`flag` del catálogo); barra de acción con "Confirmar pick" en ciego; orden de turnos en serpiente.
  - A la derecha: chat con pestañas "Todos" y el equipo propio, con el aviso de que se borra al cerrar.
- Los estados de la grilla: elegida, baneada, tomada por el rival (serpiente exclusiva), no disponible.
- El lobby usa la misma estructura (equipos con lugares libres y botón "Unirme") con el chat ya activo.

## Torneos: opciones de civ

- `web/src/components/TournamentForm.tsx` suma tres opciones: modo de pick (ciego/serpiente), repetir entre
  equipos (solo serpiente), repetir dentro del equipo. Vuelve `civ_repeat_team`, que se había sacado.
- `torneoValido` en `firestore.rules` y `web/src/types.ts` aceptan los campos nuevos.
- El draft de la partida lee las opciones del torneo y usa el mismo motor que el suelto, incluyendo el botón
  "Confirmar pick" en ciego y el modo serpiente.
- Torneos sin los campos nuevos: ciego, repetir sí, repetir sí.

## Qué queda para el constructor

- Estructura exacta de Firestore para el draft suelto (colección, subcolecciones, nombres de campos), id
  aleatorio y cómo evitar colisiones, mientras se cumplan los puntos "Reglas" y "Chat".
- Si el motor compartido es una refactorización de `draft.js` o un módulo nuevo que `draft.js` también usa.
- Cómo expresar en reglas la lectura de picks de compañeros y la prohibición de repetir dentro del equipo
  (las reglas no iteran: probablemente haya que escribirlo desplegado hasta 4 jugadores, como
  `vodLinksValidos`).
- Reutilización de presencia (`presence.ts`) para mostrar "conectado" en el lobby: opcional.
- Pruebas: lógica (`node:test`) y reglas (emulador) de lo que dicen las anti-metas: secreto del ciego, turnos,
  repetición, confirmar definitivo, quién borra el chat, que no se pueda listar drafts.
- Actualizar `docs/firestore-modelo.md` y las decisiones de `PLAN.md` (D12 en adelante) con lo nuevo.
