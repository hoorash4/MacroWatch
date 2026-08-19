// Supabase 및 API 설정
const SUPABASE_URL = 'https://xhghpywvthjuvespzdul.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rPKY5Wfpp1JnSkPhIzJqJA_cijBqYgc';
const supabaseClient = window.macroWatchSupabase
  || (window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null);

// 상태 관리
const ITEMS_PER_TRACK = 8;
const MAX_TRACKS = 10;
const MAX_TARGETS = ITEMS_PER_TRACK * MAX_TRACKS;

let targets = [];
let targetLoadError = false;
let currentEditId = null;
let currentDeleteId = null;
let draggedItemIndex = null;      // targets 배열의 전역 인덱스
let dropIndicatorIndex = null;    // targets 배열 기준 삽입 인덱스
let expandedTargetId = null;
let currentUserId = null;
let activeTrack = 1;

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  toggleTargetValueInput('input-condition', 'input-target-val');

  const preparingClose = document.getElementById('service-preparing-close');
  if (preparingClose) {
    preparingClose.addEventListener('click', closeServicePreparingModal);
  }

  document.addEventListener('click', (event) => {
    const helpButton = event.target.closest('.track-help-button');
    const help = event.target.closest('.track-help');

    if (helpButton && help) {
      event.stopPropagation();
      help.classList.toggle('is-open');
      return;
    }

    document.querySelector('.track-help.is-open')?.classList.remove('is-open');
  });
});

async function getCurrentUserId() {
  if (currentUserId) return currentUserId;
  const { data } = await supabaseClient.auth.getSession();
  currentUserId = data.session?.user?.id || null;
  return currentUserId;
}

// DB 연결 상태 표시
function setDbStatus(state) {
  const statusEl = document.getElementById('db-status');
  if (!statusEl) return;
  const states = {
    loading: ['bg-slate-900/60 text-slate-400 border-slate-800', 'bg-slate-500 animate-pulse', 'DB 연결 확인 중...'],
    connected: ['bg-green-950/60 text-green-400 border-green-700/50', 'bg-green-400', 'DB 연결 완료'],
    missing: ['bg-red-950/60 text-red-400 border-red-700/50', 'bg-red-400', 'DB 설정 필요'],
    error: ['bg-amber-950/60 text-amber-400 border-amber-700/50', 'bg-amber-400', 'DB 연결 오류']
  };
  const [colors, dot, label] = states[state] || states.error;
  statusEl.className = `px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-2 shadow-inner ${colors}`;
  statusEl.innerHTML = `<span class="w-2 h-2 rounded-full ${dot}"></span> ${label}`;
}

// 탭 전환 함수
function switchTab(tabName) {
  const trackerTab = document.getElementById('tab-content-tracker');
  const newsTab = document.getElementById('tab-content-news');
  const trackerBtn = document.getElementById('tab-btn-tracker');
  const newsBtn = document.getElementById('tab-btn-news');

  if (tabName === 'tracker') {
    trackerTab.classList.remove('hidden');
    newsTab.classList.add('hidden');
    trackerBtn.className = "px-5 py-3 text-sm font-bold text-blue-400 border-b-2 border-blue-500 transition flex items-center gap-2";
    newsBtn.className = "px-5 py-3 text-sm font-bold text-slate-400 border-b-2 border-transparent hover:text-slate-200 transition flex items-center gap-2";
  } else {
    trackerTab.classList.add('hidden');
    newsTab.classList.remove('hidden');
    newsBtn.className = "px-5 py-3 text-sm font-bold text-blue-400 border-b-2 border-blue-500 transition flex items-center gap-2";
    trackerBtn.className = "px-5 py-3 text-sm font-bold text-slate-400 border-b-2 border-transparent hover:text-slate-200 transition flex items-center gap-2";
  }
}

