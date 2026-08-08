import { useCallback, useEffect, useState } from 'react';
import { useNavigationController } from '@app/appServices';
import { useTelegram } from '@app/telegram/telegramStore';
import { usePerformanceStore } from '@app/performance/PerformanceController';
import { THEME_LABELS, useThemeStore, type ThemePreference } from '@app/theme/themeStore';
import { IconButton } from '@shared/ui/IconButton/IconButton';
import { BackIcon } from '@shared/ui/icons';
import { Button } from '@shared/ui/Button/Button';
import { Sheet } from '@shared/ui/Sheet/Sheet';
import { useSnackbarStore } from '@shared/ui/Snackbar/snackbarStore';
import { useProfileStore } from '../model/profile.store';
import { SavedAnnouncer } from '../components/ProfileParts';
import { buildExport, downloadExport, clearLocalData, exportSummary } from '../data/export';
import type {
  AssistantMode,
  HapticsPreference,
  MotionPreference,
} from '../data/profile.repository';
import styles from './SettingsPage.module.css';

/**
 * Settings (P0.5 §16, §17).
 *
 * Presentation only — nothing here changes the archive. The one destructive
 * action is guarded twice and offers an export first.
 */

const OPTION_GROUPS = {
  theme: [
    { value: 'system', label: THEME_LABELS.system, hint: 'Как в Telegram' },
    { value: 'cinema', label: THEME_LABELS.cinema, hint: 'Глубокий чёрный, киношный' },
    { value: 'graphite', label: THEME_LABELS.graphite, hint: 'Светлее и спокойнее для чтения' },
  ] as const,
  motion: [
    { value: 'system', label: 'Как в системе', hint: 'Следует настройке «Уменьшить движение»' },
    { value: 'calm', label: 'Спокойное', hint: 'Меньше параллакса, без лишней глубины' },
    { value: 'expressive', label: 'Выразительное', hint: 'Полное движение' },
  ] as const,
  haptics: [
    { value: 'off', label: 'Выключены', hint: null },
    { value: 'delicate', label: 'Деликатные', hint: 'Только важное' },
    { value: 'full', label: 'Полные', hint: null },
  ] as const,
  assistant: [
    { value: 'off', label: 'Выключен', hint: 'Тексты остаются на месте' },
    { value: 'ask', label: 'Спрашивать каждый раз', hint: null },
    { value: 'available', label: 'Доступен', hint: 'Помогает, когда попросишь' },
  ] as const,
};

const OptionList = <T extends string>({
  title,
  options,
  value,
  onChange,
  testId,
}: {
  title: string;
  options: readonly { value: T; label: string; hint: string | null }[];
  value: T;
  onChange: (value: T) => void;
  testId: string;
}) => (
  <fieldset className={styles.group} data-testid={testId}>
    <legend className={styles.groupTitle}>{title}</legend>
    {options.map((option) => (
      <label key={option.value} className={styles.option}>
        <input
          type="radio"
          name={testId}
          checked={value === option.value}
          onChange={() => onChange(option.value)}
          data-testid={`${testId}-${option.value}`}
        />
        <span className={styles.optionBody}>
          <span className={styles.optionLabel}>{option.label}</span>
          {option.hint ? <span className={styles.optionHint}>{option.hint}</span> : null}
        </span>
      </label>
    ))}
  </fieldset>
);

