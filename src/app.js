import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, STORAGE_BUCKET, AVATAR_BUCKET, EDGE_BASE } from './supabase-config.js';
import './style.css';

const app = document.querySelector('#app');
const clientReady = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const supabase = clientReady ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

const state = {
  session: null,
  user: null,
  profile: null,
  guest: localStorage.getItem('filehub_guest') === '1',
  route: localStorage.getItem('filehub_route') || 'home',
  files: [],
  results: [],
  notifications: [],
  notificationCount: 0,
  query: '',
  loading: false,
  menu: false,
  modal: null,
  toast: null,
  isAdmin: false,
  adminLoaded: false,
  selectedFile: null,
  recentShared: []
};

const $ = (sel) => document.querySelector(sel);
const fmtSize = (n=0) => {
  const u=['B','KB','MB','GB','TB']; let i=0, v=Number(n)||0;
  while(v>=1024 && i<u.length-1){v/=1024;i++}
  return `${v<10&&i? v.toFixed(1):Math.round(v)} ${u[i]}`;
};
const fmtDate = (d) => new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(d));
const ext = (name='') => (name.split('.').pop()||'').toLowerCase();
const iconFor = (f) => {
  const e=ext(f.original_name||f.display_name); const m=f.mime_type||'';
  if(m.startsWith('image/')) return '🖼️'; if(m.startsWith('video/')) return '🎬'; if(m.startsWith('audio/')) return '🎵';
  if(e==='pdf') return '📕'; if(['zip','rar','7z'].includes(e)) return '🗜️'; if(['doc','docx'].includes(e)) return '📘';
  if(['xls','xlsx','csv'].includes(e)) return '📗'; if(['ppt','pptx'].includes(e)) return '📙'; return '📄';
};
const safeName = s => String(s||'').replace(/[<>]/g,m=>({'<':'&lt;','>':'&gt;'}[m]));
const toast = (message,type='ok') => { state.toast={message,type}; render(); setTimeout(()=>{state.toast=null;render()},2600); };
const setModal = (modal) => { state.modal=modal; render(); };
const isAuth = () => Boolean(state.user && state.session && !state.guest);
const avatarInitial = () => (state.profile?.full_name || state.user?.email || 'F').trim().slice(0,1).toUpperCase();
const publicApi = (path, opts={}) => fetch(`${EDGE_BASE}/${path}`, { ...opts, headers:{'Content-Type':'application/json', apikey:SUPABASE_ANON_KEY, ...(opts.headers||{})} });

function route(view) { state.route=view; localStorage.setItem('filehub_route',view); state.menu=false; render(); if(view==='files') loadFiles(); if(view==='home') loadHome(); if(view==='profile') loadProfileExtras(); }

function shell(body){
  return `<div class="app-shell">
    <header class="topbar">
      <div class="brand"><div class="brand-mark">FH</div><div><div class="brand-name">FileHub</div><div class="brand-sub">${state.guest?'Guest mode':'Secure cloud files'}</div></div></div>
      <div class="top-actions">
        <button class="icon-btn" id="notifyBtn" aria-label="Notifications">🔔${state.notificationCount?`<span class="badge">${Math.min(state.notificationCount,99)}</span>`:''}</button>
        <button class="icon-btn" id="menuBtn" aria-label="Menu">☰</button>
      </div>
    </header>
    <main class="view">${body}</main>
    <nav class="bottom-nav">
      <button class="nav-btn ${state.route==='files'?'active':''}" data-route="files"><span class="nav-ico">📁</span><span>Your Files</span></button>
      <button class="nav-btn ${state.route==='home'?'active':''}" data-route="home"><span class="nav-ico">⌂</span><span>Home</span></button>
      <button class="nav-btn ${state.route==='profile'?'active':''}" data-route="profile"><span class="nav-ico">👤</span><span>Profile</span></button>
    </nav>
    <div class="drawer ${state.menu?'open':''}" id="drawer"><aside class="drawer-panel"><div class="drawer-head"><h3 style="margin:0">Menu</h3><button class="icon-btn" id="closeDrawer">✕</button></div><div class="profile-head" style="margin-top:14px"><div class="avatar">${state.profile?.avatar_url?`<img src="${state.profile.avatar_url}" style="width:100%;height:100%;object-fit:cover"/>`:avatarInitial()}</div><div><b>${safeName(state.profile?.full_name||'Guest')}</b><div class="tiny">${safeName(state.user?.email||'Guest ID')}</div></div></div><div class="menu-list">${menuItems()}</div></aside></div>
    ${modalHtml()}
    ${state.toast?`<div style="position:fixed;z-index:100;left:50%;bottom:94px;transform:translateX(-50%);background:${state.toast.type==='error'?'#3b161c':'#1b2416'};border:1px solid ${state.toast.type==='error'?'#73303a':'#3c5b2a'};padding:11px 14px;border-radius:14px;box-shadow:var(--shadow);max-width:90vw;font-size:13px">${safeName(state.toast.message)}</div>`:''}
  </div>`;
}

function menuItems(){
  const common = [
    ['📂','My Files','files'],['🕘','Activity / History','history'],['🔗','Shared Files / Links','shared'],['🗑️','Trash / Restore','trash'],['⚙️','Settings','settings'],['🛡️','Security / Account','security']
  ];
  let html=common.map(([i,t,r])=>`<button class="menu-item" data-route="${r}"><span>${i}</span><span>${t}</span><span style="margin-left:auto;color:#647083">›</span></button>`).join('');
  if(state.isAdmin) html += `<button class="menu-item" data-route="admin"><span>🛠️</span><span>Admin</span><span style="margin-left:auto;color:#647083">›</span></button>`;
  html += `<button class="menu-item" data-route="help"><span>❔</span><span>Help / About</span><span style="margin-left:auto;color:#647083">›</span></button>`;
  html += isAuth()?`<button class="menu-item" id="signOutMenu"><span>↪</span><span>Sign out</span><span style="margin-left:auto;color:#647083">›</span></button>`:`<button class="menu-item" id="convertMenu"><span>🔐</span><span>Convert account / Login</span><span style="margin-left:auto;color:#647083">›</span></button>`;
  return html;
}

function modalHtml(){
  if(!state.modal) return '';
  const m=state.modal;
  if(m.type==='upload') return uploadModal();
  if(m.type==='file') return fileModal(m.file);
  if(m.type==='share') return shareModal(m.file);
  if(m.type==='auth') return authModal(m.mode||'login');
  if(m.type==='profileEdit') return profileEditModal();
  if(m.type==='notifications') return notificationModal();
  if(m.type==='qr') return qrModal(m.file,m.url);
  if(m.type==='folder') return folderModal();
  return '';
}

