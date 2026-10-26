// Orden estable por varias claves, como un ORDER BY: los null van al final.
// Cada clave es el nombre de un campo o una función que da el valor.

export function ordenarPor(lista, ...claves) {
  const valor = (x, k) => (typeof k === 'function' ? k(x) : x[k]);
  return [...lista].sort((a, b) => {
    for (const k of claves) {
      const va = valor(a, k);
      const vb = valor(b, k);
      if (va === vb) continue;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va < vb ? -1 : 1;
    }
    return 0;
  });
}
