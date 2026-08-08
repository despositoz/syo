import { useState } from 'react';
import { useNavigationController, useServices } from '@app/appServices';
import { Sheet } from '@shared/ui/Sheet/Sheet';
import { Button } from '@shared/ui/Button/Button';
import { FAVORITES_MAX } from '../domain/profile.model';
import { useProfileStore } from '../model/profile.store';
import { FavoriteEditorRow, SavedAnnouncer } from '../components/ProfileParts';
import styles from './ProfileEditSheet.module.css';

/**
 * Managing the five favourites (P0.5 §14).
 *
 * Reordering is done with buttons here: it is the accessible path, it works
 * from a keyboard and a screen reader, and every confirmed move is saved
 * immediately. Adding a film reuses the existing picker rather than growing a
 * second search.
 */
export const FavoritesEditor = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const navigation = useNavigationController();
  const { haptics } = useServices();

  const profile = useProfileStore((state) => state.profile);
  const films = useProfileStore((state) => state.films);
  const moveFavorite = useProfileStore((state) => state.moveFavorite);
  const removeFavorite = useProfileStore((state) => state.removeFavorite);

  const [announcement, setAnnouncement] = useState<string | null>(null);

  if (!profile) return null;
  const ids = profile.favoriteFilmIds;

  return (
    <Sheet open={open} title="Любимые фильмы" onClose={onClose}>
      <div className={styles.form}>
        <p className={styles.label}>
          До {FAVORITES_MAX} фильмов. Порядок важен — первый стоит первым.
        </p>

        {ids.length ? (
          <ul className={styles.form}>
            {ids.map((id, index) => (
              <FavoriteEditorRow
                key={id}
                film={films.get(id)}
                index={index}
                total={ids.length}
                onMove={(to) => {
                  void moveFavorite(id, to).then(() => {
                    // One selection tick per crossed slot, nothing louder.
                    haptics.trigger('tabSelection', `favorite:${id}:${to}`);
                    setAnnouncement(`Перемещено на ${to + 1} место`);
                  });
                }}
                onRemove={() => {
                  void removeFavorite(id).then(() => {
                    haptics.trigger('tabSelection', `favorite:remove:${id}`);
                    setAnnouncement('Убрано из любимых');
                  });
                }}
              />
            ))}
          </ul>
        ) : (
          <p className={styles.label}>Пока пусто. Выбери фильм — он появится в профиле.</p>
        )}

        <div className={styles.actions}>
          <Button
            variant="secondary"
            block
            disabled={ids.length >= FAVORITES_MAX}
            onClick={() => {
              onClose();
              // The existing picker, in the mode that returns a favourite.
              navigation.openPicker('selectFavorite');
            }}
            data-testid="favorites-add"
          >
            {ids.length >= FAVORITES_MAX ? 'Список полон' : 'Добавить фильм'}
          </Button>
          <Button variant="ghost" block onClick={onClose}>
            Готово
          </Button>
        </div>

        <SavedAnnouncer message={announcement} />
      </div>
    </Sheet>
  );
};
