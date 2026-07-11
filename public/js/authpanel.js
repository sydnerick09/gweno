/* Sliding Sign In / Sign Up panel. Reuses helpers from auth.js + countries.js. */
(function () {
  const root = document.getElementById('auth-root');
  if (!root) return;

  const socialRow = () => `<div class="ap-socials">${['google', 'facebook', 'apple']
    .map((p) => `<button type="button" data-provider="${p}" aria-label="Continue with ${p}">${SOCIAL_SVGS[p]}</button>`).join('')}</div>`;

  root.className = 'ap ap-wrap';
  root.innerHTML = `
    <div class="ap-container" id="apContainer">
      <div class="ap-form signup">
        <form id="formUp" novalidate>
          <h1>Create Account</h1>
          ${socialRow()}
          <span class="ap-muted">or use your email for registration</span>
          <div class="msg" id="msgUp"></div>
          <input name="name" type="text" placeholder="Your name" autocomplete="name" />
          <input name="email" type="email" placeholder="Email" autocomplete="email" />
          <input name="phone" type="tel" placeholder="Phone number (e.g. +254 712 345 678)" autocomplete="tel" />
          <input name="username" type="text" placeholder="Username (6–10 letters/numbers)" autocomplete="username" minlength="6" maxlength="10" />
          <select name="country" id="suCountry"></select>
          <div class="pw-wrap"><input name="password" type="password" placeholder="Password" autocomplete="new-password" id="suPassword" /><button type="button" class="pw-toggle" data-pwtoggle="suPassword" aria-label="Show password"></button></div>
          <div class="pw-wrap"><input name="confirm" type="password" placeholder="Confirm password" autocomplete="new-password" id="suConfirm" /><button type="button" class="pw-toggle" data-pwtoggle="suConfirm" aria-label="Show password"></button></div>
          <button class="ap-btn" type="submit" id="suBtn">Sign Up</button>
          <p class="ap-switch">Already have an account? <a data-goto="signin">Sign in</a></p>
        </form>
      </div>

      <div class="ap-form signin">
        <form id="formIn" novalidate>
          <h1>Sign In</h1>
          ${socialRow()}
          <span class="ap-muted">or use your email password</span>
          <div class="msg" id="msgIn"></div>
          <input name="email" type="email" placeholder="Email" autocomplete="email" />
          <div class="pw-wrap"><input name="password" type="password" placeholder="Password" autocomplete="current-password" id="siPassword" /><button type="button" class="pw-toggle" data-pwtoggle="siPassword" aria-label="Show password"></button></div>
          <a class="ap-forgot" href="/forgot.html">Forgot your password?</a>
          <button class="ap-btn" type="submit" id="siBtn">Sign In</button>
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
    </div>`;

  const container = document.getElementById('apContainer');
  const setSignup = (on) => container.classList.toggle('right-active', on);
  if (/signup/i.test(location.pathname)) setSignup(true); // signup.html opens on the Sign Up side

  document.getElementById('goSignUp').addEventListener('click', () => setSignup(true));
  document.getElementById('goSignIn').addEventListener('click', () => setSignup(false));
  root.querySelectorAll('[data-goto]').forEach((a) => a.addEventListener('click', () => setSignup(a.dataset.goto === 'signup')));

  redirectIfAuthed();
  populateCountries(document.getElementById('suCountry'));
  attachPasswordToggles(root);
  root.querySelectorAll('.ap-socials [data-provider]').forEach((b) => b.addEventListener('click', () => socialLogin(b.dataset.provider)));

  // Surface OAuth errors from the provider callback on the sign-in side.
  const oerr = new URLSearchParams(location.search).get('error');
  if (oerr) {
    const map = {
      device_limit: 'An account already exists on this device.',
      oauth_no_email: "That provider didn't share an email. Try another method.",
      google_unavailable: 'Google sign-in is not available yet.',
      facebook_unavailable: 'Facebook sign-in is not available yet.',
      apple_unavailable: 'Apple sign-in is not available yet.',
    };
    showMsg(document.getElementById('msgIn'), map[oerr] || 'Sign-in could not be completed. Please try again.', 'error');
  }

  const formIn = document.getElementById('formIn');
  const msgIn = document.getElementById('msgIn');
  const siBtn = document.getElementById('siBtn');
  formIn.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg(msgIn);
    siBtn.disabled = true;
    const { ok, data } = await api('/api/login', { email: formIn.email.value, password: formIn.password.value });
    if (ok) routeAfterAuth(data.user);
    else { showMsg(msgIn, data.error || 'Could not sign in.', 'error'); siBtn.disabled = false; }
  });

  const formUp = document.getElementById('formUp');
  const msgUp = document.getElementById('msgUp');
  const suBtn = document.getElementById('suBtn');
  formUp.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg(msgUp);
    if (formUp.password.value !== formUp.confirm.value) { setSignup(true); return showMsg(msgUp, 'Passwords do not match.', 'error'); }
    suBtn.disabled = true;
    const { ok, data } = await api('/api/signup', {
      name: formUp.name.value, email: formUp.email.value, username: formUp.username.value,
      phone: formUp.phone.value, country: formUp.country.value, password: formUp.password.value,
      ref: new URLSearchParams(location.search).get('ref') || '', deviceId: await getDeviceId(),
    });
    if (ok) routeAfterAuth(data.user);
    else { setSignup(true); showMsg(msgUp, data.error || 'Could not create account.', 'error'); suBtn.disabled = false; }
  });
})();
