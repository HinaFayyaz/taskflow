// ════════════════════════════════════════════════════════════════════
//  TaskFlow — Supabase-powered multi-user app
// ════════════════════════════════════════════════════════════════════

const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const tagMap   = { client:'Client Work', admin:'Admin', content:'Content', project:'Project' };
const tagClass = { client:'tag-client',  admin:'tag-admin', content:'tag-content', project:'tag-project' };

// ─── Supabase client ────────────────────────────────────────────────
let db = null;
let CONFIG_OK = false;
try {
  if (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL && !SUPABASE_URL.startsWith('YOUR_')) {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    CONFIG_OK = true;
  }
} catch (e) { console.error(e); }

// ─── Runtime state ──────────────────────────────────────────────────
let me = null;                 // { id, email, name }
let myFolders = [];
let myTasks   = [];
let myNotes   = [];
let incomingShares = [];       // shares where I'm the invitee
let outgoingShares = [];       // shares I created (for current share target)
let myShares = [];             // all shares I created (for card avatars)

let view = 'daily';
let activeContext = { kind: 'board' };  // {kind:'board'|'folder', folderId}
                                        // or {kind:'shared', share, tasks, folders, canEdit}
let editingFolderId = null;
let editingNoteId   = null;
let editingTaskId   = null;
let shareTab = 'task';

// ════════════════════════════════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  const now = new Date();
  const dc = document.getElementById('date-chip');
  if (dc) dc.textContent = DAYS[now.getDay()]+', '+MONTHS[now.getMonth()]+' '+now.getDate();
  const td = document.getElementById('task-date');
  if (td) td.value = today();

  if (!CONFIG_OK) {
    showConfigWarning();
    return;
  }

  // Already logged in?
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    await onLoggedIn(session.user);
  } else {
    showAuth();
  }

  db.auth.onAuthStateChange((_event, session) => {
    if (session && !me) onLoggedIn(session.user);
    if (!session && me) { me = null; showAuth(); }
  });
});

function showConfigWarning() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.querySelector('.auth-card').innerHTML = `
    <div class="auth-logo"><span class="logo-mark">T</span><span class="auth-logo-text">TaskFlow</span></div>
    <h2 class="auth-heading">Almost there!</h2>
    <p class="auth-sub" style="line-height:1.6;">
      Open <b>config.js</b> and paste your Supabase URL and anon key,
      then re-deploy. See <b>SETUP.md</b> for the 5-minute walkthrough.
    </p>`;
}

// ════════════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════════════
let authMode = 'login';   // 'login' | 'signup'

function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-shell').style.display = 'none';
}
function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'block';
}

function toggleAuthMode() {
  authMode = authMode === 'login' ? 'signup' : 'login';
  const heading = document.getElementById('auth-heading');
  const sub     = document.getElementById('auth-sub');
  const submit  = document.getElementById('auth-submit');
  const tText   = document.getElementById('auth-toggle-text');
  const tBtn    = document.getElementById('auth-toggle-btn');
  const pw      = document.getElementById('auth-password');
  const nameFld = document.getElementById('auth-name-field');
  clearAuthMsg();
  if (authMode === 'signup') {
    heading.textContent = 'Create your account';
    sub.textContent     = 'Start organizing your work';
    submit.textContent  = 'Sign Up';
    tText.textContent   = 'Already have an account?';
    tBtn.textContent    = 'Log in';
    pw.setAttribute('autocomplete','new-password');
    nameFld.style.display = 'flex';
  } else {
    heading.textContent = 'Welcome back';
    sub.textContent     = 'Log in to your workspace';
    submit.textContent  = 'Log In';
    tText.textContent   = "Don't have an account?";
    tBtn.textContent    = 'Sign up';
    pw.setAttribute('autocomplete','current-password');
    nameFld.style.display = 'none';
  }
}

function clearAuthMsg() {
  document.getElementById('auth-error').style.display = 'none';
  document.getElementById('auth-success').style.display = 'none';
}
function authError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg; el.style.display = 'block';
  document.getElementById('auth-success').style.display = 'none';
}
function authSuccess(msg) {
  const el = document.getElementById('auth-success');
  el.textContent = msg; el.style.display = 'block';
  document.getElementById('auth-error').style.display = 'none';
}

