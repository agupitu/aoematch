import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  type OrdenManual, confirmarEquipos, generarLlaves, generarPlayoffs, proponerEquiposDelTorneo, siguienteRondaSuiza,
} from '../datos/llaves';
import { actualizarTorneo, detalleTorneo } from '../datos/torneos';
import {
  aprobarPedido, borrarEquipoDelOrganizador, cancelarPedido, crearEquipoDelOrganizador, pedirLugar,
  rechazarPedido, renombrarEquipo,
} from '../datos/equipos';
import { type PagoElegido, inscribirse, marcarInscripcion, retirarse, sacarMiembro } from '../datos/inscripciones';
import { pedidosPendientes } from '../logica/equipos.js';
import { civs as catalogoCivs, maps as catalogoMapas } from '../logica/catalogo.js';
import { costosDe, montoEscrito, opcionesDePago } from '../logica/pagos.js';
import { etiquetaDeSerie } from '../logica/series.js';
import { useAuth } from '../auth';
import { Alerta, Avatar, Badge, Empty, Modal, Spinner, Tabs } from '../components/ui';
import { ArmadoManual } from '../components/ArmadoManual';
import { CalendarioDelTorneo } from '../components/CalendarioDelTorneo';
import { CivsHabilitadas } from '../components/CivsHabilitadas';
import { FechasDeRonda } from '../components/FechasDeRonda';
import { Fases } from '../components/Fases';
import { MatchCalendar } from '../components/MatchCalendar';
import { MisHorarios } from '../components/MisHorarios';
import { TournamentForm, medioVacio, type Borrador, type PestaniaForm } from '../components/TournamentForm';
import { ChatPanel } from '../components/ChatPanel';
import { useChat, useConectado } from '../live';
import { usePresencia } from '../presence';
import {
  ETIQUETA_ESTADO, ETIQUETA_FORMATO,
  costo, costosEnTexto, fechaCorta, monto, zonaDelNavegador,
} from '../lib';
import type { Civ, GameMap, PagoMedio, Registration, Team, Tournament, User } from '../types';

type Pestania = 'resumen' | 'inscripciones' | 'equipos' | 'llaves' | 'horarios' | 'chat' | 'config';

/** Las que se pueden pedir con `?tab=` (por ejemplo desde la sala de un partido). */
const PESTANIAS_POR_URL: Pestania[] = ['resumen', 'inscripciones', 'equipos', 'llaves', 'horarios', 'chat'];

