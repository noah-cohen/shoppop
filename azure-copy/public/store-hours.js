export const STORE_WEEKDAYS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];
export const emptyWeek = () => STORE_WEEKDAYS.map((_, day) => ({ day, status: 'unknown', open: '', close: '' }));
const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function weeklyHoursError(week) {
  if (!Array.isArray(week) || week.length !== 7) return 'יש למלא טבלת שעות עם שבעה ימים';
  for (const [index, day] of week.entries()) {
    if (!day || day.day !== index || !['unknown', 'open', 'closed'].includes(day.status)) return 'יום או מצב פתיחה לא תקין בטבלת השעות';
    if (day.status === 'open' && (!validTime(day.open) || !validTime(day.close) || day.close <= day.open)) {
      return `${STORE_WEEKDAYS[index]}: יש להזין שעות תקינות וסגירה מאוחרת מהפתיחה באותו יום`;
    }
    if (day.status !== 'open' && (day.open !== '' || day.close !== '')) return `${STORE_WEEKDAYS[index]}: יש להסיר שעות מיום סגור או ללא שעות`;
    if (day.open2 !== undefined || day.close2 !== undefined) {
      if (day.status !== 'open') return `${STORE_WEEKDAYS[index]}: יש להסיר את טווח השעות השני מיום סגור או ללא שעות`;
      if (!validTime(day.open2) || !validTime(day.close2) || day.close2 <= day.open2) {
        return `${STORE_WEEKDAYS[index]}: בטווח השני יש להזין שעות תקינות וסגירה מאוחרת מהפתיחה באותו יום`;
      }
      if (day.open2 < day.close) return `${STORE_WEEKDAYS[index]}: הטווח השני חייב להתחיל לאחר סיום הטווח הראשון, ללא חפיפה`;
    }
  }
  return '';
}

export function copySundayHours(week) {
  if (!Array.isArray(week) || week.length !== 7) throw new Error('יש למלא טבלת שעות עם שבעה ימים');
  const sunday = emptyWeek();
  sunday[0] = week[0];
  const error = weeklyHoursError(sunday);
  if (error) throw new Error(error);
  if (week[0].status === 'unknown') throw new Error('יש למלא את שעות יום ראשון או לסמן אותו כסגור לפני ההעתקה');
  return week.map((day, index) => index < 5 ? { ...week[0], day: index } : { ...day });
}
