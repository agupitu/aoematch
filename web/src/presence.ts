import { useEffect, useState } from 'react';
import { onDisconnect, onValue, ref, remove, set } from 'firebase/database';
import { useAuth } from './auth';
import { database } from './firebase';

export type Presente = { id: string; display_name: string; avatar_url: string | null };

/** Quién está en la sala. Los anónimos escuchan y no escriben. */
export function usePresencia(room: string | null | undefined): Presente[] {
  const { user } = useAuth();
  const [gente, setGente] = useState<Presente[]>([]);

  useEffect(() => {
    if (!room) {
      setGente([]);
      return;
    }
    return onValue(ref(database, `presence/${room}`), (snap) => {
      const val = (snap.val() ?? {}) as Record<string, { display_name?: string; avatar_url?: string }>;
      setGente(
        Object.entries(val).map(([id, d]) => ({
          id,
          display_name: d?.display_name || 'Jugador',
          avatar_url: d?.avatar_url || null,
        }))
      );
    });
  }, [room]);

  useEffect(() => {
    if (!room || !user) return;
    const mio = ref(database, `presence/${room}/${user.id}`);
    const disco = onDisconnect(mio);
    let vivo = true;
    disco
      .remove()
      .then(() => {
        if (!vivo) return;
        return set(mio, {
          display_name: user.display_name.slice(0, 60),
          avatar_url: user.avatar_url ?? '',
        }).then(() => {
          if (!vivo) return remove(mio);
        });
      })
      .catch(() => {});
    return () => {
      vivo = false;
      void remove(mio);
      void disco.cancel();
    };
  }, [room, user]);

  return gente;
}
