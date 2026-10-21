import type { Civ, GameMap } from '../types';
import { CivPicker, MapPicker } from './PoolPicker';
import { ETIQUETA_CIV, ETIQUETA_FORMATO, ETIQUETA_MAPA } from '../lib';

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
  map_mode: string;
  map_bans: number;
  map_repeat: boolean;
  civ_mode: string;
  civ_bans: number;
  civ_pattern: string;
  civ_repeat_series: boolean;
  civ_repeat_team: boolean;
  civ_mirror: boolean;
  draft_timer_s: number;
  entry_fee_cents: number;
  currency: string;
  payment_link: string;
  payment_notes: string;
  allow_solo: boolean;
  reg_closes_at: string;
  starts_at: string;
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
  map_mode: 'ban_hasta_uno',
  map_bans: 2,
  map_repeat: false,
  civ_mode: 'snake',
  civ_bans: 0,
  civ_pattern: '',
  civ_repeat_series: true,
  civ_repeat_team: false,
  civ_mirror: true,
  draft_timer_s: 60,
  entry_fee_cents: 0,
  currency: 'ARS',
  payment_link: '',
  payment_notes: '',
  allow_solo: true,
  reg_closes_at: '',
  starts_at: '',
  map_ids: [],
  civ_ids: [],
};

/** Patrón serpiente sugerido: los bordes eligen de a uno y el medio de a dos. */
export function patronSugerido(teamSize: number): string {
  if (teamSize <= 1) return '1-1';
  return ['1', ...Array.from({ length: teamSize - 1 }, () => '2'), '1'].join('-');
}

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
      {hint && <p className="mt-1 text-xs text-parch-400">{hint}</p>}
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
        {hint && <span className="block text-xs text-parch-400">{hint}</span>}
      </span>
    </label>
  );
}

export function TournamentForm({
  value,
  onChange,
  maps,
  civs,
}: {
  value: Borrador;
  onChange: (v: Borrador) => void;
  maps: GameMap[];
  civs: Civ[];
}) {
  const set = <K extends keyof Borrador>(k: K, v: Borrador[K]) => onChange({ ...value, [k]: v });

  return (
    <div className="space-y-6">
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
              onChange={(e) => {
                const n = Number(e.target.value);
                onChange({ ...value, team_size: n, civ_pattern: '' });
              }}
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
            <select className="field" value={value.best_of} onChange={(e) => set('best_of', Number(e.target.value))}>
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

      <section className="card p-5">
        <h3 className="title mb-1 text-lg">Draft</h3>
        <p className="mb-4 text-sm text-parch-400">
          Cómo se decide el mapa y las civilizaciones en la sala del partido.
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <Campo label="Mapa">
            <select className="field" value={value.map_mode} onChange={(e) => set('map_mode', e.target.value)}>
              {Object.entries(ETIQUETA_MAPA).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Campo>
          {value.map_mode === 'ban_pick' && (
            <Campo label="Bans de mapa por equipo">
              <input
                className="field"
                type="number"
                min={0}
                value={value.map_bans}
                onChange={(e) => set('map_bans', Number(e.target.value))}
              />
            </Campo>
          )}
          <Campo label="Reloj por paso (segundos)" hint="0 = sin reloj. Al vencerse se elige al azar.">
            <input
              className="field"
              type="number"
              min={0}
              step={5}
              value={value.draft_timer_s}
              onChange={(e) => set('draft_timer_s', Number(e.target.value))}
            />
          </Campo>

          <Campo label="Civilizaciones">
            <select className="field" value={value.civ_mode} onChange={(e) => set('civ_mode', e.target.value)}>
              {Object.entries(ETIQUETA_CIV).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Campo>
          {value.civ_mode === 'snake' && (
            <>
              <Campo label="Bans de civ por equipo">
                <input
                  className="field"
                  type="number"
                  min={0}
                  value={value.civ_bans}
                  onChange={(e) => set('civ_bans', Number(e.target.value))}
                />
              </Campo>
              <Campo
                label="Orden de picks"
                hint={`Vacío usa el sugerido: ${patronSugerido(value.team_size)}. La suma tiene que dar ${value.team_size * 2}.`}
              >
                <input
                  className="field"
                  value={value.civ_pattern}
                  onChange={(e) => set('civ_pattern', e.target.value)}
                  placeholder={patronSugerido(value.team_size)}
                />
              </Campo>
            </>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Check
            checked={value.civ_repeat_team}
            onChange={(v) => set('civ_repeat_team', v)}
            label="Permitir la misma civ dos veces en un equipo"
            hint="Apagado: cada jugador del equipo juega una civ distinta."
          />
          <Check
            checked={value.civ_mirror}
            onChange={(v) => set('civ_mirror', v)}
            label="Permitir espejos entre equipos"
            hint="Apagado: si un equipo toma España, el rival no puede."
          />
          <Check
            checked={value.civ_repeat_series}
            onChange={(v) => set('civ_repeat_series', v)}
            label="Permitir repetir civ entre partidas de la serie"
            hint="Apagado: en un BO3 cada equipo usa civs distintas en cada partida."
          />
          <Check
            checked={value.map_repeat}
            onChange={(v) => set('map_repeat', v)}
            label="Permitir repetir mapa dentro de la serie"
          />
        </div>
      </section>

      <section className="card p-5">
        <h3 className="title mb-4 text-lg">Inscripción</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo label="Costo" hint="0 = gratis.">
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

      <section className="card p-5">
        <h3 className="title mb-1 text-lg">Pool de mapas</h3>
        <p className="mb-4 text-sm text-parch-400">
          {value.map_mode === 'ban_hasta_uno'
            ? `Con bans alternados hasta que queda uno, el draft tendrá ${Math.max(0, value.map_ids.length - 1)} bans.`
            : 'Los mapas que van a estar disponibles en el draft.'}
        </p>
        <MapPicker maps={maps} value={value.map_ids} onChange={(v) => set('map_ids', v)} />
      </section>

      <section className="card p-5">
        <h3 className="title mb-4 text-lg">Civilizaciones habilitadas</h3>
        <CivPicker civs={civs} value={value.civ_ids} onChange={(v) => set('civ_ids', v)} />
      </section>
    </div>
  );
}
