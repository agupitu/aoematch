import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth';
import { guardarFechasDeRonda, listarRondas } from '../datos/rondas';
import { estadoDeRonda, rondasDelCuadro } from '../logica/rondas.js';
import { zonaDelNavegador } from '../lib';
import type { Ronda, RondaDoc, Tournament } from '../types';
import { Alerta, Badge, Spinner } from './ui';

const ESTADO = {
  sin_fechas: { tono: 'neutral', texto: 'sin fechas' },
  abierta: { tono: 'gold', texto: 'abierta' },
  jugada: { tono: 'good', texto: 'jugada' },
} as const;

type Fechas = Record<string, { desde: string; hasta: string }>;

/**
 * Staff: desde qué día hasta qué día se juega cada ronda. Los jugadores cargan
 * sus horarios solo dentro de ese rango; una ronda sin fechas no abre
 * calendario. Cada día va de 00:00 a 24:00 en la zona de quien guarda.
 */
export function FechasDeRonda({ t, onDone }: { t: Tournament; onDone: () => void }) {
  const { user } = useAuth();
  const zona = user?.timezone || zonaDelNavegador();
  const rondas = useMemo(() => rondasDelCuadro(t.matches, t.stages) as Ronda[], [t.matches, t.stages]);
  const [docs, setDocs] = useState<Map<string, RondaDoc> | null>(null);
  const [fechas, setFechas] = useState<Fechas>({});
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');

  const cargar = async () => {
    const guardadas = await listarRondas(t.id);
    setDocs(guardadas);
    setFechas(
      Object.fromEntries(
        rondas.map((r) => [r.id, { desde: guardadas.get(r.id)?.from_day ?? '', hasta: guardadas.get(r.id)?.to_day ?? '' }])
      )
    );
  };

  useEffect(() => {
    cargar().catch((err) => setError((err as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id, rondas]);

  const guardar = async () => {
    setError('');
    setMensaje('');
    try {
      const cambiadas = rondas.filter((r) => {
        const f = fechas[r.id];
        const guardada = docs?.get(r.id);
        return !!f && (f.desde !== (guardada?.from_day ?? '') || f.hasta !== (guardada?.to_day ?? ''));
      });
      for (const r of cambiadas) {
        const { desde, hasta } = fechas[r.id];
        if (!desde || !hasta) throw new Error(`${r.label}: completá "desde" y "hasta".`);
        await guardarFechasDeRonda(t.id, r, desde, hasta, zona);
      }
      setMensaje(cambiadas.length ? 'Fechas guardadas.' : 'No hay cambios para guardar.');
      await cargar();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const cambiar = (id: string, campo: 'desde' | 'hasta', valor: string) =>
    setFechas((f) => ({ ...f, [id]: { ...(f[id] ?? { desde: '', hasta: '' }), [campo]: valor } }));

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="title text-lg">Fechas de cada ronda</h3>
          <p className="hint text-sm">
            Los jugadores cargan horarios solo dentro de este rango. Cada día va de 00:00 a 24:00 en tu zona (
            {zona}). Una ronda sin fechas no abre calendario.
          </p>
        </div>
        <button className="btn btn-primary" onClick={guardar}>
          Guardar fechas
        </button>
      </div>

      {error && <Alerta>{error}</Alerta>}
      {mensaje && <Alerta tone="good">{mensaje}</Alerta>}

      {docs === null ? (
        <Spinner />
      ) : (
        <div className="space-y-2">
          <div className="hidden grid-cols-[1fr_9rem_9rem_6rem] gap-3 px-1 text-xs text-parch-400 sm:grid">
            <span>Ronda</span>
            <span>Desde</span>
            <span>Hasta</span>
            <span />
          </div>
          {rondas.map((r) => {
            const estado = ESTADO[estadoDeRonda(r, docs.get(r.id))];
            const f = fechas[r.id] ?? { desde: '', hasta: '' };
            return (
              <div key={r.id} className="grid items-center gap-3 sm:grid-cols-[1fr_9rem_9rem_6rem]">
                <span className="text-sm text-parch-100">{r.label}</span>
                <input
                  type="date"
                  className="field"
                  aria-label={`${r.label}: desde`}
                  value={f.desde}
                  onChange={(e) => cambiar(r.id, 'desde', e.target.value)}
                />
                <input
                  type="date"
                  className="field"
                  aria-label={`${r.label}: hasta`}
                  value={f.hasta}
                  onChange={(e) => cambiar(r.id, 'hasta', e.target.value)}
                />
                <span>
                  <Badge tone={estado.tono}>{estado.texto}</Badge>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
