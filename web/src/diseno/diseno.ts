import { useSyncExternalStore } from 'react';

/**
 * Dos diseños conviven para poder compararlos:
 *
 *   original  -> index.css y el marcado de siempre, sin tocar.
 *   nuevo     -> diseno/nuevo.css (todo bajo `html[data-diseno='nuevo']`) y los
 *                componentes de esta carpeta.
 *
 * Se elige con el conmutador del encabezado o con `?diseno=original|nuevo` en
 * la URL; queda guardado en el navegador. Las clases `dn-*` del marcado solo
 * tienen estilo en el diseño nuevo: en el original no hacen nada.
 */
export type Diseno = 'nuevo' | 'original';

const CLAVE = 'aoematch.diseno';
const VALIDOS: readonly string[] = ['nuevo', 'original'];
const esDiseno = (v: string | null): v is Diseno => !!v && VALIDOS.includes(v);

const oyentes = new Set<() => void>();
let actual: Diseno = 'nuevo';

function guardado(): Diseno | null {
  try {
    const v = localStorage.getItem(CLAVE);
    return esDiseno(v) ? v : null;
  } catch {
    return null; // navegación privada o almacenamiento bloqueado
  }
}

export function elegirDiseno(d: Diseno) {
  actual = d;
  document.documentElement.dataset.diseno = d;
  try {
    localStorage.setItem(CLAVE, d);
  } catch {
    // Sin almacenamiento, vale solo para esta visita.
  }
  oyentes.forEach((avisar) => avisar());
}

/** Antes del primer render: así la página no parpadea de un diseño al otro. */
export function iniciarDiseno() {
  const url = new URL(location.href);
  const pedido = url.searchParams.get('diseno');
  if (esDiseno(pedido)) {
    // Ya quedó guardado: se saca de la URL para que el conmutador mande después.
    url.searchParams.delete('diseno');
    history.replaceState(history.state, '', url);
  }
  elegirDiseno(esDiseno(pedido) ? pedido : (guardado() ?? 'nuevo'));
}

function suscribir(avisar: () => void) {
  oyentes.add(avisar);
  return () => {
    oyentes.delete(avisar);
  };
}

export function useDiseno(): Diseno {
  return useSyncExternalStore(suscribir, () => actual);
}

export const useDisenoNuevo = () => useDiseno() === 'nuevo';
