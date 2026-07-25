import { useId, type ChangeEvent } from 'react';
import styles from './SearchField.module.css';

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}

/**
 * Keyboard rules (spec §14): never auto-focused, 16px font so iOS does not
 * zoom the viewport, and no zoom on focus.
 */
export const SearchField = ({ value, onChange, onClear }: SearchFieldProps) => {
  const id = useId();
  return (
    <div className={styles.field}>
      <label className="sr-only" htmlFor={id}>
        Название фильма
      </label>
      <input
        id={id}
        className={styles.input}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Название фильма"
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
      {value ? (
        <button type="button" className={styles.clear} onClick={onClear}>
          Очистить
        </button>
      ) : null}
    </div>
  );
};