async function submitAuth() {
  clearAuthMsg();
  const email = document.getElementById('auth-email').value.trim().toLowerCase();
  const password = document.getElementById('auth-password').value;
  const fullName = document.getElementById('auth-name').value.trim();
  if (authMode === 'signup' && !fullName) { authError('Please enter your name.'); return; }
  if (!email || !password) { authError('Please enter your email and password.'); return; }
  if (password.length < 6) { authError('Password must be at least 6 characters.'); return; }

  const btn = document.getElementById('auth-submit');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Please wait…';

  try {
    if (authMode === 'signup') {
      const { data, error } = await db.auth.signUp({
        email, password,
        options: { data: { display_name: fullName } }
      });
      if (error) throw error;
      if (data.session) {
        // Make sure the profile row carries the chosen name
        await db.from('profiles').update({ display_name: fullName }).eq('id', data.session.user.id);
        await onLoggedIn(data.session.user);
      } else {
        // email confirmation is ON
        authSuccess('Account created! Check your email to confirm, then log in.');
        authMode = 'signup'; toggleAuthMode();
      }
    } else {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await onLoggedIn(data.session.user);
    }
  } catch (e) {
    authError(prettyAuthError(e.message));
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

function prettyAuthError(msg) {
  if (/already registered/i.test(msg)) return 'That email is already registered. Try logging in.';
  if (/invalid login/i.test(msg))      return 'Incorrect email or password.';
  if (/confirm/i.test(msg))            return 'Please confirm your email first (check your inbox).';
  return msg;
}

async function logout() {
  await db.auth.signOut();
  me = null;
  showAuth();
}

// ════════════════════════════════════════════════════════════════════
//  PROFILE MENU + SETTINGS
// ════════════════════════════════════════════════════════════════════
function toggleProfileMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('profile-menu');
  const chev = document.getElementById('profile-chevron');
  const open = menu.classList.toggle('open');
  chev.style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';
}
// Close the menu when clicking anywhere else
document.addEventListener('click', (e) => {
  const menu = document.getElementById('profile-menu');
  const user = document.getElementById('sidebar-user');
  if (menu && menu.classList.contains('open') && !menu.contains(e.target) && user && !user.contains(e.target)) {
    menu.classList.remove('open');
    const chev = document.getElementById('profile-chevron');
    if (chev) chev.style.transform = 'rotate(0deg)';
  }
});

function profileMsg(msg, ok) {
  const el = document.getElementById('profile-msg');
  el.style.display = 'block';
  el.textContent = msg;
  el.className = 'profile-msg ' + (ok ? 'profile-msg-ok' : 'profile-msg-err');
}

function openProfileModal(panel) {
  // close the popup menu
  document.getElementById('profile-menu').classList.remove('open');
  document.getElementById('profile-chevron').style.transform = 'rotate(0deg)';
  document.getElementById('profile-msg').style.display = 'none';

  // show only the requested panel
  ['photo','email','password'].forEach(p => {
    document.getElementById('profile-panel-'+p).style.display = (p === panel) ? 'flex' : 'none';
  });
  const titles = { photo:'Change profile picture', email:'Change email', password:'Change password' };
  document.getElementById('profile-modal-title').textContent = titles[panel] || 'Profile';

  if (panel === 'photo') {
    const pv = document.getElementById('profile-photo-preview');
    if (me.avatar) { pv.style.backgroundImage = `url(${me.avatar})`; pv.classList.add('has-photo'); pv.textContent=''; }
    else { pv.style.backgroundImage=''; pv.classList.remove('has-photo'); pv.textContent=(me.name[0]||'U').toUpperCase(); }
    document.getElementById('profile-photo-remove').style.display = me.avatar ? 'inline-flex' : 'none';
  }
  if (panel === 'email')    document.getElementById('profile-email-input').value = me.email;
  if (panel === 'password') { document.getElementById('profile-pw-input').value=''; document.getElementById('profile-pw-confirm').value=''; }

  document.getElementById('profile-modal').classList.add('open');
}
function closeProfileModal(e) {
  if (e && e.target !== document.getElementById('profile-modal')) return;
  document.getElementById('profile-modal').classList.remove('open');
}

// ── Photo ──
function onProfilePhotoSelected(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { profileMsg('Please choose an image file.', false); return; }
  if (file.size > 1024*1024) { profileMsg('Image is too large (max 1 MB). Try a smaller one.', false); return; }
  const reader = new FileReader();
  reader.onload = async ev => {
    const dataUrl = ev.target.result;
    const { error } = await db.from('profiles').update({ avatar_url: dataUrl }).eq('id', me.id);
    if (error) { profileMsg('Could not save photo: ' + error.message, false); return; }
    me.avatar = dataUrl;
    renderProfileUI();
    const pv = document.getElementById('profile-photo-preview');
    pv.style.backgroundImage = `url(${dataUrl})`; pv.classList.add('has-photo'); pv.textContent='';
    document.getElementById('profile-photo-remove').style.display = 'inline-flex';
    profileMsg('Profile picture updated!', true);
  };
  reader.readAsDataURL(file);
}
async function removeProfilePhoto() {
  const { error } = await db.from('profiles').update({ avatar_url: null }).eq('id', me.id);
  if (error) { profileMsg('Could not remove photo: ' + error.message, false); return; }
  me.avatar = null;
  renderProfileUI();
  const pv = document.getElementById('profile-photo-preview');
  pv.style.backgroundImage=''; pv.classList.remove('has-photo'); pv.textContent=(me.name[0]||'U').toUpperCase();
  document.getElementById('profile-photo-remove').style.display = 'none';
  profileMsg('Profile picture removed.', true);
}

// ── Email ──
async function saveNewEmail() {
  const newEmail = document.getElementById('profile-email-input').value.trim().toLowerCase();
  if (!newEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) { profileMsg('Please enter a valid email.', false); return; }
  if (newEmail === me.email) { profileMsg('That is already your email.', false); return; }
  const { error } = await db.auth.updateUser({ email: newEmail });
  if (error) { profileMsg('Could not update: ' + error.message, false); return; }
  profileMsg('Confirmation link sent to ' + newEmail + '. Click it to finish the change.', true);
}

// ── Password ──
async function saveNewPassword() {
  const pw = document.getElementById('profile-pw-input').value;
  const pw2 = document.getElementById('profile-pw-confirm').value;
  if (pw.length < 6) { profileMsg('Password must be at least 6 characters.', false); return; }
  if (pw !== pw2) { profileMsg('Passwords do not match.', false); return; }
  const { error } = await db.auth.updateUser({ password: pw });
  if (error) { profileMsg('Could not update: ' + error.message, false); return; }
  profileMsg('Password updated successfully!', true);
  document.getElementById('profile-pw-input').value='';
  document.getElementById('profile-pw-confirm').value='';
}

// ════════════════════════════════════════════════════════════════════
//  SEARCH
// ════════════════════════════════════════════════════════════════════
let searchTerm = '';
function onSearchInput() {
  searchTerm = document.getElementById('search-input').value.trim().toLowerCase();
  document.getElementById('search-clear').style.display = searchTerm ? 'flex' : 'none';
  renderBoard();
}
function clearSearch() {
  searchTerm = '';
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').style.display = 'none';
  renderBoard();
}

async function onLoggedIn(user) {
  me = { id: user.id, email: (user.email||'').toLowerCase(), name: (user.email||'').split('@')[0], avatar: null };

  // Pull display name + avatar from the profiles table
  try {
    const { data: prof } = await db.from('profiles').select('display_name,avatar_url').eq('id', user.id).single();
    if (prof) {
      if (prof.display_name) me.name = prof.display_name;
      if (prof.avatar_url)   me.avatar = prof.avatar_url;
    }
  } catch(e) { /* profile may not exist yet */ }

  renderProfileUI();
  showApp();
  await loadEverything();
}

function renderProfileUI() {
  document.getElementById('user-name').textContent  = me.name;
  document.getElementById('user-email').textContent = me.email;
  const av = document.getElementById('user-avatar');
  if (me.avatar) {
    av.style.backgroundImage = `url(${me.avatar})`;
    av.classList.add('has-photo');
    av.textContent = '';
  } else {
    av.style.backgroundImage = '';
    av.classList.remove('has-photo');
    av.textContent = (me.name[0]||'U').toUpperCase();
  }
}

// ════════════════════════════════════════════════════════════════════
//  DATA LOADING
// ════════════════════════════════════════════════════════════════════
async function loadEverything() {
  await Promise.all([loadFolders(), loadTasks(), loadNotes(), loadIncomingShares(), loadMyShares()]);
  renderFolderList();
  renderFolderSelect();
  renderSharedList();
  renderBoard();
  renderNotes();
}

async function loadFolders() {
  const { data, error } = await db.from('folders').select('*').eq('owner_id', me.id).order('created_at');
  if (error) { console.error(error); return; }
  myFolders = data || [];
}

async function loadTasks() {
  const { data, error } = await db.from('tasks').select('*').eq('owner_id', me.id).order('created_at');
  if (error) { console.error(error); return; }
  myTasks = data || [];
}

async function loadNotes() {
  const { data, error } = await db.from('notes').select('*').eq('owner_id', me.id).order('created_at', { ascending:false });
  if (error) { console.error(error); return; }
  myNotes = data || [];
}

async function loadIncomingShares() {
  const { data, error } = await db.from('shares').select('*').ilike('invited_email', me.email);
  if (error) { console.error(error); return; }
  incomingShares = (data || []).filter(s => s.owner_id !== me.id);
}

async function loadMyShares() {
  const { data, error } = await db.from('shares').select('*').eq('owner_id', me.id);
  if (error) { console.error(error); return; }
  myShares = data || [];
}

// Who is a given task shared with? Returns array of emails.
function sharedEmailsForTask(t) {
  const emails = new Set();
  myShares.forEach(s => {
    if (s.resource_type === 'board') emails.add(s.invited_email);
    else if (s.resource_type === 'folder' && t.folder_id && s.resource_id === t.folder_id) emails.add(s.invited_email);
    else if (s.resource_type === 'task' && s.resource_id === t.id) emails.add(s.invited_email);
  });
  return [...emails];
}

// Build initials + a stable colour from an email
function avatarFor(email) {
  const name = (email || '?').split('@')[0];
  const initials = name.slice(0, 2).toUpperCase();
  const colors = ['#6C5CE7','#00B894','#E84393','#0984E3','#FDCB6E','#E17055','#00CEC9','#A29BFE'];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  const color = colors[Math.abs(hash) % colors.length];
  return { initials, color };
}

function avatarStack(emails) {
  if (!emails.length) return '';
  const shown = emails.slice(0, 3);
  const extra = emails.length - shown.length;
  const circles = shown.map(em => {
    const a = avatarFor(em);
    return `<span class="card-avatar" style="background:${a.color};" title="${esc(em)}">${a.initials}</span>`;
  }).join('');
  const more = extra > 0 ? `<span class="card-avatar card-avatar-more" title="${extra} more">+${extra}</span>` : '';
  return `<div class="card-avatars">${circles}${more}</div>`;
}

// ════════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════════
function today() { return new Date().toISOString().split('T')[0]; }
function formatDate(iso) { if(!iso) return ''; const [y,m,d]=iso.split('-'); return `${d}/${m}/${y}`; }
function esc(s){ if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function fileIcon(m){ if(!m)return'fa-file'; if(m.startsWith('image/'))return'fa-file-image'; if(m==='application/pdf')return'fa-file-pdf'; if(m.includes('word'))return'fa-file-word'; if(m.includes('excel')||m.includes('spreadsheet'))return'fa-file-excel'; if(m.includes('powerpoint')||m.includes('presentation'))return'fa-file-powerpoint'; if(m.startsWith('video/'))return'fa-file-video'; if(m.startsWith('audio/'))return'fa-file-audio'; if(m.includes('zip')||m.includes('rar'))return'fa-file-zipper'; if(m.startsWith('text/'))return'fa-file-lines'; return'fa-file'; }
function fileIconColor(m){ if(!m)return'var(--text-tertiary)'; if(m.startsWith('image/'))return'#185FA5'; if(m==='application/pdf')return'#c0392b'; if(m.includes('word'))return'#2980b9'; if(m.includes('excel')||m.includes('spreadsheet'))return'#27ae60'; if(m.includes('powerpoint')||m.includes('presentation'))return'#e67e22'; if(m.startsWith('video/'))return'#8e44ad'; return'var(--text-secondary)'; }
function formatBytes(b){ if(b<1024)return b+' B'; if(b<1048576)return(b/1024).toFixed(1)+' KB'; return(b/1048576).toFixed(1)+' MB'; }

// ════════════════════════════════════════════════════════════════════
//  SIDEBAR / NAV
// ════════════════════════════════════════════════════════════════════
let sidebarOpen = true;
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  document.getElementById('sidebar').classList.toggle('collapsed', !sidebarOpen);
  document.querySelector('.main-wrap').classList.toggle('full', !sidebarOpen);
}

function setActiveNav(which) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.folder-item').forEach(f => f.classList.remove('active'));
  document.querySelectorAll('.shared-item').forEach(s => s.classList.remove('active'));
  if (which === 'board') document.querySelectorAll('.nav-item')[0].classList.add('active');
  if (which === 'notes') document.querySelectorAll('.nav-item')[1].classList.add('active');
}

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  if (page === 'board') {
    activeContext = { kind:'board' };
    document.getElementById('page-title').textContent = 'My Board';
    document.getElementById('shared-banner').style.display = 'none';
    document.getElementById('add-bar').style.display = 'flex';
    document.getElementById('view-tabs').style.display = 'flex';
    document.getElementById('share-topbar-btn').style.display = 'flex';
    document.getElementById('newtask-topbar-btn').style.display = 'flex';
    document.getElementById('topbar-search').style.display = 'flex';
    setActiveNav('board');
    renderBoard();
  } else {
    document.getElementById('page-title').textContent = 'Notes';
    document.getElementById('view-tabs').style.display = 'none';
    document.getElementById('share-topbar-btn').style.display = 'none';
    document.getElementById('newtask-topbar-btn').style.display = 'none';
    document.getElementById('topbar-search').style.display = 'none';
    setActiveNav('notes');
    renderNotes();
  }
}

