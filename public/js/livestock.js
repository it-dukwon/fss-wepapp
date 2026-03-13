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
    if (tab === "batches")   loadBatches();
    if (tab === "mortality") loadMortality();
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
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error || "서버 오류");
  return json;
}

function toast(icon, title) {
  Swal.fire({ toast: true, position: "top-end", icon, title, showConfirmButton: false, timer: 2000 });
}

// ─────────────────────────────────────────
// 탭 1: 현황
// ─────────────────────────────────────────
async function loadStatus() {
  const tbody = document.getElementById("status-tbody");
  const tfoot = document.getElementById("status-tfoot");
  tbody.innerHTML = `<tr><td colspan="9" class="ls-empty">로딩 중...</td></tr>`;
  try {
    const { batches } = await apiFetch("/batches?status=active");
    if (!batches.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="ls-empty">활성 뱃지 없음</td></tr>`;
      tfoot.innerHTML = "";
      return;
    }

    let totIn = 0, totD = 0, totC = 0, totS = 0, totCur = 0;
    tbody.innerHTML = batches.map((b) => {
      totIn  += b.total_transfer_in;
      totD   += b.total_deaths;
      totC   += b.total_culled;
      totS   += b.total_shipped;
      totCur += b.current_count;
      return `<tr>
        <td style="font-weight:700;">${b.badge_name}</td>
        <td>${b.manager || "-"}</td>
        <td>${fmtDate(b.stock_in_date)}</td>
        <td>${fmt(b.stock_in_count)}</td>
        <td>${fmt(b.total_transfer_in)}</td>
        <td class="num-red">${fmt(b.total_deaths)}</td>
        <td class="num-orange">${fmt(b.total_culled)}</td>
        <td>${fmt(b.total_shipped)}</td>
        <td class="num-big">${fmt(b.current_count)}</td>
      </tr>`;
    }).join("");

    tfoot.innerHTML = `
      <td style="font-weight:700;">합계</td>
      <td></td><td></td><td></td>
      <td>${fmt(totIn)}</td>
      <td class="num-red">${fmt(totD)}</td>
      <td class="num-orange">${fmt(totC)}</td>
      <td>${fmt(totS)}</td>
      <td class="num-big">${fmt(totCur)}</td>
    `;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="ls-empty">${err.message}</td></tr>`;
  }
}

// ─────────────────────────────────────────
// 탭 2: 이벤트 입력
// ─────────────────────────────────────────
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
  } catch (_) {}
}

async function submitEvent() {
  const batch_id   = document.getElementById("ev-batch").value;
  const event_date = document.getElementById("ev-date").value;
  const transfer_in = document.getElementById("ev-transfer").value;
  const deaths      = document.getElementById("ev-deaths").value;
  const culled      = document.getElementById("ev-culled").value;
  const shipped     = document.getElementById("ev-shipped").value;
  const note        = document.getElementById("ev-note").value.trim();

  if (!batch_id || !event_date) {
    return Swal.fire({ icon: "warning", title: "뱃지와 날짜는 필수입니다." });
  }

  const msg = document.getElementById("ev-msg");
  msg.textContent = "저장 중...";

  try {
    await apiFetch("/events", {
      method: "POST",
      body: JSON.stringify({ batch_id, event_date, transfer_in, deaths, culled, shipped, note }),
    });
    toast("success", "저장되었습니다");
    msg.textContent = "";
    // 입력값 초기화 (날짜/뱃지는 유지)
    ["ev-transfer", "ev-deaths", "ev-culled", "ev-shipped"].forEach((id) => {
      document.getElementById(id).value = "0";
    });
    document.getElementById("ev-note").value = "";
    loadEvents();
  } catch (err) {
    msg.textContent = "";
    Swal.fire({ icon: "error", title: err.message });
  }
}

