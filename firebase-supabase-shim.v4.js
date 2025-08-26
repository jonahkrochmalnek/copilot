// firebase-supabase-shim.v4.js (v16)
// Exposes on window:
//   saveToCloud()    -> push local -> Firestore
//   loadFromCloud()  -> pull Firestore -> local (reloads UI on FIRST pull only)
//   __debugCloud()   -> logs cloud size + updated_at

(async function () {
  if (window.__FIREBASE_SUPA_SHIM__) return;
  window.__FIREBASE_SUPA_SHIM__ = true;

  // Hide gate ASAP before auth settles (reduces flicker)
  try { document.body.classList.add('auth-initializing'); } catch {}

  // One-time SW + cache cleanup (helps Chrome regular profile)
  (async () => {
    try {
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        regs.forEach(r => r.unregister().catch(()=>{}));
      }
      if (window.caches && typeof caches.keys === 'function') {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k).catch(()=>{})));
      }
    } catch {}
  })();

  const [appMod, authMod, fsMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"),
  ]);

  const firebaseConfig = {
    apiKey: "AIzaSyBXOQCdSTvFah9_3UFDc551Z1DV0FJHxrE",
    authDomain: "microgreenscopilot.firebaseapp.com",
    projectId: "microgreenscopilot",
    storageBucket: "microgreenscopilot.firebasestorage.app",
    messagingSenderId: "62914864299",
    appId: "1:62914864299:web:db29a9bc07f8a71b0043ee",
  };

  const app  = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  try { await authMod.setPersistence(auth, authMod.browserLocalPersistence); }
  catch (e) { console.warn("persistence", e); }
  const db   = fsMod.getFirestore(app);

  const LOCAL_KEY     = "microgreens_calc_unified";
  const OVERRIDES_KEY = "shim_form_overrides";

  // Track first successful cloud->local pull (prevents pre-pull autosave)
  let FIRST_PULL_DONE = !!sessionStorage.getItem("mg_cloud_applied");
  let UI_REVEALED = false;

  // Anti-flicker CSS: hide gate during init and when authed
  (function injectAuthCss(){
    const s = document.createElement('style');
    s.textContent = `
      .auth-initializing #gate, .auth-initializing #login, .auth-initializing .gate,
      .auth-initializing .auth-panel, .auth-initializing .signin-card, .auth-initializing #login-panel, .auth-initializing #gate-card,
      .authed #gate, .authed #login, .authed .gate,
      .authed .auth-panel, .authed .signin-card, .authed #login-panel, .authed #gate-card {
        display: none !important; visibility: hidden !important; pointer-events: none !important;
      }
    `;
    document.head.appendChild(s);
  })();

  // Continuous enforcer: if legacy code re-inserts the gate, hide it again
  const GATE_SELECTORS = ['#gate','#login','#login-panel','#gate-card','.auth-panel','.gate','.signin-card'];
  function hideGatesHard() {
    if (!document.body.classList.contains('authed')) return requestAnimationFrame(hideGatesHard);
    for (const sel of GATE_SELECTORS) {
      document.querySelectorAll(sel).forEach(n => {
        n.style.setProperty('display','none','important');
        n.hidden = true;
        n.setAttribute('aria-hidden','true');
      });
    }
    requestAnimationFrame(hideGatesHard);
  }
  requestAnimationFrame(hideGatesHard);
  new MutationObserver(() => hideGatesHard())
    .observe(document.documentElement, { childList:true, subtree:true });

  // Purge illegal localStorage keys so Firestore writes never fail
  (function purgeIllegalLocalKeys(){
    const bad = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^__.*__$/.test(k)) bad.push(k);
    }
    bad.forEach(k => localStorage.removeItem(k));
  })();

  // Build state from localStorage, skipping illegal keys
  function collectLocal() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^__.*__$/.test(k)) continue;
      const v = localStorage.getItem(k);
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }

  // Apply state; RELOADS ONLY on the *first* pull in this tab
  function applyLocal(state, opts) {
    opts = opts || { reload: false };
    if (!state) return;

    const firstBefore = !sessionStorage.getItem("mg_cloud_applied");

    try { localStorage.clear(); } catch {}
    for (const k in state) {
      const v = state[k];
      if (typeof v === "string") localStorage.setItem(k, v);
    }

    // Mark first pull as complete
    FIRST_PULL_DONE = true;
    sessionStorage.setItem("mg_cloud_applied", "1");
    try { document.body.classList.remove('auth-initializing'); } catch {}

    // Reload ONLY on the first application (prevents flicker/loops)
    if (opts.reload && firstBefore) {
      try { location.reload(); } catch {}
    }
  }

  async function saveToCloud() {
    const u = auth.currentUser; if (!u) return;
    if (!FIRST_PULL_DONE || !sessionStorage.getItem("mg_cloud_applied")) {
      console.warn("[shim] save skipped; waiting for first cloud load");
      return;
    }
    try {
      await fsMod.setDoc(
        fsMod.doc(db, "app_state", u.uid),
        { state: collectLocal(), updated_at: fsMod.serverTimestamp() },
        { merge: true }
      );
    } catch (e) { console.error(e); }
  }

  async function loadFromCloud(opts) {
    opts = opts || { reload: true };
    const u = auth.currentUser; if (!u) return;
    try {
      const snap = await fsMod.getDoc(fsMod.doc(db, "app_state", u.uid));
      if (snap.exists()) {
        const d = snap.data();
        applyLocal((d && d.state) || {}, opts);
      } else {
        // No doc yet; mark first pull so this tab can start saving (no reload)
        FIRST_PULL_DONE = true;
        sessionStorage.setItem("mg_cloud_applied", "1");
        try { document.body.classList.remove('auth-initializing'); } catch {}
      }
    } catch (e) { console.error(e); }
  }

  // Autosave when localStorage changes (BLOCKED until first pull)
  let timer = null;
  function schedule(ms) {
    if (!auth.currentUser) return;
    if (!FIRST_PULL_DONE || !sessionStorage.getItem("mg_cloud_applied")) return;
    clearTimeout(timer);
    timer = setTimeout(() => saveToCloud(), Math.max(300, ms || 1200));
  }
  const _si = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (k, v) { try { _si(k, v); } finally { schedule(800); } };
  const _ri = localStorage.removeItem.bind(localStorage);
  localStorage.removeItem = function (k) { try { _ri(k); } finally { schedule(800); } };
  const _cl = localStorage.clear.bind(localStorage);
  localStorage.clear = function () { try { _cl(); } finally { schedule(800); } };

  // Capture inputs the app might not persist
  function stableKey(el) { return el.id || el.name || el.getAttribute("data-field") || null; }
  function storeOverride(el) {
    const key = stableKey(el); if (!key) return;
    let bag = {};
    try { bag = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}"); } catch {}
    const v = (el.type === "checkbox") ? !!el.checked : el.value;
    bag[key] = v;
    try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(bag)); } catch {}
    schedule(600);
  }
  document.addEventListener("input",  e => { const t = e.target; if (t) storeOverride(t); }, true);
  document.addEventListener("change", e => { const t = e.target; if (t) storeOverride(t); }, true);
  document.addEventListener("blur",   e => { const t = e.target; if (t) storeOverride(t); }, true);

  function applyOverrides() {
    let bag = null;
    try { bag = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "null"); } catch {}
    if (!bag) return;
    Object.keys(bag).forEach(key => {
      let el = document.getElementById(key);
      if (!el) el = document.querySelector('[name="' + CSS.escape(key) + '"]');
      if (!el) return;
      const v = bag[key];
      if (el.type === "checkbox") el.checked = !!v; else el.value = v;
      try { el.dispatchEvent(new Event("input",  { bubbles: true })); } catch {}
      try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
      try { el.blur(); } catch {}
    });
  }
  function applyOverridesSoon() { setTimeout(applyOverrides, 400); setTimeout(applyOverrides, 1200); }
  document.addEventListener("DOMContentLoaded", applyOverridesSoon);

  // Reveal main UI after successful Firebase auth (debounced & gate-removed)
  async function revealAppUI(user) {
    if (UI_REVEALED) return;
    UI_REVEALED = true;

    try { document.body.classList.add('authed'); } catch {}
    for (const sel of GATE_SELECTORS) {
      document.querySelectorAll(sel).forEach(n => {
        n.style.setProperty('display','none','important');
        n.hidden = true; n.setAttribute('aria-hidden','true');
        try { n.remove(); } catch {}
      });
    }
    const who = document.querySelector('#whoami');
    if (who && user?.email) who.textContent = `Signed in as ${user.email}`;

    // Decide once: first pull reloads, subsequent pulls are silent
    const needFirst = !sessionStorage.getItem('mg_cloud_applied');
    await loadFromCloud({ reload: needFirst });

    try { window.dispatchEvent(new CustomEvent('firebase-auth-success',{detail:{email:user?.email||null}})); } catch {}
  }

  // Minimal Supabase auth compatibility so old checks see "logged in"
  if (!window.supabase) window.supabase = {};
  if (!window.supabase.auth) window.supabase.auth = {};
  window.supabase.createClient = window.supabase.createClient || (() => window.supabase);
  window.supabase.auth.getUser = async () => {
    const u = auth.currentUser;
    return { data: { user: u ? { id: u.uid, email: u.email } : null }, error: null };
  };
  window.supabase.auth.getSession = async () => {
    const u = auth.currentUser;
    return { data: { session: u ? { user: { id: u.uid, email: u.email } } : null }, error: null };
  };
  window.supabase.auth.onAuthStateChange = (cb) => {
    const unsub = authMod.onAuthStateChanged(auth, (u) => {
      try { cb('TOKEN_REFRESHED', { session: u ? { user: { id: u.uid, email: u.email } } : null }); } catch {}
    });
    return { data: { subscription: { unsubscribe: () => unsub() } }, error: null };
  };
  window.supabase.auth.signOut = async () => { try { await authMod.signOut(auth); } catch {} ; return { error: null }; };

  // Route your UI login buttons to Firebase; block legacy Supabase /auth/v1/ calls
  (function wireAuthButtonsAndBlockLegacy(){
    const SUPA_AUTH_PATH = '/auth/v1/';
    const origFetch = window.fetch;
    window.fetch = async (input, init) => {
      try {
        const url = (typeof input === 'string') ? input : (input && input.url) || '';
        if (url && (url.includes(SUPA_AUTH_PATH))) {
          console.warn('[shim] blocked legacy supabase call:', url);
          return new Response(JSON.stringify({ error: 'blocked by firebase shim' }), {
            status: 410, headers: { 'content-type': 'application/json' }
          });
        }
      } catch {}
      return origFetch.call(this, input, init);
    };

    function getCreds() {
      const email = document.querySelector('#gate-email')?.value?.trim() || '';
      const pass  = document.querySelector('#gate-password')?.value || '';
      return { email, pass };
    }

    async function doSignIn(ev) {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); }
      const { email, pass } = getCreds();
      try {
        await authMod.signInWithEmailAndPassword(auth, email, pass);
        console.log('[auth] signed in as', auth.currentUser?.email);
        await revealAppUI(auth.currentUser);
      } catch (e) { console.error('[auth] sign-in failed', e);
      }
    }

    async function doSignUp(ev) {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); }
      const { email, pass } = getCreds();
      try {
        await authMod.createUserWithEmailAndPassword(auth, email, pass);
        console.log('[auth] account created for', auth.currentUser?.email);
        await revealAppUI(auth.currentUser);
      } catch (e) {
        if (e.code === 'auth/email-already-in-use') {
          console.warn('[auth] already exists — attempting sign-in');
          try {
            await authMod.signInWithEmailAndPassword(auth, email, pass);
            await revealAppUI(auth.currentUser);
          } catch (e2) { console.error('[auth] sign-in after exists failed', e2); }
        } else {
          console.error('[auth] sign-up failed', e);
        }
      }
    }

    const signInBtn = document.querySelector('#gate-signin');
    const signUpBtn = document.querySelector('#gate-signup') || document.querySelector('[data-create-account]');
    signInBtn && signInBtn.addEventListener('click', doSignIn, true);
    signUpBtn && signUpBtn.addEventListener('click', doSignUp, true);

    authMod.onAuthStateChanged(auth, async (u) => {
      console.log('[auth state]', u?.email || 'signed out');
      if (u) {
        try { document.body.classList.remove('auth-initializing'); } catch {}
        await revealAppUI(u);
      } else {
        // Signed out: allow gate to show again (no flicker)
        UI_REVEALED = false;
        try {
          document.body.classList.remove('authed');
          document.body.classList.remove('auth-initializing');
        } catch {}
      }
    });
  })();

  // If the page loads already authed, pull once automatically
  window.addEventListener('load', async () => {
    try {
      if (auth.currentUser && !sessionStorage.getItem('mg_cloud_applied') && !UI_REVEALED) {
        await loadFromCloud({ reload: true }); // first pull only
      } else {
        try { document.body.classList.remove('auth-initializing'); } catch {}
      }
    } catch (e) { console.warn('initial cloud pull on load failed', e); }
  });

  // Public API
  window.saveToCloud   = saveToCloud;
  window.loadFromCloud = function(){ return loadFromCloud({ reload: true }); };
  window.__debugCloud  = async function () {
    const u = auth.currentUser; if (!u) return console.log("Not signed in");
    const snap = await fsMod.getDoc(fsMod.doc(db, "app_state", u.uid));
    if (!snap.exists()) return console.log("No cloud doc");
    const data = snap.data();
    const ts = (data.updated_at && data.updated_at.toDate) ? data.updated_at.toDate() : null;
    console.log("Cloud size:", JSON.stringify(data.state || {}).length, "updated_at:", ts);
    return data;
  };
})();
