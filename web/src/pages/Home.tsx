import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Empty, Spinner } from '../components/ui';
import { ETIQUETA_ESTADO, ETIQUETA_FORMATO, fechaCorta, plata } from '../lib';
import type { Tournament } from '../types';

type Fila = Tournament & { organizer_name: string; inscriptos: number; equipos: number };

const TONO: Record<string, 'gold' | 'good' | 'neutral' | 'info'> = {
  inscripcion: 'gold',
  armado: 'info',
  en_curso: 'good',
  finalizado: 'neutral',
  borrador: 'neutral',
};

export function Home() {
  const { user } = useAuth();
  const [lista, setLista] = useState<Fila[] | null>(null);

  useEffect(() => {
    api.get<Fila[]>('/api/tournaments').then(setLista).catch(() => setLista([]));
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title text-3xl">Torneos</h1>
          <p className="mt-1 text-sm text-parch-400">
            Inscripciones, armado de equipos, horarios en común y draft de mapa y civilizaciones.
          </p>
        </div>
        {user && (
          <Link to="/crear" className="btn btn-primary">
            Crear torneo
          </Link>
        )}
      </div>

      {lista === null ? (
        <Spinner />
      ) : lista.length === 0 ? (
        <Empty>
          Todavía no hay torneos.{' '}
          {user ? (
            <Link to="/crear" className="text-gold-400 underline">
              Creá el primero
            </Link>
          ) : (
            <Link to="/entrar" className="text-gold-400 underline">
              Entrá para crear uno
            </Link>
          )}
          .
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lista.map((t) => (
            <Link
              key={t.id}
              to={`/t/${t.slug}`}
              className="card flex flex-col gap-3 p-4 transition-colors hover:border-gold-600"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="title text-lg leading-tight">{t.name}</h2>
                <Badge tone={TONO[t.status] ?? 'neutral'}>{ETIQUETA_ESTADO[t.status] ?? t.status}</Badge>
              </div>

              {t.description && <p className="line-clamp-2 text-sm text-parch-400">{t.description}</p>}

              <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-parch-400">
                <div>
                  <dt className="inline">Formato: </dt>
                  <dd className="inline text-parch-200">{ETIQUETA_FORMATO[t.format] ?? t.format}</dd>
                </div>
                <div>
                  <dt className="inline">Modalidad: </dt>
                  <dd className="inline text-parch-200">
                    {t.team_size}v{t.team_size}
                  </dd>
                </div>
                <div>
                  <dt className="inline">Inscriptos: </dt>
                  <dd className="inline text-parch-200">{t.inscriptos}</dd>
                </div>
                <div>
                  <dt className="inline">Inscripción: </dt>
                  <dd className="inline text-parch-200">{plata(t.entry_fee_cents, t.currency)}</dd>
                </div>
                {t.starts_at && (
                  <div className="col-span-2">
                    <dt className="inline">Arranca: </dt>
                    <dd className="inline text-parch-200">{fechaCorta(t.starts_at)}</dd>
                  </div>
                )}
              </dl>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
