// Supabase 및 API 설정
const SUPABASE_URL = 'https://xhghpywvthjuvespzdul.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rPKY5Wfpp1JnSkPhIzJqJA_cijBqYgc';
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// FRED & ECOS API 키 설정
const FRED_API_KEY = '12ce2a29eb8e65de769bb88cc9deb4b0'; 
const ECOS_API_KEY = 'J3ECOLI9TGA6E8G39H40'; // 한국은행 ECOS API 키

// 상태 관리
let targets = [];
let currentEditId = null;
let currentDeleteId = null;
let draggedItemIndex = null;
let expandedTargetId = null;

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  checkDbConnection();
  fetchTargets();
});

// DB 연결 상태 확인 (Publishable Key 호환 수정)
async function checkDbConnection() {
  const statusEl = document.getElementById('db-status');
  if (!supabaseClient) {
    if (statusEl) {
      statusEl.className = "px-3 py-1.5 rounded-full text-xs font-semibold bg-red-950/60 text-red-400 border border-red-700/50 flex items-center gap-2 shadow-inner";
      statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-400"></span> DB 설정 필요`;
    }
    return;
  }
  try {
    // Publishable Key 호환을 위한 호환성 쿼리
    const { error } = await supabaseClient.from('targets').select('id').limit(1);
    if (error) throw error;
    
    if (statusEl) {
      statusEl.className = "px-3 py-1.5 rounded-full text-xs font-semibold bg-green-950/60 text-green-400 border border-green-700/50 flex items-center gap-2 shadow-inner";
      statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-green-400"></span> DB 연결 완료`;
    }
  } catch (err) {
    console.error('Supabase Connection Error:', err);
    if (statusEl) {
      statusEl.className = "px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-950/60 text-amber-400 border border-amber-700/50 flex items-center gap-2 shadow-inner";
      statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400"></span> 로컬 모드`;
    }
  }
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

// 등록 폼 타입 선택 처리
function toggleTypeFields() {
  const type = document.getElementById('input-type').value;
  document.getElementById('field-selector').classList.toggle('hidden', type !== 'SELECTOR');
  document.getElementById('field-fred').classList.toggle('hidden', type !== 'FRED');
  document.getElementById('field-bok').classList.toggle('hidden', type !== 'BOK');
  document.getElementById('field-api').classList.toggle('hidden', type !== 'API');
}

// 수정 모달 타입 선택 처리
function toggleEditTypeFields() {
  const type = document.getElementById('edit-type').value;
  document.getElementById('edit-field-selector').classList.toggle('hidden', type !== 'SELECTOR');
  document.getElementById('edit-field-fred').classList.toggle('hidden', type !== 'FRED');
  document.getElementById('edit-field-bok').classList.toggle('hidden', type !== 'BOK');
  document.getElementById('edit-field-api').classList.toggle('hidden', type !== 'API');
}

// ECOS API URL 생성 헬퍼 함수
function buildEcosUrl(bokCode, cycle = 'M', startPeriod = '202601', endPeriod = '202612') {
  return `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_API_KEY}/json/kr/1/10/${bokCode}/${cycle}/${startPeriod}/${endPeriod}`;
}

// 추적 목록 조회
async function fetchTargets() {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('targets')
        .select('*')
        .order('display_order', { ascending: true, nullsFirst: false });
      if (!error && data) {
        targets = data;
        renderTargets();
        return;
      }
    } catch (e) {
      console.error(e);
    }
  }
  renderTargets();
}

// 추적 목록 렌더링
function renderTargets() {
  const listEl = document.getElementById('target-list');
  if (!listEl) return;

  if (targets.length === 0) {
    listEl.innerHTML = `<p class="text-sm text-slate-500 py-6 text-center"><i class="fa-solid fa-circle-info mr-2"></i>등록된 추적 항목이 없습니다.</p>`;
    return;
  }

  listEl.innerHTML = targets.map((item, index) => `
    <div class="py-3 border-b border-slate-800/80 last:border-0">
      <div class="flex items-center justify-between gap-3 px-2 rounded-lg hover:bg-slate-800/30 transition"
           draggable="true"
           ondragstart="handleDragStart(event, ${index})"
           ondragover="handleDragOver(event)"
           ondrop="handleDrop(event, ${index})"
           ondragend="handleDragEnd(event)">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <i class="fa-solid fa-grip-vertical text-slate-600 hover:text-slate-400 cursor-grab active:cursor-grabbing px-1"></i>
          <button type="button" onclick="toggleTargetDetails('${item.id}')" class="min-w-0 flex-1 py-3 text-left">
            <span class="flex items-center gap-2">
              <span class="text-sm font-bold text-white truncate">${escapeHtml(item.title)}</span>
              <i class="fa-solid ${String(item.id) === expandedTargetId ? 'fa-chevron-up' : 'fa-chevron-down'} text-[10px] text-slate-500"></i>
            </span>
            <span class="block text-xs text-slate-400 mt-0.5 truncate">
              조건: <span class="text-slate-300 font-mono">${getConditionText(item.condition_type)}</span>
              ${item.target_value !== null && item.target_value !== undefined ? `| 목표값: <span class="text-blue-400 font-mono">${item.target_value}</span>` : ''}
            </span>
          </button>
          ${item.url ? `<a href="${escapeHtml(getOriginalUrl(item))}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-blue-500/30 bg-blue-500/10 text-[11px] font-semibold text-blue-300 hover:bg-blue-500/20 hover:text-blue-100 transition whitespace-nowrap" title="사이트 열기"><i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i><span>출처</span></a>` : ''}
        </div>
        <div class="shrink-0 text-right">
          <span class="block text-[10px] text-slate-500">현재값</span>
          <span class="block text-sm font-bold text-blue-400 font-mono">${item.last_value ?? '—'}</span>
        </div>
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
  `).join('');
}

