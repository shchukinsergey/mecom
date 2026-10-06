/**
 * Числовое поле, которое не мешает вводу.
 *
 * Обычный controlled-input с number ломает набор: стереть всё, чтобы ввести новое
 * значение, нельзя — на месте пустой строки мгновенно появляется 0. Поэтому здесь
 * промежуточный текст хранится локально, а наружу уходит уже разобранное число.
 */

import { useEffect, useState } from 'react';

interface Props {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  title?: string;
}

export function NumberField({ value, onChange, step, min, max, disabled, title }: Props) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    // Внешнее изменение (загрузка лиги, откат периода) должно попасть в поле,
    // но не затирать то, что ведущий печатает прямо сейчас.
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="number"
      value={text}
      step={step}
      min={min}
      max={max}
      disabled={disabled}
      title={title}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        if (next.trim() === '') return;
        const parsed = Number(next);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
      onBlur={() => {
        if (text.trim() === '' || !Number.isFinite(Number(text))) {
          setText(String(value));
        }
      }}
    />
  );
}
