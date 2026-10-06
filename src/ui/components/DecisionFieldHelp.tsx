export type DecisionHelpField = 'price' | 'production' | 'marketing' | 'capexGross' | 'rnd';
const fieldTips: Record<DecisionHelpField, string> = {
  price: 'Сравните цену с себестоимостью. Никто не хочет продавать в убыток.',
  production: 'Планируйте выпуск в пределах мощности текущего периода.',
  marketing: 'Маркетинг — это реклама и другие способы привлечь новых клиентов. Его эффект действует только в текущем периоде.',
  capexGross: 'В первую очередь инвестиции покрывают амортизацию текущих станков. Излишек направляется на закупку новых станков, которые увеличат мощность со следующего периода.',
  rnd: 'НИОКР — это научные разработки и новые технологии. Эффект на качество накапливается и сохраняется в будущих периодах: за более качественные и технологичные товары клиенты могут быть готовы платить больше.',
};

/** Short inline guidance for an original MECOM decision field. */
export function DecisionFieldHelp({ field, id }: { field: DecisionHelpField; id: string }) {
  return <p id={id} className="decision-field-help decision-field-tip decision-field-note">{fieldTips[field]}</p>;
}
