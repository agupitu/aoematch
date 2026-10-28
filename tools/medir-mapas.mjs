// Mide cuánta agua tiene cada minimapa de web/public/assets/maps (los baja
// `npm run assets`) y lo imprime ordenado de más a menos. Es la base del campo
// `terreno` de web/src/logica/mapas-info.js: ahí quedan los umbrales ya
// aplicados, a mano, para que el catálogo no dependa de las imágenes.
//
//   node tools/medir-mapas.mjs
//
// Sin dependencias: decodifica los PNG (paleta, RGB o RGBA de 8 bits, sin
// entrelazado) con zlib. Cuenta los píxeles azules y turquesa sobre los del
// mapa (se ignoran el fondo transparente y las esquinas negras).

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web/public/assets/maps');

/** Lo que devuelve el decodificador: { ancho, alto, pixel(x, y) -> [r, g, b, a] }. */
function decodificar(buf) {
  let pos = 8;
  let ihdr = null;
  let paleta = null;
  let transparencia = null;
  const datos = [];
  while (pos < buf.length) {
    const largo = buf.readUInt32BE(pos);
    const tipo = buf.toString('ascii', pos + 4, pos + 8);
    const cuerpo = buf.subarray(pos + 8, pos + 8 + largo);
    if (tipo === 'IHDR') {
      ihdr = { ancho: cuerpo.readUInt32BE(0), alto: cuerpo.readUInt32BE(4), prof: cuerpo[8], tipo: cuerpo[9], entrelazado: cuerpo[12] };
    } else if (tipo === 'PLTE') paleta = cuerpo;
    else if (tipo === 'tRNS') transparencia = cuerpo;
    else if (tipo === 'IDAT') datos.push(cuerpo);
    else if (tipo === 'IEND') break;
    pos += 12 + largo;
  }
  if (!ihdr || ihdr.prof !== 8 || ihdr.entrelazado) throw new Error('PNG no soportado');
  const canales = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.tipo];
  const fila = ihdr.ancho * canales;
  const crudo = inflateSync(Buffer.concat(datos));
  const salida = Buffer.alloc(fila * ihdr.alto);
  for (let y = 0; y < ihdr.alto; y++) {
    const filtro = crudo[y * (fila + 1)];
    const desde = y * (fila + 1) + 1;
    for (let x = 0; x < fila; x++) {
      const actual = crudo[desde + x];
      const izq = x >= canales ? salida[y * fila + x - canales] : 0;
      const arriba = y > 0 ? salida[(y - 1) * fila + x] : 0;
      const arribaIzq = y > 0 && x >= canales ? salida[(y - 1) * fila + x - canales] : 0;
      let v;
      if (filtro === 0) v = actual;
      else if (filtro === 1) v = actual + izq;
      else if (filtro === 2) v = actual + arriba;
      else if (filtro === 3) v = actual + ((izq + arriba) >> 1);
      else {
        const p = izq + arriba - arribaIzq;
        const pa = Math.abs(p - izq);
        const pb = Math.abs(p - arriba);
        const pc = Math.abs(p - arribaIzq);
        v = actual + (pa <= pb && pa <= pc ? izq : pb <= pc ? arriba : arribaIzq);
      }
      salida[y * fila + x] = v & 255;
    }
  }
  const pixel = (x, y) => {
    const i = y * fila + x * canales;
    if (ihdr.tipo === 3) {
      const k = salida[i];
      return [paleta[k * 3], paleta[k * 3 + 1], paleta[k * 3 + 2], transparencia && k < transparencia.length ? transparencia[k] : 255];
    }
    if (ihdr.tipo === 2) return [salida[i], salida[i + 1], salida[i + 2], 255];
    if (ihdr.tipo === 6) return [salida[i], salida[i + 1], salida[i + 2], salida[i + 3]];
    if (ihdr.tipo === 4) return [salida[i], salida[i], salida[i], salida[i + 1]];
    return [salida[i], salida[i], salida[i], 255];
  };
  return { ancho: ihdr.ancho, alto: ihdr.alto, pixel };
}

/** Matiz (0-360), saturación y valor (0-1) de un color. */
function hsv(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r / 255) h = ((g - b) / 255 / d) % 6;
    else if (max === g / 255) h = (b - r) / 255 / d + 2;
    else h = (r - g) / 255 / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

const esAgua = ([r, g, b]) => {
  const [h, s, v] = hsv(r, g, b);
  return h >= 170 && h <= 255 && s >= 0.3 && v >= 0.25;
};

const filas = [];
for (const archivo of (await readdir(DIR)).filter((f) => f.endsWith('.png')).sort()) {
  const png = decodificar(await readFile(join(DIR, archivo)));
  let mapa = 0;
  let agua = 0;
  for (let y = 0; y < png.alto; y += 2) {
    for (let x = 0; x < png.ancho; x += 2) {
      const p = png.pixel(x, y);
      if (p[3] < 128 || hsv(p[0], p[1], p[2])[2] < 0.12) continue;
      mapa++;
      if (esAgua(p)) agua++;
    }
  }
  filas.push([archivo.replace(/\.png$/, ''), mapa ? agua / mapa : 0]);
}

filas.sort((a, b) => b[1] - a[1]);
for (const [slug, agua] of filas) console.log(`${(agua * 100).toFixed(1).padStart(5)}%  ${slug}`);
