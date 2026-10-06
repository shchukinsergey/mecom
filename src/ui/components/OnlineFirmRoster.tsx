import type { OnlineFirm } from '../../online/api';

interface OnlineFirmRosterProps {
  firms: readonly OnlineFirm[];
  ownFirmId: string;
}

const rifFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function OnlineFirmRoster({ firms, ownFirmId }: OnlineFirmRosterProps) {
  return <section className="online-player-roster" aria-labelledby="online-player-roster-title">
    <div className="online-player-roster-heading">
      <div>
        <h3 id="online-player-roster-title">Фирмы в игре</h3>
        <p>РИФ за последний рассчитанный период</p>
      </div>
      <span className="online-player-roster-count">Участников: {firms.length}</span>
    </div>
    <div className="online-player-roster-table-wrap">
      <table className="online-player-roster-table" aria-label="Фирмы, их РИФ и статус решения">
        <thead>
          <tr>
            <th scope="col">Фирма</th>
            <th scope="col">РИФ</th>
            <th scope="col">Решение</th>
          </tr>
        </thead>
        <tbody>
          {firms.map((firm, index) => {
            const isOwnFirm = firm.firmId === ownFirmId;
            const initial = firm.firmName.trim().slice(0, 1).toLocaleUpperCase('ru-RU') || String(index + 1);
            const rifText = typeof firm.currentRif === 'number' && Number.isFinite(firm.currentRif)
              ? rifFormat.format(firm.currentRif) : null;
            return <tr className={isOwnFirm ? 'is-own-firm' : undefined} key={firm.firmId}>
              <td>
                <div className="online-player-firm">
                  <span className="online-player-firm-avatar" aria-hidden="true">{initial}</span>
                  <span className="online-player-firm-name">
                    <strong>{firm.firmName}</strong>
                    {isOwnFirm && <small>Ваша фирма</small>}
                  </span>
                </div>
              </td>
              <td>
                {rifText !== null
                  ? <strong className="online-player-rif">{rifText}</strong>
                  : <span className="online-player-rif-empty">{firm.currentRif === null ? 'Пока не рассчитан' : 'Нет данных'}</span>}
              </td>
              <td>
                <span className={`online-player-submission ${firm.submitted ? 'is-submitted' : 'is-waiting'}`}>
                  <span className="online-player-submission-dot" aria-hidden="true" />
                  {firm.submitted ? 'Отправлено' : 'Ожидает решения'}
                </span>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </section>;
}