function filterByFolder(fid) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-board').classList.add('active');
  activeContext = { kind:'folder', folderId: fid };
  document.getElementById('page-title').textContent = myFolders.find(f=>f.id===fid)?.name || 'Folder';
  document.getElementById('shared-banner').style.display = 'none';
  document.getElementById('add-bar').style.display = 'flex';
  document.getElementById('view-tabs').style.display = 'none';
  document.getElementById('share-topbar-btn').style.display = 'flex';
  document.getElementById('newtask-topbar-btn').style.display = 'flex';
  document.getElementById('topbar-search').style.display = 'flex';
  setActiveNav();
  document.querySelectorAll('.folder-item').forEach(f => f.classList.toggle('active', f.dataset.fid === fid));
  renderBoard();
}

// ════════════════════════════════════════════════════════════════════
//  FOLDERS
// ════════════════════════════════════════════════════════════════════
function renderFolderList() {
  const el = document.getElementById('folder-list');
  if (!myFolders.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary);padding:4px 10px;">No folders yet</div>'; return; }
  el.innerHTML = myFolders.map(f => `
    <div class="folder-item" data-fid="${f.id}" onclick="filterByFolder('${f.id}')">
      <i class="fa-solid fa-folder"></i>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.name)}</span>
      <button class="folder-del" onclick="deleteFolder(event,'${f.id}')" title="Delete"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
}
function renderFolderSelect() {
  const sel = document.getElementById('task-folder');
  sel.innerHTML = '<option value="">No folder</option>' + myFolders.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
}
function openFolderModal(editId) {
  editingFolderId = editId || null;
  document.getElementById('folder-modal-title').textContent = editId ? 'Rename Folder' : 'New Folder';
  document.getElementById('folder-name-input').value = editId ? (myFolders.find(f=>f.id===editId)?.name||'') : '';
  document.getElementById('folder-modal').classList.add('open');
  setTimeout(() => document.getElementById('folder-name-input').focus(), 50);
}
function closeFolderModal(e) {
  if (e && e.target !== document.getElementById('folder-modal')) return;
  document.getElementById('folder-modal').classList.remove('open');
}
async function saveFolder() {
  const name = document.getElementById('folder-name-input').value.trim();
  if (!name) return;
  if (editingFolderId) {
    await db.from('folders').update({ name }).eq('id', editingFolderId);
  } else {
    await db.from('folders').insert({ owner_id: me.id, name });
  }
  document.getElementById('folder-modal').classList.remove('open');
  await loadFolders();
  renderFolderList(); renderFolderSelect();
}
async function deleteFolder(e, id) {
  e.stopPropagation();
  if (!confirm('Delete this folder? Tasks inside will be unassigned.')) return;
  await db.from('folders').delete().eq('id', id);
  await Promise.all([loadFolders(), loadTasks()]);
  if (activeContext.kind==='folder' && activeContext.folderId===id) navigateTo('board');
  renderFolderList(); renderFolderSelect(); renderBoard();
}

// ════════════════════════════════════════════════════════════════════
//  VIEW TABS
// ════════════════════════════════════════════════════════════════════
function switchView(v, btn) {
  view = v;
  document.querySelectorAll('.vtab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderBoard();
}

// ════════════════════════════════════════════════════════════════════
//  BOARD RENDER
// ════════════════════════════════════════════════════════════════════
function currentBoardData() {
  // Returns { tasks, folders, canEdit, readOnly }
  if (activeContext.kind === 'shared') {
    return { tasks: activeContext.tasks, folders: activeContext.folders, canEdit: activeContext.canEdit, readOnly: !activeContext.canEdit };
  }
  if (activeContext.kind === 'folder') {
    return { tasks: myTasks.filter(t => t.folder_id === activeContext.folderId), folders: myFolders, canEdit: true, readOnly: false };
  }
  // board
  return { tasks: myTasks.filter(t => t.scope === view), folders: myFolders, canEdit: true, readOnly: false };
}

function isOverdue(t) {
  if (!t.due_date || t.status === 'done') return false;
  const d = new Date(t.due_date + 'T23:59:59');
  return d < new Date();
}

function renderBoard() {
  const { tasks: allTasks, folders, readOnly } = currentBoardData();
  const tasks = searchTerm
    ? allTasks.filter(t =>
        (t.text||'').toLowerCase().includes(searchTerm) ||
        (t.note||'').toLowerCase().includes(searchTerm))
    : allTasks;
  const cols = { todo:[], doing:[], done:[] };
  tasks.forEach(t => { if (cols[t.status]) cols[t.status].push(t); });
  const total = tasks.length, done = cols.done.length, pct = total ? Math.round(done/total*100) : 0;
  const overdue = tasks.filter(isOverdue).length;

  document.getElementById('stats-row').innerHTML = `
    <div class="progress-card">
      <div class="progress-head">
        <span class="progress-title">Project Progress</span>
      </div>
      <div class="progress-bar-row">
        <span class="progress-sub">Completion</span>
        <span class="progress-pct">${pct}%</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
      <div class="stat-grid">
        <div class="mini-stat mini-total">
          <div class="mini-icon"><i class="fa-solid fa-list-check"></i></div>
          <div><div class="mini-label">Total Tasks</div><div class="mini-val">${total}</div></div>
        </div>
        <div class="mini-stat mini-doing">
          <div class="mini-icon"><i class="fa-solid fa-spinner"></i></div>
          <div><div class="mini-label">In Progress</div><div class="mini-val">${cols.doing.length}</div></div>
        </div>
        <div class="mini-stat mini-done">
          <div class="mini-icon"><i class="fa-solid fa-circle-check"></i></div>
          <div><div class="mini-label">Completed</div><div class="mini-val">${done}</div></div>
        </div>
        <div class="mini-stat mini-overdue">
          <div class="mini-icon"><i class="fa-solid fa-circle-exclamation"></i></div>
          <div><div class="mini-label">Overdue</div><div class="mini-val">${overdue}</div></div>
        </div>
      </div>
    </div>`;

  const colDefs = [
    { key:'todo',  label:'To Do',       cls:'count-todo'  },
    { key:'doing', label:'In Progress',  cls:'count-doing' },
    { key:'done',  label:'Completed',    cls:'count-done'  },
  ];
  document.getElementById('board').innerHTML = colDefs.map(col => `
    <div class="board-col">
      <div class="col-head"><span class="col-title">${col.label}</span><span class="col-count ${col.cls}">${cols[col.key].length}</span></div>
      ${cols[col.key].length ? cols[col.key].map(t => taskCard(t, folders, readOnly)).join('') : '<div class="empty-col"><i class="fa-regular fa-circle-check" style="font-size:20px;margin-bottom:6px;display:block;"></i>Nothing here</div>'}
    </div>`).join('');
}

function taskCard(t, folders, readOnly) {
  const folder = folders.find(f => f.id === t.folder_id);
  const ac = (t.attachments || []).length;
  const clickAttr = readOnly ? '' : `onclick="openTaskDetail('${t.id}')"`;
  const sharedEmails = readOnly ? [] : sharedEmailsForTask(t);
  const overdue = isOverdue(t);
  return `
    <div class="task-card${overdue?' is-overdue':''}" ${clickAttr} style="${readOnly?'cursor:default;':''}">
      <div class="task-top">
        <div class="task-check ${t.status==='done'?'checked':''}" ${readOnly?'':`onclick="cycleStatus(event,'${t.id}')"`}></div>
        <div class="task-body">
          <div class="task-text ${t.status==='done'?'done-text':''}">${esc(t.text)}</div>
          <div class="task-meta">
            <span class="tag ${tagClass[t.tag]}">${tagMap[t.tag]||t.tag}</span>
            ${t.due_date?`<span class="task-date-badge${overdue?' overdue-date':''}"><i class="fa-regular fa-calendar" style="font-size:10px;"></i> ${formatDate(t.due_date)}</span>`:''}
            ${t.note?`<span class="task-note-icon" title="Has note"><i class="fa-regular fa-note-sticky"></i></span>`:''}
            ${ac?`<span class="task-attach-badge"><i class="fa-solid fa-paperclip" style="font-size:10px;"></i> ${ac}</span>`:''}
            ${folder?`<span class="task-folder-badge"><i class="fa-solid fa-folder" style="font-size:10px;"></i> ${esc(folder.name)}</span>`:''}
          </div>
          <div class="task-foot">
            ${avatarStack(sharedEmails)}
            ${(!readOnly && t.status!=='done')?`<button class="move-btn" onclick="moveNext(event,'${t.id}')">${t.status==='todo'?'→ Start':'→ Done'}</button>`:''}
          </div>
        </div>
      </div>
      ${readOnly ? '' : `
      <div style="display:flex;gap:4px;position:absolute;top:8px;right:8px;">
        <button class="share-card-btn" onclick="quickShareTask('${t.id}',event)" title="Share task"><i class="fa-solid fa-share-nodes"></i></button>
        <button class="del-btn" style="position:static;opacity:1;" onclick="deleteTask(event,'${t.id}')" title="Delete"><i class="fa-solid fa-xmark"></i></button>
      </div>`}
    </div>`;
}

function findTask(id) {
  if (activeContext.kind === 'shared') return activeContext.tasks.find(t => t.id === id);
  return myTasks.find(t => t.id === id);
}

async function cycleStatus(e, id) {
  e.stopPropagation();
  const t = findTask(id); if (!t) return;
  const cy = { todo:'doing', doing:'done', done:'todo' };
  t.status = cy[t.status];
  await db.from('tasks').update({ status: t.status }).eq('id', id);
  renderBoard();
}
async function moveNext(e, id) {
  e.stopPropagation();
  const t = findTask(id); if (!t) return;
  if (t.status==='todo') t.status='doing'; else if (t.status==='doing') t.status='done';
  await db.from('tasks').update({ status: t.status }).eq('id', id);
  renderBoard();
}
async function deleteTask(e, id) {
  e.stopPropagation();
  if (!confirm('Delete this task?')) return;
  await db.from('tasks').delete().eq('id', id);
  myTasks = myTasks.filter(t => t.id !== id);
  renderBoard();
}
async function addTask() {
  const inp = document.getElementById('task-input');
  const text = inp.value.trim(); if (!text) return;
  const folderVal = activeContext.kind === 'folder'
    ? activeContext.folderId
    : (document.getElementById('task-folder').value || null);
  const row = {
    owner_id: me.id,
    text,
    tag:    document.getElementById('task-tag').value,
    scope:  document.getElementById('task-scope').value,
    due_date: document.getElementById('task-date').value || null,
    folder_id: folderVal,
    status: 'todo',
    note: '',
    attachments: [],
  };
  const { data, error } = await db.from('tasks').insert(row).select().single();
  if (error) { alert('Could not add task: ' + error.message); return; }
  myTasks.push(data);
  inp.value = '';
  renderBoard();
}

// ════════════════════════════════════════════════════════════════════
//  NEW TASK MODAL (full create dialog with share)
// ════════════════════════════════════════════════════════════════════
let ntShareChips = [];  // [{email, perm}]

function openNewTaskModal() {
  ntShareChips = [];
  document.getElementById('nt-title').value = '';
  document.getElementById('nt-desc').value = '';
  document.getElementById('nt-tag').value = 'client';
  document.getElementById('nt-status').value = 'todo';
  document.getElementById('nt-scope').value = (view === 'weekly') ? 'weekly' : 'daily';
  document.getElementById('nt-date').value = today();
  document.getElementById('nt-share-email').value = '';
  document.getElementById('nt-share-perm').value = 'view';

  // Folder dropdown — preselect current folder if we're in one
  const fsel = document.getElementById('nt-folder');
  fsel.innerHTML = '<option value="">No folder</option>' +
    myFolders.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  if (activeContext.kind === 'folder') fsel.value = activeContext.folderId;

  renderNtShareChips();
  document.getElementById('newtask-modal').classList.add('open');
  setTimeout(() => document.getElementById('nt-title').focus(), 50);
}

function closeNewTaskModal(e) {
  if (e && e.target !== document.getElementById('newtask-modal')) return;
  document.getElementById('newtask-modal').classList.remove('open');
}

function ntAddShareChip() {
  const emailEl = document.getElementById('nt-share-email');
  const email = emailEl.value.trim().toLowerCase();
  const perm = document.getElementById('nt-share-perm').value;
  if (!email) return;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { alert('Please enter a valid email address.'); return; }
  if (email === me.email) { alert("That's your own email!"); return; }
  if (ntShareChips.some(c => c.email === email)) { emailEl.value=''; return; }
  ntShareChips.push({ email, perm });
  emailEl.value = '';
  renderNtShareChips();
}

function ntRemoveShareChip(email) {
  ntShareChips = ntShareChips.filter(c => c.email !== email);
  renderNtShareChips();
}

function renderNtShareChips() {
  const el = document.getElementById('nt-share-chips');
  if (!ntShareChips.length) { el.innerHTML = ''; return; }
  el.innerHTML = ntShareChips.map(c => {
    const a = avatarFor(c.email);
    return `<div class="nt-chip">
      <span class="card-avatar" style="background:${a.color};width:22px;height:22px;font-size:9px;">${a.initials}</span>
      <span class="nt-chip-email">${esc(c.email)}</span>
      <span class="nt-chip-perm">${c.perm === 'edit' ? 'Edit' : 'View'}</span>
      <button class="nt-chip-x" onclick="ntRemoveShareChip('${c.email.replace(/'/g,"\\'")}')"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  }).join('');
}

