export const SUBSCRIBER_PREFERENCES = [
  ['updatesCity', 'מכירות בעיר שלי'],
  ['updatesFavorites', 'חנויות מועדפות'],
  ['updatesSales', 'מכירות מועדפות'],
  ['updatesDaily', 'רשימת המכירות היומית'],
  ['updatesOutlet', 'מכירות אאוטלט'],
  ['adsConsent', 'תוכן פרסומי'],
];
export const SUBSCRIBER_GENDERS = [['female', 'אישה'], ['male', 'גבר'], ['unspecified', 'מעדיפ/ה לא לציין'], ['unknown', 'לא צוין']];
export const SUBSCRIBER_AGES = ['עד 17', '18–24', '25–34', '35–44', '45–54', '55–64', '65 ומעלה', 'לא צוין'];
const unknown = 'לא צוין';
const registrationDate = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem' });

export function subscriberAge(birthDate, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate || '') || birthDate > today) return null;
  const date = new Date(`${birthDate}T12:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== birthDate) return null;
  return Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4))
    - Number(today.slice(5) < birthDate.slice(5));
}
export function subscriberAgeGroup(profile, today) {
  const age = subscriberAge(profile?.birthDate, today);
  return age === null ? unknown : SUBSCRIBER_AGES[[17, 24, 34, 44, 54, 64, Infinity].findIndex(max => age <= max)];
}
export function groupSubscribers(records, value) {
  const groups = new Map();
  for (const record of records) {
    const key = value(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b, 'he'));
}
export function filterSubscribers(records, filters, today) {
  const query = (filters.query || '').trim().toLocaleLowerCase('he');
  return records.filter(item => {
    const profile = item.profile;
    return (!filters.city || (profile?.city || unknown) === filters.city)
      && (!filters.gender || (profile?.gender || 'unknown') === filters.gender)
      && (!filters.age || subscriberAgeGroup(profile, today) === filters.age)
      && (!filters.preference || profile?.[filters.preference] === true)
      && (!query || [item.email, profile?.firstName, profile?.lastName, profile?.phone].join(' ').toLocaleLowerCase('he').includes(query));
  });
}
export function emailDirectory(subscribers, messages) {
  const emails = new Map();
  for (const [records, source] of [[subscribers, 'חשבון רשום'], [messages, 'פניית יצירת קשר']]) {
    for (const item of records) {
      const email = item.email?.trim().toLowerCase();
      if (!email) continue;
      if (!emails.has(email)) emails.set(email, { email, sources: new Set() });
      emails.get(email).sources.add(source);
    }
  }
  return [...emails.values()].map(item => ({ ...item, sources: [...item.sources] }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export function renderSubscribers(subscribers, messages, filters, today, esc) {
  const records = filterSubscribers(subscribers, filters, today);
  const directory = emailDirectory(subscribers, messages);
  const emailLists = [];
  const copy = (members, label) => {
    const index = emailLists.push(emailDirectory(members, []).map(item => item.email)) - 1;
    return `<button type="button" class="secondary" data-action="copy-subscriber-emails" data-email-list="${index}" aria-label="${esc(`העתקת מיילים — ${label}`)}"${members.length ? '' : ' disabled'}>העתקת מיילים</button>`;
  };
  const rows = members => members.length ? members.map(item => {
    const profile = item.profile;
    const age = subscriberAge(profile?.birthDate, today);
    const gender = SUBSCRIBER_GENDERS.find(([key]) => key === (profile?.gender || 'unknown'))?.[1] || unknown;
    const name = profile ? `${profile.firstName} ${profile.lastName}` : 'חשבון ללא פרופיל';
    return `<details class="subscriber-person"><summary><bdi>${esc(item.email)}</bdi><span>${esc(name)} · ${esc(profile?.city || unknown)}</span></summary><div class="subscriber-person-info">
      <p>מגדר: ${esc(gender)} · גיל: ${age === null ? unknown : age} · תאריך לידה: <bdi>${esc(profile?.birthDate || unknown)}</bdi></p>
      <p>טלפון: <bdi>${esc(profile?.phone || unknown)}</bdi> · נרשמ/ה: <bdi>${esc(registrationDate.format(new Date(item.created)))}</bdi></p>
      <ul>${SUBSCRIBER_PREFERENCES.map(([key, label]) => `<li>${esc(label)}: ${profile?.[key] === true ? 'כן' : profile?.[key] === false ? 'לא' : unknown}</li>`).join('')}</ul>
    </div></details>`;
  }).join('') : '<p class="hint">אין נרשמים ברשימה זו.</p>';
  const list = (label, members, content = rows(members), open = false) => `<details class="subscriber-list"${open ? ' open' : ''}><summary>${esc(label)} <span class="count">${members.length}</span></summary><div class="subscriber-list-content">${copy(members, label)}${content}</div></details>`;
  const breakdown = (title, groups) => `<details class="subscriber-list"><summary>${esc(title)}</summary><div class="subscriber-list-content">${groups.map(([label, members]) => {
    const percent = records.length ? Math.round(members.length / records.length * 100) : 0;
    return list(`${label} — ${percent}% מהחתך`, members);
  }).join('')}</div></details>`;
  const cities = groupSubscribers(records, item => item.profile?.city || unknown);
  const genderGroups = SUBSCRIBER_GENDERS.map(([key, label]) => [label, records.filter(item => (item.profile?.gender || 'unknown') === key)]);
  const ageGroups = SUBSCRIBER_AGES.map(label => [label, records.filter(item => subscriberAgeGroup(item.profile, today) === label)]);
  const cityTable = `<div class="subscriber-table-wrap"><table class="subscriber-table"><caption>מספר נרשמים בכל עיר ובכל העדפת עדכונים — החתך הנבחר</caption><thead><tr><th scope="col">עיר</th><th scope="col">סה״כ</th>${SUBSCRIBER_PREFERENCES.map(([, label]) => `<th scope="col">${esc(label)}</th>`).join('')}</tr></thead><tbody>${cities.map(([city, members]) => `<tr><th scope="row">${esc(city)}</th><td>${members.length}</td>${SUBSCRIBER_PREFERENCES.map(([key]) => `<td>${members.filter(item => item.profile?.[key] === true).length}</td>`).join('')}</tr>`).join('')}<tr><th scope="row">סה״כ</th><td>${records.length}</td>${SUBSCRIBER_PREFERENCES.map(([key]) => `<td>${records.filter(item => item.profile?.[key] === true).length}</td>`).join('')}</tr></tbody></table></div>`;
  const preferences = SUBSCRIBER_PREFERENCES.map(([key, label]) => {
    const selected = records.filter(item => item.profile?.[key] === true);
    return list(label, selected, [
      [true, 'בחרו / הסכימו'], [false, 'לא בחרו / לא הסכימו'], [undefined, unknown],
    ].map(([value, caption]) => list(caption, records.filter(item => item.profile?.[key] === value))).join(''));
  }).join('');
  const html = `<div class="subscriber-stats" aria-label="סיכום כללי">
    <div><strong>${subscribers.length}</strong><span>כל החשבונות הרשומים</span></div>
    <div><strong>${directory.length}</strong><span>כתובות מייל ייחודיות מכל המקורות</span></div>
    <div><strong>${new Set(subscribers.map(item => item.profile?.city).filter(Boolean)).size}</strong><span>ערים של נרשמים</span></div>
    <div><strong>${subscribers.filter(item => item.profile?.adsConsent === true).length}</strong><span>הסכימו לתוכן פרסומי</span></div></div>
    <p class="hint" role="status">החתך הנבחר: ${records.length} מתוך ${subscribers.length} נרשמים. הסיכום הכללי וכל המיילים אינם מושפעים מהסינון.</p>
    <div class="actions"><button type="button" class="secondary" data-action="subscriber-expand" data-open="true">פתיחת כל הרשימות</button><button type="button" class="secondary" data-action="subscriber-expand" data-open="false">כיווץ כל הרשימות</button></div>
    ${list('כל הנרשמים — החתך הנבחר', records, rows(records), true)}
    <details class="subscriber-list"><summary>כל המיילים — כל המקורות, ללא כפילויות <span class="count">${directory.length}</span></summary><div class="subscriber-list-content">${copy(directory, 'כל המיילים')}<p class="hint">מייל מפנייה אינו הרשמה לעדכונים או הסכמה לפרסומות. מקורות רשימת המיילים אינם משויכים לחתכי הנרשמים.</p>${directory.map(item => `<p class="subscriber-email"><bdi>${esc(item.email)}</bdi><span>${esc(item.sources.join(' · '))}</span></p>`).join('') || '<p class="hint">אין עדיין כתובות מייל.</p>'}</div></details>
    <details class="subscriber-list" open><summary>סיכום לפי עיר והעדפות</summary>${cityTable}</details>
    ${breakdown('נרשמים לפי עיר', cities)}
    ${breakdown('נרשמים לפי גיל', ageGroups)}
    ${breakdown('נרשמים לפי מגדר', genderGroups)}
    <details class="subscriber-list"><summary>כל העדפות העדכונים וההסכמה לפרסומות</summary><div class="subscriber-list-content"><p class="hint">אפשר לבחור כמה העדפות: הסכומים שלהן אינם מספר נרשמים ייחודיים. בכל רשימה מוצגים גם מי שלא בחרו ומי שאין להם פרופיל.</p>${preferences}</div></details>`;
  return { html, emailLists };
}
