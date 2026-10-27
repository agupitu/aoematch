// Días, barras de 30 minutos y selección del calendario de una ronda
// (web/src/logica/calendario.js). Incluye los cambios de horario de verano.
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ajustarAGrilla, bloquesDeSeleccion, cantidadDeDias, diasDelCalendario, instanteLocal, rangoDeDias, rectangulo,
  seleccionDeBloques,
} from '../src/logica/calendario.js';

const BA = 'America/Argentina/Buenos_Aires';
const NY = 'America/New_York';
const MADRID = 'Europe/Madrid';

/** Los días que ve un jugador de `zonaDelJugador` para un rango que fijó alguien en `zonaDelRango`. */
function diasDe(desde, hasta, zonaDelRango = BA, zonaDelJugador = zonaDelRango) {
  const { starts_at, ends_at } = rangoDeDias(desde, hasta, zonaDelRango);
  return diasDelCalendario(starts_at, ends_at, zonaDelJugador);
}

const vacia = (dias) => dias.map((d) => d.barras.map(() => false));

describe('rango de fechas', () => {
  it('cada día va de 00:00 a 24:00 en la zona de quien lo fija, con el final excluyente', () => {
    assert.deepEqual(rangoDeDias('2026-11-14', '2026-11-16', BA), {
      starts_at: '2026-11-14T03:00:00.000Z',
      ends_at: '2026-11-17T03:00:00.000Z',
    });
  });

  it('cuenta los días, los dos extremos incluidos', () => {
    assert.equal(cantidadDeDias('2026-11-14', '2026-11-14'), 1);
    assert.equal(cantidadDeDias('2026-11-14', '2026-11-27'), 14);
    assert.equal(cantidadDeDias('2026-10-30', '2026-11-02'), 4);
  });

  it('si la medianoche no existe (Santiago), el día empieza en la primera hora que existe', () => {
    assert.equal(rangoDeDias('2026-09-06', '2026-09-06', 'America/Santiago').starts_at, '2026-09-06T04:00:00.000Z');
  });
});

describe('instante de una hora local', () => {
  it('sin horario de verano es el desfase fijo de la zona', () => {
    assert.equal(instanteLocal('2026-11-14', 18 * 60, BA), Date.UTC(2026, 10, 14, 21, 0));
  });

  it('la hora que se repite da el primer instante; la que no existe, null', () => {
    assert.equal(instanteLocal('2026-11-01', 90, NY), Date.UTC(2026, 10, 1, 5, 30));
    assert.equal(instanteLocal('2026-03-08', 150, NY), null);
    assert.equal(instanteLocal('2026-10-25', 150, MADRID), Date.UTC(2026, 9, 25, 0, 30));
    assert.equal(instanteLocal('2026-03-29', 150, MADRID), null);
  });

  it('una zona que no existe se trata como UTC en vez de romper la pantalla', () => {
    assert.equal(instanteLocal('2026-11-14', 18 * 60, 'No/Existe'), Date.UTC(2026, 10, 14, 18, 0));
    assert.equal(rangoDeDias('2026-11-14', '2026-11-14', 'No/Existe').starts_at, '2026-11-14T00:00:00.000Z');
  });

  it('en una zona con desfase de 45 minutos cae igual en la grilla de 30 minutos de UTC', () => {
    assert.equal(instanteLocal('2026-11-14', 18 * 60, 'Asia/Kathmandu'), Date.UTC(2026, 10, 14, 12, 0));
    assert.equal(ajustarAGrilla(Date.UTC(2026, 10, 14, 12, 29)), Date.UTC(2026, 10, 14, 12, 0));
  });
});

