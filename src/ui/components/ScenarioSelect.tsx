import { SCENARIOS, isScenarioId, type ScenarioId } from '../../engine/scenarios';
import { useId } from 'react';

export function ScenarioSelect({ value, onChange }: {
  value: ScenarioId | undefined;
  onChange: (value: ScenarioId | undefined) => void;
}) {
  const id = useId();
  const scenario = SCENARIOS.find(entry => entry.id === value);
  return <div className="field"><label htmlFor={id}>Тип игры</label>
    <select id={id} value={value ? 'scenario' : 'ordinary'} onChange={event => onChange(event.target.value === 'scenario' ? SCENARIOS[0].id : undefined)}>
      <option value="ordinary">Обычная</option>
      <option value="scenario">Со сценарием</option>
    </select>
    {scenario && <><label htmlFor={`${id}-scenario`}>Сценарий</label>
      <select id={`${id}-scenario`} value={value} onChange={event => { if (isScenarioId(event.target.value)) onChange(event.target.value); }}>
        {SCENARIOS.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
      </select>
      <p className="hint">{scenario.description} Стартовые условия и параметры периодов взяты из оригинального сценария.</p>
    </>}
  </div>;
}