function homeView(){
  const results = state.query ? state.results : state.files;
  const active = Boolean(state.query);
  return `<section class="hero">
    <div class="search-row"><label class="searchbox"><span>⌕</span><input id="searchInput" value="${safeName(state.query)}" placeholder="Search file name / 4-digit code" autocomplete="off"/></label><button class="search-btn" id="scanBtn">▣</button></div>
    ${active?`<div class="upload-hero compact"><div><b>Search results</b><div class="tiny">Upload stays available while you search.</div></div>${isAuth()?`<button class="gold-btn small-btn" id="uploadBtn">＋ Upload</button>`:`<button class="ghost-btn small-btn" id="convertBtn">Convert account</button>`}</div>`:`<div class="upload-hero"><div><div class="upload-icon">⬆</div><b>${isAuth()?'Upload a file':'Guest upload is locked'}</b><div class="tiny" style="margin:6px 0 13px">${isAuth()?'PDF, image, video, audio, ZIP and common documents.':'Convert your Guest session to a real account to upload files.'}</div>${isAuth()?`<button class="gold-btn" id="uploadBtn">＋ Upload File</button>`:`<button class="gold-btn" id="convertBtn">🔐 Convert Your Account</button>`}</div></div>`}
  </section>
  <div class="section-title"><h2>${active?'Results':'Your PDF / Files'}</h2><span class="tiny">${results.length} item${results.length===1?'':'s'}</span></div>
  ${renderFileList(results, active?'No matching files':'No files found')}
  ${active?`<div class="btn-row"><button class="ghost-btn small-btn" id="clearSearch">Clear search</button></div>`:''}
  <input type="file" id="hiddenFileInput" multiple hidden />`;
}

function renderFileList(list,emptyText){
  if(!list?.length) return `<div class="empty"><div class="emoji">📁</div><h3>${emptyText}</h3><p>${state.guest?'Guest mode has no private files. Public/shared files remain searchable by access rules.':'Upload your first file and it will appear here instantly.'}</p></div>`;
  return `<div class="file-list">${list.map(fileCard).join('')}</div>`;
}
function fileCard(f){
  return `<article class="file-card"><div class="file-icon">${iconFor(f)}</div><div style="min-width:0"><div class="file-name">${safeName(f.display_name||f.original_name)}</div><div class="file-meta">${safeName(f.extension||ext(f.original_name))} • ${fmtSize(f.size_bytes)} • ${f.visibility||'private'}</div><div class="tiny" style="margin-top:4px">Code: <b style="color:var(--gold)">${f.file_code||'—'}</b></div></div><div class="card-actions"><button class="mini-icon" title="Preview" data-open-file="${f.id}">⌕</button><button class="mini-icon" title="Share" data-share-file="${f.id}">↗</button><button class="mini-icon" title="More" data-more-file="${f.id}">⋮</button></div></article>`;
}

function filesView(){ return `<div class="section-title"><h2>Your Files</h2><button class="ghost-btn small-btn" id="newFolderBtn">＋ Folder</button></div>${renderFileList(state.files,'No files found')}`; }

function profileView(){
  const p=state.profile;
  return `<div class="profile-head"><div class="avatar">${p?.avatar_url?`<img src="${p.avatar_url}" style="width:100%;height:100%;object-fit:cover"/>`:avatarInitial()}</div><div style="flex:1"><div style="font-size:18px;font-weight:850">${safeName(p?.full_name||'Guest')}</div><div class="tiny">${safeName(state.user?.email||'Guest mode')}</div><div class="tiny" style="margin-top:5px">Storage ${fmtSize(state.profile?.storage_used_bytes||0)} / ${fmtSize(state.profile?.storage_quota_bytes||0)}</div></div><button class="ghost-btn small-btn" id="editProfileBtn">Edit</button></div>
  <div class="section-title"><h2>Account</h2></div>
  <div class="settings-list">
    <button class="settings-row" data-route="history"><span>🕘 Activity / History</span><span>›</span></button>
    <button class="settings-row" data-route="shared"><span>🔗 Shared files / links</span><span>›</span></button>
    <button class="settings-row" data-route="trash"><span>🗑️ Trash / Restore</span><span>›</span></button>
    <button class="settings-row" data-route="settings"><span>⚙️ Settings</span><span>›</span></button>
    <button class="settings-row" data-route="security"><span>🛡️ Security / Account</span><span>›</span></button>
    ${isAuth()?`<button class="settings-row" id="signOutProfile"><span>↪ Sign out</span><span>›</span></button>`:`<button class="settings-row" id="convertProfile"><span>🔐 Convert account</span><span>›</span></button>`}
  </div>`;
}

async function render(){
  if(!clientReady && !state.guest){ app.innerHTML = authMissingView(); bind(); return; }
  if(!state.session && !state.guest){ app.innerHTML = authView(); bind(); return; }
  let body=homeView();
  if(state.route==='files') body=filesView();
  if(state.route==='profile') body=profileView();
  if(['history','shared','trash','settings','security','help','admin'].includes(state.route)) body=secondaryView(state.route);
  app.innerHTML=shell(body); bind();
}

function authMissingView(){return `<div class="auth-wrap"><div class="auth-card"><div class="brand"><div class="brand-mark">FH</div><div><div class="brand-name">FileHub setup</div><div class="brand-sub">Supabase publishable key is missing</div></div></div><div class="notice warn" style="margin-top:16px">Set <b>VITE_SUPABASE_ANON_KEY</b> in Vercel environment variables, then redeploy. The project URL is already configured.</div><div class="form-grid"><button class="gold-btn" id="guestBtn">Continue as Guest</button><div class="tiny">Guest mode is fully usable for UI/search of public content but cannot upload private files.</div></div></div></div>`}
function authView(){return `<div class="auth-wrap"><div class="auth-card"><div class="brand"><div class="brand-mark">FH</div><div><div class="brand-name">FileHub</div><div class="brand-sub">Secure cloud files</div></div></div><div class="auth-tabs" style="margin-top:18px"><button class="active" id="tabLogin">Login</button><button id="tabSignup">Sign up</button><button id="guestBtn">Guest</button></div><div id="authBody" style="margin-top:15px">${authFields('login')}</div></div></div>`}
function authFields(mode){return `<div class="form-grid"><div class="field"><label>Email</label><input id="authEmail" type="email" placeholder="you@example.com" autocomplete="email"/></div><div class="field"><label>Password</label><input id="authPassword" type="password" placeholder="••••••••" autocomplete="current-password"/></div>${mode==='signup'?`<div class="field"><label>Display name</label><input id="authName" placeholder="Your name" autocomplete="name"/></div>`:''}<button class="gold-btn" id="authSubmit">${mode==='signup'?'Create account':'Login'}</button><div class="tiny">By using FileHub, your private files stay behind Supabase Auth + RLS.</div></div>`}