async function loadEvents() {
  const tbody = document.getElementById("events-tbody");
  tbody.innerHTML = `<tr><td colspan="8" class="ls-empty">로딩 중...</td></tr>`;

  const batch_id  = document.getElementById("ev-filter-batch")?.value || "";
  const date_from = document.getElementById("ev-filter-from")?.value || "";
  const date_to   = document.getElementById("ev-filter-to")?.value || "";

  const params = new URLSearchParams();
  if (batch_id)  params.set("batch_id", batch_id);
  if (date_from) params.set("date_from", date_from);
  if (date_to)   params.set("date_to", date_to);

  try {
    const { events } = await apiFetch("/events?" + params.toString());
    if (!events.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="ls-empty">이벤트 없음</td></tr>`;
      return;
    }
    tbody.innerHTML = events.map((e) => `
      <tr>
        <td>${fmtDate(e.event_date)}</td>
        <td style="font-weight:700;">${e.badge_name}</td>
        <td>${fmt(e.transfer_in)}</td>
        <td class="num-red">${fmt(e.deaths)}</td>
        <td class="num-orange">${fmt(e.culled)}</td>
        <td>${fmt(e.shipped)}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;">${e.note || ""}</td>
        <td><button class="ls-btn ls-btn-red" style="padding:3px 8px;" onclick="deleteEvent(${e.event_id})">삭제</button></td>
      </tr>
    `).join("");
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

// ─────────────────────────────────────────
// 탭 3: 뱃지 관리
// ─────────────────────────────────────────
async function loadBatches() {
  const activeTbody    = document.getElementById("batches-tbody");
  const completedTbody = document.getElementById("completed-tbody");
  activeTbody.innerHTML    = `<tr><td colspan="9" class="ls-empty">로딩 중...</td></tr>`;
  completedTbody.innerHTML = `<tr><td colspan="7" class="ls-empty">로딩 중...</td></tr>`;

  try {
    const { batches } = await apiFetch("/batches?status=all");
    const active    = batches.filter((b) => b.status === "active");
    const completed = batches.filter((b) => b.status === "completed");

    activeTbody.innerHTML = active.length
      ? active.map((b) => `<tr>
          <td>${b.batch_id}</td>
          <td style="font-weight:700;">${b.badge_name}</td>
          <td>${b.manager || "-"}</td>
          <td>${fmtDate(b.stock_in_date)}</td>
          <td>${fmt(b.stock_in_count)}</td>
          <td>${fmt(b.prev_month_count)}</td>
          <td class="num-big">${fmt(b.current_count)}</td>
          <td><span class="badge-active">활성</span></td>
          <td><button class="ls-btn ls-btn-gray" onclick="setBatchStatus(${b.batch_id},'completed')">완료처리</button></td>
        </tr>`).join("")
      : `<tr><td colspan="9" class="ls-empty">없음</td></tr>`;

    completedTbody.innerHTML = completed.length
      ? completed.map((b) => `<tr>
          <td>${b.batch_id}</td>
          <td style="font-weight:700;">${b.badge_name}</td>
          <td>${b.manager || "-"}</td>
          <td>${fmtDate(b.stock_in_date)}</td>
          <td>${fmt(b.stock_in_count)}</td>
          <td><span class="badge-done">완료</span></td>
          <td><button class="ls-btn ls-btn-teal" onclick="setBatchStatus(${b.batch_id},'active')">복원</button></td>
        </tr>`).join("")
      : `<tr><td colspan="7" class="ls-empty">없음</td></tr>`;
  } catch (err) {
    activeTbody.innerHTML = `<tr><td colspan="9" class="ls-empty">${err.message}</td></tr>`;
  }
}

async function addBatch() {
  const badge_name       = document.getElementById("bt-badge-name").value.trim();
  const manager          = document.getElementById("bt-manager").value.trim();
  const stock_in_date    = document.getElementById("bt-stock-date").value;
  const stock_in_count   = document.getElementById("bt-stock-count").value;
  const prev_month_count = document.getElementById("bt-prev-count").value;
  const note             = document.getElementById("bt-note").value.trim();

  if (!badge_name) return Swal.fire({ icon: "warning", title: "뱃지명은 필수입니다." });

  try {
    await apiFetch("/batches", {
      method: "POST",
      body: JSON.stringify({ badge_name, manager, stock_in_date, stock_in_count, prev_month_count, note }),
    });
    toast("success", "뱃지가 등록되었습니다");
    ["bt-badge-name","bt-manager","bt-stock-date","bt-note"].forEach((id) => {
      document.getElementById(id).value = "";
    });
    ["bt-stock-count","bt-prev-count"].forEach((id) => {
      document.getElementById(id).value = "0";
    });
    loadBatches();
  } catch (err) {
    Swal.fire({ icon: "error", title: err.message });
  }
}

async function setBatchStatus(id, status) {
  const label = status === "completed" ? "완료 처리" : "활성으로 복원";
  const ok = await Swal.fire({
    title: `${label} 하시겠습니까?`, icon: "question",
    showCancelButton: true, confirmButtonText: label, cancelButtonText: "취소",
  });
  if (!ok.isConfirmed) return;
  try {
    await apiFetch(`/batches/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    toast("success", `${label} 완료`);
    loadBatches();
  } catch (err) {
    Swal.fire({ icon: "error", title: err.message });
  }
}

// ─────────────────────────────────────────
// 탭 4: 폐사율 리포트
// ─────────────────────────────────────────
async function loadMortality() {
  const tbody = document.getElementById("mortality-tbody");
  tbody.innerHTML = `<tr><td colspan="9" class="ls-empty">로딩 중...</td></tr>`;
  try {
    const { report } = await apiFetch("/report/mortality");
    if (!report.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="ls-empty">활성 뱃지 없음</td></tr>`;
      return;
    }
    tbody.innerHTML = report.map((r) => {
      const mortality = parseFloat(r.mortality_pct) || 0;
      const benchmark = parseFloat(r.benchmark_pct) || 0;
      let statusClass, statusLabel;
      if (mortality <= benchmark)        { statusClass = "status-good"; statusLabel = "✅ 양호"; }
      else if (mortality <= benchmark * 1.5) { statusClass = "status-warn"; statusLabel = "⚠️ 주의"; }
      else                               { statusClass = "status-bad";  statusLabel = "🔴 불량"; }

      return `<tr>
        <td style="font-weight:700;">${r.badge_name}</td>
        <td>${r.manager || "-"}</td>
        <td>${fmtDate(r.stock_in_date)}</td>
        <td>${fmt(r.stock_in_count)}</td>
        <td>${r.months_elapsed ?? "-"}</td>
        <td class="num-red">${fmt(r.total_deaths)}</td>
        <td class="${mortality > benchmark ? "num-red" : ""}">${mortality.toFixed(2)}%</td>
        <td>${benchmark.toFixed(2)}%</td>
        <td class="${statusClass}">${statusLabel}</td>
      </tr>`;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="ls-empty">${err.message}</td></tr>`;
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
