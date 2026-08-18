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
let draggedItemIndex = null;

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
    <div class="py-3 flex items-center justify-between gap-3 group border-b border-slate-800/80 last:border-0 hover:bg-slate-800/30 px-2 rounded-lg transition"
         draggable="true"
         ondragstart="handleDragStart(event, ${index})"
         ondragover="handleDragOver(event)"
         ondrop="handleDrop(event, ${index})"
         ondragend="handleDragEnd(event)">
      <div class="flex items-center gap-3 min-w-0">
        <i class="fa-solid fa-grip-vertical text-slate-600 hover:text-slate-400 cursor-grab active:cursor-grabbing px-1"></i>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-white truncate">${escapeHtml(item.title)}</span>
            ${item.url ? `<a href="${escapeHtml(getOriginalUrl(item))}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center px-2 py-1 rounded text-xs text-slate-400 bg-slate-800 hover:text-blue-400 transition" title="원본 사이트 열기">링크</a>` : ''}
          </div>
          <p class="text-xs text-slate-400 mt-0.5 truncate">
            조건: <span class="text-slate-300 font-mono">${getConditionText(item.condition_type)}</span>
            ${item.target_value !== null && item.target_value !== undefined ? `| 목표값: <span class="text-blue-400 font-mono">${item.target_value}</span>` : ''}
          </p>
        </div>
      </div>
      <div class="flex items-center gap-3 shrink-0">
        <div class="flex items-center gap-1 opacity-90 sm:opacity-0 group-hover:opacity-100 transition">
          <button onclick="openEditModal('${item.id}')" class="p-2 text-slate-400 hover:text-blue-400 transition" title="수정">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button onclick="handleDeleteTarget('${item.id}')" class="p-2 text-slate-400 hover:text-red-400 transition" title="삭제">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
        <div class="text-right">
          <span class="block text-[10px] text-slate-500">현재값</span>
          <span class="block text-sm font-bold text-blue-400 font-mono">${item.last_value ?? '—'}</span>
        </div>
      </div>
    </div>
  `).join('');
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
  const item = targets.find(t => t.id === id);
  if (!item) return;

  currentEditId = id;
  document.getElementById('edit-title').value = item.title;
  document.getElementById('edit-type').value = item.type;
  document.getElementById('edit-condition').value = item.condition;
  document.getElementById('edit-target-val').value = item.target_value ?? '';

  toggleEditTypeFields();

  if (item.type === 'SELECTOR') {
    document.getElementById('edit-url').value = item.config?.url || '';
    document.getElementById('edit-selector').value = item.config?.selector || '';
  } else if (item.type === 'FRED') {
    document.getElementById('edit-fred-id').value = item.config?.fred_id || '';
  } else if (item.type === 'BOK') {
    document.getElementById('edit-bok-code').value = item.config?.bok_code || '';
  } else if (item.type === 'API') {
    document.getElementById('edit-api-url').value = item.config?.api_url || '';
    document.getElementById('edit-json-path').value = item.config?.json_path || '';
  }

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
  const type = document.getElementById('edit-type').value;
  const condition = document.getElementById('edit-condition').value;
  const targetValStr = document.getElementById('edit-target-val').value.trim();
  const targetVal = targetValStr !== '' ? parseFloat(targetValStr) : null;

  let config = {};
  if (type === 'SELECTOR') {
    config = { url: document.getElementById('edit-url').value.trim(), selector: document.getElementById('edit-selector').value.trim() };
  } else if (type === 'FRED') {
    const seriesId = document.getElementById('edit-fred-id').value.trim().toUpperCase();
    config = { 
      fred_id: seriesId, 
      api_key: FRED_API_KEY,
      url: `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=1`
    };
  } else if (type === 'BOK') {
    const bokCode = document.getElementById('edit-bok-code').value.trim();
    config = { bok_code: bokCode, api_key: ECOS_API_KEY, ecos_url: buildEcosUrl(bokCode) };
  } else if (type === 'API') {
    config = { api_url: document.getElementById('edit-api-url').value.trim(), json_path: document.getElementById('edit-json-path').value.trim() };
  }

  const updatedData = { title, type, condition, target_value: targetVal, config };

  if (supabaseClient && !currentEditId.toString().startsWith('local_')) {
    try {
      const { error } = await supabaseClient.from('targets').update(updatedData).eq('id', currentEditId);
      if (error) throw error;
    } catch (err) {
      console.error(err);
    }
  }

  const index = targets.findIndex(t => t.id === currentEditId);
  if (index !== -1) {
    targets[index] = { ...targets[index], ...updatedData };
  }

  renderTargets();
  closeEditModal();
}

// 항목 삭제
async function handleDeleteTarget(id) {
  if (!confirm('정말 삭제하시겠습니까?')) return;

  if (supabaseClient && !id.toString().startsWith('local_')) {
    try {
      await supabaseClient.from('targets').delete().eq('id', id);
    } catch (err) {
      console.error(err);
    }
  }

  targets = targets.filter(t => t.id !== id);
  renderTargets();
}

// 헬퍼 함수
function getConditionText(condition) {
  switch (condition) {
    case 'changed': return '단순 변경';
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
