\
// firebase-supabase-shim.v4.js — Firebase-backed sync for Microgreens Copilot
// - Initializes Firebase (Auth + Firestore) with YOUR config
// - Email/Password sign-in/out helpers
// - Autosaves localStorage to Firestore (/app_state/{uid})
// - Loads cloud state on sign-in (one-time) and refreshes UI
// - Captures form overrides (for fields the app doesn’t persist) and replays them on load
// - Debug helper: __debugCloud()

(async function() {
  if (window.__FIREBASE_SUPA_SHIM__) return;
  window.__FIREBASE_SUPA_SHIM__ = true;

  const [appMod, authMod, fsMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js")
  ]);

  const firebaseConfig = {
  "apiKey": "AIzaSyBXOQCdSTvFah9_3UFDc551Z1DV0FJHxrE",
  "authDomain": "microgreenscopilot.firebaseapp.com",
  "projectId": "microgreenscopilot",
  "storageBucket": "microgreenscopilot.firebasestorage.app",
  "messagingSenderId": "62914864299",
  "appId": "1:62914864299:web:db29a9bc07f8a71b0043ee"
};
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  try { await authMod.setPersistence(auth, authMod.browserLocalPersistence); } catch(e) { console.warn('persistence', e); }
  const db  = fsMod.getFirestore(app);

  const whoami   = document.getElementById("whoami");
  const statusEl = document.getElementById("status");
  const cloudBar = document.getElementById("cloud-controls");
  const LOCAL_KEY = "microgreens_calc_unified";
  const OVERRIDES_KEY = "shim_form_overrides";

  // ---- Helpers
  function collectLocalState() {
    try {
      const single = localStorage.getItem(LOCAL_KEY);
      if (single) return { [LOCAL_KEY]: single, [OVERRIDES_KEY]: localStorage.getItem(OVERRIDES_KEY) };
    } catch (e) {}
    const state = {};
    for (let i=0;i<localStorage.length;i++) {
      const k = localStorage.key(i);
      state[k] = localStorage.getItem(k);
    }
    return state;
  }
  function applyLocalState(state, opts) {
    opts = opts || { reload:false };
    if (!state) return;
    try { localStorage.clear(); } catch (e) {}
    for (const k in state) {
      const v = state[k];
      if (typeof v === "string") localStorage.setItem(k, v);
    }
    if (opts.reload && !sessionStorage.getItem("mg_cloud_applied")) {
      sessionStorage.setItem("mg_cloud_applied", "1");
      try { location.reload(); } catch (e) {}
    }
  }

  // ---- Cloud I/O
  async function saveToCloud() {
    const u = auth.currentUser;
    if (!u) { if (statusEl) statusEl.textContent = "Please sign in first."; return; }
    if (statusEl) statusEl.textContent = "Saving…";
    try {
      await fsMod.setDoc(fsMod.doc(db, "app_state", u.uid), {
        state: collectLocalState(),
        updated_at: fsMod.serverTimestamp()
      }, { merge: true });
      if (statusEl) statusEl.textContent = "Saved to cloud ✔";
    } catch (e) {
      if (statusEl) statusEl.textContent = "Save failed.";
      console.error(e);
    }
  }
  async function loadFromCloud(opts) {
    opts = opts || { reload:true }; // refresh UI by default
    const u = auth.currentUser;
    if (!u) { if (statusEl) statusEl.textContent = "Please sign in first."; return; }
    if (statusEl) statusEl.textContent = "Loading…";
    try {
      const snap = await fsMod.getDoc(fsMod.doc(db, "app_state", u.uid));
      if (snap.exists()) {
        const data = snap.data();
        applyLocalState((data && data.state) || {}, opts);
        if (statusEl) statusEl.textContent = "Loaded cloud data ✔";
      } else {
        if (statusEl) statusEl.textContent = "No cloud save yet. Use “Save to Cloud”.";
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = "Load failed.";
      console.error(e);
    }
  }

  // ---- Autosave on localStorage changes
  let autosaveEnabled = true;
  let saveTimer = null;
  function scheduleAutosave(delayMs) {
    if (!autosaveEnabled) return;
    if (!auth.currentUser) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveToCloud(); }, Math.max(300, delayMs||1200));
  }
  const _setItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(k, v) { try { _setItem(k, v); } finally { scheduleAutosave(800); } };
  const _remove = localStorage.removeItem.bind(localStorage);
  localStorage.removeItem = function(k) { try { _remove(k); } finally { scheduleAutosave(800); } };
  const _clear = localStorage.clear.bind(localStorage);
  localStorage.clear = function() { try { _clear(); } finally { scheduleAutosave(800); } };

  // ---- Form overrides (capture fields app doesn’t persist)
  function stableKeyFor(el) { return el.id || el.name || el.getAttribute('data-field') || null; }
  function storeOverride(el) {
    const key = stableKeyFor(el);
    if (!key) return;
    let bag = {};
    try { bag = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}'); } catch {}
    const v = (el.type === 'checkbox') ? !!el.checked : el.value;
    bag[key] = v;
    try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(bag)); } catch (e) { console.warn("override save", e); }
    scheduleAutosave(600);
  }
  function applyOverrides() {
    let bag = null;
    try { bag = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || 'null'); } catch {}
    if (!bag) return;
    Object.keys(bag).forEach((key) => {
      let el = document.getElementById(key);
      if (!el) el = document.querySelector('[name="' + CSS.escape(key) + '"]');
      if (!el) return;
      const v = bag[key];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
      try { el.blur(); } catch {}
    });
  }
  document.addEventListener('input',  (e) => { const t = e.target; if (t) storeOverride(t); }, true);
  document.addEventListener('change', (e) => { const t = e.target; if (t) storeOverride(t); }, true);
  document.addEventListener('blur',   (e) => { const t = e.target; if (t) storeOverride(t); }, true);

  // ---- Save on tab close; periodic sanity save
  let lastSnapshot = localStorage.getItem(LOCAL_KEY) || '';
  setInterval(function() {
    if (!auth.currentUser) return;
    const cur = localStorage.getItem(LOCAL_KEY) || '';
    if (cur !== lastSnapshot) { lastSnapshot = cur; saveToCloud(); }
  }, 10000);
  window.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") scheduleAutosave(0); });
  window.addEventListener("pagehide", () => scheduleAutosave(0));
  window.addEventListener("beforeunload", () => scheduleAutosave(0));

  // ---- Optional gate helpers (only if your HTML has these IDs)
  function gateEmail() { return (document.getElementById("gate-email")||{}).value||""; }
  function gatePass()  { return (document.getElementById("gate-password")||{}).value||""; }
  async function doSignIn() { await authMod.signInWithEmailAndPassword(auth, gateEmail().trim(), gatePass().trim()); }
  async function doSignUp() { await authMod.createUserWithEmailAndPassword(auth, gateEmail().trim(), gatePass().trim()); }
  async function doSignOut() { try { await saveToCloud(); } catch {} try { await authMod.signOut(auth); } catch (e) { console.error(e); } }

  // ---- Public API
  window.saveToCloud = saveToCloud;
  window.loadFromCloud = function() { return loadFromCloud({ reload:true }); };
  window.signIn = doSignIn;
  window.signUp = doSignUp;
  window.signOut = doSignOut;
  window.setAutoSave = function(on) { autosaveEnabled = !!on; };
  window.clearAppLocal = function() { try { localStorage.removeItem(LOCAL_KEY); } catch {} };

  // ---- Supabase-shaped shim so legacy calls keep working (if your HTML calls supabase.*)
  const shim = {
    auth: {
      async getUser() {
        const u = auth.currentUser;
        return { data: { user: u ? { id: u.uid, email: u.email } : null }, error: null };
      },
      async signInWithPassword({ email, password }) {
        await authMod.signInWithEmailAndPassword(auth, email, password);
        return { data: { user: auth.currentUser ? { id: auth.currentUser.uid, email: auth.currentUser.email } : null }, error: null };
      },
      async signUp({ email, password }) {
        await authMod.createUserWithEmailAndPassword(auth, email, password);
        return { data: { user: auth.currentUser ? { id: auth.currentUser.uid, email: auth.currentUser.email } : null }, error: null };
      },
      async signOut() { await doSignOut(); return { error: null }; }
    },
    from(table) {
      if (table !== "app_state") {
        return {
          select: async () => ({ data: null, error: "unsupported table" }),
          upsert: async () => ({ data: null, error: "unsupported table" }),
          update: async () => ({ data: null, error: "unsupported table" }),
          insert: async () => ({ data: null, error: "unsupported table" })
        };
      }
      const chain = {
        eq() { return this; },
        select() { return this; },
        async single() {
          const u = auth.currentUser; if (!u) return { data: null, error: "not signed in" };
          const snap = await fsMod.getDoc(fsMod.doc(db, "app_state", u.uid));
          return snap.exists() ? { data: snap.data(), error: null } : { data: null, error: null };
        },
        async upsert(rows) {
          const u = auth.currentUser; if (!u) return { data: null, error: "not signed in" };
          const payload = Array.isArray(rows) ? rows[0] : rows;
          await fsMod.setDoc(fsMod.doc(db, "app_state", u.uid), payload, { merge: true });
          return { data: payload, error: null };
        },
        async update(obj) {
          const u = auth.currentUser; if (!u) return { data: null, error: "not signed in" };
          await fsMod.setDoc(fsMod.doc(db, "app_state", u.uid), obj, { merge: true });
          return { data: obj, error: null };
        }
      };
      return chain;
    },
    createClient() { return shim; }
  };
  try { delete window.supabase; } catch { window.supabase = undefined; }
  window.supabase = shim;
  window.createClient = function() { return shim; };

  // Apply overrides after load & after autoload refresh
  function applyOverridesSoon() { setTimeout(applyOverrides, 400); setTimeout(applyOverrides, 1200); }
  document.addEventListener('DOMContentLoaded', applyOverridesSoon);

  // Optional: wire up buttons if your HTML has them
  const btnIn = document.getElementById("gate-signin");
  const btnUp = document.getElementById("gate-signup");
  if (btnIn && !btnIn.dataset.wiredShim) { btnIn.addEventListener("click", doSignIn); btnIn.dataset.wiredShim = "1"; }
  if (btnUp && !btnUp.dataset.wiredShim) { btnUp.addEventListener("click", doSignUp); btnUp.dataset.wiredShim = "1"; }

  // Debug helper
  window.__debugCloud = async function() {
    const u = auth.currentUser; if (!u) return console.log("Not signed in");
    const snap = await fsMod.getDoc(fsMod.doc(db, "app_state", u.uid));
    if (!snap.exists()) return console.log("No cloud doc");
    const data = snap.data();
    const ts = data.updated_at && data.updated_at.toDate ? data.updated_at.toDate() : null;
    console.log("Cloud size:", JSON.stringify(data.state||{}).length, "updated_at:", ts);
    return data;
  };
})();
