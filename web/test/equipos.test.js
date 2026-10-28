// Equipos del organizador y pedidos de ingreso, sin base de datos
// (web/src/logica/equipos.js).
//
//   npm --prefix web test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { conMiembro, pedidosPendientes, sinMiembro } from '../src/logica/equipos.js';

/** Equipo del organizador con esos jugadores; el primero es el capitán. */
const delOrganizador = (uids = [], extra = {}) => ({
  staff_made: 1,
  captain_id: uids[0] ?? null,
  members: uids.map((u, i) => ({ user_id: u, role: i === 0 ? 'capitan' : 'jugador' })),
  member_ids: uids,
  ...extra,
});

/** Equipo armado por jugadores: sin `staff_made`. */
const delJugador = (uids) => ({ ...delOrganizador(uids), staff_made: 0 });

describe('sumar un jugador a un equipo', () => {
  it('el primero que entra a un equipo sin capitán pasa a serlo', () => {
    assert.deepEqual(conMiembro(delOrganizador(), 'ana', 2), {
      captain_id: 'ana',
      members: [{ user_id: 'ana', role: 'capitan' }],
      member_ids: ['ana'],
    });
  });

  it('el segundo entra como jugador y el capitán sigue siendo el mismo', () => {
    assert.deepEqual(conMiembro(delOrganizador(['ana']), 'beto', 2), {
      captain_id: 'ana',
      members: [{ user_id: 'ana', role: 'capitan' }, { user_id: 'beto', role: 'jugador' }],
      member_ids: ['ana', 'beto'],
    });
  });

  it('no entra quien ya está ni se pasa del tamaño del equipo', () => {
    assert.throws(() => conMiembro(delOrganizador(['ana']), 'ana', 2), /Ya está/);
    assert.throws(() => conMiembro(delOrganizador(['ana', 'beto']), 'caro', 2), /completo/);
  });

  it('no toca el equipo que recibe', () => {
    const e = delOrganizador(['ana']);
    const copia = structuredClone(e);
    conMiembro(e, 'beto', 2);
    assert.deepEqual(e, copia);
  });
});

describe('sacar un jugador de un equipo', () => {
  it('un equipo de jugadores se borra al quedar vacío', () => {
    assert.equal(sinMiembro(delJugador(['ana']), 'ana'), null);
  });

  it('uno del organizador queda como lugar libre, sin capitán', () => {
    assert.deepEqual(sinMiembro(delOrganizador(['ana']), 'ana'), { captain_id: null, members: [], member_ids: [] });
  });

  it('si se va el capitán, el primero que queda pasa a serlo', () => {
    assert.deepEqual(sinMiembro(delOrganizador(['ana', 'beto', 'caro']), 'ana'), {
      captain_id: 'beto',
      members: [{ user_id: 'beto', role: 'capitan' }, { user_id: 'caro', role: 'jugador' }],
      member_ids: ['beto', 'caro'],
    });
  });

  it('si se va otro, el capitán sigue', () => {
    assert.deepEqual(sinMiembro(delOrganizador(['ana', 'beto']), 'beto'), {
      members: [{ user_id: 'ana', role: 'capitan' }],
      member_ids: ['ana'],
    });
  });
});

describe('pedidos de ingreso pendientes', () => {
  const reg = (user_id, join_request, extra = {}) => ({
    user_id, status: 'pendiente', team_id: null, kind: 'solo', join_request, ...extra,
  });
  const pedido = (team_id, created_at, status = 'pendiente') => ({ team_id, status, created_at });

  it('el más viejo primero, sin retirados, rechazados ni quienes ya tienen equipo', () => {
    const regs = [
      reg('b', pedido('e1', '2026-10-27T12:00:00.000Z')),
      reg('a', pedido('e2', '2026-10-27T10:00:00.000Z')),
      reg('c', pedido('e1', '2026-10-27T11:00:00.000Z', 'rechazado')),
      reg('d', pedido('e1', '2026-10-27T09:00:00.000Z'), { status: 'retirada' }),
      reg('e', pedido('e1', '2026-10-27T08:00:00.000Z'), { team_id: 'e3', kind: 'equipo' }),
      reg('f', null),
      { user_id: 'g', status: 'pendiente', team_id: null, kind: 'solo' },
    ];
    assert.deepEqual(pedidosPendientes(regs).map((r) => r.user_id), ['a', 'b']);
  });
});
