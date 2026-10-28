# AoE III Draft

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/agupitu/aoematch)

Plataforma para organizar torneos de **Age of Empires III: Definitive Edition**:
inscripciones y pagos, armado automático de equipos, cruce de horarios, salas de
chat por equipo y draft de mapa y civilizaciones en vivo.

## Arrancar

```bash
npm install          # instala raíz, server y web
npm run assets       # descarga banderas y minimapas (una sola vez)
npm run seed         # datos de demostración
npm run dev          # API en :3001 y la web en :5173
```

Abrí <http://localhost:5173>. La demo deja tres torneos y 24 jugadores con
horarios cargados. Usuario organizador: `kaiser@demo.aoematch` / `demo1234`
(todos los jugadores de la demo usan la misma contraseña).

Para producción:

```bash
npm run build        # compila la web
npm start            # un solo proceso sirve API + web en :3001
```

Variables de entorno (ver `.env.example`):

| Variable | Para qué |
|---|---|
| `PUBLIC_URL` | Origen que ve el navegador. Si no está, se deduce del pedido, así un deploy anda sin configurar nada. |
| `API_PORT` / `--port` | Puerto del backend (3001 por defecto). |
| `STEAM_API_KEY` | Opcional. Con una clave de Steam se traen nombre y avatar al vincular. Sin clave el login igual funciona. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Credenciales OAuth para el ingreso con Google. Sin ellas el botón queda deshabilitado. |
| `DEV_LOGIN` | `1` habilita el login por email de las cuentas de prueba, `0` lo apaga. Por defecto está prendido fuera de producción. |
| `SEED_DEMO` | `1` siembra la demo la primera vez que arranca con la base vacía (útil en un deploy nuevo). |
| `AOEMATCH_DB` | Ruta del archivo SQLite (`server/data/aoematch.db` por defecto). |

### Ingreso con Google

