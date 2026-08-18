const SUPABASE_URL = "https://xhghpywvthjuvespzdul.supabase.co";
const SUPABASE_KEY = "sb_publishable_rPKY5Wfpp1JnSkPhIzJqJA_cijBqYgc";
const FRED_API_KEY = "12ce2a29eb8e65de769bb88cc9deb4b0";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 탭 전환 함수
function switchTab(tabName) {
  const trackerBtn = document.getElementById('tab-btn-tracker');
  const newsBtn = document.getElementById('tab-btn-news');
  const trackerContent = document.getElementById('tab-content-tracker');
  const newsContent = document.getElementById('tab-content-news');

  if (tabName === 'tracker') {
    trackerBtn.className = "px-5 py-3 text-sm font-bold text-blue-400 border-b-2 border-blue-500 transition flex items-center gap-2";
    newsBtn.className = "px-5 py-3 text-sm font-bold text-slate-400 border-b-2 border-transparent hover:text-slate-200 transition flex items-center gap-2";
    trackerContent.classList.remove('hidden');
    newsContent.classList.add('hidden');
  } else if (tabName === 'news') {
    newsBtn.className = "px-5 py-3 text-sm font-bold text-blue-400 border-b-2 border-blue-500 transition flex items-center gap-2";
    trackerBtn.className = "px-5 py-3 text-sm font-bold text-slate-400 border-b-2 border-transparent hover:text-slate-200 transition flex items-center gap-2";
    newsContent.classList.remove('hidden');
    trackerContent.classList.add('hidden');
  }
}

// 입력 필드 토글 함수
function toggleTypeFields() {
  const type = document.getElementById('input-type').value;
  document.getElementById('field-selector').classList.toggle('hidden', type !== 'SELECTOR');
  document.getElementById('field-fred').classList.toggle('hidden', type !== 'FRED');
  document.getElementById('field-api').classList.toggle('hidden', type !== 'API');
}

// 페이지 로드 시 DB 상태 확인 및 목록 조회
window.addEventListener('DOMContentLoaded', async () => {
  const statusBadge = document.getElementById('db-status');
  try {
    const { error } = await supabaseClient.from('targets').select('*').limit(1);
    if (error) throw error;
    statusBadge.className = "px-3 py-1.5 rounded-full text-xs font-semibold bg-green-950/60 text-green-400 border border-green-700/50 flex items-center gap-2";
    statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-green-400"></span> DB 연결 성공`;
    fetchTargets();
  } catch (err) {
    statusBadge.className = "px-3 py-1.5 rounded-full text-xs font-semibold bg-red-950/60 text-red-400 border border-red-700/50 flex items-center gap-2";
    statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-400"></span> DB 연결 실패`;
  }
});