function secondaryView(routeName){
  const titles={history:'Activity / History',shared:'Shared Files / Links',trash:'Trash / Restore',settings:'Settings',security:'Security / Account',help:'Help / About',admin:'Admin'};
  let content='';
  if(routeName==='history') content=`<div id="historyList" class="file-list"><div class="empty">Loading activity…</div></div>`;
  if(routeName==='shared') content=`<div id="sharedList" class="file-list"><div class="empty">Loading shared links…</div></div>`;
  if(routeName==='trash') content=`<div id="trashList" class="file-list"><div class="empty">Loading trash…</div></div>`;
  if(routeName==='settings') content=`<div class="settings-list"><div class="settings-row"><span>🔔 Notifications</span><button class="switch on" id="notifSwitch"><i></i></button></div><div class="settings-row"><span>🌓 Compact UI</span><button class="switch" id="compactSwitch"><i></i></button></div><div class="settings-row"><span>🧹 Clear notifications</span><button class="ghost-btn small-btn" id="clearNotifications">Clear</button></div></div>`;
  if(routeName==='security') content=`<div class="notice">Supabase Auth controls the session. Private objects are protected by Storage policies and PostgreSQL RLS. A 4-digit file code is only a search identifier, never a password.</div><div class="settings-list" style="margin-top:12px"><div class="settings-row"><span>Account email</span><b>${safeName(state.user?.email||'Guest')}</b></div><div class="settings-row"><span>Auth ID</span><b class="tiny">${safeName(state.user?.id||'—')}</b></div></div>`;
  if(routeName==='help') content=`<div class="notice"><b>FileHub</b><br/>Search by filename or 4-digit code, upload after login, preview supported files, share through secure random links, use QR, and manage your files from Profile / Menu.<br/><br/>Vercel hosts the frontend; Supabase provides Auth, Postgres, Storage and Edge Functions.</div>`;
  if(routeName==='admin') content=`<div id="adminPanel" class="notice">Checking server authorization…</div>`;
  return `<div class="section-title"><h2>${titles[routeName]}</h2>${routeName!=='help'?`<button class="ghost-btn small-btn" id="backHome">Home</button>`:''}</div>${content}`;
}

function uploadModal(){return `<div class="modal open"><div class="modal-card"><div class="modal-head"><h3 style="margin:0">Upload File</h3><button class="icon-btn" data-close-modal>✕</button></div><div class="form-grid"><div class="field"><label>Select files</label><input id="filePicker" type="file" multiple /></div><div id="selectedFiles" class="tiny">No files selected</div><div class="field"><label>Display name (for one-file uploads)</label><input id="displayName" placeholder="Use original filename"/></div><div class="field"><label>Folder</label><select id="folderSelect"><option value="">Root</option></select></div><div class="field"><label>Visibility</label><select id="visibilitySelect"><option value="private">Private</option><option value="public">Public / searchable</option></select></div><div class="progress"><i id="uploadProgress"></i></div><div id="uploadStatus" class="notice">Choose files, then upload. Storage path uses your user ID + random identifier.</div><div class="btn-row"><button class="gold-btn" id="startUpload">Start upload</button><button class="ghost-btn" data-close-modal>Cancel</button></div></div></div></div>`}

function fileModal(file){return `<div class="modal open"><div class="modal-card"><div class="modal-head"><div><h3 style="margin:0">${safeName(file.display_name||file.original_name)}</h3><div class="tiny">${safeName(file.mime_type||'file')} • ${fmtSize(file.size_bytes)} • code ${safeName(file.file_code||'—')}</div></div><button class="icon-btn" data-close-modal>✕</button></div><div id="previewArea" class="preview-frame" style="margin-top:14px"><div class="tiny">Loading preview…</div></div><div class="btn-row"><button class="gold-btn small-btn" id="downloadFile">⬇ Download</button><button class="ghost-btn small-btn" id="shareFile">↗ Share</button><button class="ghost-btn small-btn" id="qrFile">▣ QR</button><button class="ghost-btn small-btn" id="renameFile">✎ Rename</button><button class="ghost-btn small-btn" id="favoriteFile">★ ${file.is_favorite?'Unfavorite':'Favorite'}</button>${isAuth()&&file.owner_id===state.user.id?`<button class="danger-btn small-btn" id="trashFile">🗑 Move to trash</button>`:''}</div><div class="notice" style="margin-top:12px">Owner: ${safeName(file.owner_id===state.user?.id?'You':'Shared/Public')}<br/>Created: ${fmtDate(file.created_at)}<br/>Visibility: ${safeName(file.visibility)}</div></div></div>`}

function shareModal(file){return `<div class="modal open"><div class="modal-card"><div class="modal-head"><h3 style="margin:0">Share ${safeName(file.display_name||file.original_name)}</h3><button class="icon-btn" data-close-modal>✕</button></div><div class="form-grid"><div class="field"><label>Mode</label><select id="shareMode"><option value="view">View</option><option value="download">Download</option></select></div><div class="field"><label>Expiry (optional)</label><input id="shareExpiry" type="datetime-local"/></div><div class="notice">A random non-guessable token is generated server-side. The service-role secret never reaches the browser.</div><button class="gold-btn" id="createShare">Create secure link</button><div id="shareResult"></div></div></div></div>`}

function authModal(mode){return `<div class="modal open"><div class="modal-card"><div class="modal-head"><h3 style="margin:0">${mode==='login'?'Login':'Convert guest account'}</h3><button class="icon-btn" data-close-modal>✕</button></div>${authFields('login')}</div></div>`}
function profileEditModal(){return `<div class="modal open"><div class="modal-card"><div class="modal-head"><h3 style="margin:0">Edit profile</h3><button class="icon-btn" data-close-modal>✕</button></div><div class="form-grid"><div class="field"><label>Name</label><input id="profileName" value="${safeName(state.profile?.full_name||'')}"/></div><div class="field"><label>Profile photo</label><input id="avatarPicker" type="file" accept="image/*"/></div><button class="gold-btn" id="saveProfile">Save changes</button></div></div></div>`}
function notificationModal(){return `<div class="modal open"><div class="modal-card"><div class="modal-head"><div><h3 style="margin:0">Notifications</h3><div class="tiny">Database-backed activity</div></div><div class="btn-row" style="margin:0"><button class="ghost-btn small-btn" id="clearNotifications">Clear</button><button class="icon-btn" data-close-modal>✕</button></div></div><div style="margin-top:14px" class="file-list">${state.notifications.length?state.notifications.map(n=>`<button class="settings-row" style="text-align:left" data-notify-file="${n.entity_id||''}"><span><b>${safeName(n.action.replaceAll('_',' '))}</b><div class="tiny">${safeName(JSON.stringify(n.metadata||{}))}</div></span><span class="tiny">${fmtDate(n.created_at)}</span></button>`).join(''):`<div class="empty"><div class="emoji">🔔</div><h3>No notifications</h3><p>Your download/upload/share activity will appear here.</p></div>`}</div></div></div>`}
function qrModal(file,url){return `<div class="modal open"><div class="modal-card"><div class="modal-head"><h3 style="margin:0">File QR</h3><button class="icon-btn" data-close-modal>✕</button></div><div style="text-align:center;padding:14px"><div id="qrCanvas" class="share-qr"></div><div class="tiny" style="margin-top:10px;word-break:break-all">${safeName(url)}</div><div class="btn-row" style="justify-content:center"><button class="gold-btn small-btn" id="downloadQr">Download QR</button><button class="ghost-btn small-btn" id="nativeShareQr">Share</button></div></div></div></div>`}
function folderModal(){return `<div class="modal open"><div class="modal-card"><div class="modal-head"><h3 style="margin:0">New Folder</h3><button class="icon-btn" data-close-modal>✕</button></div><div class="form-grid"><div class="field"><label>Folder name</label><input id="folderName" placeholder="e.g. Documents"/></div><button class="gold-btn" id="createFolder">Create folder</button></div></div></div>`}