function toggleTypeFields() {
  const type = document.getElementById('input-type').value;
  document.getElementById('field-selector').classList.toggle('hidden', type !== 'SELECTOR');
  document.getElementById('field-fred').classList.toggle('hidden', type !== 'FRED');
  document.getElementById('field-bok').classList.toggle('hidden', type !== 'BOK');
  document.getElementById('field-api').classList.toggle('hidden', type !== 'API');
}

function toggleTargetValueInput(conditionId, valueId) {
  const conditionEl = document.getElementById(conditionId);
  const valueEl = document.getElementById(valueId);
  if (!conditionEl || !valueEl) return;

  const isValueChange = conditionEl.value === 'changed';
  valueEl.disabled = isValueChange;
  if (isValueChange) {
    valueEl.value = '';
    valueEl.placeholder = '설정 없이 지표값이 변동하면 알려줍니다.';
  } else {
    valueEl.placeholder = valueEl.dataset.defaultPlaceholder || '';
  }
}

// 추적 목록 조회
async function fetchTargets() {
  if (!supabaseClient) {
    setDbStatus('missing');
    targets = [];
    renderTargets();
    return;
  }
  setDbStatus('loading');
  targetLoadError = false;
  try {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('로그인 정보를 확인하지 못했습니다.');
    const { data, error } = await supabaseClient
      .from('targets')
      .select('*')
      .eq('user_id', userId)
      .order('display_order', { ascending: true, nullsFirst: false });
    if (error) throw error;
    targets = data || [];
    setDbStatus('connected');
  } catch (error) {
    console.error('Target fetch error:', error);
    targets = [];
    targetLoadError = true;
    setDbStatus('error');
  }
  renderTargets();
}

// Track 계산 및 탭 렌더링
function getTrackCount() {
  return Math.max(1, Math.min(MAX_TRACKS, Math.ceil(targets.length / ITEMS_PER_TRACK)));
}

function getTrackStartIndex(trackNumber = activeTrack) {
  return (trackNumber - 1) * ITEMS_PER_TRACK;
}

function getTrackEndIndex(trackNumber = activeTrack) {
  return Math.min(getTrackStartIndex(trackNumber) + ITEMS_PER_TRACK, targets.length);
}

function normalizeActiveTrack() {
  const trackCount = getTrackCount();
  if (activeTrack > trackCount) activeTrack = trackCount;
  if (activeTrack < 1) activeTrack = 1;
}

function switchTrack(trackNumber) {
  const trackCount = getTrackCount();
  if (trackNumber < 1 || trackNumber > trackCount || trackNumber === activeTrack) return;

  activeTrack = trackNumber;
  expandedTargetId = null;
  clearDropIndicator();
  renderTargets();
}

