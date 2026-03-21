// settlement.js

const API = window.location.hostname.includes("localhost")
  ? "http://localhost:3000/api/settlement"
  : "https://webapp-databricks-dashboard-c7a3fjgmb7d3dnhn.koreacentral-01.azurewebsites.net/api/settlement";

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
    if (bid) { sel.value = bid; loadSettlement(); }
  } catch (err) {
    console.error(err);
  }
}

// ─── 정산서 로드 ─────────────────────────────────────────────
async function loadSettlement() {
  const batch_id = document.getElementById("batch-select").value;
  if (!batch_id) { document.getElementById("st-body").style.display = "none"; return; }

  try {
    const { data: d } = await apiFetch(`/${batch_id}`);
    document.getElementById("st-body").style.display = "";

    // ── ① 기본 정보 ────────────────────────────────
    document.getElementById("v-farm-name").textContent        = d.batch.farm_name || d.batch.manager || "-";
    document.getElementById("f-farm-account").value           = d.manual.farm_account || "";
    document.getElementById("v-stock-in-date").textContent    = fmtDate(d.stock_in_date);
    document.getElementById("v-stock-in-count").textContent   = fmt(d.stock_in_count) + " 두";
    document.getElementById("f-initial-stock-weight").value  = d.initial_stock_weight || "";
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
    document.getElementById("f-claim-count").value            = d.claim_count || 0;
    document.getElementById("v-total-dead").textContent       = fmt(d.total_dead) + " 두";
    document.getElementById("v-adj-dead").textContent         = fmt(d.adj_dead) + " 두";
    document.getElementById("v-mortality-act").textContent    = pct(d.mortality_act);
    document.getElementById("f-std-mortality-rate").value    = d.std_rate ?? 0.03;
    document.getElementById("v-std-head").textContent         = fmt(d.std_head) + " 두";
    document.getElementById("v-deduct-head").textContent      = fmt(d.deduct_head) + " 두";
    document.getElementById("v-settlement-count").textContent = fmt(d.settlement_count) + " 두";

    // ── ③ 등급 ─────────────────────────────────────
    document.getElementById("f-grade-1plus").value     = d.manual.grade_1plus     || 0;
    document.getElementById("f-grade-1").value         = d.manual.grade_1          || 0;
    document.getElementById("f-grade-2").value         = d.manual.grade_2          || 0;
    document.getElementById("f-grade-out-spec").value  = d.manual.grade_out_spec   || 0;
    document.getElementById("f-grade-out-other").value = d.manual.grade_out_other  || 0;
    document.getElementById("f-grade-penalty").value   = d.grade_penalty           || 0;

    // ── ④ 사료 ─────────────────────────────────────
    document.getElementById("f-feed-piglet").value     = d.feed_piglet || 0;
    document.getElementById("f-feed-grow").value       = d.feed_grow   || 0;
    document.getElementById("f-feed-cost-total").value = d.feed_cost   || 0;
    updateFeedCalc(d);

    // ── ⑤ 위탁사육비 ───────────────────────────────
    document.getElementById("f-base-fee").value          = d.base_fee         || 0;
    document.getElementById("f-incentive-growth").value  = d.incentive_growth  || 0;
    document.getElementById("f-incentive-feed").value    = d.incentive_feed    || 0;
    document.getElementById("f-penalty-grade").value     = d.penalty_grade     || 0;
    document.getElementById("f-prepayment").value        = d.prepayment        || 0;
    document.getElementById("f-payment-note").value      = d.manual.payment_note || "";
    updatePaymentCalc(d);

    // ── ⑥ 수익 분석 ────────────────────────────────
    document.getElementById("f-revenue").value     = d.revenue    || 0;
    document.getElementById("f-piglet-cost").value = d.piglet_cost || 0;
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
  const piglet = Number(document.getElementById("f-feed-piglet").value) || 0;
  const grow   = Number(document.getElementById("f-feed-grow").value)   || 0;
  const total  = piglet + grow;
  const wgain  = d.total_weight_gain || 0;
  const days   = d.breeding_days     || 0;
  const cnt    = d.stock_in_count    || 0;
  const cost   = Number(document.getElementById("f-feed-cost-total").value) || 0;

  document.getElementById("v-feed-total").textContent    = fmt(total) + " kg";
  document.getElementById("v-feed-fcr").textContent      = wgain > 0 ? fmt(total / wgain, 2) : "-";
  document.getElementById("v-feed-daily").textContent    = (days > 0 && cnt > 0) ? fmt(total / days / cnt, 3) + " kg" : "-";
  document.getElementById("v-feed-per-head").textContent = cnt > 0 ? fmt(total / cnt, 1) + " kg" : "-";
  document.getElementById("v-feed-avg-cost").textContent = cnt > 0 ? won(Math.round(cost / cnt)) : "-";
  document.getElementById("v-feed-cost-disp").textContent = won(cost);
}

function updatePaymentCalc(d) {
  const base   = Number(document.getElementById("f-base-fee").value)         || 0;
  const ig     = Number(document.getElementById("f-incentive-growth").value)  || 0;
  const ifd    = Number(document.getElementById("f-incentive-feed").value)    || 0;
  const pg     = Number(document.getElementById("f-penalty-grade").value)     || 0;
  const gpn    = Number(document.getElementById("f-grade-penalty").value)     || 0;
  const prep   = Number(document.getElementById("f-prepayment").value)        || 0;
  const net    = base + ig + ifd - pg - gpn - prep;

  document.getElementById("v-net-payment").textContent  = won(net);
  document.getElementById("v-net-payment2").textContent = won(net);
  return net;
}

function updateRevenueCalc(d) {
  const rev    = Number(document.getElementById("f-revenue").value)     || 0;
  const pc     = Number(document.getElementById("f-piglet-cost").value) || 0;
  const fc     = Number(document.getElementById("f-feed-cost-total").value) || 0;
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
      document.getElementById("v-deduct-head").textContent   = fmt(ded) + " 두";
    };
  });
}

