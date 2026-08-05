/*
 * Cookie consent — shows a banner until the visitor accepts or rejects.
 * Non-essential cookies (Google AdSense) load ONLY after "Accept". The choice is
 * remembered in localStorage, so the banner doesn't reappear. A "Reject" keeps the
 * site fully usable (essential/session cookies only) but loads no ad scripts.
 *
 * Included on every page in place of the raw AdSense tag:
 *   <script defer src="/js/consent.js?v=1" data-ad-client="ca-pub-XXXX"></script>
 * Re-open later from anywhere with:  window.gwenoCookieSettings()
 */
(function () {
  var KEY = 'gweno_cookie_consent'; // 'accepted' | 'rejected'
  var POLICY = '/cookies.html';
  var AD_CLIENT = (document.currentScript && document.currentScript.getAttribute('data-ad-client')) || 'ca-pub-4355414519050737';

  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  // Inject the AdSense library once, only after consent.
  function loadAds() {
    if (window.__gwAdsLoaded || !AD_CLIENT) return;
    window.__gwAdsLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(AD_CLIENT);
    s.crossOrigin = 'anonymous';
    (document.head || document.documentElement).appendChild(s);
  }

  function injectStyles() {
    if (document.getElementById('gw-consent-style')) return;
    var st = document.createElement('style');
    st.id = 'gw-consent-style';
    st.textContent = [
      '#gw-consent{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;justify-content:center;padding:14px;pointer-events:none}',
      '#gw-consent .gw-in{pointer-events:auto;max-width:760px;width:100%;display:flex;gap:16px;align-items:center;flex-wrap:wrap;',
      'background:var(--card,#fff);color:var(--text,#111827);border:1px solid var(--line,#e5e7eb);border-radius:14px;',
      'padding:16px 18px;box-shadow:0 12px 40px rgba(0,0,0,.18)}',
      '#gw-consent .gw-txt{flex:1;min-width:220px;font-size:13.5px;line-height:1.5;margin:0;color:var(--muted,#4b5563)}',
      '#gw-consent .gw-txt a{color:var(--brand,#111827);text-decoration:underline}',
      '#gw-consent .gw-btns{display:flex;gap:10px;flex-wrap:wrap}',
      '#gw-consent .gw-btn{appearance:none;cursor:pointer;font:inherit;font-weight:700;font-size:14px;padding:10px 18px;border-radius:10px;border:1px solid var(--line,#e5e7eb);white-space:nowrap}',
      '#gw-consent .gw-reject{background:transparent;color:var(--text,#111827)}',
      '#gw-consent .gw-reject:hover{border-color:var(--brand,#111827)}',
      '#gw-consent .gw-accept{background:var(--brand,#111827);color:#fff;border-color:var(--brand,#111827)}',
      '#gw-consent .gw-accept:hover{opacity:.92}',
      '@media(max-width:560px){#gw-consent .gw-in{flex-direction:column;align-items:stretch}#gw-consent .gw-btns{justify-content:flex-end}}',
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  function removeBanner() { var b = document.getElementById('gw-consent'); if (b) b.parentNode.removeChild(b); }
  function accept() { set('accepted'); removeBanner(); loadAds(); }
  function reject() { set('rejected'); removeBanner(); }

  function showBanner() {
    if (document.getElementById('gw-consent')) return;
    injectStyles();
    var wrap = document.createElement('div');
    wrap.id = 'gw-consent';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-live', 'polite');
    wrap.setAttribute('aria-label', 'Cookie consent');
    wrap.innerHTML =
      '<div class="gw-in">' +
        '<p class="gw-txt">We use cookies to keep you signed in and understand how Gweno is used. ' +
          'With your consent we also use advertising cookies. See our <a href="' + POLICY + '">Cookie Policy</a>.</p>' +
        '<div class="gw-btns">' +
          '<button type="button" class="gw-btn gw-reject">Reject</button>' +
          '<button type="button" class="gw-btn gw-accept">Accept</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.querySelector('.gw-accept').addEventListener('click', accept);
    wrap.querySelector('.gw-reject').addEventListener('click', reject);
  }

  // Let a "Cookie settings" link anywhere (e.g. on the Cookie Policy page) reopen the banner.
  window.gwenoCookieSettings = showBanner;

  function start() {
    var choice = get();
    if (choice === 'accepted') { loadAds(); return; }
    if (choice === 'rejected') { return; }
    showBanner();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