function renderTrackTabs() {
  const tabsEl = document.querySelector('#tab-content-tracker > .sheet-tabs');
  if (!tabsEl) return;

  normalizeActiveTrack();
  const trackCount = getTrackCount();

  tabsEl.innerHTML = '';

  for (let trackNumber = 1; trackNumber <= trackCount; trackNumber += 1) {
    const button = document.createElement('button');
    const isActive = trackNumber === activeTrack;

    button.type = 'button';
    button.className = `sheet-tab${isActive ? ' is-active' : ''}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(isActive));
    button.textContent = `Track ${String(trackNumber).padStart(2, '0')}`;

    button.addEventListener('click', () => switchTrack(trackNumber));
    button.addEventListener('dragover', (event) => handleTrackDragOver(event, trackNumber));
    button.addEventListener('dragleave', handleTrackDragLeave);
    button.addEventListener('drop', (event) => handleDropOnTrack(event, trackNumber));

    tabsEl.appendChild(button);
  }

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'sheet-tab sheet-tab-add';
  addButton.setAttribute('role', 'button');
  addButton.textContent = '+ ADD Track';
  addButton.addEventListener('click', showAddTrackNotice);
  tabsEl.appendChild(addButton);
}

function showCenteredNotice(titleText, messageText = '') {
  const modal = document.getElementById('service-preparing-modal');
  const title = document.getElementById('service-preparing-title');
  const message = modal?.querySelector('p');

  if (!modal || !title || !message) {
    window.alert(messageText ? `${titleText}\n${messageText}` : titleText);
    return;
  }

  title.textContent = titleText;
  message.textContent = messageText;
  message.classList.toggle('hidden', !messageText);
  modal.classList.remove('hidden');
}

function showAddTrackNotice() {
  showCenteredNotice(
    '서비스 준비 중입니다.',
    '지표 신규 등록을 하면 자동으로 Track 탭이 생성됩니다.'
  );
}

function closeServicePreparingModal() {
  document.getElementById('service-preparing-modal')?.classList.add('hidden');
}

function finishTargetRegistration() {
  activeTrack = getTrackCount();
  renderTargets();

  document.getElementById('add-form').reset();
  toggleTypeFields();
  toggleTargetValueInput('input-condition', 'input-target-val');

  showCenteredNotice('등록 되었습니다.');
}

// 추적 항목 한 개의 HTML 생성
function renderTargetItem(item, globalIndex, isFirstVisible, isLastVisible) {
  return `
    <div data-target-container="${globalIndex}" class="py-3 border-b border-slate-800/80 first:border-t"
         style="${isFirstVisible ? 'border-top-color: transparent;' : ''}${isLastVisible ? 'border-bottom-color: transparent;' : ''}"
         ondragover="handleDragOver(event, ${globalIndex})"
         ondrop="handleDrop(event, ${globalIndex})">
      <div data-target-row class="flex items-center justify-between gap-3 px-2 rounded-lg hover:bg-slate-800/30 transition"
           draggable="true"
           ondragstart="handleDragStart(event, ${globalIndex})"
           ondragend="handleDragEnd(event)">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <i class="fa-solid fa-grip-vertical text-slate-600 hover:text-slate-400 cursor-grab active:cursor-grabbing px-1"></i>
          <div class="min-w-0 flex-1 py-3">
            <div class="flex items-center gap-2 min-w-0">
              <button type="button" onclick="toggleTargetDetails('${item.id}')" class="min-w-0 max-w-[calc(100%-2.75rem)] text-left">
                <span class="flex items-center gap-2">
                  <span class="text-sm font-bold text-white truncate">${escapeHtml(item.title)}</span>
                  <i class="fa-solid ${String(item.id) === expandedTargetId ? 'fa-chevron-up' : 'fa-chevron-down'} text-[10px] text-slate-500"></i>
                </span>
              </button>
              ${item.url ? `<a href="${escapeHtml(getOriginalUrl(item))}" target="_blank" rel="noopener noreferrer" class="inline-flex shrink-0 items-center justify-center rounded-md border border-blue-500/30 bg-blue-500/10 px-1.5 py-1 text-blue-300 hover:bg-blue-500/20 hover:text-blue-100 transition" title="출처 열기" aria-label="출처 열기"><i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i></a>` : ''}
            </div>
            <span class="block text-xs text-slate-400 mt-0.5 truncate">
              조건: <span class="text-slate-300 font-mono">${getConditionText(item.condition_type)}</span>
              ${item.target_value !== null && item.target_value !== undefined ? `| 목표값: <span class="text-blue-400 font-mono">${item.target_value}</span>` : ''}
            </span>
          </div>
        </div>
        <div class="shrink-0 text-right">
          <span class="block text-[10px] text-slate-500">현재값</span>
          <span class="block text-sm font-bold text-blue-400 font-mono">${item.last_value ?? '—'}</span>
        </div>
        <button type="button" onclick="toggleTargetActive('${item.id}')" class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition ${item.is_active !== false ? 'text-amber-400 hover:bg-amber-500/20 hover:text-amber-300' : 'text-slate-600 hover:bg-slate-800 hover:text-slate-400'}" title="${item.is_active !== false ? '알림 끄기' : '알림 켜기'}" aria-label="${item.is_active !== false ? '알림 끄기' : '알림 켜기'}">
          <i class="fa-solid text-[13px] ${item.is_active !== false ? 'fa-bell' : 'fa-bell-slash'}"></i>
        </button>
      </div>
      ${String(item.id) === expandedTargetId ? `
        <div class="mx-2 mb-2 ml-9 rounded-xl border border-slate-700/70 bg-slate-950/60 p-4">
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3 text-xs">
            <div class="sm:col-span-2">
              <dt class="text-slate-500">대상 URL</dt>
              <dd class="mt-1 break-all font-mono text-slate-300">${escapeHtml(getOriginalUrl(item) || '—')}</dd>
            </div>
            <div class="sm:col-span-2">
              <dt class="text-slate-500">추출 설정</dt>
              <dd class="mt-1 break-all font-mono text-slate-300">${escapeHtml(item.css_selector || '—')}</dd>
            </div>
            <div>
              <dt class="text-slate-500">알림 조건</dt>
              <dd class="mt-1 text-slate-200">${getConditionText(item.condition_type)}</dd>
            </div>
            <div>
              <dt class="text-slate-500">목표값</dt>
              <dd class="mt-1 font-mono text-blue-400">${item.target_value ?? '—'}</dd>
            </div>
          </dl>
          <div class="mt-4 flex justify-end gap-2">
            <button onclick="openEditModal('${item.id}')" class="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"><i class="fa-solid fa-pen-to-square mr-1"></i>수정</button>
            <button onclick="handleDeleteTarget('${item.id}')" class="rounded-md bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 transition"><i class="fa-solid fa-trash-can mr-1"></i>삭제</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

// 추적 목록 렌더링
function renderTargets() {
  const listEl = document.getElementById('target-list');
  if (!listEl) return;

  normalizeActiveTrack();
  renderTrackTabs();

  if (targetLoadError) {
    listEl.innerHTML = `<p class="text-sm text-amber-300 py-6 text-center"><i class="fa-solid fa-triangle-exclamation mr-2"></i>연결 오류가 발생했습니다.<br><span class="text-xs text-slate-400">로그아웃 후 다시 시도해 주세요.</span></p>`;
    return;
  }

  if (targets.length === 0) {
    listEl.innerHTML = `<p class="text-sm text-slate-500 py-6 text-center"><i class="fa-solid fa-circle-info mr-2"></i>등록된 추적 항목이 없습니다.</p>`;
    return;
  }

  const startIndex = getTrackStartIndex();
  const endIndex = getTrackEndIndex();
  const visibleTargets = targets.slice(startIndex, endIndex);

  listEl.innerHTML = visibleTargets.map((item, localIndex) => {
    const globalIndex = startIndex + localIndex;
    return renderTargetItem(
      item,
      globalIndex,
      localIndex === 0,
      localIndex === visibleTargets.length - 1
    );
  }).join('');
}

function toggleTargetDetails(id) {
  const targetId = String(id);
  expandedTargetId = expandedTargetId === targetId ? null : targetId;
  renderTargets();
}

async function toggleTargetActive(id) {
  const index = targets.findIndex(item => String(item.id) === String(id));
  if (index === -1) return;

  const item = targets[index];
  const nextIsActive = item.is_active === false;

  if (supabaseClient && !String(id).startsWith('local_')) {
    try {
      const userId = await getCurrentUserId();
      const { error } = await supabaseClient
        .from('targets')
        .update({ is_active: nextIsActive })
        .eq('id', id)
        .eq('user_id', userId);
      if (error) throw error;
    } catch (err) {
      console.error(err);
      return;
    }
  }

  targets[index] = { ...item, is_active: nextIsActive };
  renderTargets();
}

// 드래그 앤 드롭 핸들러
function setDropIndicator(globalInsertIndex) {
  if (dropIndicatorIndex === globalInsertIndex) return;

  clearDropIndicator();
  dropIndicatorIndex = globalInsertIndex;

  const containers = [...document.querySelectorAll('[data-target-container]')];
  const startIndex = getTrackStartIndex();
  const localInsertIndex = globalInsertIndex - startIndex;

  if (localInsertIndex >= 0 && localInsertIndex < containers.length) {
    containers[localInsertIndex]?.style.setProperty('box-shadow', 'inset 0 1px 0 white');
  } else if (containers.length > 0) {
    containers[containers.length - 1]?.style.setProperty('box-shadow', 'inset 0 -1px 0 white');
  }
}

function clearDropIndicator() {
  document.querySelectorAll('[data-target-container]').forEach(container => {
    container.style.removeProperty('box-shadow');
  });
  dropIndicatorIndex = null;
}

function handleDragStart(e, globalIndex) {
  draggedItemIndex = globalIndex;
  clearDropIndicator();

  document.querySelector('.sheet-tabs')?.classList.add('is-dragging');

  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(globalIndex));
  e.currentTarget.classList.add('opacity-40');
}

function handleDragOver(e, targetGlobalIndex) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const targetRow = e.currentTarget.querySelector('[data-target-row]') || e.currentTarget;
  const rect = targetRow.getBoundingClientRect();
  const insertIndex = e.clientY < rect.top + rect.height / 2
    ? targetGlobalIndex
    : targetGlobalIndex + 1;

  setDropIndicator(insertIndex);
}

function handleDrop(e, targetGlobalIndex) {
  e.preventDefault();
  const insertIndex = dropIndicatorIndex ?? targetGlobalIndex;
  clearDropIndicator();

  if (draggedItemIndex === null) return;

  // 리스트 내부 드롭은 현재 Track 안에서만 순서를 바꾼다.
  const trackStart = getTrackStartIndex();
  const trackEnd = getTrackEndIndex();

  if (
    draggedItemIndex < trackStart ||
    draggedItemIndex >= trackEnd ||
    insertIndex < trackStart ||
    insertIndex > trackEnd
  ) {
    return;
  }

  const destinationIndex = draggedItemIndex < insertIndex ? insertIndex - 1 : insertIndex;
  if (destinationIndex === draggedItemIndex) return;

  const movedItem = targets.splice(draggedItemIndex, 1)[0];
  targets.splice(destinationIndex, 0, movedItem);

  updateDisplayOrder();
  renderTargets();
  saveOrderToDb();
}

function handleTrackDragOver(e, targetTrack) {
  if (draggedItemIndex === null) return;

  const sourceTrack = Math.floor(draggedItemIndex / ITEMS_PER_TRACK) + 1;
  if (targetTrack === sourceTrack) return;

  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('is-drag-over');
}

function handleTrackDragLeave(e) {
  e.currentTarget.classList.remove('is-drag-over');
}

function handleDropOnTrack(e, targetTrack) {
  e.preventDefault();
  e.currentTarget.classList.remove('is-drag-over');

  if (draggedItemIndex === null) return;

  const sourceTrack = Math.floor(draggedItemIndex / ITEMS_PER_TRACK) + 1;
  if (targetTrack === sourceTrack) return;

  // 원래 위치에서 항목을 먼저 제거한다.
  // 배열이 당겨지면서 중간 Track의 경계 항목들이 자연스럽게 한 칸씩 이동한다.
  const [movedItem] = targets.splice(draggedItemIndex, 1);
  if (!movedItem) return;

  let insertIndex;

  if (targetTrack < sourceTrack) {
    // 앞쪽 Track으로 이동:
    // 이동 항목은 대상 Track의 맨 아래에 들어간다.
    // 대상 Track의 기존 맨 아래 항목은 다음 Track 맨 위로 밀리고,
    // 이 과정이 출발 Track까지 순차적으로 이어진다.
    insertIndex = targetTrack * ITEMS_PER_TRACK - 1;
  } else {
    // 뒤쪽 Track으로 이동:
    // 이동 항목은 대상 Track의 맨 위에 들어간다.
    // 대상 Track의 기존 맨 위 항목은 이전 Track 맨 아래로 밀리고,
    // 이 과정이 출발 Track까지 역방향으로 순차적으로 이어진다.
    insertIndex = (targetTrack - 1) * ITEMS_PER_TRACK;
  }

  targets.splice(insertIndex, 0, movedItem);

  updateDisplayOrder();
  renderTargets();
  saveOrderToDb();
}

function handleDragEnd(e) {
  e.currentTarget.classList.remove('opacity-40');

  document.querySelector('.sheet-tabs')?.classList.remove('is-dragging');
  document.querySelectorAll('.sheet-tab').forEach(tab => {
    tab.classList.remove('is-drag-over');
  });

  clearDropIndicator();
  draggedItemIndex = null;
}

function updateDisplayOrder() {
  targets.forEach((item, index) => {
    item.display_order = index;
  });
}

// 순서 변경 사항 DB 저장
async function saveOrderToDb() {
  if (!supabaseClient) return;
  const userId = await getCurrentUserId();
  if (!userId) return;

  try {
    const results = await Promise.all(targets.map((target, displayOrder) =>
      supabaseClient
        .from('targets')
        .update({ display_order: displayOrder })
        .eq('id', target.id)
        .eq('user_id', userId)
    ));
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
  } catch (error) {
    console.error('Target order save error:', error);
    await fetchTargets();
    window.alert('순서를 저장하지 못해 기존 순서로 되돌렸습니다.');
  }
}

// 추적 항목 추가
async function handleAddTarget(e) {
  e.preventDefault();

  if (targets.length >= MAX_TARGETS) {
    window.alert(`추적 지표는 최대 ${MAX_TARGETS}개까지 등록할 수 있습니다.`);
    return;
  }

  const title = document.getElementById('input-title').value.trim();
  const type = document.getElementById('input-type').value;
  const conditionType = document.getElementById('input-condition').value;
  const targetValStr = document.getElementById('input-target-val').value.trim();
  const targetVal = conditionType === 'changed' || targetValStr === '' ? null : parseFloat(targetValStr);

  let url = '';
  let cssSelector = '';
  let sourceType = 'web';
  let sourceConfig = {};

  if (type === 'SELECTOR') {
    url = document.getElementById('input-url').value.trim();
    cssSelector = document.getElementById('input-selector').value.trim();
  } else if (type === 'FRED') {
    const seriesId = document.getElementById('input-fred-id').value.trim().toUpperCase();
    url = `https://fred.stlouisfed.org/series/${encodeURIComponent(seriesId)}`;
    cssSelector = 'API:observations[0].value';
    sourceType = 'fred';
    sourceConfig = { series_id: seriesId };
  } else if (type === 'BOK') {
    const statCode = document.getElementById('input-bok-code').value.trim().toUpperCase();
    const itemCode = document.getElementById('input-bok-item-code').value.trim();
    const dataCycle = document.getElementById('input-bok-cycle').value;
    url = 'https://ecos.bok.or.kr/';
    cssSelector = 'API:StatisticSearch.row[0].DATA_VALUE';
    sourceType = 'ecos';
    sourceConfig = { stat_code: statCode, item_code: itemCode, data_cycle: dataCycle };
  } else if (type === 'API') {
    url = document.getElementById('input-api-url').value.trim();
    const jsonPath = document.getElementById('input-json-path').value.trim();
    cssSelector = jsonPath ? `API:${jsonPath}` : '';
    sourceType = 'json_api';
    sourceConfig = { json_path: jsonPath };
  }

  const userId = await getCurrentUserId();
  if (!userId) {
    window.alert('로그인 정보가 없습니다. 다시 로그인해 주세요.');
    return;
  }

  const newItem = {
    id: 'local_' + Date.now(),
    user_id: userId,
    title,
    url,
    css_selector: cssSelector,
    source_type: sourceType,
    source_config: sourceConfig,
    condition_type: conditionType,
    target_value: targetVal,
    is_active: true,
    display_order: targets.length
  };

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('targets')
        .insert([{
          user_id: userId,
          title,
          url,
          css_selector: cssSelector,
          source_type: sourceType,
          source_config: sourceConfig,
          condition_type: conditionType,
          target_value: targetVal,
          is_active: true,
          display_order: targets.length
        }])
        .select();

      if (!error && data) {
        targets.push(data[0]);
        finishTargetRegistration();
        return;
      }
      if (error) {
        alert('등록 실패: ' + error.message);
        return;
      }
    } catch (err) {
      console.error(err);
      return;
    }
  }

  targets.push(newItem);
  finishTargetRegistration();
}

