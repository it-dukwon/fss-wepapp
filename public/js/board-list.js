// public/js/board.js
let me = { authenticated: false, isAdmin: false, user: null };

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

  const latest = ut > ct ? u : c;
  return formatYMD(latest);
}


function formatDate(s) {
  if (!s) return "-";
  try { return new Date(s).toLocaleString(); } catch { return String(s); }
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
    a.className = "notice-link";         // ✅ 말줄임 적용 대상
    a.href = `/board/${encodeURIComponent(p.id)}`;
    a.textContent = p.title;
    tdTitle.appendChild(a);
    tr.appendChild(tdTitle);

    const tdDate = document.createElement("td");
    tdDate.className = "col-date";
    tdDate.textContent = latestYMD(p.created_at, p.updated_at);
    tr.appendChild(tdDate);

    // const tdMeta = document.createElement("td");
    // tdMeta.innerHTML =
    //   `<div class="muted">작성: ${formatDate(p.created_at)}</div>` +
    //   `<div class="muted">수정: ${formatDate(p.updated_at)}</div>`;
    // tr.appendChild(tdMeta);

    const tdActions = document.createElement("td");
    // tdActions.className = "row-actions";
    tdActions.className = "col-admin row-actions";
    tdActions.setAttribute("data-admin-only", "");
    tdActions.style.display = me.isAdmin ? "" : "none";

    if (me.isAdmin) {
      const btnEdit = document.createElement("button");
      btnEdit.className = "btn";
      btnEdit.textContent = "수정";
      btnEdit.onclick = () => location.href = `/board/${encodeURIComponent(p.id)}`;
      tdActions.appendChild(btnEdit);

      const btnDel = document.createElement("button");
      btnDel.className = "btn";
      btnDel.textContent = "삭제";
      btnDel.onclick = async () => {
        if (!confirm(`삭제할까요? (id=${p.id})`)) return;
        const dr = await fetch(`/api/board/${encodeURIComponent(p.id)}`, {
          method: "DELETE",
          credentials: "include",
        });
        const dd = await dr.json().catch(() => ({}));
        if (!dr.ok) return alert(dd.error || "삭제 실패");
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

  if (!title) return alert("제목을 입력하세요");
  if (!body) return alert("내용을 입력하세요");

  const r = await fetch("/api/board", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) return alert(data.error || "등록 실패");

  document.getElementById("newTitle").value = "";
  document.getElementById("newBody").value = "";
  msg.textContent = "등록 완료";

  await loadList();
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

  await loadList();
})();
