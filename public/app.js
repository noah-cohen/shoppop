import { CATEGORY_OPTIONS, PAYMENT_OPTIONS, AUDIENCE_OPTIONS } from './options.js';
import { WEEKDAY_LABELS, dateDetails, dateLabel, parseDisplayDate, saleDateRange, isUniformSaleRange } from './dates.js';
import { cityChoices } from './cities.js';
import { SALE_STATUSES, saleStatus, saleIsActive, duplicateSale } from './sale-status.js';
import { FAVORITES_KEY, readFavorites, toggleFavorite, writeFavorites } from './favorites.js';
import { STORE_WEEKDAYS, emptyWeek, copySundayHours, weeklyHoursError } from './store-hours.js';
import { filterAdminSales } from './admin-sales.js';

const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const dialogContent = document.querySelector('#dialog-content');
const state = {
  data: { stores: [], venues: [], sales: [] }, authenticated: false,
  view: 'today', adminType: 'sales', month: null, calendarMode: 'stores',
  filters: { query: '', city: '', category: '', venue: '', store: '', outlet: '' },
  dayFilters: { query: '', city: '', category: '', venue: '', store: '', outlet: '' },
  cities: [], excludedCities: [],
  submissions: [], messages: [], subscribers: [],
  adminSaleFilters: { period: '', store: '', city: '', venue: '' },
  favorites: { sales: [], stores: [] }, favoritesError: '',
  account: { authenticated: false }, accountMode: 'login', accountDemo: false,
};
const israelDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => israelDate.format(new Date());
const localDate = value => new Date(`${value}T12:00:00`);
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function currentMonth() {
  const month = localDate(today());
  month.setDate(1);
  return month;
}
state.month = currentMonth();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const storeById = id => state.data.stores.find(s => s.id === id);
const venueById = id => state.data.venues.find(v => v.id === id);
const saleCategories = sale => [...new Set([...sale.categories, ...sale.stores.flatMap(s => storeById(s.storeId)?.categories || [])])];
const saleLabel = sale => sale.stores.length > 1 ? 'מכירה משותפת' : storeById(sale.stores[0].storeId)?.name || sale.title;
const saleStoreNames = sale => sale.stores.map(store => storeById(store.storeId).name);
function dateMarkup(value, className = '') {
  const date = dateDetails(value);
  return `<time class="date-pair ${className}" datetime="${esc(value)}"><span class="date-weekday">${esc(date.weekday)}</span><span>${esc(date.hebrew)}</span><bdi>${esc(date.gregorian)}</bdi></time>`;
}
function hebrewDateRange(start, end) {
  return `${start.hebrew.replace(/\s+\S+$/, '')} – ${end.hebrew}`;
}
function saleShareText(sale) {
  const venue = venueById(sale.venueId);
  const days = [...sale.days].sort((a, b) => a.date.localeCompare(b.date));
  const first = dateDetails(days[0].date);
  const last = dateDetails(days.at(-1).date);
  const storeNames = saleStoreNames(sale);
  const heading = sale.stores.length > 1 ? `מכירה משותפת: ${storeNames.join(' · ')}` : `מכירה של ${storeNames[0]}`;
  const lines = [heading];
  if (sale.title && !storeNames.includes(sale.title)) lines.push(sale.title);
  if (sale.isOutlet) lines.push('מכירת אאוטלט');
  if (days.length === 1) {
    lines.push(`תאריך: ${first.weekday}, ${first.hebrew} | ${first.gregorian}`);
    lines.push(`שעות: ${days[0].open}–${days[0].close}`);
  } else {
    lines.push(`תאריכים: ${hebrewDateRange(first, last)} | ${first.gregorian} – ${last.gregorian}`);
    lines.push(isUniformSaleRange(days) ? `שעות: ${days[0].open}–${days[0].close}` : 'שעות הפתיחה משתנות לפי יום — הפרטים המלאים בקישור.');
  }
  const locationText = venue ? [venue.name, venue.address, venue.city].filter(Boolean).join(', ') : '';
  if (locationText) lines.push(`מיקום: ${locationText}`);
  const categories = saleCategories(sale);
  if (categories.length) lines.push(`קטגוריות: ${categories.join(' · ')}`);
  lines.push('', `לפרטים המלאים: ${location.origin}/#sale/${sale.id}`);
  return lines.join('\n');
}
const whatsappShareUrl = sale => `https://wa.me/?text=${encodeURIComponent(saleShareText(sale))}`;
const storeLogo = (store, alt = '') => store?.logo ? `<img class="store-logo" src="${esc(store.logo)}" alt="${esc(alt)}" width="64" height="40">` : '';
const storeIdentity = store => storeLogo(store, store.name) || `<span>${esc(store.name)}</span>`;
const outletBadge = () => '<span class="outlet-badge" role="img" aria-label="אאוטלט" title="מכירת אאוטלט"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1.2"/><path d="m11 16 5-5"/></svg></span>';
const storeOutletBadge = (sale, link) => !sale.isOutlet && link.isOutlet ? outletBadge() : '';
const saleHasOutlet = sale => sale.isOutlet || sale.stores.some(store => store.isOutlet);
const outletLabel = sale => sale.isOutlet ? 'מכירת אאוטלט' : sale.stores.filter(store => store.isOutlet).map(store => `אאוטלט: ${storeById(store.storeId).name}`).join(' · ');
const accessibilityLabel = venue => venue.accessibility === 'yes' ? 'האולם נגיש לאנשים עם מוגבלות' : venue.accessibility === 'no' ? 'האולם אינו נגיש לאנשים עם מוגבלות' : 'נגישות האולם: לא נמסר';
const accessibilityAnswer = venue => venue.accessibility === 'yes' ? 'כן' : venue.accessibility === 'no' ? 'לא' : 'לא נמסר';
const empty = (title, message, extra = '') => `<div class="empty"><strong>${esc(title)}</strong><p>${esc(message)}</p>${extra}</div>`;
const errorBox = message => `<div class="error" role="alert">${esc(message)}</div>`;
let toastTimer;
function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 3500);
}
const favoritesFailure = 'לא ניתן לקרוא או לשמור מועדפים. בדקו שאחסון מקומי מותר בדפדפן ורעננו את העמוד. הנתונים השמורים לא הוחלפו.';
const accountPromptKey = 'account-prompt-shown';
let accountPromptShown = false;
function favoriteButton(type, id, name) {
  const selected = state.favorites[type].includes(id);
  const caption = selected ? 'הסרה מהמועדפים' : 'שמירה למועדפים';
  const label = `${caption}: ${type === 'sales' ? 'המכירה' : 'החנות'} ${name}`;
  return `<button type="button" class="favorite-button" data-action="favorite" data-type="${type}" data-id="${id}" data-name="${esc(name)}" aria-pressed="${selected}" aria-label="${esc(label)}" title="${esc(label)}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg></button>`;
}
function refreshFavoriteButtons() {
  document.querySelectorAll('[data-action="favorite"]').forEach(button => {
    const { type, id, name } = button.dataset;
    button.outerHTML = favoriteButton(type, Number(id), name);
  });
}
function loadFavorites() {
  try {
    state.favorites = readFavorites(window.localStorage);
    state.favoritesError = '';
  } catch (error) {
    console.error('Could not read favorites', error);
    state.favoritesError = favoritesFailure;
    toast(favoritesFailure);
  }
}
async function api(path, method = 'GET', data) {
  const response = await fetch(`/api/${path}`, {
    method, headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'הבקשה נכשלה');
  return result;
}
async function load() {
  const [data, auth, account, cities] = await Promise.all([api('data'), api('auth'), api('account'), loadCities()]);
  state.data = data;
  state.authenticated = auth.authenticated;
  state.account = account;
  updateAccountLink();
  [state.submissions, state.messages, state.subscribers] = state.authenticated
    ? await Promise.all([api('submissions'), api('messages'), api('subscribers')])
    : [[], [], []];
  if (state.account.authenticated) {
    state.favorites = await api('user/favorites/sync', 'POST', state.favorites);
    try {
      writeFavorites(window.localStorage, state.favorites);
      state.favoritesError = '';
    } catch (error) {
      console.error('Could not cache synchronized favorites', error);
      state.favoritesError = favoritesFailure;
    }
  }
  state.cities = cities;
}
function updateAccountLink() {
  const label = document.querySelector('[data-account-label]');
  if (!label) return;
  const profile = state.account.profile;
  label.textContent = state.accountDemo
    ? 'האזור האישי של שרה כהן'
    : state.account.authenticated && profile
      ? `האזור האישי של ${profile.firstName} ${profile.lastName}`
      : 'האזור האישי';
}
async function loadCities() {
  if (state.cities.length) return state.cities;
  const response = await fetch('/cities.json');
  if (!response.ok) throw new Error('לא ניתן לטעון את רשימת היישובים');
  const data = await response.json();
  if (!Array.isArray(data.cities) || !data.cities.length || !Array.isArray(data.excludedCities)) throw new Error('רשימת היישובים אינה תקינה');
  state.excludedCities = data.excludedCities;
  return data.cities;
}
function openDialog(title, content, participants = [], titleStore = null, headingAction = '') {
  dialog.classList.remove('account-prompt-dialog');
  dialogContent.innerHTML = `<div class="dialog-heading"><div class="dialog-title-block"><h2 id="dialog-title">${titleStore ? storeIdentity(titleStore) : esc(title)}</h2>${participants.length ? `<div class="dialog-stores">${participants.map(link => `<span title="${esc(storeById(link.storeId).name)}">${storeIdentity(storeById(link.storeId))}</span>`).join('')}</div>` : ''}</div><div class="dialog-heading-actions">${headingAction}<button class="close" data-action="close" aria-label="סגירה"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19"/></svg></button></div></div><div class="dialog-body">${content}</div>`;
  if (!dialog.open) dialog.showModal();
  dialogContent.querySelector('.dialog-body').scrollTop = 0;
}
function hasUnsavedSale() {
  return Boolean(dialog.querySelector('#entity-form[data-type="sales"][data-dirty="true"]'));
}
function requestDialogClose() {
  if (hasUnsavedSale() && !confirm('התחלת למלא פרטי מכירה. האם את בטוחה שברצונך לסגור בלי לשמור?')) return;
  dialog.close();
}
function showAccountPrompt() {
  if (state.account.authenticated || state.accountDemo || state.view === 'account' || accountPromptShown) return;
  try {
    if (sessionStorage.getItem(accountPromptKey) === 'true') return;
    sessionStorage.setItem(accountPromptKey, 'true');
  } catch (error) {
    console.error('Could not persist the account prompt state', error);
  }
  accountPromptShown = true;
  openDialog('האזור האישי שלך', '<div class="account-prompt"><p>התחברי או הירשמי כדי לשמור את המועדפים שלך ולקבל עדכונים שמתאימים לך.</p><div class="form-actions"><button type="button" class="primary" data-action="open-account">להתחברות או להרשמה</button><button type="button" class="secondary" data-action="close">אולי אחר כך</button></div></div>');
  dialog.classList.add('account-prompt-dialog');
}
function confirmSaleMerge(preview, canMerge = true) {
  const prompt = document.querySelector('#overlap-dialog');
  prompt.innerHTML = `<h2 id="overlap-title">נמצאו מכירות חופפות באותו אולם</h2><p class="hint">${canMerge ? 'אפשר לאחד למכירה משותפת רק את הימים והשעות החופפים. יתר הימים והשעות יישארו כמכירות נפרדות, עם החנויות המקוריות שלהן. האיחוד יעדכן את המכירות המפורטות כאן; במידת הצורך ייווצרו כמה מקטעי מכירה.' : 'בקשה לפרסום תאושר כמכירה נפרדת. אם תרצי לאחד אותה עם מכירה קיימת, אפשר לעשות זאת בעריכת המכירה לאחר הפרסום.'}</p><ul class="overlap-list">${preview.overlaps.map(sale => `<li><strong>${esc(sale.title)}</strong>${sale.days.map(day => `<div>${dateMarkup(day.date)} <bdi>${esc(day.open)}–${esc(day.close)}</bdi></div>`).join('')}</li>`).join('')}</ul><form method="dialog"><div class="form-actions">${canMerge ? '<button class="primary" value="merge">איחוד החפיפות למכירה משותפת</button>' : ''}<button class="secondary" value="separate">שמירה כמכירות נפרדות</button><button class="secondary" value="cancel" autofocus>חזרה לעריכה</button></div></form>`;
  prompt.returnValue = 'cancel';
  return new Promise(resolve => {
    prompt.addEventListener('close', () => resolve(prompt.returnValue), { once: true });
    prompt.showModal();
  });
}
function options(values, selected, placeholder) {
  return `<option value="">${esc(placeholder)}</option>${values.map(([value, label]) => `<option value="${esc(value)}"${String(value) === selected ? ' selected' : ''}>${esc(label)}</option>`).join('')}`;
}
const optionSearch = label => `<input type="search" data-option-search aria-label="חיפוש ${esc(label)} ברשימה" placeholder="הקלידו לחיפוש ברשימה" autocomplete="off">`;
function choicePicker(label, name, choices, selected = [], placeholder = 'בחירת אפשרויות') {
  const all = [...new Set([...choices, ...selected])];
  const caption = selected.length ? selected.join(', ') : placeholder;
  return `<fieldset class="choice-field"><legend>${esc(label)}</legend><details class="multi-picker"><summary><span data-choice-caption data-placeholder="${esc(placeholder)}">${esc(caption)}</span></summary>${name === 'categories' ? `<div class="picker-search">${optionSearch(label)}</div>` : ''}<div class="picker-options">${all.map(option => `<label class="choice-option"><input type="checkbox" name="${esc(name)}" value="${esc(option)}"${selected.includes(option) ? ' checked' : ''}><span>${esc(option)}</span></label>`).join('')}</div>${name === 'categories' ? '<p class="picker-results" data-option-results role="status"></p>' : ''}</details></fieldset>`;
}
const paymentChoices = value => value ? value.split(/[,،]/).map(v => v.trim()).filter(Boolean) : [];
const availableCities = (selected = '', query = '') => cityChoices(state.cities, state.excludedCities, state.data.venues.map(v => v.city), selected, query);
function cityField(label, name, selected = '', required = true) {
  const cities = availableCities(selected);
  return `<div class="field city-field">${esc(label)}${required ? ' *' : ''}<details class="multi-picker city-picker filter-dropdown"><summary><span data-filter-caption>${esc(selected || 'בחירת עיר או יישוב')}</span></summary><div class="filter-menu"><input type="search" data-city-search aria-label="חיפוש ${esc(label)}" placeholder="חיפוש עיר או יישוב" autocomplete="off"><select name="${name}" data-city-select size="8" aria-label="${esc(label)}"${required ? ' required' : ''}>${options(cities.map(city => [city, city]), selected, 'בחירת עיר או יישוב')}</select></div></details></div>`;
}
function venueField(selected = '') {
  const venueLabel = venue => `${venue.name} — ${venue.city}, ${venue.address}`;
  const selectedVenue = venueById(Number(selected));
  const caption = selectedVenue ? venueLabel(selectedVenue) : 'בחירת אולם';
  const venues = [...state.data.venues]
    .sort((a, b) => venueLabel(a).localeCompare(venueLabel(b), 'he'))
    .map(venue => [venue.id, venueLabel(venue)]);
  return `<div class="field city-field full sale-venue-field">אולם המכירה *<details class="multi-picker filter-dropdown"><summary><span data-filter-caption>${esc(caption)}</span></summary><div class="filter-menu">${optionSearch('אולם')}<select name="venueId" size="8" aria-label="אולם המכירה" required>${options(venues, selected, 'בחירת אולם')}</select><p class="picker-results" data-option-results role="status"></p></div></details><p class="hint">העיר והכתובת נלקחות אוטומטית מפרטי האולם שנבחר.</p></div>`;
}
function streetField(item, legacy) {
  return `<div class="field city-field">רחוב${legacy ? '' : ' *'}<details class="multi-picker filter-dropdown"><summary><span data-filter-caption>${esc(item.street || 'יש לבחור עיר תחילה')}</span></summary><div class="filter-menu">${optionSearch('רחוב')}<select name="street" size="8" aria-label="רחוב"${legacy ? '' : ' required'}>${options(item.street ? [[item.street, item.street]] : [], item.street || '', 'בחירת רחוב')}</select><p class="picker-results" data-street-status data-option-results role="status"></p><button type="button" class="secondary" data-action="reload-streets" hidden>ניסיון נוסף</button></div></details><p class="hint" data-street-message role="status"></p></div>`;
}
async function loadVenueStreets(scope, selected = '') {
  const form = scope.closest('form');
  const city = scope.querySelector('[name=city]').value;
  const select = scope.querySelector('[name=street]');
  const picker = select.closest('.filter-dropdown');
  const message = scope.querySelector('[data-street-message]');
  const retry = picker.querySelector('[data-action="reload-streets"]');
  const request = String(Number(scope.dataset.streetRequest || 0) + 1);
  scope.dataset.streetRequest = request;
  select.innerHTML = options(selected ? [[selected, selected]] : [], selected, 'בחירת רחוב');
  picker.querySelector('[data-filter-caption]').textContent = selected || (city ? 'בחירת רחוב' : 'יש לבחור עיר תחילה');
  picker.querySelector('[data-option-search]').value = '';
  picker.querySelector('[data-street-status]').textContent = '';
  message.textContent = '';
  retry.hidden = true;
  if (!city) {
    delete scope.dataset.loadingStreets;
    select.disabled = false;
    updateSubmit(form);
    return;
  }
  scope.dataset.loadingStreets = 'true';
  select.disabled = true;
  message.textContent = 'טוענים רחובות לעיר שנבחרה…';
  updateSubmit(form);
  try {
    const result = await api(`streets?city=${encodeURIComponent(city)}`);
    if (scope.dataset.streetRequest !== request || !scope.isConnected) return;
    if (!Array.isArray(result.streets) || result.streets.some(street => typeof street !== 'string')) throw new Error('רשימת הרחובות שהתקבלה אינה תקינה');
    const streets = selected && !result.streets.includes(selected) ? [selected, ...result.streets] : result.streets;
    select.innerHTML = options(streets.map(street => [street, street]), selected, 'בחירת רחוב');
    message.textContent = result.streets.length ? `${result.streets.length} רחובות בעיר שנבחרה` : 'לא נמצאו רחובות לעיר זו במאגר. יש לעדכן את מאגר הרחובות לפני הוספת כתובת חדשה.';
    if (selected && !result.streets.includes(selected)) message.textContent = 'הרחוב השמור אינו נמצא במאגר העדכני. יש לבחור רחוב מהרשימה לפני שמירה.';
    retry.hidden = result.streets.length > 0;
  } catch (error) {
    if (scope.dataset.streetRequest === request && scope.isConnected) {
      message.textContent = `לא ניתן לטעון רחובות: ${error.message}`;
      retry.hidden = false;
    }
  } finally {
    if (scope.dataset.streetRequest === request) {
      delete scope.dataset.loadingStreets;
      select.disabled = false;
      updateSubmit(form);
    }
  }
}
const posterPreview = (posterId, image = '') => image || posterId ? `<img class="poster-preview" src="${esc(image || `/api/media/${posterId}`)}" alt="תצוגה מקדימה של מודעת הפרסומת">` : '<p class="hint">לא צורפה מודעה</p>';
function filterDropdown(label, key, values, selected, placeholder) {
  const caption = values.find(([value]) => String(value) === selected)?.[1] || placeholder;
  return `<div class="filter-field"><span>${esc(label)}</span><details class="multi-picker filter-dropdown"><summary><span data-filter-caption>${esc(caption)}</span></summary><div class="filter-menu">${optionSearch(label)}<select data-filter="${key}" size="8" aria-label="סינון לפי ${esc(label)}">${options(values, selected, placeholder)}</select><p class="picker-results" data-option-results role="status"></p></div></details></div>`;
}
function filterToolbar(filters, scope = 'main') {
  const cities = availableCities(filters.city);
  const byStore = state.view === 'calendar' || scope === 'day';
  const cats = [...new Set([...CATEGORY_OPTIONS, ...state.data.stores.flatMap(s => s.categories), ...state.data.sales.flatMap(s => s.categories)])].sort((a, b) => a.localeCompare(b, 'he'));
  return `<div class="toolbar ${scope === 'day' ? 'dialog-toolbar' : ''}${byStore ? ' store-toolbar' : ''}" data-filter-scope="${scope}">
    <label class="filter-field input-wrap"><span>חיפוש חופשי</span><input type="search" data-filter="query" aria-label="חיפוש חופשי" placeholder="שם חנות, מכירה או כתובת" value="${esc(filters.query)}"></label>
    <div class="filter-field"><span>עיר</span><details class="multi-picker city-picker filter-dropdown"><summary><span data-filter-caption>${esc(filters.city || 'כל הערים')}</span></summary><div class="filter-menu"><input type="search" data-city-search aria-label="חיפוש עיר ברשימה" placeholder="הקלידו שם עיר או יישוב" autocomplete="off"><select data-city-select data-filter="city" size="8" aria-label="סינון לפי עיר">${options(cities.map(c => [c, c]), filters.city, 'כל הערים')}</select><p class="city-results" data-city-results role="status">${cities.length} ערים ויישובים לפי א׳–ב׳</p></div></details></div>
    ${filterDropdown('קטגוריה', 'category', cats.map(c => [c, c]), filters.category, 'כל הקטגוריות')}
    ${filterDropdown('אולם', 'venue', state.data.venues.map(v => [v.id, v.name]), filters.venue, 'כל האולמות')}
    ${byStore ? filterDropdown('חנות', 'store', [...state.data.stores].sort((a, b) => a.name.localeCompare(b.name, 'he')).map(store => [store.id, store.name]), filters.store, 'כל החנויות') : ''}
    ${byStore ? filterDropdown('סוג מכירה', 'outlet', [['outlet', 'אאוטלט בלבד']], filters.outlet, 'כל המכירות') : ''}
    <button class="clear" data-action="clear-filters" data-scope="${scope}">ניקוי סינון</button>
  </div>`;
}
function filteredSales(filters, source = state.data.sales) {
  const query = filters.query.trim().toLocaleLowerCase('he');
  return source.filter(sale => {
    const venue = venueById(sale.venueId);
    const categories = saleCategories(sale);
    const haystack = [sale.title, sale.description, sale.notes, sale.payment, sale.statusNote, outletLabel(sale), venue?.name, venue?.city, venue?.address, venue?.entrance, venue?.arrivalNotes, accessibilityLabel(venue),
      ...categories, ...(sale.audiences || []), ...sale.stores.flatMap(s => [storeById(s.storeId)?.name, s.description, s.payment])].join(' ').toLocaleLowerCase('he');
    return (!query || haystack.includes(query)) && (!filters.city || venue?.city === filters.city)
      && (!filters.category || categories.includes(filters.category)) && (!filters.venue || sale.venueId === Number(filters.venue))
      && (state.view !== 'calendar' || !filters.store || sale.stores.some(store => store.storeId === Number(filters.store)))
      && (state.view !== 'calendar' || !filters.outlet || saleHasOutlet(sale));
  });
}
function statusMarkup(sale, calendarDate = '') {
  const status = saleStatus(sale);
  const explicit = ['cancelled', 'postponed'].includes(sale.status);
  const showAutomatic = !calendarDate || calendarDate === today();
  return `${explicit || showAutomatic ? `<span class="sale-status status-${status.kind}">${esc(status.label)}</span>` : ''}${sale.status === 'changed' ? '<span class="sale-status status-changed">פרטי המכירה עודכנו</span>' : ''}${sale.status !== 'scheduled' && sale.statusNote ? `<span class="sale-status-note pre-wrap">${esc(sale.statusNote)}</span>` : ''}`;
}
const statusBlock = (sale, date = '') => `<div class="sale-status-block" data-status-sale="${sale.id}" data-status-date="${esc(date)}">${statusMarkup(sale, date)}</div>`;
function saleCardDate(sale, day) {
  const sortedDays = [...sale.days].sort((a, b) => a.date.localeCompare(b.date));
  if (sortedDays.length > 1) {
    const start = dateDetails(sortedDays[0].date);
    const end = dateDetails(sortedDays.at(-1).date);
    return `<span class="card-date-range"><span class="card-range-label">טווח ימים</span><span class="card-hebrew-range">${esc(hebrewDateRange(start, end))}</span><bdi>${esc(`${start.gregorian} – ${end.gregorian}`)}</bdi></span>`;
  }
  return dateMarkup(day.date, 'card-date');
}
function saleCard(sale, date) {
  const venue = venueById(sale.venueId);
  const day = sale.days.find(d => d.date === date) || sale.days.find(d => d.date >= today()) || sale.days.at(-1);
  const categories = saleCategories(sale);
  const locationRow = venue && (venue.name || venue.address) ? `<div class="info-row"><span class="info-label">מיקום</span><span><strong class="venue-name">${esc(/^אולם(?:\s|$)/.test(venue.name || '') ? venue.name : `אולם ${venue.name || ''}`)}</strong>${venue.address ? esc(venue.address) : ''}</span></div>` : '';
  return `<article class="sale-card${sale.stores.length > 1 ? ' shared' : ''}">
    <div class="card-banner"><span class="card-kicker">${esc(venue?.city)}</span>${saleCardDate(sale, day)}</div>
    <div class="card-toolbar">${statusBlock(sale)}<div class="card-actions">${sale.isOutlet ? outletBadge() : sale.stores.length === 1 ? storeOutletBadge(sale, sale.stores[0]) : ''}${favoriteButton('sales', sale.id, saleLabel(sale))}</div></div>
    <div class="card-body"><div class="sale-identity"><h3>${sale.stores.length === 1 ? storeIdentity(storeById(sale.stores[0].storeId)) : esc(saleLabel(sale))}</h3></div>${sale.stores.length === 1 && storeById(sale.stores[0].storeId).logo && sale.title === storeById(sale.stores[0].storeId).name ? '' : `<p class="sale-subtitle">${esc(sale.title)}</p>`}${sale.description ? `<p class="card-description">${esc(sale.description)}</p>` : ''}${sale.stores.length > 1 ? `<section class="card-participants"><ul class="card-stores" aria-label="החנויות המשתתפות במכירה">${sale.stores.map(link => {
      const store = storeById(link.storeId);
      return `<li${store.logo ? ' class="has-logo"' : ''} title="${esc(store.name)}">${storeIdentity(store)}${storeOutletBadge(sale, link)}</li>`;
    }).join('')}</ul></section>` : ''}
      ${locationRow}
      <div class="info-row"><span class="info-label">שעות</span><bdi>${esc(day.open)}–${esc(day.close)}</bdi></div>
      <div class="info-row sale-audiences"><span class="info-label">קהל יעד</span><span>${sale.audiences?.length ? esc(sale.audiences.join(' · ')) : 'לא צוין'}</span></div>
      <div class="info-row sale-categories-row"><span class="info-label">קטגוריות</span><div class="tags">${categories.length ? categories.map(c => `<span class="tag">${esc(c)}</span>`).join('') : 'לא צוינו'}</div></div>
      <div class="card-bottom"><div class="flags">${sale.stores.length > 1 ? `<span>${sale.stores.length} חנויות</span>` : '<span>חנות אחת</span>'}${sale.days.length > 1 ? `<span>${sale.days.length} ימי מכירה</span>` : '<span>יום אחד בלבד</span>'}</div><button class="text-button" data-action="sale" data-id="${sale.id}">פרטי המכירה</button></div>
    </div></article>`;
}
function todayPage() {
  const date = today();
  const salesToday = state.data.sales.filter(sale => saleIsActive(sale) && sale.days.some(day => day.date === date));
  main.innerHTML = `<section class="hero"><div class="hero-copy"><div class="eyebrow">ShopPop — מכירות חד־פעמיות במקום אחד</div><h1><span class="hero-outlined">כל המכירות<span class="hero-period">.</span></span><em class="hero-outlined">לדעת איפה<span class="hero-period">.</span></em><em class="hero-outlined">לדעת מתי<span class="hero-period">.</span></em></h1><p>המכירות, החנויות והפרטים שצריך לפני שיוצאים.<br>חפשו לפי עיר וקטגוריה, או בחרו תאריך בלוח.</p><a class="hero-link" href="#calendar">לכל התאריכים בלוח השנה</a></div>
    <aside class="hero-index" aria-label="תמונת מצב להיום"><div class="index-top"><span>על הפרק</span>${dateMarkup(date, 'index-date')}</div><strong class="index-number">${salesToday.length}</strong><span class="index-caption">מכירות מתקיימות היום</span><div class="index-bottom"><span>כל הפרטים במקום אחד</span><a href="#calendar">תכנון הביקור הבא</a></div></aside></section>
    ${filterToolbar(state.filters)}<div id="results"></div>
    <aside class="bottom-note"><div><strong>לא חייבים לחכות לרגע האחרון.</strong><p>כל המכירות הקרובות, מסודרות לפי תאריך.</p></div><a class="secondary" href="#calendar">פתיחת לוח השנה</a></aside>`;
  updateResults();
}
function updateResults() {
  if (state.view === 'calendar') return updateCalendar();
  const result = document.querySelector('#results');
  if (!result) return;
  if (state.view === 'stores') {
    const query = state.filters.query.trim().toLocaleLowerCase('he');
    const filtered = filteredSales(state.filters);
    const stores = state.data.stores.filter(s => {
      const searchMatches = !query || [s.name, s.phone, ...s.categories, ...s.addresses.flatMap(a => [a.address, a.city, a.arrivalNotes])].join(' ').toLocaleLowerCase('he').includes(query);
      return searchMatches && (!state.filters.category || s.categories.includes(state.filters.category) || filtered.some(sale => sale.stores.some(x => x.storeId === s.id)))
        && ((!state.filters.city && !state.filters.venue) || filtered.some(sale => sale.stores.some(x => x.storeId === s.id)));
    });
    result.innerHTML = `<div class="section-heading"><h2>החנויות שלנו <span class="count">${stores.length} חנויות</span></h2></div><div class="store-grid">${stores.length ? stores.map(storeCard).join('') : empty('לא נמצאו חנויות', 'נסו לשנות את החיפוש או לנקות את הסינון.')}</div>`;
    return;
  }
  const date = today();
  const sales = filteredSales(state.filters).filter(s => s.days.some(d => d.date === date))
    .sort((a, b) => a.days.find(d => d.date === date).open.localeCompare(b.days.find(d => d.date === date).open));
  result.innerHTML = `<div class="section-heading"><h2>קורה היום <span class="count">${sales.length} מכירות</span></h2>${dateMarkup(date, 'date-label')}</div><div class="cards">${sales.length ? sales.map(s => saleCard(s, date)).join('') : empty('אין מכירות להצגה היום', 'לא נמצאו מכירות שתואמות לסינון. אפשר לנקות את הסינון או לבדוק תאריך אחר בלוח השנה.', '<a class="primary" href="#calendar">למכירות הקרובות</a>')}</div>`;
}
function calendarPage() {
  main.innerHTML = `<div class="page-heading calendar-page-heading"><div><div class="eyebrow">מתכננים מראש</div><h1>לוח המכירות.</h1><p class="calendar-legend">${outletBadge()} סימון זה מציין מכירת אאוטלט</p></div><div id="calendar-navigation"></div></div>${filterToolbar(state.filters)}<div id="calendar-results"></div>`;
  updateCalendar();
}
function calendarSale(sale, date) {
  const venue = venueById(sale.venueId);
  let content;
  let details = '';
  if (state.calendarMode === 'venues') {
    content = `<span class="day-sale-title">${esc(venue.name)}</span><span class="day-sale-address">${esc(`${venue.address}, ${venue.city}`)}</span>`;
  } else if (state.calendarMode === 'audiences' || state.calendarMode === 'categories') {
    const audienceMode = state.calendarMode === 'audiences';
    const label = audienceMode ? 'קהל יעד' : 'קטגוריות';
    const values = audienceMode ? sale.audiences || [] : saleCategories(sale);
    const text = values.length ? values.join(' · ') : audienceMode ? 'לא צוין' : 'לא צוינו';
    details = ` — ${label}: ${text}`;
    content = `<span class="day-sale-title">${label}</span><span class="day-sale-values">${esc(text)}</span>`;
  } else {
    content = `${sale.stores.length > 1 ? '<span class="day-sale-title day-sale-shared">מכירה משותפת</span>' : ''}<span class="day-sale-stores">${sale.stores.map(link => {
      const store = storeById(link.storeId);
      return `<span class="day-sale-store" title="${esc(store.name)}">${storeLogo(store, store.name) || `<span class="day-sale-name">${esc(store.name)}</span>`}${storeOutletBadge(sale, link)}</span>`;
    }).join('')}</span>`;
  }
  const shared = sale.stores.length > 1 && state.calendarMode !== 'stores';
  const outletStores = !sale.isOutlet && state.calendarMode !== 'stores' ? sale.stores.filter(link => link.isOutlet) : [];
  return `<button type="button" class="day-sale${sale.stores.length > 1 ? ' is-shared' : ''}" data-action="sale" data-id="${sale.id}" aria-label="${esc(`${saleStoreNames(sale).join(' · ')} — ${venue.name}, ${venue.address}, ${venue.city} — ${dateLabel(date)}${details}${outletLabel(sale) ? ` — ${outletLabel(sale)}` : ''}${sale.status && sale.status !== 'scheduled' ? ` — ${SALE_STATUSES.find(([value]) => value === sale.status)?.[1]}: ${sale.statusNote || ''}` : ''}`)}" title="${esc(sale.title)}">${sale.isOutlet ? `<span class="day-outlet">${outletBadge()}</span>` : ''}${content}${outletStores.length ? `<span class="day-sale-stores day-outlet-stores">${outletStores.map(link => `<span class="day-sale-store" title="${esc(storeById(link.storeId).name)}">${storeIdentity(storeById(link.storeId))}${outletBadge()}</span>`).join('')}</span>` : ''}${shared ? '<span class="day-sale-meta">משותפת</span>' : ''}<span class="sale-status-block" data-status-sale="${sale.id}" data-status-date="${date}">${statusMarkup(sale, date)}</span></button>`;
}
function updateCalendar() {
  const target = document.querySelector('#calendar-results');
  if (!target) return;
  const sales = filteredSales(state.filters);
  const first = new Date(state.month);
  first.setDate(1 - first.getDay());
  const cells = Math.ceil((state.month.getDay() + new Date(state.month.getFullYear(), state.month.getMonth() + 1, 0).getDate()) / 7) * 7;
  document.querySelector('#calendar-navigation').innerHTML = `<div class="calendar-header"><div><h2>${esc(state.month.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' }))}</h2><p class="calendar-context">היום: ${dateMarkup(today())}</p></div><div class="calendar-controls"><button class="secondary" data-action="month" data-offset="-1" aria-label="החודש הקודם">הקודם</button><button class="secondary" data-action="month-today">החודש הנוכחי</button><button class="secondary" data-action="month" data-offset="1" aria-label="החודש הבא">הבא</button></div></div>`;
  target.innerHTML = `<div class="calendar-view" role="group" aria-label="תצוגת מכירות בלוח"><span>תצוגה לפי</span>${[['stores', 'חנויות'], ['venues', 'אולמות'], ['audiences', 'קהל יעד'], ['categories', 'קטגוריות']].map(([mode, label]) => `<button type="button" class="secondary" data-action="calendar-mode" data-mode="${mode}" aria-pressed="${state.calendarMode === mode}">${label}</button>`).join('')}</div><div class="calendar">${WEEKDAY_LABELS.map(d => `<div class="weekday">${esc(d)}</div>`).join('')}${Array.from({ length: cells }, (_, i) => {
    const date = new Date(first);
    date.setDate(first.getDate() + i);
    const key = dateKey(date);
    const matching = sales.filter(s => s.days.some(d => d.date === key));
    const isToday = key === today();
    return `<div class="day${date.getMonth() !== state.month.getMonth() ? ' muted' : ''}${isToday ? ' today' : ''}" data-action="day" data-date="${key}"><button type="button" class="day-open" data-action="day" data-date="${key}"${isToday ? ' aria-current="date"' : ''} aria-label="${isToday ? 'היום, ' : ''}${esc(dateLabel(key))}, ${matching.length} מכירות"><span class="day-heading"><span class="day-number">${date.getDate()}</span>${isToday ? '<span class="today-label">היום</span>' : ''}</span><span class="day-hebrew">${esc(dateDetails(key).hebrewShort)}</span></button>${matching.map(s => calendarSale(s, key)).join('')}${matching.length ? `<span class="day-total">${matching.length} מכירות</span>` : ''}</div>`;
  }).join('')}</div>`;
}
function openDay(date) {
  state.selectedDay = date;
  state.dayFilters = { ...state.filters };
  openDialog(dateLabel(date), `${filterToolbar(state.dayFilters, 'day')}<div id="day-results"></div>`);
  updateDay();
}
function updateDay() {
  const sales = filteredSales(state.dayFilters).filter(s => s.days.some(d => d.date === state.selectedDay));
  document.querySelector('#day-results').innerHTML = `<p class="hint">${sales.length} מכירות ביום הנבחר</p><div class="cards dialog-cards">${sales.length ? sales.map(s => saleCard(s, state.selectedDay)).join('') : empty('אין מכירות מתאימות ביום הזה', 'נסו סינון אחר או בחרו יום אחר.')}</div>`;
}
const externalLink = (url, text) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : '';
const phoneLink = phone => phone ? `<a href="tel:${esc(phone.replace(/[^\d+]/g, ''))}"><bdi>${esc(phone)}</bdi></a>` : '';
function openSale(id) {
  const sale = state.data.sales.find(s => s.id === id);
  if (!sale) return;
  const venue = venueById(sale.venueId);
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.address}, ${venue.city}`)}`;
  const sortedDays = [...sale.days].sort((a, b) => a.date.localeCompare(b.date));
  const uniformRange = sortedDays.length > 1 && isUniformSaleRange(sortedDays);
  const saleDates = sortedDays.length > 1
    ? (() => {
      const start = dateDetails(sortedDays[0].date);
      const end = dateDetails(sortedDays.at(-1).date);
      const exactDates = `<div class="detail-date-grid">${sortedDays.map(day => {
        const details = dateDetails(day.date);
        return `<article class="detail-date-card${day.date === today() ? ' is-today' : ''}">${day.date === today() ? '<strong class="detail-today">היום!</strong>' : ''}<dl class="detail-list"><div><dt>יום בשבוע</dt><dd>${esc(details.weekday)}</dd></div><div><dt>תאריך עברי</dt><dd>${esc(details.hebrew)}</dd></div><div><dt>תאריך לועזי</dt><dd><bdi>${esc(details.gregorian)}</bdi></dd></div><div><dt>שעות פתיחה</dt><dd><bdi>${esc(`${day.open} – ${day.close}`)}</bdi></dd></div></dl></article>`;
      }).join('')}</div>`;
      return `<article class="detail-day detail-day-range"><dl class="detail-list"><div><dt>טווח ימים</dt><dd>${esc(`${start.weekday} עד ${end.weekday}`)}</dd></div><div><dt>טווח עברי</dt><dd>${esc(hebrewDateRange(start, end))}</dd></div><div><dt>טווח לועזי</dt><dd><bdi>${esc(`${start.gregorian} – ${end.gregorian}`)}</bdi></dd></div><div><dt>מספר ימי מכירה</dt><dd>${sortedDays.length}</dd></div>${uniformRange ? `<div><dt>שעות פתיחה</dt><dd><bdi>${esc(`${sortedDays[0].open} – ${sortedDays[0].close}`)}</bdi></dd></div>` : ''}</dl></article>${exactDates}`;
    })()
    : sortedDays.map(d => {
      const details = dateDetails(d.date);
      return `<article class="detail-day${d.date < today() ? ' past' : ''}${d.date === today() ? ' is-today' : ''}">${d.date === today() ? '<strong class="detail-today">היום!</strong>' : ''}<dl class="detail-list"><div><dt>יום בשבוע</dt><dd>${esc(details.weekday)}</dd></div><div><dt>תאריך עברי</dt><dd>${esc(details.hebrew)}</dd></div><div><dt>תאריך לועזי</dt><dd><bdi>${esc(details.gregorian)}</bdi></dd></div><div><dt>שעות פתיחה</dt><dd><bdi>${esc(d.open)}–${esc(d.close)}</bdi></dd></div></dl></article>`;
    }).join('');
  const categories = saleCategories(sale);
  openDialog(saleLabel(sale), `<div class="sale-detail"><div class="sale-detail-toolbar">${statusBlock(sale)}</div>${sale.stores.length === 1 && storeById(sale.stores[0].storeId).logo && sale.title === storeById(sale.stores[0].storeId).name ? '' : `<p class="sale-subtitle">${esc(sale.title)}</p>`}${sale.isOutlet ? `<p class="outlet-description">${outletBadge()} מכירת אאוטלט</p>` : ''}<section class="detail-category-section"><h3>${categories.length === 1 ? 'קטגוריה' : 'קטגוריות'}:</h3><div class="detail-categories">${categories.map(c => `<span>${esc(c)}</span>`).join('')}</div></section>
    ${sale.audiences?.length ? `<section class="sale-audiences"><h3>למי מיועדים המוצרים</h3><p class="pre-wrap">${esc(sale.audiences.join(' · '))}</p></section>` : ''}
    ${sale.description ? `<section><h3>על המכירה</h3><p class="pre-wrap">${esc(sale.description)}</p></section>` : ''}
    <section class="detail-panel sale-location"><h3>מיקום המכירה</h3><dl class="detail-list"><div><dt>שם האולם</dt><dd>${esc(venue.name)}</dd></div><div><dt>עיר</dt><dd>${esc(venue.city)}</dd></div><div><dt>רחוב וכתובת</dt><dd>${esc(venue.address)}</dd></div>${venue.entrance ? `<div><dt>כניסה</dt><dd>${esc(venue.entrance)}</dd></div>` : ''}${venue.arrivalNotes ? `<div><dt>הערות הגעה</dt><dd class="pre-wrap">${esc(venue.arrivalNotes)}</dd></div>` : ''}<div><dt>נגישות</dt><dd>${esc(accessibilityAnswer(venue))}</dd></div>${venue.phone ? `<div><dt>טלפון האולם</dt><dd>${phoneLink(venue.phone)}</dd></div>` : ''}</dl><div class="links">${saleIsActive(sale) ? externalLink(map, 'ניווט למכירה') : ''}</div></section>
    <section class="sale-dates"><h3>${saleIsActive(sale) ? 'מועדי המכירה' : 'המועדים שתוכננו למכירה'}</h3>${saleIsActive(sale) ? '' : '<p class="admin-notice">המכירה אינה מתקיימת במועדים אלה. יש להמתין לעדכון מהחנות.</p>'}
    ${saleDates}</section>
    <h3>חנויות משתתפות ואפשרויות תשלום</h3>
    ${sale.stores.map(s => `<section class="participant"><div class="payment-store"><div><div class="participant-identity"><button class="text-button" data-action="store" data-id="${s.storeId}">${storeIdentity(storeById(s.storeId))}</button>${storeOutletBadge(sale, s)}</div><p class="hint"><strong>אופציות תשלום:</strong> ${esc(s.payment || sale.payment || 'לא צוין')}</p>${favoriteButton('stores', s.storeId, storeById(s.storeId).name)}</div></div>${s.description ? `<p class="pre-wrap">${esc(s.description)}</p>` : ''}${s.posterId ? `<a class="poster-link" href="/api/media/${esc(s.posterId)}" target="_blank" rel="noopener noreferrer"><img class="sale-poster" src="/api/media/${esc(s.posterId)}" alt="מודעת המכירה של ${esc(storeById(s.storeId).name)}"><span>פתיחת המודעה בגודל מלא</span></a>` : ''}</section>`).join('')}
    ${sale.notes ? `<h3>טוב לדעת לפני שמגיעים</h3><p class="pre-wrap">${esc(sale.notes)}</p>` : ''}
    <div class="form-actions">${sale.status === 'postponed' ? '' : `<button class="secondary" data-action="ics" data-id="${sale.id}">${sale.status === 'cancelled' ? 'קובץ ביטול ליומן' : 'הוספה ליומן'}</button>`}<button class="primary" data-action="share" data-id="${sale.id}">שיתוף המכירה</button><a class="primary whatsapp-share" href="${esc(whatsappShareUrl(sale))}" target="_blank" rel="noopener noreferrer" aria-label="שיתוף המכירה ב־WhatsApp">שיתוף ב־WhatsApp</a></div></div>`, sale.stores.length > 1 ? sale.stores : [], sale.stores.length === 1 ? storeById(sale.stores[0].storeId) : null, favoriteButton('sales', sale.id, saleLabel(sale)));
}
function storeCard(store) {
  const upcoming = state.data.sales.filter(sale => sale.stores.some(link => link.storeId === store.id) && sale.days.some(day => day.date >= today())).length;
  const logo = storeLogo(store) || '<span class="store-logo store-logo-placeholder" aria-hidden="true"></span>';
  return `<article class="store-card"><div class="store-identity">${logo}<h2>${esc(store.name)}</h2></div><p>${upcoming} מכירות קרובות</p>${favoriteButton('stores', store.id, store.name)}<button class="text-button" data-action="store" data-id="${store.id}">פרטי החנות והמכירות</button></article>`;
}
function accountTabs(active, demo = false) {
  return `<nav class="account-tabs" aria-label="ניווט באזור האישי">
    <a href="#account" class="${active === 'profile' ? 'active' : ''}"${active === 'profile' ? ' aria-current="page"' : ''}>הפרטים שלי</a>
    <a href="#account/favorites" class="${active === 'favorites' ? 'active' : ''}"${active === 'favorites' ? ' aria-current="page"' : ''}>המועדפים שלי</a>
    ${demo ? '<button type="button" data-action="account-demo-exit">יציאה מתצוגת ניסיון</button>' : ''}
  </nav>`;
}
function favoritesPage(inAccount = false) {
  const date = today();
  const nextDate = sale => sale.days.map(day => day.date).filter(day => day >= date).sort()[0];
  const sales = state.data.sales.filter(sale => state.favorites.sales.includes(sale.id));
  const upcoming = sales.filter(sale => nextDate(sale)).sort((a, b) => nextDate(a).localeCompare(nextDate(b)));
  const past = sales.filter(sale => sale.days.every(day => day.date < date));
  const stores = state.data.stores.filter(store => state.favorites.stores.includes(store.id));
  const missing = ['sales', 'stores'].flatMap(type => state.favorites[type]
    .filter(id => !state.data[type].some(item => item.id === id))
    .map(id => `<div class="unavailable-favorite"><p>${type === 'sales' ? 'המכירה' : 'החנות'} אינה זמינה עוד באתר.</p>${favoriteButton(type, id, 'שאינה זמינה')}</div>`));
  main.innerHTML = `${inAccount ? accountTabs('favorites') : ''}<div class="page-heading"><div class="eyebrow">כל מה ששמרת, במקום אחד</div><h1>המועדפים שלי.</h1>${state.account.authenticated ? `<p class="hint">המועדפים מסונכרנים לחשבון ${esc(state.account.email)} וזמינים בכל מכשיר לאחר כניסה.</p>` : '<a class="text-button" href="#account">כניסה וסנכרון המועדפים</a>'}</div>
    ${state.favoritesError ? errorBox(state.favoritesError) : ''}
    <div class="section-heading"><h2>מכירות ששמרתי — היום ובהמשך <span class="count">${upcoming.length}</span></h2></div><div class="cards">${upcoming.length ? upcoming.map(sale => saleCard(sale)).join('') : empty('עדיין אין מכירות קרובות במועדפים', 'אפשר לשמור מכירות דרך פרטי המכירה בלוח השנה או באמצעות הלב בכרטיס.', '<a class="primary" href="#calendar">ללוח המכירות</a>')}</div>
    <div class="section-heading"><h2>החנויות ששמרתי <span class="count">${stores.length}</span></h2></div><div class="store-grid">${stores.length ? stores.map(storeCard).join('') : empty('עדיין לא שמרת חנויות', 'פתחי את מדריך החנויות ולחצי על הלב ליד החנויות שמעניינות אותך.', '<a class="primary" href="#stores">למדריך החנויות</a>')}</div>
    ${past.length ? `<div class="section-heading"><h2>מכירות ששמרתי וכבר היו <span class="count">${past.length}</span></h2></div><div class="cards">${past.map(sale => saleCard(sale)).join('')}</div>` : ''}
    ${missing.length ? `<section><h2>פריטים שאינם זמינים</h2>${missing.join('')}</section>` : ''}`;
}
function demoAccountPage() {
  const favorites = location.hash.slice(1) === 'account/favorites';
  if (favorites) {
    const futureSales = state.data.sales
      .filter(sale => sale.days.some(day => day.date >= today()))
      .sort((a, b) => a.days[0].date.localeCompare(b.days[0].date))
      .slice(0, 2);
    const stores = state.data.stores.slice(0, 2);
    main.innerHTML = `${accountTabs('favorites', true)}<div class="page-heading"><div class="eyebrow">תצוגת ניסיון בלבד</div><h1>המועדפים שלי.</h1><p class="hint">כך ייראו המכירות והחנויות ששמרת. במצב זה לא נשמרים שינויים.</p></div>
      <div class="demo-favorites"><div class="section-heading"><h2>מכירות ששמרתי — היום ובהמשך <span class="count">${futureSales.length}</span></h2></div><div class="cards">${futureSales.length ? futureSales.map(saleCard).join('') : empty('אין כרגע מכירות לדוגמה', 'לאחר פרסום מכירות הן יופיעו כאן.')}</div>
      <div class="section-heading"><h2>החנויות ששמרתי <span class="count">${stores.length}</span></h2></div><div class="store-grid">${stores.length ? stores.map(storeCard).join('') : empty('אין כרגע חנויות לדוגמה', 'לאחר הוספת חנויות הן יופיעו כאן.')}</div></div>`;
    return;
  }
  const profile = {
    firstName: 'שרה', lastName: 'כהן', birthDate: '1990-01-01', gender: 'female', city: 'ירושלים',
    updatesCity: true, updatesFavorites: true, updatesSales: true, updatesDaily: false, updatesOutlet: true, adsConsent: false,
  };
  main.innerHTML = `${accountTabs('profile', true)}<div class="page-heading account-page-heading"><div class="eyebrow">תצוגת ניסיון בלבד</div><h1>האזור האישי של שרה כהן.</h1><p>כאן אפשר לעדכן את הפרטים האישיים ואת העדפות העדכונים.</p></div><form id="account-demo-profile-form" class="submission-form account-profile-form demo-account">${profileFields(profile, 'demo@example.com')}<div class="admin-notice">זהו חשבון לדוגמה. אפשר לערוך את השדות כדי להתרשם, אך השינויים לא יישמרו ולא יישלח מידע.</div><div class="error" id="form-error" role="alert"></div><div class="form-actions"><button class="primary" type="submit">שמירת שינויים בתצוגת הניסיון</button></div></form>`;
}
function profileFields(profile = {}, email = '') {
  return `<div class="profile-sections">
    <fieldset class="form-section profile-section"><legend>פרטים אישיים</legend><div class="form-grid profile-personal-grid">
      ${field('שם פרטי', 'firstName', profile.firstName, 'text', true, 'maxlength="80" autocomplete="given-name"')}
      ${field('שם משפחה', 'lastName', profile.lastName, 'text', true, 'maxlength="80" autocomplete="family-name"')}
      ${field('תאריך לידה', 'birthDate', profile.birthDate, 'date', true, `data-date-min="1900-01-01" data-date-max="${today()}" autocomplete="bday"`)}
      <label class="field">מגדר *<select name="gender" required>${options([['female', 'אישה'], ['male', 'גבר'], ['unspecified', 'מעדיפ/ה לא לציין']], profile.gender || '', 'בחירת מגדר')}</select></label>
      ${cityField('עיר', 'city', profile.city || '')}
      ${email ? field('כתובת דוא״ל — לא ניתנת לשינוי', 'accountEmail', email, 'email', false, 'disabled dir="ltr"') : ''}
    </div></fieldset>
    <fieldset class="form-section profile-section"><legend>עדכונים שארצה לקבל</legend>
      <label class="choice-option"><input type="checkbox" name="updatesCity"${profile.updatesCity ? ' checked' : ''}><span>עדכונים על מכירות בעיר שלי</span></label>
      <label class="choice-option"><input type="checkbox" name="updatesFavorites"${profile.updatesFavorites ? ' checked' : ''}><span>עדכונים מהחנויות שסימנתי כמועדפות</span></label>
      <label class="choice-option"><input type="checkbox" name="updatesSales"${profile.updatesSales ? ' checked' : ''}><span>עדכונים על מכירות שסימנתי כמועדפות</span></label>
      <label class="choice-option"><input type="checkbox" name="updatesDaily"${profile.updatesDaily ? ' checked' : ''}><span>מייל יומי עם המכירות של אותו היום</span></label>
      <label class="choice-option"><input type="checkbox" name="updatesOutlet"${profile.updatesOutlet ? ' checked' : ''}><span>עדכונים על מכירות אאוטלט</span></label>
      <p class="hint">הבחירות נשמרות ברשימות העדכונים של מנהלת האתר. האתר אינו שולח מיילים.</p>
    </fieldset>
    <fieldset class="form-section profile-section"><legend>פרסומות</legend>
      <label class="choice-option"><input type="checkbox" name="adsConsent"${profile.adsConsent ? ' checked' : ''}><span>אני מסכימ/ה לקבל תוכן פרסומי במייל</span></label>
      <p class="hint">ההסכמה אופציונלית ואינה תנאי להרשמה. אפשר לשנות אותה בכל עת באזור האישי.</p>
    </fieldset>
  </div>`;
}
function profileFromForm(form) {
  const values = new FormData(form);
  return {
    firstName: values.get('firstName'),
    lastName: values.get('lastName'),
    birthDate: formDate(values.get('birthDate')),
    gender: values.get('gender'),
    city: values.get('city'),
    updatesCity: values.has('updatesCity'),
    updatesFavorites: values.has('updatesFavorites'),
    updatesSales: values.has('updatesSales'),
    updatesDaily: values.has('updatesDaily'),
    updatesOutlet: values.has('updatesOutlet'),
    adsConsent: values.has('adsConsent'),
  };
}
function accountPage() {
  if (state.accountDemo) {
    demoAccountPage();
    return;
  }
  if (state.account.authenticated) {
    const profile = state.account.profile || {};
    if (location.hash.slice(1) === 'account/favorites') {
      favoritesPage(true);
      return;
    }
    main.innerHTML = `${accountTabs('profile')}<div class="page-heading account-page-heading"><div class="eyebrow">האזור האישי שלך</div><h1>האזור האישי של ${esc([profile.firstName, profile.lastName].filter(Boolean).join(' '))}.</h1><p>אפשר לערוך כאן את הפרטים האישיים ואת סוגי העדכונים שתרצי לקבל.</p></div><form id="account-profile-form" class="submission-form account-profile-form">${profileFields(profile, state.account.email)}<div class="error" id="form-error" role="alert"></div><div class="form-actions"><button class="secondary" type="button" data-action="user-logout">יציאה מהחשבון</button><button class="primary" type="submit">שמירת השינויים</button></div></form>`;
    return;
  }
  if (state.accountMode === 'register') {
    main.innerHTML = `<div class="page-heading"><div class="eyebrow">יצירת חשבון חדש</div><h1>הרשמה.</h1><p class="hint">המייל משמש לזיהוי החשבון ולשמירת העדפות בלבד. האתר אינו שולח הודעות מייל.</p></div><form id="account-register-form" class="submission-form"><div class="form-grid"><div class="full">${field('כתובת דוא״ל', 'email', '', 'email', true, 'maxlength="254" autocomplete="email" dir="ltr"')}</div>${field('סיסמה — לפחות 10 תווים', 'password', '', 'password', true, 'minlength="10" autocomplete="new-password"')}${field('אימות סיסמה', 'confirmPassword', '', 'password', true, 'minlength="10" autocomplete="new-password"')}</div>${profileFields()}<div class="error" id="form-error" role="alert"></div><div class="form-actions"><button class="secondary" type="button" data-action="account-login">כבר יש לי חשבון</button><button class="primary" type="submit">יצירת חשבון</button></div></form>`;
    return;
  }
  main.innerHTML = `<div class="login account-card"><div class="eyebrow">טוב לראות אותך</div><h1>התחברות.</h1><form id="account-login-form">${field('כתובת דוא״ל', 'email', '', 'email', true, 'maxlength="254" autocomplete="email" dir="ltr"')}${field('סיסמה', 'password', '', 'password', true, 'autocomplete="current-password"')}<div class="error" id="form-error" role="alert"></div><div class="form-actions"><button class="primary" type="submit">התחברות</button></div></form><div class="account-options"><button class="primary" type="button" data-action="account-demo">כניסה לתצוגת ניסיון</button><button class="text-button" type="button" data-action="account-register">הרשמה לחשבון חדש</button></div><p class="hint">המייל משמש לזיהוי החשבון בלבד. האתר אינו שולח הודעות מייל או קודי כניסה.</p></div>`;
}
function storesPage() {
  main.innerHTML = `<div class="page-heading"><h1>מדריך החנויות.</h1></div>${filterToolbar(state.filters)}<div id="results"></div>`;
  updateResults();
}
function storePage(id) {
  const store = storeById(id);
  if (!store) { main.innerHTML = empty('החנות לא נמצאה', 'ייתכן שהחנות הוסרה.'); return; }
  const all = state.data.sales.filter(s => s.stores.some(x => x.storeId === id));
  const future = all.filter(s => s.days.some(d => d.date >= today())).sort((a, b) => a.days.find(d => d.date >= today()).date.localeCompare(b.days.find(d => d.date >= today()).date));
  const past = all.filter(s => s.days.every(d => d.date < today())).sort((a, b) => b.days.at(-1).date.localeCompare(a.days.at(-1).date));
  main.innerHTML = `<div class="page-heading favorite-heading"><a href="#stores" class="text-button">חזרה לכל החנויות</a><div class="store-identity"><h1>${storeIdentity(store)}</h1></div>${favoriteButton('stores', store.id, store.name)}<div class="tags">${store.categories.map(c => `<span class="tag">${esc(c)}</span>`).join('')}</div></div>
    <section class="detail-panel"><h2>פרטי החנות</h2><div class="links">${phoneLink(store.phone)}${externalLink(store.website, 'אתר החנות')}${externalLink(store.catalog, 'לצפייה בקטלוג')}</div>
    ${store.addresses.length ? store.addresses.map(a => `<section class="store-address"><h3>${esc([a.address, a.city].filter(Boolean).join(', '))}</h3>${a.arrivalNotes ? `<p class="pre-wrap">הוראות הגעה: ${esc(a.arrivalNotes)}</p>` : ''}${a.weeklyHours ? `<table class="weekly-hours public-hours"><caption>שעות פתיחה</caption><thead><tr><th scope="col">יום</th><th scope="col">שעות</th></tr></thead><tbody>${a.weeklyHours.map(day => `<tr><th scope="row">${STORE_WEEKDAYS[day.day]}</th><td>${day.status === 'open' ? `<bdi>${esc(day.open)}–${esc(day.close)}</bdi>${day.open2 ? `<br><bdi>${esc(day.open2)}–${esc(day.close2)}</bdi>` : ''}` : day.status === 'closed' ? 'סגור' : 'לא נמסר'}</td></tr>`).join('')}</tbody></table>` : ''}${a.hours ? `<p class="hint pre-wrap">${esc(a.hours)}</p>` : !a.weeklyHours ? '<p class="hint">שעות פתיחה לא צוינו</p>' : ''}</section>`).join('') : '<p class="hint">לא צוינה כתובת קבועה. אפשר לפגוש את החנות במכירות שלה.</p>'}</section>
    <div class="section-heading"><h2>המכירות הבאות <span class="count">${future.length}</span></h2></div><div class="cards">${future.length ? future.map(s => saleCard(s)).join('') : empty('ניפגש במכירה הבאה', 'עדיין לא פורסמו מכירות נוספות לחנות.')}</div>
    <div class="section-heading"><h2>מכירות שכבר היו <span class="count">${past.length}</span></h2></div><div class="cards">${past.length ? past.map(s => saleCard(s)).join('') : empty('ההיסטוריה מתחילה כאן', 'אין מכירות קודמות לחנות.')}</div>`;
}
const adminNames = { stores: 'חנויות', venues: 'אולמות', sales: 'מכירות', submissions: 'בקשות לפרסום', messages: 'הודעות', subscribers: 'רשימות עדכונים' };
const subscriberGroups = [
  ['updatesCity', 'מכירות בעיר שלי'],
  ['updatesFavorites', 'חנויות מועדפות'],
  ['updatesSales', 'מכירות מועדפות'],
  ['updatesDaily', 'רשימת המכירות היומית'],
  ['updatesOutlet', 'מכירות אאוטלט'],
  ['adsConsent', 'תוכן פרסומי'],
];
const messageClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const messageDate = created => {
  const parts = Object.fromEntries(messageClock.formatToParts(new Date(created)).map(part => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
};
function adminSalesToolbar() {
  const filters = state.adminSaleFilters;
  const venues = state.data.venues.filter(venue => !filters.city || venue.city === filters.city);
  const cities = [...new Set(state.data.venues.map(venue => venue.city))].sort((a, b) => a.localeCompare(b, 'he'));
  return `<div class="toolbar admin-sales-toolbar" data-filter-scope="admin">
    ${filterDropdown('מועד המכירה', 'period', [['past', 'מכירות קודמות — לפני היום'], ['upcoming', 'היום ומכירות עתידיות']], filters.period, 'כל המועדים')}
    ${filterDropdown('חנות', 'store', [...state.data.stores].sort((a, b) => a.name.localeCompare(b.name, 'he')).map(store => [store.id, store.name]), filters.store, 'כל החנויות')}
    ${filterDropdown('עיר', 'city', cities.map(city => [city, city]), filters.city, 'כל הערים')}
    ${filterDropdown('אולם', 'venue', venues.map(venue => [venue.id, `${venue.name} — ${venue.city}`]), filters.venue, 'כל האולמות')}
    <button class="clear" data-action="clear-filters" data-scope="admin">ניקוי סינון</button></div>`;
}
function adminResults() {
  const type = state.adminType;
  const singular = { stores: 'חנות', venues: 'אולם', sales: 'מכירה' };
  const records = type === 'submissions' ? state.submissions : type === 'messages' ? state.messages : type === 'subscribers' ? state.subscribers : type === 'sales'
    ? filterAdminSales(state.data.sales, state.adminSaleFilters, state.data.venues, today()) : state.data[type];
  const heading = `<div class="section-heading"><h2>${adminNames[type]}</h2>${type === 'sales' ? `<span class="hint" role="status">${records.length} מתוך ${state.data.sales.length} מכירות</span>` : ''}${type === 'submissions' ? '<span class="hint">פרטי קשר ומודעות בבקשות גלויים למנהלת בלבד.</span>' : type === 'messages' ? '<button type="button" class="secondary" data-action="refresh-messages">רענון הודעות</button>' : type === 'subscribers' ? `<span class="hint">${records.length} חשבונות רשומים</span>` : `<button class="primary" data-action="add" data-type="${type}">הוספת ${singular[type]}</button>`}</div>`;
  if (type === 'messages') return `${heading}<p class="hint">פניות מטופס יצירת הקשר. ההודעות ופרטי הקשר פרטיים למנהלת בלבד; לא נשלחת הודעה למייל.</p>${records.length ? records.map(item => `<article class="admin-row${item.read ? '' : ' unread-message'}"><div><strong>${esc(item.subject)}</strong><small>${esc(item.name)} · ${esc(messageDate(item.created))} · ${item.read ? 'נקראה' : 'חדשה'}</small></div><button type="button" class="secondary" data-action="open-message" data-id="${item.id}">פתיחת הודעה</button></article>`).join('') : empty('אין עדיין הודעות', 'פניות שישלחו דרך טופס יצירת הקשר יופיעו כאן.')}`;
  if (type === 'subscribers') return `${heading}<p class="hint">הרשימות פרטיות למנהלת ומציגות את המיילים לפי הבחירות שנשמרו בחשבון. האתר אינו שולח אליהן מיילים.</p>${subscriberGroups.map(([key, label]) => {
    const members = records.filter(item => item.profile[key]);
    return `<section class="detail-panel"><div class="section-heading"><h3>${label}</h3><span class="count">${members.length}</span></div>${members.length ? members.map(item => `<article class="admin-row"><div><strong><bdi>${esc(item.email)}</bdi></strong><small>${esc(`${item.profile.firstName} ${item.profile.lastName}`)} · ${esc(item.profile.city)}</small></div></article>`).join('') : '<p class="hint">אין נרשמים ברשימה זו.</p>'}</section>`;
  }).join('')}`;
  return `${heading}${records.length ? records.map(item => type === 'submissions' ? `<article class="admin-row"><div><strong>${esc(item.title)}</strong><small>${esc(item.storeNames.join(' · '))} — ${esc(item.city)} · ${item.status === 'pending' ? 'ממתינה לאישור' : item.status === 'approved' ? 'אושרה' : 'נדחתה'}</small></div><button class="secondary" data-action="review-submission" data-id="${item.id}">${item.status === 'pending' ? 'פתיחה והעברה ליצירת מכירה' : 'בדיקת הבקשה'}</button></article>` : `<article class="admin-row"><div><strong>${esc(item.title || item.name)}</strong><small>${type === 'sales' ? `${esc(venueById(item.venueId)?.name)} · ${esc(venueById(item.venueId)?.city)} · ${dateMarkup(item.days[0].date)}${item.days.length > 1 ? ` — ${dateMarkup(item.days.at(-1).date)}` : ''} · ${item.stores.length} חנויות` : type === 'venues' ? `${esc(item.city)} · ${esc(item.address)}` : esc(item.categories.join(' · '))}</small>${type === 'sales' ? statusBlock(item) : ''}</div><div class="actions">${type === 'sales' ? `<button class="secondary" data-action="duplicate-sale" data-id="${item.id}">שכפול לתאריכים חדשים</button>` : ''}<button class="secondary" data-action="edit" data-type="${type}" data-id="${item.id}">עריכה</button><button class="danger" data-action="delete" data-type="${type}" data-id="${item.id}">מחיקה</button></div></article>`).join('') : type === 'sales' && state.data.sales.length ? empty('לא נמצאו מכירות לסינון הזה', 'אפשר לשנות או לנקות את המסננים כדי להציג מכירות נוספות.') : empty('עדיין אין כאן רשומות', type === 'submissions' ? 'בקשות שיישלחו דרך האתר יופיעו כאן לבדיקה.' : 'התחילי בהוספה באמצעות הכפתור למעלה.')}`;
}
function adminPage() {
  if (!state.authenticated) {
    main.innerHTML = `<div class="login"><div class="eyebrow">אזור ניהול</div><h1>כניסת מנהלת.</h1><p class="hint">הזיני את סיסמת הניהול שנקבעה בעת הפעלת השרת.</p><form id="login-form"><label class="field">סיסמה<input type="password" name="password" required autocomplete="current-password"></label><div class="error" id="login-error" role="alert"></div><div class="form-actions"><button class="primary" type="submit">כניסה לניהול</button></div></form></div>`;
    return;
  }
  main.innerHTML = `<div class="page-heading split-title"><div><div class="eyebrow">מאחורי הקלעים</div><h1>האתר בידיים שלך.</h1></div><div class="actions"><button class="secondary" data-action="password">החלפת סיסמה</button><button class="secondary" data-action="logout">יציאה</button></div></div>
    <div class="admin-notice">להוספת מכירה: צרי תחילה את החנויות המשתתפות ואת האולם, ולאחר מכן קשרי ביניהם במכירה. נתוני הדוגמה, אם נטענו, מסומנים במפורש.</div>
    <div class="admin-tabs">${Object.entries(adminNames).map(([type, name]) => `<button class="secondary${state.adminType === type ? ' active' : ''}" data-action="admin-type" data-type="${type}">${name} (${type === 'submissions' ? state.submissions.filter(item => item.status === 'pending').length : type === 'messages' ? `${state.messages.filter(item => !item.read).length} חדשות` : type === 'subscribers' ? state.subscribers.length : state.data[type].length})</button>`).join('')}</div>
    ${state.adminType === 'sales' ? adminSalesToolbar() : ''}<div id="admin-results">${adminResults()}</div>`;
}
function contactPage() {
  const profile = state.account.authenticated ? state.account.profile : null;
  const contactName = profile ? `${profile.firstName} ${profile.lastName}`.trim() : '';
  const contactEmail = state.account.authenticated ? state.account.email : '';
  main.innerHTML = `<div class="page-heading"><div class="eyebrow">נשמח לשמוע מכם</div><h1>פרסום מכירה או יצירת קשר.</h1></div>
    <section class="detail-panel contact-publish"><div><h2>רוצה לפרסם מכירה?</h2><p>מלאי את טופס פרסום המכירה עם פרטי החנויות, האולם, התאריכים והשעות. הפרסום יעלה לאתר רק לאחר בדיקה ואישור.</p></div><a class="primary" href="#submit">לטופס פרסום מכירה</a></section>
    <form id="contact-form" class="submission-form"><div class="form-grid">${field('שם מלא', 'name', contactName, 'text', true, 'maxlength="150" autocomplete="name"')}${field('דוא״ל', 'email', contactEmail, 'email', false, 'maxlength="254" autocomplete="email" dir="ltr"')}${field('טלפון', 'phone', '', 'tel', false, 'maxlength="80" autocomplete="tel" dir="ltr"')}<label class="field">נושא הפנייה *<select name="subject" required><option value="">בחירת נושא</option><option value="פרסום מכירה">פרסום מכירה</option><option value="יצירת קשר">יצירת קשר</option><option value="רעיון אחר">רעיון אחר</option></select></label><label class="field full">תוכן ההודעה *<textarea name="message" required maxlength="4000" rows="6"></textarea></label></div><div class="error" id="form-error" role="alert"></div><div class="form-actions"><button type="submit" class="primary">שליחת הודעה</button></div></form>`;
}
function submissionPage() {
  main.innerHTML = `<div class="page-heading"><div class="eyebrow">בעלות חנות?</div><h1>שליחת מכירה לפרסום.</h1><p>מלאו את הפרטים, ואנחנו נחזור אליכם כדי להשלים את הבדיקה. המכירה לא תופיע באתר עד לאישור מנהלת.</p></div>
    <form id="submission-form" class="submission-form"><section class="form-section"><h2>פרטי קשר — למנהלת בלבד</h2><p class="hint">השם והטלפון משמשים לבירור הבקשה ולא יוצגו לציבור. אין לשלוח פרטים אישיים בתוך תיאור המכירה או המודעה אם אינך מעוניינת לפרסם אותם.</p><div class="form-grid">${field('שם אשת הקשר', 'contactName', '', 'text', true, 'maxlength="150"')}${field('טלפון ליצירת קשר', 'contactPhone', '', 'tel', true, 'maxlength="80"')}</div></section>
    <div class="form-grid"><label class="field full">שמות החנויות המשתתפות *<textarea name="storeNames" required maxlength="15100" rows="3" placeholder="כל חנות בשורה נפרדת"></textarea></label>${field('שם המכירה (חובה במכירה משותפת)', 'title', '', 'text', false, 'maxlength="180"')}${field('שם האולם', 'venueName', '', 'text', true, 'maxlength="150"')}${cityField('עיר', 'city', '')}${field('כתובת מדויקת של האולם', 'address', '', 'text', true, 'maxlength="300"')}<div class="full">${choicePicker('קטגוריות', 'categories', CATEGORY_OPTIONS)}${choicePicker('קהלי יעד', 'audiences', AUDIENCE_OPTIONS)}</div>${field('אפשרויות תשלום', 'payment', '', 'text', false, 'maxlength="300"')}<label class="field full">תיאור המכירה<textarea name="description" maxlength="4000"></textarea></label><label class="field full">הערות מיוחדות<textarea name="notes" maxlength="4000"></textarea></label></div>
    ${outletCheckbox('isOutlet', false, 'כל המכירה היא מכירת אאוטלט')}${schedulePicker([{ date: '', open: '10:00', close: '20:00' }])}
    <section class="form-section"><label class="field">מודעת המכירה (לא חובה)<input type="file" data-submission-file accept="image/png,image/jpeg,image/webp"></label><p class="hint">PNG, JPG או WebP עד 5MB. המודעה תוקטן ותישמר בבקשה לבדיקה לפני פרסום.</p><div data-submission-preview></div><input type="hidden" name="poster"><button type="button" class="secondary" data-action="remove-submission-poster">הסרת המודעה</button></section>
    <div class="error" id="form-error" role="alert"></div><div class="form-actions"><button type="submit" class="primary">שליחה לבדיקה</button></div></form>`;
  updateSchedule(main.querySelector('form'));
}
const reviewLinks = new Map();
function captureReview(id) {
  const form = dialogContent.querySelector('[data-submission-review]');
  if (!form) return;
  reviewLinks.set(Number(id), {
    stores: [...form.querySelectorAll('[data-review-store]')].map(select => Number(select.value) || null),
    venueId: Number(form.querySelector('[data-review-venue]').value) || null,
  });
}
function reviewSubmission(id) {
  const item = state.submissions.find(item => item.id === id);
  if (!item) return toast('הבקשה לא נמצאה');
  const uniqueMatch = matches => matches.length === 1 ? matches[0].id : null;
  const links = reviewLinks.get(id) || {
    stores: item.storeNames.map(name => uniqueMatch(state.data.stores.filter(store => store.name === name))),
    venueId: uniqueMatch(state.data.venues.filter(venue => venue.name === item.venueName && venue.city === item.city && venue.address === item.address)),
  };
  const pending = item.status === 'pending';
  openDialog('בדיקת בקשה לפרסום', `<section data-submission-review><p class="hint">בקשה מספר ${id} · ${pending ? 'ממתינה לאישור' : item.status === 'approved' ? 'אושרה' : 'נדחתה'}</p><h3>${esc(item.title)}</h3><p>אשת קשר: ${esc(item.contactName)} · ${phoneLink(item.contactPhone)}</p><p>אולם ${esc(item.venueName)} · ${esc(item.address)}, ${esc(item.city)}</p><p class="pre-wrap">${esc(item.description)}</p><p class="pre-wrap">${esc(item.notes)}</p><p>תשלום: ${esc(item.payment || 'לא צוין')}</p><p>${esc(item.categories.join(' · '))}</p><p>${esc(item.audiences.join(' · '))}</p>${item.isOutlet ? '<p>מכירת אאוטלט</p>' : ''}${item.days.map(day => `<div class="detail-day">${dateMarkup(day.date)}<bdi>${day.open}–${day.close}</bdi></div>`).join('')}${item.poster ? `<img class="poster-preview" src="${esc(item.poster)}" alt="מודעה שנשלחה לבדיקה">` : ''}
    ${pending ? `<section class="form-section"><h3>העברת הפרטים ליצירת מכירה</h3><p class="hint">כל פרטי המכירה שנשלחו יועברו אוטומטית לטופס יצירת המכירה. קשרי את החנויות והאולם לרשומות הקיימות כדי למנוע כפילויות. אם חסרה רשומה, אפשר ליצור אותה מהפרטים שנשלחו ולחזור לכאן.</p>${item.storeNames.map((name, index) => `<div class="review-link-row"><label class="field">${esc(name)}<select data-review-store="${index}">${options(state.data.stores.map(store => [store.id, store.name]), String(links.stores[index] || ''), 'בחירת חנות קיימת')}</select></label><button class="secondary" data-action="submission-create-store" data-id="${id}" data-index="${index}">יצירת חנות חדשה</button></div>`).join('')}<div class="review-link-row"><label class="field">אולם ${esc(item.venueName)}<select data-review-venue>${options(state.data.venues.map(venue => [venue.id, `${venue.name} — ${venue.city}, ${venue.address}`]), String(links.venueId || ''), 'בחירת אולם קיים')}</select></label><button class="secondary" data-action="submission-create-venue" data-id="${id}">יצירת אולם חדש</button></div></section><div class="error" id="review-error" role="alert"></div><div class="form-actions"><button class="primary" data-action="submission-draft" data-id="${id}">העברת כל הפרטים לטופס יצירת מכירה</button><button class="danger" data-action="reject-submission" data-id="${id}">דחיית הבקשה</button></div>` : item.sale_id && state.data.sales.some(sale => sale.id === item.sale_id) ? `<button class="secondary" data-action="sale" data-id="${item.sale_id}">צפייה במכירה שפורסמה</button>` : ''}</section>`);
}
const field = (label, name, value = '', type = 'text', required = false, extra = '') => {
  const isDate = type === 'date';
  const isTime = type === 'time';
  const isEmail = type === 'email';
  const inputType = isDate || isTime ? 'text' : type;
  const shownValue = isDate && value ? dateDetails(value).gregorian : value;
  const format = isDate
    ? ' inputmode="numeric" dir="ltr" placeholder="DD/MM/YYYY" pattern="(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])/[0-9]{4}" title="תאריך בפורמט DD/MM/YYYY, למשל 24/10/2026" data-date-input'
    : isTime
      ? ' inputmode="numeric" dir="ltr" placeholder="HH:MM" maxlength="5" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" title="שעה בפורמט 24 שעות, למשל 23:00" data-time-input'
      : isEmail
        ? ' data-email-input'
      : '';
  return `<label class="field">${esc(label)}${required ? ' *' : ''}<input type="${inputType}" name="${name}" value="${esc(shownValue)}"${required ? ' required' : ''}${format} ${extra}>${isDate ? `<span class="date-preview" aria-live="polite">${value ? dateInputPreview(value) : ''}</span><span class="field-validation" aria-live="polite"></span>` : ''}${isEmail ? '<span class="email-suggestions" role="listbox" aria-label="השלמת כתובת דוא״ל" hidden></span>' : ''}</label>`;
};
function dateInputPreview(value) {
  const date = dateDetails(value);
  return `<time datetime="${esc(value)}">${esc(date.hebrew)}</time>`;
}
function formatDateInput(value, appendSeparator = true) {
  const clean = value.replace(/[^\d/]/g, '');
  if (clean.includes('/')) {
    const parts = clean.split('/').slice(0, 3);
    const day = parts[0].slice(0, 2);
    const month = (parts[1] || '').slice(0, 2);
    const year = (parts[2] || '').slice(0, 4);
    if (parts.length === 1) return day;
    if (parts.length === 2) return `${day}/${month}${month.length === 2 && appendSeparator ? '/' : ''}`;
    return `${day}/${month}/${year}`;
  }
  const digits = clean.slice(0, 8);
  if (digits.length < 2) return digits;
  if (digits.length === 2) return `${digits}${appendSeparator ? '/' : ''}`;
  const dayAndMonth = `${digits.slice(0, 2)}/${digits.slice(2, 4)}`;
  if (digits.length < 4) return dayAndMonth;
  if (digits.length === 4) return `${dayAndMonth}${appendSeparator ? '/' : ''}`;
  return `${dayAndMonth}/${digits.slice(4)}`;
}
function formDate(value) {
  try { return parseDisplayDate(value); }
  catch { throw new Error('יש להזין תאריך תקין בפורמט DD/MM/YYYY.'); }
}
function dateInputError(input) {
  const value = input.value;
  const parts = value.split('/');
  if (parts[0]?.length === 2 && (Number(parts[0]) < 1 || Number(parts[0]) > 31)) return 'היום חייב להיות בין 01 ל־31.';
  if (parts[1]?.length === 2 && (Number(parts[1]) < 1 || Number(parts[1]) > 12)) return 'החודש חייב להיות בין 01 ל־12.';
  if (value.length < 10) return 'יש להשלים תאריך בפורמט DD/MM/YYYY.';
  let iso;
  try {
    iso = parseDisplayDate(value);
  } catch {
    return 'התאריך אינו קיים. יש לבדוק את היום, החודש והשנה.';
  }
  if (input.dataset.dateMin && iso < input.dataset.dateMin) return `התאריך המוקדם ביותר הוא ${dateDetails(input.dataset.dateMin).gregorian}.`;
  if (input.dataset.dateMax && iso > input.dataset.dateMax) return `התאריך המאוחר ביותר הוא ${dateDetails(input.dataset.dateMax).gregorian}.`;
  return '';
}
const EMAIL_DOMAINS = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'walla.co.il'];
function updateEmailSuggestions(input) {
  const suggestions = input.closest('.field')?.querySelector('.email-suggestions');
  if (!suggestions || input.disabled) return;
  const match = /^([^@\s]+)@([^@\s]*)$/.exec(input.value.trim());
  if (!match) {
    suggestions.hidden = true;
    suggestions.replaceChildren();
    return;
  }
  const domain = match[2].toLowerCase();
  const matches = EMAIL_DOMAINS.filter(option => option.startsWith(domain) && option !== domain);
  suggestions.innerHTML = matches.map(option => `<button type="button" role="option" data-action="email-suggestion" data-value="${esc(`${match[1]}@${option}`)}">${esc(`${match[1]}@${option}`)}</button>`).join('');
  suggestions.hidden = matches.length === 0;
}
const outletCheckbox = (name, checked, label) => `<label class="choice-option outlet-option"><input type="checkbox" name="${esc(name)}"${checked ? ' checked' : ''}><span>${esc(label)}</span></label>`;
function weekDayRow(day) {
  const active = day.status === 'open';
  const second = Boolean(day.open2);
  const timeInput = (key, label, enabled) => `<input type="text" dir="ltr" placeholder="HH:MM" maxlength="5" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" title="שעה בפורמט 24 שעות, למשל 22:00" data-week-${key} aria-label="${label} ${STORE_WEEKDAYS[day.day]}" value="${esc(day[key] || '')}"${enabled ? ' required' : ' disabled'}>`;
  return `<tr data-weekday="${day.day}" data-second-range="${second}"><th scope="row">${STORE_WEEKDAYS[day.day]}</th><td><select data-week-status aria-label="מצב ${STORE_WEEKDAYS[day.day]}">${[['unknown', 'לא נמסר'], ['open', 'פתוח'], ['closed', 'סגור']].map(([value, label]) => `<option value="${value}"${day.status === value ? ' selected' : ''}>${label}</option>`).join('')}</select><button type="button" class="text-button week-range-toggle" data-action="toggle-week-range" aria-label="טווח שעות שני ${STORE_WEEKDAYS[day.day]}" aria-expanded="${second}"${active ? '' : ' disabled'}>${second ? 'הסרת טווח שני' : '+ טווח שעות נוסף'}</button></td><td>${timeInput('open', 'פתיחה', active)}<label class="week-second" data-week-second${second ? '' : ' hidden'}>פתיחה נוספת${timeInput('open2', 'פתיחה נוספת', active && second)}</label></td><td>${timeInput('close', 'סגירה', active)}<label class="week-second" data-week-second${second ? '' : ' hidden'}>סגירה נוספת${timeInput('close2', 'סגירה נוספת', active && second)}</label></td></tr>`;
}
function addressRow(address = {}) {
  const legacy = Boolean(address.address && !address.street);
  const week = address.weeklyHours || emptyWeek();
  return `<fieldset class="repeater-row address-row"><legend>כתובת קבועה</legend><div class="form-grid address-location">${cityField('עיר', 'city', address.city || '', !legacy)}${streetField(address, legacy)}${field('מספר בניין (אם יש)', 'buildingNumber', address.buildingNumber, 'text', false, 'maxlength="30"')}${legacy ? `<div class="full" data-legacy-address>${field('כתובת קיימת — נשמרת עד לבחירת עיר ורחוב', 'address', address.address, 'text', true, 'maxlength="300"')}<p class="hint">הכתובת הישנה נשמרת ללא פיצול אוטומטי.</p></div>` : ''}<label class="field full">הוראות הגעה<textarea name="arrivalNotes" maxlength="2000" rows="2">${esc(address.arrivalNotes || '')}</textarea></label></div>
    <div class="address-hours"><button type="button" class="secondary" data-action="copy-week-hours">העתקת יום ראשון לימים א׳–ה׳</button><p class="hint">ההעתקה מחליפה את ימים ב׳–ה׳ בלבד, כולל טווח השעות השני, בלי לשנות את שישי ושבת. אפשר לשנות כל יום ידנית. יש להזין שעות בפורמט 24 שעות, למשל 08:00 או 22:00. אפשר להוסיף לכל יום טווח שני; פעילות שחוצה חצות יש לפצל לימים.</p>
    <table class="weekly-hours"><caption>שעות פתיחה לפי יום</caption><thead><tr><th scope="col">יום</th><th scope="col">מצב</th><th scope="col">פתיחה</th><th scope="col">סגירה</th></tr></thead><tbody>${week.map(weekDayRow).join('')}</tbody></table>
    <label class="field">הערות וחריגים לשעות הפתיחה${address.hours && !address.weeklyHours ? ' — כולל השעות שנשמרו בעבר' : ''}<textarea name="hours" rows="3" maxlength="2000">${esc(address.hours || '')}</textarea></label></div>
    <button type="button" class="small-remove" data-action="remove-row" aria-label="הסרת כתובת">הסרת כתובת</button></fieldset>`;
}
function readWeekDay(row) {
  const status = row.querySelector('[data-week-status]').value;
  const active = status === 'open';
  return {
    day: Number(row.dataset.weekday), status,
    open: active ? row.querySelector('[data-week-open]').value : '',
    close: active ? row.querySelector('[data-week-close]').value : '',
    ...(active && row.dataset.secondRange === 'true' ? {
      open2: row.querySelector('[data-week-open2]').value,
      close2: row.querySelector('[data-week-close2]').value,
    } : {}),
  };
}
function readWeek(row) {
  return [...row.querySelectorAll('[data-weekday]')].map(readWeekDay);
}
function updateWeekDay(row) {
  const active = row.querySelector('[data-week-status]').value === 'open';
  const second = row.dataset.secondRange === 'true';
  for (const key of ['open', 'close', 'open2', 'close2']) {
    const input = row.querySelector(`[data-week-${key}]`);
    const enabled = active && (!key.endsWith('2') || second);
    input.disabled = !enabled;
    input.required = enabled;
    input.setCustomValidity('');
  }
  const toggle = row.querySelector('[data-action="toggle-week-range"]');
  toggle.disabled = !active;
  toggle.textContent = second ? 'הסרת טווח שני' : '+ טווח שעות נוסף';
  toggle.setAttribute('aria-expanded', String(second));
  row.querySelectorAll('[data-week-second]').forEach(label => { label.hidden = !second; });
  const week = emptyWeek();
  week[Number(row.dataset.weekday)] = readWeekDay(row);
  row.querySelector('[data-week-close]').setCustomValidity(weeklyHoursError(week));
}
function dayRow(day) {
  return `<div class="repeater-row day-row">${field('תאריך', 'date', day.date, 'date', true)}${field('פתיחה', 'open', day.open, 'time', true)}${field('סגירה', 'close', day.close, 'time', true)}<button type="button" class="small-remove" data-action="remove-row" aria-label="הסרת יום מכירה">הסרה</button></div>`;
}
function schedulePicker(days = [{ date: today(), open: '10:00', close: '20:00' }]) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const range = days.length > 1;
  const custom = range && !isUniformSaleRange(days);
  return `<section class="form-section" data-schedule><h3>תאריכים ושעות *</h3>
    <fieldset class="sale-kind-picker"><legend>משך המכירה</legend><div>${[['single', 'יום אחד'], ['range', 'טווח ימים']].map(([value, label]) => `<label class="choice-option"><input type="radio" name="dateMode" value="${value}"${(range ? 'range' : 'single') === value ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div></fieldset>
    <fieldset class="schedule-panel" data-date-mode="single"><div class="single-date-fields">${field('תאריך המכירה', 'singleDate', first.date, 'date', true)}${field('פתיחה', 'singleOpen', first.open, 'time', true)}${field('סגירה', 'singleClose', first.close, 'time', true)}</div></fieldset>
    <fieldset class="schedule-panel" data-date-mode="range"><fieldset class="schedule-panel" data-range-fields><div class="repeater-row date-range">${field('מתאריך', 'rangeStart', first.date, 'date', true)}${field('עד תאריך', 'rangeEnd', sorted.at(-1).date, 'date', true)}${field('פתיחה', 'rangeOpen', first.open, 'time', true)}${field('סגירה', 'rangeClose', first.close, 'time', true)}</div></fieldset>
    <label class="choice-option"><input type="checkbox" data-custom-days${custom ? ' checked' : ''}><span>עריכת ימים ושעות בנפרד</span></label>
    <fieldset class="schedule-panel" data-day-editor><div id="day-rows">${days.map(dayRow).join('')}</div><button type="button" class="secondary" data-action="add-day">יום נוסף</button></fieldset></fieldset></section>`;
}
function updateSchedule(form) {
  const mode = form.elements.dateMode.value;
  form.querySelectorAll('[data-date-mode]').forEach(panel => {
    panel.hidden = panel.dataset.dateMode !== mode;
    panel.disabled = panel.hidden;
  });
  const custom = form.querySelector('[data-custom-days]').checked;
  form.querySelector('[data-range-fields]').disabled = custom;
  const editor = form.querySelector('[data-day-editor]');
  editor.hidden = !custom;
  editor.disabled = !custom;
}
function scheduleDays(form) {
  const value = name => form.querySelector(`[name="${name}"]`).value;
  const dateValue = name => formDate(value(name));
  if (form.elements.dateMode.value === 'single') return saleDateRange(dateValue('singleDate'), dateValue('singleDate'), value('singleOpen'), value('singleClose'));
  if (!form.querySelector('[data-custom-days]').checked) return saleDateRange(dateValue('rangeStart'), dateValue('rangeEnd'), value('rangeOpen'), value('rangeClose'));
  const days = [...form.querySelectorAll('.day-row')].map(row => ({ date: formDate(row.querySelector('[name=date]').value), open: row.querySelector('[name=open]').value, close: row.querySelector('[name=close]').value }));
  if (!days.length) throw new Error('יש להוסיף לפחות יום מכירה אחד.');
  return days;
}
function updateSaleStores(form) {
  const inputs = [...form.querySelectorAll('[name=storeId]')];
  const selected = inputs.filter(input => input.checked);
  for (const input of inputs) {
    form.querySelector(`[data-store-row="${input.value}"]`).hidden = !input.checked;
  }
  const caption = form.querySelector('[data-store-caption]');
  caption.textContent = selected.length
    ? selected.map(input => input.dataset.storeName).join(', ')
    : caption.dataset.placeholder;
  form.querySelector('[data-store-results]').textContent = selected.length
    ? `${selected.length} ${selected.length === 1 ? 'חנות נבחרה' : 'חנויות נבחרו'}`
    : 'עדיין לא נבחרה חנות';
}
function syncOverallOutlet(form) {
  const checked = form.elements.isOutlet.checked;
  form.querySelectorAll('[name^="outlet-"]').forEach(input => { input.checked = checked; });
}
function updateSaleKind(form) {
  const kind = form.elements.saleKind.value;
  const stores = [...form.querySelectorAll('[name=storeId]')];
  const checked = stores.filter(input => input.checked).map(input => input.value);
  if (form.dataset.saleKind === 'shared') form.dataset.sharedStores = JSON.stringify(checked);
  const selected = kind === 'shared' && form.dataset.saleKind === 'single'
    ? [...new Set([...JSON.parse(form.dataset.sharedStores || '[]'), ...checked])] : checked;
  stores.forEach(input => { input.checked = false; });
  stores.forEach(input => {
    input.type = kind === 'single' ? 'radio' : 'checkbox';
    input.required = kind === 'single';
    input.checked = kind === 'single' ? input.value === checked[0] : selected.includes(input.value);
  });
  form.dataset.saleKind = kind;
  const details = form.querySelector('[data-sale-details]');
  details.hidden = !kind;
  details.disabled = !kind;
  form.querySelector('[data-sale-title]').hidden = kind !== 'shared';
  form.elements.title.disabled = kind !== 'shared';
  form.elements.title.required = kind === 'shared';
  const overallOutlet = form.querySelector('[data-sale-outlet]');
  overallOutlet.hidden = kind !== 'shared';
  overallOutlet.querySelector('input').disabled = kind !== 'shared';
  if (kind !== 'shared') overallOutlet.querySelector('input').checked = false;
  else if (overallOutlet.querySelector('input').checked) syncOverallOutlet(form);
  form.querySelector('[data-store-heading]').textContent = kind === 'single' ? 'בחירת החנות *' : 'חנויות משתתפות *';
  form.querySelector('[data-store-hint]').textContent = kind === 'single'
    ? 'בחרי חנות אחת. המכירה תוצג לפי הלוגו או השם שלה, ללא צורך בשם נוסף למכירה.'
    : 'בחרי לפחות שתי חנויות. אם כולן אאוטלט, סמני זאת מעל הרשימה והסימון יוחל על כולן. לכל חנות אפשר לבחור גם תשלום, תיאור ומודעה משלה.';
  form.querySelectorAll('[data-store-description-field]').forEach(field => {
    field.hidden = kind !== 'shared';
    field.querySelector('textarea').disabled = kind !== 'shared';
  });
  const storeCaption = form.querySelector('[data-store-caption]');
  storeCaption.dataset.placeholder = kind === 'single' ? 'בחירת חנות' : 'בחירת חנויות';
  form.querySelector('[data-store-search]').value = '';
  form.querySelectorAll('[data-store-option]').forEach(option => { option.hidden = false; });
  form.querySelector('[type=submit]').hidden = !kind;
  updateSaleStores(form);
  updateSubmit(form);
}
function editor(type, id, config = {}) {
  const item = config.prefill || state.data[type].find(x => x.id === id) || {};
  const names = { stores: 'חנות', venues: 'אולם', sales: 'מכירה' };
  let content;
  if (type === 'stores') {
    content = `<div class="form-grid">${field('שם החנות', 'name', item.name, 'text', true, 'maxlength="150"')}${field('טלפון', 'phone', item.phone, 'tel')}${field('אתר החנות', 'website', item.website, 'url', false, 'placeholder="https://..."')}${field('קישור לקטלוג', 'catalog', item.catalog, 'url', false, 'placeholder="https://..."')}<div class="full">${choicePicker('קטגוריות החנות', 'categories', CATEGORY_OPTIONS, item.categories || [], 'בחירת קטגוריות')}</div></div><div class="form-section"><h3>כתובות קבועות וזמני פתיחה (לא חובה)</h3><div id="address-rows">${(item.addresses || []).map(addressRow).join('')}</div><button type="button" class="secondary" data-action="add-address">כתובת נוספת</button></div>`;
    content += `<section class="form-section"><h3>לוגו החנות (לא חובה)</h3><div class="logo-upload"><div id="logo-preview" aria-live="polite">${storeLogo(item) || '<span class="hint">לא הועלה לוגו</span>'}</div><div><label class="field">העלאת לוגו<input type="file" id="logo-file" accept="image/png,image/jpeg,image/webp" aria-describedby="logo-hint"></label><p class="hint" id="logo-hint">PNG, JPG או WebP, עד 5MB. התמונה תוקטן אוטומטית בלי חיתוך ותישמר רק בלחיצה על שמירה.</p><button type="button" class="secondary" data-action="remove-logo">הסרת הלוגו</button></div></div><input type="hidden" name="logo" value="${esc(item.logo || '')}"></section>`;
  } else if (type === 'venues') {
    const legacy = Boolean(item.address && !item.street);
    content = `<div class="form-grid">${field('שם האולם', 'name', item.name, 'text', true, 'maxlength="150"')}${cityField('עיר', 'city', item.city)}${streetField(item, legacy)}${field('מספר בניין (אם יש)', 'buildingNumber', item.buildingNumber, 'text', false, 'maxlength="30"')}${legacy ? `<div class="full" data-legacy-address>${field('כתובת קיימת — נשמרת עד לבחירת רחוב מהרשימה', 'address', item.address, 'text', true, 'maxlength="300"')}</div>` : ''}${field('כניסה מסוימת / קומה (אם יש)', 'entrance', item.entrance, 'text', false, 'maxlength="200"')}${field('טלפון (לא חובה)', 'phone', item.phone, 'tel')}<label class="field">האם האולם נגיש לאנשים עם מוגבלות?<select name="accessibility">${[['unknown', 'לא נמסר'], ['yes', 'כן, האולם נגיש'], ['no', 'לא, האולם אינו נגיש']].map(([value, label]) => `<option value="${value}"${(item.accessibility || 'unknown') === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label class="field full">הערות הגעה (אם יש)<textarea name="arrivalNotes" maxlength="2000" rows="3">${esc(item.arrivalNotes || '')}</textarea></label></div>`;
  } else {
    if (!state.data.stores.length || !state.data.venues.length) {
      openDialog('לפני שמוסיפים מכירה', '<p>יש להוסיף לפחות חנות אחת ואולם אחד במסך הניהול לפני יצירת מכירה.</p>');
      return;
    }
    content = `<div data-sale-outlet>${outletCheckbox('isOutlet', item.isOutlet, 'כל המכירה היא מכירת אאוטלט')}<p class="hint">אם רק חנות מסוימת מוכרת אאוטלט, סמני זאת בפרטי החנות המשתתפת ולא כאן.</p></div><div class="form-grid">${field('שם המכירה', 'title', item.title, 'text', true, 'maxlength="180"')}${venueField(String(item.venueId || ''))}<div class="full">${choicePicker('קטגוריות המכירה', 'categories', CATEGORY_OPTIONS, item.categories || [], 'בחירת קטגוריות')}<p class="hint">אפשר לבחור כמה קטגוריות. בנוסף יוצגו גם קטגוריות החנויות המשתתפות.</p></div><div class="full">${choicePicker('למי מיועדים המוצרים במכירה', 'audiences', AUDIENCE_OPTIONS, item.audiences || [], 'בחירת קהלי יעד')}<p class="hint">אפשר לבחור כמה קהלי יעד. השדה אינו חובה.</p></div><label class="field full">תיאור המכירה<textarea name="description" maxlength="4000" placeholder="מה מוצע במכירה, למי היא מתאימה ומה כדאי לדעת?">${esc(item.description || '')}</textarea></label><label class="field full">הערות מיוחדות<textarea name="notes" maxlength="4000">${esc(item.notes || '')}</textarea></label></div>
      <section class="form-section" data-sale-stores><h3 data-store-heading>חנויות משתתפות *</h3><p class="hint" data-store-hint>בחרי את החנויות המשתתפות.</p><details class="multi-picker store-picker"><summary><span data-store-caption data-placeholder="בחירת חנות">בחירת חנות</span></summary><div class="picker-search"><input type="search" data-store-search aria-label="חיפוש חנות ברשימה" placeholder="הקלידי שם חנות לחיפוש" autocomplete="off"></div><div class="store-picker-options">${state.data.stores.map(s => {
        const linked = item.stores?.find(x => x.storeId === s.id);
        return `<label class="choice-option" data-store-option><input type="checkbox" name="storeId" value="${s.id}" data-store-name="${esc(s.name)}"${linked ? ' checked' : ''}><span>${esc(s.name)}</span></label>`;
      }).join('')}</div><p class="picker-results" data-store-results role="status"></p></details><div class="store-details-list">${state.data.stores.map(s => {
        const linked = item.stores?.find(x => x.storeId === s.id);
        return `<section class="store-participation" data-store-row="${s.id}"${linked ? '' : ' hidden'}><h4>${esc(s.name)}</h4><div class="store-fields">${outletCheckbox(`outlet-${s.id}`, linked?.isOutlet, 'החנות מוכרת אאוטלט במכירה זו')}${choicePicker(`אפשרויות תשלום עבור ${s.name}`, `payment-${s.id}`, PAYMENT_OPTIONS, paymentChoices(linked?.payment || item.payment), 'בחירת אמצעי תשלום')}<label class="field" data-store-description-field>תיאור המכירה של ${esc(s.name)}<textarea data-store-description maxlength="4000">${esc(linked?.description || '')}</textarea></label><label class="field">מודעת פרסומת עבור ${esc(s.name)} (לא חובה)<input type="file" data-poster-file accept="image/png,image/jpeg,image/webp"></label><p class="hint">תמונה עד 5MB, תוקטן לעד 1600 פיקסלים ללא חיתוך. תופיע רק בפרטי המכירה הזאת.</p><div data-poster-preview>${posterPreview(linked?.posterId)}</div><input type="hidden" data-poster-id value="${esc(linked?.posterId || '')}"><input type="hidden" data-poster-image value=""><button type="button" class="secondary" data-action="remove-poster">הסרת המודעה</button><div class="error" data-poster-error role="alert"></div></div></section>`;
      }).join('')}</div></section>
      ${schedulePicker(item.days)}`;
  }
  if (type === 'sales') {
    const kind = item.stores ? item.stores.length > 1 ? 'shared' : 'single' : '';
    content = `<fieldset class="sale-kind-picker"><legend>איזו מכירה תרצי לפרסם?</legend><div>${[['single', 'מכירה של חנות אחת'], ['shared', 'מכירה משותפת']].map(([value, label]) => `<label class="choice-option"><input type="radio" name="saleKind" value="${value}"${kind === value ? ' checked' : ''} required><span>${label}</span></label>`).join('')}</div></fieldset><fieldset class="sale-details" data-sale-details${kind ? '' : ' hidden disabled'}>${content}</fieldset>`;
  }
  openDialog(`${config.duplicate ? 'שכפול' : id ? 'עריכת' : 'הוספת'} ${names[type]}`, `<form id="entity-form" data-type="${type}" data-id="${id || ''}" data-submission-id="${config.submissionId || ''}" data-review-id="${config.reviewId || ''}" data-review-store="${config.storeIndex ?? ''}">${config.duplicate ? '<p class="admin-notice">זוהי מכירה חדשה. פרטי המקור הועתקו, אך התאריכים וסטטוס הביטול אופסו. בחרי תאריכים חדשים לפני השמירה; המקור לא ישתנה.</p>' : ''}${config.submissionId ? '<p class="admin-notice">טיוטה מבקשה לפרסום — בדקי את הפרטים. רק לחיצה על אישור ופרסום תפרסם את המכירה ותסמן את הבקשה כמאושרת.</p>' : ''}${content}<div class="error" id="form-error" role="alert"></div><div class="form-actions"><button type="button" class="secondary" data-action="${config.reviewId || config.submissionId ? 'review-submission' : 'close'}" data-id="${config.reviewId || config.submissionId || ''}">${config.reviewId || config.submissionId ? 'חזרה לבקשה' : 'ביטול'}</button><button type="submit" class="primary">${config.submissionId ? 'אישור ופרסום המכירה' : 'שמירה'}</button></div></form>`);
  if (type === 'sales') {
    const form = dialogContent.querySelector('#entity-form');
    form.elements.title.closest('label').setAttribute('data-sale-title', '');
    form.elements.title.closest('label').classList.add('full');
    const storesSection = form.querySelector('[data-sale-stores]');
    storesSection.prepend(form.querySelector('[data-sale-outlet]'));
    form.querySelector('[data-sale-details]').prepend(storesSection);
    if (id && !config.duplicate && !config.submissionId) {
      form.querySelector('[data-sale-details]').insertAdjacentHTML('afterbegin', `<section class="form-section"><h3>סטטוס והודעה לגולשות</h3><p class="hint">השדות האלה מיועדים לעדכון מכירה שכבר פורסמה. ביצירת מכירה חדשה אין צורך למלא אותם.</p><label class="field">סטטוס המכירה<select name="status">${SALE_STATUSES.map(([value, label]) => `<option value="${value}"${(item.status || 'scheduled') === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label class="field">הודעת שינוי / סיבת ביטול או דחייה<textarea name="statusNote" maxlength="2000"${item.status && item.status !== 'scheduled' ? ' required' : ''} placeholder="לדוגמה: השעות השתנו ל־12:00–20:00, או שהמכירה נדחתה לתאריך חדש.">${esc(item.statusNote || '')}</textarea></label><p class="hint">בחרי "השתנו הפרטים / השעות" אם עדכנת תאריך, שעה, אולם או פרט חשוב אחר, וכתבי כאן מה השתנה. בביטול או דחייה חובה להסביר לגולשות. כשנקבע מועד חדש לאחר דחייה, עדכני גם את התאריכים.</p></section>`);
    }
    if ((id || config.duplicate) && item.stores.length === 1) {
      form.dataset.originalStoreId = String(item.stores[0].storeId);
      form.dataset.originalTitle = item.title;
    }
    updateSaleKind(form);
    updateSchedule(form);
  }
  if (type === 'venues') void loadVenueStreets(dialogContent.querySelector('#entity-form'), item.street || '');
  if (type === 'stores') dialogContent.querySelectorAll('.address-row').forEach(row => void loadVenueStreets(row, row.querySelector('[name=street]').value));
}
function formEntity(form) {
  const values = new FormData(form);
  const value = key => values.get(key) || '';
  if (form.dataset.type === 'stores') return {
    name: value('name'), phone: value('phone'), website: value('website'), catalog: value('catalog'), logo: value('logo'),
    categories: values.getAll('categories'), addresses: [...form.querySelectorAll('.address-row')].map(row => ({
      address: row.querySelector('[name=address]')?.value || '', city: row.querySelector('[name=city]').value,
      street: row.querySelector('[name=street]').value, buildingNumber: row.querySelector('[name=buildingNumber]').value,
      arrivalNotes: row.querySelector('[name=arrivalNotes]').value, hours: row.querySelector('[name=hours]').value, weeklyHours: readWeek(row),
    })),
  };
  if (form.dataset.type === 'venues') return {
    name: value('name'), city: value('city'), address: value('street') ? [value('street'), value('buildingNumber')].filter(Boolean).join(' ') : value('address'),
    street: value('street'), buildingNumber: value('buildingNumber'), entrance: value('entrance'), arrivalNotes: value('arrivalNotes'),
    accessibility: value('accessibility'), phone: value('phone'),
  };
  return {
    title: value('saleKind') === 'single'
      ? form.dataset.originalStoreId === value('storeId') ? form.dataset.originalTitle : storeById(Number(value('storeId')))?.name || ''
      : value('title'),
    venueId: Number(value('venueId')), isOutlet: values.has('isOutlet'), notes: value('notes'), description: value('description'), payment: '', categories: values.getAll('categories'), audiences: values.getAll('audiences'),
    status: value('status') || 'scheduled', statusNote: value('statusNote'),
    stores: values.getAll('storeId').map(id => {
      const row = form.querySelector(`[data-store-row="${id}"]`);
      return { storeId: Number(id), isOutlet: values.has(`outlet-${id}`), payment: values.getAll(`payment-${id}`).join(', '), description: row.querySelector('[data-store-description]').value, posterId: row.querySelector('[data-poster-id]').value };
    }),
    days: scheduleDays(form),
  };
}
function downloadCalendar(sale) {
  if (sale.status === 'postponed') { toast('המכירה נדחתה ועדיין לא נקבע מועד חדש להוספה ליומן.'); return; }
  const escapeICS = value => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const venue = venueById(sale.venueId);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Yom Mechira//HE', 'CALSCALE:GREGORIAN',
    ...sale.days.flatMap(d => ['BEGIN:VEVENT', `UID:sale-${sale.id}-${d.date}@${location.host}`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Jerusalem:${d.date.replaceAll('-', '')}T${d.open.replace(':', '')}00`,
      `DTEND;TZID=Asia/Jerusalem:${d.date.replaceAll('-', '')}T${d.close.replace(':', '')}00`,
      `STATUS:${sale.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
      `SUMMARY:${escapeICS(sale.title)}`, `LOCATION:${escapeICS(`${venue.name}, ${venue.address}, ${venue.city}`)}`,
      `DESCRIPTION:${escapeICS(`${sale.statusNote || ''}\n${sale.description || ''}\n${outletLabel(sale)}\n${sale.audiences?.length ? `קהל יעד: ${sale.audiences.join(', ')}\n` : ''}${sale.notes}\n${venue.entrance || ''}\n${venue.arrivalNotes || ''}\n${accessibilityLabel(venue)}\n${location.origin}/#sale/${sale.id}`)}`, 'END:VEVENT']),
    'END:VCALENDAR'];
  const encoder = new TextEncoder();
  const folded = lines.map(line => {
    let output = '', bytes = 0;
    for (const character of line) {
      const length = encoder.encode(character).length;
      if (bytes + length > 75) { output += '\r\n '; bytes = 1; }
      output += character;
      bytes += length;
    }
    return output;
  }).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([folded], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `sale-${sale.id}.ics`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function render() {
  if (dialog.open) dialog.close();
  const route = location.hash.slice(1) || 'today';
  state.view = route.split('/')[0];
  document.querySelectorAll('[data-tab]').forEach(a => {
    const active = a.dataset.tab === state.view || (state.view === 'store' && a.dataset.tab === 'stores');
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (state.view === 'calendar') {
    const accountCity = state.account.authenticated ? state.account.profile?.city : '';
    if (accountCity) {
      state.filters.city = accountCity;
      if (venueById(Number(state.filters.venue))?.city !== accountCity) state.filters.venue = '';
    }
    state.month = currentMonth();
    calendarPage();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }
  else if (state.view === 'stores') storesPage();
  else if (state.view === 'favorites') {
    location.hash = 'account/favorites';
    return;
  }
  else if (state.view === 'account') accountPage();
  else if (state.view === 'store') {
    storePage(Number(route.split('/')[1]));
    main.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }
  else if (state.view === 'admin') adminPage();
  else if (state.view === 'submit') submissionPage();
  else if (state.view === 'contact') contactPage();
  else {
    state.view = 'today';
    todayPage();
    if (route.startsWith('sale/')) {
      const id = Number(route.split('/')[1]);
      if (state.data.sales.some(s => s.id === id)) openSale(id);
      else toast('המכירה לא נמצאה');
    }
  }
}
document.addEventListener('input', event => {
  const editedSale = event.target.closest('#entity-form[data-type="sales"]');
  if (editedSale && !event.target.matches('[type=search]')) editedSale.dataset.dirty = 'true';
  if (event.target.closest('[data-weekday]')) { updateWeekDay(event.target.closest('[data-weekday]')); return; }
  if (event.target.matches('[data-email-input]')) {
    updateEmailSuggestions(event.target);
    return;
  }
  if (event.target.matches('[data-date-input]')) {
    const formatted = formatDateInput(event.target.value, !event.inputType?.startsWith('delete'));
    if (event.target.value !== formatted) event.target.value = formatted;
    const preview = event.target.closest('.field').querySelector('.date-preview');
    const validation = event.target.closest('.field').querySelector('.field-validation');
    const message = event.target.value ? dateInputError(event.target) : '';
    event.target.setCustomValidity(message);
    validation.textContent = message;
    if (!event.target.value) {
      preview.innerHTML = '';
      return;
    }
    preview.innerHTML = message ? '' : dateInputPreview(parseDisplayDate(event.target.value));
    return;
  }
  if (event.target.matches('[data-store-search]')) {
    const picker = event.target.closest('.store-picker');
    const query = event.target.value.trim().toLocaleLowerCase('he');
    const options = [...picker.querySelectorAll('[data-store-option]')];
    let matches = 0;
    for (const option of options) {
      const match = option.textContent.toLocaleLowerCase('he').includes(query);
      option.hidden = !match && !option.querySelector('[name=storeId]').checked;
      if (match) matches++;
    }
    picker.querySelector('[data-store-results]').textContent = matches
      ? `${matches} חנויות ברשימה` : 'לא נמצאו חנויות בחיפוש';
    return;
  }
  if (event.target.matches('[data-option-search]')) {
    const picker = event.target.closest('.multi-picker');
    const query = event.target.value.trim().toLocaleLowerCase('he');
    const select = picker.querySelector('select');
    const items = [...picker.querySelectorAll(select ? 'option[value]:not([value=""])' : '.choice-option')];
    let matches = 0;
    for (const item of items) {
      const match = item.textContent.toLocaleLowerCase('he').includes(query);
      item.hidden = !match && !(select && item.selected);
      if (match) matches++;
    }
    picker.querySelector('[data-option-results]').textContent = matches ? `${matches} אפשרויות ברשימה` : 'לא נמצאו תוצאות לחיפוש הזה';
    return;
  }
  if (event.target.matches('[data-city-search]')) {
    const picker = event.target.closest('.city-picker');
    const select = picker.querySelector('[data-city-select]');
    const selected = select.value;
    const query = event.target.value.trim();
    const cities = availableCities(selected, query);
    select.innerHTML = options(cities.map(city => [city, city]), selected, select.dataset.filter ? 'כל הערים' : 'בחירת עיר או יישוב');
    const status = picker.querySelector('[data-city-results]');
    const matches = cities.filter(city => city.includes(query)).length;
    if (status) status.textContent = matches ? `${matches} ערים ויישובים לפי א׳–ב׳` : 'לא נמצאו ערים או יישובים לחיפוש הזה';
    return;
  }
  const key = event.target.dataset.filter;
  if (!key) return;
  const scope = event.target.closest('[data-filter-scope]').dataset.filterScope;
  if (scope === 'admin') {
    state.adminSaleFilters[key] = event.target.value;
    if (key === 'city') {
      if (state.adminSaleFilters.city && venueById(Number(state.adminSaleFilters.venue))?.city !== state.adminSaleFilters.city) state.adminSaleFilters.venue = '';
      main.querySelector('[data-filter-scope="admin"]').outerHTML = adminSalesToolbar();
    }
    main.querySelector('#admin-results').innerHTML = adminResults();
    return;
  }
  const filters = scope === 'day' ? state.dayFilters : state.filters;
  filters[key] = event.target.value;
  const picker = event.target.closest('.filter-dropdown');
  if (picker) picker.querySelector('[data-filter-caption]').textContent = event.target.selectedOptions[0].textContent;
  if (scope === 'day') updateDay(); else updateResults();
});
async function prepareImage(file, poster = false) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('יש לבחור קובץ PNG, JPG או WebP');
  if (file.size > 5 * 1024 * 1024) throw new Error('קובץ התמונה גדול מ־5MB. בחרי תמונה קטנה יותר.');
  let image;
  try { image = await createImageBitmap(file); }
  catch { throw new Error('לא ניתן לקרוא את התמונה. בחרי קובץ תמונה תקין.'); }
  try {
    const dimension = poster ? 1600 : 320;
    const scale = Math.min(1, dimension / image.width, dimension / image.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('הדפדפן אינו מאפשר לעבד את התמונה');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/webp', 0.85);
    if (result.length > Math.ceil((poster ? 768_000 : 153_600) / 3) * 4 + 23) throw new Error('התמונה גדולה מדי גם לאחר הקטנה. בחרי תמונה פשוטה או קטנה יותר.');
    return result;
  } finally { image.close(); }
}
const pendingImages = new WeakMap();
function pendingFor(form) {
  if (!pendingImages.has(form)) pendingImages.set(form, new Set());
  return pendingImages.get(form);
}
function updateSubmit(form) {
  form.querySelector('[type=submit]').disabled = pendingFor(form).size > 0 || form.dataset.saving === 'true' || form.dataset.loadingStreets === 'true' || Boolean(form.querySelector('[data-loading-streets="true"]'))
    || (form.dataset.type === 'sales' && !form.elements.saleKind.value);
}
function cancelImage(input) {
  input.dataset.imageRequest = String(Number(input.dataset.imageRequest || 0) + 1);
  input.value = '';
  const form = input.closest('form');
  pendingFor(form).delete(input);
  updateSubmit(form);
}
document.addEventListener('change', async event => {
  const input = event.target;
  const editedSale = input.closest('#entity-form[data-type="sales"]');
  if (editedSale) editedSale.dataset.dirty = 'true';
  if (input.name === 'dateMode') { updateSchedule(input.closest('form')); return; }
  if (input.matches('[data-custom-days]')) {
    const form = input.closest('form');
    if (input.checked) {
      try {
        const days = saleDateRange(formDate(form.elements.rangeStart.value), formDate(form.elements.rangeEnd.value), form.elements.rangeOpen.value, form.elements.rangeClose.value);
        form.querySelector('#day-rows').innerHTML = days.map(dayRow).join('');
      } catch (error) { input.checked = false; toast(error.message); }
    } else if (!confirm('לעבור לשעות אחידות לכל הטווח במקום עריכת ימים בנפרד?')) input.checked = true;
    updateSchedule(form);
    return;
  }
  if (input.closest('[data-weekday]')) { updateWeekDay(input.closest('[data-weekday]')); return; }
  if (input.name === 'status') {
    input.closest('form').elements.statusNote.required = input.value !== 'scheduled';
    return;
  }
  if (input.name === 'isOutlet' && input.closest('#entity-form[data-type="sales"]')) {
    syncOverallOutlet(input.closest('form'));
    return;
  }
  if (input.name === 'saleKind') { updateSaleKind(input.closest('form')); return; }
  if (input.matches('.filter-dropdown select')) {
    const picker = input.closest('.filter-dropdown');
    picker.querySelector('[data-filter-caption]').textContent = input.selectedOptions[0].textContent;
    picker.open = false;
    picker.querySelector('summary').focus();
  }
  if (input.matches('input[type=checkbox]:not([name=storeId])') && input.closest('.multi-picker')) {
    const picker = input.closest('.multi-picker');
    const caption = picker.querySelector('[data-choice-caption]');
    const selected = [...picker.querySelectorAll('input:checked')].map(option => option.value);
    caption.textContent = selected.length ? selected.join(', ') : caption.dataset.placeholder;
    return;
  }
  if (input.name === 'city' && (input.closest('.address-row') || input.closest('#entity-form')?.dataset.type === 'venues')) {
    const form = input.closest('form');
    const scope = input.closest('.address-row') || form;
    scope.querySelector('[name=street]').required = true;
    input.required = true;
    scope.querySelector('[name=buildingNumber]').value = '';
    const legacy = scope.querySelector('[data-legacy-address]');
    if (legacy) {
      legacy.hidden = true;
      scope.querySelector('[name=address]').value = '';
      scope.querySelector('[name=address]').required = false;
    }
    await loadVenueStreets(scope);
    return;
  }
  if (input.name === 'street') {
    const scope = input.closest('.address-row') || input.closest('form');
    const legacy = scope.querySelector('[data-legacy-address]');
    if (legacy) {
      legacy.hidden = Boolean(input.value);
      scope.querySelector('[name=address]').required = !input.value && !input.required;
    }
    return;
  }
  if (input.name === 'storeId') {
    const form = input.closest('form');
    updateSaleStores(form);
    if (form.elements.saleKind.value === 'single' && input.checked) {
      const picker = input.closest('.store-picker');
      picker.open = false;
      picker.querySelector('summary').focus();
    }
    return;
  }
  const submissionPoster = input.matches('[data-submission-file]');
  const poster = input.matches('[data-poster-file]') || submissionPoster;
  if (input.id !== 'logo-file' && !poster) return;
  const form = input.closest('form');
  const target = poster && !submissionPoster ? input.closest('[data-store-row]') : form;
  const file = input.files[0];
  const request = String(Number(input.dataset.imageRequest || 0) + 1);
  input.dataset.imageRequest = request;
  const error = target.querySelector(poster && !submissionPoster ? '[data-poster-error]' : '#form-error');
  if (!file) { pendingFor(form).delete(input); updateSubmit(form); return; }
  pendingFor(form).add(input);
  updateSubmit(form);
  error.textContent = '';
  const isCurrent = () => form.isConnected && input.dataset.imageRequest === request;
  try {
    const image = await prepareImage(file, poster);
    if (!isCurrent()) return;
    if (submissionPoster) {
      form.elements.poster.value = image;
      form.querySelector('[data-submission-preview]').innerHTML = posterPreview('', image);
    } else if (poster) {
      target.querySelector('[data-poster-image]').value = image;
      target.querySelector('[data-poster-preview]').innerHTML = posterPreview('', image);
    } else {
      form.elements.logo.value = image;
      form.querySelector('#logo-preview').innerHTML = storeLogo({ logo: image });
    }
  } catch (failure) {
    if (isCurrent()) error.textContent = failure.message;
  } finally {
    if (isCurrent()) { pendingFor(form).delete(input); updateSubmit(form); }
  }
});
document.addEventListener('click', async event => {
  document.querySelectorAll('.filter-dropdown[open]').forEach(picker => {
    if (!picker.contains(event.target)) picker.open = false;
  });
  document.querySelectorAll('.email-suggestions:not([hidden])').forEach(suggestions => {
    if (!suggestions.closest('.field').contains(event.target)) suggestions.hidden = true;
  });
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id, type, scope } = button.dataset;
  if (action === 'email-suggestion') {
    const input = button.closest('.field').querySelector('[data-email-input]');
    input.value = button.dataset.value;
    button.parentElement.hidden = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    return;
  }
  if (['remove-poster', 'add-day', 'remove-row'].includes(action)) {
    const editedSale = button.closest('#entity-form[data-type="sales"]');
    if (editedSale) editedSale.dataset.dirty = 'true';
  }
  if (action === 'favorite') {
    const parentDialog = button.closest('dialog');
    const previous = { sales: [...state.favorites.sales], stores: [...state.favorites.stores] };
    try {
      state.favorites = toggleFavorite(window.localStorage, type, Number(id));
      if (state.account.authenticated) state.favorites = await api('user/favorites', 'PUT', state.favorites);
      state.favoritesError = '';
    } catch (error) {
      console.error('Could not save favorites', error);
      state.favorites = previous;
      try { writeFavorites(window.localStorage, previous); } catch (rollbackError) { console.error('Could not restore local favorites', rollbackError); }
      state.favoritesError = favoritesFailure;
      if (state.view === 'favorites') favoritesPage();
      toast(favoritesFailure);
      return;
    }
    const selected = state.favorites[type].includes(Number(id));
    if (state.view === 'favorites') favoritesPage();
    refreshFavoriteButtons();
    const replacement = [...document.querySelectorAll('[data-action="favorite"]')].find(element => element.dataset.type === type && element.dataset.id === id && element.closest('dialog') === parentDialog);
    (replacement || parentDialog?.querySelector('[data-action="close"]') || main).focus({ preventScroll: true });
    toast(selected ? 'נוסף למועדפים שלך' : 'הוסר מהמועדפים שלך');
    return;
  }
  if (action === 'reload-streets') {
    const scope = button.closest('.address-row') || button.closest('form');
    return loadVenueStreets(scope, scope.querySelector('[name=street]').value);
  }
  if (action === 'close') return requestDialogClose();
  if (action === 'open-account') {
    dialog.close();
    location.hash = 'account';
    return;
  }
  if (action === 'account-login') { state.accountMode = 'login'; accountPage(); return; }
  if (action === 'account-demo') {
    state.accountDemo = true;
    updateAccountLink();
    accountPage();
    return;
  }
  if (action === 'account-demo-exit') {
    state.accountDemo = false;
    state.accountMode = 'login';
    updateAccountLink();
    location.hash = 'account';
    accountPage();
    return;
  }
  if (action === 'account-register') { state.accountMode = 'register'; accountPage(); return; }
  if (action === 'edit-profile') { state.accountMode = 'edit-profile'; accountPage(); return; }
  if (action === 'cancel-profile') { state.accountMode = 'login'; accountPage(); return; }
  if (action === 'sale') return openSale(Number(id));
  if (action === 'store') {
    if (dialog.open) dialog.close();
    location.hash = `store/${id}`;
    return;
  }
  if (action === 'day') return openDay(button.dataset.date);
  if (action === 'calendar-mode') {
    state.calendarMode = button.dataset.mode;
    updateCalendar();
    main.querySelector(`[data-action="calendar-mode"][data-mode="${state.calendarMode}"]`).focus({ preventScroll: true });
    return;
  }
  if (action === 'clear-filters') {
    if (scope === 'admin') {
      Object.keys(state.adminSaleFilters).forEach(key => { state.adminSaleFilters[key] = ''; });
      adminPage();
      return;
    }
    const filters = scope === 'day' ? state.dayFilters : state.filters;
    Object.keys(filters).forEach(key => { filters[key] = ''; });
    if (scope === 'day') {
      openDialog(dateLabel(state.selectedDay), `${filterToolbar(state.dayFilters, 'day')}<div id="day-results"></div>`);
      updateDay();
    }
    else if (state.view === 'calendar') calendarPage();
    else if (state.view === 'stores') storesPage(); else todayPage();
    return;
  }
  if (['open-message', 'unread-message', 'refresh-messages'].includes(action)) {
    button.disabled = true;
    try {
      if (action === 'refresh-messages') {
        state.messages = await api('messages');
        adminPage();
        toast('רשימת ההודעות עודכנה');
        return;
      }
      const item = state.messages.find(item => item.id === Number(id));
      if (!item) throw new Error('ההודעה לא נמצאה. יש לרענן את רשימת ההודעות.');
      const read = action === 'open-message';
      if (item.read !== read) {
        await api(`messages/${item.id}`, 'PATCH', { read });
        item.read = read;
      }
      adminPage();
      if (!read) { dialog.close(); toast('ההודעה סומנה כלא נקראה'); return; }
      openDialog(item.subject, `<p><strong>${esc(item.name)}</strong> · ${esc(messageDate(item.created))}</p>${item.email ? `<p>דוא״ל: <bdi>${esc(item.email)}</bdi></p>` : ''}${item.phone ? `<p>טלפון: ${phoneLink(item.phone)}</p>` : ''}<p class="pre-wrap contact-message">${esc(item.message)}</p><div class="form-actions"><button type="button" class="secondary" data-action="unread-message" data-id="${item.id}">סימון כלא נקראה</button></div>`);
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
    return;
  }
  if (action === 'month' || action === 'month-today') {
    if (action === 'month') state.month.setMonth(state.month.getMonth() + Number(button.dataset.offset));
    else state.month = currentMonth();
    return updateCalendar();
  }
  if (action === 'admin-type') { state.adminType = type; return adminPage(); }
  if (action === 'add' || action === 'edit') return editor(type, Number(id) || undefined);
  if (action === 'duplicate-sale') {
    const sale = state.data.sales.find(sale => sale.id === Number(id));
    if (!sale) return toast('המכירה לשכפול לא נמצאה');
    return editor('sales', undefined, { prefill: duplicateSale(sale), duplicate: true });
  }
  if (action === 'review-submission') return reviewSubmission(Number(id));
  if (action === 'remove-submission-poster') {
    const form = button.closest('form');
    cancelImage(form.querySelector('[data-submission-file]'));
    form.elements.poster.value = '';
    form.querySelector('[data-submission-preview]').innerHTML = '';
    return;
  }
  if (['submission-create-store', 'submission-create-venue', 'submission-draft', 'reject-submission'].includes(action)) {
    const item = state.submissions.find(item => item.id === Number(id));
    if (!item || item.status !== 'pending') return toast('הבקשה כבר אינה ממתינה לאישור. יש לרענן.');
    captureReview(id);
    const links = reviewLinks.get(Number(id));
    const error = dialogContent.querySelector('#review-error');
    error.textContent = '';
    button.disabled = true;
    try {
      if (action === 'submission-create-store') return editor('stores', undefined, {
        prefill: { name: item.storeNames[Number(button.dataset.index)], categories: item.categories },
        reviewId: item.id, storeIndex: Number(button.dataset.index),
      });
      if (action === 'submission-create-venue') return editor('venues', undefined, {
        prefill: { name: item.venueName, city: item.city, address: item.address }, reviewId: item.id,
      });
      if (action === 'reject-submission') {
        if (!confirm('לדחות את הבקשה? היא תישמר בהיסטוריית הבקשות ולא תפורסם.')) return;
        await api(`submissions/${id}/reject`, 'POST', {});
        await load(); dialog.close(); adminPage(); toast('הבקשה נדחתה');
        return;
      }
      if (!links.venueId || links.stores.some(id => !id)) throw new Error('יש לקשר את כל החנויות ואת האולם לרשומות קיימות, או ליצור את הרשומות החסרות.');
      if (new Set(links.stores).size !== links.stores.length) throw new Error('אין לקשר שתי חנויות לאותה רשומה. בדקי את בחירת החנויות.');
      const posterId = item.poster ? (await api(`submissions/${id}/poster`, 'POST', {})).id : '';
      editor('sales', undefined, {
        prefill: { ...item, status: 'scheduled', statusNote: '', venueId: links.venueId, stores: links.stores.map(storeId => ({ storeId, payment: item.payment, posterId })) },
        submissionId: item.id,
      });
    } catch (failure) { error.textContent = failure.message; }
    finally { button.disabled = false; }
    return;
  }
  if (action === 'remove-logo') {
    const form = button.closest('form');
    cancelImage(form.querySelector('#logo-file'));
    form.elements.logo.value = '';
    form.querySelector('#logo-preview').innerHTML = '<span class="hint">לא הועלה לוגו</span>';
    form.querySelector('.error').textContent = '';
    return;
  }
  if (action === 'remove-poster') {
    const row = button.closest('[data-store-row]');
    cancelImage(row.querySelector('[data-poster-file]'));
    row.querySelector('[data-poster-image]').value = '';
    row.querySelector('[data-poster-id]').value = '';
    row.querySelector('[data-poster-preview]').innerHTML = posterPreview('');
    row.querySelector('[data-poster-error]').textContent = '';
    return;
  }
  if (action === 'copy-week-hours') {
    const row = button.closest('.address-row');
    let week;
    try { week = copySundayHours(readWeek(row)); }
    catch (error) { toast(error.message); return; }
    row.querySelectorAll('[data-weekday]').forEach((day, index) => {
      day.querySelector('[data-week-status]').value = week[index].status;
      day.querySelector('[data-week-open]').value = week[index].open;
      day.querySelector('[data-week-close]').value = week[index].close;
      day.querySelector('[data-week-open2]').value = week[index].open2 || '';
      day.querySelector('[data-week-close2]').value = week[index].close2 || '';
      day.dataset.secondRange = String(Boolean(week[index].open2));
      updateWeekDay(day);
    });
    toast('שעות יום ראשון הועתקו לימים א׳–ה׳. שישי ושבת לא השתנו.');
    return;
  }
  if (action === 'toggle-week-range') {
    const row = button.closest('[data-weekday]');
    row.dataset.secondRange = String(row.dataset.secondRange !== 'true');
    row.querySelector('[data-week-open2]').value = '';
    row.querySelector('[data-week-close2]').value = '';
    updateWeekDay(row);
    if (row.dataset.secondRange === 'true') row.querySelector('[data-week-open2]').focus();
    return;
  }
  if (action === 'remove-row') {
    const form = button.closest('form');
    button.closest('.repeater-row').remove();
    updateSubmit(form);
    return;
  }
  if (action === 'add-address') return document.querySelector('#address-rows').insertAdjacentHTML('beforeend', addressRow());
  if (action === 'add-day') return button.closest('form').querySelector('#day-rows').insertAdjacentHTML('beforeend', dayRow({ date: '', open: '10:00', close: '20:00' }));
  if (action === 'password') return openDialog('החלפת סיסמת ניהול', `<form id="password-form">${field('סיסמה נוכחית', 'current', '', 'password', true, 'autocomplete="current-password"')}${field('סיסמה חדשה (לפחות 12 תווים)', 'password', '', 'password', true, 'minlength="12" autocomplete="new-password"')}<p class="hint">לאחר השינוי תידרשי להתחבר מחדש בכל המכשירים.</p><div class="error" id="form-error" role="alert"></div><div class="form-actions"><button class="primary" type="submit">עדכון סיסמה</button></div></form>`);
  if (action === 'ics') return downloadCalendar(state.data.sales.find(s => s.id === Number(id)));
  try {
    if (action === 'share') {
      const url = `${location.origin}/#sale/${id}`;
      if (navigator.share) await navigator.share({ title: state.data.sales.find(s => s.id === Number(id)).title, url });
      else {
        try { await navigator.clipboard.writeText(url); toast('הקישור למכירה הועתק'); }
        catch { openDialog('קישור לשיתוף המכירה', `${field('העתיקו את הקישור', 'shareUrl', url, 'text', false, 'readonly dir="ltr"')}`); }
      }
    }
    if (action === 'logout') { await api('logout', 'POST', {}); state.authenticated = false; state.messages = []; state.submissions = []; state.subscribers = []; adminPage(); }
    if (action === 'user-logout') {
      const accountCity = state.account.profile?.city;
      await api('account/logout', 'POST', {});
      state.account = { authenticated: false };
      if (accountCity && state.filters.city === accountCity) {
        state.filters.city = '';
        state.filters.venue = '';
      }
      state.accountMode = 'login';
      updateAccountLink();
      accountPage();
      toast('יצאת מהאזור האישי');
    }
    if (action === 'delete') {
      const item = state.data[type].find(x => x.id === Number(id));
      if (!confirm(`למחוק את "${item.title || item.name}"? הפעולה אינה ניתנת לביטול.`)) return;
      await api(`${type}/${id}`, 'DELETE');
      await load(); adminPage(); toast('הרשומה נמחקה');
    }
  } catch (error) {
    if (error.name !== 'AbortError') openDialog('לא ניתן להשלים את הפעולה', errorBox(error.message));
  }
});
document.addEventListener('keydown', event => {
  const picker = event.target.closest('.filter-dropdown[open]');
  if (picker && (event.key === 'Escape' || (event.key === 'Enter' && event.target.matches('select')))) {
    event.preventDefault();
    event.stopPropagation();
    picker.open = false;
    picker.querySelector('summary').focus();
  }
});
document.addEventListener('invalid', event => {
  const picker = event.target.closest('.filter-dropdown');
  if (picker) picker.open = true;
  const storePicker = event.target.closest('.store-picker');
  if (storePicker) storePicker.open = true;
}, true);
document.addEventListener('submit', async event => {
  const form = event.target;
  if (![
    'login-form', 'entity-form', 'password-form', 'submission-form', 'contact-form',
    'account-login-form', 'account-register-form',
    'account-profile-form', 'account-demo-profile-form',
  ].includes(form.id)) return;
  event.preventDefault();
  if (form.dataset.saving === 'true') return;
  const error = form.querySelector('#form-error, #login-error');
  const submit = form.querySelector('[type=submit]');
  if (form.dataset.type === 'sales') {
    const kind = form.elements.saleKind.value;
    const count = form.querySelectorAll('[name=storeId]:checked').length;
    if (!kind || (kind === 'single' && count !== 1) || (kind === 'shared' && count < 2)) {
      error.textContent = !kind ? 'יש לבחור את סוג המכירה תחילה.' : kind === 'single' ? 'יש לבחור חנות אחת למכירה.' : 'במכירה משותפת יש לבחור לפחות שתי חנויות.';
      return;
    }
  }
  if (form.dataset.loadingStreets === 'true' || form.querySelector('[data-loading-streets="true"]')) { error.textContent = 'יש להמתין לסיום טעינת הרחובות לפני השמירה.'; return; }
  if (pendingFor(form).size) { error.textContent = 'יש להמתין לסיום עיבוד התמונות לפני השמירה.'; return; }
  form.dataset.saving = 'true';
  error.textContent = ''; submit.disabled = true;
  try {
    if (form.id === 'account-login-form') {
      const values = new FormData(form);
      await api('account/login', 'POST', { email: values.get('email'), password: values.get('password') });
      await load();
      state.accountMode = 'login';
      accountPage();
      toast('התחברת בהצלחה');
    } else if (form.id === 'account-register-form') {
      const values = new FormData(form);
      if (values.get('password') !== values.get('confirmPassword')) throw new Error('הסיסמאות אינן תואמות');
      const email = values.get('email').trim().toLowerCase();
      await api('account/register', 'POST', { email, password: values.get('password'), profile: profileFromForm(form) });
      await load();
      state.accountMode = 'login';
      accountPage();
      toast('החשבון נוצר והעדפות העדכונים נשמרו');
    } else if (form.id === 'account-demo-profile-form') {
      toast('בתצוגת הניסיון השינויים אינם נשמרים');
    } else if (form.id === 'account-profile-form') {
      state.account.profile = await api('account/profile', 'PUT', profileFromForm(form));
      state.accountMode = 'login';
      updateAccountLink();
      accountPage();
      toast('הפרטים וההעדפות נשמרו');
    } else if (form.id === 'contact-form') {
      const data = Object.fromEntries(new FormData(form));
      if (!data.email.trim() && !data.phone.trim()) throw new Error('יש להזין כתובת דוא״ל או מספר טלפון כדי שנוכל לחזור אליכם');
      const result = await api('messages', 'POST', data);
      main.innerHTML = `<div class="page-heading"><h1>ההודעה נשלחה בהצלחה.</h1><p role="status">${esc(result.message)}</p><a class="primary" href="#today">חזרה למכירות היום</a></div>`;
    } else if (form.id === 'submission-form') {
      const values = new FormData(form);
      const data = Object.fromEntries(values);
      data.storeNames = String(values.get('storeNames')).split(/\r?\n/).map(name => name.trim()).filter(Boolean);
      data.categories = values.getAll('categories');
      data.audiences = values.getAll('audiences');
      data.isOutlet = values.has('isOutlet');
      data.days = scheduleDays(form);
      const result = await api('submissions', 'POST', data);
      main.innerHTML = `<div class="page-heading"><h1>הבקשה נשלחה לבדיקה.</h1><p role="status">${esc(result.message)}</p><p class="hint">הפרטים נשמרו. אין צורך לשלוח שוב; המכירה עדיין אינה מפורסמת באתר.</p><a class="primary" href="#today">חזרה למכירות היום</a></div>`;
    } else if (form.id === 'login-form') {
      await api('login', 'POST', { password: new FormData(form).get('password') });
      await load(); render(); toast('התחברת בהצלחה');
    } else if (form.id === 'password-form') {
      await api('password', 'POST', Object.fromEntries(new FormData(form)));
      state.authenticated = false; dialog.close(); render(); toast('הסיסמה הוחלפה. התחברי מחדש.');
    } else {
      if (form.dataset.type === 'sales') {
        for (const id of new FormData(form).getAll('storeId')) {
          const row = form.querySelector(`[data-store-row="${id}"]`);
          const image = row.querySelector('[data-poster-image]');
          if (image.value) {
            const media = await api('media', 'POST', { image: image.value });
            row.querySelector('[data-poster-id]').value = media.id;
            image.value = '';
          }
        }
        const request = { sale: formEntity(form), ...(form.dataset.id ? { excludeId: Number(form.dataset.id) } : {}) };
        const preview = await api('sales/overlaps', 'POST', request);
        if (JSON.stringify(request.sale) !== JSON.stringify(formEntity(form))) throw new Error('נתוני המכירה השתנו בזמן הבדיקה. יש ללחוץ שוב על שמירה כדי לבדוק את החפיפות המעודכנות.');
        if (preview.overlaps.length) {
          const choice = await confirmSaleMerge(preview, !form.dataset.submissionId);
          if (choice !== 'merge' && choice !== 'separate') return;
          if (choice === 'merge') {
            await api('sales/merge', 'POST', { ...request, token: preview.token });
            await load(); dialog.close(); render(); toast('החפיפות אוחדו למכירה משותפת. שאר הזמנים נשמרו בנפרד.');
            return;
          }
        }
      }
      const saved = form.dataset.submissionId
        ? await api(`submissions/${form.dataset.submissionId}/approve`, 'POST', formEntity(form))
        : await api(`${form.dataset.type}${form.dataset.id ? `/${form.dataset.id}` : ''}`, form.dataset.id ? 'PUT' : 'POST', formEntity(form));
      await load();
      if (form.dataset.reviewId) {
        const links = reviewLinks.get(Number(form.dataset.reviewId));
        if (form.dataset.type === 'stores') links.stores[Number(form.dataset.reviewStore)] = saved.id;
        else links.venueId = saved.id;
        reviewSubmission(Number(form.dataset.reviewId));
        toast('הרשומה נשמרה וקושרה לבקשה');
      } else {
        dialog.close(); render(); toast(form.dataset.submissionId ? 'הבקשה אושרה והמכירה פורסמה' : 'השינויים נשמרו');
      }
    }
  } catch (failure) { error.textContent = failure.message; }
  finally { delete form.dataset.saving; updateSubmit(form); }
});
dialog.addEventListener('cancel', event => {
  if (hasUnsavedSale() && !confirm('התחלת למלא פרטי מכירה. האם את בטוחה שברצונך לסגור בלי לשמור?')) event.preventDefault();
});
dialog.addEventListener('click', event => {
  if (event.target === dialog) {
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestDialogClose();
  }
});
window.addEventListener('hashchange', render);
window.addEventListener('storage', event => {
  if (event.key !== FAVORITES_KEY && event.key !== null) return;
  loadFavorites();
  if (state.view === 'favorites') favoritesPage();
  refreshFavoriteButtons();
});
setInterval(() => {
  document.querySelectorAll('[data-status-sale]').forEach(element => {
    const sale = state.data.sales.find(sale => sale.id === Number(element.dataset.statusSale));
    if (sale) element.innerHTML = statusMarkup(sale, element.dataset.statusDate);
  });
}, 30_000);
main.innerHTML = '<div class="loading" role="status">טוענים דברים טובים…</div>';
loadFavorites();
try {
  await load();
  render();
  setTimeout(showAccountPrompt, 30_000);
}
catch (error) { main.innerHTML = `${errorBox(error.message)}<p>לא ניתן לטעון את האתר. ודאו שהשרת פועל ורעננו את העמוד.</p>`; }
