<!-- Save this as: firebase-supabase-shim.v4.clean.js -->
<script>
// firebase-supabase-shim.v4.clean.js (wrapped in a <script> so you can copy quickly; remove this wrapper if saving to a .js file)
/*
  Exposes:
    window.saveToCloud()   // push local -> cloud
    window.loadFromCloud() // pull cloud -> local (reloads UI)
    window.__debugCloud()  // log cloud size + updated_at
*/
(async function(){
  if(window.__FIREBASE_SUPA_SHIM__) return; window.__FIREBASE_SUPA_SHIM__=true;
  const [appMod,authMod,fsMod]=await Promise.all([
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js")
  ]);
  const firebaseConfig={"apiKey":"AIzaSyBXOQCdSTvFah9_3UFDc551Z1DV0FJHxrE","authDomain":"microgreenscopilot.firebaseapp.com","projectId":"microgreenscopilot","storageBucket":"microgreenscopilot.firebasestorage.app","messagingSenderId":"62914864299","appId":"1:62914864299:web:db29a9bc07f8a71b0043ee"};
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  try{ await authMod.setPersistence(auth, authMod.browserLocalPersistence); }catch(e){ console.warn("persistence",e); }
  const db = fsMod.getFirestore(app);

  const LOCAL_KEY="microgreens_calc_unified";
  const OVERRIDES_KEY="shim_form_overrides";

  function collectLocal(){
    try{
      const single=localStorage.getItem(LOCAL_KEY);
      if(single) return {[LOCAL_KEY]:single,[OVERRIDES_KEY]:localStorage.getItem(OVERRIDES_KEY)};
    }catch(e){}
    const s={};
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      s[k]=localStorage.getItem(k);
    }
    return s;
  }
  function applyLocal(state,opts){
    opts=opts||{reload:false};
    if(!state) return;
    try{ localStorage.clear(); }catch(e){}
    for(const k in state){
      const v=state[k];
      if(typeof v==="string") localStorage.setItem(k,v);
    }
    if(opts.reload && !sessionStorage.getItem("mg_cloud_applied")){
      sessionStorage.setItem("mg_cloud_applied","1");
      try{ location.reload(); }catch(e){}
    }
  }

  async function saveToCloud(){
    const u=auth.currentUser; if(!u){ return; }
    try{
      await fsMod.setDoc(fsMod.doc(db,"app_state",u.uid),{
        state:collectLocal(),
        updated_at:fsMod.serverTimestamp()
      },{merge:true});
    }catch(e){ console.error(e); }
  }
  async function loadFromCloud(opts){
    opts=opts||{reload:true};
    const u=auth.currentUser; if(!u){ return; }
    try{
      const snap=await fsMod.getDoc(fsMod.doc(db,"app_state",u.uid));
      if(snap.exists()){
        const d=snap.data();
        applyLocal((d&&d.state)||{},opts);
      }
    }catch(e){ console.error(e); }
  }

  let timer=null;
  function schedule(ms){
    if(!auth.currentUser) return;
    clearTimeout(timer);
    timer=setTimeout(function(){ saveToCloud(); },Math.max(300,ms||1200));
  }
  const _si=localStorage.setItem.bind(localStorage);
  localStorage.setItem=function(k,v){ try{_si(k,v);}finally{schedule(800);} };
  const _ri=localStorage.removeItem.bind(localStorage);
  localStorage.removeItem=function(k){ try{_ri(k);}finally{schedule(800);} };
  const _cl=localStorage.clear.bind(localStorage);
  localStorage.clear=function(){ try{_cl();}finally{schedule(800);} };

  function stableKey(el){ return el.id||el.name||el.getAttribute("data-field")||null; }
  function storeOverride(el){
    const key=stableKey(el); if(!key) return;
    let bag={}; try{ bag=JSON.parse(localStorage.getItem(OVERRIDES_KEY)||"{}"); }catch(e){}
    const v=(el.type==="checkbox")?!!el.checked:el.value;
    bag[key]=v;
    try{ localStorage.setItem(OVERRIDES_KEY, JSON.stringify(bag)); }catch(e){}
    schedule(600);
  }
  document.addEventListener("input",function(e){ var t=e.target; if(t) storeOverride(t); },true);
  document.addEventListener("change",function(e){ var t=e.target; if(t) storeOverride(t); },true);
  document.addEventListener("blur",function(e){ var t=e.target; if(t) storeOverride(t); },true);

  function applyOverrides(){
    var bag=null; try{ bag=JSON.parse(localStorage.getItem(OVERRIDES_KEY)||"null"); }catch(e){}
    if(!bag) return;
    Object.keys(bag).forEach(function(key){
      var el=document.getElementById(key);
      if(!el) el=document.querySelector('[name="'+CSS.escape(key)+'"]');
      if(!el) return;
      var v=bag[key];
      if(el.type==="checkbox") el.checked=!!v; else el.value=v;
      try{ el.dispatchEvent(new Event("input",{bubbles:true})); }catch(e){}
      try{ el.dispatchEvent(new Event("change",{bubbles:true})); }catch(e){}
      try{ el.blur(); }catch(e){}
    });
  }
  function applyOverridesSoon(){ setTimeout(applyOverrides,400); setTimeout(applyOverrides,1200); }
  document.addEventListener("DOMContentLoaded",applyOverridesSoon);

  window.saveToCloud=saveToCloud;
  window.loadFromCloud=function(){ return loadFromCloud({reload:true}); };
  window.__debugCloud=async function(){
    const u=auth.currentUser; if(!u) return console.log("Not signed in");
    const snap=await fsMod.getDoc(fsMod.doc(db,"app_state",u.uid));
    if(!snap.exists()) return console.log("No cloud doc");
    const data=snap.data();
    const ts=(data.updated_at&&data.updated_at.toDate)?data.updated_at.toDate():null;
    console.log("Cloud size:", JSON.stringify(data.state||{}).length, "updated_at:", ts);
    return data;
  };
})();
</script>
