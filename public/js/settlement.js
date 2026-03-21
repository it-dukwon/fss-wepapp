// settlement.js

let _ownerEmail = "";  // 현재 선택된 뱃지의 농장주 이메일

const API = window.location.hostname.includes("localhost")
  ? "http://localhost:3000/api/settlement"
  : "https://webapp-databricks-dashboard-c7a3fjgmb7d3dnhn.koreacentral-01.azurewebsites.net/api/settlement";

// ─── 쉼표 입력 유틸 ──────────────────────────────────────────
function numVal(id) {
  const v = (document.getElementById(id)?.value || "").replace(/,/g, "");
  return Number(v) || 0;
}
function setCommaVal(id, v) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = (v != null && v !== "" && !isNaN(v)) ? Number(v).toLocaleString("ko-KR") : "0";
}
function initCommaInputs() {
  document.querySelectorAll(".comma-input").forEach((el) => {
    el.addEventListener("focus", () => {
      el.value = el.value.replace(/,/g, "");
    });
    el.addEventListener("blur", () => {
      const raw = el.value.replace(/,/g, "");
      const n = Number(raw);
      if (raw !== "" && !isNaN(n)) el.value = n.toLocaleString("ko-KR");
    });
  });
}
document.addEventListener("DOMContentLoaded", initCommaInputs);

function fmt(n, decimals = 0) {
  if (n == null || n === "" || isNaN(n)) return "-";
  return Number(n).toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
function fmtDate(d) { return d ? String(d).slice(0, 10) : "-"; }
function pct(n)  { return n == null ? "-" : (Number(n) * 100).toFixed(2) + "%"; }
function won(n)  { return n == null ? "-" : fmt(n) + " 원"; }

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

// ─── 뱃지 목록 로드 ─────────────────────────────────────────
async function loadBatches() {
  try {
    const { batches } = await apiFetch("/");
    const sel = document.getElementById("batch-select");
    sel.innerHTML = `<option value="">-- 뱃지 선택 --</option>` +
      batches.map((b) => {
        const label = `${b.badge_name} (${b.farm_name || "-"}) [${b.status === "active" ? "진행중" : "완료"}]`;
        return `<option value="${b.batch_id}">${label}</option>`;
      }).join("");

    // URL 파라미터로 자동 선택
    const urlParams = new URLSearchParams(window.location.search);
    const bid = urlParams.get("batch_id");
    if (bid) { sel.value = bid; await loadPassSelect(bid); loadSettlement(); }
  } catch (err) {
    console.error(err);
  }
}

async function onBatchChange() {
  const batch_id = document.getElementById("batch-select").value;
  await loadPassSelect(batch_id);
  loadSettlement();
}

async function loadPassSelect(batch_id) {
  const sel = document.getElementById("pass-select");
  if (!sel) return;
  sel.innerHTML = `<option value="">전체 (파스 무관)</option>`;
  if (!batch_id) return;
  try {
    const LIVESTOCK_API = API.replace("/settlement", "/livestock");
    const res = await fetch(`${LIVESTOCK_API}/passes/for-batch/${batch_id}`, { credentials: "include" });
    const json = await res.json();
    if (!json.success || !json.passes.length) return;
    json.passes.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.pass_id;
      opt.textContent = p.status === "active" ? `${p.pass_name} (활성)` : p.pass_name;
      if (p.status === "active") opt.selected = true;
      sel.appendChild(opt);
    });
  } catch (_) {}
}