export const SettingsPage = () => {
  const navigation = useNavigationController();
  const chromeMode = useTelegram().chromeMode;
  const showSnackbar = useSnackbarStore((state) => state.show);

  const theme = useThemeStore((state) => state.preference);
  const setTheme = useThemeStore((state) => state.setPreference);
  // The system switch always wins over the in-app choice (§16.2).
  const reducedMotionSystem = usePerformanceStore((state) => state.reducedMotion);

  const preferences = useProfileStore((state) => state.preferences);
  const setPreferences = useProfileStore((state) => state.setPreferences);
  const hydrate = useProfileStore((state) => state.hydrate);
  const hydrated = useProfileStore((state) => state.hydrated);

  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [clearStep, setClearStep] = useState<0 | 1 | 2>(0);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const announce = useCallback((message: string) => setAnnouncement(message), []);

  const onExport = useCallback(async () => {
    setExporting(false);
    const archive = await buildExport();
    downloadExport(archive);
    showSnackbar('Файл сохранён на устройство');
  }, [showSnackbar]);

  const onClear = useCallback(async () => {
    setClearing(true);
    await clearLocalData();
    setClearing(false);
    setClearStep(0);
    // Back to a cold start: there is nothing left to show here.
    window.location.replace(import.meta.env.BASE_URL || '/');
  }, []);

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        {chromeMode === 'custom' ? (
          <IconButton label="Назад" onClick={() => navigation.goBack()} data-testid="settings-back">
            <BackIcon />
          </IconButton>
        ) : (
          <span />
        )}
        <h1 className={styles.title}>Настройки</h1>
      </header>

      <div className={`${styles.scroll} scroll-y`}>
        <main className={styles.content}>
          <OptionList
            title="Тема"
            options={OPTION_GROUPS.theme}
            value={theme}
            onChange={(value: ThemePreference) => {
              setTheme(value);
              announce(`Тема: ${THEME_LABELS[value]}`);
            }}
            testId="settings-theme"
          />

          <OptionList
            title="Движение"
            options={OPTION_GROUPS.motion}
            value={preferences.motion}
            onChange={(value: MotionPreference) => {
              void setPreferences({ motion: value });
              announce('Настройка движения сохранена');
            }}
            testId="settings-motion"
          />
          {reducedMotionSystem ? (
            <p className={styles.note} data-testid="settings-motion-note">
              В системе включено «Уменьшить движение» — оно сильнее этой настройки.
            </p>
          ) : null}

          <OptionList
            title="Тактильный отклик"
            options={OPTION_GROUPS.haptics}
            value={preferences.haptics}
            onChange={(value: HapticsPreference) => {
              void setPreferences({ haptics: value });
              announce('Настройка отклика сохранена');
            }}
            testId="settings-haptics"
          />

          <OptionList
            title="Помощь SYO"
            options={OPTION_GROUPS.assistant}
            value={preferences.assistantMode}
            onChange={(value: AssistantMode) => {
              void setPreferences({ assistantMode: value });
              announce('Настройка помощи сохранена');
            }}
            testId="settings-assistant"
          />

          <section className={styles.group} data-testid="settings-data">
            <h2 className={styles.groupTitle}>Данные</h2>
            <p className={styles.note}>
              Всё хранится на этом устройстве. Экспорт складывает архив в файл и никуда его не
              отправляет.
            </p>
            <Button
              variant="secondary"
              block
              onClick={() => setExporting(true)}
              data-testid="settings-export"
            >
              Экспортировать архив
            </Button>
            <Button
              variant="ghost"
              block
              onClick={() => setClearStep(1)}
              data-testid="settings-clear"
            >
              Удалить локальные данные
            </Button>
          </section>

          <section className={styles.group} data-testid="settings-about">
            <h2 className={styles.groupTitle}>О приложении</h2>
            <p className={styles.note}>
              SYO — личный киноархив. Оценки, тексты и почерк живут на этом устройстве. Данные о
              фильмах приходят из TMDB, помощь с текстом — через собственный сервер SYO, и только
              когда ты об этом просишь.
            </p>
          </section>

          <SavedAnnouncer message={announcement} />
        </main>
      </div>

      {/* Export says what is inside before it writes anything (§17.1). */}
      <Sheet open={exporting} title="Экспорт архива" onClose={() => setExporting(false)}>
        <div className={styles.sheetBody}>
          <p className={styles.note}>В файл попадут:</p>
          <ul className={styles.list}>
            {exportSummary().map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className={styles.warning}>
            Файл содержит твои личные записи. Он сохраняется на устройство и никуда не отправляется.
          </p>
          <Button
            variant="primary"
            block
            onClick={() => void onExport()}
            data-testid="export-confirm"
          >
            Сохранить файл
          </Button>
          <Button variant="ghost" block onClick={() => setExporting(false)}>
            Отмена
          </Button>
        </div>
      </Sheet>

      {/* Two deliberate steps before anything is destroyed (§17.3). */}
      <Sheet
        open={clearStep === 1}
        title="Удалить локальные данные?"
        onClose={() => setClearStep(0)}
      >
        <div className={styles.sheetBody}>
          <p className={styles.note}>
            Исчезнут оценки, Дневник, тексты, любимые фильмы, «Посмотреть позже» и почерк. Отменить
            это будет нельзя.
          </p>
          <Button
            variant="secondary"
            block
            onClick={() => {
              setClearStep(0);
              setExporting(true);
            }}
            data-testid="clear-export-first"
          >
            Сначала экспортировать
          </Button>
          <Button
            variant="destructive"
            block
            onClick={() => setClearStep(2)}
            data-testid="clear-continue"
          >
            Продолжить
          </Button>
          <Button variant="ghost" block onClick={() => setClearStep(0)} data-testid="clear-cancel">
            Отмена
          </Button>
        </div>
      </Sheet>

      <Sheet open={clearStep === 2} title="Точно удалить всё?" onClose={() => setClearStep(0)}>
        <div className={styles.sheetBody}>
          <p className={styles.warning}>
            Это последнее подтверждение. После него архив будет пустым.
          </p>
          <Button
            variant="destructive"
            block
            disabled={clearing}
            onClick={() => void onClear()}
            data-testid="clear-confirm"
          >
            {clearing ? 'Удаляем' : 'Удалить всё'}
          </Button>
          <Button variant="ghost" block onClick={() => setClearStep(0)}>
            Оставить как есть
          </Button>
        </div>
      </Sheet>
    </section>
  );
};
