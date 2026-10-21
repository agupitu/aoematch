import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alerta, Avatar, Badge, Empty, Modal, Spinner, Tabs } from '../components/ui';
import { Bracket, MatchCard } from '../components/Bracket';
import { AvailabilityGrid } from '../components/AvailabilityGrid';
import { MatchCalendar } from '../components/MatchCalendar';
import { TournamentForm, type Borrador, type PestaniaForm } from '../components/TournamentForm';
import { ChatPanel } from '../components/ChatPanel';
import { useSocket } from '../ws';
import {
  ETIQUETA_CIV, ETIQUETA_ESTADO, ETIQUETA_FORMATO, ETIQUETA_MAPA,
  fechaCorta, horas, monto, plata, rangoSemana, offsetZona, zonaDelNavegador,
} from '../lib';
import type { ChatMessage, Civ, GameMap, Registration, StandingRow, Team, Tournament, Window } from '../types';

type Pestania = 'resumen' | 'inscripciones' | 'equipos' | 'llaves' | 'horarios' | 'chat' | 'config';

export function TournamentPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [t, setT] = useState<Tournament | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Pestania>('resumen');

  const cargar = useCallback(async () => {
    try {
      setT(await api.get<Tournament>(`/api/tournaments/${slug}`));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [slug]);

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
              {ETIQUETA_FORMATO[t.format]} · {t.team_size}v{t.team_size} · BO{t.best_of} · organiza{' '}
              <span className="text-parch-200">{t.organizer.display_name}</span>
            </p>
          </div>
          <AccionesInscripcion t={t} user={user} onDone={cargar} />
        </div>
        {t.description && <p className="mt-3 max-w-3xl text-sm text-parch-200">{t.description}</p>}
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
  user: { id: number } | null;
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

  const inscribir = async (kind: 'solo' | 'equipo') => {
    setError('');
    try {
      await api.post(`/api/tournaments/${t.id}/register`, {
        kind,
        team_name: nombreEquipo || undefined,
        team_id: equipoId ? Number(equipoId) : undefined,
      });
      setAbierto(false);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {t.entry_fee_cents > 0 && (
        <Badge tone={reg?.paid ? 'good' : 'gold'}>
          {plata(t.entry_fee_cents, t.currency)}
          {activa && (reg?.paid ? ' · pagado' : ' · impago')}
        </Badge>
      )}
      {activa ? (
        <>
          <Badge tone="good">Inscripto{reg?.team_name ? ` · ${reg.team_name}` : ''}</Badge>
          <button
            className="btn btn-danger"
            onClick={async () => {
              await api.post(`/api/tournaments/${t.id}/withdraw`);
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
          {t.entry_fee_cents > 0 && (
            <Alerta tone="info">
              Costo: {plata(t.entry_fee_cents, t.currency)}.{' '}
              {t.payment_link && (
                <a className="text-gold-400 underline" href={t.payment_link} target="_blank" rel="noreferrer">
                  Pagar acá
                </a>
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
                            {te.name} ({te.members.length}/{t.team_size})
                          </option>
                        ))}
                    </select>
                    <button className="btn btn-primary" disabled={!equipoId} onClick={() => inscribir('equipo')}>
                      Sumarme
                    </button>
                  </div>
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

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Premios t={t} />

        <section className="card p-5">
          <h3 className="title mb-3 text-lg">Reglas del draft</h3>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Dato k="Mapa" v={ETIQUETA_MAPA[t.map_mode]} />
            {t.first_map && (
              <Dato
                k={t.map_mode === 'fijo' ? 'Mapa fijo' : 'Mapa de la partida 1'}
                v={t.first_map.name_es}
              />
            )}
            <Dato
              k="Civilizaciones"
              v={`${ETIQUETA_CIV[t.civ_mode]}${t.civ_mode === 'snake' ? ` (${t.civ_pattern_efectivo})` : ''}`}
            />
            <Dato k="Bans de civ por equipo" v={t.civ_bans ? String(t.civ_bans) : 'sin bans'} />
            <Dato k="Reloj por paso" v={t.draft_timer_s ? `${t.draft_timer_s} s` : 'sin reloj'} />
            <Dato k="Misma civ en un equipo" v={t.civ_repeat_team ? 'permitida' : 'prohibida'} />
            <Dato k="Espejos entre equipos" v={t.civ_mirror ? 'permitidos' : 'prohibidos'} />
            <Dato k="Repetir civ en la serie" v={t.civ_repeat_series ? 'permitido' : 'prohibido'} />
            <Dato k="Repetir mapa en la serie" v={t.map_repeat ? 'permitido' : 'prohibido'} />
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

        <section className="card p-5">
          <h3 className="title mb-3 text-lg">Civilizaciones habilitadas ({t.civs.length})</h3>
          <div className="flex flex-wrap gap-2">
            {t.civs.map((c) => (
              <span key={c.id} className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-2 py-1">
                <img src={c.flag} alt="" className="h-4 w-6 rounded-[2px] object-cover" />
                <span className="text-[11px] text-parch-200">{c.name_es}</span>
              </span>
            ))}
          </div>
        </section>

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
            <Dato k="Inscripción" v={plata(t.entry_fee_cents, t.currency)} />
            {t.entry_fee_cents > 0 && <Dato k="Pagaron" v={`${pagos} de ${activos.length}`} />}
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

        {t.payment_link && (
          <a href={t.payment_link} target="_blank" rel="noreferrer" className="btn btn-ghost w-full">
            Link de pago
          </a>
        )}
      </aside>
    </div>
  );
}

function Premios({ t }: { t: Tournament }) {
  if (!t.prizes.length && !t.prize_pool.total_cents) return null;
  const enJuego = Math.max(t.prize_pool.total_cents, t.prize_pool.assigned_cents);

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
          recaudados.
        </p>
      )}
      {t.prize_notes && <p className="mt-2 text-xs text-parch-400">{t.prize_notes}</p>}
    </section>
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

function Inscripciones({ t, onDone }: { t: Tournament; onDone: () => void }) {
  const staff = !!t.me?.is_staff;
  const filas = t.registrations.filter((r) => r.status !== 'retirada');

  const marcar = async (r: Registration, campos: Partial<Registration>) => {
    await api.patch(`/api/tournaments/${t.id}/registrations/${r.id}`, campos);
    onDone();
  };

  if (!filas.length) return <Empty>Todavía no se anotó nadie.</Empty>;

  return (
    <div className="card overflow-x-auto">
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
              <td className="p-3 text-parch-400">{r.team_name ?? <span className="italic">suelto</span>}</td>
              <td className="p-3 text-parch-400">{r.rating_team ?? r.rating_1v1 ?? '—'}</td>
              <td className="p-3 text-xs text-parch-400">{r.timezone}</td>
              <td className="p-3">
                <Badge tone={r.status === 'confirmada' ? 'good' : r.status === 'rechazada' ? 'bad' : 'neutral'}>
                  {r.status}
                </Badge>
              </td>
              <td className="p-3">
                {t.entry_fee_cents === 0 ? (
                  <span className="text-parch-400">—</span>
                ) : (
                  <Badge tone={r.paid ? 'good' : 'bad'}>{r.paid ? 'pagado' : 'impago'}</Badge>
                )}
              </td>
              {staff && (
                <td className="p-3">
                  <div className="flex justify-end gap-1.5">
                    {t.entry_fee_cents > 0 && (
                      <button className="btn btn-ghost !px-2 !py-1" onClick={() => marcar(r, { paid: !r.paid })}>
                        {r.paid ? 'Marcar impago' : 'Marcar pagado'}
                      </button>
                    )}
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
  teams: { name: string; avg_rating: number; overlap_min: number; members: { id: number; display_name: string; rating: number | null }[] }[];
  leftovers: { id: number; display_name: string }[];
  note?: string;
};

function Equipos({ t, onDone }: { t: Tournament; onDone: () => void }) {
  const staff = !!t.me?.is_staff;
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null);
  const [peso, setPeso] = useState(1.5);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const sueltos = t.registrations.filter((r) => r.status !== 'retirada' && !r.team_id);

  const proponer = async () => {
    setError('');
    setCargando(true);
    try {
      setPropuesta(await api.post<Propuesta>(`/api/tournaments/${t.id}/autoteams`, { weight_overlap: peso }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="space-y-6">
      {t.team_size > 1 && staff && (
        <section className="card p-5">
          <h3 className="title mb-1 text-lg">Armador de equipos</h3>
          <p className="mb-4 text-sm text-parch-400">
            Reparte a los {sueltos.length} jugadores sueltos buscando equipos parejos de nivel y con horarios en
            común. Podés regenerar hasta que te guste y recién ahí confirmás.
          </p>

          <div className="mb-4 flex flex-wrap items-end gap-4">
            <label className="flex-1">
              <span className="label">Prioridad</span>
              <input
                type="range"
                min={0}
                max={4}
                step={0.5}
                value={peso}
                onChange={(e) => setPeso(Number(e.target.value))}
                className="w-full accent-[var(--color-gold-500)]"
              />
              <span className="mt-1 block text-xs text-parch-400">
                {peso === 0 ? 'Solo nivel parejo' : peso < 2 ? 'Nivel parejo, mirando horarios' : 'Horarios en común por encima del nivel'}
              </span>
            </label>
            <button className="btn btn-primary" onClick={proponer} disabled={cargando || sueltos.length < t.team_size}>
              {propuesta ? 'Regenerar' : 'Proponer equipos'}
            </button>
            {propuesta && propuesta.teams.length > 0 && (
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  await api.post(`/api/tournaments/${t.id}/autoteams/confirm`, { proposal: propuesta });
                  setPropuesta(null);
                  onDone();
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
                  <p className="mt-2 text-xs text-parch-400">Cruce semanal: {horas(p.overlap_min)}</p>
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

function TeamCard({ t, team, onDone }: { t: Tournament; team: Team; onDone: () => void }) {
  const staff = !!t.me?.is_staff;
  const esMio = t.me?.team_id === team.id;

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h4 className="title text-base">{team.name}</h4>
          <p className="text-xs text-parch-400">
            {team.members.length}/{t.team_size} jugadores
            {team.seed ? ` · siembra ${team.seed}` : ''}
            {team.auto_built ? ' · armado automático' : ''}
          </p>
        </div>
        {esMio && <Badge tone="gold">Tu equipo</Badge>}
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
                onClick={async () => {
                  await api.del(`/api/tournaments/${t.id}/teams/${team.id}/members/${m.id}`);
                  onDone();
                }}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>

      {team.overlap_min !== null && (
        <p className="mt-3 border-t border-ink-800 pt-2 text-xs text-parch-400">
          Horario en común del equipo: <span className="text-parch-200">{horas(team.overlap_min)}</span>
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ llaves

function Llaves({ t, onDone }: { t: Tournament; onDone: () => void }) {
  const staff = !!t.me?.is_staff;
  const [error, setError] = useState('');

  const accion = async (path: string) => {
    setError('');
    try {
      await api.post(`/api/tournaments/${t.id}/${path}`);
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
          <button className="btn btn-primary" onClick={() => accion('brackets')}>
            {t.matches.length ? 'Regenerar llaves' : 'Generar llaves'}
          </button>
          {hayGrupos && (
            <button className="btn btn-ghost" onClick={() => accion('playoffs')}>
              Generar playoffs
            </button>
          )}
          {t.format === 'suizo' && (
            <button className="btn btn-ghost" onClick={() => accion('swiss/next')}>
              Siguiente ronda
            </button>
          )}
          {t.matches.length > 0 && (
            <span className="text-xs text-parch-400">Regenerar borra los partidos y los chats de partido.</span>
          )}
        </div>
      )}

      {error && <Alerta>{error}</Alerta>}

      {t.standings && t.standings.length > 0 && <Tabla filas={t.standings} titulo="Posiciones" />}

      {t.stages
        .filter((s) => s.groups.length)
        .map((s) => (
          <div key={s.id} className="grid gap-4 md:grid-cols-2">
            {s.groups.map((g) => (
              <Tabla key={g.id} filas={g.standings} titulo={g.name} />
            ))}
          </div>
        ))}

      {t.matches.length === 0 ? (
        <Empty>Las llaves todavía no están generadas.</Empty>
      ) : t.format === 'liga' || t.format === 'suizo' || hayGrupos ? (
        <ListaPartidos matches={t.matches} />
      ) : (
        <Bracket matches={t.matches} />
      )}
    </div>
  );
}

function Tabla({ filas, titulo }: { filas: StandingRow[]; titulo: string }) {
  return (
    <section className="card overflow-hidden">
      <h4 className="title border-b border-ink-700 px-4 py-2.5 text-sm">{titulo}</h4>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-parch-400">
          <tr>
            <th className="px-4 py-2">Equipo</th>
            <th className="px-2 py-2">PJ</th>
            <th className="px-2 py-2">G</th>
            <th className="px-2 py-2">P</th>
            <th className="px-2 py-2">+/-</th>
            <th className="px-4 py-2">Pts</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((r) => (
            <tr key={r.team.id} className="border-t border-ink-800">
              <td className="px-4 py-2 text-parch-100">{r.team.name}</td>
              <td className="px-2 py-2 text-parch-400">{r.pj}</td>
              <td className="px-2 py-2 text-parch-400">{r.pg}</td>
              <td className="px-2 py-2 text-parch-400">{r.pp}</td>
              <td className="px-2 py-2 text-parch-400">{r.gf - r.gc}</td>
              <td className="px-4 py-2 font-semibold text-gold-400">{r.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ListaPartidos({ matches }: { matches: Tournament['matches'] }) {
  const rondas = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  return (
    <div className="space-y-5">
      {rondas.map((r) => (
        <div key={r}>
          <h4 className="label">{matches.find((m) => m.round === r)?.label ?? `Ronda ${r}`}</h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {matches
              .filter((m) => m.round === r)
              .map((m) => (
                <MatchCard key={m.id} m={m} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- horarios

function Horarios({ t }: { t: Tournament }) {
  const { user } = useAuth();
  const tz = user?.timezone || zonaDelNavegador();
  const [duracion, setDuracion] = useState(90);
  const [data, setData] = useState<{ total: number; windows: Window[] } | null>(null);
  const [heat, setHeat] = useState<number[] | null>(null);

  const ids = useMemo(
    () => t.registrations.filter((r) => r.status !== 'retirada').map((r) => r.user_id),
    [t.registrations]
  );

  useEffect(() => {
    api
      .get<{ total: number; windows: Window[] }>(`/api/tournaments/${t.id}/schedule?duration=${duracion}`)
      .then(setData)
      .catch(() => setData(null));
  }, [t.id, duracion]);

  useEffect(() => {
    if (!ids.length) return;
    // Mapa de calor: cuántos pueden en cada bloque de 30 min.
    Promise.all(
      ids.map((id) => api.get<{ blocks: { start_min: number; end_min: number }[] }>(`/api/availability/${id}`))
    ).then((todos) => {
      const c = new Array(336).fill(0);
      for (const u of todos) {
        for (const b of u.blocks) {
          for (let m = b.start_min; m < b.end_min; m += 30) c[Math.floor(m / 30) % 336]++;
        }
      }
      setHeat(c);
    });
  }, [ids]);

  const offset = offsetZona(tz);

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h3 className="title mb-1 text-lg">Partidos</h3>
        <p className="mb-4 text-sm text-parch-400">
          Lo que está agendado y lo que ya se jugó, con el resultado.
        </p>
        <MatchCalendar matches={t.matches} tz={tz} />
      </section>

      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="title text-lg">Cuándo puede jugar la mayoría</h3>
            <p className="text-sm text-parch-400">
              Cruce de la disponibilidad de los {ids.length} inscriptos, en tu zona ({tz}).
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-parch-400">
            Duración
            <select className="field w-auto" value={duracion} onChange={(e) => setDuracion(Number(e.target.value))}>
              {[60, 90, 120, 180].map((d) => (
                <option key={d} value={d}>
                  {d} min
                </option>
              ))}
            </select>
          </label>
        </div>

        {heat && <AvailabilityGrid value={[]} timezone={tz} readOnly heat={heat} heatMax={ids.length} />}
      </section>

      <section className="card p-5">
        <h3 className="title mb-3 text-lg">Mejores ventanas</h3>
        {!data || data.windows.length === 0 ? (
          <Empty>Nadie cargó horarios todavía, o no hay ventanas que sirvan.</Empty>
        ) : (
          <ul className="space-y-2">
            {data.windows.map((w, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-ink-700 px-3 py-2">
                <span className="text-sm text-parch-100">{rangoSemana(w.start_min, w.end_min, offset)}</span>
                <span className="text-xs text-parch-400">
                  {w.count} de {data.total} disponibles · próxima: {fechaCorta(w.next_utc, tz)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// -------------------------------------------------------------------- chat

function ChatTorneo({ t, puedeEscribir }: { t: Tournament; puedeEscribir: boolean }) {
  const sala = `tournament:${t.id}`;
  const [mensajes, setMensajes] = useState<Record<string, ChatMessage[]>>({});
  const [presencia, setPresencia] = useState<Record<string, { id: number; display_name: string; avatar_url: string | null }[]>>({});

  const { conectado, enviar } = useSocket([sala], (msg) => {
    if (msg.type === 'history') setMensajes((p) => ({ ...p, [msg.room]: msg.messages as ChatMessage[] }));
    if (msg.type === 'chat')
      setMensajes((p) => ({ ...p, [msg.room]: [...(p[msg.room] ?? []), msg.message as ChatMessage] }));
    if (msg.type === 'presence') setPresencia((p) => ({ ...p, [msg.room]: msg.users as never }));
  });

  return (
    <div className="h-[32rem]">
      <ChatPanel
        salas={[{ id: sala, label: 'General del torneo' }]}
        mensajes={mensajes}
        presencia={presencia}
        onSend={(room, body) => enviar({ type: 'chat', room, body })}
        puedeEscribir={puedeEscribir}
        conectado={conectado}
      />
    </div>
  );
}

// ------------------------------------------------------------------ config

function Config({ t, onDone }: { t: Tournament; onDone: () => void }) {
  const [maps, setMaps] = useState<GameMap[]>([]);
  const [civs, setCivs] = useState<Civ[]>([]);
  const [form, setForm] = useState<Borrador | null>(null);
  const [tabForm, setTabForm] = useState<PestaniaForm>('basico');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get<GameMap[]>('/api/maps'), api.get<Civ[]>('/api/civs')]).then(([m, c]) => {
      setMaps(m);
      setCivs(c);
    });
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
      group_count: t.group_count || 2,
      group_advance: t.group_advance,
      swiss_rounds: t.swiss_rounds || 5,
      third_place: !!t.third_place,
      map_mode: t.map_mode,
      map_bans: t.map_bans,
      map_repeat: !!t.map_repeat,
      first_map_id: t.first_map_id,
      civ_mode: t.civ_mode,
      civ_bans: t.civ_bans,
      civ_pattern: t.civ_pattern ?? '',
      civ_repeat_series: !!t.civ_repeat_series,
      civ_repeat_team: !!t.civ_repeat_team,
      civ_mirror: !!t.civ_mirror,
      draft_timer_s: t.draft_timer_s,
      entry_fee_cents: t.entry_fee_cents,
      currency: t.currency,
      payment_link: t.payment_link ?? '',
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
      map_ids: t.maps.map((m) => m.id),
      civ_ids: t.civs.map((c) => c.id),
    });
  }, [t]);

  if (!form) return <Spinner />;

  const guardar = async () => {
    setError('');
    try {
      await api.patch(`/api/tournaments/${t.id}`, {
        ...form,
        max_teams: form.max_teams === '' ? null : Number(form.max_teams),
        best_of_final: form.best_of_final === '' ? null : Number(form.best_of_final),
        third_place: form.third_place ? 1 : 0,
        map_repeat: form.map_repeat ? 1 : 0,
        civ_repeat_series: form.civ_repeat_series ? 1 : 0,
        civ_repeat_team: form.civ_repeat_team ? 1 : 0,
        civ_mirror: form.civ_mirror ? 1 : 0,
        allow_solo: form.allow_solo ? 1 : 0,
        civ_pattern: form.civ_pattern.trim() || null,
        reg_closes_at: form.reg_closes_at || null,
        starts_at: form.starts_at || null,
        prizes: form.prizes,
        first_map_id: form.first_map_id,
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
