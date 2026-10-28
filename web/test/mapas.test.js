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
  it('todos los mapas del catálogo traen regiones y terreno válidos', () => {
    for (const m of todos) {
      assert.ok(Array.isArray(m.regiones) && m.regiones.length > 0, `${m.slug}: sin región`);
      assert.ok(m.regiones.every((r) => REGIONES.includes(r)), `${m.slug}: regiones ${m.regiones}`);
      assert.equal(new Set(m.regiones).size, m.regiones.length, `${m.slug}: región repetida`);
      assert.ok(TERRENOS.includes(m.terreno), `${m.slug}: terreno ${m.terreno}`);
    }
  });

  it('las listas cubren todos los mapas y no tienen mapas que no existen', () => {
    assert.equal(new Set(SLUGS_CON_REGION).size, SLUGS_CON_REGION.length, 'hay mapas repetidos');
    assert.deepEqual(SLUGS_CON_REGION.filter((s) => !slugs.has(s)), []);
    assert.deepEqual([...slugs].filter((s) => !SLUGS_CON_REGION.includes(s)), []);
    assert.deepEqual([...SLUGS_AGUA, ...SLUGS_AMBOS].filter((s) => !slugs.has(s)), []);
    assert.deepEqual(SLUGS_AGUA.filter((s) => SLUGS_AMBOS.includes(s)), []);
  });

  it('un mapa puede estar en más de una región: solo el Estrecho de Bering, en América y Asia', () => {
    assert.deepEqual(todos.filter((m) => m.regiones.length > 1).map((m) => m.slug), ['estrecho-de-bering']);
    assert.deepEqual(por('estrecho-de-bering').regiones, ['america', 'asia']);
  });

  it('cada región y cada terreno tienen mapas', () => {
    for (const r of REGIONES) assert.ok(todos.some((m) => m.regiones.includes(r)), r);
    for (const t of TERRENOS) assert.ok(todos.some((m) => m.terreno === t), t);
  });

  it('algunos mapas conocidos', () => {
    assert.deepEqual([por('archipielago').terreno, por('mar-del-norte').terreno, por('caribe').terreno], ['agua', 'agua', 'agua']);
    assert.deepEqual([por('pampa').terreno, por('arabia').terreno, por('grandes-llanuras').terreno], ['tierra', 'tierra', 'tierra']);
    assert.deepEqual([por('grandes-lagos').terreno, por('california').terreno], ['ambos', 'ambos']);
    assert.deepEqual([por('amazonas').regiones, por('yucatan').regiones, por('texas').regiones], [['america'], ['america'], ['america']]);
    assert.deepEqual([por('alpes').regiones, por('italia').regiones], [['europa'], ['europa']]);
    assert.deepEqual([por('arabia').regiones, por('mongolia').regiones, por('llanura-central').regiones], [['asia'], ['asia'], ['asia']]);
    assert.deepEqual([por('atlas').regiones, por('sabana').regiones], [['africa'], ['africa']]);
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
    assert.ok(europaDeAgua.every((m) => m.terreno === 'agua' && m.regiones.includes('europa')));
    assert.ok(ids(europaDeAgua).includes('mar-del-norte'));
    assert.ok(!ids(europaDeAgua).includes('caribe'));
  });

  it('un mapa de dos regiones aparece en las dos', () => {
    assert.ok(ids(filtrarMapas(todos, { region: 'asia' })).includes('estrecho-de-bering'));
    assert.ok(ids(filtrarMapas(todos, { region: 'america' })).includes('estrecho-de-bering'));
    assert.ok(!ids(filtrarMapas(todos, { region: 'europa' })).includes('estrecho-de-bering'));
  });

  it('la búsqueda ignora tildes y mayúsculas y se suma a los filtros', () => {
    assert.ok(ids(filtrarMapas(todos, { q: 'DECAN' })).includes('decan'));
    assert.deepEqual(ids(filtrarMapas(todos, { q: 'decan', terreno: 'agua' })), []);
  });
});
