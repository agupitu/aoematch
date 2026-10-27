import { useEffect, useState } from 'react';
import type { VodLink } from '../types';

const URL_HTTP = /^https?:\/\/\S+$/i;

export function linksLimpios(links: { label: string; url: string }[]): VodLink[] {
  return links
    .map((l) => ({ label: l.label.trim().slice(0, 60), url: l.url.trim() }))
    .filter((l) => l.label && l.url.length <= 500 && URL_HTTP.test(l.url))
    .slice(0, 20);
}

export function ListaVod({ links }: { links: VodLink[] }) {
  if (!links.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {links.map((l) => (
        <li key={`${l.label}-${l.url}`}>
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gold-400 underline"
          >
            {l.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function IconosVod({ links }: { links: VodLink[] }) {
  if (!links.length) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {links.map((l) => (
        <a
          key={`${l.label}-${l.url}`}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          title={l.label}
          className="text-gold-400 hover:text-gold-300"
          onClick={(e) => e.stopPropagation()}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
            <path
              fill="currentColor"
              d="M3 2.5h6.2L13 6.3V13.5H3V2.5zm6 1H4v9h8V7H9V3.5zM6 6.2l5 2.8-5 2.8V6.2z"
            />
          </svg>
          <span className="sr-only">{l.label}</span>
        </a>
      ))}
    </span>
  );
}

export function EditorVod({
  links,
  onGuardar,
}: {
  links: VodLink[];
  onGuardar: (links: VodLink[]) => Promise<void>;
}) {
  const [lista, setLista] = useState(links);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => setLista(links), [links]);

  const guardar = async () => {
    setError('');
    const sucio = lista.some((l) => l.label.trim() || l.url.trim());
    const limpios = linksLimpios(lista);
    if (sucio && limpios.length !== lista.filter((l) => l.label.trim() || l.url.trim()).length) {
      setError('Cada link necesita un nombre corto y una url http:// o https://.');
      return;
    }
    setGuardando(true);
    try {
      await onGuardar(limpios);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-2">
      {lista.map((l, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input
            className="field w-36"
            value={l.label}
            placeholder="YouTube, Twitch…"
            maxLength={60}
            onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
          />
          <input
            className="field min-w-0 flex-1"
            value={l.url}
            placeholder="https://…"
            onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
          />
          <button type="button" className="btn btn-ghost px-2" title="Quitar" onClick={() => setLista(lista.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        {lista.length < 20 && (
          <button type="button" className="btn btn-ghost" onClick={() => setLista([...lista, { label: '', url: '' }])}>
            Agregar link
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={guardando} onClick={() => void guardar()}>
          {guardando ? 'Guardando…' : 'Guardar links'}
        </button>
        {error && <span className="text-xs text-blood-500">{error}</span>}
      </div>
    </div>
  );
}
