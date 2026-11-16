import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useDisenoNuevo } from '../diseno/diseno';

// Las clases `dn-*` y los `data-*` de este archivo solo tienen estilo en el
// diseño nuevo (diseno/nuevo.css); en el original no cambian nada.

export function Avatar({ src, name, size = 28 }: { src?: string | null; name: string; size?: number }) {
  const iniciales = name.slice(0, 2).toUpperCase();
  return src ? (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      className="dn-avatar shrink-0 rounded-full border border-ink-700 object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="dn-avatar grid shrink-0 place-items-center rounded-full border border-ink-700 bg-ink-800 text-[10px] font-semibold text-parch-400"
      style={{ width: size, height: size }}
    >
      {iniciales}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'gold' | 'good' | 'bad' | 'info';
}) {
  const tonos = {
    neutral: 'border-ink-600 text-parch-400',
    gold: 'border-gold-600 text-gold-400',
    good: 'border-moss-500 text-moss-500',
    bad: 'border-blood-500 text-blood-500',
    info: 'border-ink-600 bg-ink-800 text-parch-200',
  } as const;
  return (
    <span
      data-tono={tone}
      className={`dn-badge inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${tonos[tone]}`}
    >
      {children}
    </span>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string; count?: number }[];
}) {
  const nuevo = useDisenoNuevo();
  const contenedor = useRef<HTMLDivElement>(null);
  const [barra, setBarra] = useState<{ x: number; y: number; ancho: number } | null>(null);
  // El ancho de cada pestaña depende de su texto y de su contador.
  const forma = items.map((it) => `${it.id}:${it.label}:${it.count ?? ''}`).join('|');

  // Diseño nuevo: la barra de la pestaña activa se desliza de una a otra.
  useLayoutEffect(() => {
    const el = contenedor.current;
    if (!nuevo || !el) {
      setBarra(null);
      return;
    }
    const medir = () => {
      const activa = el.querySelector<HTMLElement>('[data-activa="true"]');
      setBarra(
        activa
          ? { x: activa.offsetLeft, y: activa.offsetTop + activa.offsetHeight - 1, ancho: activa.offsetWidth }
          : null
      );
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [nuevo, value, forma]);

  return (
    <div ref={contenedor} className="dn-tabs flex flex-wrap gap-1 border-b border-ink-700">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          data-activa={value === it.id}
          className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
            value === it.id
              ? 'border-gold-500 text-gold-400'
              : 'border-transparent text-parch-400 hover:text-parch-200'
          }`}
        >
          {it.label}
          {it.count !== undefined && <span className="ml-1.5 text-xs opacity-60">{it.count}</span>}
        </button>
      ))}
      {nuevo && barra && (
        <i
          aria-hidden
          className="dn-tabs-barra"
          style={{ transform: `translate(${barra.x}px, ${barra.y}px) scaleX(${barra.ancho})` }}
        />
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="dn-vacio rounded-lg border border-dashed border-ink-700 p-6 text-center text-sm text-parch-400">
      {children}
    </p>
  );
}

export function Spinner() {
  return (
    <div className="dn-spinner flex items-center justify-center p-10">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-600 border-t-gold-500" />
    </div>
  );
}

/** Cuánto dura la salida de la ventana en el diseño nuevo (igual que en nuevo.css). */
const SALIDA_MS = 150;

/**
 * Mantiene montado lo que se cierra mientras dura su animación de salida.
 * Con `ms` en 0 (diseño original) se desmonta en el mismo render, como siempre.
 */
function useSalida(abierto: boolean, ms: number) {
  const [montado, setMontado] = useState(abierto);
  useEffect(() => {
    if (abierto) {
      setMontado(true);
      return;
    }
    const espera = setTimeout(() => setMontado(false), ms);
    return () => clearTimeout(espera);
  }, [abierto, ms]);
  const visible = abierto || (ms > 0 && montado);
  return { visible, saliendo: visible && !abierto };
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const nuevo = useDisenoNuevo();
  // Cerrada con Escape se va al instante: lo que se pide por teclado no se anima.
  const [porTeclado, setPorTeclado] = useState(false);
  const { visible, saliendo } = useSalida(open, nuevo && !porTeclado ? SALIDA_MS : 0);

  useEffect(() => {
    if (!open) return;
    setPorTeclado(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPorTeclado(true);
      onClose();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);

  if (!visible) return null;
  return (
    <div
      className="dn-modal-fondo fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
      data-saliendo={saliendo || undefined}
      onClick={onClose}
    >
      <div
        className={`dn-modal card max-h-[85vh] w-full overflow-auto p-5 ${wide ? 'max-w-4xl' : 'max-w-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="title text-lg">{title}</h3>
          <button onClick={onClose} className="dn-cerrar text-parch-400 hover:text-parch-100">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Alerta({ children, tone = 'bad' }: { children: ReactNode; tone?: 'bad' | 'good' | 'info' }) {
  if (!children) return null;
  const tonos = {
    bad: 'border-blood-500/50 bg-blood-500/10 text-blood-500',
    good: 'border-moss-500/50 bg-moss-500/10 text-moss-500',
    info: 'border-ink-600 bg-ink-800 text-parch-200',
  } as const;
  return (
    <div data-tono={tone} className={`dn-alerta rounded-lg border px-3 py-2 text-sm ${tonos[tone]}`}>
      {children}
    </div>
  );
}