// ─── 정산서 로드 ─────────────────────────────────────────────
async function loadSettlement() {
  const batch_id = document.getElementById("batch-select").value;
  if (!batch_id) { document.getElementById("st-body").style.display = "none"; return; }
  const pass_id = document.getElementById("pass-select")?.value || "";

  try {
    const params = pass_id ? `?pass_id=${pass_id}` : "";
    const { data: d } = await apiFetch(`/${batch_id}${params}`);
    document.getElementById("st-body").style.display = "";

    _ownerEmail = d.batch.owner_email || "";

    // ── ① 기본 정보 ────────────────────────────────
    document.getElementById("v-farm-name").textContent        = d.batch.farm_name || d.batch.manager || "-";
    document.getElementById("v-bank-name").textContent        = d.batch.bank_name || "-";
    document.getElementById("v-account-number").textContent   = d.batch.account_number || "-";
    document.getElementById("v-account-holder").textContent   = d.batch.account_holder || "-";
    document.getElementById("v-stock-in-date").textContent    = fmtDate(d.stock_in_date);
    document.getElementById("v-stock-in-count").textContent   = fmt(d.stock_in_count) + " 두";
    document.getElementById("v-initial-stock-weight").textContent = fmt(d.initial_stock_weight, 1) + " kg";
    document.getElementById("v-avg-stock-weight").textContent = fmt(d.avg_stock_weight, 2) + " kg";
    document.getElementById("v-last-ship-date").textContent   = fmtDate(d.last_ship_date);
    document.getElementById("v-total-shipped").textContent    = fmt(d.total_shipped) + " 두";
    document.getElementById("v-total-ship-weight").textContent = fmt(d.total_ship_weight) + " kg";
    document.getElementById("v-avg-ship-weight").textContent  = fmt(d.avg_ship_weight, 2) + " kg";
    document.getElementById("v-breeding-days").textContent    = fmt(d.breeding_days) + " 일";
    document.getElementById("v-weight-gain").textContent      = fmt(d.total_weight_gain) + " kg";
    document.getElementById("v-daily-gain").textContent       = fmt(d.daily_gain_g, 1) + " g";

    const rem = d.remaining;
    const remEl = document.getElementById("v-remaining");
    remEl.textContent = fmt(rem) + " 두";
    remEl.className = "st-value " + (rem > 0 ? "red" : rem === 0 ? "muted" : "blue");

    // ── ② 도폐사 실적 ──────────────────────────────
    document.getElementById("v-stock-in-count2").textContent  = fmt(d.stock_in_count) + " 두";
    setCommaVal("f-claim-count", d.claim_count || 0);
    document.getElementById("v-total-dead").textContent       = fmt(d.total_dead) + " 두";
    document.getElementById("v-adj-dead").textContent         = fmt(d.adj_dead) + " 두";
    document.getElementById("v-mortality-act").textContent    = pct(d.mortality_act);
    document.getElementById("f-std-mortality-rate").value    = d.std_rate ?? 0.03;
    document.getElementById("v-std-head").textContent         = fmt(d.std_head) + " 두";
    document.getElementById("v-deduct-head").textContent      = fmt(d.total_deducted) + " 두";
    document.getElementById("v-settlement-count").textContent = fmt(d.settlement_count) + " 두";

    // ── ③ 등급 ─────────────────────────────────────
    setCommaVal("f-grade-1plus",     d.manual.grade_1plus    || 0);
    setCommaVal("f-grade-1",         d.manual.grade_1         || 0);
    setCommaVal("f-grade-2",         d.manual.grade_2         || 0);
    setCommaVal("f-grade-out-spec",  d.manual.grade_out_spec  || 0);
    setCommaVal("f-grade-out-other", d.manual.grade_out_other || 0);
    setCommaVal("f-grade-penalty",   d.grade_penalty          || 0);

    // ── ④ 사료 ─────────────────────────────────────
    setCommaVal("f-feed-piglet",     d.feed_piglet || 0);
    setCommaVal("f-feed-grow",       d.feed_grow   || 0);
    setCommaVal("f-feed-cost-total", d.feed_cost   || 0);
    updateFeedCalc(d);

    // ── ⑤ 위탁사육비 ───────────────────────────────
    setCommaVal("f-base-fee",         d.base_fee        || 0);
    setCommaVal("f-incentive-growth", d.incentive_growth || 0);
    setCommaVal("f-incentive-feed",   d.incentive_feed   || 0);
    setCommaVal("f-penalty-grade",    d.penalty_grade    || 0);
    setCommaVal("f-prepayment",       d.prepayment       || 0);
    document.getElementById("f-payment-note").value      = d.manual.payment_note || "";
    updatePaymentCalc(d);

    // ── ⑥ 수익 분석 ────────────────────────────────
    setCommaVal("f-revenue",     d.revenue     || 0);
    setCommaVal("f-piglet-cost", d.piglet_cost || 0);
    updateRevenueCalc(d);

    // ── ⑦ 이력 ─────────────────────────────────────
    renderHistory(d);

    // 실시간 재계산 이벤트 연결
    bindCalcListeners(d);

  } catch (err) {
    Swal.fire({ icon: "error", title: "로드 실패", text: err.message });
  }
}

