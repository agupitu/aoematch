// Medios de pago de un torneo, con su costo y moneda (web/src/logica/pagos.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MEDIOS_DE_PAGO, MONEDAS, centavosDe, costosDe, limpiarMediosDePago, mediosConCosto, mediosDePago, montoEscrito,
  nombreDeMedio, opcionesDePago, pagoDe, recaudadoEn, recaudadoEstimado, recaudadoPorMoneda,
} from '../src/logica/pagos.js';

describe('montos escritos a mano', () => {
  it('entiende 5000, 5.000, 5.000,50 y 5000,5 (con coma o punto decimal)', () => {
    assert.equal(centavosDe('5000'), 500000);
    assert.equal(centavosDe('5.000'), 500000);
    assert.equal(centavosDe('1.234.567'), 123456700);
    assert.equal(centavosDe('5.000,50'), 500050);
    assert.equal(centavosDe('5000,5'), 500050);
    assert.equal(centavosDe('50.5'), 5050);
    assert.equal(centavosDe('0,5'), 50);
    assert.equal(centavosDe('0'), 0);
  });

  it('ignora el $, el US$ y los espacios', () => {
    assert.equal(centavosDe('$ 5.000'), 500000);
    assert.equal(centavosDe(' US$ 5 '), 500);
  });

  it('vacío no es un monto; lo que no se entiende, tampoco', () => {
    assert.equal(centavosDe(''), undefined);
    assert.equal(centavosDe('   '), undefined);
    assert.equal(centavosDe(undefined), undefined);
    for (const malo of ['abc', '-5', '5.0000', '1,234.5', '5,5,5', '1e3', '$', '5%']) {
      assert.ok(Number.isNaN(centavosDe(malo)), malo);
    }
  });

  it('muestra los centavos como se escribirían, y eso se vuelve a leer igual', () => {
    assert.equal(montoEscrito(500000), '5000');
    assert.equal(montoEscrito(450050), '4500,50');
    assert.equal(montoEscrito(450005), '4500,05');
    assert.equal(montoEscrito(50), '0,50');
    for (const vacio of [0, undefined, null, -5]) assert.equal(montoEscrito(vacio), '', String(vacio));
    for (const c of [1, 50, 99, 100, 500, 450050, 123456789]) assert.equal(centavosDe(montoEscrito(c)), c);
  });
});

describe('nombre de un medio', () => {
  it('es el medio, si no el nombre, si no el alias', () => {
    assert.equal(nombreDeMedio({ method: ' PayPal ', name: 'Ana', alias: 'ana.pp' }), 'PayPal');
    assert.equal(nombreDeMedio({ method: ' ', name: 'Ana', alias: 'ana.pp' }), 'Ana');
    assert.equal(nombreDeMedio({ alias: 'ana.pp' }), 'ana.pp');
    assert.equal(nombreDeMedio({ amount_cents: 500 }), null);
    assert.equal(nombreDeMedio(null), null);
  });
});

