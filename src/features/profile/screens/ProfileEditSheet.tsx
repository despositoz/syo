import { useState } from 'react';
import { Sheet } from '@shared/ui/Sheet/Sheet';
import { Button } from '@shared/ui/Button/Button';
import {
  BIO_MAX,
  NAME_MAX,
  graphemeLength,
  suggestedName,
  validateProfile,
} from '../domain/profile.model';
import { useProfileStore } from '../model/profile.store';
import styles from './ProfileEditSheet.module.css';

/**
 * Editing the name and bio (P0.5 §15).
 *
 * The keyboard does not open by itself, validation is inline rather than a
 * toast over the screen, and closing with unsaved changes asks first.
 */
export const ProfileEditSheet = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const profile = useProfileStore((state) => state.profile);
  const save = useProfileStore((state) => state.save);
  const resetToTelegram = useProfileStore((state) => state.resetToTelegram);

  const [draft, setDraft] = useState<{ name: string; bio: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [openedWith, setOpenedWith] = useState(false);

  /*
   * The draft starts from what is saved, each time the sheet opens. Adjusted
   * during render rather than in an effect: an effect would paint one frame of
   * the previous draft first.
   */
  if (open !== openedWith) {
    setOpenedWith(open);
    if (open && profile) {
      setDraft({ name: profile.displayName, bio: profile.bio ?? '' });
      setConfirming(false);
    }
  }

  if (!profile) return null;
  const name = draft?.name ?? profile.displayName;
  const bio = draft?.bio ?? profile.bio ?? '';
  const setName = (value: string) => setDraft({ name: value, bio });
  const setBio = (value: string) => setDraft({ name, bio: value });

  const dirty = name !== profile.displayName || bio !== (profile.bio ?? '');
  const errors = validateProfile({ displayName: name, bio: bio || null, favoriteFilmIds: [] });
  const nameLeft = NAME_MAX - graphemeLength(name);
  const bioLeft = BIO_MAX - graphemeLength(bio);

  const commit = async () => {
    if (errors.length) return;
    await save({ displayName: name.trim(), bio: bio.trim() || null });
    onClose();
  };

  const attemptClose = () => {
    // Unsaved work is never thrown away by a swipe (§15).
    if (dirty) {
      setConfirming(true);
      return;
    }
    onClose();
  };

  return (
    <>
      <Sheet open={open && !confirming} title="Профиль" onClose={attemptClose}>
        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.label}>Имя</span>
            <input
              className={styles.input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={NAME_MAX * 4}
              // No autoFocus: the sheet must not throw a keyboard at the user.
              data-testid="profile-name-input"
            />
            <span className={styles.hint} data-error={nameLeft < 0 || undefined}>
              {errors.includes('nameEmpty')
                ? 'Имя не может быть пустым'
                : nameLeft < 0
                  ? `На ${-nameLeft} символов больше, чем помещается`
                  : `Осталось ${nameLeft}`}
            </span>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>О себе</span>
            <textarea
              className={styles.textarea}
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              rows={3}
              data-testid="profile-bio-input"
            />
            <span className={styles.hint} data-error={bioLeft < 0 || undefined}>
              {bioLeft < 0 ? `На ${-bioLeft} символов больше` : `Осталось ${bioLeft}`}
            </span>
          </label>

          <button
            type="button"
            className={styles.reset}
            onClick={() => {
              // Puts the Telegram identity back, including the avatar (§15).
              void resetToTelegram();
              setName(
                suggestedName({
                  firstName: profile.telegramFirstName,
                  lastName: profile.telegramLastName,
                  photoUrl: profile.telegramPhotoUrl,
                }),
              );
            }}
            data-testid="profile-reset-telegram"
          >
            Вернуть имя из Telegram
          </button>

          <div className={styles.actions}>
            <Button
              variant="primary"
              block
              disabled={errors.length > 0}
              onClick={() => void commit()}
              data-testid="profile-save"
            >
              Сохранить
            </Button>
            <Button variant="ghost" block onClick={attemptClose} data-testid="profile-cancel">
              Отмена
            </Button>
          </div>
        </div>
      </Sheet>

      <Sheet open={confirming} title="Не сохранять изменения?" onClose={() => setConfirming(false)}>
        <div className={styles.actions}>
          <Button
            variant="primary"
            block
            disabled={errors.length > 0}
            onClick={() => void commit()}
            data-testid="profile-confirm-save"
          >
            Сохранить
          </Button>
          <Button
            variant="secondary"
            block
            onClick={() => {
              setConfirming(false);
              onClose();
            }}
            data-testid="profile-discard"
          >
            Не сохранять
          </Button>
          <Button variant="ghost" block onClick={() => setConfirming(false)}>
            Продолжить редактирование
          </Button>
        </div>
      </Sheet>
    </>
  );
};