// ─── 실시간 계산 업데이트 ────────────────────────────────────
function updateFeedCalc(d) {
  const piglet = numVal("f-feed-piglet");
  const grow   = numVal("f-feed-grow");
  const total  = piglet + grow;
  const wgain  = d.total_weight_gain || 0;
  const days   = d.breeding_days     || 0;
  const cnt    = d.stock_in_count    || 0;
  const cost   = numVal("f-feed-cost-total");

  document.getElementById("v-feed-total").textContent    = fmt(total) + " kg";
  document.getElementById("v-feed-fcr").textContent      = wgain > 0 ? fmt(total / wgain, 2) : "-";
  document.getElementById("v-feed-daily").textContent    = (days > 0 && cnt > 0) ? fmt(total / days / cnt, 3) + " kg" : "-";
  document.getElementById("v-feed-per-head").textContent = cnt > 0 ? fmt(total / cnt, 1) + " kg" : "-";
  document.getElementById("v-feed-avg-cost").textContent = cnt > 0 ? won(Math.round(cost / cnt)) : "-";
  document.getElementById("v-feed-cost-disp").textContent = won(cost);
}

function updatePaymentCalc(d) {
  const base   = numVal("f-base-fee");
  const ig     = numVal("f-incentive-growth");
  const ifd    = numVal("f-incentive-feed");
  const pg     = numVal("f-penalty-grade");
  const gpn    = numVal("f-grade-penalty");
  const prep   = numVal("f-prepayment");
  const net    = base + ig + ifd - pg - gpn - prep;

  document.getElementById("v-net-payment").textContent  = won(net);
  document.getElementById("v-net-payment2").textContent = won(net);
  return net;
}

function updateRevenueCalc(d) {
  const rev    = numVal("f-revenue");
  const pc     = numVal("f-piglet-cost");
  const fc     = numVal("f-feed-cost-total");
  const net    = updatePaymentCalc(d);
  const profit = rev - pc - fc - net;

  document.getElementById("v-farm-net").textContent = won(profit);
  document.getElementById("v-farm-net").className = "st-value big " + (profit >= 0 ? "" : "red");
}

function bindCalcListeners(d) {
  ["f-feed-piglet","f-feed-grow","f-feed-cost-total"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.oninput = () => { updateFeedCalc(d); updateRevenueCalc(d); };
  });
  ["f-base-fee","f-incentive-growth","f-incentive-feed","f-penalty-grade","f-grade-penalty","f-prepayment"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.oninput = () => updateRevenueCalc(d);
  });
  ["f-revenue","f-piglet-cost"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.oninput = () => updateRevenueCalc(d);
  });
  ["f-claim-count","f-std-mortality-rate"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.oninput = () => {
      const clm  = Number(document.getElementById("f-claim-count").value)        || 0;
      const std  = Number(document.getElementById("f-std-mortality-rate").value)  || 0.03;
      const cnt  = d.stock_in_count || 0;
      const dead = d.total_dead     || 0;
      const adj  = dead - clm;
      const act  = cnt > 0 ? adj / cnt : 0;
      const stdH = Math.floor(cnt * std);
      const ded  = Math.max(0, adj - stdH);
      document.getElementById("v-adj-dead").textContent      = fmt(adj) + " 두";
      document.getElementById("v-mortality-act").textContent = pct(act);
      document.getElementById("v-std-head").textContent      = fmt(stdH) + " 두";
    };
  });
}