describe('medios de pago guardados', () => {
  it('lee `payment_methods` con los campos que tengan, también costo y moneda', () => {
    const medios = [
      { method: 'Mercado Pago', amount_cents: 500000, currency: 'ARS', name: 'Organización', alias: 'aoe.mp', url: 'https://mp.com/x' },
      { alias: 'solo.alias' },
    ];
    assert.deepEqual(mediosDePago({ payment_methods: medios }), medios);
    assert.deepEqual(mediosDePago({ payment_methods: [] }), []);
  });

  it('un costo sin moneda queda en pesos; una moneda que no existe, también; el costo inválido se descarta', () => {
    assert.deepEqual(mediosDePago({ payment_methods: [{ method: 'A', amount_cents: 500 }] }), [{ method: 'A', amount_cents: 500, currency: 'ARS' }]);
    assert.deepEqual(mediosDePago({ payment_methods: [{ method: 'A', amount_cents: 500, currency: 'XXX' }] }), [{ method: 'A', amount_cents: 500, currency: 'ARS' }]);
    for (const malo of [-5, 0, 2.5, '500', NaN, 1e15]) {
      assert.deepEqual(mediosDePago({ payment_methods: [{ method: 'A', amount_cents: malo, currency: 'USD' }] }), [{ method: 'A' }], String(malo));
    }
  });

  it('la versión anterior (`payment_links`, con nombre y link) se lee como medio y link', () => {
    assert.deepEqual(
      mediosDePago({ payment_links: [{ label: 'PayPal', url: 'https://paypal.me/x' }] }),
      [{ method: 'PayPal', url: 'https://paypal.me/x' }]
    );
  });

  it('un torneo viejo con un solo `payment_link` muestra un medio con ese link', () => {
    assert.deepEqual(mediosDePago({ payment_link: 'https://mp.com/x' }), [{ method: 'Link de pago', url: 'https://mp.com/x' }]);
    assert.deepEqual(mediosDePago({ payment_link: null }), []);
    assert.deepEqual(mediosDePago({}), []);
  });

  it('si ya tiene `payment_methods`, mandan esos aunque queden campos viejos', () => {
    const medios = [{ method: 'Efectivo' }];
    assert.deepEqual(mediosDePago({ payment_methods: medios, payment_links: [{ label: 'x', url: 'https://x.com/a' }], payment_link: 'https://v.com/a' }), medios);
  });

  it('al leer se descartan los links que no son http(s): nunca queda un javascript: en un href', () => {
    assert.deepEqual(mediosDePago({ payment_methods: [{ method: 'X', url: 'javascript:alert(1)' }] }), [{ method: 'X' }]);
    assert.deepEqual(mediosDePago({ payment_link: 'javascript:alert(1)' }), [{ method: 'Link de pago' }]);
    assert.deepEqual(mediosDePago({ payment_methods: [{ url: 'data:text/html,hola' }] }), []);
  });

  it('ignora lo que no es una lista de medios y recorta lo largo y lo que sobra', () => {
    assert.deepEqual(mediosDePago({ payment_methods: 'https://x.com' }), []);
    assert.deepEqual(mediosDePago({ payment_methods: [null, 3, 'x', {}] }), []);
    const [largo] = mediosDePago({ payment_methods: [{ method: 'm'.repeat(90), name: 'n'.repeat(150), alias: 'a'.repeat(150) }] });
    assert.deepEqual([largo.method.length, largo.name.length, largo.alias.length], [60, 100, 100]);
    const muchos = Array.from({ length: MAX_MEDIOS_DE_PAGO + 3 }, (_, i) => ({ method: `M${i}` }));
    assert.equal(mediosDePago({ payment_methods: muchos }).length, MAX_MEDIOS_DE_PAGO);
  });
});

