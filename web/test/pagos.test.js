// Medios de pago de un torneo (web/src/logica/pagos.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MEDIOS_DE_PAGO, limpiarMediosDePago, mediosDePago } from '../src/logica/pagos.js';

describe('medios de pago guardados', () => {
  it('lee `payment_methods` con los campos que tengan', () => {
    const medios = [
      { method: 'Mercado Pago', name: 'Organización', alias: 'aoe.mp', url: 'https://mp.com/x' },
      { alias: 'solo.alias' },
    ];
    assert.deepEqual(mediosDePago({ payment_methods: medios }), medios);
    assert.deepEqual(mediosDePago({ payment_methods: [] }), []);
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
    assert.deepEqual(limpiarMediosDePago([{ method: '', name: '', alias: '', url: '' }]), []);
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
});
