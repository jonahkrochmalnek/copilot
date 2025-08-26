// firebase-supabase-shim.v4.js
// Exposes on window:
//   saveToCloud()    -> push local -> Firestore
//   loadFromCloud()  -> pull Firestore -> local (reloads UI)
//   __debugCloud()   -> logs cloud size + updated_at

(async function () {
  if (window.__FIREBASE_SUPA_SHIM__) return;
  window.__FIREBASE_SUPA_SHIM__ = true;

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

  // --- Optional: purge illegal localStorage keys so Firestore writes never fail
  (function purgeIllegalLocalKeys(){
    const bad = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^__.*__$/.test(k)) bad.push(k); // Firestore forbids keys that begin AND end with "__"
    }
    bad.forEach(k => localStorage.removeItem(k));
  })();

  // --- Build state from localStorage, skipping illegal keys
  function collectLocal() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^__.*__$/.test(k)) continue; // skip "__cloud_wrapped__" etc.
      const v = localStorage.getItem(k);
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }

  function applyLocal(state, opts) {
    opts = opts || { reload: false };
    if (!state) return;
    try { localStorage.clear(); } catch {}
    for (const k in state) {
      const v = state[k];
      if (typeof v === "string") localStorage.setItem(k, v);
    }
    if (opts.reload && !sessionStorage.getItem("mg_cloud_applied")) {
      sessionStorage.setItem("mg_cloud_applied", "1");
      try { location.reload(); } catch {}
    }
  }

  async function saveToCloud() {
    const u = auth.currentUser; if (!u) return;
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
      }
    } catch (e) { console.error(e); }
  }

  // --- Autosave when localStorage changes
  let timer = null;
  function schedule(ms) {
    if (!auth.currentUser) return;
    clearTimeout(timer);
    timer = setTimeout(() => saveToCloud(), Math.max(300, ms || 1200));
  }
  const _si = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (k, v) { try { _si(k, v); } finally { schedule(800); } };
  const _ri = localStorage.removeItem.bind(localStorage);
  localStorage.removeItem = function (k) { try { _ri(k); } finally { schedule(800); } };
  const _cl = localStorage.clear.bind(localStorage);
  localStorage.clear = function () { try { _cl(); } finally { schedule(800); } };

  // --- Capture inputs the app might not persist (assumptions/inputs etc.)
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

  // --- Reveal main UI after successful Firebase auth
  async function revealAppUI(user) {
    try { document.body.classList.add('authed'); } catch {}
    // Hide common gate/login wrappers if present
    ['#gate','#login','#login-panel','#gate-card','.auth-panel','.gate','.signin-card']
      .forEach(sel => { const n = document.querySelector(sel); if (n) n.style.setProperty('display','none','important'); });
    const who = document.querySelector('#whoami');
    if (who && user?.email) who.textContent = `Signed in as ${user.email}`;
    // Pull cloud -> local and refresh UI
    try { await loadFromCloud({ reload: true }); } catch { try { location.reload(); } catch {} }
    // Also let any app code listen
    try { window.dispatchEvent(new CustomEvent('firebase-auth-success',{detail:{email:user?.email||null}})); } catch {}
  }

  // --- Route your UI login buttons to Firebase; block legacy Supabase /auth/v1/ calls
  (function wireAuthButtonsAndBlockLegacy(){
    // Block any lingering Supabase auth calls so they can't interfere
    const SUPA_AUTH_PATH = '/auth/v1/';
    const origFetch = window.fetch;
    window.fetch = async (input, init) => {
      try {
        const url = (typeof input === 'string') ? input : (input && input.url) || '';
        if (url.includes(SUPA_AUTH_PATH)) {
          console.warn('[shim] blocked legacy supabase call:', url);
          return new Response(JSON.stringify({ error: 'blocked by firebase shim' }), {
            status: 410, headers: { 'content-type': 'application/json' }
          });
        }
      } catch {}
      return origFetch(input, init);
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
      } catch (e) {
        console.error('[auth] sign-in failed', e);
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
    signInBtn && signInBtn.addEventListener('click', doSignIn, true); // capture to preempt old handlers
    signUpBtn && signUpBtn.addEventListener('click', doSignUp, true);

    authMod.onAuthStateChanged(auth, async (u) => {
      console.log('[auth state]', u?.email || 'signed out');
      if (u) {
        // If user is already signed in on load, reveal UI automatically
        await revealAppUI(u);
      }
    });
  })();

  // --- Public API
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
