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
    elements.kakaoWrap.classList.toggle('hidden', !isSignup);
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
            options: {
              data: {
                phone_number: account.digits,
                kakao_alert_opt_in: elements.kakaoOptIn.checked
              }
            }
          })
        : await authClient.auth.signInWithPassword({
            email: account.email,
            password: elements.password.value
          });

      if (result.error) throw result.error;
      if (!result.data.session) {
        throw new Error('로그인 세션을 만들지 못했습니다.');
      }
      if (mode === 'signup' && elements.kakaoOptIn.checked) {
        await startKakaoConnection();
        return;
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

  async function invokeKakao(action, payload = {}) {
    const { data, error } = await authClient.functions.invoke('kakao-auth', {
      body: { action, ...payload }
    });
    if (error) throw new Error(data?.error || error.message || '카카오 연결 요청에 실패했습니다.');
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function startKakaoConnection() {
    const button = elements.kakaoConnectButton;
    if (button) button.disabled = true;
    try {
      const data = await invokeKakao('start');
      if (!data?.authorize_url) throw new Error('카카오 연결 주소를 받지 못했습니다.');
      window.location.assign(data.authorize_url);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function setKakaoStatus(connected, message) {
    elements.kakaoStatus.textContent = message || (connected ? '카카오 계정이 연결되어 있습니다.' : '아직 카카오 계정이 연결되지 않았습니다.');
    elements.kakaoBadge.textContent = connected ? '연결됨' : '미연결';
    elements.kakaoBadge.className = connected
      ? 'shrink-0 rounded-full border border-emerald-700/50 bg-emerald-950/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-400'
      : 'shrink-0 rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-400';
    elements.kakaoConnectButton.querySelector('span').textContent = connected ? '카카오톡 다시 연결하기' : '카카오톡 연동하기';
  }

  async function loadKakaoStatus() {
    setKakaoStatus(false, '연결 상태 확인 중');
    elements.kakaoConnectButton.disabled = true;
    try {
      const data = await invokeKakao('status');
      setKakaoStatus(Boolean(data?.connected));
    } catch (error) {
      setKakaoStatus(false, error.message || '연결 상태를 확인하지 못했습니다.');
    } finally {
      elements.kakaoConnectButton.disabled = false;
    }
  }

  async function openProfile() {
    elements.profileModal.classList.remove('hidden');
    await loadKakaoStatus();
  }

  function closeProfile() {
    elements.profileModal.classList.add('hidden');
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
    elements.kakaoWrap = document.getElementById('auth-kakao-wrap');
    elements.kakaoOptIn = document.getElementById('auth-kakao-opt-in');
    elements.profileModal = document.getElementById('profile-modal');
    elements.kakaoStatus = document.getElementById('kakao-connection-status');
    elements.kakaoBadge = document.getElementById('kakao-status-badge');
    elements.kakaoConnectButton = document.getElementById('kakao-connect-button');
    elements.submit = document.getElementById('auth-submit');
    elements.submitLabel = document.getElementById('auth-submit-label');
    elements.spinner = document.getElementById('auth-spinner');
    elements.message = document.getElementById('auth-message');
    elements.modePrompt = document.getElementById('auth-mode-prompt');
    elements.modeToggle = document.getElementById('auth-mode-toggle');

    elements.form.addEventListener('submit', handleSubmit);
    elements.phone.addEventListener('input', () => {
      elements.phone.value = elements.phone.value.replace(/\D/g, '').slice(0, 11);
    });
    document.getElementById('profile-button')?.addEventListener('click', openProfile);
    document.getElementById('profile-close-button')?.addEventListener('click', closeProfile);
    elements.kakaoConnectButton.addEventListener('click', async () => {
      try {
        await startKakaoConnection();
      } catch (error) {
        setKakaoStatus(false, error.message || '카카오 연결을 시작하지 못했습니다.');
      }
    });
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
      const params = new URLSearchParams(window.location.search);
      const kakaoCode = params.get('code');
      const kakaoState = params.get('state');
      const kakaoError = params.get('error_description') || params.get('error');
      let openSettingsAfterLogin = false;

      if (kakaoCode && kakaoState) {
        try {
          await invokeKakao('exchange', { code: kakaoCode, state: kakaoState });
          openSettingsAfterLogin = true;
        } catch (error) {
          window.alert(error.message || '카카오 계정 연결에 실패했습니다.');
        }
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (kakaoError) {
        window.alert('카카오 계정 연결이 취소되었습니다.');
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      await showDashboard();
      if (openSettingsAfterLogin) await openProfile();
    } else {
      showLogin();
    }

    authClient.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') showLogin();
    });
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();