async function loadHome(){ if(!state.user) return; if(state.query) return runSearch(state.query); state.files=await fetchFiles(false); state.results=state.files; await loadNotifications(); render(); }
async function loadFiles(){ state.files=await fetchFiles(false); render(); }
async function fetchFiles(trashed=false){
  if(!supabase || !state.user) return [];
  let q=supabase.from('files').select('*').eq('owner_id',state.user.id).eq('is_trashed',trashed).order('updated_at',{ascending:false}).limit(100);
  const {data,error}=await q; if(error){console.error(error); return [];} return data||[];
}
async function runSearch(q){
  state.query=q.trim();
  if(!state.query){state.results=state.files;render();return;}
  if(!supabase){state.results=[];render();return;}
  let data=[];
  if(isAuth()){
    const {data:d,error}=await supabase.rpc('filehub_search_files',{p_query:state.query,p_limit:50});
    if(!error) data=d||[];
  }else{
    const r=await supabase.rpc('filehub_search_public_files',{p_query:state.query,p_limit:50}); if(!r.error) data=r.data||[];
  }
  state.results=data; render();
}

async function loadProfileExtras(){
  if(!isAuth()) return;
  await loadProfile(); await loadNotifications();
}
async function loadProfile(){
  if(!supabase || !state.user) return;
  const {data}=await supabase.from('profiles').select('*').eq('id',state.user.id).maybeSingle(); state.profile=data||{full_name:state.user.email||'User'};
  const {count}=await supabase.from('files').select('id',{count:'exact',head:true}).eq('owner_id',state.user.id).eq('is_trashed',false); state.profile.storage_used_bytes = 0;
  const {data:sumRows}=await supabase.from('files').select('size_bytes').eq('owner_id',state.user.id).eq('is_trashed',false).limit(1000); state.profile.storage_used_bytes=(sumRows||[]).reduce((a,r)=>a+(Number(r.size_bytes)||0),0);
}
async function loadNotifications(){
  if(!supabase||!state.user) return;
  const since=state.profile?.notification_cleared_at||'1970-01-01T00:00:00Z';
  const {data}=await supabase.from('activity_logs').select('*').eq('actor_id',state.user.id).gt('created_at',since).order('created_at',{ascending:false}).limit(30);
  state.notifications=data||[]; state.notificationCount=state.notifications.length;
}

async function handleUpload(files){
  if(!isAuth()){setModal({type:'auth',mode:'login'});return;}
  if(!files.length){toast('Choose at least one file','error');return;}
  const displayName=$('#displayName')?.value?.trim(); const folderId=$('#folderSelect')?.value||null; const visibility=$('#visibilitySelect')?.value||'private'; const p=$('#uploadProgress'); const st=$('#uploadStatus');
  const per=100/files.length; let done=0;
  for(const file of files){
    try{
      st.textContent=`Uploading ${file.name}…`; p.style.width=`${Math.max(5,done*per+5)}%`;
      const id=crypto.randomUUID(); const extension=ext(file.name); const path=`${state.user.id}/${id}${extension?'.'+extension:''}`;
      const up=await supabase.storage.from(STORAGE_BUCKET).upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
      if(up.error) throw up.error;
      p.style.width=`${Math.min(90,done*per+55)}%`;
      const {data:row,error:metaError}=await supabase.from('files').insert({owner_id:state.user.id,folder_id:folderId,original_name:file.name,display_name:(displayName&&files.length===1?displayName:file.name),storage_path:path,mime_type:file.type||'application/octet-stream',extension,size_bytes:file.size,visibility,is_trashed:false,is_favorite:false}).select('*').single();
      if(metaError){await supabase.storage.from(STORAGE_BUCKET).remove([path]);throw metaError;}
      await supabase.from('activity_logs').insert({actor_id:state.user.id,action:'file_uploaded',entity_type:'file',entity_id:row.id,metadata:{name:row.display_name,size:file.size}});
      done++;
    }catch(e){console.error(e); st.classList.add('error'); st.textContent=`Upload failed: ${e.message||e}`; toast('One or more uploads failed','error');}
  }
  p.style.width='100%'; st.textContent=`Upload finished: ${done}/${files.length}`; await loadHome(); setTimeout(()=>setModal(null),700);
}

