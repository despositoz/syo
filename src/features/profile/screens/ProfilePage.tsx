import { useCallback, useEffect, useState } from 'react';
import { useNavigationController } from '@app/appServices';
import { summaryOf, type Film } from '@entities/film/film.model';
import { useDiaryStore } from '@features/diary/model/diary.store';
import { openFilmWithPreflight } from '@pages/film/filmOpening';
import { IconButton } from '@shared/ui/IconButton/IconButton';
import { MenuIcon } from '@shared/ui/icons';
import { Button } from '@shared/ui/Button/Button';
import { useProfileStore } from '../model/profile.store';
import { archiveLine } from '../domain/taste-profile.templates';
import { FavoriteFilms, IdentityBlock, TasteSignatureHero } from '../components/ProfileParts';
import { ProfileEditSheet } from './ProfileEditSheet';
import { FavoritesEditor } from './FavoritesEditor';
import styles from './ProfilePage.module.css';

/**
 * The profile (P0.5 §11).
 *
 * Two questions, in this order: what have I kept about myself, and what
 * film language is forming out of my ratings. Everything is computed on this
 * device and nothing leaves it.
 */
export const ProfilePage = () => {
  const navigation = useNavigationController();

  const profile = useProfileStore((state) => state.profile);
  const snapshot = useProfileStore((state) => state.snapshot);
  const films = useProfileStore((state) => state.films);
  const hydrated = useProfileStore((state) => state.hydrated);
  const hydrate = useProfileStore((state) => state.hydrate);
  const refreshSnapshot = useProfileStore((state) => state.refreshSnapshot);

  const entries = useDiaryStore((state) => state.entries);
  const [editing, setEditing] = useState(false);
  const [editingFavorites, setEditingFavorites] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // The archive moved: the signature is recomputed outside render (§18).
  const diaryRevision = entries.reduce((sum, entry) => sum + entry.revision, 0);
  useEffect(() => {
    if (!hydrated) return;
    void refreshSnapshot();
  }, [diaryRevision, hydrated, refreshSnapshot]);

  const openFilm = useCallback(
    (film: Film) => openFilmWithPreflight(navigation, summaryOf(film)),
    [navigation],
  );

  if (!profile) return null;

  return (
    <div className={styles.page}>
      <div className={`${styles.scroll} scroll-y`} data-testid="profile-scroll">
        <main className={styles.content}>
          <header className={styles.header}>
            <IconButton
              label="Настройки"
              onClick={() => navigation.openSettings()}
              data-testid="profile-settings"
            >
              <MenuIcon />
            </IconButton>
          </header>

          <IdentityBlock profile={profile} onEdit={() => setEditing(true)} />

          <FavoriteFilms
            ids={profile.favoriteFilmIds}
            films={films}
            onOpen={openFilm}
            onEdit={() => setEditingFavorites(true)}
          />

          <TasteSignatureHero
            snapshot={snapshot}
            films={films}
            onOpen={() => navigation.openTasteSignature()}
          />

          {/* One editorial line, not four identical tiles (§11.4). */}
          {snapshot.ratedCount > 0 ? (
            <p className={styles.archive} data-testid="profile-archive">
              {archiveLine(snapshot)}
            </p>
          ) : (
            <div className={styles.coldStart} data-testid="profile-cold-start">
              <p className={styles.archive}>Здесь появится всё, что ты сохранишь о себе.</p>
              <Button variant="primary" onClick={() => navigation.openPicker()}>
                Оценить фильм
              </Button>
            </div>
          )}

          {/* The honest line about where this is computed (§24). */}
          <p className={styles.privacy} data-testid="profile-privacy">
            Почерк считается на этом устройстве из твоего Дневника.
          </p>

          <nav className={styles.links} aria-label="Разделы профиля">
            <button
              type="button"
              className={styles.link}
              onClick={() => navigation.openSettings()}
              data-testid="profile-open-settings"
            >
              Настройки
            </button>
            <button
              type="button"
              className={styles.link}
              onClick={() => navigation.openSettingsSection('about')}
              data-testid="profile-open-about"
            >
              О приложении
            </button>
          </nav>
        </main>
      </div>

      <ProfileEditSheet open={editing} onClose={() => setEditing(false)} />
      <FavoritesEditor open={editingFavorites} onClose={() => setEditingFavorites(false)} />
    </div>
  );
};
