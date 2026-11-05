import { errorMessage, initI18n, onLangChange, setLang, storedLang, t } from './i18n.js';

const form = document.getElementById('login-form');
const error = form.querySelector('.form-error');
const button = form.querySelector('button[type="submit"]');
const langSelect = document.getElementById('lang-select');

const syncTitle = () => { document.title = t('login.title'); };
initI18n();
syncTitle();
onLangChange(syncTitle);
langSelect.value = storedLang() ?? '';
langSelect.addEventListener('change', () => setLang(langSelect.value || null));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  button.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: form.elements.password.value }),
    });
    if (res.ok) {
      location.replace('/');
      return;
    }
    const data = await res.json().catch(() => ({}));
    throw new Error((data.error || data.code) ? errorMessage(data) : t('login.failed'));
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    form.elements.password.select();
  } finally {
    button.disabled = false;
  }
});