async function submitNewTask() {
  const title = document.getElementById('nt-title').value.trim();
  if (!title) { alert('Please enter a task title.'); return; }
  const folderVal = document.getElementById('nt-folder').value || null;
  const row = {
    owner_id: me.id,
    text: title,
    tag:    document.getElementById('nt-tag').value,
    scope:  document.getElementById('nt-scope').value,
    status: document.getElementById('nt-status').value,
    due_date: document.getElementById('nt-date').value || null,
    folder_id: folderVal,
    note: document.getElementById('nt-desc').value.trim(),
    attachments: [],
  };
  const { data, error } = await db.from('tasks').insert(row).select().single();
  if (error) { alert('Could not create task: ' + error.message); return; }
  myTasks.push(data);

  // Create any share rows for this task
  if (ntShareChips.length) {
    const shareRows = ntShareChips.map(c => ({
      owner_id: me.id,
      resource_type: 'task',
      resource_id: data.id,
      invited_email: c.email,
      permission: c.perm,
    }));
    const { error: shErr } = await db.from('shares').insert(shareRows);
    if (shErr) console.error('Share error:', shErr);
    else await loadMyShares();
  }

  document.getElementById('newtask-modal').classList.remove('open');
  renderBoard();

  // Offer to send invite emails for the people we just shared with
  if (ntShareChips.length) {
    const siteUrl = location.origin + location.pathname;
    ntShareChips.forEach(c => {
      // open one mail draft per person (most users share with 1)
    });
    const first = ntShareChips[0];
    const others = ntShareChips.length - 1;
    const subject = encodeURIComponent(`${me.name} shared a task with you on TaskFlow`);
    const body = encodeURIComponent(
      `Hi,\n\n${me.name} (${me.email}) shared the task "${title}" with you on TaskFlow.\n\n` +
      `You can ${first.perm === 'edit' ? 'view and edit' : 'view'} it here:\n${siteUrl}\n\n` +
      `Log in or sign up with this email (${first.email}) and it'll appear under "Shared with me".\n\n— TaskFlow`
    );
    if (confirm(`Task created and shared with ${ntShareChips.length} ${ntShareChips.length===1?'person':'people'}.\n\nOpen an email invite for ${first.email}${others>0?` (and ${others} more)`:''}?`)) {
      window.location.href = `mailto:${encodeURIComponent(first.email)}?subject=${subject}&body=${body}`;
    }
  }
}

