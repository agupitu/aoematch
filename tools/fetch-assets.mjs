// Descarga los assets de civilizaciones y mapas de AoE3 DE desde freefoodparty.com
// y genera server/data/civs.json y server/data/maps.json.
//
//   node tools/fetch-assets.mjs
//
// Los PNG quedan en server/public/assets/{flags,maps} y se sirven desde el backend.

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://freefoodparty.com';
const FLAG_DIR = join(ROOT, 'server/public/assets/flags');
const MAP_DIR = join(ROOT, 'server/public/assets/maps');
const DATA_DIR = join(ROOT, 'server/data');

/** [slug, nombre ES, nombre EN, archivo de bandera, grupo] */
const CIVS = [
  ['aztecs', 'Aztecas', 'Aztecs', 'Flag_Aztec.png', 'nativa'],
  ['british', 'Británicos', 'British', 'Flag_British.png', 'europea'],
  ['chinese', 'Chinos', 'Chinese', 'Flag_Chinese.png', 'asiatica'],
  ['danes', 'Daneses', 'Danes', 'Flag_Danes.png', 'europea'],
  ['dutch', 'Holandeses', 'Dutch', 'Flag_Dutch.png', 'europea'],
  ['ethiopians', 'Etíopes', 'Ethiopians', 'Flag_Ethiopian.png', 'africana'],
  ['french', 'Franceses', 'French', 'Flag_French.png', 'europea'],
  ['germans', 'Alemanes', 'Germans', 'Flag_German.png', 'europea'],
  ['haudenosaunee', 'Haudenosaunee', 'Haudenosaunee', 'Flag_Iroquois.png', 'nativa'],
  ['hausa', 'Hausas', 'Hausa', 'Flag_Hausa.png', 'africana'],
  ['inca', 'Incas', 'Inca', 'Flag_Incan.png', 'nativa'],
  ['indians', 'Indios', 'Indians', 'Flag_Indian.png', 'asiatica'],
  ['italians', 'Italianos', 'Italians', 'Flag_Italian.png', 'europea'],
  ['japanese', 'Japoneses', 'Japanese', 'Flag_Japanese.png', 'asiatica'],
  ['lakota', 'Lakotas', 'Lakota', 'Flag_Sioux.png', 'nativa'],
  ['maltese', 'Malteses', 'Maltese', 'Flag_Maltese.png', 'europea'],
  ['mexicans', 'Mexicanos', 'Mexicans', 'Flag_Mexican.png', 'americana'],
  ['ottomans', 'Otomanos', 'Ottomans', 'Flag_Ottoman.png', 'europea'],
  ['poles', 'Polacos', 'Poles', 'Flag_Poles.png', 'europea'],
  ['portuguese', 'Portugueses', 'Portuguese', 'Flag_Portuguese.png', 'europea'],
  ['russians', 'Rusos', 'Russians', 'Flag_Russian.png', 'europea'],
  ['spanish', 'Españoles', 'Spanish', 'Flag_Spanish.png', 'europea'],
  ['swedes', 'Suecos', 'Swedes', 'Flag_Swedish.png', 'europea'],
  ['usa', 'Estados Unidos', 'United States', 'Flag_American.png', 'americana'],
];

const EXTRA_FLAGS = ['Flag_Random.webp'];

function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function download(url, dest) {
  if (await exists(dest)) return 'cache';
  const res = await fetch(url, { headers: { 'User-Agent': 'AOEMatch/1.0 (asset fetch)' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return 'ok';
}

async function pool(items, size, fn) {
  const results = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          results.push(await fn(items[idx], idx));
        } catch (err) {
          console.warn('  ! ' + err.message);
          results.push(null);
        }
      }
    })
  );
  return results;
}

async function main() {
  await mkdir(FLAG_DIR, { recursive: true });
  await mkdir(MAP_DIR, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });

  console.log(`Banderas (${CIVS.length + EXTRA_FLAGS.length})...`);
  const flagFiles = [...CIVS.map((c) => c[3]), ...EXTRA_FLAGS];
  await pool(flagFiles, 8, (file) =>
    download(`${ORIGIN}/assets/Data/wpfg/resources/images/icons/flags/${file}`, join(FLAG_DIR, file))
  );

  const civs = CIVS.map(([slug, nameEs, nameEn, flag, group], i) => ({
    id: i + 1,
    slug,
    name_es: nameEs,
    name_en: nameEn,
    group: group,
    flag: `/assets/flags/${flag}`,
  }));
  await writeFile(join(DATA_DIR, 'civs.json'), JSON.stringify(civs, null, 2) + '\n');

  const rawMaps = JSON.parse(await readFile(join(ROOT, 'tools/source-maps.json'), 'utf8'));
  console.log(`Mapas (${rawMaps.length})...`);

  const seen = new Set();
  const maps = [];
  for (const [name, path] of rawMaps) {
    let slug = slugify(name);
    while (seen.has(slug)) slug += '-2';
    seen.add(slug);
    const file = `${slug}.png`;
    maps.push({
      id: maps.length + 1,
      slug,
      name_es: name,
      img: `/assets/maps/${file}`,
      _src: `${ORIGIN}/assets/Data/wpfg/resources/images/icons/random_map/${path}`,
      _file: file,
    });
  }

  const results = await pool(maps, 8, (m) => download(m._src, join(MAP_DIR, m._file)));
  const okCount = results.filter(Boolean).length;

  await writeFile(
    join(DATA_DIR, 'maps.json'),
    JSON.stringify(maps.map(({ _src, _file, ...m }) => m), null, 2) + '\n'
  );

  console.log(`Listo: ${civs.length} civs, ${maps.length} mapas (${okCount} imágenes).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
