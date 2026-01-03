(async function () {
  try {
    const res = await fetch("/api/me", { credentials: "include" });

    // 로그인 안 됨 → 로그인 페이지로
    if (res.status === 401) {
      window.location.replace("/login");
      return;
    }

    // 로그인 됨 → 필요하면 사용자 정보 활용
    const data = await res.json();
    console.log("Logged in user:", data.user);
  } catch (e) {
    console.error("Auth check failed:", e);
    // 서버 죽었거나 네트워크 문제면 일단 로그인으로 보내도 됨
    window.location.replace("/login");
  }
})();