// ════════════════════════════════════════════════════════════════════
//  TASK DETAIL
// ════════════════════════════════════════════════════════════════════
function openTaskDetail(id) {
  const t = findTask(id); if (!t) return;
  if (!t.attachments) t.attachments = [];
  editingTaskId = id;
  const canEdit = activeContext.kind !== 'shared' || activeContext.canEdit;

  const fo = '<option value="">No folder</option>' + myFolders.map(f=>`<option value="${f.id}" ${t.folder_id===f.id?'selected':''}>${esc(f.name)}</option>`).join('');
  const so = ['daily','weekly'].map(s=>`<option value="${s}" ${t.scope===s?'selected':''}>${s==='daily'?'Today':'This Week'}</option>`).join('');
  const to = Object.entries(tagMap).map(([k,v])=>`<option value="${k}" ${t.tag===k?'selected':''}>${v}</option>`).join('');
  const sto = ['todo','doing','done'].map(s=>`<option value="${s}" ${t.status===s?'selected':''}>${s==='todo'?'To Do':s==='doing'?'In Progress':'Done'}</option>`).join('');
  const dis = canEdit ? '' : 'disabled';

  // Hide folder selector when editing someone else's shared task
  const showFolder = activeContext.kind !== 'shared';

  document.getElementById('task-modal-title').textContent = canEdit ? 'Task Details' : 'Task (view only)';
  document.getElementById('task-share-btn').style.display = (activeContext.kind === 'shared') ? 'none' : 'flex';
  document.getElementById('task-save-btn').style.display = canEdit ? 'flex' : 'none';

  document.getElementById('task-detail-body').innerHTML = `
    <div class="detail-field"><label class="detail-label">Task</label><input type="text" class="modal-input" id="dt-text" value="${esc(t.text)}" ${dis} /></div>
    <div class="detail-row">
      <div class="detail-field"><label class="detail-label">Tag</label><select class="modal-input" id="dt-tag" ${dis}>${to}</select></div>
      <div class="detail-field"><label class="detail-label">Status</label><select class="modal-input" id="dt-status" ${dis}>${sto}</select></div>
    </div>
    <div class="detail-row">
      <div class="detail-field"><label class="detail-label">Scope</label><select class="modal-input" id="dt-scope" ${dis}>${so}</select></div>
      <div class="detail-field"><label class="detail-label">Date</label><input type="date" class="modal-input" id="dt-date" value="${t.due_date||''}" ${dis} /></div>
    </div>
    ${showFolder ? `<div class="detail-field"><label class="detail-label">Folder</label><select class="modal-input" id="dt-folder" ${dis}>${fo}</select></div>` : ''}
    <div class="detail-field"><label class="detail-label">Note</label><textarea class="modal-textarea" id="dt-note" style="min-height:90px;" ${dis}>${esc(t.note||'')}</textarea></div>
    <div class="detail-field">
      <label class="detail-label">Attachments</label>
      ${canEdit ? `
      <div class="attach-drop-zone" id="attach-drop-zone" onclick="document.getElementById('attach-file-input').click()">
        <i class="fa-solid fa-cloud-arrow-up" style="font-size:22px;color:var(--text-tertiary);display:block;margin-bottom:6px;"></i>
        <span style="font-size:13px;color:var(--text-secondary);">Click or drag files here</span>
        <span style="font-size:11px;color:var(--text-tertiary);margin-top:3px;display:block;">Max 2 MB per file</span>
      </div>
      <input type="file" id="attach-file-input" multiple style="display:none;" onchange="handleFileSelect(event)" />` : ''}
      <div id="attach-list"></div>
    </div>`;

  renderAttachList(t.attachments, canEdit);
  if (canEdit) setupDropZone();
  document.getElementById('task-modal').classList.add('open');
}
function closeTaskModal(e) {
  if (e && e.target !== document.getElementById('task-modal')) return;
  document.getElementById('task-modal').classList.remove('open');
}
async function saveTaskDetail() {
  const t = findTask(editingTaskId); if (!t) return;
  const patch = {
    text:   document.getElementById('dt-text').value.trim() || t.text,
    tag:    document.getElementById('dt-tag').value,
    status: document.getElementById('dt-status').value,
    scope:  document.getElementById('dt-scope').value,
    due_date: document.getElementById('dt-date').value || null,
    note:   document.getElementById('dt-note').value,
    attachments: t.attachments || [],
  };
  const folderSel = document.getElementById('dt-folder');
  if (folderSel) patch.folder_id = folderSel.value || null;

  const { error } = await db.from('tasks').update(patch).eq('id', editingTaskId);
  if (error) { alert('Could not save: ' + error.message); return; }
  Object.assign(t, patch);
  document.getElementById('task-modal').classList.remove('open');
  renderBoard();
}

