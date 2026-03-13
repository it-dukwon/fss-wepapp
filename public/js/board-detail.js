// public/js/board-detail.js
let me = { authenticated: false, isAdmin: false, user: null };

function getIdFromPath() {
  const m = location.pathname.match(/\/board\/(\d+)/);
  if (m) return m[1];
  return new URLSearchParams(location.search).get("id");
}

async function fetchMe() {
  const r = await fetch("/api/me", { credentials: "include" });
  if (!r.ok) return { authenticated: false, isAdmin: false };
  return r.json();
}

function setAdminVisible(isAdmin) {
  document.querySelectorAll("[data-admin-only]").forEach(el => {
    el.style.display = isAdmin ? "" : "none";
  });
}

function formatDate(s) {
  if (!s) return "-";
  try { return new Date(s).toLocaleString(); } catch { return String(s); }
}

async function loadPost(id) {
  const r = await fetch(`/api/board/${encodeURIComponent(id)}`, { credentials: "include" });
  const data = await r.json();
  if (!data.success) throw new Error(data.error || "Failed to load");

  const p = data.post;
  if (!p) {
    document.getElementById("title").textContent = "글이 없습니다.";
    return null;
  }

  document.getElementById("title").textContent = p.title;
  document.getElementById("meta").textContent =
    `작성: ${formatDate(p.created_at)} / 수정: ${formatDate(p.updated_at)} / 작성자: ${p.author_upn || "-"}`;
  document.getElementById("body").textContent = p.body;

  if (me.isAdmin) {
    document.getElementById("editTitle").value = p.title;
    document.getElementById("editBody").value = p.body;
  }

  return p;
}

async function savePost(id) {
  const title = (document.getElementById("editTitle").value || "").trim();
  const body  = (document.getElementById("editBody").value  || "").trim();

  if (!title) { Swal.fire({ icon: "warning", title: "제목을 입력하세요" }); return; }
  if (!body)  { Swal.fire({ icon: "warning", title: "내용을 입력하세요" }); return; }

  const r = await fetch(`/api/board/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    Swal.fire({ icon: "error", title: "저장 실패", text: data.error || "오류가 발생했습니다." });
    return;
  }

  document.getElementById("msg").textContent = "저장 완료";
  await loadPost(id);
}

async function deletePost(id) {
  const result = await Swal.fire({
    title: "정말 삭제할까요?",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "삭제",
    cancelButtonText: "취소",
    confirmButtonColor: "#d9534f",
  });
  if (!result.isConfirmed) return;

  const r = await fetch(`/api/board/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    Swal.fire({ icon: "error", title: "삭제 실패", text: data.error || "오류가 발생했습니다." });
    return;
  }

  location.href = "/board";
}

(async function init() {
  const id = getIdFromPath();
  if (!id) {
    Swal.fire({ icon: "error", title: "잘못된 접근입니다", text: "id가 없습니다." });
    return;
  }

  me = await fetchMe();
  setAdminVisible(!!me.isAdmin);
  await loadPost(id);

  const btnSave   = document.getElementById("btnSave");
  const btnDelete = document.getElementById("btnDelete");
  if (btnSave)   btnSave.onclick   = () => savePost(id);
  if (btnDelete) btnDelete.onclick = () => deletePost(id);
})();