En [Google Cloud Console](https://console.cloud.google.com/apis/credentials) creá unas
credenciales OAuth de tipo *aplicación web* y agregá como URI de redirección
`https://TU-DOMINIO/api/auth/google/return` (en local,
`http://localhost:5173/api/auth/google/return`). Después poné el id y el secreto en `local.env`, en la raíz del proyecto:

```bash
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

El server lo carga solo (`--env-file-if-exists`), tanto en `npm run dev` como en
`npm start`; también lee un `.env` si preferís ese nombre. Ninguno de los dos se
versiona. En un hosting, las mismas variables se cargan desde su panel.

## Qué hace

### Torneos
El formulario de creación está dividido en pestañas —**lo básico, formato,
draft, inscripción, premios, mapas y civilizaciones**— y es el mismo que después
aparece en **Configuración**. Ahí se define el formato (**eliminación simple,
doble, liga, grupos + playoff o suizo**), el tamaño de equipo (1v1 a 4v4), el
tipo y largo de las series, el pool de mapas, las civilizaciones habilitadas, el
costo de inscripción con sus medios de pago (hasta 5; cada uno con medio, nombre,
alias y link, todos opcionales) y el reparto de premios. Los buscadores de mapas y civilizaciones ignoran tildes y
mayúsculas: `decan` encuentra `Decán`.

**Mapas.** El selector tiene dos lados: a la izquierda los mapas disponibles, con
búsqueda y filtros por terreno (tierra, agua o ambos) y por región (América,
Europa, Asia, África), y a la derecha el pool del torneo, en el orden en que se
fueron eligiendo. Un clic pasa un mapa de un lado al otro, "Agregar los visibles"
pasa todos los que quedan a la vista y "Quitar todos" vacía el pool. Un mapa puede
estar en más de una región (el Estrecho de Bering, en América y en Asia). La
clasificación es aproximada y está en `web/src/logica/mapas-info.js`.

**Repeticiones del draft.** Hay tres opciones: repetir civ en el mismo equipo,
repetir civ contra el mismo rival y repetir mapa contra el mismo rival (estas dos
valen dentro de una serie, no en toda la fase). Sin repetir en el equipo, los
compañeros se ven el pick antes de revelar y las reglas no dejan guardar la civ
de un compañero.

**Series.** Pueden ser *al mejor de N* (BO1, BO3, BO5, BO7: se corta cuando un
equipo gana la mayoría) o *a N partidas* (de 2 a 9: se juegan todas y gana el que
más ganó; si N es par y empatan, se juega una más que desempata). La final puede
tener su propio largo.

**Vista previa.** En la pestaña *Formato* se ve cómo va a quedar el torneo con
esa configuración —cuadro, fechas de la liga, primera ronda del suizo, o grupos
con sus playoffs— armado con el mismo generador de llaves, con la cantidad de
equipos que elijas (por defecto, el tope del torneo).

Las llaves se generan con siembra clásica (1-8, 4-5, 2-7, 3-6), byes
automáticos y avance del ganador —y del perdedor, en doble eliminación— al
partido siguiente.

### Inscripciones y pagos
Cada jugador se anota solo o con equipo. El organizador ve la lista con elo,
zona horaria y estado, y marca a mano quién pagó. No hay cobro automático: se
guarda el link de pago y el organizador confirma.

### Equipos del organizador
En la pestaña *Equipos* el organizador puede armar equipos vacíos ("Los
Tercios", "Halcones"…). Los jugadores piden lugar en uno —al inscribirse o
después— y el organizador aprueba o rechaza cada pedido; el primero que entra
queda de capitán. Nadie se suma solo a esos equipos y el capitán no puede
agregar gente (sí sacarla). Si un jugador se va, el lugar queda libre. Los
equipos que siguen vacíos no entran a las llaves.

### Premios
La bolsa puede ser un **monto fijo** que pone la organización o salir de **lo
recaudado en inscripciones** (con un porcentaje configurable: el resto queda
para la organización). Cada puesto se carga con nombre, monto fijo o porcentaje
de la bolsa, y un premio extra no monetario. La ficha del torneo muestra el
reparto ya resuelto en plata y, cuando la bolsa sale de las inscripciones, cómo
va creciendo con cada pago confirmado.

### Armador de equipos
Para los que se anotan sueltos. Reparte en serpiente por rating y después
mejora con intercambios para que los equipos queden **parejos de nivel**. No
mira horarios: al armar los equipos todavía no hay ronda. La propuesta se puede
regenerar las veces que haga falta y recién después se confirma.

### Horarios
Los horarios se cargan en el torneo, **por ronda**. El organizador fija desde
qué día hasta qué día se juega cada ronda (pestaña Llaves) y cada jugador pinta,
en un calendario con esas fechas, cuándo puede jugar: barras de 30 minutos, de
00:00 a 24:00, en su zona horaria (pestaña Horarios). Se guarda en UTC. Si su
equipo pasa a la ronda siguiente, carga de nuevo para esa ronda.

Con eso, desde la sala del partido, "Buscar horario" cruza los horarios de los
jugadores de los dos equipos en esa ronda y propone:

- las **ventanas** en las que pueden todos, con la fecha real,
- y, si no hay ninguna, las ventanas en las que *falta uno solo*, diciendo quién.

El capitán agenda con un clic sobre la ventana, o pone la fecha a mano. Sin
fechas de ronda o sin horarios cargados, el partido se agenda a mano igual.

### Sala del partido
Pantalla partida: a la izquierda el chat con dos pestañas —**sala del partido**
(la ven los dos equipos) y **mi equipo** (privada, para armar estrategia)—, a la
derecha el tablero de draft. Todo en vivo por WebSocket: mensajes, presencia y
cada paso del draft.

### Draft
El plan de pasos se arma al abrir el draft y los dos equipos ven la misma
secuencia. Hay reloj por paso; si se vence, el servidor elige al azar entre lo
legal.

El organizador puede **fijar el mapa de la primera partida**: en series impares
es lo habitual, así nadie arranca con ventaja de mapa. De la partida 2 en
adelante se aplica la regla elegida.

**Mapa**
- `fijo` — el mismo mapa en todas las partidas.
- `aleatorio` — sale del pool.
- `ban_hasta_uno` — bans alternados hasta que queda uno (el más usado).
- `ban_pick` — cada equipo banea N y después uno elige.

**Civilizaciones**
- `libre` — se declaran después.
- `aleatorio` — sorteo.
- `snake` — bans opcionales y después draft en serpiente.
- `ciega` — los dos equipos eligen a la vez y se revela al final.

El patrón de la serpiente es configurable (`1-2-2-1`, etc.). Por defecto los
bordes eligen de a uno y el medio de a dos: `1-1` en 1v1, `1-2-1` en 2v2,
`1-2-2-1` en 3v3, `1-2-2-2-1` en 4v4.

Reglas que se activan por torneo:

- repetir o no la misma civ dentro de un equipo,
- permitir o no espejos entre equipos,
- repetir o no civs entre partidas de la misma serie,
- repetir o no el mapa dentro de la serie.

Dos detalles que ya vienen puestos porque hacen el draft más justo:

1. **Contrapick de mapa.** En `ban_pick`, el equipo que *no* eligió el mapa
   arranca el draft de civs. Quien se queda con la ventaja del mapa cede la
   ventaja del primer pick.
2. **En la partida 2 en adelante arranca el que va perdiendo.** Compensa la
   serie sin tocar las reglas.

Si más adelante querés algo todavía más parejo, la variante estándar en otros
juegos es *doble serpiente*: `A-BB-AA-B` repetido, con un ban global de civs
antes de empezar. Se puede escribir hoy mismo como patrón sin tocar código.

### Cuentas
Se entra con **Steam** (OpenID 2.0, sin dependencias) o con **Google** (OAuth 2.0).
No hay registro ni contraseñas: la primera vez se crea el perfil solo, y las dos
cuentas se pueden vincular entre sí. Hay campos para Discord, gamertag de Xbox
y elo 1v1 / equipos.

## Cómo está armado

```
server/           API Express + WebSocket, SQLite (node:sqlite, sin dependencias nativas)
  src/schema.sql  esquema completo
  src/draft.js    motor de draft (plan de pasos, reglas, relojes)
  src/brackets.js llaves, grupos, suizo y avance de resultados
  src/teambuilder.js  armador de equipos
  src/availability.js cruce de horarios
  src/realtime.js salas de chat y empuje del draft
web/              Vite + React + TypeScript + Tailwind
tools/            descarga de assets
```

La base es un único archivo SQLite; no hace falta levantar nada más.

## Assets

Las banderas de las 24 civilizaciones y los 174 minimapas se bajan de
[freefoodparty.com](https://freefoodparty.com) con `npm run assets` y quedan en
`server/public/assets/`. No están versionados: son material del juego y se
descargan en cada instalación.

## Publicarlo

Hay dos caminos, los dos arrancan con la base vacía y se siembran solos con
`SEED_DEMO=1`:

- **Render** — el botón de arriba importa este repo y lee el `render.yaml` que ya
  está. Plan free: el servicio se duerme tras 15 minutos sin visitas (el primer
  acceso tarda ~1 minuto en despertar) y el disco es efímero, así que cada
  deploy vuelve a sembrar la demo. Para un torneo de verdad hace falta un disco:
  descomentá el bloque `disk` del `render.yaml` y apuntá `AOEMATCH_DB` ahí.
- **Docker** — `docker build -t aoematch . && docker run -p 3001:3001 aoematch`.
  Sirve para cualquier hosting que corra contenedores (Fly, Railway, un VPS).

El build descarga las imágenes del juego con `npm run assets`, así que la
primera compilación tarda un par de minutos.

## Ideas para seguir

- Parsear replays (`.age3Yrec`) para autocompletar resultado, mapa y civs.
- Traer elo real desde el leaderboard oficial en vez de cargarlo a mano.
- Webhook de Discord: avisar draft abierto, partido agendado y resultados.
- Cobro real con Mercado Pago / PayPal en vez de marcar el pago a mano.
- Veto de horarios por equipo (no solo por jugador) y recordatorios por mail.
- Página pública de un equipo con historial de civs y mapas jugados.
