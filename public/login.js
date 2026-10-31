'use strict';
const form = document.getElementById('login-form');
const error = form.querySelector('.form-error');
const button = form.querySelector('button[type="submit"]');

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
    throw new Error(data.error || 'Connexion impossible');
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    form.elements.password.select();
  } finally {
    button.disabled = false;
  }
});
