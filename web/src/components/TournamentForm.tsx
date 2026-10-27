import type { Civ, GameMap } from '../types';
import { CivPicker, MapPicker } from './PoolPicker';
import { bolsaDe, ETIQUETA_FORMATO, monto } from '../lib';
import { Tabs } from './ui';

export type PremioBorrador = {
  label: string;
  kind: 'fijo' | 'porcentaje';
  amount_cents: number;
  percent: number;
  extra: string;
};

export type Borrador = {
  name: string;
  description: string;
  rules_md: string;
  status: string;
  format: string;
  team_size: number;
  max_teams: string;
  best_of: number;
  best_of_final: string;
  group_count: number;
  group_advance: number;
  swiss_rounds: number;
  third_place: boolean;
  map_repeat: boolean;
  first_map_id: number | null;
  civ_bans: number;
  civ_repeat_series: boolean;
  entry_fee_cents: number;
  currency: string;
  payment_link: string;
  payment_notes: string;
  allow_solo: boolean;
  reg_closes_at: string;
  starts_at: string;
  prize_pool_mode: string;
  prize_pool_cents: number;
  prize_pool_pct: number;
  prize_notes: string;
  prizes: PremioBorrador[];
  map_ids: number[];
  civ_ids: number[];
};

export const BORRADOR_INICIAL: Borrador = {
  name: '',
  description: '',
  rules_md: '',
  status: 'inscripcion',
  format: 'eliminacion_simple',
  team_size: 1,
  max_teams: '',
  best_of: 3,
  best_of_final: '',
  group_count: 2,
  group_advance: 2,
  swiss_rounds: 5,
  third_place: false,
  map_repeat: false,
  first_map_id: null,
  civ_bans: 0,
  civ_repeat_series: true,
  entry_fee_cents: 0,
  currency: 'ARS',
  payment_link: '',
  payment_notes: '',
  allow_solo: true,
  reg_closes_at: '',
  starts_at: '',
  prize_pool_mode: 'ninguno',
  prize_pool_cents: 0,
  prize_pool_pct: 100,
  prize_notes: '',
  prizes: [],
  map_ids: [],
  civ_ids: [],
};

export type PestaniaForm =
  | 'basico' | 'formato' | 'draft' | 'premios' | 'inscripcion' | 'mapas' | 'civs';

/** Reparto inicial cuando el organizador suma el primer puesto. */
const PREMIOS_SUGERIDOS: PremioBorrador[] = [
  { label: 'Campeón', kind: 'porcentaje', amount_cents: 0, percent: 60, extra: '' },
  { label: 'Subcampeón', kind: 'porcentaje', amount_cents: 0, percent: 30, extra: '' },
  { label: 'Tercer puesto', kind: 'porcentaje', amount_cents: 0, percent: 10, extra: '' },
];

function Campo({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="hint mt-1 text-xs">{hint}</p>}
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-ink-700 p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[var(--color-gold-500)]"
      />
      <span>
        <span className="block text-sm text-parch-100">{label}</span>
        {hint && <span className="hint block text-xs">{hint}</span>}
      </span>
    </label>
  );
}

