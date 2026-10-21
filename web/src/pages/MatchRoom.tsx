import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Alerta, Badge, Modal, Spinner } from '../components/ui';
import { ChatPanel, type SalaChat } from '../components/ChatPanel';
import { DraftBoard } from '../components/DraftBoard';
import { useSocket } from '../ws';
import { ETIQUETA_ESTADO_PARTIDO, fechaCorta, offsetZona, rangoSemana, zonaDelNavegador } from '../lib';
import type { ChatMessage, DraftState, MatchDetail, Window } from '../types';

export function MatchRoom() {
  const { id } = useParams();
  const { user } = useAuth();
  const [m, setM] = useState<MatchDetail | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState('');
  const [mensajes, setMensajes] = useState<Record<string, ChatMessage[]>>({});
  const [presencia, setPresencia] = useState<Record<string, { id: number; display_name: string; avatar_url: string | null }[]>>({});

  const cargar = useCallback(async () => {
    try {
      const d = await api.get<MatchDetail>(`/api/matches/${id}`);
      setM(d);
      setDraft(d.draft);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const salas = useMemo(() => {
    const out = [`match:${id}`];
    if (m?.me.team_id) out.push(`team:${m.me.team_id}`);
    return out;
  }, [id, m?.me.team_id]);

  const { conectado, enviar } = useSocket(salas, (msg) => {
    if (msg.type === 'history') setMensajes((p) => ({ ...p, [msg.room]: msg.messages as ChatMessage[] }));
    if (msg.type === 'chat')
      setMensajes((p) => ({ ...p, [msg.room]: [...(p[msg.room] ?? []), msg.message as ChatMessage] }));
    if (msg.type === 'presence') setPresencia((p) => ({ ...p, [msg.room]: msg.users as never }));
    if (msg.type === 'draft') setDraft(msg.payload as DraftState);
    if (msg.type === 'match') void cargar();
  });

  if (error) return <div className="mx-auto max-w-3xl p-10"><Alerta>{error}</Alerta></div>;
  if (!m) return <Spinner />;

  const nombres = { a: m.teams.a?.name ?? 'Equipo A', b: m.teams.b?.name ?? 'Equipo B' };
  const faltanEquipos = !m.team_a_id || !m.team_b_id;

  const salasChat: SalaChat[] = [
    { id: `match:${id}`, label: 'Sala del partido', hint: 'La ven los dos equipos y el organizador.' },
    ...(m.me.team_id
      ? [{ id: `team:${m.me.team_id}`, label: 'Mi equipo', hint: 'Privada: solo tus compañeros.' }]
      : []),
  ];

  const accionDraft = async (kind: string, targetId: number, forUserId?: number) => {
    setError('');
    try {
      setDraft(
        await api.post<DraftState>(`/api/matches/${id}/draft/action`, {
          kind,
          target_id: targetId,
          for_user_id: forUserId,
        })
      );
    } catch (err) {
      setError((err as Error).message);
      setTimeout(() => setError(''), 4000);
    }
  };

  return (
    <div className="mx-auto max-w-[110rem] px-4 py-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to={`/t/${m.tournament.slug}`} className="text-xs text-parch-400 hover:text-gold-400">
            ← {m.tournament.name}
          </Link>
          <h1 className="title mt-1 flex flex-wrap items-center gap-3 text-2xl">
            <span className={m.winner_team_id === m.team_a_id ? 'text-gold-400' : ''}>{nombres.a}</span>
            <span className="tabular-nums text-parch-400">
              {m.score_a} – {m.score_b}
            </span>
            <span className={m.winner_team_id === m.team_b_id ? 'text-gold-400' : ''}>{nombres.b}</span>
          </h1>
          <p className="mt-1 text-sm text-parch-400">
            {m.label ?? `Ronda ${m.round}`} · BO{m.best_of} · {ETIQUETA_ESTADO_PARTIDO[m.status] ?? m.status}
            {m.scheduled_at && ` · ${fechaCorta(m.scheduled_at, user?.timezone)}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {m.me.team_id && <Badge tone="gold">Jugás este partido</Badge>}
          {m.me.is_staff && <Badge>Organizador</Badge>}
          <Agendar m={m} onDone={cargar} />
          {m.me.can_report && <Reportar m={m} onDone={cargar} />}
        </div>
      </header>

      {error && <div className="mb-3"><Alerta>{error}</Alerta></div>}
      {faltanEquipos && (
        <div className="mb-3">
          <Alerta tone="info">Este partido todavía espera a los ganadores de la ronda anterior.</Alerta>
        </div>
      )}

      <div className="grid h-[calc(100vh-14rem)] min-h-[34rem] gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <ChatPanel
          salas={salasChat}
          mensajes={mensajes}
          presencia={presencia}
          onSend={(room, body) => enviar({ type: 'chat', room, body })}
          puedeEscribir={!!user && (!!m.me.team_id || m.me.is_staff)}
          conectado={conectado}
        />

        <div className="min-h-0">
          {faltanEquipos ? (
            <div className="card grid h-full place-items-center p-8 text-parch-400">
              Cuando estén los dos equipos se abre el draft.
            </div>
          ) : (
            <DraftBoard
              draft={draft}
              miEquipo={m.me.team_id}
              soyCapitan={m.me.is_captain}
              esStaff={m.me.is_staff}
              nombres={nombres}
              onIniciar={async () => {
                try {
                  setDraft(await api.post<DraftState>(`/api/matches/${id}/draft`, {}));
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
              onReady={async () => {
                try {
                  setDraft(await api.post<DraftState>(`/api/matches/${id}/draft/ready`));
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
              onAction={accionDraft}
            />
          )}
        </div>
      </div>

      {m.games.length > 0 && (
        <section className="card mt-4 p-4">
          <h3 className="title mb-3 text-base">Partidas de la serie</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {m.games.map((g) => (
              <div key={g.id} className="rounded-lg border border-ink-700 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <strong className="text-sm text-parch-100">Partida {g.game_no}</strong>
                  {g.winner_team_id && (
                    <Badge tone="good">
                      Ganó {g.winner_team_id === m.team_a_id ? nombres.a : nombres.b}
                    </Badge>
                  )}
                </div>
                {g.map && (
                  <div className="mb-2 flex items-center gap-2">
                    <img src={g.map.img} alt="" className="h-10 w-10 rounded object-cover" />
                    <span className="text-sm text-parch-200">{g.map.name_es}</span>
                  </div>
                )}
                <ul className="space-y-1">
                  {g.civs.map((c) => (
                    <li key={c.user_id} className="flex items-center gap-2 text-xs text-parch-400">
                      <img src={c.flag} alt="" className="h-3.5 w-5 rounded-[2px] object-cover" />
                      <span className="text-parch-200">{c.display_name}</span> · {c.name_es}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- agendar

function Agendar({ m, onDone }: { m: MatchDetail; onDone: () => void }) {
  const { user } = useAuth();
  const tz = user?.timezone || zonaDelNavegador();
  const [abierto, setAbierto] = useState(false);
  const [data, setData] = useState<{ windows: Window[]; partial: Window[]; users: { id: number; display_name: string }[] } | null>(null);
  const [manual, setManual] = useState('');

  useEffect(() => {
    if (!abierto) return;
    api
      .get<{ windows: Window[]; partial: Window[]; users: { id: number; display_name: string }[] }>(
        `/api/matches/${m.id}/schedule?duration=90`
      )
      .then(setData)
      .catch(() => setData(null));
  }, [abierto, m.id]);

  const offset = offsetZona(tz);
  const puede = m.me.can_report;

  const guardar = async (iso: string | null) => {
    await api.post(`/api/matches/${m.id}/schedule`, { scheduled_at: iso });
    setAbierto(false);
    onDone();
  };

  return (
    <>
      <button className="btn btn-ghost" onClick={() => setAbierto(true)}>
        {m.scheduled_at ? 'Cambiar horario' : 'Buscar horario'}
      </button>

      <Modal open={abierto} onClose={() => setAbierto(false)} title="Horarios en común" wide>
        {!data ? (
          <Spinner />
        ) : (
          <div className="space-y-5">
            <p className="text-sm text-parch-400">
              Cruce de la disponibilidad cargada por los {data.users.length} jugadores del partido, en tu zona ({tz}).
            </p>

            {data.windows.length === 0 && data.partial.length === 0 && (
              <Alerta tone="info">
                No hay ninguna franja en común. Pedí en la sala del partido que carguen o amplíen sus horarios en
                el perfil.
              </Alerta>
            )}

            {data.windows.length > 0 && (
              <section>
                <h4 className="label">Todos pueden</h4>
                <ul className="space-y-2">
                  {data.windows.map((w, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-ink-700 px-3 py-2">
                      <div>
                        <p className="text-sm text-parch-100">{rangoSemana(w.start_min, w.end_min, offset)}</p>
                        <p className="text-xs text-parch-400">Próxima: {fechaCorta(w.next_utc, tz)}</p>
                      </div>
                      {puede && (
                        <button className="btn btn-primary" onClick={() => guardar(w.next_utc)}>
                          Agendar
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.partial.length > 0 && (
              <section>
                <h4 className="label">Falta uno</h4>
                <ul className="space-y-2">
                  {data.partial.map((w, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-ink-700 px-3 py-2">
                      <div>
                        <p className="text-sm text-parch-200">{rangoSemana(w.start_min, w.end_min, offset)}</p>
                        <p className="text-xs text-parch-400">
                          No puede: {w.missing.map((id) => data.users.find((u) => u.id === id)?.display_name).join(', ')}
                        </p>
                      </div>
                      {puede && (
                        <button className="btn btn-ghost" onClick={() => guardar(w.next_utc)}>
                          Agendar igual
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {puede && (
              <section className="border-t border-ink-700 pt-4">
                <h4 className="label">O poné la fecha a mano</h4>
                <div className="flex gap-2">
                  <input
                    className="field"
                    type="datetime-local"
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={!manual}
                    onClick={() => guardar(new Date(manual).toISOString())}
                  >
                    Agendar
                  </button>
                  {m.scheduled_at && (
                    <button className="btn btn-danger" onClick={() => guardar(null)}>
                      Quitar
                    </button>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

// --------------------------------------------------------------- reportar

function Reportar({ m, onDone }: { m: MatchDetail; onDone: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [gameNo, setGameNo] = useState(String(Math.max(1, m.score_a + m.score_b + 1)));
  const [ganador, setGanador] = useState('');
  const [replay, setReplay] = useState('');
  const [error, setError] = useState('');

  const enviar = async () => {
    setError('');
    try {
      await api.post(`/api/matches/${m.id}/games/${Number(gameNo)}`, {
        winner_team_id: Number(ganador),
        replay_url: replay || null,
      });
      setAbierto(false);
      setReplay('');
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <button className="btn btn-primary" onClick={() => setAbierto(true)}>
        Reportar resultado
      </button>
      <Modal open={abierto} onClose={() => setAbierto(false)} title="Reportar una partida">
        <div className="space-y-4">
          <div>
            <label className="label">Partida</label>
            <select className="field" value={gameNo} onChange={(e) => setGameNo(e.target.value)}>
              {Array.from({ length: m.best_of }, (_, i) => (
                <option key={i} value={i + 1}>
                  Partida {i + 1}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Ganador</label>
            <select className="field" value={ganador} onChange={(e) => setGanador(e.target.value)}>
              <option value="">Elegir…</option>
              {m.teams.a && <option value={m.teams.a.id}>{m.teams.a.name}</option>}
              {m.teams.b && <option value={m.teams.b.id}>{m.teams.b.name}</option>}
            </select>
          </div>
          <div>
            <label className="label">Link del replay (opcional)</label>
            <input className="field" value={replay} onChange={(e) => setReplay(e.target.value)} placeholder="https://…" />
          </div>
          {error && <Alerta>{error}</Alerta>}
          <button className="btn btn-primary w-full" disabled={!ganador} onClick={enviar}>
            Guardar
          </button>
        </div>
      </Modal>
    </>
  );
}
