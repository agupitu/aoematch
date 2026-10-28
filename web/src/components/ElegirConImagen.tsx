import { type ReactNode, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { coincide } from '../lib';

export type ItemElegible = { id: number; nombre: string; img: string };

const ANCHO = 256;
const ALTO = 288;

/**
 * Un botón que abre una lista con buscador para elegir una cosa con su imagen
 * y su nombre (una civ con su bandera, un mapa con su miniatura). El botón lo
 * dibuja quien lo usa (`children`: lo elegido, o un lugar vacío). La lista va
 * en un portal: no la recorta el contenedor con scroll de un modal.
 * `valor` es el id elegido como texto ('' = nada).
 */
export function ElegirConImagen({
  items, valor, onChange, titulo, vacio = 'Sin elegir', disabled = false, className, children,
}: {
  items: ItemElegible[];
  valor: string;
  onChange: (valor: string) => void;
  titulo: string;
  vacio?: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const boton = useRef<HTMLButtonElement>(null);
  const [lugar, setLugar] = useState<{ top: number; left: number } | null>(null);
  const [q, setQ] = useState('');

  const abrir = () => {
    const r = boton.current?.getBoundingClientRect();
    if (!r) return;
    // Debajo del botón si entra; si no, arriba.
    const abajo = window.innerHeight - r.bottom >= ALTO + 8 || r.top < ALTO + 8;
    setLugar({
      top: abajo ? r.bottom + 4 : r.top - ALTO - 4,
      left: Math.max(8, Math.min(r.left, window.innerWidth - ANCHO - 8)),
    });
    setQ('');
  };
  const cerrar = () => setLugar(null);
  const elegir = (v: string) => {
    onChange(v);
    cerrar();
  };
  const visibles = items.filter((i) => coincide(q, i.nombre));

  return (
    <>
      <button
        ref={boton}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-label={titulo}
        title={titulo}
        onClick={abrir}
        className={className}
      >
        {children}
      </button>
      {lugar &&
        createPortal(
          <div
            className="fixed inset-0 z-[70]"
            onClick={cerrar}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              // Que no cierre también el modal de abajo.
              e.stopPropagation();
              cerrar();
            }}
          >
            <div
              role="listbox"
              aria-label={titulo}
              style={{ top: lugar.top, left: lugar.left, width: ANCHO, maxHeight: ALTO }}
              className="absolute flex flex-col overflow-hidden rounded-lg border border-ink-600 bg-ink-900 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                autoFocus
                className="border-b border-ink-700 bg-transparent px-3 py-2 text-xs text-parch-100 outline-none placeholder:text-parch-400/60"
                placeholder="Buscar…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <div className="overflow-y-auto">
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-xs text-parch-400 hover:bg-ink-800"
                  onClick={() => elegir('')}
                >
                  {vacio}
                </button>
                {visibles.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    role="option"
                    aria-selected={String(i.id) === valor}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-ink-800 ${
                      String(i.id) === valor ? 'bg-gold-500/10 text-gold-400' : 'text-parch-200'
                    }`}
                    onClick={() => elegir(String(i.id))}
                  >
                    <img src={i.img} alt="" className="h-4 w-6 shrink-0 rounded-[2px] object-cover" />
                    <span className="truncate">{i.nombre}</span>
                  </button>
                ))}
                {!visibles.length && <p className="px-3 py-2 text-xs text-parch-400">Nada coincide con «{q}».</p>}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
