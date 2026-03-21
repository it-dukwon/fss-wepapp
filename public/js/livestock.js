// livestock.js

const API = window.location.hostname.includes("localhost")
  ? "http://localhost:3000/api/livestock"
  : "https://webapp-databricks-dashboard-c7a3fjgmb7d3dnhn.koreacentral-01.azurewebsites.net/api/livestock";

// ─────────────────────────────────────────
// 탭 전환
// ─────────────────────────────────────────
document.querySelectorAll(".ls-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".ls-tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".ls-tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    document.getElementById(`tab-${tab}`).classList.add("active");

    if (tab === "status")    loadStatus();
    if (tab === "events")    { loadBatchSelect(); loadEvents(); }
    if (tab === "mortality") loadMortality();
    if (tab === "schedule")  loadSchedule();
  });
});

// ─────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────
function fmt(n) { return n == null ? "-" : Number(n).toLocaleString(); }
function fmtDate(d) { return d ? d.slice(0, 10) : "-"; }

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (res.status === 401) { location.href = "/login"; return; }
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error || "서버 오류");
  return json;
}

function toast(icon, title) {
  Swal.fire({ toast: true, position: "top-end", icon, title, showConfirmButton: false, timer: 2000 });
}

// ─────────────────────────────────────────
// 탭 1: 현황 (파스별)
// ─────────────────────────────────────────
let currentStatusView = "latest";

