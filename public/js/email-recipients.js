// email-recipients.js

const API = '/api/email/recipients';

const ALERT_TYPE_LABELS = {
  mortality_report: '폐사율 리포트',
};

function get(id) { return document.getElementById(id); }

function fmtDate(s) {
  if (!s) return '-';
  return String(s).slice(0, 10).replace(/-/g, '.');
}

function alertTypeLabel(t) {
  return ALERT_TYPE_LABELS[t] || t;
}

// ── 수신자 목록 로드 ─────────────────────────────────────────
async function loadRecipients(alertType) {
  const tbody = get('recipients-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="ls-empty">로딩 중...</td></tr>';

  try {
    const r = await fetch(`${API}?alert_type=${alertType}`, { credentials: 'include' });
    const { data, error } = await r.json();
    if (!r.ok) throw new Error(error || `HTTP ${r.status}`);

    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="ls-empty">등록된 수신자가 없습니다.</td></tr>';
      window.initTableSort?.();
      return;
    }

    tbody.innerHTML = '';
    data.forEach(rc => appendRecipientRow(rc, tbody));
    window.initTableSort?.();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="ls-empty" style="color:#d9534f;">${err.message}</td></tr>`;
  }
}

function appendRecipientRow(rc, tbody) {
  const tr = document.createElement('tr');
  tr.dataset.id = rc.id;

  tr.insertCell().textContent = rc.id;

  const tdName  = tr.insertCell(); tdName.textContent  = rc.name  ?? '';  tdName.dataset.key  = 'name';
  const tdEmail = tr.insertCell(); tdEmail.textContent = rc.email ?? '';  tdEmail.dataset.key = 'email';

  const tdType = tr.insertCell();
  tdType.textContent = alertTypeLabel(rc.alert_type);
  tdType.dataset.key = 'alert_type';
  tdType.dataset.readonly = '1';

  const tdEnabled = tr.insertCell();
  tdEnabled.dataset.key = 'enabled';
  tdEnabled.dataset.val  = String(rc.enabled);
  tdEnabled.innerHTML = rc.enabled
    ? '<span style="color:#146C43;font-weight:600;">● 활성</span>'
    : '<span style="color:#888;">○ 비활성</span>';

  const tdNote = tr.insertCell(); tdNote.textContent = rc.note ?? ''; tdNote.dataset.key = 'note';
  tr.insertCell().textContent = fmtDate(rc.created_at);

  // 수정
  const tdE = tr.insertCell();
  const btnE = document.createElement('button');
  btnE.className = 'ls-btn ls-btn-teal';
  btnE.innerHTML = '<i class="fa-solid fa-pen"></i>';
  btnE.onclick = () => enterEdit(tr, rc);
  tdE.appendChild(btnE);

  // 삭제
  const tdD = tr.insertCell();
  const btnD = document.createElement('button');
  btnD.className = 'ls-btn ls-btn-red';
  btnD.innerHTML = '<i class="fa-solid fa-trash"></i>';
  btnD.onclick = () => deleteRecipient(rc.id, rc.alert_type);
  tdD.appendChild(btnD);

  tbody.appendChild(tr);
}

// ── 인라인 편집 ─────────────────────────────────────────────
function enterEdit(tr, rc) {
  document.querySelectorAll('#recipients-tbody tr.editing').forEach(r => {
    if (r !== tr) loadRecipients(rc.alert_type);
  });
  tr.classList.add('editing');

  ['name', 'email', 'note'].forEach(key => {
    const td = tr.querySelector(`td[data-key="${key}"]`);
    if (!td) return;
    const inp = document.createElement('input');
    inp.type = key === 'email' ? 'email' : 'text';
    inp.value = td.textContent;
    inp.style.width = '100%';
    td.innerHTML = '';
    td.appendChild(inp);
  });

  // enabled → select
  const tdEnabled = tr.querySelector('td[data-key="enabled"]');
  if (tdEnabled) {
    const sel = document.createElement('select');
    sel.style.width = '100%';
    sel.innerHTML = `
      <option value="true"  ${rc.enabled ? 'selected' : ''}>활성화</option>
      <option value="false" ${!rc.enabled ? 'selected' : ''}>비활성화</option>`;
    tdEnabled.innerHTML = '';
    tdEnabled.appendChild(sel);
  }

  // 수정 → 저장
  const tdE = tr.cells[tr.cells.length - 2];
  tdE.innerHTML = '';
  const btnSave = document.createElement('button');
  btnSave.className = 'ls-btn ls-btn-primary';
  btnSave.textContent = '저장';
  btnSave.onclick = () => saveEdit(tr, rc);
  tdE.appendChild(btnSave);

  // 삭제 → 취소
  const tdD = tr.cells[tr.cells.length - 1];
  tdD.innerHTML = '';
  const btnCancel = document.createElement('button');
  btnCancel.className = 'ls-btn ls-btn-gray';
  btnCancel.textContent = '취소';
  btnCancel.onclick = () => loadRecipients(rc.alert_type);
  tdD.appendChild(btnCancel);
}

async function saveEdit(tr, rc) {
  const id = tr.dataset.id;
  const body = { alert_type: rc.alert_type };

  ['name', 'email', 'note'].forEach(key => {
    const td = tr.querySelector(`td[data-key="${key}"]`);
    const inp = td?.querySelector('input');
    body[key] = inp ? inp.value.trim() || null : null;
  });

  const enabledSel = tr.querySelector('td[data-key="enabled"] select');
  body.enabled = enabledSel ? enabledSel.value === 'true' : rc.enabled;

  if (!body.email) {
    Swal.fire({ icon: 'warning', title: '이메일을 입력하세요' });
    return;
  }

  try {
    const r = await fetch(`${API}/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
    await loadRecipients(rc.alert_type);
    Swal.fire({ icon: 'success', title: '수정 완료', timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire({ icon: 'error', title: '수정 실패', text: err.message });
  }
}

// ── 수신자 등록 ─────────────────────────────────────────────
async function addRecipient(alertType) {
  const email = get('rc-email')?.value.trim();
  if (!email) { Swal.fire({ icon: 'warning', title: '이메일을 입력하세요' }); return; }

  const body = {
    email,
    name:       get('rc-name')?.value.trim()    || null,
    alert_type: alertType,
    enabled:    get('rc-enabled')?.value !== 'false',
    note:       get('rc-note')?.value.trim()     || null,
  };

  try {
    const r = await fetch(API, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);

    ['rc-name', 'rc-email', 'rc-note'].forEach(id => { if (get(id)) get(id).value = ''; });
    if (get('rc-enabled')) get('rc-enabled').value = 'true';

    await loadRecipients(alertType);
    Swal.fire({ icon: 'success', title: '등록 완료', timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire({ icon: 'error', title: '등록 실패', text: err.message });
  }
}

// ── 수신자 삭제 ─────────────────────────────────────────────
async function deleteRecipient(id, alertType) {
  const ok = await Swal.fire({
    title: '수신자를 삭제할까요?', icon: 'warning',
    showCancelButton: true, confirmButtonText: '삭제', cancelButtonText: '취소',
    confirmButtonColor: '#d9534f',
  });
  if (!ok.isConfirmed) return;
  try {
    const r = await fetch(`${API}/${id}`, { method: 'DELETE', credentials: 'include' });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
    await loadRecipients(alertType);
    Swal.fire({ icon: 'success', title: '삭제 완료', timer: 1200, showConfirmButton: false });
  } catch (err) {
    Swal.fire({ icon: 'error', title: '삭제 실패', text: err.message });
  }
}

// ── 초기 로드 ────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // 탭 전환
  document.querySelectorAll('.ls-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ls-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.ls-tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab)?.classList.add('active');
      loadRecipients(btn.dataset.tab);
    });
  });

  loadRecipients('mortality_report');
});
