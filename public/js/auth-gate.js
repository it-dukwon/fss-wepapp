(async function () {
  try {
    const res = await fetch("/api/me", { credentials: "include" });

    // 로그인 안 됨 → 로그인 페이지로
    if (res.status === 401) {
      window.location.replace("/login");
      return;
    }

    // 로그인 됨 → 사용자 정보 표시 및 스위치 계정 버튼 추가
    const data = await res.json();
    console.log("Logged in user:", data.user);

    try {
      const user = data.user || {};
      const name = user.name || user.preferred_username || user.oid || "사용자";

      // 표시할 위치: .avatar 요소가 있다면 이름을 표시
      const avatar = document.querySelector('.avatar');
      if (avatar) {
        avatar.innerHTML = `<span title="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
      }

      // 추가: 스위치 계정 버튼 (로그아웃 옆)
      const actions = document.querySelector('.actions');
      if (actions && !document.getElementById('switchAccountBtn')) {
        const btn = document.createElement('button');
        btn.id = 'switchAccountBtn';
        btn.type = 'button';
        btn.className = 'switch-account-btn';
        btn.textContent = '다른 계정으로 로그인';
        // Navigate to public /switch-account endpoint which clears session then redirects
        btn.addEventListener('click', () => {
          console.log('[AuthGate] switch-account button clicked');
          window.location.href = '/switch-account';
        });
        // insert before logout button if exists
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) actions.insertBefore(btn, logoutBtn);
        else actions.appendChild(btn);
      }
    } catch (e) {
      console.warn('UI user render failed', e);
    }
  } catch (e) {
    console.error("Auth check failed:", e);
    // 서버 죽었거나 네트워크 문제면 일단 로그인으로 보내도 됨
    window.location.replace("/login");
  }
})();

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])
  );
}