async function openFile(file){
  state.selectedFile=file; setModal({type:'file',file});
  const area=()=>$('#previewArea');
  try{
    let signed;
    if(file.visibility==='public' && !isAuth()){
      const r=await publicApi('filehub-public-file',{method:'POST',body:JSON.stringify({file_id:file.id})}); const j=await r.json(); if(!r.ok) throw new Error(j.error||'Unable to open public file'); signed=j.signed_url;
    }else{
      const r=await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(file.storage_path,300); if(r.error) throw r.error; signed=r.data.signedUrl;
    }
    if(file.mime_type?.startsWith('image/')) area().innerHTML=`<img src="${signed}" alt="preview"/>`;
    else if(file.mime_type==='application/pdf') area().innerHTML=`<iframe src="${signed}#toolbar=1"></iframe>`;
    else if(file.mime_type?.startsWith('video/')) area().innerHTML=`<video controls playsinline src="${signed}"></video>`;
    else if(file.mime_type?.startsWith('audio/')) area().innerHTML=`<audio class="audio" controls src="${signed}"></audio>`;
    else area().innerHTML=`<div><div style="font-size:46px;text-align:center">${iconFor(file)}</div><div class="tiny" style="margin-top:10px">Preview not available for this type. Download preserves the original file.</div></div>`;
    $('#downloadFile')?.addEventListener('click',()=>downloadFile(file,signed));
    $('#shareFile')?.addEventListener('click',()=>setModal({type:'share',file}));
    $('#qrFile')?.addEventListener('click',async()=>{ const url=await ensureShareUrl(file); if(url)setModal({type:'qr',file,url}); });
    $('#renameFile')?.addEventListener('click',()=>renameFile(file));
    $('#favoriteFile')?.addEventListener('click',()=>toggleFavorite(file));
    $('#trashFile')?.addEventListener('click',()=>trashFile(file));
  }catch(e){ area().innerHTML=`<div class="notice error">${safeName(e.message||e)}</div>`; }
}
async function ensureShareUrl(file){
  if(!isAuth()){toast('Login required to create a secure share link','error');return null;}
  try{const r=await createShare(file,'view',null,true);return r? r.share_url : null;}catch(e){toast(e.message,'error');return null;}
}
async function downloadFile(file,signed=null){
  try{
    // Always request a download-disposition URL here so videos/documents are downloaded as the real file.
    const r=await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(file.storage_path,300,{download:file.display_name||file.original_name});
    if(r.error) throw r.error;
    const downloadUrl=r.data.signedUrl;
    const a=document.createElement('a');a.href=downloadUrl;a.download=file.display_name||file.original_name;a.target='_blank';document.body.appendChild(a);a.click();a.remove();
    const logged=await supabase.rpc('filehub_record_download',{p_file_id:file.id});
    if(logged.error) throw logged.error;
    toast('Download started');
  }catch(e){toast(e.message||'Download failed','error');}
}
async function createShare(file,mode='view',expiresAt=null,silent=false){
  if(!isAuth()) throw new Error('Login required');
  const token=state.session.access_token;
  const res=await fetch(`${EDGE_BASE}/filehub-create-share-link`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',apikey:SUPABASE_ANON_KEY},body:JSON.stringify({file_id:file.id,mode,expires_at:expiresAt})});
  const j=await res.json(); if(!res.ok) throw new Error(j.error||'Unable to create share link');
  const share=j.share; share.share_url=`${location.origin}${location.pathname}?share=${encodeURIComponent(share.token)}`;
  if(!silent) { $('#shareResult').innerHTML=`<div class="notice">Share URL created<br/><a href="${share.share_url}" target="_blank" style="color:var(--gold);word-break:break-all">${safeName(share.share_url)}</a><div class="btn-row"><button class="gold-btn small-btn" id="copyShare">Copy link</button><button class="ghost-btn small-btn" id="shareNative">Share</button></div></div>`; $('#copyShare')?.addEventListener('click',()=>navigator.clipboard?.writeText(share.share_url).then(()=>toast('Link copied'))); $('#shareNative')?.addEventListener('click',()=>navigator.share?.({title:file.display_name||file.original_name,url:share.share_url})); }
  return {share,share_url:share.share_url};
}
async function renameFile(file){
  if(!isAuth()||file.owner_id!==state.user.id) return; const name=prompt('New display name',file.display_name||file.original_name); if(!name?.trim())return;
  const {error}=await supabase.from('files').update({display_name:name.trim()}).eq('id',file.id).eq('owner_id',state.user.id); if(error)toast(error.message,'error'); else {toast('Renamed');setModal(null);await loadHome();}
}
async function toggleFavorite(file){ const v=!file.is_favorite; const {error}=await supabase.from('files').update({is_favorite:v}).eq('id',file.id).eq('owner_id',state.user.id);if(error)toast(error.message,'error');else{toast(v?'Added to favorites':'Removed from favorites');file.is_favorite=v;render();} }
async function trashFile(file){ if(!isAuth())return; if(!confirm('Move this file to Trash?'))return; const {error}=await supabase.from('files').update({is_trashed:true,deleted_at:new Date().toISOString()}).eq('id',file.id).eq('owner_id',state.user.id);if(error)toast(error.message,'error');else{await supabase.from('activity_logs').insert({actor_id:state.user.id,action:'file_trashed',entity_type:'file',entity_id:file.id,metadata:{name:file.display_name}});toast('Moved to trash');setModal(null);await loadHome();} }

async function profileSave(){
  if(!isAuth())return; const name=$('#profileName')?.value?.trim()||'User'; const file=$('#avatarPicker')?.files?.[0]; let avatar=state.profile?.avatar_url||null;
  try{ if(file){const path=`${state.user.id}/${crypto.randomUUID()}.${ext(file.name)||'jpg'}`;const up=await supabase.storage.from(AVATAR_BUCKET).upload(path,file,{contentType:file.type,upsert:true}); if(up.error)throw up.error; const pu=supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);avatar=pu.data.publicUrl;}
    const {error}=await supabase.from('profiles').update({full_name:name,avatar_url:avatar}).eq('id',state.user.id);if(error)throw error;await loadProfile();toast('Profile updated');setModal(null);render(); }catch(e){toast(e.message||'Unable to update profile','error');}
}

