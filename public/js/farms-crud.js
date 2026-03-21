// public/js/farms-crud.js

const FARM_API    = '/api/farms';
const CO_API      = '/api/farms/feed-companies';
const MG_API      = '/api/farms/managers';

// ── 유틸 ──────────────────────────────────────────────────
function toDateInput(s) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}
function fmtDate(s) {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}
function get(id) { return document.getElementById(id); }

// ── 탭 전환 ───────────────────────────────────────────────
document.querySelectorAll('.ls-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ls-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.ls-tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab)?.classList.add('active');
    if (btn.dataset.tab === 'farms') loadFarms();
    if (btn.dataset.tab === 'companies') loadCompanies();
    if (btn.dataset.tab === 'managers') { loadManagers(); loadCompanySelects(); }
  });
});

// ── 사료회사 select 채우기 ─────────────────────────────────
let _companies = [];
let _managers  = [];

async function loadCompanySelects() {
  const r = await fetch(CO_API, { credentials: 'include' });
  const d = await r.json();
  _companies = d.data || [];

  ['fn-company', 'mg-company'].forEach(id => {
    const sel = get(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">-- 선택 안 함 --</option>';
    _companies.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.company_name;
      sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
  });
}

async function loadManagerSelect() {
  if (!_managers.length) {
    const r = await fetch(MG_API, { credentials: 'include' });
    const d = await r.json();
    _managers = d.data || [];
  }
  filterManagerSelect();
}

function filterManagerSelect() {
  const sel = get('fn-manager');
  if (!sel) return;
  const selectedCompanyId = get('fn-company')?.value || '';
  const prev = sel.value;

  sel.innerHTML = '<option value="">-- 선택 안 함 --</option>';
  const filtered = selectedCompanyId
    ? _managers.filter(m => String(m.feed_company_id) === selectedCompanyId)
    : _managers;

  filtered.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.manager_name + (m.company_name ? ` (${m.company_name})` : '');
    sel.appendChild(opt);
  });

  // 이전 선택값이 필터 결과에 있으면 유지, 없으면 초기화
  if (prev && filtered.some(m => String(m.id) === prev)) sel.value = prev;
}

