export interface ProductionCapacityButtonProps {
  capacity?: number | null;
  disabled: boolean;
  onSelect: (production: number) => void;
}

export function ProductionCapacityButton({ capacity, disabled, onSelect }: ProductionCapacityButtonProps) {
  const unavailable = disabled || capacity == null || !Number.isFinite(capacity) || capacity < 0;
  return <button type="button" disabled={unavailable} onClick={() => {
    if (unavailable || capacity == null) return;
    onSelect(Math.max(0, Math.min(Math.floor(capacity), Math.round(capacity * 0.8))));
  }}>80% мощности</button>;
}