describe('medios de pago del formulario', () => {
  it('todos los campos son opcionales: saca los vacíos y los espacios', () => {
    assert.deepEqual(
      limpiarMediosDePago([
        { method: ' Mercado Pago ', name: ' ', alias: ' aoe.mp ', url: '' },
        { method: '', name: '', alias: '', url: '' },
        { alias: 'solo.alias' },
      ]),
      [{ method: 'Mercado Pago', alias: 'aoe.mp' }, { alias: 'solo.alias' }]
    );
    assert.deepEqual(limpiarMediosDePago([]), []);
  });

  it('cada medio trae su costo y su moneda; varios medios, montos y monedas distintos', () => {
    assert.deepEqual(
      limpiarMediosDePago([
        { method: 'Mercado Pago', amount: '5.000', currency: 'ARS', alias: 'aoe.mp' },
        { method: 'PayPal', amount: '5', currency: 'USD', url: 'https://paypal.me/x' },
        { method: 'Transferencia', amount: '4500,50', currency: 'ARS' },
      ]),
      [
        { method: 'Mercado Pago', amount_cents: 500000, currency: 'ARS', alias: 'aoe.mp' },
        { method: 'PayPal', amount_cents: 500, currency: 'USD', url: 'https://paypal.me/x' },
        { method: 'Transferencia', amount_cents: 450050, currency: 'ARS' },
      ]
    );
  });

  it('la moneda sola no es un medio: la fila vacía con la moneda por defecto no se guarda; sin costo, tampoco la moneda', () => {
    assert.deepEqual(limpiarMediosDePago([{ method: '', amount: '', currency: 'ARS', name: '', alias: '', url: '' }]), []);
    assert.deepEqual(limpiarMediosDePago([{ method: 'Efectivo', amount: '', currency: 'USD' }]), [{ method: 'Efectivo' }]);
    assert.deepEqual(limpiarMediosDePago([{ method: 'Efectivo', amount: '0', currency: 'USD' }]), [{ method: 'Efectivo' }]);
    assert.deepEqual(limpiarMediosDePago([{ amount: '100', currency: 'XXX' }]), [{ amount_cents: 10000, currency: 'ARS' }]);
  });

  it('un costo que no se entiende frena el guardado y dice de qué medio es', () => {
    assert.throws(() => limpiarMediosDePago([{ method: 'PayPal', amount: 'cinco' }]), /costo de «PayPal»/);
    assert.throws(() => limpiarMediosDePago([{ alias: 'mi.alias', amount: '-3' }]), /costo de «mi.alias»/);
    assert.throws(() => limpiarMediosDePago([{ amount: '99999999999999' }]), /costo de «medio 1»/);
  });

  it('acorta lo muy largo', () => {
    const [m] = limpiarMediosDePago([{ method: 'm'.repeat(90), name: 'n'.repeat(150), alias: 'a'.repeat(150) }]);
    assert.deepEqual([m.method.length, m.name.length, m.alias.length], [60, 100, 100]);
  });

  it('el link, si hay, tiene que ser http(s)', () => {
    assert.deepEqual(limpiarMediosDePago([{ url: ' https://mp.com/x ' }]), [{ url: 'https://mp.com/x' }]);
    assert.throws(() => limpiarMediosDePago([{ method: 'Banco', url: 'alias.banco' }]), /Banco.*http/);
    assert.throws(() => limpiarMediosDePago([{ url: 'ftp://x.com/a' }]), /medio 1.*http/);
    assert.throws(() => limpiarMediosDePago([{ url: 'https://x.com/a b' }]), /http/);
    assert.throws(() => limpiarMediosDePago([{ url: `https://x.com/${'a'.repeat(500)}` }]), /http/);
  });

  it('hasta el máximo de medios', () => {
    const muchos = Array.from({ length: MAX_MEDIOS_DE_PAGO + 1 }, (_, i) => ({ method: `M${i}` }));
    assert.throws(() => limpiarMediosDePago(muchos), /Hasta/);
    assert.equal(limpiarMediosDePago(muchos.slice(0, MAX_MEDIOS_DE_PAGO)).length, MAX_MEDIOS_DE_PAGO);
  });

  it('las monedas que ofrece el formulario son las de siempre', () => {
    assert.deepEqual(MONEDAS, ['ARS', 'USD', 'EUR', 'BRL', 'CLP', 'MXN']);
  });
});

describe('medios con su costo', () => {
  it('si algún medio trae costo, quedan como están y el costo único de antes ya no cuenta', () => {
    const medios = [{ method: 'PayPal', amount_cents: 500, currency: 'USD' }, { method: 'Efectivo' }];
    assert.deepEqual(mediosConCosto({ payment_methods: medios, entry_fee_cents: 500000, currency: 'ARS' }), medios);
  });

  it('un torneo de antes con medios sin costo: todos heredan el costo único', () => {
    assert.deepEqual(
      mediosConCosto({ payment_methods: [{ method: 'MP', alias: 'aoe.mp' }, { method: 'Efectivo' }], entry_fee_cents: 500000, currency: 'USD' }),
      [
        { method: 'MP', alias: 'aoe.mp', amount_cents: 500000, currency: 'USD' },
        { method: 'Efectivo', amount_cents: 500000, currency: 'USD' },
      ]
    );
  });

  it('un torneo de antes sin medios queda con un medio que solo tiene el costo', () => {
    assert.deepEqual(mediosConCosto({ entry_fee_cents: 300000, currency: 'ARS' }), [{ amount_cents: 300000, currency: 'ARS' }]);
    assert.deepEqual(mediosConCosto({ payment_methods: [], entry_fee_cents: 300 }), [{ amount_cents: 300, currency: 'ARS' }]);
  });

  it('sin costo en ningún lado, o con uno inválido, los medios quedan como están', () => {
    assert.deepEqual(mediosConCosto({ payment_methods: [{ method: 'Efectivo' }], entry_fee_cents: 0 }), [{ method: 'Efectivo' }]);
    assert.deepEqual(mediosConCosto({ payment_methods: [{ method: 'Efectivo' }], entry_fee_cents: -5 }), [{ method: 'Efectivo' }]);
    assert.deepEqual(mediosConCosto({ entry_fee_cents: 12.5 }), []);
    assert.deepEqual(mediosConCosto({}), []);
  });

  it('pasado por segunda vez da lo mismo', () => {
    const torneo = { payment_methods: [{ method: 'MP' }], entry_fee_cents: 500000, currency: 'ARS' };
    const una = mediosConCosto(torneo);
    assert.deepEqual(mediosConCosto({ ...torneo, payment_methods: una }), una);
  });
});

