// public/js/board-list.js
let me = { authenticated: false, isAdmin: false, user: null };

// ── 탭 전환 ──────────────────────────────────────
document.querySelectorAll(".ls-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".ls-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".ls-tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add("active");
    if (btn.dataset.tab === "banner") loadBanners();
  });
});

async function fetchMe() {
  const r = await fetch("/api/me", { credentials: "include" });
  if (!r.ok) return { authenticated: false, isAdmin: false };
  return r.json();
}

function formatYMD(d) {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return "-";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function latestYMD(createdAt, updatedAt) {
  const c = createdAt ? new Date(createdAt) : null;
  const u = updatedAt ? new Date(updatedAt) : null;
  const ct = c && Number.isFinite(c.getTime()) ? c.getTime() : -Infinity;
  const ut = u && Number.isFinite(u.getTime()) ? u.getTime() : -Infinity;
  return formatYMD(ut > ct ? u : c);
}

function setAdminVisible(isAdmin) {
  document.querySelectorAll("[data-admin-only]").forEach(el => {
    el.style.display = isAdmin ? "" : "none";
  });
}

async function loadList() {
  const r = await fetch("/api/board", { credentials: "include" });
  const data = await r.json();
  if (!data.success) throw new Error(data.error || "Failed to load list");

  const tbody = document.getElementById("rows");
  tbody.innerHTML = "";

  for (const p of data.posts || []) {
    const tr = document.createElement("tr");

    const tdId = document.createElement("td");
    tdId.textContent = p.id;
    tdId.className = "col-no";
    tr.appendChild(tdId);

    const tdTitle = document.createElement("td");
    const a = document.createElement("a");
    a.href = `/board/${encodeURIComponent(p.id)}`;
    a.textContent = p.title;
    a.style.cssText = "color:var(--green-main);font-weight:600;text-decoration:none;";
    a.onmouseover = () => { a.style.textDecoration = "underline"; };
    a.onmouseout  = () => { a.style.textDecoration = "none"; };
    tdTitle.appendChild(a);
    tr.appendChild(tdTitle);

    const tdDate = document.createElement("td");
    tdDate.className = "col-date";
    tdDate.textContent = latestYMD(p.created_at, p.updated_at);
    tr.appendChild(tdDate);

    const tdActions = document.createElement("td");
    tdActions.className = "col-admin row-actions";
    tdActions.setAttribute("data-admin-only", "");
    tdActions.style.display = me.isAdmin ? "" : "none";

    if (me.isAdmin) {
      const btnEdit = document.createElement("button");
      btnEdit.className = "ls-btn ls-btn-blue";
      btnEdit.textContent = "수정";
      btnEdit.onclick = () => location.href = `/board/${encodeURIComponent(p.id)}`;
      tdActions.appendChild(btnEdit);

      const btnDel = document.createElement("button");
      btnDel.className = "ls-btn ls-btn-red";
      btnDel.style.marginLeft = "6px";
      btnDel.textContent = "삭제";
      btnDel.onclick = async () => {
        const result = await Swal.fire({
          title: "삭제할까요?",
          text: `글 번호 ${p.id}`,
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "삭제",
          cancelButtonText: "취소",
          confirmButtonColor: "#d9534f",
        });
        if (!result.isConfirmed) return;
        const dr = await fetch(`/api/board/${encodeURIComponent(p.id)}`, {
          method: "DELETE",
          credentials: "include",
        });
        const dd = await dr.json().catch(() => ({}));
        if (!dr.ok) {
          Swal.fire({ icon: "error", title: "삭제 실패", text: dd.error || "오류가 발생했습니다." });
          return;
        }
        await loadList();
      };
      tdActions.appendChild(btnDel);
    }

    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  }
}

async function createPost() {
  const title = (document.getElementById("newTitle").value || "").trim();
  const body = (document.getElementById("newBody").value || "").trim();
  const msg = document.getElementById("createMsg");
  msg.textContent = "";

  if (!title) { Swal.fire({ icon: "warning", title: "제목을 입력하세요" }); return; }
  if (!body)  { Swal.fire({ icon: "warning", title: "내용을 입력하세요" }); return; }

  const r = await fetch("/api/board", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    Swal.fire({ icon: "error", title: "등록 실패", text: data.error || "오류가 발생했습니다." });
    return;
  }

  document.getElementById("newTitle").value = "";
  document.getElementById("newBody").value = "";
  msg.textContent = "등록 완료";
  await loadList();
}

// ── 한줄공지 ─────────────────────────────────────
function fmtDT(s) {
  if (!s) return "-";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function isBannerActive(from, to) {
  const now = Date.now();
  return new Date(from).getTime() <= now && now <= new Date(to).getTime();
}

async function loadBanners() {
  const tbody = document.getElementById("banner-rows");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="ls-empty">로딩 중...</td></tr>`;
  try {
    const r = await fetch("/api/notice-banners", { credentials: "include" });
    const data = await r.json();
    if (!data.success) throw new Error(data.error);
    if (!data.banners.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="ls-empty">등록된 한줄공지 없음</td></tr>`;
      return;
    }
    tbody.innerHTML = data.banners.map(b => {
      const active = isBannerActive(b.display_from, b.display_to);
      const statusBadge = active
        ? `<span style="color:#fff;background:#d9534f;padding:2px 8px;border-radius:20px;font-size:0.78rem;">노출 중</span>`
        : `<span style="color:#888;background:#eee;padding:2px 8px;border-radius:20px;font-size:0.78rem;">비노출</span>`;
      return `<tr>
        <td>${b.id}</td>
        <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${b.message}</td>
        <td>${fmtDT(b.display_from)}</td>
        <td>${fmtDT(b.display_to)}</td>
        <td>${statusBadge}</td>
        <td data-admin-only style="display:${me.isAdmin ? "" : "none"};">
          <button class="ls-btn ls-btn-red" style="padding:3px 8px;" onclick="deleteBanner(${b.id})">삭제</button>
        </td>
      </tr>`;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="ls-empty" style="color:#d9534f;">${err.message}</td></tr>`;
  }
}

async function createBanner() {
  const message = (document.getElementById("bnMessage")?.value || "").trim();
  const from    = document.getElementById("bnFrom")?.value;
  const to      = document.getElementById("bnTo")?.value;

  if (!message) { Swal.fire({ icon: "warning", title: "공지 내용을 입력하세요" }); return; }
  if (!from)    { Swal.fire({ icon: "warning", title: "노출 시작일시를 입력하세요" }); return; }
  if (!to)      { Swal.fire({ icon: "warning", title: "노출 종료일시를 입력하세요" }); return; }

  const r = await fetch("/api/notice-banners", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, display_from: from, display_to: to }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { Swal.fire({ icon: "error", title: "등록 실패", text: data.error }); return; }

  document.getElementById("bnMessage").value = "";
  Swal.fire({ toast: true, position: "top-end", icon: "success", title: "등록됐습니다", timer: 1800, showConfirmButton: false });
  await loadBanners();
}

async function deleteBanner(id) {
  const ok = await Swal.fire({
    title: "삭제할까요?", icon: "warning",
    showCancelButton: true, confirmButtonText: "삭제", cancelButtonText: "취소",
    confirmButtonColor: "#d9534f",
  });
  if (!ok.isConfirmed) return;
  const r = await fetch(`/api/notice-banners/${id}`, { method: "DELETE", credentials: "include" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { Swal.fire({ icon: "error", title: "삭제 실패", text: data.error }); return; }
  Swal.fire({ toast: true, position: "top-end", icon: "success", title: "삭제됐습니다", timer: 1500, showConfirmButton: false });
  await loadBanners();
}

(async function init() {
  me = await fetchMe();

  const meBox = document.getElementById("meBox");
  if (me.authenticated) {
    meBox.textContent = `로그인: ${me.user?.preferred_username || "-"} / 관리자: ${me.isAdmin ? "Y" : "N"}`;
  } else {
    meBox.textContent = "로그인이 필요합니다.";
  }

  setAdminVisible(!!me.isAdmin);

  const btnCreate = document.getElementById("btnCreate");
  if (btnCreate) btnCreate.onclick = createPost;

  // 한줄공지 등록 버튼
  const btnBannerCreate = document.getElementById("btnBannerCreate");
  if (btnBannerCreate) btnBannerCreate.onclick = createBanner;

  // 한줄공지 기본 날짜: from 오늘 00:00, to 오늘 23:59
  const today = new Date();
  const pad = n => String(n).padStart(2, "0");
  const dateStr = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  const bnFrom = document.getElementById("bnFrom");
  const bnTo   = document.getElementById("bnTo");
  if (bnFrom) bnFrom.value = `${dateStr}T00:00`;
  if (bnTo)   bnTo.value   = `${dateStr}T23:59`;

  await loadList();
})();
