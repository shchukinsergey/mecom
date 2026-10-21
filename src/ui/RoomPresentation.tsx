import type { RoomSummary } from '../online/roomTypes';

export function RoomArtwork({ seed }: { seed: string }) {
  const variant = [...seed].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 3;
  return <div className={`rooms-artwork art-${variant}`} aria-hidden="true"><div className="art-sun"/><div className="art-hills"/><div className="art-city">{[42, 65, 92, 57, 120, 77, 102, 54].map((height, i) => <div key={i} style={{ height: `${height}%` }}><i/><b/><b/><b/></div>)}</div><div className="art-river"/></div>;
}
export function RoomStatus({ room }: { room: RoomSummary }) {
  const waiting = room.phase === 'collecting' && room.ownFirmId !== null && room.ownFirmSubmitted === false;
  const ready = room.phase === 'collecting' && room.activeFirmCount > 0 && room.submittedCount === room.activeFirmCount;
  const text = room.phase === 'lobby' ? 'Ожидание игроков' : room.phase === 'complete' ? 'Игра завершена' : room.phase === 'closed' ? 'Комната закрыта' : ready ? 'Все готовы' : waiting ? 'Ждём вашего решения' : 'Ждём других игроков';
  return <span className={`rooms-status ${waiting ? 'needs-you' : ready || room.phase === 'complete' ? 'is-ready' : ''}`}>{text}</span>;
}
export function RoomProgress({ room }: { room: RoomSummary }) {
  const total = room.activeFirmCount;
  const submitted = room.phase === 'collecting' ? room.submittedCount : 0;
  return <div className={`rooms-progress ${room.ownFirmSubmitted === false ? 'needs-you' : ''}`} role="progressbar" aria-label="Отправленные решения" aria-valuemin={0} aria-valuemax={Math.max(1, total)} aria-valuenow={submitted} aria-valuetext={`${submitted} из ${total}`}>
    {Array.from({ length: Math.max(1, total) }, (_, i) => <span className={i < submitted ? 'filled' : ''} key={i}/>)}</div>;
}
export function RoomCountdown({ room, now }: { room: RoomSummary; now: number }) {
  let text = 'Без ограничения';
  if (room.phase === 'lobby') text = 'До начала игры';
  else if (room.phase === 'complete' || room.phase === 'closed') text = 'Игра окончена';
  else if (room.deadlineAt !== null) {
    const remaining = Math.max(0, Math.ceil((room.deadlineAt - now) / 60000));
    text = remaining === 0 ? 'Время истекло' : `${Math.floor(remaining / 60) ? `${Math.floor(remaining / 60)} ч ` : ''}${remaining % 60} мин`;
  }
  return <strong className={`rooms-countdown ${room.phase === 'collecting' && room.deadlineAt !== null && room.deadlineAt <= now ? 'expired' : ''}`}><span aria-hidden="true">◷</span> {text}</strong>;
}
export function RoomCard({ room, now, onOpen }: { room: RoomSummary; now: number; onOpen: () => void }) {
  return <article className="rooms-game-card"><RoomArtwork seed={room.id}/><div className="rooms-card-body"><div className="rooms-card-heading"><h2>{room.name}</h2><RoomStatus room={room}/></div><p className="rooms-card-meta">Период {room.currentPeriodIndex} · {room.playerCount} участников {room.isOwner && <span className="rooms-owner-label">Вы — владелец</span>}</p><div className="rooms-card-progress"><div><p>{room.phase === 'collecting' ? `${room.submittedCount} из ${room.activeFirmCount} решений получено` : room.phase === 'lobby' ? 'Собираем участников для новой игры' : 'Результаты сохранены в архиве'}</p><RoomProgress room={room}/></div><div className="rooms-card-time"><span className="hint">Осталось</span><RoomCountdown room={room} now={now}/></div></div></div><footer><div className="rooms-mobile-time"><span className="hint">Осталось</span><RoomCountdown room={room} now={now}/></div><div className="rooms-card-footer-meta"><span>▣ {room.timerMode === 'standard' ? 'Стандартный' : room.timerMode === 'fast' ? 'Быстрый' : 'Без таймера'}</span><span>◷ {room.timerMode === 'standard' ? '24 часа' : room.timerMode === 'fast' ? '7 минут' : 'Без ограничения'}</span><span>◴ {room.deadlineAt ? `До ${new Date(room.deadlineAt).toLocaleString('ru-RU', {timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})} МСК` : room.visibility === 'public' ? 'Открытая комната' : 'По приглашению'}</span></div><button className="primary" onClick={onOpen}>Открыть комнату <span aria-hidden="true">→</span></button></footer></article>;
}