// ── Attachments (stored as base64 JSON in the task row) ─────────────
function setupDropZone() {
  const zone = document.getElementById('attach-drop-zone'); if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); handleFiles(Array.from(e.dataTransfer.files)); });
}
function handleFileSelect(e) { handleFiles(Array.from(e.target.files)); e.target.value=''; }
function handleFiles(files) {
  const t = findTask(editingTaskId); if (!t) return;
  if (!t.attachments) t.attachments = [];
  const MAX = 2*1024*1024;
  Promise.all(files.map(file => new Promise(res => {
    if (file.size > MAX) { alert(`"${file.name}" exceeds 2 MB.`); res(null); return; }
    const r = new FileReader();
    r.onload = e => res({ id:'a'+Date.now()+Math.random().toString(36).slice(2), name:file.name, mime:file.type||'application/octet-stream', size:file.size, data:e.target.result });
    r.onerror = () => res(null);
    r.readAsDataURL(file);
  }))).then(async results => {
    results.filter(Boolean).forEach(a => t.attachments.push(a));
    await db.from('tasks').update({ attachments: t.attachments }).eq('id', t.id);
    renderAttachList(t.attachments, true);
    renderBoard();
  });
}
function renderAttachList(attachments, canEdit) {
  const el = document.getElementById('attach-list'); if (!el) return;
  if (!attachments || !attachments.length) { el.innerHTML=''; return; }
  el.innerHTML = attachments.map(a => {
    const ic = fileIcon(a.mime), co = fileIconColor(a.mime), isImg = a.mime && a.mime.startsWith('image/');
    return `<div class="attach-item">
      ${isImg ? `<img src="${a.data}" class="attach-thumb" alt="${esc(a.name)}" onclick="previewAttachment('${a.id}')" />` : `<div class="attach-icon-wrap" style="color:${co}"><i class="fa-solid ${ic}"></i></div>`}
      <div class="attach-info"><div class="attach-name">${esc(a.name)}</div><div class="attach-size">${formatBytes(a.size)}</div></div>
      <div class="attach-actions">
        <button class="attach-action-btn" onclick="downloadAttachment('${a.id}')" title="Download"><i class="fa-solid fa-download"></i></button>
        ${canEdit ? `<button class="attach-action-btn attach-del-btn" onclick="deleteAttachment('${a.id}')" title="Remove"><i class="fa-solid fa-xmark"></i></button>` : ''}
      </div>
    </div>`;
  }).join('');
}
async function deleteAttachment(aid) {
  const t = findTask(editingTaskId); if (!t) return;
  t.attachments = (t.attachments||[]).filter(a => a.id !== aid);
  await db.from('tasks').update({ attachments: t.attachments }).eq('id', t.id);
  renderAttachList(t.attachments, true);
  renderBoard();
}
function downloadAttachment(aid) {
  const t = findTask(editingTaskId); if (!t) return;
  const a = (t.attachments||[]).find(a => a.id === aid); if (!a) return;
  const link = document.createElement('a'); link.href = a.data; link.download = a.name; link.click();
}
function previewAttachment(aid) {
  const t = findTask(editingTaskId); if (!t) return;
  const a = (t.attachments||[]).find(a => a.id === aid); if (!a) return;
  document.getElementById('img-preview-el').src = a.data;
  document.getElementById('img-preview-name').textContent = a.name;
  document.getElementById('img-preview-overlay').classList.add('open');
}
function closeImgPreview(e) {
  if (e && e.target !== document.getElementById('img-preview-overlay') && !e.target.closest('.img-preview-close')) return;
  document.getElementById('img-preview-overlay').classList.remove('open');
}