// 수정 모달 열기
function openEditModal(id) {
  const item = targets.find(t => String(t.id) === String(id));
  if (!item) return;

  currentEditId = id;
  document.getElementById('edit-title').value = item.title || '';
  document.getElementById('edit-url').value = item.url || '';
  document.getElementById('edit-selector').value = item.css_selector || '';
  document.getElementById('edit-condition').value = item.condition_type || 'changed';
  document.getElementById('edit-target-val').value = item.target_value ?? '';
  toggleTargetValueInput('edit-condition', 'edit-target-val');

  document.getElementById('edit-modal').classList.remove('hidden');
}

// 수정 모달 닫기
function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  currentEditId = null;
}

// 수정사항 저장
async function saveEditTarget() {
  if (!currentEditId) return;

  const title = document.getElementById('edit-title').value.trim();
  const url = document.getElementById('edit-url').value.trim();
  const cssSelector = document.getElementById('edit-selector').value.trim();
  const conditionType = document.getElementById('edit-condition').value;
  const targetValStr = document.getElementById('edit-target-val').value.trim();
  const targetVal = conditionType === 'changed' || targetValStr === '' ? null : parseFloat(targetValStr);
  const updatedData = {
    title,
    url,
    css_selector: cssSelector,
    condition_type: conditionType,
    target_value: targetVal
  };

  if (supabaseClient && !currentEditId.toString().startsWith('local_')) {
    try {
      const userId = await getCurrentUserId();
      const { error } = await supabaseClient
        .from('targets')
        .update(updatedData)
        .eq('id', currentEditId)
        .eq('user_id', userId);
      if (error) throw error;
    } catch (err) {
      console.error(err);
      return;
    }
  }

  const index = targets.findIndex(t => String(t.id) === String(currentEditId));
  if (index !== -1) {
    targets[index] = { ...targets[index], ...updatedData };
  }

  renderTargets();
  closeEditModal();
}