function toggleTargetDetails(id) {
  const targetId = String(id);
  expandedTargetId = expandedTargetId === targetId ? null : targetId;
  renderTargets();
}

// 드래그 앤 드롭 핸들러
function handleDragStart(e, index) {
  draggedItemIndex = index;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.classList.add('opacity-40');
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDrop(e, targetIndex) {
  e.preventDefault();
  if (draggedItemIndex === null || draggedItemIndex === targetIndex) return;

  const movedItem = targets.splice(draggedItemIndex, 1)[0];
  targets.splice(targetIndex, 0, movedItem);

  targets.forEach((item, idx) => {
    item.display_order = idx;
  });

  renderTargets();
  saveOrderToDb();
}

function handleDragEnd(e) {
  e.currentTarget.classList.remove('opacity-40');
  draggedItemIndex = null;
}

// 순서 변경 사항 DB 저장
async function saveOrderToDb() {
  if (!supabaseClient) return;

  for (let i = 0; i < targets.length; i++) {
    await supabaseClient
      .from('targets')
      .update({ display_order: i })
      .eq('id', targets[i].id);
  }
}

// 추적 항목 추가
async function handleAddTarget(e) {
  e.preventDefault();

  const title = document.getElementById('input-title').value.trim();
  const type = document.getElementById('input-type').value;
  const condition = document.getElementById('input-condition').value;
  const targetValStr = document.getElementById('input-target-val').value.trim();
  const targetVal = targetValStr !== '' ? parseFloat(targetValStr) : null;

  let config = {};
  if (type === 'SELECTOR') {
    config = { url: document.getElementById('input-url').value.trim(), selector: document.getElementById('input-selector').value.trim() };
  } else if (type === 'FRED') {
    const seriesId = document.getElementById('input-fred-id').value.trim().toUpperCase();
    config = { 
      fred_id: seriesId, 
      api_key: FRED_API_KEY,
      url: `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=1`
    };
  } else if (type === 'BOK') {
    const bokCode = document.getElementById('input-bok-code').value.trim();
    config = { bok_code: bokCode, api_key: ECOS_API_KEY, ecos_url: buildEcosUrl(bokCode) };
  } else if (type === 'API') {
    config = { api_url: document.getElementById('input-api-url').value.trim(), json_path: document.getElementById('input-json-path').value.trim() };
  }

  const newItem = {
    id: 'local_' + Date.now(),
    title,
    type,
    condition,
    target_value: targetVal,
    config,
    display_order: targets.length
  };

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('targets')
        .insert([{
          title,
          type,
          condition,
          target_value: targetVal,
          config,
          display_order: targets.length
        }])
        .select();

      if (!error && data) {
        targets.push(data[0]);
        renderTargets();
        document.getElementById('add-form').reset();
        toggleTypeFields();
        return;
      } else if (error) {
        alert('등록 실패: ' + error.message);
        return;
      }
    } catch (err) {
      console.error(err);
    }
  }

  targets.push(newItem);
  renderTargets();
  document.getElementById('add-form').reset();
  toggleTypeFields();
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
  const targetVal = targetValStr !== '' ? parseFloat(targetValStr) : null;
  const updatedData = {
    title,
    url,
    css_selector: cssSelector,
    condition_type: conditionType,
    target_value: targetVal
  };

  if (supabaseClient && !currentEditId.toString().startsWith('local_')) {
    try {
      const { error } = await supabaseClient.from('targets').update(updatedData).eq('id', currentEditId);
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
      const { error } = await supabaseClient.from('targets').delete().eq('id', id);
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
    case 'changed': return '값 변동 감지';
    case 'gte': return '목표값 상향 돌파';
    case 'lte': return '목표값 하향 돌파';
    case 'cross': return '목표값 상/하향 돌파';
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
  return url;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