describe('costos de inscripción', () => {
  const medios = [
    { method: 'Mercado Pago', amount_cents: 500000, currency: 'ARS' },
    { method: 'PayPal', amount_cents: 500, currency: 'USD' },
    { method: 'Transferencia', amount_cents: 500000, currency: 'ARS' },
    { method: 'Efectivo' },
  ];

  it('son los de los medios, sin repetir, en el orden en que están', () => {
    assert.deepEqual(costosDe({ payment_methods: medios }), [
      { amount_cents: 500000, currency: 'ARS' },
      { amount_cents: 500, currency: 'USD' },
    ]);
  });

  it('un torneo sin costo en ningún medio ni costo único es gratis', () => {
    assert.deepEqual(costosDe({ payment_methods: [{ method: 'Efectivo' }] }), []);
    assert.deepEqual(costosDe({ payment_methods: [], entry_fee_cents: 0, currency: 'ARS' }), []);
    assert.deepEqual(costosDe({}), []);
  });

  it('un torneo de antes tiene el costo único que ya tenía, con o sin medios', () => {
    assert.deepEqual(costosDe({ entry_fee_cents: 500000, currency: 'USD' }), [{ amount_cents: 500000, currency: 'USD' }]);
    assert.deepEqual(costosDe({ payment_methods: [{ method: 'Efectivo' }], entry_fee_cents: 500000, currency: 'ARS' }), [{ amount_cents: 500000, currency: 'ARS' }]);
    assert.deepEqual(costosDe({ entry_fee_cents: 300 }), [{ amount_cents: 300, currency: 'ARS' }]);
  });

  it('si algún medio trae costo, el costo único de antes no se suma', () => {
    assert.deepEqual(
      costosDe({ payment_methods: [{ method: 'PayPal', amount_cents: 500, currency: 'USD' }], entry_fee_cents: 500000, currency: 'ARS' }),
      [{ amount_cents: 500, currency: 'USD' }]
    );
  });

  it('las opciones para marcar un pago: cada medio con su nombre y su costo, si lo tiene', () => {
    assert.deepEqual(opcionesDePago({ payment_methods: medios }), [
      { method: 'Mercado Pago', amount_cents: 500000, currency: 'ARS' },
      { method: 'PayPal', amount_cents: 500, currency: 'USD' },
      { method: 'Transferencia', amount_cents: 500000, currency: 'ARS' },
      { method: 'Efectivo' },
    ]);
  });

  it('en un torneo de antes, la opción es el costo único; si es gratis no hay nada que marcar', () => {
    assert.deepEqual(opcionesDePago({ entry_fee_cents: 500000, currency: 'ARS' }), [{ method: null, amount_cents: 500000, currency: 'ARS' }]);
    assert.deepEqual(opcionesDePago({ payment_methods: [{ method: 'Efectivo' }] }), []);
    assert.deepEqual(opcionesDePago({ payment_methods: [] }), []);
  });
});

