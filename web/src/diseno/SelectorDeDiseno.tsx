import { type Diseno, elegirDiseno, useDiseno } from './diseno';

const OPCIONES: { id: Diseno; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'nuevo', label: 'Nuevo' },
];

/**
 * Conmutador para comparar el diseño original con el nuevo. Hay dos: el del
 * encabezado (pantallas anchas) y el `flotante`, abajo a la derecha, para
 * pantallas angostas, así no le suma ancho al encabezado.
 */
export function SelectorDeDiseno({ flotante = false }: { flotante?: boolean }) {
  const diseno = useDiseno();
  return (
    <div
      role="group"
      aria-label="Diseño de la página"
      title="Comparar el diseño original con el nuevo"
      className={`dn-selector items-center gap-0.5 rounded-lg border border-ink-700 p-0.5 text-xs ${
        flotante ? 'dn-selector-flotante fixed right-3 bottom-3 z-50 flex bg-ink-900 shadow-lg sm:hidden' : 'hidden sm:flex'
      }`}
    >
      <span className="hidden px-1.5 text-parch-400 lg:inline">Diseño</span>
      {OPCIONES.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={diseno === o.id}
          onClick={() => elegirDiseno(o.id)}
          className={`rounded-md px-2 py-1 transition-colors ${
            diseno === o.id ? 'bg-ink-800 text-gold-400' : 'text-parch-400 hover:text-parch-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
