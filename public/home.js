// بعض المتصفحات تتجاهل خاصية muted في HTML عند التشغيل التلقائي إن لم تُضبط صراحةً قبل play()
try {
  var video = document.getElementById('gatewayVideo');
  if (video) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      video.pause();
    } else {
      video.muted = true;
      video.play().catch(function () { /* تبقى صورة poster ظاهرة إن مُنع التشغيل التلقائي */ });
    }
  }
} catch (e) {}

// رابط مباشر لوثيقة بعينها (?doc=) يصل هنا قبل تسجيل الدخول؛ يُحفظ عبر رابط المكتبة وزر التخطي ليعود المستخدم إليها بعد الدخول.
try {
  var docId = new URLSearchParams(location.search).get('doc');
  if (docId) {
    ['libraryCard', 'skipLink'].forEach(function (id) {
      var a = document.getElementById(id);
      if (a) a.href = '/login?doc=' + encodeURIComponent(docId);
    });
  }
} catch (e) {}