async function loadSecondary(){
  if(!isAuth()) return;
  if(state.route==='history'){const {data}=await supabase.from('activity_logs').select('*').eq('actor_id',state.user.id).order('created_at',{ascending:false}).limit(100);$('#historyList').innerHTML=(data||[]).length?(data||[]).map(a=>`<div class="settings-row"><span><b>${safeName(a.action.replaceAll('_',' '))}</b><div class="tiny">${safeName(JSON.stringify(a.metadata||{}))}</div></span><span class="tiny">${fmtDate(a.created_at)}</span></div>`).join(''):`<div class="empty"><div class="emoji">🕘</div><h3>No activity</h3></div>`;}
  if(state.route==='shared'){const {data}=await supabase.from('share_links').select('*,files(display_name,original_name)').eq('owner_id',state.user.id).order('created_at',{ascending:false}).limit(100);$('#sharedList').innerHTML=(data||[]).length?(data||[]).map(s=>{const u=`${location.origin}${location.pathname}?share=${encodeURIComponent(s.token)}`;return `<div class="settings-row" style="align-items:flex-start"><span><b>${safeName(s.files?.display_name||s.files?.original_name||'File')}</b><div class="tiny" style="word-break:break-all">${safeName(u)}</div><div class="tiny">${safeName(s.mode)} • ${s.expires_at?`expires ${fmtDate(s.expires_at)}`:'no expiry'}</div></span><button class="danger-btn small-btn" data-disable-share="${s.id}">Revoke</button></div>`}).join(''):`<div class="empty"><div class="emoji">🔗</div><h3>No shared links</h3></div>`;}
  if(state.route==='trash'){const data=await fetchFiles(true);$('#trashList').innerHTML=data.length?data.map(f=>`<div class="settings-row"><span><b>${safeName(f.display_name||f.original_name)}</b><div class="tiny">Deleted ${f.deleted_at?fmtDate(f.deleted_at):''}</div></span><div class="btn-row" style="margin:0"><button class="gold-btn small-btn" data-restore-file="${f.id}">Restore</button><button class="danger-btn small-btn" data-delete-file="${f.id}">Delete</button></div></div>`).join(''):`<div class="empty"><div class="emoji">🗑️</div><h3>Trash is empty</h3></div>`;}
  if(state.route==='admin'){await renderAdmin();}
  bindSecondary();
}
async function adminRpc(action,payload={}){
  const {data,error}=await supabase.rpc('filehub_admin_action',{p_action:action,p_payload:payload});
  if(error) throw new Error(error.message||'Admin action failed');
  return data;
}
async function adminData(section){
  const {data,error}=await supabase.rpc('filehub_admin_dashboard_data',{p_section:section});
  if(error) throw new Error(error.message||'Admin data unavailable');
  return data||[];
}
const adminPerms=['manage_users','manage_files','view_private_files','delete_files','rename_files','upload_files','manage_storage','manage_shares','view_activity_logs','manage_admins'];
function adminTabs(){return `<div class="admin-tabs"><button class="ghost-btn small-btn" data-admin-section="dashboard">Overview</button><button class="ghost-btn small-btn" data-admin-section="users">Users</button><button class="ghost-btn small-btn" data-admin-section="files">Files</button><button class="ghost-btn small-btn" data-admin-section="shares">Shares</button><button class="ghost-btn small-btn" data-admin-section="activity">Audit</button><button class="gold-btn small-btn" id="addAdminBtn">＋ Admin</button></div><div id="adminSection" class="admin-section"></div>`;}
async function renderAdmin(){
  const host=$('#adminPanel'); if(!host)return;
  host.innerHTML=`<div class="admin-head"><div><b>FileHub Admin Control Center</b><div class="tiny">Server-authorized management • all actions audited</div></div><span class="admin-pill">ADMIN</span></div>${adminTabs()}`;
  bindAdminTabs(); await loadAdminSection('dashboard');
}
function bindAdminTabs(){
  document.querySelectorAll('[data-admin-section]').forEach(b=>b.addEventListener('click',()=>loadAdminSection(b.dataset.adminSection)));
  $('#addAdminBtn')?.addEventListener('click',addAdmin);
}
async function loadAdminSection(section){
  const host=$('#adminSection'); if(!host)return; host.innerHTML='<div class="empty"><div class="emoji">⏳</div><h3>Loading…</h3></div>';
  try{
    const d=await adminData(section);
    if(section==='dashboard'){
      const stat=(label,value,icon)=>`<div class="admin-stat"><span>${icon}</span><div><b>${Number(value||0).toLocaleString()}</b><div class="tiny">${label}</div></div></div>`;
      const acts=(d.recent_activity||[]).map(a=>`<div class="settings-row"><span><b>${safeName(String(a.action||'activity').replaceAll('_',' '))}</b><div class="tiny">${safeName(a.entity_type||'')} ${safeName(a.metadata?.name||'')}</div></span><span class="tiny">${fmtDate(a.created_at)}</span></div>`).join('');
      host.innerHTML=`<div class="admin-stats">${stat('Users',d.users,'👥')}${stat('Files',d.files,'📁')}${stat('Storage',fmtSize(d.storage_bytes),'💾')}${stat('Downloads',d.downloads,'⬇️')}${stat('Shares',d.shares,'🔗')}${stat('Active admins',d.admin_count,'🛡️')}</div><div class="section-title"><h3>Recent activity</h3></div><div class="file-list">${acts||'<div class="empty"><h3>No activity yet</h3></div>'}</div><div class="notice" style="margin-top:12px">Admin operations use authenticated Supabase sessions and permission-gated server RPCs. The publishable key is the only browser key.</div>`;
    }
    if(section==='users'){
      host.innerHTML=`<div class="section-title"><h3>User Management</h3><span class="tiny">${d.length} loaded</span></div><div class="file-list">${d.length?d.map(u=>`<div class="settings-row admin-row"><span><b>${safeName(u.full_name||'User')}</b><div class="tiny">${safeName(u.email||'')} • ${u.is_blocked?'BLOCKED':'Active'} • quota ${fmtSize(u.storage_quota_bytes)}</div></span><div class="btn-row" style="margin:0"><button class="ghost-btn small-btn" data-admin-user="${u.id}">Edit</button><button class="${u.is_blocked?'gold-btn':'danger-btn'} small-btn" data-admin-block="${u.id}" data-blocked="${u.is_blocked}">${u.is_blocked?'Unblock':'Block'}</button></div></div>`).join(''):'<div class="empty"><h3>No users</h3></div>'}</div>`;
      document.querySelectorAll('[data-admin-user]').forEach(b=>b.addEventListener('click',()=>editAdminUser(d.find(x=>x.id===b.dataset.adminUser))));
      document.querySelectorAll('[data-admin-block]').forEach(b=>b.addEventListener('click',()=>adminUserUpdate(b.dataset.adminBlock,{is_blocked:b.dataset.blocked!=='true'})));
    }
    if(section==='files'){
      host.innerHTML=`<div class="section-title"><h3>File Management</h3><span class="tiny">${d.length} loaded</span></div><div class="file-list">${d.length?d.map(f=>`<div class="settings-row admin-row"><span><b>${safeName(f.display_name||f.original_name)}</b><div class="tiny">${safeName(f.owner_name||f.owner_email||'Unknown')} • ${fmtSize(f.size_bytes)} • ${f.visibility} • ${f.is_trashed?'TRASHED':'Active'}</div></span><div class="btn-row" style="margin:0"><button class="ghost-btn small-btn" data-admin-file="${f.id}">Edit</button>${f.is_trashed?`<button class="gold-btn small-btn" data-admin-restore="${f.id}">Restore</button>`:`<button class="danger-btn small-btn" data-admin-trash="${f.id}">Delete</button>`}</div></div>`).join(''):'<div class="empty"><h3>No files</h3></div>'}</div>`;
      document.querySelectorAll('[data-admin-file]').forEach(b=>b.addEventListener('click',()=>editAdminFile(d.find(x=>x.id===b.dataset.adminFile))));
      document.querySelectorAll('[data-admin-restore]').forEach(b=>b.addEventListener('click',()=>adminFileUpdate(b.dataset.adminRestore,{is_trashed:false})));
      document.querySelectorAll('[data-admin-trash]').forEach(b=>b.addEventListener('click',()=>adminFileUpdate(b.dataset.adminTrash,{is_trashed:true})));
    }
    if(section==='shares'){
      host.innerHTML=`<div class="section-title"><h3>Share Management</h3><span class="tiny">${d.length} loaded</span></div><div class="file-list">${d.length?d.map(x=>`<div class="settings-row admin-row"><span><b>${safeName(x.display_name||x.original_name||'File')}</b><div class="tiny">${safeName(x.owner_name||x.owner_email||'')} • ${x.mode} • ${x.disabled?'REVOKED':'Active'}${x.expires_at?' • '+fmtDate(x.expires_at):''}</div></span>${x.disabled?'':'<button class="danger-btn small-btn" data-admin-revoke="'+x.id+'">Revoke</button>'}</div>`).join(''):'<div class="empty"><h3>No share links</h3></div>'}</div>`;
      document.querySelectorAll('[data-admin-revoke]').forEach(b=>b.addEventListener('click',()=>adminShareUpdate(b.dataset.adminRevoke)));
    }
    if(section==='activity'){
      host.innerHTML=`<div class="section-title"><h3>Admin Audit Log</h3><span class="tiny">${d.length} entries</span></div><div class="file-list">${d.length?d.map(a=>`<div class="settings-row"><span><b>${safeName(a.action)}</b><div class="tiny">${safeName(a.target_type||'')} ${safeName(a.target_id||'')}<br/>${safeName(JSON.stringify(a.metadata||{}))}</div></span><span class="tiny">${fmtDate(a.created_at)}</span></div>`).join(''):'<div class="empty"><h3>No admin actions yet</h3></div>'}</div>`;
    }
  }catch(e){host.innerHTML=`<div class="notice error">${safeName(e.message||e)}</div>`;}
}
async function adminUserUpdate(id,patch){try{await adminRpc('update_user',{user_id:id,...patch});toast('User updated');await loadAdminSection('users');}catch(e){toast(e.message,'error');}}
async function editAdminUser(u){if(!u)return;const name=prompt('User name',u.full_name||'');if(name===null)return;const quota=prompt('Storage quota in MB',String(Math.round(Number(u.storage_quota_bytes||0)/1048576)));if(quota===null)return;await adminUserUpdate(u.id,{full_name:name.trim(),storage_quota_bytes:Math.max(0,Number(quota)*1048576)});}
async function adminFileUpdate(id,patch){try{await adminRpc('update_file',{file_id:id,...patch});toast('File updated');await loadAdminSection('files');}catch(e){toast(e.message,'error');}}
async function editAdminFile(f){if(!f)return;const name=prompt('Display name',f.display_name||f.original_name);if(name===null)return;const vis=prompt('Visibility: private or public',f.visibility||'private');if(vis===null)return;await adminFileUpdate(f.id,{display_name:name.trim(),visibility:['private','public'].includes(vis.trim())?vis.trim():f.visibility});}
async function adminShareUpdate(id){if(!confirm('Revoke this share link?'))return;try{await adminRpc('revoke_share',{share_id:id});toast('Share revoked');await loadAdminSection('shares');}catch(e){toast(e.message,'error');}}
async function addAdmin(){const email=prompt('Email of an existing FileHub user');if(!email)return;const name=prompt('Admin display name',email);try{await adminRpc('add_admin',{email:email.trim().toLowerCase(),display_name:name||email});toast('Admin added with permissions disabled by default');await loadAdminSection('dashboard');}catch(e){toast(e.message,'error');}}
const isAdminCheckPossible=()=>isAuth();
function bindSecondary(){
  $('#backHome')?.addEventListener('click',()=>route('home')); $('#clearNotifications')?.addEventListener('click',clearNotifications);
  document.querySelectorAll('[data-disable-share]').forEach(b=>b.addEventListener('click',()=>disableShare(b.dataset.disableShare)));
  document.querySelectorAll('[data-restore-file]').forEach(b=>b.addEventListener('click',()=>restoreFile(b.dataset.restoreFile)));
  document.querySelectorAll('[data-delete-file]').forEach(b=>b.addEventListener('click',()=>deletePermanent(b.dataset.deleteFile)));
}
async function disableShare(id){const {error}=await supabase.from('share_links').update({disabled:true}).eq('id',id).eq('owner_id',state.user.id);if(error)toast(error.message,'error');else{toast('Share link revoked');await loadSecondary();}}
async function restoreFile(id){const {error}=await supabase.from('files').update({is_trashed:false,deleted_at:null}).eq('id',id).eq('owner_id',state.user.id);if(error)toast(error.message,'error');else{toast('Restored');await loadSecondary();}}
async function deletePermanent(id){if(!confirm('Permanently delete metadata and storage file?'))return; const {data:f}=await supabase.from('files').select('*').eq('id',id).eq('owner_id',state.user.id).maybeSingle();if(!f)return; const {error}=await supabase.storage.from(STORAGE_BUCKET).remove([f.storage_path]); if(error){toast(error.message,'error');return;}const r=await supabase.from('files').delete().eq('id',id).eq('owner_id',state.user.id);if(r.error)toast(r.error.message,'error');else{toast('Deleted permanently');await loadSecondary();}}
async function clearNotifications(){if(!isAuth())return;const {error}=await supabase.rpc('filehub_clear_notifications');if(error)toast(error.message,'error');else{await loadNotifications();toast('Notifications cleared');setModal(null);render();}}