// 항목 삭제
function handleDeleteTarget(id) {
  currentDeleteId = id;
  document.getElementById('delete-modal').classList.remove('hidden');
}

function closeDeleteModal() {
  document.getElementById('delete-modal').classList.add('hidden');
  currentDeleteId = null;
}

async function confirmDeleteTarget() {
  if (!currentDeleteId) return;

  const id = currentDeleteId;
  if (supabaseClient && !id.toString().startsWith('local_')) {
    try {
      const userId = await getCurrentUserId();
      const { error } = await supabaseClient
        .from('targets')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
      if (error) throw error;
    } catch (err) {
      console.error(err);
      return;
    }
  }

  targets = targets.filter(t => String(t.id) !== String(id));
  renderTargets();
  closeDeleteModal();
}

// 헬퍼 함수
function getConditionText(condition) {
  switch (condition) {
    case 'changed': return '지표값 변동 감지';
    case 'gte': return '설정값 상향 돌파';
    case 'lte': return '설정값 하향 돌파';
    case 'cross': return '설정값 상/하향 돌파';
    default: return condition;
  }
}

function getOriginalUrl(item) {
  const url = item?.url || '';
  if (url.includes('api.stlouisfed.org/fred/series/observations')) {
    try {
      const seriesId = new URL(url).searchParams.get('series_id');
      if (seriesId) return `https://fred.stlouisfed.org/series/${encodeURIComponent(seriesId)}`;
    } catch (err) {
      console.error('FRED URL Parse Error:', err);
    }
  }
  if (url.includes('ecos.bok.or.kr/api/StatisticSearch/')) {
    return 'https://ecos.bok.or.kr/';
  }
  return url;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
