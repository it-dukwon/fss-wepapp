// public/js/board-list.js
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