describe('días del calendario', () => {
  it('un día por fecha del rango, con 48 barras que empiezan en 00:00', () => {
    const dias = diasDe('2026-11-14', '2026-11-16');
    assert.deepEqual(dias.map((d) => d.dia), ['2026-11-14', '2026-11-15', '2026-11-16']);
    assert.ok(dias.every((d) => d.barras.length === 48 && d.barras.every((b) => b.dentro)));
    assert.equal(dias[0].barras[0].hora, '00:00');
    assert.equal(dias[0].barras[36].hora, '18:00');
    assert.equal(dias[0].barras[36].ms, Date.UTC(2026, 10, 14, 21, 0));
    assert.equal(dias[2].barras[47].hora, '23:30');
  });

  it('si la zona del jugador corta el primer y el último día, las barras de afuera quedan apagadas', () => {
    // 04:00 en Madrid es la medianoche de Buenos Aires.
    const dias = diasDe('2026-11-14', '2026-11-16', BA, MADRID);
    assert.deepEqual(dias.map((d) => d.dia), ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17']);
    assert.deepEqual(dias[0].barras.map((b) => b.dentro).indexOf(true), 8);
    assert.deepEqual(dias[3].barras.map((b) => b.dentro).lastIndexOf(true), 7);
  });

  it('el día que se atrasa la hora no repite ni corre barras', () => {
    const dia = diasDe('2026-10-31', '2026-11-02', NY)[1];
    assert.equal(dia.dia, '2026-11-01');
    const ms = dia.barras.map((b) => b.ms);
    assert.ok(ms.every((x) => x !== null));
    assert.ok(ms.every((x, i) => i === 0 || x > ms[i - 1]));
    assert.equal(ms[2], Date.UTC(2026, 10, 1, 5, 0));
    assert.equal(ms[4], Date.UTC(2026, 10, 1, 7, 0));
  });

  it('el día que se adelanta la hora, la hora que no existe queda apagada', () => {
    const dia = diasDe('2026-03-07', '2026-03-09', NY)[1];
    assert.equal(dia.dia, '2026-03-08');
    assert.deepEqual(dia.barras.map((b, i) => (b.ms === null ? i : -1)).filter((i) => i >= 0), [4, 5]);
    assert.ok(dia.barras.slice(4, 6).every((b) => !b.dentro));
  });

  it('en una zona con desfase de 45 minutos todas las barras caen en la grilla de UTC', () => {
    const dias = diasDe('2026-11-14', '2026-11-15', 'Asia/Kathmandu');
    const todas = dias.flatMap((d) => d.barras).filter((b) => b.ms !== null);
    assert.equal(todas.length, 96);
    assert.ok(todas.every((b) => b.ms % (30 * 60000) === 0));
  });
});

describe('selección y bloques', () => {
  it('las barras seguidas forman un bloque, también de un día al siguiente', () => {
    const dias = diasDe('2026-11-14', '2026-11-15');
    const sel = vacia(dias);
    sel[0][47] = true;
    sel[1][0] = true;
    sel[1][4] = true;
    assert.deepEqual(bloquesDeSeleccion(dias, sel), [
      { starts_at: '2026-11-15T02:30:00.000Z', ends_at: '2026-11-15T03:30:00.000Z' },
      { starts_at: '2026-11-15T05:00:00.000Z', ends_at: '2026-11-15T05:30:00.000Z' },
    ]);
  });

  it('los bloques guardados vuelven a ser la misma selección', () => {
    const dias = diasDe('2026-11-14', '2026-11-16');
    const sel = vacia(dias);
    for (let i = 36; i < 44; i++) sel[1][i] = true;
    assert.deepEqual(seleccionDeBloques(dias, bloquesDeSeleccion(dias, sel)), sel);
  });

  it('un bloque que se pasa del rango se recorta; uno que cae afuera no marca nada', () => {
    const dias = diasDe('2026-11-14', '2026-11-16');
    const sel = seleccionDeBloques(dias, [
      { starts_at: '2026-11-14T02:00:00.000Z', ends_at: '2026-11-14T04:00:00.000Z' },
      { starts_at: '2026-11-01T20:00:00.000Z', ends_at: '2026-11-01T23:00:00.000Z' },
    ]);
    assert.deepEqual(sel[0].slice(0, 3), [true, true, false]);
    assert.equal(sel.flat().filter(Boolean).length, 2);
  });

  it('el rectángulo marca o borra solo las barras de adentro y no toca la base', () => {
    const dias = diasDe('2026-11-14', '2026-11-16');
    const base = vacia(dias);
    const marcada = rectangulo(base, dias, { d: 0, i: 40 }, { d: 2, i: 45 }, true);
    assert.equal(marcada.flat().filter(Boolean).length, 3 * 6);
    assert.equal(base.flat().filter(Boolean).length, 0);
    assert.equal(marcada[1][43], true);
    assert.equal(marcada[1][46], false);
    const borrada = rectangulo(marcada, dias, { d: 2, i: 45 }, { d: 0, i: 40 }, false);
    assert.equal(borrada.flat().filter(Boolean).length, 0);
  });

  it('el rectángulo no pinta barras de afuera del rango', () => {
    const dias = diasDe('2026-11-14', '2026-11-16', BA, MADRID);
    const marcada = rectangulo(vacia(dias), dias, { d: 0, i: 0 }, { d: 0, i: 10 }, true);
    assert.deepEqual(marcada[0].map((v, i) => (v ? i : -1)).filter((i) => i >= 0), [8, 9, 10]);
  });
});
