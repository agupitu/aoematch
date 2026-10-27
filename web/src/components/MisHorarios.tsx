import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth';
import { guardarHorarioPropio, horarioPropio, listarRondas } from '../datos/rondas';
import { bloquesDeSeleccion, diasDelCalendario, seleccionDeBloques } from '../logica/calendario.js';
import { misRondas } from '../logica/rondas.js';
import { zonaDelNavegador } from '../lib';
import type { Dia, Ronda, RondaDoc, Tournament } from '../types';
import { CalendarioRonda } from './CalendarioRonda';
import { Alerta, Spinner } from './ui';

/** '2026-11-14' → '14 nov'. */
const diaCorto = (dia: string) => {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString('es-AR', { timeZone: 'UTC', day: 'numeric', month: 'short' });
};

const duracion = (minutos: number) => {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

/**
 * Los horarios del jugador en cada ronda en la que está su equipo: un
 * calendario por ronda con fechas. Si el equipo pasa de ronda, la siguiente
 * aparece vacía y hay que cargar de nuevo. No muestra nada a quien no es
 * inscripto con equipo.
 */
export function MisHorarios({ t }: { t: Tournament }) {
  const { user } = useAuth();
  const equipoId = t.me?.team_id ?? null;
  const inscripto = !!t.me?.registration && t.me.registration.status !== 'retirada';
  const rondas = useMemo(
    () => (user && inscripto && equipoId ? (misRondas(t.matches, t.stages, equipoId) as Ronda[]) : []),
    [user, inscripto, equipoId, t.matches, t.stages]
  );
  const [docs, setDocs] = useState<Map<string, RondaDoc> | null>(null);

  useEffect(() => {
    if (!rondas.length) return;
    let vivo = true;
    listarRondas(t.id)
      .then((m) => vivo && setDocs(m))
      .catch(() => vivo && setDocs(new Map()));
    return () => {
      vivo = false;
    };
  }, [t.id, rondas]);

  if (!rondas.length) return null;
  if (docs === null) return <Spinner />;
  const conFechas = rondas.filter((r) => docs.has(r.id));
  if (!conFechas.length) {
    return <Alerta tone="info">El organizador todavía no fijó las fechas de {rondas[0].label}.</Alerta>;
  }
  return (
    <div className="space-y-5">
      {conFechas.map((r) => (
        <HorariosDeRonda key={r.id} t={t} ronda={r} doc={docs.get(r.id)!} />
      ))}
    </div>
  );
}

function HorariosDeRonda({ t, ronda, doc }: { t: Tournament; ronda: Ronda; doc: RondaDoc }) {
  const { user } = useAuth();
  const tz = user?.timezone || zonaDelNavegador();
  const dias = useMemo(() => diasDelCalendario(doc.starts_at, doc.ends_at, tz) as Dia[], [doc.starts_at, doc.ends_at, tz]);
  const [seleccion, setSeleccion] = useState<boolean[][] | null>(null);
  const [sucio, setSucio] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let vivo = true;
    horarioPropio(t.id, doc.id, user.id)
      .then((bloques) => vivo && setSeleccion(seleccionDeBloques(dias, bloques)))
      .catch(() => vivo && setSeleccion(dias.map((d) => d.barras.map(() => false))));
    return () => {
      vivo = false;
    };
  }, [t.id, doc.id, user, dias]);

  const guardar = async () => {
    if (!user || !seleccion) return;
    setError('');
    try {
      await guardarHorarioPropio(t.id, doc, user.id, bloquesDeSeleccion(dias, seleccion));
      setSucio(false);
      setMensaje('Horarios guardados.');
      setTimeout(() => setMensaje(''), 2500);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const barras = seleccion ? seleccion.flat().filter(Boolean).length : 0;
  const rango = dias.length ? `${diaCorto(dias[0].dia)} – ${diaCorto(dias[dias.length - 1].dia)}` : '';

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="title text-lg">Mis horarios · {ronda.label}</h3>
          <p className="hint text-sm">
            {rango} · horarios en {tz}. Pintá cuándo podés jugar: con esto el sistema cruza los horarios de los
            dos equipos y propone cuándo jugar el partido. Marcado en la ronda:{' '}
            <span className="text-parch-200">{duracion(barras * 30)}</span>
          </p>
        </div>
        <button className="btn btn-primary" disabled={!sucio} onClick={guardar}>
          Guardar horarios
        </button>
      </div>
      {mensaje && <Alerta tone="good">{mensaje}</Alerta>}
      {error && <Alerta>{error}</Alerta>}
      {seleccion === null ? (
        <Spinner />
      ) : (
        <CalendarioRonda
          dias={dias}
          seleccion={seleccion}
          onChange={(s) => {
            setSeleccion(s);
            setSucio(true);
          }}
        />
      )}
    </section>
  );
}
