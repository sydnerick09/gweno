/* Sliding Sign In / Sign Up panel. Reuses helpers from auth.js + countries.js. */
(function () {
  const root = document.getElementById('auth-root');
  if (!root) return;

  // validEmail + passwordIssue come from auth.js (shared with forgot/reset pages).
  const usernameIssue = (u) => (/^[a-zA-Z0-9]{6,10}$/.test(u || '') ? null : 'Username must be 6–10 letters or numbers.');

  root.className = 'ap ap-wrap';
  root.innerHTML = `
    <div class="ap-container" id="apContainer">
      <div class="ap-form signup">
        <form id="formUp" novalidate>
          <h1>Create your Gweno account</h1>
          <span class="ap-muted">Sign up with your email to start earning on Gweno.</span>
          <div class="msg" id="msgUp"></div>
          <input name="name" type="text" placeholder="Your name" autocomplete="name" />
          <input name="email" type="email" placeholder="Email" autocomplete="email" />
          <select name="country" id="suCountry"></select>
          <input name="phone" type="tel" placeholder="Phone number" autocomplete="tel" id="suPhone" />
          <input name="username" type="text" placeholder="Username (6–10 letters/numbers)" autocomplete="username" minlength="6" maxlength="10" />
          <div class="pw-wrap"><input name="password" type="password" placeholder="Password" autocomplete="new-password" id="suPassword" /><button type="button" class="pw-toggle" data-pwtoggle="suPassword" aria-label="Show password"></button></div>
          <div class="pw-wrap"><input name="confirm" type="password" placeholder="Confirm password" autocomplete="new-password" id="suConfirm" /><button type="button" class="pw-toggle" data-pwtoggle="suConfirm" aria-label="Show password"></button></div>
          <div id="suCaptcha" class="ap-captcha"></div>
          <button class="ap-btn" type="submit" id="suBtn">Sign Up</button>
          <p class="ap-switch">Already have an account? <a data-goto="signin">Sign in</a></p>
        </form>
      </div>

      <div class="ap-form signin">
        <form id="formIn" novalidate>
          <h1>Sign in to Gweno</h1>
          <span class="ap-muted">Enter your Gweno email and password.</span>
          <div class="msg" id="msgIn"></div>
          <input name="email" type="email" placeholder="Email" autocomplete="email" />
          <div class="pw-wrap"><input name="password" type="password" placeholder="Password" autocomplete="current-password" id="siPassword" /><button type="button" class="pw-toggle" data-pwtoggle="siPassword" aria-label="Show password"></button></div>
          <a class="ap-forgot" href="/forgot.html">Forgot your password?</a>
          <button class="ap-btn" type="submit" id="siBtn">Sign In</button>
          <button class="ap-link-btn" type="button" id="magicBtn">Email me a sign-in link instead</button>
          <p class="ap-switch">No account? <a data-goto="signup">Sign up</a></p>
        </form>
      </div>

      <div class="ap-overlay-container">
        <div class="ap-overlay">
          <div class="ap-panel left">
            <h1>Welcome Back!</h1>
            <p>To keep connected with us, please sign in with your account.</p>
            <button class="ap-btn ghost" id="goSignIn">Sign In</button>
          </div>
          <div class="ap-panel right">
            <h1>Hello, Friend!</h1>
            <p>Register with your personal details to use all of the site's features.</p>
            <button class="ap-btn ghost" id="goSignUp">Sign Up</button>
          </div>
        </div>
      </div>
    </div>
    <p class="ap-copy">© ${new Date().getFullYear()} Gweno. All rights reserved.</p>`;

  const container = document.getElementById('apContainer');
  const setSignup = (on) => container.classList.toggle('right-active', on);
  if (/signup/i.test(location.pathname)) setSignup(true); // signup.html opens on the Sign Up side

  document.getElementById('goSignUp').addEventListener('click', () => setSignup(true));
  document.getElementById('goSignIn').addEventListener('click', () => setSignup(false));
  root.querySelectorAll('[data-goto]').forEach((a) => a.addEventListener('click', () => setSignup(a.dataset.goto === 'signup')));

  redirectIfAuthed();
  const suCountry = document.getElementById('suCountry');
  const suPhone = document.getElementById('suPhone');
  populateCountries(suCountry);
  // Prefill / update the phone number with the selected country's dialling code,
  // so numbers match the chosen country (helps prevent mismatched/fraud entries).
  suCountry.addEventListener('change', () => {
    const dial = suCountry.selectedOptions[0] ? suCountry.selectedOptions[0].dataset.dial || '' : '';
    const current = suPhone.value.trim();
    // Replace an existing leading dial code (or empty field) with the new one.
    if (!current || /^\+\d{1,4}\s*$/.test(current) || current.startsWith('+')) {
      suPhone.value = dial ? dial + ' ' : '';
    }
    suPhone.placeholder = dial ? `${dial} 712 345 678` : 'Phone number';
    suPhone.focus();
  });
  attachPasswordToggles(root);

  // Surface sign-in errors (e.g. device limit, expired magic link) on the sign-in side.
  const oerr = new URLSearchParams(location.search).get('error');
  if (oerr) {
    const map = {
      device_limit: 'An account already exists on this device.',
      magic_invalid: 'That sign-in link is invalid or has expired. Please request a new one.',
    };
    showMsg(document.getElementById('msgIn'), map[oerr] || 'Sign-in could not be completed. Please try again.', 'error');
  }

  const formIn = document.getElementById('formIn');
  const msgIn = document.getElementById('msgIn');
  const siBtn = document.getElementById('siBtn');
  formIn.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg(msgIn);
    if (!validEmail(formIn.email.value)) return showMsg(msgIn, 'Please enter a valid email address.', 'error');
    if (!formIn.password.value) return showMsg(msgIn, 'Please enter your password.', 'error');
    siBtn.disabled = true;
    const { ok, data } = await api('/api/login', { email: formIn.email.value.trim(), password: formIn.password.value });
    if (ok) routeAfterAuth(data.user);
    else { showMsg(msgIn, data.error || 'Could not sign in.', 'error'); siBtn.disabled = false; }
  });

  // ---- Passwordless sign-in: email a one-time magic link ----
  const magicBtn = document.getElementById('magicBtn');
  magicBtn.addEventListener('click', async () => {
    clearMsg(msgIn);
    if (!validEmail(formIn.email.value)) return showMsg(msgIn, "Enter your email above and we'll send you a sign-in link.", 'error');
    magicBtn.disabled = true;
    const { ok, data } = await api('/api/auth/magic/start', { email: formIn.email.value.trim() });
    showMsg(msgIn, data.message || data.error || 'If that email is registered, a sign-in link is on its way.', ok ? 'ok' : 'error');
    magicBtn.disabled = false;
  });

  const formUp = document.getElementById('formUp');
  const msgUp = document.getElementById('msgUp');
  const suBtn = document.getElementById('suBtn');

  // ---- CAPTCHA (Cloudflare Turnstile), renders only if configured on the server ----
  let captchaToken = '';
  (async () => {
    let cfg = {};
    try { cfg = await (await fetch('/api/config')).json(); } catch (_) {}
    if (!cfg.turnstileSiteKey) return; // not configured -> no widget; signup still works
    formUp.dataset.captcha = '1';
    window.__gwenoCfLoad = () => {
      try {
        window.turnstile.render('#suCaptcha', {
          sitekey: cfg.turnstileSiteKey, theme: 'auto',
          callback: (t) => { captchaToken = t; },
          'expired-callback': () => { captchaToken = ''; },
          'error-callback': () => { captchaToken = ''; },
        });
      } catch (_) {}
    };
    const sc = document.createElement('script');
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__gwenoCfLoad&render=explicit';
    sc.async = true; sc.defer = true;
    document.head.appendChild(sc);
  })();

  formUp.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg(msgUp);
    setSignup(true);
    const fail = (m) => showMsg(msgUp, m, 'error');
    if (!formUp.name.value.trim()) return fail('Please enter your name.');
    if (!validEmail(formUp.email.value)) return fail('Please enter a valid email address (e.g. name@gmail.com).');
    if (!formUp.country.value) return fail('Please select your country.');
    const uErr = usernameIssue(formUp.username.value.trim()); if (uErr) return fail(uErr);
    const pErr = passwordIssue(formUp.password.value); if (pErr) return fail(pErr);
    if (formUp.password.value !== formUp.confirm.value) return fail('Passwords do not match.');
    if (formUp.dataset.captcha === '1') {
      const token = captchaToken || (window.turnstile && window.turnstile.getResponse ? window.turnstile.getResponse() : '');
      if (!token) return fail('Please complete the "I\'m not a robot" check and try again.');
      captchaToken = token;
    }
    suBtn.disabled = true;
    const { ok, data } = await api('/api/signup', {
      name: formUp.name.value, email: formUp.email.value, username: formUp.username.value,
      phone: formUp.phone.value, country: formUp.country.value, password: formUp.password.value,
      captcha: captchaToken,
      ref: new URLSearchParams(location.search).get('ref') || '', deviceId: await getDeviceId(),
    });
    if (ok) routeAfterAuth(data.user);
    else { setSignup(true); showMsg(msgUp, data.error || 'Could not create account.', 'error'); suBtn.disabled = false; }
  });
})();
