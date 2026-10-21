import { useEffect, useMemo, useState } from 'react';
import type { DraftState } from '../types';
import { ETIQUETA_CIV, ETIQUETA_MAPA, ETIQUETA_PASO } from '../lib';
import { Avatar, Badge } from './ui';

function useCuentaRegresiva(deadline: string | null) {
  const [restante, setRestante] = useState<number | null>(null);
  useEffect(() => {
    if (!deadline) {
      setRestante(null);
      return;
    }
    const tick = () => setRestante(Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);
  return restante;
}

export function DraftBoard({
  draft,
  miEquipo,
  soyCapitan,
  esStaff,
  nombres,
  onReady,
  onAction,
  onIniciar,
}: {
  draft: DraftState | null;
  miEquipo: number | null;
  soyCapitan: boolean;
  esStaff: boolean;
  nombres: { a: string; b: string };
  onReady: () => void;
  onAction: (kind: string, targetId: number, forUserId?: number) => void;
  onIniciar: () => void;
}) {
  const restante = useCuentaRegresiva(draft?.deadline_at ?? null);

  const porCiv = useMemo(() => {
    const m = new Map<number, { nombre: string; flag: string }>();
    draft?.pools.civs.forEach((c) => m.set(c.id, { nombre: c.name_es, flag: c.flag }));
    return m;
  }, [draft]);

  if (!draft) {
    return (
      <div className="card flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-parch-400">Todavía no se abrió el draft de este partido.</p>
        <button className="btn btn-primary" onClick={onIniciar}>
          Abrir draft
        </button>
      </div>
    );
  }

  const miLado = miEquipo === draft.teams.a.id ? 'a' : miEquipo === draft.teams.b.id ? 'b' : null;
  // El organizador puede draftear por cualquiera de los dos (sirve para
  // destrabar un draft cuando un capitán no aparece).
  const esMiTurno =
    draft.state === 'en_curso' && ((draft.turn_team_id === miEquipo && soyCapitan) || esStaff);
  const paso = draft.step;

  const mapasBaneados = new Set(draft.maps_banned);
  const civsBaneadas = new Set(draft.civs_banned);
  const civsTomadas = new Map(draft.civ_picks.filter((p) => p.civ_id).map((p) => [p.civ_id!, p]));

  const civBloqueada = (id: number) => {
    if (civsBaneadas.has(id)) return 'baneada';
    const p = civsTomadas.get(id);
    if (!p) return null;
    const mismoEquipo = p.team_id === miEquipo;
    if (mismoEquipo && !draft.rules.civ_repeat_team) return 'tomada';
    if (!mismoEquipo && !draft.rules.civ_mirror) return 'tomada';
    return 'usada';
  };

  const faseMapa = paso?.kind.endsWith('mapa');
  const faseCiv = paso?.kind.endsWith('civ');

  return (
    <div className="card flex h-full min-h-0 flex-col overflow-hidden">
      {/* cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-700 px-4 py-3">
        <div>
          <h3 className="title text-base">
            Draft · partida {draft.game_no}
            <span className="ml-2 text-xs text-parch-400">
              paso {Math.min(draft.current_step + 1, draft.total_steps)}/{draft.total_steps}
            </span>
          </h3>
          <p className="mt-0.5 text-xs text-parch-400">
            {ETIQUETA_MAPA[draft.rules.map_mode]} · {ETIQUETA_CIV[draft.rules.civ_mode]}
            {draft.rules.civ_mode === 'snake' && ` (${draft.rules.civ_pattern})`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {draft.state === 'en_curso' && restante !== null && (
            <span
              className={`font-display rounded-lg border px-3 py-1 text-lg tabular-nums ${
                restante <= 10 ? 'border-blood-500 text-blood-500' : 'border-ink-600 text-parch-200'
              }`}
            >
              {String(Math.floor(restante / 60)).padStart(2, '0')}:{String(restante % 60).padStart(2, '0')}
            </span>
          )}
          {draft.state === 'finalizado' && <Badge tone="good">Draft cerrado</Badge>}
          {draft.state === 'espera' && <Badge tone="gold">Esperando a los dos equipos</Badge>}
        </div>
      </div>

      {/* turno */}
      {draft.state === 'en_curso' && paso && (
        <div
          className={`px-4 py-2 text-sm ${
            esMiTurno ? 'bg-gold-500/15 text-gold-400' : 'bg-ink-800 text-parch-400'
          }`}
        >
          {paso.auto ? (
            'El servidor está resolviendo este paso…'
          ) : (
            <>
              <strong>{ETIQUETA_PASO[paso.kind]}</strong> · turno de{' '}
              <strong>{paso.side === 'a' ? nombres.a : nombres.b}</strong>
              {esMiTurno && ' — te toca'}
              {!esMiTurno && miLado === paso.side && !soyCapitan && ' (lo decide tu capitán)'}
              {paso.blind && ' · pick ciego: el rival no lo ve hasta el final'}
            </>
          )}
        </div>
      )}

      {draft.state === 'espera' && (
        <div className="flex items-center justify-between gap-3 bg-ink-800 px-4 py-3 text-sm">
          <span className="text-parch-400">
            {nombres.a}: {draft.ready.a ? '✅ listo' : '⏳'} · {nombres.b}: {draft.ready.b ? '✅ listo' : '⏳'}
          </span>
          {miLado ? (
            !draft.ready[miLado] && (
              <button className="btn btn-primary" onClick={onReady}>
                Estoy listo
              </button>
            )
          ) : (
            esStaff && (
              <button className="btn btn-primary" onClick={onReady}>
                Arrancar draft
              </button>
            )
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* resumen de equipos */}
        <div className="mb-5 grid grid-cols-2 gap-3">
          {(['a', 'b'] as const).map((lado) => {
            const equipo = draft.teams[lado];
            const picks = draft.civ_picks.filter((p) => p.side === lado);
            return (
              <div
                key={lado}
                className={`rounded-lg border p-3 ${
                  draft.turn_team_id === equipo.id ? 'border-gold-600 bg-gold-500/5' : 'border-ink-700'
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-parch-100">{lado === 'a' ? nombres.a : nombres.b}</span>
                  {miEquipo === equipo.id && <Badge tone="gold">Tu equipo</Badge>}
                </div>
                <ul className="space-y-1.5">
                  {equipo.roster.map((j) => {
                    const pick = picks.find((p) => p.user_id === j.id);
                    const civ = pick?.civ_id ? porCiv.get(pick.civ_id) : null;
                    return (
                      <li key={j.id} className="flex items-center gap-2 text-sm">
                        <Avatar src={j.avatar_url} name={j.display_name} size={22} />
                        <span className="min-w-0 flex-1 truncate text-parch-200">{j.display_name}</span>
                        {civ ? (
                          <span className="flex items-center gap-1.5 text-xs text-gold-400">
                            <img src={civ.flag} alt="" className="h-4 w-6 rounded-[2px] object-cover" />
                            {civ.nombre}
                          </span>
                        ) : pick?.hidden ? (
                          <span className="text-xs text-parch-400">oculto</span>
                        ) : (
                          <span className="text-xs text-ink-600">—</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        {/* mapas */}
        <section className="mb-6">
          <h4 className="label flex items-center gap-2">
            Mapas
            {draft.map_picked && (
              <span className="text-gold-400 normal-case">
                · elegido: {draft.pools.maps.find((m) => m.id === draft.map_picked)?.name_es}
              </span>
            )}
          </h4>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
            {draft.pools.maps.map((m) => {
              const baneado = mapasBaneados.has(m.id);
              const elegido = draft.map_picked === m.id;
              const clickeable = esMiTurno && faseMapa && !baneado && !draft.map_picked;
              return (
                <button
                  key={m.id}
                  disabled={!clickeable}
                  onClick={() => onAction(paso!.kind, m.id)}
                  title={m.name_es}
                  className={`group relative overflow-hidden rounded-lg border p-1 text-left transition-all ${
                    elegido
                      ? 'border-gold-500 ring-2 ring-gold-500/40'
                      : baneado
                        ? 'border-ink-800 opacity-35'
                        : clickeable
                          ? 'border-ink-700 hover:-translate-y-0.5 hover:border-gold-500'
                          : 'border-ink-700'
                  }`}
                >
                  <img src={m.img} alt="" className="aspect-square w-full rounded object-cover" />
                  <span className="mt-1 block truncate text-[11px] text-parch-200">{m.name_es}</span>
                  {baneado && (
                    <span className="absolute inset-0 grid place-items-center text-2xl text-blood-500">✕</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* civilizaciones */}
        <section>
          <h4 className="label">
            Civilizaciones
            {!draft.rules.civ_repeat_team && <span className="normal-case"> · sin repetir dentro del equipo</span>}
            {!draft.rules.civ_mirror && <span className="normal-case"> · sin espejos</span>}
          </h4>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
            {draft.pools.civs.map((c) => {
              const estado = civBloqueada(c.id);
              const clickeable = esMiTurno && faseCiv && !(estado === 'baneada' || estado === 'tomada');
              return (
                <button
                  key={c.id}
                  disabled={!clickeable}
                  onClick={() => onAction(paso!.kind, c.id)}
                  className={`relative flex flex-col items-center gap-1 rounded-lg border p-2 transition-all ${
                    estado === 'baneada'
                      ? 'border-ink-800 opacity-30'
                      : estado
                        ? 'border-gold-700/40 opacity-60'
                        : clickeable
                          ? 'border-ink-700 hover:-translate-y-0.5 hover:border-gold-500'
                          : 'border-ink-700'
                  }`}
                >
                  <img src={c.flag} alt="" className="h-8 w-12 rounded-[3px] object-cover" />
                  <span className="truncate text-[11px] text-parch-200">{c.name_es}</span>
                  {estado === 'baneada' && (
                    <span className="absolute inset-0 grid place-items-center text-xl text-blood-500">✕</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* historial de pasos */}
        <section className="mt-6">
          <h4 className="label">Secuencia</h4>
          <ol className="flex flex-wrap gap-1.5">
            {draft.steps.map((s, i) => {
              const hecho = i < draft.current_step;
              const actual = i === draft.current_step && draft.state === 'en_curso';
              return (
                <li
                  key={s.idx}
                  className={`rounded px-2 py-1 text-[11px] ${
                    actual
                      ? 'bg-gold-500 text-ink-950'
                      : hecho
                        ? 'bg-ink-800 text-parch-400'
                        : 'border border-ink-700 text-ink-600'
                  }`}
                >
                  {s.side ? (s.side === 'a' ? nombres.a : nombres.b).slice(0, 10) : 'auto'} ·{' '}
                  {ETIQUETA_PASO[s.kind].replace('ar ', '')}
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </div>
  );
}
