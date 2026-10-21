import { useEffect, type ReactNode } from 'react';

export function Avatar({ src, name, size = 28 }: { src?: string | null; name: string; size?: number }) {
  const iniciales = name.slice(0, 2).toUpperCase();
  return src ? (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      className="shrink-0 rounded-full border border-ink-700 object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="grid shrink-0 place-items-center rounded-full border border-ink-700 bg-ink-800 text-[10px] font-semibold text-parch-400"
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
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${tonos[tone]}`}>
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
  return (
    <div className="flex flex-wrap gap-1 border-b border-ink-700">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
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
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-ink-700 p-6 text-center text-sm text-parch-400">{children}</p>;
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center p-10">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-600 border-t-gold-500" />
    </div>
  );
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
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        className={`card max-h-[85vh] w-full overflow-auto p-5 ${wide ? 'max-w-4xl' : 'max-w-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="title text-lg">{title}</h3>
          <button onClick={onClose} className="text-parch-400 hover:text-parch-100">
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
  return <div className={`rounded-lg border px-3 py-2 text-sm ${tonos[tone]}`}>{children}</div>;
}
