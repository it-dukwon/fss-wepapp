// public/js/page-view-log.js
// 페이지 진입 시 /api/log/page-view 호출 (fire-and-forget)
// 각 페이지에서 <script src="/js/page-view-log.js" data-page="페이지명"></script> 형태로 사용
(function () {
  const script = document.currentScript ||
    document.querySelector('script[src*="page-view-log"]');
  const page = script?.dataset?.page || document.title || location.pathname;

  fetch("/api/log/page-view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ page }),
  }).catch(() => {});
})();
