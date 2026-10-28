export const SALE_STATUSES = [
  ['scheduled', 'מתוכננת כרגיל'],
  ['changed', 'השתנו הפרטים / השעות'],
  ['cancelled', 'בוטלה'],
  ['postponed', 'נדחתה — מועד חדש טרם נקבע'],
];

export const saleIsActive = sale => !['cancelled', 'postponed'].includes(sale.status);

const israelClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function saleStatus(sale, now = new Date()) {
  if (sale.status === 'cancelled') return { kind: 'cancelled', label: 'המכירה בוטלה' };
  if (sale.status === 'postponed') return { kind: 'postponed', label: 'המכירה נדחתה — מועד חדש טרם נקבע' };
  const parts = Object.fromEntries(israelClock.formatToParts(now).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  const days = [...sale.days].sort((a, b) => a.date.localeCompare(b.date));
  const current = days.find(day => day.date === date);
  if (current && current.open <= time && time < current.close) return { kind: 'open', label: 'מתקיימת עכשיו' };
  if (current && time < current.open) return { kind: 'upcoming', label: `נפתחת היום ב־${current.open}` };
  const next = days.find(day => day.date > date);
  if (current && next) return { kind: 'closed', label: 'הסתיימה להיום', nextDate: next.date };
  if (next) return { kind: 'upcoming', label: 'מכירה קרובה', nextDate: next.date };
  return { kind: 'finished', label: 'המכירה הסתיימה' };
}

export function duplicateSale(sale) {
  const copy = structuredClone(sale);
  delete copy.id;
  copy.status = 'scheduled';
  copy.statusNote = '';
  copy.days = [{ date: '', open: sale.days[0].open, close: sale.days[0].close }];
  return copy;
}
