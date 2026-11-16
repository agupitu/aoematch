import { Link } from 'react-router-dom';
import { Empty } from '../components/ui';
import { bolsaDe, costosEnTexto, ETIQUETA_FORMATO, fechaCorta, monto } from '../lib';
import { mapaPorId } from '../logica/catalogo.js';
import { costosDe, recaudadoEstimado } from '../logica/pagos.js';
import type { Fila } from '../pages/Home';
import type { User } from '../types';
import { EstadoTorneo, IconoCalendario, IconoCopa, IconoFlecha, RosaDeLosVientos } from './Adornos';

/** Portada del diseño nuevo: titular con la rosa de los vientos, cifras y las tarjetas de torneo. */
export function InicioNuevo({ user, lista }: { user: User | null; lista: Fila[] | null }) {
  return (
    <div className="dn-pagina mx-auto max-w-7xl px-4 pb-16">
      <section className="dn-hero">
        <div className="dn-hero-texto">
          <p className="dn-sobre">Age of Empires III</p>
          <h1 className="title dn-titular">Torneos</h1>
          <p className="dn-bajada">
            Inscripciones, armado de equipos, horarios en común y draft de mapa y civilizaciones.
          </p>
          <div className="dn-hero-pie">
            {user && (
              <Link to="/crear" className="btn btn-primary">
                Crear torneo
              </Link>
            )}
            {lista && lista.length > 0 && <Cifras lista={lista} />}
          </div>
        </div>
        <RosaDeLosVientos />
      </section>

      {lista === null ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Cargando torneos">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card dn-esqueleto" />
          ))}
        </div>
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
        <div className="dn-escalonado grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {lista.map((t) => (
            <TarjetaTorneo key={t.id} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function Cifras({ lista }: { lista: Fila[] }) {
  const cifras = [
    { n: lista.length, label: lista.length === 1 ? 'torneo' : 'torneos' },
    { n: lista.filter((t) => t.status === 'en_curso').length, label: 'en curso' },
    { n: lista.filter((t) => t.status === 'inscripcion').length, label: 'con inscripción abierta' },
    { n: lista.reduce((suma, t) => suma + t.inscriptos, 0), label: 'inscriptos' },
  ];
  return (
    <ul className="dn-cifras">
      {cifras.map((c) => (
        <li key={c.label}>
          <strong>{c.n}</strong>
          <span>{c.label}</span>
        </li>
      ))}
    </ul>
  );
}

function TarjetaTorneo({ t }: { t: Fila }) {
  // Con varios costos no se sabe cuánto entró sin leer las inscripciones: se muestra el porcentaje.
  const recaudado = recaudadoEstimado(t, t.pagos);
  const bolsa = bolsaDe(t.prize_pool_mode, t.prize_pool_cents, recaudado ?? 0, t.prize_pool_pct);
  const porcentual = t.prize_pool_mode === 'inscripciones' && recaudado === null;
  const mapas = (t.map_ids ?? []).map((id) => mapaPorId(id)).filter((m) => !!m).slice(0, 4);

  return (
    <Link to={`/t/${t.slug}`} className="card dn-torneo" data-estado={t.status}>
      {mapas.length > 0 && (
        <div className="dn-torneo-mapas" aria-hidden>
          {mapas.map((m) => (
            <img key={m.id} src={m.img} alt="" loading="lazy" />
          ))}
        </div>
      )}

      <EstadoTorneo status={t.status} />
      <h2 className="title dn-torneo-nombre">{t.name}</h2>
      {t.description && <p className="dn-torneo-desc">{t.description}</p>}

      <dl className="dn-torneo-datos">
        <div>
          <dt>Formato</dt>
          <dd>{ETIQUETA_FORMATO[t.format] ?? t.format}</dd>
        </div>
        <div>
          <dt>Modalidad</dt>
          <dd>
            {t.team_size}v{t.team_size}
          </dd>
        </div>
        <div>
          <dt>Inscriptos</dt>
          <dd>{t.inscriptos}</dd>
        </div>
        <div>
          <dt>Inscripción</dt>
          <dd>{costosEnTexto(costosDe(t))}</dd>
        </div>
      </dl>

      <div className="dn-torneo-pie">
        {(bolsa > 0 || porcentual) && (
          <span className="dn-torneo-premio" title="Premios">
            <IconoCopa />
            {porcentual ? `${t.prize_pool_pct}% de lo recaudado` : monto(bolsa, t.currency)}
          </span>
        )}
        {t.starts_at && (
          <span className="dn-torneo-fecha" title="Arranca">
            <IconoCalendario />
            {fechaCorta(t.starts_at)}
          </span>
        )}
        <span className="dn-torneo-ir">
          Ver torneo
          <IconoFlecha />
        </span>
      </div>
    </Link>
  );
}