// ═══════════════════════════════════════════════════════════
// 농장
// ═══════════════════════════════════════════════════════════
async function loadFarms() {
  const tbody = get('farm-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="12" class="ls-empty">로딩 중...</td></tr>';

  try {
    const r = await fetch(FARM_API, { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { farms } = await r.json();

    if (!farms.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="ls-empty">등록된 농장이 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    farms.forEach(f => appendFarmRow(f, tbody));
    window.initTableSort?.();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="12" class="ls-empty" style="color:#d9534f;">${err.message}</td></tr>`;
  }
}

function appendFarmRow(f, tbody) {
  const id = f.농장ID;
  const tr = document.createElement('tr');
  tr.dataset.id = id;

  // 읽기 전용 셀
  const cells = [
    { val: id,           key: 'id',             readonly: true },
    { val: f.농장명,      key: '농장명' },
    { val: f.지역,        key: '지역' },
    { val: f.농장주,      key: '농장주' },
    { val: f.owner_email, key: 'owner_email',   type: 'email' },
    { val: f.사료회사,    key: '사료회사',       fkId: f.feed_company_id, fkKey: 'feed_company_id' },
    { val: f.관리자,      key: '관리자',         fkId: f.manager_id, fkKey: 'manager_id' },
    { val: f.계약상태,    key: '계약상태' },
    { val: fmtDate(f.계약시작일), key: '계약시작일', type: 'date', rawVal: toDateInput(f.계약시작일) },
    { val: fmtDate(f.계약종료일), key: '계약종료일', type: 'date', rawVal: toDateInput(f.계약종료일) },
  ];

  cells.forEach(c => {
    const td = document.createElement('td');
    td.textContent = c.val ?? '';
    td.dataset.key = c.key;
    td.dataset.val = c.rawVal ?? (c.val ?? '');
    if (c.fkId)  td.dataset.fkId  = c.fkId;
    if (c.fkKey) td.dataset.fkKey = c.fkKey;
    if (c.type)  td.dataset.type  = c.type;
    if (c.readonly) td.dataset.readonly = '1';
    tr.appendChild(td);
  });

  // 수정 버튼
  const tdE = document.createElement('td');
  const btnE = document.createElement('button');
  btnE.className = 'ls-btn ls-btn-teal';
  btnE.innerHTML = '<i class="fa-solid fa-pen"></i>';
  btnE.onclick = () => enterFarmEdit(tr, f);
  tdE.appendChild(btnE);
  tr.appendChild(tdE);

  // 삭제 버튼
  const tdD = document.createElement('td');
  const btnD = document.createElement('button');
  btnD.className = 'ls-btn ls-btn-red';
  btnD.innerHTML = '<i class="fa-solid fa-trash"></i>';
  btnD.onclick = () => deleteFarm(id);
  tdD.appendChild(btnD);
  tr.appendChild(tdD);

  tbody.appendChild(tr);
}

function enterFarmEdit(tr, f) {
  // 이미 편집 중인 다른 행 취소
  document.querySelectorAll('#farm-tbody tr.editing').forEach(r => { if (r !== tr) loadFarms(); });
  tr.classList.add('editing');

  const dataCells = [...tr.querySelectorAll('td[data-key]')];
  dataCells.forEach(td => {
    if (td.dataset.readonly === '1') return;

    const key  = td.dataset.key;
    const type = td.dataset.type || 'text';

    // FK 셀 (사료회사, 관리자) → select
    if (td.dataset.fkKey) {
      const sel = document.createElement('select');
      sel.style.width = '100%';
      sel.innerHTML = '<option value="">-- 선택 안 함 --</option>';
      const list = td.dataset.fkKey === 'feed_company_id' ? _companies : _managers;
      list.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item.manager_name
          ? item.manager_name + (item.company_name ? ` (${item.company_name})` : '')
          : item.company_name;
        if (String(item.id) === String(td.dataset.fkId)) opt.selected = true;
        sel.appendChild(opt);
      });
      td.innerHTML = '';
      td.appendChild(sel);
      return;
    }

    const input = document.createElement('input');
    input.type = type;
    input.value = td.dataset.val;
    input.style.width = '100%';
    td.innerHTML = '';
    td.appendChild(input);
  });

  // 수정 → 저장 버튼
  const btnCell = tr.children[tr.children.length - 2];
  btnCell.innerHTML = '';
  const btnSave = document.createElement('button');
  btnSave.className = 'ls-btn ls-btn-primary';
  btnSave.textContent = '저장';
  btnSave.onclick = () => saveFarmEdit(tr);
  btnCell.appendChild(btnSave);

  // 삭제 → 취소 버튼
  const cancelCell = tr.children[tr.children.length - 1];
  cancelCell.innerHTML = '';
  const btnCancel = document.createElement('button');
  btnCancel.className = 'ls-btn ls-btn-gray';
  btnCancel.textContent = '취소';
  btnCancel.onclick = () => loadFarms();
  cancelCell.appendChild(btnCancel);
}

async function saveFarmEdit(tr) {
  const id = tr.dataset.id;
  const body = {};
  [...tr.querySelectorAll('td[data-key]')].forEach(td => {
    if (td.dataset.readonly === '1') return;
    const input = td.querySelector('input,select');
    const val = input ? input.value.trim() : td.dataset.val;
    if (td.dataset.fkKey) {
      body[td.dataset.fkKey] = val || null;
    } else {
      body[td.dataset.key] = val || null;
    }
  });

  try {
    const r = await fetch(`${FARM_API}/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await loadFarms();
    Swal.fire({ icon: 'success', title: '수정 완료', timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire({ icon: 'error', title: '수정 실패', text: err.message });
  }
}

async function addFarm() {
  const 농장명 = get('fn-name')?.value.trim();
  if (!농장명) { Swal.fire({ icon: 'warning', title: '농장명을 입력하세요' }); return; }

  const body = {
    농장명,
    지역:            get('fn-region')?.value.trim() || null,
    농장주:          get('fn-owner')?.value.trim()  || null,
    owner_email:     get('fn-email')?.value.trim()  || null,
    feed_company_id: get('fn-company')?.value       || null,
    manager_id:      get('fn-manager')?.value       || null,
    계약상태:        get('fn-status')?.value.trim() || null,
    계약시작일:      get('fn-start')?.value         || null,
    계약종료일:      get('fn-end')?.value           || null,
  };

  try {
    const r = await fetch(FARM_API, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    ['fn-name','fn-region','fn-owner','fn-email','fn-status','fn-start','fn-end'].forEach(id => { if (get(id)) get(id).value = ''; });
    get('fn-company').value = '';
    get('fn-manager').value = '';
    await loadFarms();
    Swal.fire({ icon: 'success', title: '등록 완료', timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire({ icon: 'error', title: '등록 실패', text: err.message });
  }
}

async function deleteFarm(id) {
  const ok = await Swal.fire({
    title: '농장을 삭제할까요?', text: `ID: ${id}`, icon: 'warning',
    showCancelButton: true, confirmButtonText: '삭제', cancelButtonText: '취소',
    confirmButtonColor: '#d9534f',
  });
  if (!ok.isConfirmed) return;
  try {
    const r = await fetch(`${FARM_API}/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await loadFarms();
    Swal.fire({ icon: 'success', title: '삭제 완료', timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire({ icon: 'error', title: '삭제 실패', text: err.message });
  }
}

// ═══════════════════════════════════════════════════════════
// 사료회사
// ═══════════════════════════════════════════════════════════
async function loadCompanies() {
  const tbody = get('company-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="ls-empty">로딩 중...</td></tr>';

  const r = await fetch(CO_API, { credentials: 'include' });
  const { data } = await r.json();
  _companies = data || [];

  if (!_companies.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="ls-empty">등록된 사료회사가 없습니다.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  _companies.forEach(c => {
    const tr = tbody.insertRow();
    tr.dataset.id = c.id;
    tr.insertCell().textContent = c.id;
    const tdName = tr.insertCell(); tdName.textContent = c.company_name; tdName.dataset.key = 'company_name';
    const tdNote = tr.insertCell(); tdNote.textContent = c.note ?? '';    tdNote.dataset.key = 'note';

    // 수정
    const tdE = tr.insertCell();
    const btnE = document.createElement('button');
    btnE.className = 'ls-btn ls-btn-teal';
    btnE.innerHTML = '<i class="fa-solid fa-pen"></i>';
    btnE.onclick = () => enterSimpleEdit(tr, tdE, tdD, () => saveCompany(tr));
    tdE.appendChild(btnE);

    // 삭제
    const tdD = tr.insertCell();
    const btnD = document.createElement('button');
    btnD.className = 'ls-btn ls-btn-red';
    btnD.innerHTML = '<i class="fa-solid fa-trash"></i>';
    btnD.onclick = () => deleteEntity(CO_API, c.id, loadCompanies, '사료회사');
    tdD.appendChild(btnD);
  });
  window.initTableSort?.();
}

async function saveCompany(tr) {
  const id = tr.dataset.id;
  const body = {};
  [...tr.querySelectorAll('td[data-key]')].forEach(td => {
    const inp = td.querySelector('input');
    body[td.dataset.key] = inp ? inp.value.trim() : td.textContent;
  });
  try {
    const r = await fetch(`${CO_API}/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await loadCompanies();
    Swal.fire({ icon: 'success', title: '수정 완료', timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire({ icon: 'error', title: '수정 실패', text: err.message });
  }
}

async function addCompany() {
  const name = get('co-name')?.value.trim();
  if (!name) { Swal.fire({ icon: 'warning', title: '회사명을 입력하세요' }); return; }
  try {
    const r = await fetch(CO_API, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_name: name, note: get('co-note')?.value.trim() || null }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    get('co-name').value = ''; get('co-note').value = '';
    await loadCompanies();
    Swal.fire({ icon: 'success', title: '등록 완료', timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire({ icon: 'error', title: '등록 실패', text: err.message });
  }
}

// ═══════════════════════════════════════════════════════════
// 관리자
// ═══════════════════════════════════════════════════════════
async function loadManagers() {
  const tbody = get('manager-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="ls-empty">로딩 중...</td></tr>';

  const r = await fetch(MG_API, { credentials: 'include' });
  const { data } = await r.json();
  _managers = data || [];

  if (!_managers.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="ls-empty">등록된 관리자가 없습니다.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  _managers.forEach(m => {
    const tr = tbody.insertRow();
    tr.dataset.id = m.id;
    tr.insertCell().textContent = m.id;
    const tdName = tr.insertCell(); tdName.textContent = m.manager_name;       tdName.dataset.key = 'manager_name';
    const tdCo   = tr.insertCell(); tdCo.textContent   = m.company_name ?? '-'; // 읽기 전용 (join 값)
    const tdPhone= tr.insertCell(); tdPhone.textContent= m.phone ?? '';         tdPhone.dataset.key = 'phone';
    const tdNote = tr.insertCell(); tdNote.textContent = m.note ?? '';          tdNote.dataset.key = 'note';

    const tdE = tr.insertCell();
    const btnE = document.createElement('button');
    btnE.className = 'ls-btn ls-btn-teal';
    btnE.innerHTML = '<i class="fa-solid fa-pen"></i>';
    btnE.onclick = () => enterManagerEdit(tr, m);
    tdE.appendChild(btnE);

    const tdD = tr.insertCell();
    const btnD = document.createElement('button');
    btnD.className = 'ls-btn ls-btn-red';
    btnD.innerHTML = '<i class="fa-solid fa-trash"></i>';
    btnD.onclick = () => deleteEntity(MG_API, m.id, loadManagers, '관리자');
    tdD.appendChild(btnD);
  });
  window.initTableSort?.();
}

function enterManagerEdit(tr, m) {
  document.querySelectorAll('#manager-tbody tr.editing').forEach(r => { if (r !== tr) loadManagers(); });
  tr.classList.add('editing');

  // manager_name
  const tdName = tr.querySelector('td[data-key="manager_name"]');
  if (tdName) { tdName.innerHTML = ''; const i = document.createElement('input'); i.value = m.manager_name; i.style.width='100%'; tdName.appendChild(i); }

  // 사료회사 (select)
  const tdCo = tr.cells[2]; // company_name (join, read-only display) → replace with select
  tdCo.innerHTML = '';
  const sel = document.createElement('select');
  sel.style.width = '100%';
  sel.dataset.key = 'feed_company_id';
  sel.innerHTML = '<option value="">-- 선택 안 함 --</option>';
  _companies.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.company_name;
    if (c.id === m.feed_company_id) opt.selected = true;
    sel.appendChild(opt);
  });
  tdCo.appendChild(sel);

  // phone
  const tdPhone = tr.querySelector('td[data-key="phone"]');
  if (tdPhone) { tdPhone.innerHTML = ''; const i = document.createElement('input'); i.value = m.phone ?? ''; i.style.width='100%'; tdPhone.appendChild(i); }

  // note
  const tdNote = tr.querySelector('td[data-key="note"]');
  if (tdNote) { tdNote.innerHTML = ''; const i = document.createElement('input'); i.value = m.note ?? ''; i.style.width='100%'; tdNote.appendChild(i); }

  // 수정 → 저장
  const tdE = tr.cells[tr.cells.length - 2];
  tdE.innerHTML = '';
  const btnSave = document.createElement('button');
  btnSave.className = 'ls-btn ls-btn-primary';
  btnSave.textContent = '저장';
  btnSave.onclick = () => saveManager(tr);
  tdE.appendChild(btnSave);

  // 삭제 → 취소
  const tdD = tr.cells[tr.cells.length - 1];
  tdD.innerHTML = '';
  const btnCancel = document.createElement('button');
  btnCancel.className = 'ls-btn ls-btn-gray';
  btnCancel.textContent = '취소';
  btnCancel.onclick = () => loadManagers();
  tdD.appendChild(btnCancel);
}

async function saveManager(tr) {
  const id = tr.dataset.id;
  const body = {};
  [...tr.querySelectorAll('td[data-key], td select[data-key]')].forEach(el => {
    const key = el.dataset.key;
    if (!key) return;
    const inp = el.querySelector ? (el.querySelector('input,select') || el) : el;
    body[key] = inp.value?.trim() || null;
  });
  // select[data-key] directly
  const sel = tr.querySelector('select[data-key]');
  if (sel) body[sel.dataset.key] = sel.value || null;

  try {
    const r = await fetch(`${MG_API}/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await loadManagers();
    Swal.fire({ icon: 'success', title: '수정 완료', timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire({ icon: 'error', title: '수정 실패', text: err.message });
  }
}

async function addManager() {
  const name = get('mg-name')?.value.trim();
  if (!name) { Swal.fire({ icon: 'warning', title: '이름을 입력하세요' }); return; }
  const body = {
    manager_name:    name,
    feed_company_id: get('mg-company')?.value || null,
    phone:           get('mg-phone')?.value.trim() || null,
    note:            get('mg-note')?.value.trim()  || null,
  };
  try {
    const r = await fetch(MG_API, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    ['mg-name','mg-phone','mg-note'].forEach(id => { if (get(id)) get(id).value = ''; });
    get('mg-company').value = '';
    await loadManagers();
    Swal.fire({ icon: 'success', title: '등록 완료', timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire({ icon: 'error', title: '등록 실패', text: err.message });
  }
}

// ── 공통 삭제 ─────────────────────────────────────────────
async function deleteEntity(apiUrl, id, reloadFn, label) {
  const ok = await Swal.fire({
    title: `${label}을 삭제할까요?`, text: `ID: ${id}`, icon: 'warning',
    showCancelButton: true, confirmButtonText: '삭제', cancelButtonText: '취소',
    confirmButtonColor: '#d9534f',
  });
  if (!ok.isConfirmed) return;
  try {
    const r = await fetch(`${apiUrl}/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await reloadFn();
    Swal.fire({ icon: 'success', title: '삭제 완료', timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire({ icon: 'error', title: '삭제 실패', text: err.message });
  }
}

// ── 공통 인라인 편집 (사료회사용) ─────────────────────────
function enterSimpleEdit(tr, tdE, tdD, saveFn) {
  tr.classList.add('editing');
  [...tr.querySelectorAll('td[data-key]')].forEach(td => {
    const inp = document.createElement('input');
    inp.value = td.textContent;
    inp.style.width = '100%';
    td.innerHTML = '';
    td.appendChild(inp);
  });
  tdE.innerHTML = '';
  const btnSave = document.createElement('button');
  btnSave.className = 'ls-btn ls-btn-primary';
  btnSave.textContent = '저장';
  btnSave.onclick = saveFn;
  tdE.appendChild(btnSave);

  tdD.innerHTML = '';
  const btnCancel = document.createElement('button');
  btnCancel.className = 'ls-btn ls-btn-gray';
  btnCancel.textContent = '취소';
  btnCancel.onclick = () => loadCompanies();
  tdD.appendChild(btnCancel);
}

// ═══════════════════════════════════════════════════════════
// 뱃지 관리 (livestock_batches API 사용)
// ═══════════════════════════════════════════════════════════
const BATCH_API = '/api/livestock';
let _batchMap = {}; // batch_id → batch object

function fmtDate2(d) {
  if (!d) return '-';
  return String(d).slice(0, 10).replace(/-/g, '.');
}
function fmt(n) { return n == null ? '-' : Number(n).toLocaleString(); }

async function loadBadgeFarmSelect() {
  const sel = get('bd-farm');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- 농장 선택 --</option>';
  // _farms 캐시가 없으면 다시 fetch
  const r = await fetch(FARM_API, { credentials: 'include' });
  const { farms } = await r.json();
  (farms || []).forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.농장ID;
    opt.textContent = f.농장명;
    opt.dataset.companyId = f.feed_company_id || '';
    sel.appendChild(opt);
  });
}

async function loadBadges() {
  const activeTbody = get('badges-active-tbody');
  const doneTbody   = get('badges-done-tbody');
  if (!activeTbody) return;

  activeTbody.innerHTML = '<tr><td colspan="8" class="ls-empty">로딩 중...</td></tr>';
  doneTbody.innerHTML   = '<tr><td colspan="7" class="ls-empty">로딩 중...</td></tr>';

  try {
    const r = await fetch(`${BATCH_API}/batches?status=all`, { credentials: 'include' });
    const { batches } = await r.json();
    const active    = (batches || []).filter(b => b.status === 'active');
    const completed = (batches || []).filter(b => b.status === 'completed');

    // batch_id → batch 맵 (editBadge 에서 참조)
    _batchMap = {};
    (batches || []).forEach(b => { _batchMap[b.batch_id] = b; });

    // farm_id → 농장명 맵 (이미 _farms 캐시 활용)
    const farmMap = {};
    (await fetch(FARM_API, { credentials: 'include' }).then(r => r.json()).then(d => d.farms || []))
      .forEach(f => { farmMap[f.농장ID] = f.농장명; });

    activeTbody.innerHTML = active.length
      ? active.map(b => `<tr>
          <td>${b.batch_id}</td>
          <td style="font-weight:700;">${b.badge_name}</td>
          <td>${farmMap[b.farm_id] || '-'}</td>
          <td>${b.manager || '-'}</td>
          <td>${fmtDate2(b.last_transfer_date)}</td>
          <td class="num-big">${fmt(b.current_count)}</td>
          <td><span class="badge-active">활성</span></td>
          <td style="white-space:nowrap;">
            <button class="ls-btn ls-btn-teal" style="margin-right:4px;" onclick="editBadge(${b.batch_id})"><i class="fa-solid fa-pen"></i></button>
            <button class="ls-btn ls-btn-gray" onclick="setBadgeStatus(${b.batch_id},'completed')">완료처리</button>
          </td>
        </tr>`).join('')
      : '<tr><td colspan="8" class="ls-empty">없음</td></tr>';

    doneTbody.innerHTML = completed.length
      ? completed.map(b => `<tr>
          <td>${b.batch_id}</td>
          <td style="font-weight:700;">${b.badge_name}</td>
          <td>${farmMap[b.farm_id] || '-'}</td>
          <td>${b.manager || '-'}</td>
          <td>${fmtDate2(b.last_transfer_date)}</td>
          <td><span class="badge-done">완료</span></td>
          <td><button class="ls-btn ls-btn-teal" onclick="setBadgeStatus(${b.batch_id},'active')">복원</button></td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="ls-empty">없음</td></tr>';

    window.initTableSort?.();
  } catch (err) {
    activeTbody.innerHTML = `<tr><td colspan="8" class="ls-empty" style="color:#d9534f;">${err.message}</td></tr>`;
  }
}

async function addBadge() {
  const farmSel   = get('bd-farm');
  const farm_id   = farmSel?.value;
  const farmName  = farmSel?.options[farmSel.selectedIndex]?.textContent || '';
  const suffix    = (get('bd-suffix')?.value || '').trim();

  if (!farm_id) { Swal.fire({ icon: 'warning', title: '농장을 선택하세요' }); return; }

  const badge_name       = farmName + suffix;
  const manager = get('bd-manager')?.value.trim() || '';
  const note    = get('bd-note')?.value.trim() || null;

  try {
    const r = await fetch(`${BATCH_API}/batches`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ badge_name, farm_id: parseInt(farm_id), manager, note }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    ['bd-suffix','bd-note'].forEach(id => { if (get(id)) get(id).value = ''; });
    get('bd-farm').value = '';
    const mgSel = get('bd-manager');
    if (mgSel) { mgSel.innerHTML = '<option value="">-- 농장 먼저 선택 --</option>'; }

    await loadBadges();
    Swal.fire({ icon: 'success', title: '뱃지 등록 완료', timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire({ icon: 'error', title: '등록 실패', text: err.message });
  }
}

async function editBadge(batch_id) {
  const b = _batchMap[batch_id];
  if (!b) return;

  const { value: formValues } = await Swal.fire({
    title: '뱃지 수정',
    html: `
      <div style="text-align:left;display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;">
        <div>
          <label style="font-size:0.82rem;color:#555;">뱃지명</label>
          <input id="swal-badge-name" class="swal2-input" style="margin:0;width:100%;font-size:0.9rem;" value="${b.badge_name || ''}">
        </div>
        <div>
          <label style="font-size:0.82rem;color:#555;">관리자</label>
          <input id="swal-manager" class="swal2-input" style="margin:0;width:100%;font-size:0.9rem;" value="${b.manager || ''}">
        </div>
        <div>
          <label style="font-size:0.82rem;color:#555;">메모</label>
          <input id="swal-note" class="swal2-input" style="margin:0;width:100%;font-size:0.9rem;" value="${b.note || ''}">
        </div>
      </div>`,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: '저장',
    cancelButtonText: '취소',
    preConfirm: () => ({
      badge_name: document.getElementById('swal-badge-name').value.trim(),
      manager:    document.getElementById('swal-manager').value.trim(),
      note:       document.getElementById('swal-note').value.trim() || null,
      farm_id:    b.farm_id,
      status:     b.status,
    }),
  });

  if (!formValues) return;
  if (!formValues.badge_name) {
    Swal.fire({ icon: 'warning', title: '뱃지명을 입력하세요' });
    return;
  }

  try {
    const r = await fetch(`${BATCH_API}/batches/${batch_id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formValues),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await loadBadges();
    Swal.fire({ icon: 'success', title: '수정 완료', timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire({ icon: 'error', title: '수정 실패', text: err.message });
  }
}

async function setBadgeStatus(id, status) {
  const label = status === 'completed' ? '완료 처리' : '활성으로 복원';
  const ok = await Swal.fire({
    title: `${label} 하시겠습니까?`, icon: 'question',
    showCancelButton: true, confirmButtonText: label, cancelButtonText: '취소',
  });
  if (!ok.isConfirmed) return;
  try {
    const r = await fetch(`${BATCH_API}/batches/${id}/status`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await loadBadges();
    Swal.fire({ icon: 'success', title: `${label} 완료`, timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire({ icon: 'error', title: err.message });
  }
}

// ── 초기 로드 ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await loadCompanySelects();
  await loadManagerSelect();

  // 사료회사 선택 시 관리자 목록 필터링
  get('fn-company')?.addEventListener('change', filterManagerSelect);

  // 뱃지 탭: 농장 선택 시 해당 사료회사 관리자 목록 채우기
  get('bd-farm')?.addEventListener('change', () => {
    const sel = get('bd-farm');
    const opt = sel.options[sel.selectedIndex];
    const companyId = opt?.dataset.companyId || '';
    const mgSel = get('bd-manager');
    if (!mgSel) return;
    mgSel.innerHTML = '<option value="">-- 선택 안 함 --</option>';
    const filtered = companyId
      ? _managers.filter(m => String(m.feed_company_id) === companyId)
      : _managers;
    filtered.forEach(m => {
      const o = document.createElement('option');
      o.value = m.manager_name;
      o.textContent = m.manager_name;
      mgSel.appendChild(o);
    });
    // 관리자가 1명이면 자동 선택
    if (filtered.length === 1) mgSel.value = filtered[0].manager_name;
  });

  await loadFarms();
});

// 탭 전환 시 뱃지 탭 로드
document.querySelectorAll('.ls-tab-btn').forEach(btn => {
  if (btn.dataset.tab === 'badges') {
    btn.addEventListener('click', async () => {
      await loadBadgeFarmSelect();
      await loadBadges();
    });
  }
});
