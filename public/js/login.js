/* Giriş sayfası */
(function () {
  const form = document.getElementById('login-form');
  const alertBox = document.getElementById('login-alert');
  const submitBtn = document.getElementById('login-submit');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');

  function showError(message) {
    alertBox.textContent = message;
    alertBox.classList.remove('hidden');
  }

  function clearError() {
    alertBox.textContent = '';
    alertBox.classList.add('hidden');
  }

  function nextTarget() {
    const next = App.qs('next');
    if (next && /^\/[A-Za-z0-9._~\-/]*$/.test(next)) return next;
    return '/dashboard.html';
  }

  async function redirectIfLoggedIn() {
    const user = await App.currentUser(true).catch(() => null);
    if (user) window.location.replace(nextTarget());
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      showError('Kullanıcı adı ve şifre zorunludur.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Giriş yapılıyor…';

    try {
      await App.post('/api/auth/login', { username, password });
      window.location.replace(nextTarget());
    } catch (error) {
      showError(error.message);
      passwordInput.value = '';
      passwordInput.focus();
      submitBtn.disabled = false;
      submitBtn.textContent = 'Giriş yap';
    }
  });

  [usernameInput, passwordInput].forEach((input) => {
    input.addEventListener('input', clearError);
  });

  redirectIfLoggedIn();
})();