// ════════════════════════════════════════════════════════════════════
//  NOTES
// ════════════════════════════════════════════════════════════════════
function renderNotes() {
  const grid = document.getElementById('notes-grid');
  if (!myNotes.length) { grid.innerHTML = '<div class="empty-notes"><i class="fa-regular fa-note-sticky" style="font-size:24px;display:block;margin-bottom:8px;"></i>No notes yet.</div>'; return; }
  grid.innerHTML = myNotes.map(n => `
    <div class="note-card" onclick="openNoteModal('${n.id}')">
      <div class="note-del" onclick="deleteNote(event,'${n.id}')" title="Delete"><i class="fa-solid fa-xmark"></i></div>
      <div class="note-accent"></div>
      <div class="note-card-title">${esc(n.title||'Untitled')}</div>
      <div class="note-card-body">${esc(n.body||'')}</div>
      <div class="note-card-date">${new Date(n.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
    </div>`).join('');
}
function openNoteModal(id) {
  editingNoteId = id || null;
  const n = id ? myNotes.find(n=>n.id===id) : null;
  document.getElementById('note-modal-title').textContent = n ? 'Edit Note' : 'New Note';
  document.getElementById('note-title-input').value = n?.title || '';
  document.getElementById('note-body-input').value  = n?.body  || '';
  document.getElementById('note-modal').classList.add('open');
  setTimeout(() => document.getElementById('note-title-input').focus(), 50);
}
function closeNoteModal(e) {
  if (e && e.target !== document.getElementById('note-modal')) return;
  document.getElementById('note-modal').classList.remove('open');
}
async function saveNote() {
  const title = document.getElementById('note-title-input').value.trim();
  const body  = document.getElementById('note-body-input').value.trim();
  if (!title && !body) return;
  if (editingNoteId) {
    await db.from('notes').update({ title, body }).eq('id', editingNoteId);
  } else {
    await db.from('notes').insert({ owner_id: me.id, title, body });
  }
  document.getElementById('note-modal').classList.remove('open');
  await loadNotes();
  renderNotes();
}
async function deleteNote(e, id) {
  e.stopPropagation();
  if (!confirm('Delete this note?')) return;
  await db.from('notes').delete().eq('id', id);
  myNotes = myNotes.filter(n => n.id !== id);
  renderNotes();
}

