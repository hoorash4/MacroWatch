(() => {
  const AUTH_SUPABASE_URL = 'https://xhghpywvthjuvespzdul.supabase.co';
  const AUTH_SUPABASE_KEY = 'sb_publishable_rPKY5Wfpp1JnSkPhIzJqJA_cijBqYgc';
  const authClient = window.supabase?.createClient(AUTH_SUPABASE_URL, AUTH_SUPABASE_KEY);

  const elements = {};

  function phoneToEmail(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!/^01\d{8,9}$/.test(digits)) {
      throw new Error('전화번호를 정확히 입력해 주세요.');
    }
    return {
      digits,
      email: `${digits}@phone.macrowatch.example.com`
    };
  }

  function setMessage(message = '', tone = 'error') {
    elements.message.textContent = message;
    elements.message.className = `min-h-5 text-center text-xs ${tone === 'success' ? 'text-emerald-400' : 'text-red-400'}`;
  }

  function setBusy(isBusy) {
    elements.submit.disabled = isBusy;
    elements.submit.classList.toggle('opacity-60', isBusy);
    elements.spinner.classList.toggle('hidden', !isBusy);
    elements.submitLabel.textContent = isBusy ? '처리 중' : (elements.form.dataset.mode === 'signup' ? '회원가입' : '로그인');
  }

  function setMode(mode) {
    const isSignup = mode === 'signup';
    elements.form.dataset.mode = isSignup ? 'signup' : 'login';
    elements.title.textContent = isSignup ? '회원가입' : '로그인';
    elements.description.textContent = isSignup
      ? '전화번호와 비밀번호로 계정을 만듭니다.'
      : '등록한 전화번호와 비밀번호를 입력하세요.';
    elements.confirmWrap.classList.toggle('hidden', !isSignup);
    elements.confirm.required = isSignup;
    elements.submitLabel.textContent = isSignup ? '회원가입' : '로그인';
    elements.modePrompt.textContent = isSignup ? '이미 계정이 있나요?' : '아직 계정이 없나요?';
    elements.modeToggle.textContent = isSignup ? '로그인' : '회원가입';
    elements.password.autocomplete = isSignup ? 'new-password' : 'current-password';
    elements.confirm.value = '';
    setMessage();
  }

  async function showDashboard() {
    elements.authScreen.classList.add('hidden');
    elements.appShell.classList.remove('hidden');
    await window.checkDbConnection?.();
    await window.fetchTargets?.();
  }

  function showLogin() {
    elements.appShell.classList.add('hidden');
    elements.authScreen.classList.remove('hidden');
    elements.form.reset();
    setMode('login');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!authClient) {
      setMessage('로그인 기능을 불러오지 못했습니다.');
      return;
    }

    const mode = elements.form.dataset.mode;
    let account;
    try {
      account = phoneToEmail(elements.phone.value);
    } catch (error) {
      setMessage(error.message);
      return;
    }

    if (elements.password.value.length < 6) {
      setMessage('비밀번호는 6자 이상 입력해 주세요.');
      return;
    }
    if (mode === 'signup' && elements.password.value !== elements.confirm.value) {
      setMessage('비밀번호가 서로 다릅니다.');
      return;
    }

    setBusy(true);
    setMessage();
    try {
      const result = mode === 'signup'
        ? await authClient.auth.signUp({
            email: account.email,
            password: elements.password.value,
            options: { data: { phone_number: account.digits } }
          })
        : await authClient.auth.signInWithPassword({
            email: account.email,
            password: elements.password.value
          });

      if (result.error) throw result.error;
      if (!result.data.session) {
        throw new Error('로그인 세션을 만들지 못했습니다.');
      }
      await showDashboard();
    } catch (error) {
      const duplicate = /already registered|already exists/i.test(error.message || '');
      const invalid = /invalid login credentials/i.test(error.message || '');
      setMessage(duplicate
        ? '이미 가입된 전화번호입니다.'
        : invalid
          ? '전화번호 또는 비밀번호가 올바르지 않습니다.'
          : (error.message || '요청을 처리하지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  async function initialize() {
    elements.authScreen = document.getElementById('auth-screen');
    elements.appShell = document.getElementById('app-shell');
    elements.form = document.getElementById('auth-form');
    elements.title = document.getElementById('auth-title');
    elements.description = document.getElementById('auth-description');
    elements.phone = document.getElementById('auth-phone');
    elements.password = document.getElementById('auth-password');
    elements.confirm = document.getElementById('auth-password-confirm');
    elements.confirmWrap = document.getElementById('auth-confirm-wrap');
    elements.submit = document.getElementById('auth-submit');
    elements.submitLabel = document.getElementById('auth-submit-label');
    elements.spinner = document.getElementById('auth-spinner');
    elements.message = document.getElementById('auth-message');
    elements.modePrompt = document.getElementById('auth-mode-prompt');
    elements.modeToggle = document.getElementById('auth-mode-toggle');

    elements.form.addEventListener('submit', handleSubmit);
    elements.modeToggle.addEventListener('click', () => {
      setMode(elements.form.dataset.mode === 'signup' ? 'login' : 'signup');
    });
    document.getElementById('logout-button')?.addEventListener('click', async () => {
      await authClient?.auth.signOut();
      showLogin();
    });

    if (!authClient) {
      setMessage('로그인 기능을 불러오지 못했습니다.');
      return;
    }

    const { data } = await authClient.auth.getSession();
    if (data.session) {
      await showDashboard();
    } else {
      showLogin();
    }

    authClient.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') showLogin();
    });
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();