// ─── 이력 테이블 렌더링 ───────────────────────────────────────
function renderHistory(d) {
  const tbody = document.getElementById("history-tbody");
  const rows  = [];
  let running = d.stock_in_count;

  // 입식 초기 행
  rows.push(`<tr class="ev-in">
    <td>${fmtDate(d.stock_in_date)}</td>
    <td><span class="ev-badge ev-badge-in">입식</span></td>
    <td>${fmt(d.stock_in_count)}</td>
    <td>${fmt(d.initial_stock_weight, 1)}</td>
    <td>${fmt(d.avg_stock_weight, 2)}</td>
    <td>-</td><td>-</td><td>-</td><td>-</td>
    <td>${fmt(running)}</td><td>-</td>
  </tr>`);

  for (const ev of d.events) {
    if (ev.event_type === "death") {
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
    } else if (ev.event_type === "shipping") {
      running -= (ev.shipped || 0);
      const avg = ev.ship_weight && ev.shipped ? (ev.ship_weight / ev.shipped).toFixed(2) : "-";
      const outlets = [ev.distributor, ev.slaughterhouse, ev.meat_processor].filter(Boolean).join(" / ");
      rows.push(`<tr class="ev-ship">
        <td>${fmtDate(ev.event_date)}</td>
        <td><span class="ev-badge ev-badge-ship">출하</span></td>
        <td>-</td><td>-</td><td>-</td><td>-</td>
        <td>${fmt(ev.shipped)}</td>
        <td>${fmt(ev.ship_weight, 1)}</td>
        <td>${avg}</td>
        <td>${fmt(running)}</td>
        <td>${outlets}</td>
      </tr>`);
    }
  }

  // 합계 행
  rows.push(`<tr>
    <td>합 계</td><td>-</td>
    <td>${fmt(d.stock_in_count)}</td>
    <td>${fmt(d.initial_stock_weight, 1)}</td>
    <td>${fmt(d.avg_stock_weight, 2)}</td>
    <td>${fmt(d.total_dead)}</td>
    <td>${fmt(d.total_shipped)}</td>
    <td>${fmt(d.total_ship_weight, 1)}</td>
    <td>${fmt(d.avg_ship_weight, 2)}</td>
    <td>${fmt(running)}</td><td>-</td>
  </tr>`);

  tbody.innerHTML = rows.join("");
}

// ─── 저장 ────────────────────────────────────────────────────
async function saveSettlement() {
  const batch_id = document.getElementById("batch-select").value;
  if (!batch_id) return Swal.fire({ icon: "warning", title: "뱃지를 선택하세요." });

  const msg = document.getElementById("save-msg");
  msg.textContent = "저장 중...";

  const body = {
    farm_account:          document.getElementById("f-farm-account").value.trim(),
    initial_stock_weight:  document.getElementById("f-initial-stock-weight").value || null,
    claim_count:           document.getElementById("f-claim-count").value,
    std_mortality_rate:    document.getElementById("f-std-mortality-rate").value,
    grade_1plus:           document.getElementById("f-grade-1plus").value,
    grade_1:               document.getElementById("f-grade-1").value,
    grade_2:               document.getElementById("f-grade-2").value,
    grade_out_spec:        document.getElementById("f-grade-out-spec").value,
    grade_out_other:       document.getElementById("f-grade-out-other").value,
    grade_penalty:         document.getElementById("f-grade-penalty").value,
    feed_piglet:           document.getElementById("f-feed-piglet").value,
    feed_grow:             document.getElementById("f-feed-grow").value,
    feed_cost_total:       document.getElementById("f-feed-cost-total").value,
    base_fee:              document.getElementById("f-base-fee").value,
    incentive_growth:      document.getElementById("f-incentive-growth").value,
    incentive_feed:        document.getElementById("f-incentive-feed").value,
    penalty_grade:         document.getElementById("f-penalty-grade").value,
    prepayment:            document.getElementById("f-prepayment").value,
    payment_note:          document.getElementById("f-payment-note").value.trim(),
    revenue:               document.getElementById("f-revenue").value,
    piglet_cost:           document.getElementById("f-piglet-cost").value,
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
  const remaining = parseInt(remEl?.textContent) || 0;

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

  window.location.href = API + `/${batch_id}/excel`;
}

// ─── 초기화 ──────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", loadBatches);
