import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';
import { hora } from '../lib';
import { Avatar } from './ui';

export type SalaChat = { id: string; label: string; hint?: string };

export function ChatPanel({
  salas,
  mensajes,
  presencia,
  onSend,
  puedeEscribir,
  conectado,
}: {
  salas: SalaChat[];
  mensajes: Record<string, ChatMessage[]>;
  presencia: Record<string, { id: number; display_name: string; avatar_url: string | null }[]>;
  onSend: (sala: string, texto: string) => void;
  puedeEscribir: boolean;
  conectado: boolean;
}) {
  const [activa, setActiva] = useState(salas[0]?.id ?? '');
  const [texto, setTexto] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!salas.some((s) => s.id === activa) && salas.length) setActiva(salas[0].id);
  }, [salas, activa]);

  const lista = mensajes[activa] ?? [];

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lista.length, activa]);

  const enviar = () => {
    const t = texto.trim();
    if (!t) return;
    onSend(activa, t);
    setTexto('');
  };

  const gente = presencia[activa] ?? [];

  return (
    <div className="card flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-ink-700 px-2">
        <div className="flex gap-1">
          {salas.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiva(s.id)}
              title={s.hint}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                activa === s.id
                  ? 'border-gold-500 text-gold-400'
                  : 'border-transparent text-parch-400 hover:text-parch-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pr-2">
          <span className="flex -space-x-2">
            {gente.slice(0, 5).map((u) => (
              <span key={u.id} title={u.display_name}>
                <Avatar src={u.avatar_url} name={u.display_name} size={20} />
              </span>
            ))}
          </span>
          <span
            title={conectado ? 'Conectado' : 'Reconectando…'}
            className={`h-2 w-2 rounded-full ${conectado ? 'bg-moss-500' : 'bg-blood-500'}`}
          />
        </div>
      </div>

      <div ref={scroller} className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {lista.length === 0 && (
          <p className="pt-6 text-center text-sm text-parch-400">Todavía no hay mensajes acá.</p>
        )}
        {lista.map((m) =>
          m.system ? (
            <p key={m.id} className="text-center text-xs text-parch-400 italic">
              {m.body}
            </p>
          ) : (
            <div key={m.id} className="flex gap-2">
              <Avatar src={m.user?.avatar_url} name={m.user?.display_name ?? '??'} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-gold-400">{m.user?.display_name}</span>
                  <span className="text-[10px] text-parch-400">{hora(m.created_at)}</span>
                </div>
                <p className="text-sm break-words whitespace-pre-wrap text-parch-100">{m.body}</p>
              </div>
            </div>
          )
        )}
      </div>

      <div className="border-t border-ink-700 p-2">
        {puedeEscribir ? (
          <div className="flex gap-2">
            <input
              className="field"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  enviar();
                }
              }}
              placeholder="Escribí un mensaje…"
              maxLength={2000}
            />
            <button className="btn btn-primary" onClick={enviar}>
              Enviar
            </button>
          </div>
        ) : (
          <p className="py-1 text-center text-xs text-parch-400">Solo lectura.</p>
        )}
      </div>
    </div>
  );
}
