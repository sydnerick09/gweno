/* Shared site footer — mounted into <div id="site-footer"></div>. */
(function () {
  const mount = document.getElementById('site-footer');
  if (!mount) return;
  const year = new Date().getFullYear();
  mount.outerHTML = `
  <footer class="footer">
    <div class="footer-inner">
      <div class="footer-brand">
        <a class="brand" href="/"><img src="/img/logo.png" alt="Gweno" onerror="this.onerror=null;this.src='/img/logo.svg'" style="height:32px;width:auto;vertical-align:middle;margin-right:8px"> gweno</a>
        <p>Complete quick tasks and surveys, earn real rewards, and cash out to M‑Pesa. Simple, secure, and built for people who get things done.</p>
        <div class="socials-row" aria-label="Find us on social media">
          <a href="/contact.html" title="X" aria-label="X"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-7 8 8.2 12h-6.4l-5-6.6L5.9 22H2.7l7.5-8.6L2.3 2h6.6l4.5 6.1L18.9 2z"/></svg></a>
          <a href="/contact.html" title="Facebook" aria-label="Facebook"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z"/></svg></a>
          <a href="/contact.html" title="Instagram" aria-label="Instagram"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg></a>
          <a href="/contact.html" title="LinkedIn" aria-label="LinkedIn"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6.94 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM3 8.5h3.8V21H3zM9 8.5h3.6v1.7h.05c.5-.9 1.7-1.9 3.5-1.9 3.7 0 4.4 2.4 4.4 5.5V21h-3.8v-5.4c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V21H9z"/></svg></a>
        </div>
      </div>

      <div class="footer-col">
        <h4>Company</h4>
        <a href="/about.html">About us</a>
        <a href="/partners.html">Partners</a>
        <a href="/contact.html">How to find us</a>
        <a href="/contact.html">Communication</a>
      </div>

      <div class="footer-col">
        <h4>Legal</h4>
        <a href="/terms.html">Terms &amp; Conditions</a>
        <a href="/privacy.html">Privacy Policy</a>
        <a href="/cookies.html">Cookie Policy</a>
        <a href="/community.html">Community Rules</a>
      </div>

      <div class="footer-col">
        <h4>Get started</h4>
        <a href="/signup.html">Create account</a>
        <a href="/login.html">Sign in</a>
        <a href="/help.html">Help Center</a>
        <a href="/support.html">Help &amp; support</a>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© ${year} Gweno. All rights reserved.</span>
      <span>Made for people who get things done.</span>
    </div>
  </footer>`;
})();
