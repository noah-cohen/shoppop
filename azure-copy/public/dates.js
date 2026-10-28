export const WEEKDAY_LABELS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'מוצאי שבת'];

const hebrewCalendar = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
  timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric',
});
const letters = [
  [400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'],
  [70, 'ע'], [60, 'ס'], [50, 'נ'], [40, 'מ'], [30, 'ל'], [20, 'כ'],
  [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'],
  [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א'],
];
function hebrewNumber(number) {
  let result = '';
  for (const [value, letter] of letters) {
    if (number === 15 || number === 16) {
      result += number === 15 ? 'טו' : 'טז';
      break;
    }
    while (number >= value) {
      result += letter;
      number -= value;
    }
  }
  return result.length === 1 ? `${result}׳` : `${result.slice(0, -1)}״${result.at(-1)}`;
}
export function dateDetails(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) throw new RangeError('Invalid calendar date');
  // A date-only value must not shift with the viewer's timezone or the current hour.
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new RangeError('Invalid calendar date');
  const parts = Object.fromEntries(hebrewCalendar.formatToParts(date).map(part => [part.type, part.value]));
  const day = hebrewNumber(Number(parts.day));
  const year = Number(parts.year);
  const yearLabel = year % 1000 ? hebrewNumber(year % 1000) : `${hebrewNumber(year / 1000)} אלפים`;
  return {
    weekday: WEEKDAY_LABELS[date.getUTCDay()],
    gregorian: value.split('-').reverse().join('/'),
    hebrew: `${day} ב${parts.month} ${yearLabel}`,
    hebrewShort: `${day} ${parts.month}`,
  };
}
export function parseDisplayDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) throw new RangeError('Invalid display date');
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  dateDetails(iso);
  return iso;
}
export function dateLabel(value) {
  const date = dateDetails(value);
  return `${date.weekday} · ${date.hebrew} · ${date.gregorian}`;
}

export function saleDateRange(start, end, open, close) {
  try { dateDetails(start); dateDetails(end); }
  catch { throw new Error('יש לבחור תאריכי התחלה וסיום תקינים.'); }
  if (start > end || !/^([01]\d|2[0-3]):[0-5]\d$/.test(open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(close) || close <= open) {
    throw new Error('יש לבחור טווח תאריכים ושעות תקינים, עם סגירה מאוחרת מהפתיחה באותו יום.');
  }
  const first = Date.parse(`${start}T12:00:00Z`);
  const count = (Date.parse(`${end}T12:00:00Z`) - first) / 86400_000 + 1;
  if (count > 366) throw new Error('הטווח יכול לכלול עד 366 ימים.');
  return Array.from({ length: count }, (_, index) => ({ date: new Date(first + index * 86400_000).toISOString().slice(0, 10), open, close }));
}

export function isUniformSaleRange(days) {
  if (!days.length) return false;
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const start = Date.parse(`${first.date}T12:00:00Z`);
  return sorted.every((day, index) => day.date === new Date(start + index * 86400_000).toISOString().slice(0, 10) && day.open === first.open && day.close === first.close);
}