export function TournamentPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const pedida = params.get('tab') as Pestania | null;
  const [t, setT] = useState<Tournament | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Pestania>(pedida && PESTANIAS_POR_URL.includes(pedida) ? pedida : 'resumen');

  const cargar = useCallback(async () => {
    try {
      setT(await detalleTorneo(slug!, user?.id ?? null));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [slug, user?.id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <div className="mx-auto max-w-3xl p-10"><Alerta>{error}</Alerta></div>;
  if (!t) return <Spinner />;

  const staff = !!t.me?.is_staff;
  const inscripto = t.me?.registration && t.me.registration.status !== 'retirada';

  const tabs: { id: Pestania; label: string; count?: number }[] = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'inscripciones', label: 'Inscripciones', count: t.registrations.filter((r) => r.status !== 'retirada').length },
    { id: 'equipos', label: 'Equipos', count: t.teams.length },
    { id: 'llaves', label: t.format === 'liga' ? 'Tabla' : 'Llaves', count: t.matches.length || undefined },
    { id: 'horarios', label: 'Horarios' },
    { id: 'chat', label: 'Chat' },
    ...(staff ? [{ id: 'config' as const, label: 'Configuración' }] : []),
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h1 className="title text-3xl">{t.name}</h1>
              <Badge tone={t.status === 'en_curso' ? 'good' : t.status === 'inscripcion' ? 'gold' : 'neutral'}>
                {ETIQUETA_ESTADO[t.status] ?? t.status}
              </Badge>
            </div>
            <p className="text-sm text-parch-400">
              {ETIQUETA_FORMATO[t.format]} · {t.team_size}v{t.team_size} · {etiquetaDeSerie(t)} · organiza{' '}
              <span className="text-parch-200">{t.organizer.display_name}</span>
            </p>
          </div>
          <AccionesInscripcion t={t} user={user} onDone={cargar} />
        </div>
        {t.description && <p className="hint mt-3 max-w-3xl text-sm">{t.description}</p>}
      </header>

      <Tabs value={tab} onChange={setTab} items={tabs} />

      <div className="py-6">
        {tab === 'resumen' && <Resumen t={t} />}
        {tab === 'inscripciones' && <Inscripciones t={t} onDone={cargar} />}
        {tab === 'equipos' && <Equipos t={t} onDone={cargar} />}
        {tab === 'llaves' && <Llaves t={t} onDone={cargar} />}
        {tab === 'horarios' && <Horarios t={t} />}
        {tab === 'chat' && <ChatTorneo t={t} puedeEscribir={!!inscripto || staff} />}
        {tab === 'config' && <Config t={t} onDone={cargar} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- acciones

function AccionesInscripcion({
  t,
  user,
  onDone,
}: {
  t: Tournament;
  user: User | null;
  onDone: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nombreEquipo, setNombreEquipo] = useState('');
  const [equipoId, setEquipoId] = useState('');
  const [error, setError] = useState('');

  if (!user) {
    return (
      <Link to="/entrar" className="btn btn-primary">
        Entrar para inscribirse
      </Link>
    );
  }

  const reg = t.me?.registration;
  const activa = reg && reg.status !== 'retirada';
  const abiertoAhora = ['inscripcion', 'armado'].includes(t.status);
  const costos = costosDe(t);

  const inscribir = async (kind: 'solo' | 'equipo') => {
    setError('');
    try {
      await inscribirse(t, user, {
        kind,
        team_name: nombreEquipo || undefined,
        team_id: equipoId || undefined,
      });
      setAbierto(false);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {costos.length > 0 && (
        <Badge tone={reg?.paid ? 'good' : 'gold'}>
          {costosEnTexto(costos)}
          {activa && (reg?.paid ? ' · pagado' : ' · impago')}
        </Badge>
      )}
      {activa ? (
        <>
          <Badge tone="good">Inscripto{reg?.team_name ? ` · ${reg.team_name}` : ''}</Badge>
          {reg?.join_request?.status === 'pendiente' && (
            <Badge tone="gold">Pedido a {t.teams.find((te) => te.id === reg.join_request?.team_id)?.name ?? 'un equipo'}</Badge>
          )}
          <button
            className="btn btn-danger"
            onClick={async () => {
              await retirarse(t, user.id);
              onDone();
            }}
          >
            Retirarme
          </button>
        </>
      ) : abiertoAhora ? (
        <button className="btn btn-primary" onClick={() => setAbierto(true)}>
          Inscribirme
        </button>
      ) : null}

      <Modal open={abierto} onClose={() => setAbierto(false)} title={`Inscripción · ${t.name}`}>
        <div className="space-y-4">
          {costos.length > 0 && (
            <Alerta tone="info">
              {costos.length === 1 ? `Costo: ${costosEnTexto(costos)}.` : 'El costo depende del medio de pago:'}
              {t.payment_methods.length > 0 && (
                <div className="my-2">
                  <ComoPagar medios={t.payment_methods} conCosto={costos.length > 1} />
                </div>
              )}
              {t.payment_notes && <span className="mt-1 block text-parch-400">{t.payment_notes}</span>}
              <span className="mt-1 block text-parch-400">
                El organizador marca el pago a mano cuando lo recibe.
              </span>
            </Alerta>
          )}

          {t.team_size === 1 ? (
            <button className="btn btn-primary w-full" onClick={() => inscribir('solo')}>
              Anotarme
            </button>
          ) : (
            <>
              <div>
                <label className="label">Crear un equipo nuevo</label>
                <div className="flex gap-2">
                  <input
                    className="field"
                    placeholder={`Nombre del equipo (${t.team_size} jugadores)`}
                    value={nombreEquipo}
                    onChange={(e) => setNombreEquipo(e.target.value)}
                  />
                  <button className="btn btn-primary" disabled={!nombreEquipo} onClick={() => inscribir('equipo')}>
                    Crear
                  </button>
                </div>
              </div>

              {t.teams.length > 0 && (
                <div>
                  <label className="label">O sumarme a uno existente</label>
                  <div className="flex gap-2">
                    <select className="field" value={equipoId} onChange={(e) => setEquipoId(e.target.value)}>
                      <option value="">Elegir equipo…</option>
                      {t.teams
                        .filter((te) => te.members.length < t.team_size)
                        .map((te) => (
                          <option key={te.id} value={te.id}>
                            {te.name} ({te.members.length}/{t.team_size}){te.staff_made ? ' · con aprobación' : ''}
                          </option>
                        ))}
                    </select>
                    <button className="btn btn-primary" disabled={!equipoId} onClick={() => inscribir('equipo')}>
                      {t.teams.find((te) => te.id === equipoId)?.staff_made ? 'Pedir lugar' : 'Sumarme'}
                    </button>
                  </div>
                  {t.teams.some((te) => te.staff_made) && (
                    <p className="hint mt-1 text-xs">
                      En los equipos “con aprobación” pedís lugar y el organizador decide quién entra.
                    </p>
                  )}
                </div>
              )}

              {!!t.allow_solo && (
                <div className="border-t border-ink-700 pt-4">
                  <p className="mb-2 text-sm text-parch-400">
                    ¿No tenés compañeros? Anotate solo y el organizador te asigna a un equipo parejo de nivel y
                    con horarios compatibles.
                  </p>
                  <button className="btn btn-ghost w-full" onClick={() => inscribir('solo')}>
                    Anotarme sin equipo
                  </button>
                </div>
              )}
            </>
          )}

          {error && <Alerta>{error}</Alerta>}
        </div>
      </Modal>
    </div>
  );
}

// ----------------------------------------------------------------- resumen

function Resumen({ t }: { t: Tournament }) {
  const pagos = t.registrations.filter((r) => r.paid).length;
  const activos = t.registrations.filter((r) => r.status !== 'retirada');
  const costos = costosDe(t);

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Premios t={t} />

        <section className="card p-5">
          <h3 className="title mb-3 text-lg">Reglas del draft</h3>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Dato k="Primer mapa" v={t.first_map ? t.first_map.name_es : 'Al azar'} />
            <Dato k="Mapas siguientes" v="Los elige el que perdió la partida anterior" />
            <Dato k="Bans de civ por equipo" v={t.civ_bans ? String(t.civ_bans) : 'sin bans'} />
            <Dato k="Pick de civs" v="Ciego" />
            <Dato k="Repetir civ en el equipo" v={t.civ_repeat_team === 0 ? 'prohibido' : 'permitido'} />
            <Dato k="Repetir civ contra el mismo rival" v={t.civ_repeat_series ? 'permitido' : 'prohibido'} />
            <Dato k="Repetir mapa contra el mismo rival" v={t.map_repeat ? 'permitido' : 'prohibido'} />
          </dl>
        </section>

        <section className="card p-5">
          <h3 className="title mb-3 text-lg">Pool de mapas ({t.maps.length})</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2">
            {t.maps.map((m) => (
              <figure key={m.id} className="text-center">
                <img src={m.img} alt="" className="aspect-square w-full rounded-lg border border-ink-700 object-cover" />
                <figcaption className="mt-1 truncate text-[11px] text-parch-400">{m.name_es}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <CivsHabilitadas pool={t.civs} />

        {t.rules_md && (
          <section className="card p-5">
            <h3 className="title mb-3 text-lg">Reglamento</h3>
            <pre className="font-sans text-sm whitespace-pre-wrap text-parch-200">{t.rules_md}</pre>
          </section>
        )}
      </div>

      <aside className="space-y-5">
        <section className="card p-5">
          <h3 className="title mb-3 text-lg">Números</h3>
          <dl className="space-y-2">
            <Dato k="Inscriptos" v={String(activos.length)} />
            <Dato k="Equipos" v={String(t.teams.length)} />
            <Dato k="Sueltos" v={String(activos.filter((r) => !r.team_id).length)} />
            <Dato k="Inscripción" v={costosEnTexto(costos)} />
            {costos.length > 0 && <Dato k="Pagaron" v={`${pagos} de ${activos.length}`} />}
            {(t.prizes.length > 0 || t.prize_pool.total_cents > 0) && (
              <Dato
                k="Premios"
                v={monto(Math.max(t.prize_pool.total_cents, t.prize_pool.assigned_cents), t.currency)}
              />
            )}
            <Dato k="Cierre de inscripción" v={fechaCorta(t.reg_closes_at)} />
            <Dato k="Arranca" v={fechaCorta(t.starts_at)} />
          </dl>
        </section>

        <CalendarioDelTorneo t={t} />

        {t.payment_methods.length > 0 && (
          <section className="card p-5">
            <h3 className="title mb-3 text-lg">Cómo pagar</h3>
            <ComoPagar medios={t.payment_methods} conCosto={costos.length > 1} />
          </section>
        )}
      </aside>
    </div>
  );
}

function Premios({ t }: { t: Tournament }) {
  if (!t.prizes.length && !t.prize_pool.total_cents) return null;
  const enJuego = Math.max(t.prize_pool.total_cents, t.prize_pool.assigned_cents);
  // Lo cobrado en otra moneda no suma a la bolsa.
  const otras = t.prize_pool.collected_by_currency.filter((c) => c.currency !== t.currency);

  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h3 className="title text-lg">Premios</h3>
        <span className="font-display text-2xl text-gold-400">{monto(enJuego, t.currency)}</span>
        <span className="text-xs text-parch-400">
          {t.prize_pool_mode === 'inscripciones'
            ? `${t.prize_pool_pct}% de lo recaudado · ${t.prize_pool.paid_count} inscripciones pagas`
            : t.prize_pool_mode === 'fijo'
              ? 'bolsa fija de la organización'
              : 'premios cargados a mano'}
        </span>
      </div>

      {t.prizes.length === 0 ? (
        <p className="text-sm text-parch-400">Todavía no se publicó el reparto.</p>
      ) : (
        <ol className="space-y-2">
          {t.prizes.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-baseline gap-x-3 rounded-lg border border-ink-700 px-3 py-2"
            >
              <span className="font-display text-gold-400">{p.position}º</span>
              <span className="text-sm text-parch-100">{p.label}</span>
              <span className="ml-auto text-sm text-parch-200">
                {monto(p.value_cents, t.currency)}
                {p.kind === 'porcentaje' && <span className="text-parch-400"> · {p.percent}%</span>}
              </span>
              {p.extra && <span className="w-full text-xs text-parch-400">{p.extra}</span>}
            </li>
          ))}
        </ol>
      )}

      {t.prize_pool_mode === 'inscripciones' && (
        <p className="mt-3 text-xs text-parch-400">
          La bolsa crece con cada inscripción paga: hoy son {monto(t.prize_pool.collected_cents, t.currency)}{' '}
          recaudados en {t.currency}.
          {otras.length > 0 &&
            ` Lo cobrado en ${otras.map((c) => costo(c.amount_cents, c.currency)).join(' y ')} no suma a la bolsa.`}
        </p>
      )}
      {t.prize_notes && <p className="mt-2 text-xs text-parch-400">{t.prize_notes}</p>}
    </section>
  );
}

/** Un texto (el alias) que se copia con un clic. */
function CopiarTexto({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className="text-xs text-gold-400 hover:underline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        } catch {
          // Sin permiso para el portapapeles: se copia a mano.
        }
      }}
    >
      {copiado ? 'Copiado' : 'Copiar'}
    </button>
  );
}

/**
 * Cómo pagar la inscripción: cada medio con su titular, su alias (que se copia) y su link.
 * Con `conCosto`, también lo que cobra cada uno (cuando los medios piden montos distintos).
 */
function ComoPagar({ medios, conCosto = false }: { medios: PagoMedio[]; conCosto?: boolean }) {
  return (
    <ul className="space-y-2">
      {medios.map((m, i) => (
        <li key={i} className="rounded-lg border border-ink-700 px-3 py-2 text-sm">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 font-medium text-parch-100">
            {m.method ?? 'Pago'}
            {conCosto && m.amount_cents && m.currency && (
              <span className="font-display text-gold-400">{costo(m.amount_cents, m.currency)}</span>
            )}
          </p>
          {m.name && <p className="text-parch-200">{m.name}</p>}
          {m.alias && (
            <p className="flex flex-wrap items-center gap-2 text-parch-200">
              <span className="text-parch-400">Alias</span>
              <code className="rounded bg-ink-800 px-1.5 py-0.5 text-parch-100">{m.alias}</code>
              <CopiarTexto texto={m.alias} />
            </p>
          )}
          {m.url && (
            <a className="text-gold-400 underline" href={m.url} target="_blank" rel="noreferrer">
              Abrir link de pago
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-parch-400">{k}</dt>
      <dd className="text-right text-parch-100">{v}</dd>
    </div>
  );
}

// ------------------------------------------------------------ inscripciones

/** Lo que anotó el staff al marcar el pago: "US$ 5 · PayPal". */
function detalleDelPago(r: Registration) {
  const cobrado = r.paid_amount_cents && r.paid_currency ? costo(r.paid_amount_cents, r.paid_currency) : null;
  return [cobrado, r.paid_method].filter(Boolean).join(' · ');
}

/** Marcar un pago: con un solo medio es un botón; con varios, se elige por cuál pagó. */
function MarcarPagado({ opciones, onElegir }: { opciones: PagoElegido[]; onElegir: (pago: PagoElegido) => void }) {
  if (opciones.length <= 1) {
    return (
      <button className="btn btn-ghost !px-2 !py-1" onClick={() => onElegir(opciones[0])}>
        Marcar pagado
      </button>
    );
  }
  return (
    <select
      className="field !w-auto !px-2 !py-1"
      value=""
      aria-label="Marcar pagado por"
      onChange={(e) => onElegir(opciones[Number(e.target.value)])}
    >
      <option value="" disabled>
        Marcar pagado…
      </option>
      {opciones.map((o, i) => (
        <option key={i} value={i}>
          {o.method ?? 'Pago'}
          {o.amount_cents && o.currency ? ` · ${costo(o.amount_cents, o.currency)}` : ''}
        </option>
      ))}
    </select>
  );
}

function Inscripciones({ t, onDone }: { t: Tournament; onDone: () => void }) {
  const staff = !!t.me?.is_staff;
  const filas = t.registrations.filter((r) => r.status !== 'retirada');
  const costos = costosDe(t);
  const opciones: PagoElegido[] = opcionesDePago(t);
  const recaudado = t.prize_pool.collected_by_currency.map((c) => costo(c.amount_cents, c.currency)).join(' · ');

  const marcar = async (r: Registration, campos: { status?: string; paid?: boolean; pago?: PagoElegido }) => {
    await marcarInscripcion(t, r, campos);
    onDone();
  };

  if (!filas.length) return <Empty>Todavía no se anotó nadie.</Empty>;

  return (
    <div className="card overflow-x-auto">
      {staff && costos.length > 0 && (
        <p className="border-b border-ink-700 p-3 text-sm text-parch-400">
          Recaudado: <span className="text-parch-100">{recaudado || '—'}</span> · pagaron{' '}
          {filas.filter((r) => r.paid).length} de {filas.length}
        </p>
      )}
      <table className="w-full text-sm">
        <thead className="border-b border-ink-700 text-left text-xs tracking-wide text-parch-400 uppercase">
          <tr>
            <th className="p-3">Jugador</th>
            <th className="p-3">Equipo</th>
            <th className="p-3">Elo</th>
            <th className="p-3">Zona</th>
            <th className="p-3">Estado</th>
            <th className="p-3">Pago</th>
            {staff && <th className="p-3" />}
          </tr>
        </thead>
        <tbody>
          {filas.map((r) => (
            <tr key={r.id} className="border-b border-ink-800 last:border-0">
              <td className="p-3">
                <span className="flex items-center gap-2">
                  <Avatar src={r.avatar_url} name={r.display_name} size={24} />
                  {r.display_name}
                </span>
              </td>
              <td className="p-3 text-parch-400">
                {r.team_name ?? (
                  <span className="italic">
                    suelto
                    {r.join_request?.status === 'pendiente' &&
                      ` · pide lugar en ${t.teams.find((te) => te.id === r.join_request?.team_id)?.name ?? 'un equipo'}`}
                  </span>
                )}
              </td>
              <td className="p-3 text-parch-400">{r.rating_team ?? r.rating_1v1 ?? '—'}</td>
              <td className="p-3 text-xs text-parch-400">{r.timezone}</td>
              <td className="p-3">
                <Badge tone={r.status === 'confirmada' ? 'good' : r.status === 'rechazada' ? 'bad' : 'neutral'}>
                  {r.status}
                </Badge>
              </td>
              <td className="p-3">
                {costos.length === 0 ? (
                  <span className="text-parch-400">—</span>
                ) : (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={r.paid ? 'good' : 'bad'}>{r.paid ? 'pagado' : 'impago'}</Badge>
                    {r.paid && <span className="text-xs text-parch-400">{detalleDelPago(r)}</span>}
                  </span>
                )}
              </td>
              {staff && (
                <td className="p-3">
                  <div className="flex justify-end gap-1.5">
                    {costos.length > 0 &&
                      (r.paid ? (
                        <button className="btn btn-ghost !px-2 !py-1" onClick={() => marcar(r, { paid: false })}>
                          Marcar impago
                        </button>
                      ) : (
                        <MarcarPagado opciones={opciones} onElegir={(pago) => marcar(r, { paid: true, pago })} />
                      ))}
                    {r.status !== 'confirmada' && (
                      <button
                        className="btn btn-ghost !px-2 !py-1"
                        onClick={() => marcar(r, { status: 'confirmada' })}
                      >
                        Confirmar
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ equipos

type Propuesta = {
  score: number;
  teams: { name: string; avg_rating: number; members: { id: string; display_name: string; rating: number | null }[] }[];
  leftovers: { id: string; display_name: string }[];
  note?: string;
};

function Equipos({ t, onDone }: { t: Tournament; onDone: () => void }) {
  const staff = !!t.me?.is_staff;
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  // Quien pidió lugar en un equipo del organizador espera ese lugar: el armador no lo reparte.
  const sueltos = t.registrations.filter(
    (r) => r.status !== 'retirada' && !r.team_id && r.join_request?.status !== 'pendiente'
  );

  const proponer = async () => {
    setError('');
    setCargando(true);
    try {
      setPropuesta((await proponerEquiposDelTorneo(t)) as Propuesta);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="space-y-6">
      <MiPedido t={t} onDone={onDone} />

      {staff && t.team_size > 1 && <EquiposDelOrganizador t={t} onDone={onDone} />}

      {t.team_size > 1 && staff && (
        <section className="card p-5">
          <h3 className="title mb-1 text-lg">Armador de equipos</h3>
          <p className="mb-4 text-sm text-parch-400">
            Reparte a los {sueltos.length} jugadores sueltos buscando equipos parejos de nivel. Podés regenerar
            hasta que te guste y recién ahí confirmás.
          </p>

          <div className="mb-4 flex flex-wrap items-end gap-4">
            <button className="btn btn-primary" onClick={proponer} disabled={cargando || sueltos.length < t.team_size}>
              {propuesta ? 'Regenerar' : 'Proponer equipos'}
            </button>
            {propuesta && propuesta.teams.length > 0 && (
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  setError('');
                  try {
                    await confirmarEquipos(t, propuesta);
                    setPropuesta(null);
                    onDone();
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                Confirmar y crear
              </button>
            )}
          </div>

          {error && <Alerta>{error}</Alerta>}

          {propuesta && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {propuesta.teams.map((p, i) => (
                <div key={i} className="rounded-lg border border-ink-700 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <strong className="text-sm text-parch-100">{p.name}</strong>
                    <span className="text-xs text-parch-400">Elo {p.avg_rating}</span>
                  </div>
                  <ul className="space-y-1 text-sm text-parch-200">
                    {p.members.map((m) => (
                      <li key={m.id} className="flex justify-between gap-2">
                        <span className="truncate">{m.display_name}</span>
                        <span className="text-xs text-parch-400">{m.rating ?? '—'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {propuesta.leftovers.length > 0 && (
                <div className="rounded-lg border border-dashed border-ink-700 p-3">
                  <strong className="text-sm text-parch-400">Sin equipo</strong>
                  <ul className="mt-2 space-y-1 text-sm text-parch-400">
                    {propuesta.leftovers.map((m) => (
                      <li key={m.id}>{m.display_name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {t.teams.length === 0 ? (
        <Empty>Todavía no hay equipos.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {t.teams.map((te) => (
            <TeamCard key={te.id} t={t} team={te} onDone={onDone} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Lo que el jugador tiene en curso: un pedido de ingreso esperando respuesta, o uno que el organizador rechazó. */
function MiPedido({ t, onDone }: { t: Tournament; onDone: () => void }) {
  const { user } = useAuth();
  const [error, setError] = useState('');
  const pedido = t.me?.registration?.status !== 'retirada' ? t.me?.registration?.join_request : null;
  if (!user || !pedido) return null;
  const equipo = t.teams.find((te) => te.id === pedido.team_id)?.name ?? 'un equipo que ya no existe';
  const pendiente = pedido.status === 'pendiente';

  return (
    <div className="space-y-2">
      <Alerta tone={pendiente ? 'info' : 'bad'}>
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {pendiente
              ? `Pediste lugar en ${equipo}. El organizador decide si entrás.`
              : `El organizador rechazó tu pedido para ${equipo}. Podés pedir lugar en otro equipo.`}
          </span>
          <button
            className="btn btn-ghost !px-2 !py-1"
            onClick={async () => {
              setError('');
              try {
                await cancelarPedido(t, user.id);
                onDone();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            {pendiente ? 'Cancelar pedido' : 'Entendido'}
          </button>
        </span>
      </Alerta>
      {error && <Alerta>{error}</Alerta>}
    </div>
  );
}

/** El organizador arma equipos vacíos y resuelve los pedidos de ingreso de los jugadores. */
function EquiposDelOrganizador({ t, onDone }: { t: Tournament; onDone: () => void }) {
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const pedidos = pedidosPendientes(t.registrations) as Registration[];
  const completo = !!t.max_teams && t.teams.length >= t.max_teams;

  const hacer = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="card p-5">
      <h3 className="title mb-1 text-lg">Equipos del organizador</h3>
      <p className="mb-4 text-sm text-parch-400">
        Armá los equipos vacíos: los jugadores piden lugar y vos aprobás quién entra. El primero que entra queda de
        capitán. Los equipos vacíos entran igual a las llaves: los jugadores se pueden sumar después.
      </p>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void hacer(async () => {
            await crearEquipoDelOrganizador(t, nombre);
            setNombre('');
          });
        }}
      >
        <div className="min-w-0 flex-1">
          <label className="label">Nombre del equipo</label>
          <input className="field" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Los Tercios" />
        </div>
        <button className="btn btn-primary" disabled={!nombre.trim() || completo}>
          Agregar equipo
        </button>
      </form>
      {t.max_teams && (
        <p className="hint mt-2 text-xs">
          {t.teams.length} de {t.max_teams} equipos{completo ? ': ya están todos' : ''}.
        </p>
      )}
      {error && (
        <div className="mt-3">
          <Alerta>{error}</Alerta>
        </div>
      )}

      {pedidos.length > 0 && (
        <div className="mt-5">
          <h4 className="label">Pedidos de ingreso ({pedidos.length})</h4>
          <ul className="space-y-2">
            {pedidos.map((r) => {
              const equipo = t.teams.find((te) => te.id === r.join_request?.team_id);
              const lleno = !!equipo && equipo.members.length >= t.team_size;
              return (
                <li key={r.user_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-700 p-3">
                  <Avatar src={r.avatar_url} name={r.display_name} size={24} />
                  <span className="text-sm text-parch-100">{r.display_name}</span>
                  <span className="text-xs text-parch-400">{r.rating_team ?? r.rating_1v1 ?? '—'}</span>
                  <span className="text-sm text-parch-400">
                    quiere entrar a <strong className="text-parch-200">{equipo?.name ?? 'un equipo borrado'}</strong>
                    {equipo && ` (${equipo.members.length}/${t.team_size})`}
                  </span>
                  <div className="ml-auto flex gap-1.5">
                    <button
                      className="btn btn-primary !px-3 !py-1"
                      disabled={!equipo || lleno}
                      title={lleno ? 'El equipo ya está completo' : undefined}
                      onClick={() => hacer(() => aprobarPedido(t, r.user_id))}
                    >
                      Aprobar
                    </button>
                    <button className="btn btn-ghost !px-3 !py-1" onClick={() => hacer(() => rechazarPedido(t, r.user_id))}>
                      Rechazar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function TeamCard({ t, team, onDone }: { t: Tournament; team: Team; onDone: () => void }) {
  const { user } = useAuth();
  const staff = !!t.me?.is_staff;
  const esMio = t.me?.team_id === team.id;
  const delOrganizador = !!team.staff_made;
  const libres = Math.max(0, t.team_size - team.members.length);
  const miPedido = t.me?.registration?.status !== 'retirada' ? t.me?.registration?.join_request : null;
  const pedidoAca = miPedido?.team_id === team.id && miPedido.status === 'pendiente';
  const pedidos = pedidosPendientes(t.registrations).filter((r: Registration) => r.join_request?.team_id === team.id).length;
  const puedePedir =
    delOrganizador && !!user && !t.me?.team_id && libres > 0 && ['inscripcion', 'armado'].includes(t.status);

  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(team.name);
  const [error, setError] = useState('');

  const hacer = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          {editando ? (
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void hacer(async () => {
                  await renombrarEquipo(team.id, nombre);
                  setEditando(false);
                });
              }}
            >
              <input className="field !py-1" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
              <button className="btn btn-primary !px-2 !py-1">Guardar</button>
              <button
                type="button"
                className="btn btn-ghost !px-2 !py-1"
                onClick={() => {
                  setEditando(false);
                  setNombre(team.name);
                }}
              >
                ✕
              </button>
            </form>
          ) : (
            <h4 className="title text-base">{team.name}</h4>
          )}
          <p className="text-xs text-parch-400">
            {team.members.length}/{t.team_size} jugadores
            {team.seed ? ` · siembra ${team.seed}` : ''}
            {team.auto_built ? ' · armado automático' : ''}
            {pedidos > 0 && ` · ${pedidos} ${pedidos === 1 ? 'pedido' : 'pedidos'}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {esMio && <Badge tone="gold">Tu equipo</Badge>}
          {delOrganizador && <Badge>Del organizador</Badge>}
        </div>
      </div>

      <ul className="space-y-1.5">
        {team.members.map((m) => (
          <li key={m.id} className="flex items-center gap-2 text-sm">
            <Avatar src={m.avatar_url} name={m.display_name} size={22} />
            <span className="min-w-0 flex-1 truncate text-parch-200">{m.display_name}</span>
            {m.role === 'capitan' && <Badge>capitán</Badge>}
            <span className="text-xs text-parch-400">{m.rating_team ?? m.rating_1v1 ?? '—'}</span>
            {(staff || esMio) && (
              <button
                className="text-xs text-parch-400 hover:text-blood-500"
                title="Sacar del equipo"
                onClick={() => hacer(() => sacarMiembro(t, team.id, m.id))}
              >
                ✕
              </button>
            )}
          </li>
        ))}
        {delOrganizador &&
          Array.from({ length: libres }, (_, i) => (
            <li key={`libre${i}`} className="rounded-lg border border-dashed border-ink-700 px-2 py-1 text-sm text-ink-600 italic">
              Lugar libre
            </li>
          ))}
      </ul>

      {(puedePedir || (delOrganizador && staff)) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {puedePedir && (
            <button
              className="btn btn-primary !px-3 !py-1"
              disabled={pedidoAca}
              onClick={() => hacer(() => pedirLugar(t, user!, team.id))}
            >
              {pedidoAca ? 'Pedido enviado' : miPedido ? 'Cambiar mi pedido a este equipo' : 'Pedir lugar'}
            </button>
          )}
          {delOrganizador && staff && !editando && (
            <>
              <button className="btn btn-ghost !px-2 !py-1" onClick={() => setEditando(true)}>
                Renombrar
              </button>
              <button
                className="btn btn-danger !px-2 !py-1"
                disabled={team.members.length > 0}
                title={team.members.length ? 'Sacá a los jugadores primero' : undefined}
                onClick={() => {
                  if (confirm(`¿Borrar el equipo ${team.name}?`)) void hacer(() => borrarEquipoDelOrganizador(t, team));
                }}
              >
                Borrar
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <div className="mt-2">
          <Alerta>{error}</Alerta>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ llaves

function Llaves({ t, onDone }: { t: Tournament; onDone: () => void }) {
  const staff = !!t.me?.is_staff;
  const [error, setError] = useState('');

  const [mensaje, setMensaje] = useState('');
  const [armando, setArmando] = useState(false);
  const accion = async (cual: 'llaves' | 'playoffs' | 'suizo', orden?: OrdenManual) => {
    setError('');
    setMensaje('');
    try {
      if (cual === 'llaves') {
        if (t.matches.length && !confirm('Regenerar borra los partidos, sus drafts y los chats de partido. ¿Seguimos?')) return;
        await generarLlaves(t.id, orden);
        setArmando(false);
      } else if (cual === 'playoffs') {
        await generarPlayoffs(t.id);
      } else {
        const r = await siguienteRondaSuiza(t.id);
        setMensaje(`Ronda ${r.ronda} armada${r.bye ? ` · queda libre ${r.bye}` : ''}.`);
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const hayGrupos = t.stages.some((s) => s.type === 'grupos');

  return (
    <div className="space-y-6">
      {staff && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" onClick={() => accion('llaves')}>
            {t.matches.length ? 'Regenerar llaves' : 'Generar llaves'}
          </button>
          <button className="btn btn-ghost" onClick={() => setArmando((a) => !a)}>
            {t.format === 'grupos_playoff' ? 'Armar grupos a mano' : 'Ordenar a mano'}
          </button>
          {hayGrupos && (
            <button className="btn btn-ghost" onClick={() => accion('playoffs')}>
              Generar playoffs
            </button>
          )}
          {t.format === 'suizo' && (
            <button className="btn btn-ghost" onClick={() => accion('suizo')}>
              Siguiente ronda
            </button>
          )}
          {t.matches.length > 0 && (
            <span className="text-xs text-parch-400">Regenerar borra los partidos y los chats de partido.</span>
          )}
        </div>
      )}

      {error && <Alerta>{error}</Alerta>}
      {mensaje && <Alerta tone="info">{mensaje}</Alerta>}

      {staff && armando && (
        <ArmadoManual t={t} onGenerar={(orden) => accion('llaves', orden)} onCerrar={() => setArmando(false)} />
      )}

      {staff && t.matches.length > 0 && <FechasDeRonda t={t} onDone={onDone} />}

      <Fases t={t} staff={staff} onDone={onDone} />
    </div>
  );
}

// ---------------------------------------------------------------- horarios

function Horarios({ t }: { t: Tournament }) {
  const { user } = useAuth();
  const tz = user?.timezone || zonaDelNavegador();

  return (
    <div className="space-y-5">
      <MisHorarios t={t} />

      <section className="card p-5">
        <h3 className="title mb-1 text-lg">Partidos</h3>
        <p className="hint mb-4 text-sm">
          Lo que está agendado y lo que ya se jugó, con el resultado.
        </p>
        <MatchCalendar matches={t.matches} tz={tz} />
      </section>
    </div>
  );
}

// -------------------------------------------------------------------- chat

function ChatTorneo({ t, puedeEscribir }: { t: Tournament; puedeEscribir: boolean }) {
  const sala = `tournament:${t.id}`;
  const { mensajes, errores, enviar } = useChat([sala]);
  const conectado = useConectado();
  const gente = usePresencia(sala);
  const [fallo, setFallo] = useState('');

  return (
    <div className="h-[32rem]">
      {errores[sala] && <Alerta>{errores[sala]}</Alerta>}
      {fallo && <Alerta>{fallo}</Alerta>}
      <ChatPanel
        salas={[{ id: sala, label: 'General del torneo' }]}
        mensajes={mensajes}
        presencia={{ [sala]: gente }}
        onSend={(room, body) => {
          setFallo('');
          void enviar(room, body).catch((err: Error) => setFallo(err.message));
        }}
        puedeEscribir={puedeEscribir}
        conectado={conectado}
      />
    </div>
  );
}

// ------------------------------------------------------------------ config

/** Ids del pool de mapas como se guardaron, sin los que ya no existen en el catálogo. */
function ordenDelPool(t: Tournament) {
  const existentes = new Set(t.maps.map((m) => m.id));
  const guardados = (t.map_ids ?? []).filter((id) => existentes.has(id));
  return guardados.length ? guardados : t.maps.map((m) => m.id);
}

function Config({ t, onDone }: { t: Tournament; onDone: () => void }) {
  const [maps, setMaps] = useState<GameMap[]>([]);
  const [civs, setCivs] = useState<Civ[]>([]);
  const [form, setForm] = useState<Borrador | null>(null);
  const [tabForm, setTabForm] = useState<PestaniaForm>('basico');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setMaps(catalogoMapas());
    setCivs(catalogoCivs());
  }, []);

  useEffect(() => {
    setForm({
      name: t.name,
      description: t.description ?? '',
      rules_md: t.rules_md ?? '',
      status: t.status,
      format: t.format,
      team_size: t.team_size,
      max_teams: t.max_teams?.toString() ?? '',
      best_of: t.best_of,
      best_of_final: t.best_of_final?.toString() ?? '',
      series_mode: t.series_mode ?? 'mejor_de',
      group_count: t.group_count || 2,
      group_advance: t.group_advance,
      swiss_rounds: t.swiss_rounds || 5,
      third_place: !!t.third_place,
      map_repeat: !!t.map_repeat,
      first_map_id: t.first_map_id,
      civ_bans: t.civ_bans ?? 0,
      civ_repeat_series: !!t.civ_repeat_series,
      civ_repeat_team: t.civ_repeat_team !== 0,
      currency: t.currency,
      payment_methods: t.payment_methods.length
        ? t.payment_methods.map((m) => ({
            amount: montoEscrito(m.amount_cents),
            currency: m.currency ?? medioVacio().currency,
            method: m.method ?? '',
            name: m.name ?? '',
            alias: m.alias ?? '',
            url: m.url ?? '',
          }))
        : [medioVacio()],
      payment_notes: t.payment_notes ?? '',
      allow_solo: !!t.allow_solo,
      reg_closes_at: t.reg_closes_at?.slice(0, 16) ?? '',
      starts_at: t.starts_at?.slice(0, 16) ?? '',
      prize_pool_mode: t.prize_pool_mode,
      prize_pool_cents: t.prize_pool_cents,
      prize_pool_pct: t.prize_pool_pct,
      prize_notes: t.prize_notes ?? '',
      prizes: t.prizes.map((p) => ({
        label: p.label,
        kind: p.kind,
        amount_cents: p.amount_cents,
        percent: p.percent,
        extra: p.extra ?? '',
      })),
      // El pool en el orden en que se eligió (`t.maps` sale en el del catálogo).
      map_ids: ordenDelPool(t),
      civ_ids: t.civs.map((c) => c.id),
    });
  }, [t]);

  if (!form) return <Spinner />;

  const guardar = async () => {
    setError('');
    try {
      await actualizarTorneo(t, {
        ...form,
        max_teams: form.max_teams === '' ? null : Number(form.max_teams),
        best_of_final: form.best_of_final === '' ? null : Number(form.best_of_final),
        third_place: form.third_place ? 1 : 0,
        map_repeat: form.map_repeat ? 1 : 0,
        civ_repeat_series: form.civ_repeat_series ? 1 : 0,
        civ_repeat_team: form.civ_repeat_team ? 1 : 0,
        civ_bans: Math.max(0, Math.min(3, form.civ_bans || 0)),
        allow_solo: form.allow_solo ? 1 : 0,
        first_map_id: form.map_ids.includes(form.first_map_id ?? -1) ? form.first_map_id : null,
        reg_closes_at: form.reg_closes_at || null,
        starts_at: form.starts_at || null,
        prizes: form.prizes,
      });
      setMensaje('Guardado.');
      setTimeout(() => setMensaje(''), 2500);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div>
      <TournamentForm
        value={form}
        onChange={setForm}
        maps={maps}
        civs={civs}
        tab={tabForm}
        onTab={setTabForm}
        recaudadoCents={t.prize_pool.collected_cents}
        nombresDeEquipos={t.teams.map((te) => te.name)}
      />
      <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t border-ink-700 bg-ink-950/90 py-4 backdrop-blur">
        <button className="btn btn-primary" onClick={guardar}>
          Guardar cambios
        </button>
        {mensaje && <Alerta tone="good">{mensaje}</Alerta>}
        {error && <Alerta>{error}</Alerta>}
      </div>
    </div>
  );
}