// ════════════════════════════════════════════════════════════════════
//  SHARING
// ════════════════════════════════════════════════════════════════════
function openShareHub(presetTaskId) {
  const ts = document.getElementById('share-task-select');
  ts.innerHTML = myTasks.length ? myTasks.map(t=>`<option value="${t.id}">${esc(t.text.slice(0,55))}</option>`).join('') : '<option disabled>No tasks yet</option>';
  const fs = document.getElementById('share-folder-select');
  fs.innerHTML = myFolders.length ? myFolders.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('') : '<option disabled>No folders yet</option>';

  document.getElementById('share-email-input').value = '';
  document.getElementById('share-result').style.display = 'none';
  document.querySelector('input[name="share-perm"][value="view"]').checked = true;

  if (presetTaskId) { switchShareTabByName('task'); ts.value = presetTaskId; }
  else { switchShareTabByName('task'); }

  refreshSharePeople();
  document.getElementById('share-hub-modal').classList.add('open');
}
function closeShareHub(e) {
  if (e && e.target !== document.getElementById('share-hub-modal')) return;
  document.getElementById('share-hub-modal').classList.remove('open');
}
function switchShareTab(tab, btn) {
  document.querySelectorAll('.share-tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  switchShareTabByName(tab, true);
}
function switchShareTabByName(tab, skipBtn) {
  shareTab = tab;
  if (!skipBtn) {
    document.querySelectorAll('.share-tab').forEach((t,i)=>t.classList.toggle('active',(i===0&&tab==='task')||(i===1&&tab==='folder')||(i===2&&tab==='board')));
  }
  document.querySelectorAll('.share-tab-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('share-panel-'+tab).classList.add('active');
  refreshSharePeople();
}

function quickShareTask(id, e) {
  if (e) e.stopPropagation();
  openShareHub(id);
}
function shareCurrentTask() {
  document.getElementById('task-modal').classList.remove('open');
  openShareHub(editingTaskId);
}

function currentShareTarget() {
  if (shareTab === 'task') {
    const id = document.getElementById('share-task-select').value;
    return { resource_type:'task', resource_id:id || null };
  }
  if (shareTab === 'folder') {
    const id = document.getElementById('share-folder-select').value;
    return { resource_type:'folder', resource_id:id || null };
  }
  return { resource_type:'board', resource_id:null };
}

async function submitShare() {
  const email = document.getElementById('share-email-input').value.trim().toLowerCase();
  const perm  = document.querySelector('input[name="share-perm"]:checked').value;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { alert('Please enter a valid email address.'); return; }
  if (email === me.email) { alert("That's your own email!"); return; }

  const target = currentShareTarget();
  if (target.resource_type !== 'board' && !target.resource_id) { alert('Please select something to share.'); return; }

  const btn = document.getElementById('share-submit-btn');
  const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = 'Sharing…';

  const { error } = await db.from('shares').insert({
    owner_id: me.id,
    resource_type: target.resource_type,
    resource_id: target.resource_id,
    invited_email: email,
    permission: perm,
  });

  btn.disabled = false; btn.innerHTML = orig;
  if (error) { alert('Could not share: ' + error.message); return; }

  // Build a friendly invite email and open the user's mail client
  const siteUrl = location.origin + location.pathname;
  const what = target.resource_type === 'task' ? 'a task'
             : target.resource_type === 'folder' ? 'a folder of tasks'
             : 'their task board';
  const subject = encodeURIComponent(`${me.name} shared ${what} with you on TaskFlow`);
  const body = encodeURIComponent(
    `Hi,\n\n${me.name} (${me.email}) has shared ${what} with you on TaskFlow.\n\n` +
    `You can ${perm === 'edit' ? 'view and edit' : 'view'} it here:\n${siteUrl}\n\n` +
    `Just log in or sign up using THIS email address (${email}) and it'll appear under "Shared with me".\n\n— TaskFlow`
  );

  const res = document.getElementById('share-result');
  res.style.display = 'block';
  res.innerHTML = `
    <div class="share-result-ok">
      <i class="fa-solid fa-circle-check"></i>
      Shared with <b>${esc(email)}</b> (${perm === 'edit' ? 'can edit' : 'view only'}).
    </div>
    <div style="font-size:12.5px;color:var(--text-secondary);margin:8px 0;">
      Click below to send them the invite email. They'll need to sign in with <b>${esc(email)}</b> to see it.
    </div>
    <a class="add-btn" style="text-decoration:none;display:inline-flex;" href="mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}">
      <i class="fa-solid fa-envelope"></i> Send Invite Email
    </a>`;

  document.getElementById('share-email-input').value = '';
  await loadMyShares();
  renderBoard();
  refreshSharePeople();
}

async function refreshSharePeople() {
  const list = document.getElementById('share-people-list');
  const target = currentShareTarget();
  let q = db.from('shares').select('*').eq('owner_id', me.id).eq('resource_type', target.resource_type);
  if (target.resource_id) q = q.eq('resource_id', target.resource_id);
  const { data, error } = await q;
  if (error) { list.innerHTML = ''; return; }
  const shares = data || [];
  if (!shares.length) { list.innerHTML = '<div style="font-size:12.5px;color:var(--text-tertiary);">No one yet.</div>'; return; }
  list.innerHTML = shares.map(s => `
    <div class="share-person-row">
      <div class="share-person-avatar">${(s.invited_email[0]||'?').toUpperCase()}</div>
      <div style="flex:1;min-width:0;">
        <div class="share-person-email">${esc(s.invited_email)}</div>
        <div class="share-person-perm">${s.permission === 'edit' ? 'Can view & edit' : 'View only'}</div>
      </div>
      <button class="share-person-remove" onclick="revokeShare('${s.id}')" title="Remove access"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
}

async function revokeShare(id) {
  if (!confirm('Remove this person\'s access?')) return;
  await db.from('shares').delete().eq('id', id);
  await loadMyShares();
  renderBoard();
  refreshSharePeople();
}

// ── Shared with me ──────────────────────────────────────────────────
function renderSharedList() {
  const el = document.getElementById('shared-list');
  if (!incomingShares.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary);padding:4px 10px;">Nothing shared yet</div>';
    return;
  }
  el.innerHTML = incomingShares.map((s, i) => {
    const icon = s.resource_type === 'board' ? 'fa-clipboard-list' : s.resource_type === 'folder' ? 'fa-folder-open' : 'fa-list-check';
    const label = s.resource_type === 'board' ? 'Shared board' : s.resource_type === 'folder' ? 'Shared folder' : 'Shared task';
    const permIcon = s.permission === 'edit' ? '<i class="fa-solid fa-pen" style="font-size:9px;opacity:0.6;"></i>' : '<i class="fa-solid fa-eye" style="font-size:9px;opacity:0.6;"></i>';
    return `<div class="shared-item" data-idx="${i}" onclick="openSharedContext(${i})">
      <i class="fa-solid ${icon}"></i>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${label}</span>
      ${permIcon}
    </div>`;
  }).join('');
}

async function openSharedContext(idx) {
  const share = incomingShares[idx];
  if (!share) return;

  // Fetch the tasks + folders visible via this share (RLS lets these through)
  let tasks = [];
  let folders = [];

  if (share.resource_type === 'task') {
    const { data } = await db.from('tasks').select('*').eq('id', share.resource_id);
    tasks = data || [];
  } else if (share.resource_type === 'folder') {
    const { data } = await db.from('tasks').select('*').eq('folder_id', share.resource_id);
    tasks = data || [];
    const { data: fd } = await db.from('folders').select('*').eq('id', share.resource_id);
    folders = fd || [];
  } else { // board
    const { data } = await db.from('tasks').select('*').eq('owner_id', share.owner_id);
    tasks = data || [];
    const { data: fd } = await db.from('folders').select('*').eq('owner_id', share.owner_id);
    folders = fd || [];
  }

  // owner display name
  let ownerName = 'Someone';
  const { data: prof } = await db.from('profiles').select('display_name,email').eq('id', share.owner_id).single();
  if (prof) ownerName = prof.display_name || prof.email;

  activeContext = { kind:'shared', share, tasks, folders, canEdit: share.permission === 'edit' };

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-board').classList.add('active');
  setActiveNav();
  document.querySelectorAll('.shared-item').forEach(s => s.classList.toggle('active', s.dataset.idx == idx));

  const typeLabel = share.resource_type === 'board' ? 'board' : share.resource_type === 'folder' ? 'folder' : 'task';
  document.getElementById('page-title').textContent = `${ownerName}'s ${typeLabel}`;
  document.getElementById('add-bar').style.display = 'none';
  document.getElementById('view-tabs').style.display = 'none';
  document.getElementById('share-topbar-btn').style.display = 'none';
  document.getElementById('newtask-topbar-btn').style.display = 'none';
  document.getElementById('topbar-search').style.display = 'flex';

  const banner = document.getElementById('shared-banner');
  banner.style.display = 'flex';
  banner.innerHTML = `
    <i class="fa-solid ${share.permission==='edit'?'fa-pen-to-square':'fa-eye'}"></i>
    <span>Shared by <b>${esc(ownerName)}</b> — you ${share.permission==='edit'?'can view &amp; edit':'have view-only access'}.</span>`;

  renderBoard();
}