// ─── 이력 테이블 렌더링 ───────────────────────────────────────
function renderHistory(d) {
  const tbody = document.getElementById("history-tbody");
  const rows  = [];
  // d.stock_in_count = batch.stock_in_count + total_transfer_in
  // 이벤트 루프에서 transfer_in을 다시 더하므로, 먼저 차감해서 초기값 계산
  const baseCount = d.events.reduce((s, e) => s - (e.transfer_in || 0), d.stock_in_count);
  let running = baseCount;

  // 초기 입식 행 (batch.stock_in_count + initial_stock_weight)
  const initCount = d.stock_in_count - d.events.reduce((s, e) => s + (e.transfer_in || 0), 0);
  if (initCount > 0) {
    running += initCount;
    const initAvgW = d.initial_stock_weight && initCount
      ? fmt(d.initial_stock_weight / initCount, 2) : "-";
    rows.push(`<tr class="ev-in">
      <td>${fmtDate(d.stock_in_date)}</td>
      <td><span class="ev-badge ev-badge-in">입식</span></td>
      <td>${fmt(initCount)}</td>
      <td>${fmt(d.initial_stock_weight, 1)}</td>
      <td>${initAvgW}</td>
      <td>-</td><td>-</td><td>-</td><td>-</td>
      <td>${fmt(running)}</td>
      <td>-</td>
    </tr>`);
  }

  for (const ev of d.events) {
    const etype = ev.event_type;

    if (etype === "stock_in" || (!etype && ev.transfer_in > 0)) {
      running += (ev.transfer_in || 0);
      const avgW = ev.stock_weight && ev.transfer_in
        ? fmt(ev.stock_weight / ev.transfer_in, 2) : "-";
      rows.push(`<tr class="ev-in">
        <td>${fmtDate(ev.event_date)}</td>
        <td><span class="ev-badge ev-badge-in">입식</span></td>
        <td>${fmt(ev.transfer_in)}</td>
        <td>${fmt(ev.stock_weight, 1)}</td>
        <td>${avgW}</td>
        <td>-</td><td>-</td><td>-</td><td>-</td>
        <td>${fmt(running)}</td>
        <td>${ev.note || ""}</td>
      </tr>`);
    } else if (etype === "death" || (!etype && (ev.deaths > 0 || ev.culled > 0))) {
      const cnt = (ev.deaths || 0) + (ev.culled || 0);
      running -= cnt;
      const dt = ev.death_type === "도태"
        ? `<span class="ev-badge ev-badge-cull">도태</span>`
        : ev.death_type === "확인불가"
        ? `<span class="ev-badge" style="background:#e2d9f3;color:#4a235a;">확인불가</span>`
        : `<span class="ev-badge ev-badge-death">폐사</span>`;
      rows.push(`<tr class="ev-dead">
        <td>${fmtDate(ev.event_date)}</td><td>${dt}</td>
        <td>-</td><td>-</td><td>-</td>
        <td>${fmt(cnt)}</td>
        <td>-</td><td>-</td><td>-</td>
        <td>${fmt(running)}</td>
        <td>${ev.note || ""}</td>
      </tr>`);
    } else if (etype === "shipping" || (!etype && ev.shipped > 0)) {
      running -= (ev.shipped || 0);
      const avgW = ev.ship_weight && ev.shipped ? fmt(ev.ship_weight / ev.shipped, 2) : "-";
      const outlets = [ev.distributor, ev.slaughterhouse, ev.meat_processor].filter(Boolean).join(" / ");
      rows.push(`<tr class="ev-ship">
        <td>${fmtDate(ev.event_date)}</td>
        <td><span class="ev-badge ev-badge-ship">출하</span></td>
        <td>-</td><td>-</td><td>-</td><td>-</td>
        <td>${fmt(ev.shipped)}</td>
        <td>${fmt(ev.ship_weight, 1)}</td>
        <td>${avgW}</td>
        <td>${fmt(running)}</td>
        <td>${outlets || ev.note || ""}</td>
      </tr>`);
    }
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:#aaa;padding:12px;">이벤트 없음</td></tr>`;
    return;
  }

  // 합계 행
  rows.push(`<tr style="font-weight:700;background:#f8fbf8;">
    <td>합 계</td><td>-</td>
    <td>${fmt(d.stock_in_count)}</td>
    <td>${fmt(d.initial_stock_weight, 1)}</td>
    <td>${fmt(d.avg_stock_weight, 2)}</td>
    <td>${fmt(d.total_dead || 0)}</td>
    <td>${fmt(d.total_shipped)}</td>
    <td>${fmt(d.total_ship_weight, 1)}</td>
    <td>${fmt(d.avg_ship_weight, 2)}</td>
    <td>${fmt(running)}</td><td>-</td>
  </tr>`);

  tbody.innerHTML = rows.join("");
  window.initTableSort?.();
}

