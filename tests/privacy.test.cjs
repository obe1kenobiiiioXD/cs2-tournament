const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');

function privacy() {
  const local = new Map(), session = new Map();
  const wrap = map => ({ removeItem: key => map.delete(key) });
  const context = vm.createContext({ window: {}, URL,
    location: { origin: 'https://organizm.example', href: 'https://organizm.example/tournament/#/me' },
    localStorage: wrap(local), sessionStorage: wrap(session) });
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/privacy.js'), 'utf8'), context);
  return { api: context.window.OrganizmPrivacy, local, session };
}

test('images accept only same-origin HTTP(S) resources', () => {
  const { api } = privacy();
  assert.equal(api.imageUrl('assets/logo.webp'), 'https://organizm.example/tournament/assets/logo.webp');
  assert.equal(api.imageUrl('/media/logo.webp'), 'https://organizm.example/media/logo.webp');
  for (const url of ['https://avatars.steamstatic.com/a.jpg', '//tracking.example/pixel',
    'https://organizm.example.evil.test/image', 'https://user:pass@organizm.example/a',
    'http://organizm.example/a', 'javascript:alert(1)', 'data:image/svg+xml,abc', 'file:///etc/passwd', '']) {
    assert.equal(api.imageUrl(url), '', url);
  }
});

test('device cleanup removes application session data and preserves unrelated storage', () => {
  const { api, local, session } = privacy();
  const keys = ['organizm-auth', 'organizm-auth-code-verifier', 'organizm_demo_v3', 'organizm_back'];
  for (const map of [local, session]) {
    keys.forEach(k => map.set(k, 'private'));
    map.set('unrelated-application', 'keep');
  }
  api.clearDeviceData();
  for (const map of [local, session]) {
    keys.forEach(k => assert.equal(map.has(k), false));
    assert.equal(map.get('unrelated-application'), 'keep');
  }
});

test('document loads local scripts and styles without Google Fonts or CDN', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  for (const [, url] of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
    if (url.startsWith('data:')) continue;
    assert.doesNotMatch(url, /^https?:|^\/\//);
    assert.ok(fs.existsSync(path.join(root, url)), url);
  }
  assert.match(html, /href="#\/storage"/);
  assert.ok(html.indexOf('assets/privacy.js') < html.indexOf('assets/app.js'));
});

test('vendored SDK initializes as a browser script', () => {
  const context = { URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, fetch, setTimeout, clearTimeout,
    document: { currentScript: { tagName: 'SCRIPT', src: 'https://organizm.example/assets/vendor/supabase/supabase.js' }, getElementsByTagName: () => [] } };
  context.self = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'assets/vendor/supabase/supabase.js'), 'utf8'), context);
  assert.equal(typeof context.supabase.createClient, 'function');
});

test('all image renderers suppress external sources, including edit previews', () => {
  const { api } = privacy();
  const source = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');
  const images = source.slice(source.indexOf('  function avatar('), source.indexOf('  function stageBadge('));
  const field = source.slice(source.indexOf('  function imgField('), source.indexOf('  function bindImgFields('));
  const context = vm.createContext({ window: { OrganizmPrivacy: api }, esc: String, hash: () => 42 });
  vm.runInContext(images + '\n' + field, context);
  for (const expression of [
    'avatar({nickname:"Player", avatar_url:"https://tracking.example/pixel"})',
    'teamLogo({name:"Team", logo_url:"https://tracking.example/pixel"})',
    'banner({id:"t",mode:"5v5",banner_url:"https://tracking.example/pixel"})',
    'imgField("logo", "Logo", "https://tracking.example/pixel", "logo")',
  ]) assert.doesNotMatch(vm.runInContext(expression, context), /<img\b/);
  assert.match(vm.runInContext('avatar({nickname:"Player", avatar_url:"/media/avatar.webp"})', context), /<img\b/);
});
