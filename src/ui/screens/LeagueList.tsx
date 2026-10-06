import { useRef, useState } from 'react';
import { useLeagueStore } from '../../state/leagueStore';
import { parseLeagueFile } from '../../state/persistence';

export function LeagueList() {
  const leagues = useLeagueStore((s) => s.leagues);
  const createLeague = useLeagueStore((s) => s.createLeague);
  const openLeague = useLeagueStore((s) => s.openLeague);
  const deleteLeague = useLeagueStore((s) => s.deleteLeague);
  const importSnapshot = useLeagueStore((s) => s.importSnapshot);

  const [name, setName] = useState('');
  const [firmCount, setFirmCount] = useState(5);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const list = Object.values(leagues).sort((a, b) =>
    b.league.createdAt.localeCompare(a.league.createdAt),
  );

  const handleImport = async (file: File) => {
    try {
      const snapshot = parseLeagueFile(await file.text());
      importSnapshot(snapshot);
      setImportError(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Не удалось прочитать файл.');
    }
  };

  return (
    <div>
      <div className="panel">
        <h2>Новая лига</h2>
        <div className="grid" style={{ gridTemplateColumns: '2fr 1fr auto', alignItems: 'end' }}>
          <div className="field">
            <label>Название лиги</label>
            <input
              value={name}
              placeholder="Северный рынок"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Число фирм</label>
            <input
              type="number"
              min={2}
              max={12}
              value={firmCount}
              onChange={(e) => setFirmCount(Math.max(2, Math.min(12, Number(e.target.value) || 2)))}
            />
          </div>
          <button
            className="primary"
            onClick={() =>
              createLeague(
                name,
                Array.from({ length: firmCount }, (_, i) => `Фирма ${i + 1}`),
              )
            }
          >
            Создать
          </button>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          Названия фирм и стартовые условия можно поправить на следующем экране.
        </p>
      </div>

      <div className="panel">
        <h2>Сохранённые лиги</h2>
        {list.length === 0 && <p className="hint">Пока ничего нет — создайте лигу или загрузите файл.</p>}
        {list.map(({ league }) => (
          <div className="league-card" key={league.id}>
            <span className="name">{league.name}</span>
            <span className="badge">{league.firms.length} фирм</span>
            <span className="badge">
              {league.results.length === 0
                ? 'период 0 не рассчитан'
                : `рассчитано периодов: ${league.results.length}`}
            </span>
            <div className="spacer" />
            <button onClick={() => openLeague(league.id, 'period')}>Открыть</button>
            <button onClick={() => openLeague(league.id, 'setup')}>Настройки</button>
            <button
              className="danger"
              onClick={() => {
                if (confirm(`Удалить лигу «${league.name}» со всеми периодами? Отменить нельзя.`)) {
                  deleteLeague(league.id);
                }
              }}
            >
              Удалить
            </button>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2>Импорт лиги из файла</h2>
        {importError && <div className="error">{importError}</div>}
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImport(file);
            e.target.value = '';
          }}
        />
        <button onClick={() => fileInput.current?.click()}>Выбрать файл JSON</button>
        <p className="hint" style={{ marginBottom: 0 }}>
          Файл создаётся кнопкой «Экспорт лиги» на экране периода — им удобно переносить
          партию на другое устройство или держать бэкап.
        </p>
      </div>
    </div>
  );
}