async function loadPassStatus(view) {
  if (view) currentStatusView = view;

  const btnLatest = document.getElementById("btn-view-latest");
  const btnAll    = document.getElementById("btn-view-all");
  if (btnLatest) btnLatest.className = `ls-btn ${currentStatusView === "latest" ? "ls-btn-primary" : "ls-btn-gray"}`;
  if (btnAll)    btnAll.className    = `ls-btn ${currentStatusView === "all"    ? "ls-btn-primary" : "ls-btn-gray"}`;

  const tbody = document.getElementById("status-tbody");
  const tfoot = document.getElementById("status-tfoot");
  tbody.innerHTML = `<tr><td colspan="12" class="ls-empty">로딩 중...</td></tr>`;

  try {
    const { passes } = await apiFetch(`/passes?view=${currentStatusView}`);
    if (!passes.length) {
      tbody.innerHTML = `<tr><td colspan="12" class="ls-empty">데이터 없음</td></tr>`;
      tfoot.innerHTML = "";
      return;
    }

    let totTransfer = 0, totDeaths = 0, totCulled = 0, totShipped = 0, totCur = 0;
    tbody.innerHTML = passes.map((p) => {
      totTransfer += (p.total_transfer_in || 0);
      totDeaths   += (p.total_deaths || 0);
      totCulled   += (p.total_culled || 0);
      totShipped  += (p.total_shipped || 0);
      totCur      += (p.current_count || 0);

      const stockIn = (p.start_count || 0) + (p.total_transfer_in || 0);

      let statusBadge, actionBtn;
      if (p.pass_status === "batch") {
        statusBadge = `<span style="color:#888;font-size:0.82rem;">파스 미사용</span>`;
        actionBtn   = `<button class="ls-btn ls-btn-teal" style="padding:3px 10px;font-size:0.82rem;"
                         onclick="createFirstPass(${p.batch_id}, '${p.badge_name.replace(/'/g, "\\'")}')">파스 생성</button>`;
      } else if (p.pass_status === "active") {
        statusBadge = `<span class="ev-badge" style="background:#d4edda;color:#155724;">활성</span>`;
        actionBtn   = `<button class="ls-btn ls-btn-primary" style="padding:3px 10px;font-size:0.82rem;"
                         onclick="nextPass(${p.pass_id}, '${p.pass_name.replace(/'/g, "\\'")}', ${p.current_count})">다음 파스 →</button>`;
      } else {
        statusBadge = `<span class="ev-badge" style="background:#e2e3e5;color:#383d41;">완료</span>`;
        actionBtn   = `-`;
      }

      return `<tr>
        <td style="font-weight:700;">${p.badge_name}</td>
        <td style="font-weight:600;color:#1a73a7;">${p.pass_name || "-"}</td>
        <td>${p.manager || "-"}</td>
        <td>${fmtDate(p.started_at)}</td>
        <td>${fmtDate(p.last_event_date)}</td>
        <td>${fmt(stockIn)}</td>
        <td class="num-red">${fmt(p.total_deaths)}</td>
        <td class="num-orange">${fmt(p.total_culled)}</td>
        <td>${fmt(p.total_shipped)}</td>
        <td class="num-big">${fmt(p.current_count)}</td>
        <td>${statusBadge}</td>
        <td>${actionBtn}</td>
      </tr>`;
    }).join("");

    tfoot.innerHTML = `
      <td style="font-weight:700;">합계</td>
      <td></td><td></td><td></td><td></td>
      <td>${fmt(totTransfer)}</td>
      <td class="num-red">${fmt(totDeaths)}</td>
      <td class="num-orange">${fmt(totCulled)}</td>
      <td>${fmt(totShipped)}</td>
      <td class="num-big">${fmt(totCur)}</td>
      <td></td><td></td>
    `;
    window.initTableSort?.();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="12" class="ls-empty">${err.message}</td></tr>`;
  }
}

// 첫 파스 생성
async function createFirstPass(batch_id, badge_name) {
  const { isConfirmed } = await Swal.fire({
    title: "첫 파스 생성",
    html: `<p>"<b>${badge_name}</b>"의 첫 파스를 생성합니다.<br>기존 이벤트는 이 파스에 자동으로 포함됩니다.</p>`,
    showCancelButton: true,
    confirmButtonText: "생성",
    cancelButtonText: "취소",
    confirmButtonColor: "#146C43",
  });
  if (!isConfirmed) return;
  try {
    const { pass } = await apiFetch("/passes", { method: "POST", body: JSON.stringify({ batch_id }) });
    toast("success", `${pass.pass_name} 파스가 생성되었습니다`);
    loadPassStatus();
  } catch (err) {
    Swal.fire({ icon: "error", title: err.message });
  }
}

// 다음 파스로 전환
async function nextPass(pass_id, pass_name, current_count) {
  const { isConfirmed } = await Swal.fire({
    icon: current_count > 0 ? "warning" : "question",
    title: "다음 파스로 전환",
    html: current_count > 0
      ? `<p>현재 잔여두수 <b>${fmt(current_count)}두</b>가 다음 파스로 이월됩니다.<br><br>"<b>${pass_name}</b>" 파스를 완료하고 다음 파스를 생성할까요?</p>`
      : `<p>"<b>${pass_name}</b>" 파스를 완료하고 다음 파스를 생성할까요?</p>`,
    showCancelButton: true,
    confirmButtonText: "다음 파스 생성",
    cancelButtonText: "취소",
    confirmButtonColor: "#1a73a7",
  });
  if (!isConfirmed) return;
  try {
    const { new_pass } = await apiFetch(`/passes/${pass_id}/next`, { method: "POST", body: JSON.stringify({}) });
    toast("success", `${new_pass.pass_name} 파스가 생성되었습니다`);
    loadPassStatus();
  } catch (err) {
    Swal.fire({ icon: "error", title: err.message });
  }
}

// 기존 loadStatus는 loadPassStatus로 연결
function loadStatus() { loadPassStatus(); }

// ─────────────────────────────────────────
// 탭 2: 이벤트 입력
// ─────────────────────────────────────────
let currentEventType = "stock_in";

function selectEventType(type) {
  currentEventType = type;
  document.querySelectorAll(".ev-type-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.type === type);
  });
  ["stock_in", "death", "shipping", "deduction"].forEach((t) => {
    const el = document.getElementById(`ev-fields-${t}`);
    if (el) el.style.display = t === type ? "" : "none";
  });
}

async function loadBatchSelect() {
  try {
    const { batches } = await apiFetch("/batches?status=active");
    const opts = batches.map((b) => `<option value="${b.batch_id}">${b.badge_name}</option>`).join("");

    ["ev-batch", "ev-filter-batch"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const hasAll = id === "ev-filter-batch";
      el.innerHTML = (hasAll ? `<option value="">전체</option>` : "") + opts;
    });

    // 기본 선택 배치의 파스 로드
    const evBatch = document.getElementById("ev-batch");
    if (evBatch?.value) loadPassSelect(evBatch.value);
  } catch (_) {}
}

async function loadPassSelect(batch_id) {
  const el = document.getElementById("ev-pass");
  if (!el) return;
  if (!batch_id) { el.innerHTML = `<option value="">-- 파스 선택 --</option>`; return; }
  try {
    const { passes } = await apiFetch(`/passes/for-batch/${batch_id}`);
    if (!passes.length) {
      el.innerHTML = `<option value="">파스 없음 (현황 탭에서 먼저 생성하세요)</option>`;
      return;
    }
    el.innerHTML = passes.map((p) => {
      const label = p.status === "active" ? `${p.pass_name} (활성)` : p.pass_name;
      return `<option value="${p.pass_id}" ${p.status === "active" ? "selected" : ""}>${label}</option>`;
    }).join("");
  } catch (_) {
    el.innerHTML = `<option value="">-- 파스 선택 --</option>`;
  }
}

async function submitEvent() {
  const batch_id   = document.getElementById("ev-batch").value;
  const event_date = document.getElementById("ev-date").value;
  const note       = (document.getElementById("ev-note").value || "").trim();

  if (!batch_id || !event_date) {
    return Swal.fire({ icon: "warning", title: "뱃지와 날짜는 필수입니다." });
  }

  let pass_id = document.getElementById("ev-pass")?.value || "";

  if (currentEventType === "stock_in") {
    // 입식두수·체중 먼저 검증
    const transfer_in  = Number(document.getElementById("ev-transfer").value) || 0;
    const stock_weight = Number(document.getElementById("ev-stock-weight").value) || 0;
    if (!transfer_in)  return Swal.fire({ icon: "warning", title: "입식두수를 입력하세요." });
    if (!stock_weight) return Swal.fire({ icon: "warning", title: "입식 총체중을 입력하세요." });

    if (!pass_id) {
      // 파스 없음 → 생성 후 진행
      const { isConfirmed } = await Swal.fire({
        icon: "question",
        title: "파스가 없습니다",
        text: "파스를 새로 생성하고 입식을 진행할까요?",
        showCancelButton: true,
        confirmButtonText: "파스 생성 후 진행",
        cancelButtonText: "취소",
        confirmButtonColor: "#146C43",
      });
      if (!isConfirmed) return;
      try {
        const { pass } = await apiFetch("/passes", { method: "POST", body: JSON.stringify({ batch_id }) });
        pass_id = String(pass.pass_id);
        await loadPassSelect(batch_id);
        document.getElementById("ev-pass").value = pass_id;
      } catch (err) {
        return Swal.fire({ icon: "error", title: "파스 생성 실패", text: err.message });
      }
    } else {
      // 파스 있음 → 현재 파스 확인
      const passEl   = document.getElementById("ev-pass");
      const passName = passEl?.options[passEl.selectedIndex]?.textContent || pass_id;
      const { isConfirmed } = await Swal.fire({
        icon: "question",
        title: "입식 확인",
        html: `현재 파스 <b>${passName}</b>에서 입식을 진행하시겠습니까?`,
        showCancelButton: true,
        confirmButtonText: "진행",
        cancelButtonText: "취소",
        confirmButtonColor: "#146C43",
      });
      if (!isConfirmed) return;
    }

    let body = { batch_id, pass_id, event_date, event_type: currentEventType, note: note || null };
    body = { ...body, transfer_in, stock_weight };

    const msg = document.getElementById("ev-msg");
    msg.textContent = "저장 중...";
    try {
      await apiFetch("/events", { method: "POST", body: JSON.stringify(body) });
      toast("success", "저장되었습니다");
      msg.textContent = "";
      resetEventForm();
      loadEvents();
    } catch (err) {
      msg.textContent = "";
      Swal.fire({ icon: "error", title: err.message });
    }
    return;
  }

  // 입식 외 이벤트: 파스 필수
  if (!pass_id) return Swal.fire({ icon: "warning", title: "파스를 선택하세요." });
  let body = { batch_id, pass_id, event_date, event_type: currentEventType, note: note || null };

  if (currentEventType === "death") {
    const death_type = document.getElementById("ev-death-type").value;
    const count      = Number(document.getElementById("ev-death-count").value) || 0;
    if (!count) return Swal.fire({ icon: "warning", title: "두수를 입력하세요." });
    body = {
      ...body, death_type,
      deaths: death_type !== "도태" ? count : 0,
      culled: death_type === "도태" ? count : 0,
    };

  } else if (currentEventType === "shipping") {
    const shipped        = Number(document.getElementById("ev-shipped").value) || 0;
    const ship_weight    = Number(document.getElementById("ev-ship-weight").value) || 0;
    if (!shipped)      return Swal.fire({ icon: "warning", title: "출하두수를 입력하세요." });
    if (!ship_weight)  return Swal.fire({ icon: "warning", title: "출하 총체중을 입력하세요." });
    body = {
      ...body, shipped, ship_weight,
      distributor:    document.getElementById("ev-distributor").value.trim()    || null,
      slaughterhouse: document.getElementById("ev-slaughterhouse").value.trim() || null,
      meat_processor: document.getElementById("ev-meat-processor").value.trim() || null,
    };

  } else if (currentEventType === "deduction") {
    const deducted = Number(document.getElementById("ev-deduction-count").value) || 0;
    const reason   = document.getElementById("ev-deduction-reason").value.trim();
    if (!deducted) return Swal.fire({ icon: "warning", title: "공제두수를 입력하세요." });
    if (!reason)   return Swal.fire({ icon: "warning", title: "사유를 입력하세요." });
    body = { ...body, deducted, note: reason };
  }

  const msg = document.getElementById("ev-msg");
  msg.textContent = "저장 중...";
  try {
    await apiFetch("/events", { method: "POST", body: JSON.stringify(body) });
    toast("success", "저장되었습니다");
    msg.textContent = "";
    resetEventForm();
    loadEvents();
  } catch (err) {
    msg.textContent = "";
    Swal.fire({ icon: "error", title: err.message });
  }
}

function resetEventForm() {
  if (currentEventType === "stock_in") {
    document.getElementById("ev-transfer").value    = "";
    document.getElementById("ev-stock-weight").value = "";
  } else if (currentEventType === "death") {
    document.getElementById("ev-death-count").value = "";
    document.getElementById("ev-death-type").value  = "폐사";
  } else if (currentEventType === "shipping") {
    ["ev-shipped", "ev-ship-weight", "ev-distributor", "ev-slaughterhouse", "ev-meat-processor"]
      .forEach((id) => { document.getElementById(id).value = ""; });
  } else if (currentEventType === "deduction") {
    document.getElementById("ev-deduction-count").value  = "";
    document.getElementById("ev-deduction-reason").value = "";
  }
  document.getElementById("ev-note").value = "";
}

async function loadEvents() {
  const tbody = document.getElementById("events-tbody");
  tbody.innerHTML = `<tr><td colspan="9" class="ls-empty">로딩 중...</td></tr>`;

  const batch_id  = document.getElementById("ev-filter-batch")?.value || "";
  const date_from = document.getElementById("ev-filter-from")?.value  || "";
  const date_to   = document.getElementById("ev-filter-to")?.value    || "";

  const params = new URLSearchParams();
  if (batch_id)  params.set("batch_id", batch_id);
  if (date_from) params.set("date_from", date_from);
  if (date_to)   params.set("date_to", date_to);

  try {
    const { events } = await apiFetch("/events?" + params.toString());
    if (!events.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="ls-empty">이벤트 없음</td></tr>`;
      return;
    }
    tbody.innerHTML = events.map((e) => {
      let badge, count, weight, extra;
      const etype = e.event_type;

      if (etype === "stock_in" || (!etype && e.transfer_in > 0)) {
        badge  = `<span class="ev-badge ev-badge-in">입식</span>`;
        count  = fmt(e.transfer_in);
        weight = e.stock_weight != null ? Number(e.stock_weight).toLocaleString() + " kg" : "-";
        extra  = "";
      } else if (etype === "death" || (!etype && (e.deaths > 0 || e.culled > 0))) {
        const dt = e.death_type || (e.culled > 0 ? "도태" : "폐사");
        badge  = dt === "도태"
          ? `<span class="ev-badge ev-badge-cull">도태</span>`
          : dt === "확인불가"
          ? `<span class="ev-badge" style="background:#e2d9f3;color:#4a235a;">확인불가</span>`
          : `<span class="ev-badge ev-badge-death">폐사</span>`;
        count  = fmt(e.deaths > 0 ? e.deaths : e.culled);
        weight = "-";
        extra  = "";
      } else if (etype === "shipping" || (!etype && e.shipped > 0)) {
        badge  = `<span class="ev-badge ev-badge-ship">출하</span>`;
        count  = fmt(e.shipped);
        weight = e.ship_weight != null ? Number(e.ship_weight).toLocaleString() + " kg" : "-";
        extra  = [e.distributor, e.slaughterhouse, e.meat_processor].filter(Boolean).join(" / ");
      } else if (etype === "deduction" || (!etype && e.deducted > 0)) {
        badge  = `<span class="ev-badge" style="background:#e9e3f5;color:#7b5ea7;">공제</span>`;
        count  = fmt(e.deducted);
        weight = "-";
        extra  = e.note || "";
      } else {
        badge = `<span class="ev-badge">기타</span>`;
        count = "-"; weight = "-"; extra = "";
      }

      const ed = encodeURIComponent(JSON.stringify(e));
      return `<tr>
        <td>${fmtDate(e.event_date)}</td>
        <td style="font-weight:700;">${e.badge_name}</td>
        <td style="font-size:0.82rem;color:#1a73a7;">${e.pass_name || "-"}</td>
        <td>${badge}</td>
        <td>${count}</td>
        <td>${weight}</td>
        <td style="font-size:0.85rem;color:#555;">${extra}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;">${e.note || ""}</td>
        <td style="white-space:nowrap;">
          <button class="ls-btn ls-btn-teal" style="padding:3px 8px;margin-right:4px;" onclick="editEvent(${e.event_id}, decodeURIComponent('${ed}'))"><i class="fa-solid fa-pen"></i></button>
          <button class="ls-btn ls-btn-red"  style="padding:3px 8px;" onclick="deleteEvent(${e.event_id})">삭제</button>
        </td>
      </tr>`;
    }).join("");
    window.initTableSort?.();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="ls-empty">${err.message}</td></tr>`;
  }
}

async function deleteEvent(id) {
  const ok = await Swal.fire({
    title: "삭제하시겠습니까?", icon: "warning",
    showCancelButton: true, confirmButtonText: "삭제", cancelButtonText: "취소",
    confirmButtonColor: "#d9534f",
  });
  if (!ok.isConfirmed) return;
  try {
    await apiFetch(`/events/${id}`, { method: "DELETE" });
    toast("success", "삭제되었습니다");
    loadEvents();
  } catch (err) {
    Swal.fire({ icon: "error", title: err.message });
  }
}

async function editEvent(id, jsonStr) {
  const e = JSON.parse(jsonStr);
  const etype = e.event_type || (e.transfer_in > 0 ? "stock_in" : e.shipped > 0 ? "shipping" : "death");

  let htmlBody = `
    <div style="text-align:left;display:grid;gap:8px;">
      <div>
        <label style="font-size:0.82rem;color:#555;">날짜</label>
        <input id="ed-date" type="date" class="swal2-input" style="margin:0;width:100%;" value="${e.event_date ? String(e.event_date).slice(0,10) : ''}">
      </div>`;

  if (etype === "stock_in") {
    htmlBody += `
      <div>
        <label style="font-size:0.82rem;color:#555;">입식두수</label>
        <input id="ed-transfer-in" type="number" class="swal2-input" style="margin:0;width:100%;" value="${e.transfer_in || ''}">
      </div>
      <div>
        <label style="font-size:0.82rem;color:#555;">입식 총체중 (kg)</label>
        <input id="ed-stock-weight" type="number" step="0.1" class="swal2-input" style="margin:0;width:100%;" value="${e.stock_weight || ''}">
      </div>`;
  } else if (etype === "death") {
    const dType = e.death_type || (e.culled > 0 ? "도태" : "폐사");
    const cnt   = e.deaths > 0 ? e.deaths : (e.culled || 0);
    htmlBody += `
      <div>
        <label style="font-size:0.82rem;color:#555;">유형</label>
        <select id="ed-death-type" class="swal2-select" style="margin:0;width:100%;padding:6px 8px;border:1px solid #d9d9d9;border-radius:4px;">
          <option value="폐사"    ${dType==="폐사"    ? "selected":""}>폐사</option>
          <option value="도태"    ${dType==="도태"    ? "selected":""}>도태</option>
          <option value="확인불가" ${dType==="확인불가"? "selected":""}>확인불가</option>
        </select>
      </div>
      <div>
        <label style="font-size:0.82rem;color:#555;">두수</label>
        <input id="ed-death-count" type="number" class="swal2-input" style="margin:0;width:100%;" value="${cnt}">
      </div>`;
  } else if (etype === "shipping") {
    htmlBody += `
      <div>
        <label style="font-size:0.82rem;color:#555;">출하두수</label>
        <input id="ed-shipped" type="number" class="swal2-input" style="margin:0;width:100%;" value="${e.shipped || ''}">
      </div>
      <div>
        <label style="font-size:0.82rem;color:#555;">출하 총체중 (kg)</label>
        <input id="ed-ship-weight" type="number" step="0.1" class="swal2-input" style="margin:0;width:100%;" value="${e.ship_weight || ''}">
      </div>
      <div>
        <label style="font-size:0.82rem;color:#555;">유통업체</label>
        <input id="ed-distributor" type="text" class="swal2-input" style="margin:0;width:100%;" value="${e.distributor || ''}">
      </div>
      <div>
        <label style="font-size:0.82rem;color:#555;">도축장</label>
        <input id="ed-slaughterhouse" type="text" class="swal2-input" style="margin:0;width:100%;" value="${e.slaughterhouse || ''}">
      </div>
      <div>
        <label style="font-size:0.82rem;color:#555;">육가공업체</label>
        <input id="ed-meat-processor" type="text" class="swal2-input" style="margin:0;width:100%;" value="${e.meat_processor || ''}">
      </div>`;
  }

  htmlBody += `
      <div>
        <label style="font-size:0.82rem;color:#555;">메모</label>
        <input id="ed-note" type="text" class="swal2-input" style="margin:0;width:100%;" value="${e.note || ''}">
      </div>
    </div>`;

  const { isConfirmed } = await Swal.fire({
    title: "이벤트 수정",
    html: htmlBody,
    showCancelButton: true,
    confirmButtonText: "저장",
    cancelButtonText: "취소",
    confirmButtonColor: "#146C43",
    preConfirm: () => true,
  });
  if (!isConfirmed) return;

  const body = {
    event_date: document.getElementById("ed-date").value,
    event_type: etype,
    note: document.getElementById("ed-note").value.trim() || null,
  };

  if (etype === "stock_in") {
    const ti = parseInt(document.getElementById("ed-transfer-in").value);
    if (!ti || ti < 1) { Swal.fire({ icon: "warning", title: "입식두수를 입력하세요" }); return; }
    body.transfer_in  = ti;
    body.stock_weight = parseFloat(document.getElementById("ed-stock-weight").value) || null;
  } else if (etype === "death") {
    const cnt = parseInt(document.getElementById("ed-death-count").value);
    if (!cnt || cnt < 1) { Swal.fire({ icon: "warning", title: "두수를 입력하세요" }); return; }
    const dType = document.getElementById("ed-death-type").value;
    body.death_type = dType;
    body.deaths = dType === "폐사" || dType === "확인불가" ? cnt : 0;
    body.culled = dType === "도태" ? cnt : 0;
  } else if (etype === "shipping") {
    const sh = parseInt(document.getElementById("ed-shipped").value);
    if (!sh || sh < 1) { Swal.fire({ icon: "warning", title: "출하두수를 입력하세요" }); return; }
    body.shipped        = sh;
    body.ship_weight    = parseFloat(document.getElementById("ed-ship-weight").value) || null;
    body.distributor    = document.getElementById("ed-distributor").value.trim() || null;
    body.slaughterhouse = document.getElementById("ed-slaughterhouse").value.trim() || null;
    body.meat_processor = document.getElementById("ed-meat-processor").value.trim() || null;
  }

  try {
    await apiFetch(`/events/${id}`, { method: "PUT", body: JSON.stringify(body) });
    toast("success", "수정되었습니다");
    loadEvents();
  } catch (err) {
    Swal.fire({ icon: "error", title: err.message });
  }
}


// ─────────────────────────────────────────
// 탭 4: 폐사율 리포트
// ─────────────────────────────────────────
async function loadMortality() {
  const tbody = document.getElementById("mortality-tbody");
  tbody.innerHTML = `<tr><td colspan="10" class="ls-empty">로딩 중...</td></tr>`;
  try {
    const { report } = await apiFetch("/report/mortality");
    if (!report.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="ls-empty">활성 뱃지 없음</td></tr>`;
      return;
    }
    tbody.innerHTML = report.map((r) => {
      const mortality = parseFloat(r.mortality_pct) || 0;
      const benchmark = parseFloat(r.benchmark_pct) || 0;
      let statusClass, statusLabel;
      if (mortality <= benchmark)        { statusClass = "status-good"; statusLabel = "✅ 양호"; }
      else if (mortality <= benchmark * 1.5) { statusClass = "status-warn"; statusLabel = "⚠️ 주의"; }
      else                               { statusClass = "status-bad";  statusLabel = "🔴 불량"; }

      const diff = parseFloat(r.diff_pct) || 0;
      const diffStr = (diff >= 0 ? "+" : "") + diff.toFixed(2) + "%p";
      return `<tr>
        <td style="font-weight:700;">${r.badge_name}</td>
        <td style="color:#1a73a7;">${r.pass_name || "-"}</td>
        <td>${r.manager || "-"}</td>
        <td>${fmtDate(r.stock_in_date)}</td>
        <td>${fmt(r.stock_in_count)}</td>
        <td>${r.days_elapsed != null ? `${r.days_elapsed}일 / ${r.months_elapsed}월` : "-"}</td>
        <td class="num-red">${fmt(r.total_deaths)}</td>
        <td>${benchmark.toFixed(2)}%</td>
        <td class="${mortality > benchmark ? "num-red" : ""}">${mortality.toFixed(2)}% <span style="font-size:0.85em;color:${diff > 0 ? "#d9534f" : "#146C43"};">(${diffStr})</span></td>
        <td class="${statusClass}">${statusLabel}</td>
      </tr>`;
    }).join("");
    window.initTableSort?.();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="ls-empty">${err.message}</td></tr>`;
  }
}

// ─────────────────────────────────────────
// 이메일 스케줄 설정
// ─────────────────────────────────────────
const EMAIL_API = API.replace("/livestock", "/email");

async function loadSchedule() {
  try {
    const res = await fetch(EMAIL_API + "/schedule", { credentials: "include" });
    const json = await res.json();
    if (!json.success) return;
    const s = json.schedule;
    document.getElementById("sch-enabled").value = String(s.enabled);
    document.getElementById("sch-day").value    = String(s.dayOfWeek);
    document.getElementById("sch-hour").value   = String(s.hour);
  } catch (_) {}
}

async function saveSchedule() {
  const enabled   = document.getElementById("sch-enabled").value === "true";
  const dayOfWeek = Number(document.getElementById("sch-day").value);
  const hour      = Number(document.getElementById("sch-hour").value);
  const msg       = document.getElementById("sch-msg");
  msg.textContent = "저장 중...";
  try {
    const res = await fetch(EMAIL_API + "/schedule", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, dayOfWeek, hour, minute: 0 }),
    });
    const json = await res.json();
    if (json.success) {
      msg.textContent = "";
      toast("success", "스케줄이 저장되었습니다");
    } else {
      msg.textContent = json.error;
    }
  } catch (err) {
    msg.textContent = err.message;
  }
}

// ─────────────────────────────────────────
// 이메일 발송
// ─────────────────────────────────────────
async function sendMortalityReport() {
  const EMAIL_API = API.replace("/livestock", "/email");

  // 현재 수신자 목록 조회
  let defaultTo = "";
  try {
    const rRes = await fetch(EMAIL_API + "/recipients?alert_type=mortality_report", { credentials: "include" });
    const rJson = await rRes.json();
    if (rJson.success && Array.isArray(rJson.data)) {
      defaultTo = rJson.data.filter(r => r.enabled).map(r => r.email).join(", ");
    }
  } catch (_) {}

  const { value: formValues, isConfirmed } = await Swal.fire({
    title: "폐사율 리포트 이메일 발송",
    html: `
      <div style="text-align:left;font-size:0.9rem;">
        <label style="display:block;margin-bottom:4px;font-weight:600;">수신자 *</label>
        <input id="swal-to" class="swal2-input" style="margin:0 0 12px;width:100%;box-sizing:border-box;"
          placeholder="recipient@example.com" value="${defaultTo}" />
        <label style="display:block;margin-bottom:4px;font-weight:600;">참조 (선택)</label>
        <input id="swal-cc" class="swal2-input" style="margin:0;width:100%;box-sizing:border-box;"
          placeholder="cc@example.com" />
      </div>`,
    showCancelButton: true,
    confirmButtonText: "발송",
    cancelButtonText: "취소",
    confirmButtonColor: "#146C43",
    preConfirm: () => ({
      to: document.getElementById("swal-to").value.trim(),
      cc: document.getElementById("swal-cc").value.trim(),
    }),
  });

  if (!isConfirmed || !formValues) return;
  const { to, cc } = formValues;
  if (!to) return Swal.fire({ icon: "warning", title: "수신자 이메일을 입력하세요." });

  try {
    Swal.fire({ title: "발송 중...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    const res = await fetch(EMAIL_API + "/mortality-report", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, cc: cc || undefined }),
    });
    const json = await res.json();
    if (json.success) {
      Swal.fire({ icon: "success", title: "발송 완료!", text: `${to} 으로 발송되었습니다.`, timer: 2500, showConfirmButton: false });
    } else {
      Swal.fire({ icon: "error", title: "발송 실패", text: json.error });
    }
  } catch (err) {
    Swal.fire({ icon: "error", title: "발송 실패", text: err.message });
  }
}

// ─────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  // 오늘 날짜 기본값
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("ev-date").value = today;

  // 기본 필터: 최근 30일
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  document.getElementById("ev-filter-from").value = d30;
  document.getElementById("ev-filter-to").value   = today;

  loadStatus();
});
