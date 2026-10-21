import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Match } from '../types';
import { ETIQUETA_ESTADO_PARTIDO, fechaCorta } from '../lib';
import { Badge, Empty } from './ui';

const DIAS_CAL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const JUGADO = ['finalizado', 'walkover'];

/** Clave YYYY-MM-DD del partido en la zona que mira el usuario. */
function diaDe(iso: string, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
}

function claveLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Resultado({ m }: { m: Match }) {
  const jugado = JUGADO.includes(m.status);
  const ganoA = m.winner_team_id === m.team_a_id;
  const ganoB = m.winner_team_id === m.team_b_id;
  return (
    <span className="tabular-nums">
      <span className={ganoA ? 'text-gold-400' : 'text-parch-400'}>{jugado ? m.score_a : ''}</span>
      {jugado && <span className="text-parch-400">–</span>}
      <span className={ganoB ? 'text-gold-400' : 'text-parch-400'}>{jugado ? m.score_b : ''}</span>
    </span>
  );
}

function Pastilla({ m, tz }: { m: Match; tz: string }) {
  const jugado = JUGADO.includes(m.status);
  return (
    <Link
      to={`/m/${m.id}`}
      title={`${m.team_a_name ?? '?'} vs ${m.team_b_name ?? '?'} · ${ETIQUETA_ESTADO_PARTIDO[m.status] ?? m.status}`}
      className={`block truncate rounded border px-1.5 py-1 text-[11px] leading-tight transition-colors ${
        jugado
          ? 'border-ink-700 bg-ink-800 text-parch-400 hover:border-moss-500'
          : 'border-gold-600/50 bg-gold-500/10 text-parch-100 hover:border-gold-500'
      }`}
    >
      <span className="text-parch-400">
        {m.scheduled_at ? new Date(m.scheduled_at).toLocaleTimeString('es-AR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}
      </span>{' '}
      {m.team_a_name ?? '?'} vs {m.team_b_name ?? '?'} <Resultado m={m} />
    </Link>
  );
}

function Mes({ matches, tz }: { matches: Match[]; tz: string }) {
  const hoy = new Date();
  const conFecha = matches.filter((m) => m.scheduled_at);

  // Arranca en el mes del primer partido agendado, o en el actual.
  const inicial = useMemo(() => {
    const prox = [...conFecha].sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!))[0];
    const d = prox ? new Date(prox.scheduled_at!) : hoy;
    return new Date(d.getFullYear(), d.getMonth(), 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches.length]);

  const [mes, setMes] = useState(inicial);

  const porDia = useMemo(() => {
    const m = new Map<string, Match[]>();
    for (const x of conFecha) {
      const k = diaDe(x.scheduled_at!, tz);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(x);
    }
    for (const lista of m.values()) lista.sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, tz]);

  // Grilla de 6 semanas que empieza el lunes anterior al día 1.
  const primero = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const corrimiento = (primero.getDay() + 6) % 7;
  const celdas = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(mes.getFullYear(), mes.getMonth(), 1 - corrimiento + i);
    return d;
  });

  const mover = (delta: number) => setMes(new Date(mes.getFullYear(), mes.getMonth() + delta, 1));
  const claveHoy = claveLocal(hoy);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button className="btn btn-ghost px-2" onClick={() => mover(-1)}>
          ←
        </button>
        <h4 className="title min-w-48 text-center text-base">
          {MESES[mes.getMonth()]} {mes.getFullYear()}
        </h4>
        <button className="btn btn-ghost px-2" onClick={() => mover(1)}>
          →
        </button>
        <button className="btn btn-ghost ml-2" onClick={() => setMes(new Date(hoy.getFullYear(), hoy.getMonth(), 1))}>
          Hoy
        </button>
        <span className="ml-auto text-xs text-parch-400">{conFecha.length} partidos con fecha</span>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-ink-700 bg-ink-700">
        {DIAS_CAL.map((d) => (
          <div key={d} className="bg-ink-900 px-2 py-1 text-center text-[11px] tracking-wide text-parch-400 uppercase">
            {d}
          </div>
        ))}
        {celdas.map((d) => {
          const k = claveLocal(d);
          const delMes = d.getMonth() === mes.getMonth();
          const lista = porDia.get(k) ?? [];
          return (
            <div
              key={k}
              className={`min-h-24 space-y-1 p-1.5 ${delMes ? 'bg-ink-850' : 'bg-ink-900/60'} ${
                k === claveHoy ? 'ring-1 ring-gold-600 ring-inset' : ''
              }`}
            >
              <div className={`text-[11px] ${delMes ? 'text-parch-400' : 'text-ink-600'}`}>{d.getDate()}</div>
              {lista.map((m) => (
                <Pastilla key={m.id} m={m} tz={tz} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Lista({ matches, tz }: { matches: Match[]; tz: string }) {
  const agendados = matches
    .filter((m) => m.scheduled_at && !JUGADO.includes(m.status))
    .sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!));
  const jugados = matches
    .filter((m) => JUGADO.includes(m.status))
    .sort((a, b) => (b.scheduled_at ?? '').localeCompare(a.scheduled_at ?? ''));
  const sinFecha = matches.filter((m) => !m.scheduled_at && !JUGADO.includes(m.status));

  const Fila = ({ m }: { m: Match }) => (
    <Link
      to={`/m/${m.id}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-ink-700 px-3 py-2 transition-colors hover:border-gold-600"
    >
      <span className="w-40 text-xs text-parch-400">
        {m.scheduled_at ? fechaCorta(m.scheduled_at, tz) : 'sin fecha'}
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className={m.winner_team_id === m.team_a_id ? 'text-gold-400' : 'text-parch-100'}>
          {m.team_a_name ?? 'por definir'}
        </span>
        <span className="text-parch-400"> vs </span>
        <span className={m.winner_team_id === m.team_b_id ? 'text-gold-400' : 'text-parch-100'}>
          {m.team_b_name ?? 'por definir'}
        </span>
      </span>
      <span className="font-display text-sm">
        <Resultado m={m} />
      </span>
      <span className="w-28 text-right text-[11px] text-parch-400">{m.label ?? `Ronda ${m.round}`}</span>
      <Badge tone={JUGADO.includes(m.status) ? 'neutral' : m.status === 'agendado' ? 'gold' : 'info'}>
        {ETIQUETA_ESTADO_PARTIDO[m.status] ?? m.status}
      </Badge>
    </Link>
  );

  return (
    <div className="space-y-5">
      <div>
        <h4 className="label">Próximos ({agendados.length})</h4>
        {agendados.length === 0 ? (
          <Empty>Todavía no hay partidos con horario confirmado.</Empty>
        ) : (
          <div className="space-y-2">
            {agendados.map((m) => (
              <Fila key={m.id} m={m} />
            ))}
          </div>
        )}
      </div>

      {sinFecha.length > 0 && (
        <div>
          <h4 className="label">Sin agendar ({sinFecha.length})</h4>
          <div className="space-y-2">
            {sinFecha.map((m) => (
              <Fila key={m.id} m={m} />
            ))}
          </div>
        </div>
      )}

      {jugados.length > 0 && (
        <div>
          <h4 className="label">Jugados ({jugados.length})</h4>
          <div className="space-y-2">
            {jugados.map((m) => (
              <Fila key={m.id} m={m} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function MatchCalendar({ matches, tz }: { matches: Match[]; tz: string }) {
  const [vista, setVista] = useState<'calendario' | 'lista'>('calendario');
  const conRival = matches.filter((m) => m.team_a_id || m.team_b_id);

  if (!conRival.length) {
    return <Empty>Todavía no hay partidos. Generá las llaves para que aparezcan acá.</Empty>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        {(['calendario', 'lista'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setVista(v)}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              vista === v ? 'bg-ink-800 text-gold-400' : 'text-parch-400 hover:text-parch-200'
            }`}
          >
            {v === 'calendario' ? 'Calendario' : 'Lista'}
          </button>
        ))}
        <span className="ml-auto text-xs text-parch-400">Horarios en {tz}</span>
      </div>

      {vista === 'calendario' ? <Mes matches={conRival} tz={tz} /> : <Lista matches={conRival} tz={tz} />}
    </div>
  );
}