// ─── 저장 ────────────────────────────────────────────────────
async function saveSettlement() {
  const batch_id = document.getElementById("batch-select").value;
  if (!batch_id) return Swal.fire({ icon: "warning", title: "뱃지를 선택하세요." });

  const msg = document.getElementById("save-msg");
  msg.textContent = "저장 중...";

  const body = {
    claim_count:        numVal("f-claim-count"),
    std_mortality_rate: document.getElementById("f-std-mortality-rate").value,
    grade_1plus:        numVal("f-grade-1plus"),
    grade_1:            numVal("f-grade-1"),
    grade_2:            numVal("f-grade-2"),
    grade_out_spec:     numVal("f-grade-out-spec"),
    grade_out_other:    numVal("f-grade-out-other"),
    grade_penalty:      numVal("f-grade-penalty"),
    feed_piglet:        numVal("f-feed-piglet"),
    feed_grow:          numVal("f-feed-grow"),
    feed_cost_total:    numVal("f-feed-cost-total"),
    base_fee:           numVal("f-base-fee"),
    incentive_growth:   numVal("f-incentive-growth"),
    incentive_feed:     numVal("f-incentive-feed"),
    penalty_grade:      numVal("f-penalty-grade"),
    prepayment:         numVal("f-prepayment"),
    payment_note:       document.getElementById("f-payment-note").value.trim(),
    revenue:            numVal("f-revenue"),
    piglet_cost:        numVal("f-piglet-cost"),
  };

  try {
    await fetch(API + `/${batch_id}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json()).then((j) => { if (!j.success) throw new Error(j.error); });
    msg.textContent = "";
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "저장되었습니다", showConfirmButton: false, timer: 1800 });
  } catch (err) {
    msg.textContent = "";
    Swal.fire({ icon: "error", title: "저장 실패", text: err.message });
  }
}

// ─── Excel 다운로드 ──────────────────────────────────────────
async function downloadExcel() {
  const batch_id = document.getElementById("batch-select").value;
  if (!batch_id) return Swal.fire({ icon: "warning", title: "뱃지를 선택하세요." });

  // 잔여두수 확인
  const remEl = document.getElementById("v-remaining");
  const remaining = parseInt((remEl?.textContent || "").replace(/[^0-9]/g, "")) || 0;

  if (remaining > 0) {
    const { isConfirmed } = await Swal.fire({
      icon: "warning",
      title: `잔여두수 ${remaining.toLocaleString()}두 있음`,
      html: `<p style="text-align:left;font-size:0.9rem;">
        현재 사육두수가 남아 있습니다.<br><br>
        <b>확인이 불가한 경우</b>: 이벤트 입력에서 도태/폐사/확인불가 건수를 추가해 주세요.<br><br>
        <b>아직 출하되지 않은 돼지가 확인되면</b>: 그냥 두셔도 됩니다.<br><br>
        그래도 다운로드 하시겠습니까?
      </p>`,
      showCancelButton: true,
      confirmButtonText: "다운로드",
      cancelButtonText: "취소",
      confirmButtonColor: "#1a73a7",
    });
    if (!isConfirmed) return;
  }

  const pass_id = document.getElementById("pass-select")?.value || "";
  window.location.href = API + `/${batch_id}/excel` + (pass_id ? `?pass_id=${pass_id}` : "");
}

// ─── 이메일 발송 ─────────────────────────────────────────────
async function sendSettlementEmail() {
  const batch_id = document.getElementById("batch-select").value;
  if (!batch_id) return Swal.fire({ icon: "warning", title: "뱃지를 선택하세요." });

  const { value: formValues, isConfirmed } = await Swal.fire({
    title: "위탁정산서 이메일 발송",
    html: `
      <div style="text-align:left;font-size:0.9rem;">
        <label style="display:block;margin-bottom:4px;font-weight:600;">수신자 (농장주) *</label>
        <input id="swal-to" class="swal2-input" style="margin:0 0 12px;width:100%;box-sizing:border-box;"
          placeholder="farm@example.com" value="${_ownerEmail}" />
        <label style="display:block;margin-bottom:4px;font-weight:600;">참조 (선택)</label>
        <input id="swal-cc" class="swal2-input" style="margin:0;width:100%;box-sizing:border-box;"
          placeholder="cc@example.com" />
      </div>`,
    showCancelButton: true,
    confirmButtonText: "발송",
    cancelButtonText: "취소",
    confirmButtonColor: "#5b4da8",
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
    const pass_id = document.getElementById("pass-select")?.value || "";
    await apiFetch(`/${batch_id}/send-email`, {
      method: "POST",
      body: JSON.stringify({ to, cc: cc || undefined, pass_id: pass_id || undefined }),
    });
    Swal.fire({ icon: "success", title: "발송 완료", text: `${to} 으로 발송되었습니다.` });
  } catch (err) {
    Swal.fire({ icon: "error", title: "발송 실패", text: err.message });
  }
}

// ─── 초기화 ──────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", loadBatches);
