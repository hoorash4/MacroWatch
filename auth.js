(() => {
  const AUTH_SUPABASE_URL = 'https://xhghpywvthjuvespzdul.supabase.co';
  const AUTH_SUPABASE_KEY = 'sb_publishable_rPKY5Wfpp1JnSkPhIzJqJA_cijBqYgc';
  const authClient = window.supabase?.createClient(AUTH_SUPABASE_URL, AUTH_SUPABASE_KEY);
  const elements = {};

  function setMessage(message = '') {
    elements.message.textContent = message;
  }

  function setBusy(isBusy, label = '카카오로 계속하기') {
    elements.submit.disabled = isBusy;
    elements.spinner.classList.toggle('hidden', !isBusy);
    elements.submitLabel.textContent = isBusy ? '카카오 연결 중' : label;
  }

  async function invokeKakao(action, payload = {}) {
    const { data, error } = await authClient.functions.invoke('kakao-auth', {
      body: { action, ...payload }
    });
    if (error) throw new Error(data?.error || error.message || '카카오 요청에 실패했습니다.');
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function beginKakaoLogin() {
    setBusy(true);
    setMessage();
    try {
      const data = await invokeKakao('start');
      if (!data?.authorize_url) throw new Error('카카오 로그인 주소를 받지 못했습니다.');
      window.location.assign(data.authorize_url);
    } catch (error) {
      setMessage(error.message || '카카오 로그인을 시작하지 못했습니다.');
      setBusy(false);
    }
  }

  async function finishKakaoLogin(code, state) {
    setBusy(true);
    setMessage('카카오 로그인을 완료하는 중입니다.');
    const tokens = await invokeKakao('exchange', { code, state });
    const { data, error } = await authClient.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    });
    if (error || !data.session) throw error || new Error('로그인 세션을 저장하지 못했습니다.');
    window.history.replaceState({}, document.title, window.location.pathname);
    return data.session;
  }

  async function showDashboard() {
    elements.authScreen.classList.add('hidden');
    elements.appShell.classList.remove('hidden');
    await window.checkDbConnection?.();
    await window.fetchTargets?.();
  }

  function showLogin(message = '') {
    elements.appShell.classList.add('hidden');
    elements.authScreen.classList.remove('hidden');
    setBusy(false);
    setMessage(message);
  }

  function setKakaoStatus(connected, message) {
    elements.kakaoStatus.textContent = message || (connected ? '로그인한 카카오 계정에 알림이 연결되어 있습니다.' : '카카오 알림 연결을 확인하지 못했습니다.');
    elements.kakaoBadge.textContent = connected ? '연결됨' : '확인 필요';
    elements.kakaoBadge.className = connected
      ? 'shrink-0 rounded-full border border-emerald-700/50 bg-emerald-950/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-400'
      : 'shrink-0 rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-400';
    elements.kakaoConnectButton.querySelector('span').textContent = '카카오 계정 다시 연결하기';
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

  async function initialize() {
    elements.authScreen = document.getElementById('auth-screen');
    elements.appShell = document.getElementById('app-shell');
    elements.form = document.getElementById('auth-form');
    elements.submit = document.getElementById('auth-submit');
    elements.submitLabel = document.getElementById('auth-submit-label');
    elements.spinner = document.getElementById('auth-spinner');
    elements.message = document.getElementById('auth-message');
    elements.profileModal = document.getElementById('profile-modal');
    elements.kakaoStatus = document.getElementById('kakao-connection-status');
    elements.kakaoBadge = document.getElementById('kakao-status-badge');
    elements.kakaoConnectButton = document.getElementById('kakao-connect-button');

    elements.form.addEventListener('submit', (event) => {
      event.preventDefault();
      beginKakaoLogin();
    });
    const showServicePreparing = () => {
      document.getElementById('service-preparing-modal')?.classList.remove('hidden');
      document.getElementById('service-preparing-close')?.focus();
    };
    const hideServicePreparing = () => {
      document.getElementById('service-preparing-modal')?.classList.add('hidden');
    };
    document.getElementById('password-login-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      showServicePreparing();
    });
    document.getElementById('signup-placeholder-button')?.addEventListener('click', showServicePreparing);
    document.getElementById('service-preparing-close')?.addEventListener('click', hideServicePreparing);
    document.getElementById('service-preparing-modal')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) hideServicePreparing();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hideServicePreparing();
    });
    document.getElementById('profile-button')?.addEventListener('click', async () => {
      elements.profileModal.classList.remove('hidden');
      await loadKakaoStatus();
    });
    document.getElementById('profile-close-button')?.addEventListener('click', () => {
      elements.profileModal.classList.add('hidden');
    });
    elements.kakaoConnectButton.addEventListener('click', beginKakaoLogin);
    document.getElementById('logout-button')?.addEventListener('click', async () => {
      await authClient?.auth.signOut();
      showLogin();
    });

    if (!authClient) {
      showLogin('로그인 기능을 불러오지 못했습니다.');
      return;
    }

    try {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');
      const oauthError = params.get('error_description') || params.get('error');
      let session = null;

      if (code && state) {
        session = await finishKakaoLogin(code, state);
      } else if (oauthError) {
        window.history.replaceState({}, document.title, window.location.pathname);
        throw new Error('카카오 로그인이 취소되었습니다.');
      } else {
        const result = await authClient.auth.getSession();
        session = result.data.session;
      }

      if (session?.user?.user_metadata?.auth_provider === 'kakao') {
        await showDashboard();
      } else {
        if (session) await authClient.auth.signOut();
        showLogin();
      }
    } catch (error) {
      window.history.replaceState({}, document.title, window.location.pathname);
      showLogin(error.message || '로그인하지 못했습니다.');
    }

    authClient.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') showLogin();
    });
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();