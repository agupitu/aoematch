// Links de pago de un torneo (web/src/logica/pagos.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LINKS_DE_PAGO, limpiarLinksDePago, linksDePago, textoDelLink } from '../src/logica/pagos.js';

describe('links de pago guardados', () => {
  it('lo que dice cada link: con el nombre, o "Pagar acá" si no lo tiene', () => {
    assert.equal(textoDelLink({ label: 'Mercado Pago', url: 'https://mp.com/x' }), 'Pagar con Mercado Pago');
    assert.equal(textoDelLink({ label: 'Pagar acá', url: 'https://mp.com/x' }), 'Pagar acá');
  });

  it('un torneo viejo con un solo `payment_link` muestra ese link', () => {
    assert.deepEqual(linksDePago({ payment_link: 'https://mp.com/x' }), [{ label: 'Pagar acá', url: 'https://mp.com/x' }]);
    assert.deepEqual(linksDePago({ payment_link: null }), []);
    assert.deepEqual(linksDePago({}), []);
  });

  it('si ya tiene `payment_links`, mandan esos', () => {
    const links = [{ label: 'PayPal', url: 'https://paypal.me/x' }];
    assert.deepEqual(linksDePago({ payment_links: links, payment_link: 'https://viejo.com' }), links);
    assert.deepEqual(linksDePago({ payment_links: [], payment_link: 'https://viejo.com' }), []);
  });
});

describe('links de pago del formulario', () => {
  it('saca las filas vacías y los espacios, y pone nombre a los que no lo tienen', () => {
    assert.deepEqual(
      limpiarLinksDePago([
        { label: ' Mercado Pago ', url: ' https://mp.com/x ' },
        { label: '', url: '' },
        { label: '', url: 'https://ko-fi.com/x' },
      ]),
      [
        { label: 'Mercado Pago', url: 'https://mp.com/x' },
        { label: 'Pagar acá', url: 'https://ko-fi.com/x' },
      ]
    );
    assert.deepEqual(limpiarLinksDePago([]), []);
  });

  it('un nombre largo se corta', () => {
    const [l] = limpiarLinksDePago([{ label: 'x'.repeat(100), url: 'https://mp.com/x' }]);
    assert.equal(l.label.length, 60);
  });

  it('rechaza lo que no es un link http(s) y a quien se pasa del máximo', () => {
    assert.throws(() => limpiarLinksDePago([{ label: 'Banco', url: 'alias.banco' }]), /Banco.*http/);
    assert.throws(() => limpiarLinksDePago([{ label: 'x', url: 'ftp://x.com/a' }]), /http/);
    assert.throws(() => limpiarLinksDePago([{ label: '', url: 'https://x.com/a b' }]), /http/);
    const muchos = Array.from({ length: MAX_LINKS_DE_PAGO + 1 }, (_, i) => ({ label: `L${i}`, url: `https://x.com/${i}` }));
    assert.throws(() => limpiarLinksDePago(muchos), /Hasta/);
    assert.equal(limpiarLinksDePago(muchos.slice(0, MAX_LINKS_DE_PAGO)).length, MAX_LINKS_DE_PAGO);
  });
});