describe('lo que pagó cada inscripción y lo recaudado', () => {
  const torneo = { payment_methods: [{ method: 'MP', amount_cents: 500000, currency: 'ARS' }, { method: 'PayPal', amount_cents: 500, currency: 'USD' }], currency: 'ARS' };
  const reg = (extra = {}) => ({ status: 'confirmada', paid: 1, ...extra });

  it('lo anotado al marcarla paga', () => {
    assert.deepEqual(pagoDe(reg({ paid_amount_cents: 500, paid_currency: 'USD', paid_method: 'PayPal' }), torneo), { amount_cents: 500, currency: 'USD' });
    assert.deepEqual(pagoDe(reg({ paid_amount_cents: 500000 }), torneo), { amount_cents: 500000, currency: 'ARS' });
  });

  it('la que no pagó o se retiró no pagó nada', () => {
    assert.equal(pagoDe(reg({ paid: 0, paid_amount_cents: 500 }), torneo), null);
    assert.equal(pagoDe(reg({ status: 'retirada', paid_amount_cents: 500 }), torneo), null);
  });

  it('sin monto anotado vale el costo del torneo si es uno solo; con varios no se sabe', () => {
    assert.deepEqual(pagoDe(reg(), { entry_fee_cents: 300000, currency: 'ARS' }), { amount_cents: 300000, currency: 'ARS' });
    const iguales = { payment_methods: [{ method: 'MP', amount_cents: 500000, currency: 'ARS' }, { method: 'Transf', amount_cents: 500000, currency: 'ARS' }] };
    assert.deepEqual(pagoDe(reg(), iguales), { amount_cents: 500000, currency: 'ARS' });
    assert.equal(pagoDe(reg(), torneo), null);
    assert.equal(pagoDe(reg(), { payment_methods: [] }), null);
  });

  const regs = [
    reg({ paid_amount_cents: 500000, paid_currency: 'ARS' }),
    reg({ paid_amount_cents: 500000, paid_currency: 'ARS' }),
    reg({ paid_amount_cents: 500, paid_currency: 'USD' }),
    reg({ paid: 0 }),
    reg({ status: 'retirada', paid_amount_cents: 500000, paid_currency: 'ARS' }),
  ];

  it('lo recaudado de cada moneda no se mezcla con las otras', () => {
    assert.deepEqual(recaudadoPorMoneda(regs, torneo), [
      { currency: 'ARS', amount_cents: 1000000 },
      { currency: 'USD', amount_cents: 500 },
    ]);
    assert.deepEqual(recaudadoPorMoneda([], torneo), []);
  });

  it('lo recaudado en una moneda', () => {
    assert.equal(recaudadoEn(regs, torneo, 'ARS'), 1000000);
    assert.equal(recaudadoEn(regs, torneo, 'USD'), 500);
    assert.equal(recaudadoEn(regs, torneo, 'EUR'), 0);
  });
});

describe('lo recaudado sin leer las inscripciones (el listado)', () => {
  const dosCostos = { payment_methods: [{ method: 'MP', amount_cents: 500000, currency: 'ARS' }, { method: 'PayPal', amount_cents: 500, currency: 'USD' }], currency: 'ARS' };

  it('con un solo costo son las pagas por ese costo, si es en la moneda de los premios', () => {
    const iguales = { payment_methods: [{ method: 'MP', amount_cents: 500000, currency: 'ARS' }, { method: 'Transf', amount_cents: 500000, currency: 'ARS' }], currency: 'ARS' };
    assert.equal(recaudadoEstimado(iguales, 3), 1500000);
    assert.equal(recaudadoEstimado({ entry_fee_cents: 300000, currency: 'ARS' }, 2), 600000);
  });

  it('si el único costo es en otra moneda, no suma a los premios', () => {
    assert.equal(recaudadoEstimado({ payment_methods: [{ method: 'PayPal', amount_cents: 500, currency: 'USD' }], currency: 'ARS' }, 4), 0);
  });

  it('gratis es 0; con varios costos no se puede saber con solo cuántos pagaron', () => {
    assert.equal(recaudadoEstimado({ payment_methods: [] }, 5), 0);
    assert.equal(recaudadoEstimado(dosCostos, 5), null);
  });
});