// 데이터 등록 함수
async function handleAddTarget(e) {
  e.preventDefault();
  const type = document.getElementById('input-type').value;
  const title = document.getElementById('input-title').value.trim();
  const condition_type = document.getElementById('input-condition').value;
  const target_value_raw = document.getElementById('input-target-val').value.trim();
  const target_value = target_value_raw !== "" ? parseFloat(target_value_raw) : null;

  let url = '', css_selector = '';

  if (type === 'FRED') {
    const seriesId = document.getElementById('input-fred-id').value.trim().toUpperCase();
    url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=1`;
    css_selector = 'API:observations[0].value';
  } else if (type === 'API') {
    url = document.getElementById('input-api-url').value.trim();
    css_selector = `API:${document.getElementById('input-json-path').value.trim()}`;
  } else {
    url = document.getElementById('input-url').value.trim();
    css_selector = document.getElementById('input-selector').value.trim();
  }

  const { count, error: countError } = await supabaseClient
    .from('targets')
    .select('*', { count: 'exact', head: true });

  const nextOrder = countError || count === null ? 0 : count;

  const { error } = await supabaseClient.from('targets').insert([{ 
    title, url, css_selector, condition_type, target_value, display_order: nextOrder, is_active: true 
  }]);

  if (error) return alert('등록 실패: ' + error.message);
  
  alert('성공적으로 등록되었습니다!');
  document.getElementById('add-form').reset();
  toggleTypeFields();
  fetchTargets();
}

// 드래그 앤 드롭 순서 변경 관련 변수 및 함수
let draggedItem = null;

function handleDragStart(e) {
  const id = this.getAttribute('data-id');
  const editSection = document.getElementById(`edit-${id}`);
  if (editSection && !editSection.classList.contains('hidden')) {
    e.preventDefault();
    return;
  }
  draggedItem = this;
  this.classList.add('opacity-40', 'border-dashed', 'border-blue-500');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(e) { this.classList.add('bg-slate-800/80'); }
function handleDragLeave(e) { this.classList.remove('bg-slate-800/80'); }

function handleDrop(e) {
  e.stopPropagation();
  if (draggedItem !== this) {
    const listContainer = document.getElementById('target-list');
    const items = Array.from(listContainer.querySelectorAll('.draggable-item'));
    const draggedIdx = items.indexOf(draggedItem);
    const targetIdx = items.indexOf(this);

    if (draggedIdx < targetIdx) {
      listContainer.insertBefore(draggedItem, this.nextSibling);
    } else {
      listContainer.insertBefore(draggedItem, this);
    }
    saveNewOrder();
  }
  return false;
}

function handleDragEnd(e) {
  this.classList.remove('opacity-40', 'border-dashed', 'border-blue-500');
  document.querySelectorAll('.draggable-item').forEach(item => {
    item.classList.remove('bg-slate-800/80');
  });
}

async function saveNewOrder() {
  const listContainer = document.getElementById('target-list');
  const itemElements = listContainer.querySelectorAll('.draggable-item');
  const updatePromises = Array.from(itemElements).map((el, index) => {
    const id = parseInt(el.getAttribute('data-id'));
    return supabaseClient.from('targets').update({ display_order: index }).eq('id', id);
  });
  await Promise.all(updatePromises);
}
  
// 리스트 목록 불러오기 및 렌더링
async function fetchTargets() {
  const listContainer = document.getElementById('target-list');
  try {
    const { data, error } = await supabaseClient.from('targets').select('*').order('display_order', { ascending: true });
    if (error) throw error;

    if (!data || data.length === 0) {
      listContainer.innerHTML = `<p class="text-sm text-slate-500 py-4 text-center"><i class="fa-solid fa-circle-info mr-2"></i>등록된 추적 항목이 없습니다.</p>`;
      return;
    }

    const condConfig = {
      'changed': { label: '단순 값 변경 시', icon: 'fa-rotate' },
      'gte': { label: '목표값 상향 돌파 시', icon: 'fa-arrow-trend-up' },
      'lte': { label: '목표값 하향 돌파 시', icon: 'fa-arrow-trend-down' },
      'eq': { label: '목표값 일치 시', icon: 'fa-equals' }
    };

    listContainer.innerHTML = data.map((item) => {
      const config = condConfig[item.condition_type] || { label: item.condition_type, icon: 'fa-bell' };
      const targetValStr = item.target_value !== null && item.target_value !== undefined ? ` (${item.target_value})` : '';
      
      const isActive = item.is_active !== false;
      const bellColorClass = isActive ? "text-amber-500 bg-amber-500/10 border-amber-500/30" : "text-slate-600 bg-slate-950 border-slate-800";
      const bellIconClass = isActive ? "fa-bell" : "fa-bell-slash";
      const bellTitle = isActive ? "알림 켜짐 (클릭하여 끄기)" : "알림 꺼짐 (클릭하여 켜기)";
      
      let displayUrl = item.url;
      let isFred = false;
      let fredSeriesId = '';

      if (item.url && item.url.includes('stlouisfed.org/fred/series/observations')) {
        isFred = true;
        const match = item.url.match(/series_id=([^&]+)/);
        if (match && match[1]) {
          fredSeriesId = match[1];
          displayUrl = `https://fred.stlouisfed.org/series/${fredSeriesId}`;
        }
      }

      const safeSelector = (item.css_selector || '').replace(/"/g, '&quot;');

      return `
        <div class="draggable-item border-b border-slate-800/80 last:border-b-0 py-3 transition-all rounded-lg px-2 cursor-grab active:cursor-grabbing" 
             draggable="true" data-id="${item.id}">
          <div class="flex justify-between items-center" onclick="toggleEdit(${item.id})">
            <div class="flex-1 pr-4 group">
              <div class="flex items-center">
                <i class="fa-solid fa-grip-vertical text-slate-600 mr-2.5 text-xs hover:text-slate-400" title="마우스로 끌어서 순서 변경"></i>
                <span class="font-bold text-slate-200 group-hover:text-blue-400 transition mr-2">${item.title}</span>
                <a href="${displayUrl}" target="_blank" onclick="event.stopPropagation()" class="text-xs text-slate-500 hover:text-blue-400 bg-slate-800/80 hover:bg-slate-800 px-2 py-0.5 rounded border border-slate-700 transition" title="원본 페이지로 이동">
                  <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i> 원본
                </a>
              </div>
              <div class="text-xs text-slate-400 mt-1 ml-5 flex items-center">
                <i class="fa-solid ${config.icon} mr-1.5 text-[10px] text-blue-400"></i>
                감지 조건: <span class="text-slate-300 ml-1 font-medium">${config.label}${targetValStr}</span>
              </div>
            </div>
            
            <div class="flex items-center gap-3" onclick="event.stopPropagation()">
              <span class="text-xs text-slate-400">최근: <strong class="text-slate-200">${item.last_value || '대기 중'}</strong></span>
              <button onclick="toggleAlertBell(${item.id}, this)" class="${bellColorClass} p-1.5 rounded-lg border transition" title="${bellTitle}">
                <i class="fa-solid ${bellIconClass} text-xs"></i>
              </button>
            </div>
          </div>

          <div id="edit-${item.id}" class="hidden mt-3 pt-3 bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-3 cursor-default" onclick="event.stopPropagation()">
            <div>
              <label class="text-[11px] text-slate-400 block mb-1 font-medium">항목 이름 수정</label>
              <input type="text" id="val-title-${item.id}" value="${item.title}" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-white">
            </div>
            
            ${isFred ? `
            <div>
              <label class="text-[11px] text-slate-400 block mb-1 font-medium">FRED Series ID</label>
              <input type="text" id="val-fred-id-${item.id}" value="${fredSeriesId}" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-white font-mono">
            </div>
            ` : `
            <div>
              <label class="text-[11px] text-slate-400 block mb-1 font-medium">웹사이트 URL</label>
              <input type="text" id="val-url-${item.id}" value="${item.url}" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-300">
            </div>
            <div>
              <label class="text-[11px] text-slate-400 block mb-1 font-medium">CSS Selector</label>
              <input type="text" id="val-selector-${item.id}" value="${safeSelector}" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-300 font-mono">
            </div>
            `}

            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-[11px] text-slate-400 block mb-1 font-medium">감지 조건</label>
                <select id="val-cond-${item.id}" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-300">
                  <option value="changed" ${item.condition_type === 'changed' ? 'selected' : ''}>단순 값 변경 시</option>
                  <option value="gte" ${item.condition_type === 'gte' ? 'selected' : ''}>목표값 상향 돌파 시</option>
                  <option value="lte" ${item.condition_type === 'lte' ? 'selected' : ''}>목표값 하향 돌파 시</option>
                  <option value="eq" ${item.condition_type === 'eq' ? 'selected' : ''}>목표값 일치 시</option>
                </select>
              </div>
              <div>
                <label class="text-[11px] text-slate-400 block mb-1 font-medium">목표값</label>
                <input type="text" id="val-target-${item.id}" value="${item.target_value !== null && item.target_value !== undefined ? item.target_value : ''}" class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-white" placeholder="예: 4.8">
              </div>
            </div>
            <div class="flex justify-end gap-2 pt-1">
              <button onclick="toggleEdit(${item.id})" class="text-xs px-3 py-1.5 bg-slate-800 text-slate-300 rounded hover:bg-slate-700 transition">취소</button>
              <button onclick="saveEdit(${item.id}, ${isFred})" class="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium transition">저장하기</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    listContainer.querySelectorAll('.draggable-item').forEach(item => {
      item.addEventListener('dragstart', handleDragStart);
      item.addEventListener('dragover', handleDragOver);
      item.addEventListener('dragenter', handleDragEnter);
      item.addEventListener('dragleave', handleDragLeave);
      item.addEventListener('drop', handleDrop);
      item.addEventListener('dragend', handleDragEnd);
    });
  } catch (err) {
    listContainer.innerHTML = `<p class="text-sm text-red-400 py-4 text-center">목록을 불러오는 중 오류가 발생했습니다.</p>`;
  }
}

function toggleEdit(id) {
  const editSection = document.getElementById(`edit-${id}`);
  if (!editSection) return;
  const itemCard = editSection.closest('.draggable-item');
  const isHidden = editSection.classList.contains('hidden');
  editSection.classList.toggle('hidden');
  if (isHidden) {
    itemCard.setAttribute('draggable', 'false');
    itemCard.classList.remove('cursor-grab', 'active:cursor-grabbing');
  } else {
    itemCard.setAttribute('draggable', 'true');
    itemCard.classList.add('cursor-grab', 'active:cursor-grabbing');
  }
}

async function toggleAlertBell(id, btnElement) {
  const icon = btnElement.querySelector('i');
  const isOn = icon.classList.contains('fa-bell');
  const newActiveState = !isOn; 

  const { error } = await supabaseClient
    .from('targets')
    .update({ is_active: newActiveState })
    .eq('id', id);

  if (error) {
    alert('알림 상태 변경 중 오류가 발생했습니다: ' + error.message);
    return;
  }

  if (isOn) {
    icon.classList.remove('fa-bell', 'text-amber-500');
    icon.classList.add('fa-bell-slash', 'text-slate-600');
    btnElement.classList.remove('bg-amber-500/10', 'border-amber-500/30');
    btnElement.classList.add('bg-slate-950', 'border-slate-800');
    btnElement.title = "알림 꺼짐 (클릭하여 켜기)";
  } else {
    icon.classList.remove('fa-bell-slash', 'text-slate-600');
    icon.classList.add('fa-bell', 'text-amber-500');
    btnElement.classList.remove('bg-slate-950', 'border-slate-800');
    btnElement.classList.add('bg-amber-500/10', 'border-amber-500/30');
    btnElement.title = "알림 켜짐 (클릭하여 끄기)";
  }
}

async function saveEdit(id, isFred) {
  const title = document.getElementById(`val-title-${id}`).value.trim();
  const condition_type = document.getElementById(`val-cond-${id}`).value;
  const target_value_raw = document.getElementById(`val-target-${id}`).value.trim();
  const target_value = target_value_raw !== "" ? parseFloat(target_value_raw) : null;

  let url = '', css_selector = '';

  if (isFred) {
    const seriesId = document.getElementById(`val-fred-id-${id}`).value.trim().toUpperCase();
    url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=1`;
    css_selector = 'API:observations[0].value';
  } else {
    url = document.getElementById(`val-url-${id}`).value.trim();
    css_selector = document.getElementById(`val-selector-${id}`).value.trim();
  }

  const { data: currentItem, error: fetchError } = await supabaseClient.from('targets').select('display_order').eq('id', id).single();
  if (fetchError) return alert('기존 순서 정보를 가져오지 못했습니다.');

  const { error } = await supabaseClient.from('targets').update({ 
    title, url, css_selector, condition_type, target_value, display_order: currentItem.display_order ?? 0 
  }).eq('id', id);

  if (error) {
    alert('수정 실패: ' + error.message);
  } else {
    toggleEdit(id);
    fetchTargets();
  }
}
