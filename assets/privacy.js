// Вспомогательные функции приватности. Не заменяют локализацию базы и документы оператора.
(function () {
  'use strict';
  const keys = ['organizm-auth', 'organizm-auth-code-verifier', 'organizm_demo_v3', 'organizm_back'];

  function imageUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value, location.href);
      // Произвольные изображения не должны автоматически раскрывать IP посетителя внешним сайтам.
      if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
      return url.href;
    } catch (_) { return ''; }
  }

  function clearDeviceData() {
    for (const key of keys) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
  }

  window.OrganizmPrivacy = Object.freeze({ imageUrl, clearDeviceData });
})();