export function TournamentForm({
  value,
  onChange,
  maps,
  civs,
  tab,
  onTab,
  recaudadoCents = 0,
}: {
  value: Borrador;
  onChange: (v: Borrador) => void;
  maps: GameMap[];
  civs: Civ[];
  tab: PestaniaForm;
  onTab: (t: PestaniaForm) => void;
  /** Lo ya cobrado en inscripciones, para estimar la bolsa en vivo. */
  recaudadoCents?: number;
}) {
  const set = <K extends keyof Borrador>(k: K, v: Borrador[K]) => onChange({ ...value, [k]: v });

  const pestanias: { id: PestaniaForm; label: string; count?: number }[] = [
    { id: 'basico', label: 'Lo básico' },
    { id: 'formato', label: 'Formato' },
    { id: 'draft', label: 'Draft' },
    { id: 'inscripcion', label: 'Inscripción' },
    { id: 'premios', label: 'Premios', count: value.prizes.length || undefined },
    { id: 'mapas', label: 'Mapas', count: value.map_ids.length },
    { id: 'civs', label: 'Civilizaciones', count: value.civ_ids.length },
  ];

  return (
    <div>
      <Tabs value={tab} onChange={onTab} items={pestanias} />

      <div className="mt-5">
        {tab === 'basico' && (
          <section className="card p-5">
            <h3 className="title mb-4 text-lg">Lo básico</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Nombre">
                <input className="field" value={value.name} onChange={(e) => set('name', e.target.value)} />
              </Campo>
              <Campo label="Estado">
                <select className="field" value={value.status} onChange={(e) => set('status', e.target.value)}>
                  <option value="borrador">Borrador (no visible para inscribirse)</option>
                  <option value="inscripcion">Inscripciones abiertas</option>
                  <option value="armado">Armando equipos</option>
                  <option value="en_curso">En curso</option>
                  <option value="finalizado">Finalizado</option>
                  <option value="cancelado">Cancelado</option>
                </select>
              </Campo>
              <Campo label="Descripción">
                <textarea
                  className="field min-h-20"
                  value={value.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </Campo>
              <Campo label="Reglamento" hint="Texto libre; se muestra en la pestaña de reglas.">
                <textarea
                  className="field min-h-20"
                  value={value.rules_md}
                  onChange={(e) => set('rules_md', e.target.value)}
                />
              </Campo>
              <Campo label="Cierre de inscripciones">
                <input
                  className="field"
                  type="datetime-local"
                  value={value.reg_closes_at}
                  onChange={(e) => set('reg_closes_at', e.target.value)}
                />
              </Campo>
              <Campo label="Arranque">
                <input
                  className="field"
                  type="datetime-local"
                  value={value.starts_at}
                  onChange={(e) => set('starts_at', e.target.value)}
                />
              </Campo>
            </div>
          </section>
        )}

        {tab === 'formato' && (
          <section className="card p-5">
            <h3 className="title mb-4 text-lg">Formato</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo label="Estructura">
                <select className="field" value={value.format} onChange={(e) => set('format', e.target.value)}>
                  {Object.entries(ETIQUETA_FORMATO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Jugadores por equipo">
                <select
                  className="field"
                  value={value.team_size}
                  onChange={(e) => set('team_size', Number(e.target.value))}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}v{n}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Máximo de equipos" hint="Vacío = sin tope.">
                <input
                  className="field"
                  type="number"
                  min={2}
                  value={value.max_teams}
                  onChange={(e) => set('max_teams', e.target.value)}
                />
              </Campo>
              <Campo label="Serie al mejor de">
                <select
                  className="field"
                  value={value.best_of}
                  onChange={(e) => set('best_of', Number(e.target.value))}
                >
                  {[1, 3, 5, 7].map((n) => (
                    <option key={n} value={n}>
                      BO{n}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Final al mejor de" hint="Vacío = igual que el resto.">
                <select
                  className="field"
                  value={value.best_of_final}
                  onChange={(e) => set('best_of_final', e.target.value)}
                >
                  <option value="">Igual</option>
                  {[3, 5, 7].map((n) => (
                    <option key={n} value={n}>
                      BO{n}
                    </option>
                  ))}
                </select>
              </Campo>

              {value.format === 'grupos_playoff' && (
                <>
                  <Campo label="Cantidad de grupos">
                    <input
                      className="field"
                      type="number"
                      min={2}
                      value={value.group_count}
                      onChange={(e) => set('group_count', Number(e.target.value))}
                    />
                  </Campo>
                  <Campo label="Clasifican por grupo">
                    <input
                      className="field"
                      type="number"
                      min={1}
                      value={value.group_advance}
                      onChange={(e) => set('group_advance', Number(e.target.value))}
                    />
                  </Campo>
                </>
              )}

              {value.format === 'suizo' && (
                <Campo label="Rondas suizas">
                  <input
                    className="field"
                    type="number"
                    min={1}
                    value={value.swiss_rounds}
                    onChange={(e) => set('swiss_rounds', Number(e.target.value))}
                  />
                </Campo>
              )}
            </div>

            {value.format === 'eliminacion_simple' && (
              <div className="mt-4 max-w-md">
                <Check
                  checked={value.third_place}
                  onChange={(v) => set('third_place', v)}
                  label="Jugar el partido por el tercer puesto"
                />
              </div>
            )}
          </section>
        )}

        {tab === 'draft' && (
          <section className="card p-5">
            <h3 className="title mb-1 text-lg">Draft</h3>
            <p className="hint mb-4 text-sm">
              La primera partida sale al azar o con el mapa que fijes. Después elige el mapa el equipo
              que perdió la anterior. Los picks de civ son siempre ciegos, se puede espejar y se puede
              repetir civ en el equipo. No hay reloj: se espera a que elijan todos.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                label="Primer mapa"
                hint="Al azar, o uno fijo del pool. De la partida 2 en adelante lo elige el que perdió."
              >
                <select
                  className="field"
                  value={value.first_map_id ?? ''}
                  onChange={(e) => set('first_map_id', e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Al azar</option>
                  {maps
                    .filter((m) => value.map_ids.includes(m.id))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name_es}
                      </option>
                    ))}
                </select>
              </Campo>
              <Campo label="Bans de civ por equipo" hint="De 0 a 3. Arranca el equipo A en la primera partida.">
                <input
                  className="field"
                  type="number"
                  min={0}
                  max={3}
                  value={value.civ_bans}
                  onChange={(e) => set('civ_bans', Math.max(0, Math.min(3, Number(e.target.value) || 0)))}
                />
              </Campo>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Check
                checked={value.civ_repeat_series}
                onChange={(v) => set('civ_repeat_series', v)}
                label="Permitir repetir civ entre partidas de la serie"
                hint="Apagado: en un BO3 cada jugador usa civs distintas en cada partida."
              />
              <Check
                checked={value.map_repeat}
                onChange={(v) => set('map_repeat', v)}
                label="Permitir repetir mapa dentro de la serie"
              />
            </div>
          </section>
        )}

        {tab === 'inscripcion' && (
          <section className="card p-5">
            <h3 className="title mb-4 text-lg">Inscripción</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo label="Costo" hint="0 = gratis. Es por jugador.">
                <input
                  className="field"
                  type="number"
                  min={0}
                  step={100}
                  value={value.entry_fee_cents / 100}
                  onChange={(e) => set('entry_fee_cents', Math.round(Number(e.target.value) * 100))}
                />
              </Campo>
              <Campo label="Moneda">
                <select className="field" value={value.currency} onChange={(e) => set('currency', e.target.value)}>
                  {['ARS', 'USD', 'EUR', 'BRL', 'CLP', 'MXN'].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Campo>
              <Campo label="Link de pago" hint="Mercado Pago, PayPal, Ko-fi, lo que uses.">
                <input
                  className="field"
                  value={value.payment_link}
                  onChange={(e) => set('payment_link', e.target.value)}
                  placeholder="https://…"
                />
              </Campo>
              <Campo label="Instrucciones de pago">
                <textarea
                  className="field min-h-16"
                  value={value.payment_notes}
                  onChange={(e) => set('payment_notes', e.target.value)}
                />
              </Campo>
            </div>
            {value.team_size > 1 && (
              <div className="mt-4 max-w-md">
                <Check
                  checked={value.allow_solo}
                  onChange={(v) => set('allow_solo', v)}
                  label="Aceptar jugadores sueltos"
                  hint="El armador los reparte en equipos parejos de nivel y con horarios en común."
                />
              </div>
            )}
          </section>
        )}

        {tab === 'premios' && (
          <Premios
            value={value}
            onChange={onChange}
            recaudadoCents={recaudadoCents}
            sugeridos={PREMIOS_SUGERIDOS}
          />
        )}

        {tab === 'mapas' && (
          <section className="card p-5">
            <h3 className="title mb-1 text-lg">Pool de mapas</h3>
            <p className="hint mb-4 text-sm">Los mapas que van a estar disponibles en el draft.</p>
            <MapPicker maps={maps} value={value.map_ids} onChange={(v) => set('map_ids', v)} />
          </section>
        )}

        {tab === 'civs' && (
          <section className="card p-5">
            <h3 className="title mb-4 text-lg">Civilizaciones habilitadas</h3>
            <CivPicker civs={civs} value={value.civ_ids} onChange={(v) => set('civ_ids', v)} />
          </section>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ premios

function Premios({
  value,
  onChange,
  recaudadoCents,
  sugeridos,
}: {
  value: Borrador;
  onChange: (v: Borrador) => void;
  recaudadoCents: number;
  sugeridos: PremioBorrador[];
}) {
  const set = <K extends keyof Borrador>(k: K, v: Borrador[K]) => onChange({ ...value, [k]: v });
  const premios = value.prizes;
  const bolsa = bolsaDe(value.prize_pool_mode, value.prize_pool_cents, recaudadoCents, value.prize_pool_pct);

  const valorDe = (p: PremioBorrador) =>
    p.kind === 'fijo' ? p.amount_cents : Math.round((bolsa * p.percent) / 100);

  const sumaPct = premios.filter((p) => p.kind === 'porcentaje').reduce((s, p) => s + (p.percent || 0), 0);
  const repartido = premios.reduce((s, p) => s + valorDe(p), 0);

  const editar = (i: number, cambio: Partial<PremioBorrador>) =>
    set('prizes', premios.map((p, j) => (i === j ? { ...p, ...cambio } : p)));

  const mover = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= premios.length) return;
    const copia = [...premios];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    set('prizes', copia);
  };

  const agregar = () =>
    set('prizes', [
      ...premios,
      {
        label: `${premios.length + 1}º puesto`,
        kind: value.prize_pool_mode === 'fijo' ? 'fijo' : 'porcentaje',
        amount_cents: 0,
        percent: 0,
        extra: '',
      },
    ]);

  return (
    <section className="card p-5">
      <h3 className="title mb-1 text-lg">Premios</h3>
      <p className="hint mb-4 text-sm">
        De dónde sale la plata y cómo se reparte. Cada puesto puede llevar un monto fijo o un
        porcentaje de la bolsa.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo label="Bolsa de premios">
          <select
            className="field"
            value={value.prize_pool_mode}
            onChange={(e) => set('prize_pool_mode', e.target.value)}
          >
            <option value="ninguno">Sin premios en plata</option>
            <option value="fijo">Monto fijo que pone la organización</option>
            <option value="inscripciones">Lo recaudado en inscripciones</option>
          </select>
        </Campo>

        {value.prize_pool_mode === 'fijo' && (
          <Campo label={`Monto de la bolsa (${value.currency})`}>
            <input
              className="field"
              type="number"
              min={0}
              step={1000}
              value={value.prize_pool_cents / 100}
              onChange={(e) => set('prize_pool_cents', Math.round(Number(e.target.value) * 100))}
            />
          </Campo>
        )}

        {value.prize_pool_mode === 'inscripciones' && (
          <Campo
            label="% de lo recaudado que va a premios"
            hint="El resto queda para la organización (servidores, casters, lo que sea)."
          >
            <input
              className="field"
              type="number"
              min={0}
              max={100}
              value={value.prize_pool_pct}
              onChange={(e) => set('prize_pool_pct', Math.max(0, Math.min(100, Number(e.target.value))))}
            />
          </Campo>
        )}

        {value.prize_pool_mode !== 'ninguno' && (
          <Campo
            label="Bolsa estimada"
            hint={
              value.prize_pool_mode === 'inscripciones'
                ? `${value.prize_pool_pct}% de ${monto(recaudadoCents, value.currency)} cobrados hasta ahora.`
                : 'Lo que anunciás que se reparte.'
            }
          >
            <p className="font-display rounded-lg border border-gold-600/50 bg-gold-500/5 px-3 py-2 text-lg text-gold-400">
              {monto(bolsa, value.currency)}
            </p>
          </Campo>
        )}
      </div>

      <div className="mt-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h4 className="label mb-0">Reparto</h4>
          <span className="text-xs text-parch-400">
            {premios.length} puesto{premios.length === 1 ? '' : 's'}
            {sumaPct > 0 && ` · ${sumaPct}% de la bolsa asignado`}
          </span>
          <div className="ml-auto flex gap-2">
            {premios.length === 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => set('prizes', sugeridos)}>
                Usar 60 / 30 / 10
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={agregar}>
              Agregar puesto
            </button>
          </div>
        </div>

        {premios.length === 0 ? (
          <p className="hint rounded-lg border border-dashed border-ink-700 p-6 text-center text-sm">
            Sin premios cargados. El torneo se puede jugar igual.
          </p>
        ) : (
          <div className="space-y-2">
            {premios.map((p, i) => (
              <div
                key={i}
                className="grid items-end gap-2 rounded-lg border border-ink-700 p-3 sm:grid-cols-[2rem_minmax(0,1fr)_10rem_8rem_minmax(0,1fr)_auto]"
              >
                <span className="font-display pb-2 text-lg text-gold-400">{i + 1}º</span>

                <Campo label="Puesto">
                  <input
                    className="field"
                    value={p.label}
                    placeholder={`${i + 1}º puesto`}
                    onChange={(e) => editar(i, { label: e.target.value })}
                  />
                </Campo>

                <Campo label="Tipo">
                  <select
                    className="field"
                    value={p.kind}
                    onChange={(e) => editar(i, { kind: e.target.value as PremioBorrador['kind'] })}
                  >
                    <option value="porcentaje">% de la bolsa</option>
                    <option value="fijo">Monto fijo</option>
                  </select>
                </Campo>

                <Campo label={p.kind === 'fijo' ? value.currency : '%'}>
                  {p.kind === 'fijo' ? (
                    <input
                      className="field"
                      type="number"
                      min={0}
                      step={1000}
                      value={p.amount_cents / 100}
                      onChange={(e) => editar(i, { amount_cents: Math.round(Number(e.target.value) * 100) })}
                    />
                  ) : (
                    <input
                      className="field"
                      type="number"
                      min={0}
                      max={100}
                      value={p.percent}
                      onChange={(e) => editar(i, { percent: Math.max(0, Number(e.target.value)) })}
                    />
                  )}
                </Campo>

                <Campo label="Además" hint={bolsa > 0 || p.kind === 'fijo' ? `Se lleva ${monto(valorDe(p), value.currency)}` : undefined}>
                  <input
                    className="field"
                    value={p.extra}
                    placeholder="Cupo al próximo torneo, trofeo…"
                    onChange={(e) => editar(i, { extra: e.target.value })}
                  />
                </Campo>

                <div className="flex gap-1 pb-1">
                  <button
                    type="button"
                    className="btn btn-ghost px-2"
                    title="Subir"
                    onClick={() => mover(i, -1)}
                    disabled={i === 0}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost px-2"
                    title="Bajar"
                    onClick={() => mover(i, 1)}
                    disabled={i === premios.length - 1}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger px-2"
                    title="Quitar"
                    onClick={() => set('prizes', premios.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm">
              <span className="text-parch-400">
                Reparte {monto(repartido, value.currency)}
                {value.prize_pool_mode !== 'ninguno' && ` de ${monto(bolsa, value.currency)}`}
              </span>
              {sumaPct > 100 && (
                <span className="text-blood-500">Los porcentajes suman {sumaPct}%: pasan de la bolsa.</span>
              )}
              {sumaPct > 0 && sumaPct < 100 && (
                <span className="text-parch-400">Queda {100 - sumaPct}% de la bolsa sin asignar.</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 max-w-2xl">
        <Campo label="Notas de premios" hint="Cómo y cuándo se paga, retenciones, lo que haga falta aclarar.">
          <textarea
            className="field min-h-16"
            value={value.prize_notes}
            onChange={(e) => set('prize_notes', e.target.value)}
          />
        </Campo>
      </div>
    </section>
  );
}
