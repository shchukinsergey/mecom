import type { StoredRoom } from './roomDatabase.ts';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = (value: string) => value.replace(/[\r\n\t\u0000-\u001f]/g, ' ');
export const roomPeriod = (room: StoredRoom) => room.snapshot.league.results.length;
export const connectedMessage = (room: StoredRoom) => `✅ Подключена игра «${escape(clean(room.name))}». Сообщу, когда начнётся первый период.`;

function deadline(room: StoredRoom): string {
  return room.deadlineAt === null ? 'Срок не ограничен.' : `Дедлайн: ${new Date(room.deadlineAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} МСК.`;
}
export function periodMessage(room: StoredRoom, current = false): string {
  const complete = room.phase === 'complete';
  const lines = [`🎮 <b>${escape(clean(room.name))}</b>`, complete ? 'Игра завершена!' : `${current ? 'Идёт' : 'Начался'} период №${roomPeriod(room)}. Можно вводить и отправлять решения.`];
  const previous = room.snapshot.league.results.at(-1);
  // Period zero is the initial calibration, not a played turn.
  if (previous && previous.periodIndex > 0) {
    const firms = [...previous.firms].sort((a, b) => b.rif.total - a.rif.total || a.firmName.localeCompare(b.firmName, 'ru'));
    const names = firms.map(f => clean(f.firmName));
    const width = Math.max(5, ...names.map(n => [...n].length));
    const rows = firms.map((f, i) => `${names[i]}${' '.repeat(width - [...names[i]].length)}  ${f.rif.total.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`);
    lines.push('', `📊 ${complete ? 'Итоговый рейтинг' : `Итоги периода №${previous.periodIndex}`}`, `<pre>${escape(['Фирма' + ' '.repeat(width - 5) + '  РИФ', ...rows].join('\n'))}</pre>`);
  }
  if (!complete) lines.push('', deadline(room));
  return lines.join('\n');
}
export function reminderMessage(room: StoredRoom, now: number): string | null {
  if (room.phase !== 'collecting' || room.timerMode !== 'standard' || room.deadlineAt === null || room.deadlineAt <= now || room.deadlineAt - now > 3600000) return null;
  const missing = room.members.filter(m => !m.submitted && !room.snapshot.opening[m.firmId]?.nativeBankruptcy);
  if (!missing.length) return null;
  const minutes = Math.max(1, Math.ceil((room.deadlineAt - now) / 60000));
  return [`⏳ <b>${escape(clean(room.name))}</b> · период №${roomPeriod(room)}`, minutes >= 60 ? 'До конца периода остался час.' : `До конца периода осталось ${minutes} мин.`, 'Успейте отправить решения!', '', `Ещё не отправили: ${missing.map(m => escape(clean(m.firmName))).join(', ')}.`, deadline(room)].join('\n');
}