async function createFolder(){const name=$('#folderName')?.value?.trim();if(!name){toast('Enter a folder name','error');return;}const {error}=await supabase.from('folders').insert({owner_id:state.user.id,name});if(error)toast(error.message,'error');else{toast('Folder created');setModal(null);}}
async function fillFolders(){const sel=$('#folderSelect');if(!sel||!isAuth())return;const {data}=await supabase.from('folders').select('id,name').eq('owner_id',state.user.id).order('name');(data||[]).forEach(f=>sel.insertAdjacentHTML('beforeend',`<option value="${f.id}">${safeName(f.name)}</option>`));}

function bind(){
  document.querySelectorAll('[data-route]').forEach(b=>b.addEventListener('click',()=>route(b.dataset.route)));
  $('#menuBtn')?.addEventListener('click',()=>{state.menu=true;render();}); $('#closeDrawer')?.addEventListener('click',()=>{state.menu=false;render();}); $('#drawer')?.addEventListener('click',e=>{if(e.target.id==='drawer'){state.menu=false;render();}});
  $('#notifyBtn')?.addEventListener('click',async()=>{await loadNotifications();setModal({type:'notifications'});});
  $('#uploadBtn')?.addEventListener('click',()=>setModal({type:'upload'})); $('#convertBtn')?.addEventListener('click',()=>setModal({type:'auth',mode:'login'})); $('#convertMenu')?.addEventListener('click',()=>setModal({type:'auth',mode:'login'}));
  $('#guestBtn')?.addEventListener('click',()=>{state.guest=true;localStorage.setItem('filehub_guest','1');state.route='home';render();});
  $('#signOutMenu')?.addEventListener('click',signOut); $('#signOutProfile')?.addEventListener('click',signOut); $('#convertProfile')?.addEventListener('click',()=>setModal({type:'auth',mode:'login'}));
  $('#editProfileBtn')?.addEventListener('click',()=>setModal({type:'profileEdit'})); $('#saveProfile')?.addEventListener('click',profileSave);
  $('#newFolderBtn')?.addEventListener('click',()=>setModal({type:'folder'})); $('#createFolder')?.addEventListener('click',createFolder);
  $('#clearSearch')?.addEventListener('click',()=>{state.query='';state.results=state.files;render();});
  let timer;$('#searchInput')?.addEventListener('input',e=>{clearTimeout(timer);timer=setTimeout(()=>runSearch(e.target.value),260)});
  $('#scanBtn')?.addEventListener('click',openScanner);
  document.querySelectorAll('[data-open-file]').forEach(b=>b.addEventListener('click',()=>{const f=findFile(b.dataset.openFile); if(f)openFile(f);}));
  document.querySelectorAll('[data-share-file]').forEach(b=>b.addEventListener('click',()=>{const f=findFile(b.dataset.shareFile); if(f)setModal({type:'share',file:f});}));
  document.querySelectorAll('[data-more-file]').forEach(b=>b.addEventListener('click',()=>{const f=findFile(b.dataset.moreFile); if(f)setModal({type:'file',file:f});}));
  document.querySelectorAll('[data-close-modal]').forEach(b=>b.addEventListener('click',()=>setModal(null)));
  document.querySelectorAll('[data-notify-file]').forEach(b=>b.addEventListener('click',()=>{const f=findFile(b.dataset.notifyFile); if(f)openFile(f);}));
  $('#startUpload')?.addEventListener('click',()=>handleUpload($('#filePicker').files)); $('#filePicker')?.addEventListener('change',()=>{const f=$('#filePicker').files;$('#selectedFiles').textContent=f?.length?`${f.length} file(s): ${Array.from(f).map(x=>x.name).join(', ')}`:'No files selected';}); fillFolders();
  $('#createShare')?.addEventListener('click',async()=>{const f=state.modal?.file;try{const expiry=$('#shareExpiry')?.value?new Date($('#shareExpiry').value).toISOString():null;await createShare(f,$('#shareMode').value,expiry);}catch(e){toast(e.message,'error');}});
  const qr=state.modal?.type==='qr' ? state.modal.url:null; if(qr)drawQR(qr);
  $('#downloadQr')?.addEventListener('click',downloadQr); $('#nativeShareQr')?.addEventListener('click',()=>navigator.share?.({title:'FileHub QR',url:state.modal?.url}));
  $('#tabLogin')?.addEventListener('click',()=>{ $('#authBody').innerHTML=authFields('login'); $('#tabLogin').classList.add('active');$('#tabSignup').classList.remove('active'); attachAuthSubmit('login');}); $('#tabSignup')?.addEventListener('click',()=>{ $('#authBody').innerHTML=authFields('signup'); $('#tabSignup').classList.add('active');$('#tabLogin').classList.remove('active'); attachAuthSubmit('signup');}); attachAuthSubmit('login');
  if(state.route!=='home'&&state.route!=='files'&&state.route!=='profile') loadSecondary();
}
function attachAuthSubmit(mode){$('#authSubmit')?.addEventListener('click',()=>submitAuth(mode));}
async function submitAuth(mode){
  const email=$('#authEmail')?.value?.trim();const password=$('#authPassword')?.value||''; if(!email||!password){toast('Email and password are required','error');return;}
  let r; if(mode==='signup'){r=await supabase.auth.signUp({email,password,options:{data:{full_name:$('#authName')?.value?.trim()||''}}});}else r=await supabase.auth.signInWithPassword({email,password});
  if(r.error){toast(r.error.message,'error');return;} if(r.data.session){state.guest=false;localStorage.removeItem('filehub_guest');state.session=r.data.session;state.user=r.data.user;await loadProfile();await checkAdmin();state.route='home';state.modal=null;await loadHome();}
  else toast('Check your email to confirm the account.','ok');
}
async function signOut(){if(supabase)await supabase.auth.signOut();state.session=null;state.user=null;state.profile=null;state.guest=false;localStorage.removeItem('filehub_guest');state.route='home';render();}
function findFile(id){return [...state.files,...state.results].find(f=>f.id===id)||null;}
async function checkAdmin(){if(!isAuth())return;try{const {data,error}=await supabase.rpc('filehub_admin_has_permission',{p_permission:'view_activity_logs'});state.isAdmin=!error&&Boolean(data);}catch{state.isAdmin=false}state.adminLoaded=true;}
async function openScanner(){
  const modal=document.createElement('div');modal.className='modal open';modal.innerHTML=`<div class="modal-card"><div class="modal-head"><h3 style="margin:0">QR Scanner</h3><button class="icon-btn" id="closeScan">✕</button></div><div class="preview-frame" style="margin-top:12px"><video id="scanVideo" playsinline style="width:100%;height:100%;object-fit:cover"></video></div><div class="notice" style="margin-top:10px">Point the camera at a FileHub QR. If barcode scanning is unavailable, paste the URL/code below.</div><div class="form-grid"><input id="qrManual" placeholder="https://… or 4-digit code"/><button class="gold-btn" id="qrManualGo">Open</button></div></div>`;document.body.appendChild(modal);const close=()=>{modal.remove();track?.stop()};$('#closeScan')?.addEventListener('click',close, {once:true});let track=null;try{const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});track={stop:()=>stream.getTracks().forEach(t=>t.stop())};const v=$('#scanVideo');v.srcObject=stream;await v.play(); if('BarcodeDetector' in window){const det=new BarcodeDetector({formats:['qr_code']}); const loop=async()=>{if(!document.body.contains(modal))return;try{const codes=await det.detect(v);if(codes[0]?.rawValue){$('#qrManual').value=codes[0].rawValue; openScannedTarget(codes[0].rawValue);close();return;}}catch{} requestAnimationFrame(loop)};loop();} }catch(e){modal.querySelector('.notice').textContent='Camera permission unavailable. Use the manual field.';}
  $('#qrManualGo')?.addEventListener('click',()=>{openScannedTarget($('#qrManual').value);close();});
}
async function openScannedTarget(value){const v=String(value||'').trim();if(!v)return; if(v.includes('?share=')){location.href=v;return;} if(/^\d{4}$/.test(v)){await runSearch(v);return;} if(/^https?:\/\//i.test(v)){window.open(v,'_blank');return;} await runSearch(v);}

function drawQR(url){const host=$('#qrCanvas');if(!host)return; const canvas=document.createElement('canvas');host.innerHTML='';host.appendChild(canvas); if(window.QRCode){new window.QRCode(canvas,{text:url,width:220,height:220,correctLevel:2});}else{host.innerHTML=`<div style="color:#111;padding:30px">QR library loads in the hosted build. URL:<br/>${safeName(url)}</div>`;}}
function downloadQr(){const canvas=$('#qrCanvas canvas');if(!canvas){toast('QR not ready','error');return;}const a=document.createElement('a');a.download='filehub-qr.png';a.href=canvas.toDataURL('image/png');a.click();}

async function boot(){
  if(supabase){const {data}=await supabase.auth.getSession();state.session=data.session;state.user=data.session?.user||null;supabase.auth.onAuthStateChange(async(_event,session)=>{state.session=session;state.user=session?.user||null;if(session){state.guest=false;localStorage.removeItem('filehub_guest');await loadProfile();await checkAdmin();}else if(!state.guest){state.profile=null;}render();});}
  if(state.user){state.guest=false;localStorage.removeItem('filehub_guest');await loadProfile();await checkAdmin();}
  await handleDeepLink();
  await render();
  if(state.user) await loadHome();
}
async function handleDeepLink(){const u=new URL(location.href);const token=u.searchParams.get('share');if(!token)return;try{const res=await publicApi('filehub-open-share-link?token='+encodeURIComponent(token));const j=await res.json();if(!res.ok)throw new Error(j.error||'Share link unavailable');state.guest=true;localStorage.setItem('filehub_guest','1');state.route='home';setTimeout(()=>openPublicShare(j),50);}catch(e){setTimeout(()=>toast(e.message,'error'),200);}}
async function openPublicShare(data){const f=data.file;state.files=[f];state.results=[f];state.query='';state.guest=true;setModal({type:'file',file:f});setTimeout(()=>{$('#previewArea').innerHTML=`<div style="text-align:center"><div style="font-size:52px">${iconFor(f)}</div><div style="margin-top:10px">${safeName(f.display_name||f.original_name)}</div></div>`; if(data.signed_url){if(f.mime_type?.startsWith('image/'))$('#previewArea').innerHTML=`<img src="${data.signed_url}"/>`;else if(f.mime_type==='application/pdf')$('#previewArea').innerHTML=`<iframe src="${data.signed_url}#toolbar=1"></iframe>`;else if(f.mime_type?.startsWith('video/'))$('#previewArea').innerHTML=`<video controls playsinline src="${data.signed_url}"></video>`;else if(f.mime_type?.startsWith('audio/'))$('#previewArea').innerHTML=`<audio class="audio" controls src="${data.signed_url}"></audio>`; else $('#downloadFile')?.addEventListener('click',()=>window.open(data.signed_url,'_blank'));}},100);}
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.modal)setModal(null)});

// QR code dependency is loaded lazily from CDN only for the QR UI.
const qrScript=document.createElement('script');qrScript.src='https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';qrScript.async=true;document.head.appendChild(qrScript);
boot();
