// Clasificación de los mapas por región y terreno (web/src/logica/mapas-info.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { maps } from '../src/logica/catalogo.js';
import {
  REGIONES, SLUGS_AGUA, SLUGS_AMBOS, SLUGS_CON_REGION, TERRENOS, filtrarMapas,
} from '../src/logica/mapas-info.js';

const todos = maps();
const slugs = new Set(todos.map((m) => m.slug));
const por = (slug) => todos.find((m) => m.slug === slug);

describe('clasificación de mapas', () => {
  it('todos los mapas del catálogo traen región y terreno válidos', () => {
    for (const m of todos) {
      assert.ok(REGIONES.includes(m.region), `${m.slug}: región ${m.region}`);
      assert.ok(TERRENOS.includes(m.terreno), `${m.slug}: terreno ${m.terreno}`);
    }
  });

  it('cada mapa está en una sola región y las listas no tienen mapas que no existen', () => {
    assert.equal(new Set(SLUGS_CON_REGION).size, SLUGS_CON_REGION.length, 'hay mapas repetidos');
    assert.deepEqual(SLUGS_CON_REGION.filter((s) => !slugs.has(s)), []);
    assert.deepEqual([...slugs].filter((s) => !SLUGS_CON_REGION.includes(s)), []);
    assert.deepEqual([...SLUGS_AGUA, ...SLUGS_AMBOS].filter((s) => !slugs.has(s)), []);
    assert.deepEqual(SLUGS_AGUA.filter((s) => SLUGS_AMBOS.includes(s)), []);
  });

  it('cada región y cada terreno tienen mapas', () => {
    for (const r of REGIONES) assert.ok(todos.some((m) => m.region === r), r);
    for (const t of TERRENOS) assert.ok(todos.some((m) => m.terreno === t), t);
  });

  it('algunos mapas conocidos', () => {
    assert.deepEqual([por('archipielago').terreno, por('mar-del-norte').terreno, por('caribe').terreno], ['agua', 'agua', 'agua']);
    assert.deepEqual([por('pampa').terreno, por('arabia').terreno, por('grandes-llanuras').terreno], ['tierra', 'tierra', 'tierra']);
    assert.deepEqual([por('grandes-lagos').terreno, por('california').terreno], ['ambos', 'ambos']);
    assert.deepEqual([por('amazonas').region, por('yucatan').region, por('texas').region], ['america', 'america', 'america']);
    assert.deepEqual([por('alpes').region, por('italia').region], ['europa', 'europa']);
    assert.deepEqual([por('arabia').region, por('mongolia').region], ['asia', 'asia']);
    assert.deepEqual([por('atlas').region, por('sabana').region], ['africa', 'africa']);
  });
});

describe('filtrar mapas', () => {
  const ids = (lista) => lista.map((m) => m.slug);

  it('sin filtros, todos', () => {
    assert.equal(filtrarMapas(todos, {}).length, todos.length);
  });

  it('por terreno y por región, juntos', () => {
    const agua = filtrarMapas(todos, { terreno: 'agua' });
    assert.ok(agua.length > 0 && agua.every((m) => m.terreno === 'agua'));
    const europaDeAgua = filtrarMapas(todos, { terreno: 'agua', region: 'europa' });
    assert.ok(europaDeAgua.every((m) => m.terreno === 'agua' && m.region === 'europa'));
    assert.ok(ids(europaDeAgua).includes('mar-del-norte'));
    assert.ok(!ids(europaDeAgua).includes('caribe'));
  });

  it('solo los elegidos', () => {
    const elegidos = [por('pampa').id, por('caribe').id];
    assert.deepEqual(ids(filtrarMapas(todos, { elegidos })).sort(), ['caribe', 'pampa']);
    assert.deepEqual(ids(filtrarMapas(todos, { elegidos, terreno: 'agua' })), ['caribe']);
    assert.deepEqual(filtrarMapas(todos, { elegidos: [] }), []);
  });

  it('la búsqueda ignora tildes y mayúsculas y se suma a los filtros', () => {
    assert.ok(ids(filtrarMapas(todos, { q: 'DECAN' })).includes('decan'));
    assert.deepEqual(ids(filtrarMapas(todos, { q: 'decan', terreno: 'agua' })), []);
  });
});
