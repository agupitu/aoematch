import { useState } from 'react';
import {
  type EstadoDraft, abrirDraft, banearCiv, elegirCiv, elegirMapaDelDraft, reiniciarDraft,
} from '../datos/drafts';
import { civPorId, mapaPorId } from '../logica/catalogo.js';
import { civsPermitidas, turnoDeBan } from '../logica/draft.js';
import type { MatchDetail } from '../types';
import { Avatar, Badge } from './ui';

/**
 * Draft de la partida actual (plan Spark): mapa del que perdió la anterior,
 * bans de civ si el torneo los tiene y pick ciego de cada jugador. Sin reloj.
 */
export function DraftBoard({
  m,
  gameNo,
  estado,
  uid,
  onError,
}: {
  m: MatchDetail;
  gameNo: number | null;
  estado: EstadoDraft;
  uid: string | null;
  onError: (mensaje: string) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const { draft, mio, picks } = estado;
  const nombres: Record<string, string> = {
    [m.team_a_id ?? 'a']: m.teams.a?.name ?? 'Equipo A',
    [m.team_b_id ?? 'b']: m.teams.b?.name ?? 'Equipo B',
  };

  const hacer = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    try {
      await fn();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  if (draft === undefined) return <div className="card grid h-full place-items-center p-8 text-parch-400">Cargando…</div>;

  if (!gameNo) {
    return (
      <div className="card grid h-full place-items-center p-8 text-parch-400">La serie está cerrada.</div>
    );
  }

  if (!draft) {
    const puedeAbrir = !!m.me.team_id || m.me.is_staff;
    return (
      <div className="card flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-parch-400">Todavía no se abrió el draft de la partida {gameNo}.</p>
        {puedeAbrir && (
          <button className="btn btn-primary" disabled={ocupado} onClick={() => hacer(() => abrirDraft(m.id, gameNo))}>
            Abrir draft
          </button>
        )}
      </div>
    );
  }

  // Draft del modelo anterior (bans en serpiente, reloj): no se puede seguir.
  if (!Array.isArray(draft.player_ids)) {
    return (
      <div className="card flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-parch-400">Este draft quedó del sistema anterior. El organizador puede reiniciarlo.</p>
        {m.me.is_staff && (
          <button className="btn btn-primary" disabled={ocupado} onClick={() => hacer(() => reiniciarDraft(m.id, gameNo))}>
            Reiniciar draft
          </button>
        )}
      </div>
    );
  }

  const miEquipo = uid ? (draft.team_of[uid] ?? null) : null;
  const juego = !!miEquipo;
  const picked = new Set(draft.picked ?? []);
  const baneadas = new Set(draft.banned_civ_ids);
  const turnoBan = turnoDeBan(draft);
  const permitidas = new Set<number>(uid && juego ? civsPermitidas(draft, uid) : []);

  const puedoMapa = !!uid && draft.state === 'mapa' && miEquipo === draft.map_chooser_team_id;
  const puedoBanear = !!uid && draft.state === 'bans' && miEquipo === turnoBan;
  const puedoElegir = !!uid && draft.state === 'picks' && juego && !draft.revealed;
  const turnoId = draft.state === 'mapa' ? draft.map_chooser_team_id : draft.state === 'bans' ? turnoBan : null;
  const tonoTurno = !turnoId
    ? 'bg-ink-800 text-parch-400'
    : turnoId === m.team_a_id
      ? 'bg-gold-500/15 text-gold-400'
      : 'bg-moss-500/15 text-moss-500';

  const aviso =
    draft.state === 'mapa'
      ? `${nombres[draft.map_chooser_team_id!]} elige el mapa (perdió la partida anterior)`
      : draft.state === 'bans'
        ? `Banea ${nombres[turnoBan!]} (${draft.banned_civ_ids.length + 1} de ${draft.ban_order.length})`
        : draft.state === 'picks'
          ? `Cada jugador elige su civ sin ver las demás · eligieron ${picked.size} de ${draft.player_ids.length}`
          : 'Draft cerrado';
  const meToca = puedoMapa || puedoBanear || (puedoElegir && mio == null);

  const mapa = draft.map_id ? mapaPorId(draft.map_id) : null;
  const miCiv = uid && mio != null ? civPorId(mio) : null;
  const equipos = [m.team_a_id, m.team_b_id].filter(Boolean) as string[];
  const roster = (teamId: string) =>
    (teamId === m.team_a_id ? m.teams.a?.roster : m.teams.b?.roster)?.filter((j) => draft.player_ids.includes(j.id)) ?? [];

  return (
    <div className="card flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {mapa && (
        <div className="flex items-center gap-4 border-b border-ink-700 bg-ink-900 px-4 py-3">
          <img src={mapa.img} alt="" className="h-24 w-24 shrink-0 rounded-lg object-cover sm:h-32 sm:w-32" />
          <div className="min-w-0">
            <p className="text-xs tracking-wide text-parch-400 uppercase">Mapa</p>
            <p className="title truncate text-xl text-parch-100 sm:text-2xl">{mapa.name_es}</p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-700 px-4 py-3">
        <div>
          <h3 className="title text-base">Draft · partida {draft.game_no}</h3>
          <p className="mt-0.5 text-xs text-parch-400">
            {mapa ? mapa.name_es : 'Mapa por elegir'} · pick ciego
            {draft.ban_order.length > 0 && ` · ${draft.ban_order.length / 2} ban${draft.ban_order.length > 2 ? 's' : ''} por equipo`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {draft.state === 'listo' && <Badge tone="good">Draft cerrado</Badge>}
          {m.me.is_staff && (
            <button
              className="btn"
              disabled={ocupado}
              onClick={() => {
                if (confirm('¿Reiniciar el draft? Se borran mapa, bans y picks.')) void hacer(() => reiniciarDraft(m.id, draft.game_no));
              }}
            >
              Reiniciar
            </button>
          )}
        </div>
      </div>

      <div className={`px-4 py-2 text-sm ${tonoTurno}`}>
        {aviso}
        {meToca && ' — te toca'}
      </div>
      {miCiv && !draft.revealed && (
        <p className="border-b border-ink-800 px-4 py-2 text-sm text-gold-400">
          Tu civ: {miCiv.name_es}. Podés cambiarla hasta que elijan todos.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-5 grid grid-cols-2 gap-3">
          {equipos.map((teamId) => (
            <div key={teamId} className="rounded-lg border border-ink-700 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-parch-100">{nombres[teamId]}</span>
                {miEquipo === teamId && <Badge tone="gold">Tu equipo</Badge>}
              </div>
              <ul className="space-y-1.5">
                {roster(teamId).map((j) => {
                  const civId = picks?.[j.id] ?? (j.id === uid ? mio : null);
                  const civ = civId != null ? civPorId(civId) : null;
                  return (
                    <li key={j.id} className="flex items-center gap-2 text-sm">
                      <Avatar src={j.avatar_url} name={j.display_name} size={22} />
                      <span className="min-w-0 flex-1 truncate text-parch-200">{j.display_name}</span>
                      {civ ? (
                        <span className="flex items-center gap-1.5 text-xs text-gold-400">
                          <img src={civ.flag} alt="" className="h-4 w-6 rounded-[2px] object-cover" />
                          {civ.name_es}
                        </span>
                      ) : picked.has(j.id) ? (
                        <span className="text-xs text-parch-400">eligió</span>
                      ) : (
                        <span className="text-xs text-ink-600">falta</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <section className="mb-6">
          <h4 className="label">Mapas</h4>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
            {draft.map_pool.map((id) => {
              const mp = mapaPorId(id);
              if (!mp) return null;
              const elegido = draft.map_id === id;
              const clase = `relative overflow-hidden rounded-lg border p-1 text-left ${
                elegido
                  ? 'border-gold-500 ring-2 ring-gold-500/40'
                  : draft.map_id
                    ? 'border-ink-800 opacity-35'
                    : puedoMapa
                      ? 'border-ink-700 transition-all hover:-translate-y-0.5 hover:border-gold-500'
                      : 'border-ink-700'
              }`;
              const cuerpo = (
                <>
                  <img src={mp.img} alt="" className="aspect-square w-full rounded object-cover" />
                  <span className="mt-1 block truncate text-[11px] text-parch-200">{mp.name_es}</span>
                </>
              );
              return puedoMapa ? (
                <button
                  key={id}
                  disabled={ocupado}
                  onClick={() => hacer(() => elegirMapaDelDraft(m.id, draft.game_no, miEquipo!, id))}
                  title={mp.name_es}
                  className={clase}
                >
                  {cuerpo}
                </button>
              ) : (
                <div key={id} className={clase} title={mp.name_es}>
                  {cuerpo}
                </div>
              );
            })}
          </div>
        </section>

        {draft.banned_civ_ids.length > 0 && (
          <section className="mb-6">
            <h4 className="label">Baneadas</h4>
            <ul className="flex flex-wrap gap-2">
              {draft.banned_civ_ids.map((id, i) => {
                const c = civPorId(id);
                const teamId = draft.ban_order[i];
                if (!c) return null;
                return (
                  <li
                    key={`${id}-${i}`}
                    className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-xs ${
                      teamId === m.team_a_id ? 'border-gold-600/50 text-gold-400' : 'border-moss-500/50 text-moss-500'
                    }`}
                  >
                    <img src={c.flag} alt="" className="h-4 w-6 rounded-[2px] object-cover" />
                    <span>{c.name_es}</span>
                    <span className="text-parch-400">· {nombres[teamId] ?? 'equipo'}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section>
          <h4 className="label">Civilizaciones</h4>
          <div className="grid grid-cols-3 gap-2 min-[420px]:grid-cols-4 sm:grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]">
            {draft.civ_pool.map((id) => {
              const c = civPorId(id);
              if (!c) return null;
              const baneada = baneadas.has(id);
              const clickeable = !ocupado && ((puedoBanear && !baneada) || (puedoElegir && permitidas.has(id)));
              const clase = `relative flex min-w-0 flex-col items-center gap-1 rounded-lg border p-2 ${
                baneada
                  ? 'border-ink-800 opacity-30'
                  : mio === id
                    ? 'border-gold-500 ring-2 ring-gold-500/40'
                    : clickeable
                      ? 'border-ink-700 transition-all hover:-translate-y-0.5 hover:border-gold-500'
                      : 'border-ink-700'
              }`;
              const cuerpo = (
                <>
                  <img src={c.flag} alt="" className="h-8 w-12 rounded-[3px] object-cover" />
                  <span className="w-full truncate text-center text-[11px] text-parch-200">{c.name_es}</span>
                </>
              );
              return clickeable ? (
                <button
                  key={id}
                  onClick={() =>
                    hacer(() =>
                      puedoBanear ? banearCiv(m.id, draft.game_no, miEquipo!, id) : elegirCiv(draft, m.id, uid!, id)
                    )
                  }
                  className={clase}
                >
                  {cuerpo}
                </button>
              ) : (
                <div key={id} className={clase}>
                  {cuerpo}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
