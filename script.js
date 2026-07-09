// ═══════════════════════════════════════════════════════
//  CALIO — script.js
// ═══════════════════════════════════════════════════════

let supabaseClient = null;
let currentUserId  = null;
let userProfile    = {};
let currentDate    = new Date();
currentDate.setHours(0,0,0,0);

let selectedImage   = null;  // base64 string (no prefix)
let selectedMime    = 'image/jpeg';
let selectedMeal    = 'breakfast';
let todayLogs       = [];

const authScreen      = document.getElementById('auth-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const loginError      = document.getElementById('login-error');
const signupError     = document.getElementById('signup-error');

// ── Toast ─────────────────────────────────────────────
function showToast(message, type = 'info', duration = 3200) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✅', error: '❌', info: '⚡' };
    toast.innerHTML = `<span>${icons[type] || '💬'}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('out');
        setTimeout(() => toast.remove(), 280);
    }, duration);
}

// ── Theme ─────────────────────────────────────────────
function applyTheme(primary, secondary, bg, card, text, muted) {
    const root = document.documentElement;
    root.style.setProperty('--accent',       primary);
    root.style.setProperty('--accent-hover', secondary);
    root.style.setProperty('--accent-lt',    hexToRgba(primary, 0.12));
    root.style.setProperty('--bg',           bg   || '#f5f1eb');
    root.style.setProperty('--card',         card || '#ffffff');
    root.style.setProperty('--card2',        lighten(card || '#ffffff', -6));
    root.style.setProperty('--border',       lighten(card || '#ffffff', -12));
    if (text) root.style.setProperty('--text',  text);
    if (muted) root.style.setProperty('--muted', muted);
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function lighten(hex, amt) {
    // crude lighten/darken
    try {
        let r = parseInt(hex.slice(1,3),16) + amt;
        let g = parseInt(hex.slice(3,5),16) + amt;
        let b = parseInt(hex.slice(5,7),16) + amt;
        r = Math.max(0, Math.min(255, r));
        g = Math.max(0, Math.min(255, g));
        b = Math.max(0, Math.min(255, b));
        return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    } catch { return hex; }
}

function markThemeSwatch(primary) {
    document.querySelectorAll('.theme-swatch').forEach(s => {
        s.classList.toggle('selected', s.dataset.primary === primary);
    });
}

document.getElementById('theme-picker').addEventListener('click', e => {
    const btn = e.target.closest('.theme-swatch');
    if (!btn) return;
    applyTheme(btn.dataset.primary, btn.dataset.secondary, btn.dataset.bg, btn.dataset.card, btn.dataset.text, btn.dataset.muted);
    markThemeSwatch(btn.dataset.primary);
    // Persist in userProfile memory (saved when user hits Save profile)
    userProfile.theme_primary   = btn.dataset.primary;
    userProfile.theme_secondary = btn.dataset.secondary;
    userProfile.theme_bg        = btn.dataset.bg;
    userProfile.theme_card      = btn.dataset.card;
});

// ── Init ─────────────────────────────────────────────
async function initApp() {
    try {
        const res    = await fetch('/api/config');
        const config = await res.json();
        const { createClient } = supabase;
        supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey);

        const hash = window.location.hash;
        if (hash && hash.includes('access_token')) {
            await supabaseClient.auth.getSessionFromUrl({ reloadSession: true });
            window.history.replaceState(null, '', window.location.pathname);
        }

        supabaseClient.auth.onAuthStateChange((_event, session) => {
            if (session?.user) { currentUserId = session.user.id; showDashboard(session.user); }
            else               { currentUserId = null; showAuth(); }
        });

        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session?.user) { currentUserId = session.user.id; showDashboard(session.user); }
        else showAuth();

        checkPasswordResetFlow();
    } catch (err) { console.error('initApp:', err); }
}

// ── Auth ─────────────────────────────────────────────
function switchAuthTab(tab) {
    document.getElementById('tab-login').classList.toggle('active',  tab === 'login');
    document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
    document.getElementById('login-form').classList.toggle('hidden',  tab !== 'login');
    document.getElementById('signup-form').classList.toggle('hidden', tab !== 'signup');
    loginError.textContent = ''; signupError.textContent = '';
}

document.getElementById('login-btn').addEventListener('click', async () => {
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    loginError.textContent = '';
    if (!email || !password) { loginError.textContent = 'Please fill in all fields.'; return; }
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) loginError.textContent = error.message;
});

document.getElementById('signup-btn').addEventListener('click', async () => {
    const first    = document.getElementById('signup-first').value.trim();
    const last     = document.getElementById('signup-last').value.trim();
    const email    = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    signupError.textContent = '';
    if (!email || !password) { signupError.textContent = 'Email and password are required.'; return; }
    if (password.length < 6) { signupError.textContent = 'Password must be at least 6 characters.'; return; }

    const btn = document.getElementById('signup-btn');
    btn.disabled = true; btn.textContent = 'Creating account…';

    // Always attempt signUp first, then immediately sign in to bypass email confirm
    const { data, error } = await supabaseClient.auth.signUp({
        email, password,
        options: { data: { first_name: first, last_name: last } }
    });

    const alreadyExists = (error && error.message.toLowerCase().includes('already registered'))
        || (data?.user && !data?.session);

    if (error && !alreadyExists) {
        signupError.textContent = error.message;
        btn.disabled = false; btn.textContent = 'Create account';
        return;
    }

    // Whether new or existing account, sign in directly so no email confirm needed
    const { error: loginErr } = await supabaseClient.auth.signInWithPassword({ email, password });
    btn.disabled = false; btn.textContent = 'Create account';
    if (loginErr) {
        if (alreadyExists) {
            signupError.textContent = 'Account already exists. Try logging in instead.';
            switchAuthTab('login');
            document.getElementById('login-email').value = email;
        } else {
            signupError.textContent = loginErr.message;
        }
    }
    // onAuthStateChange will handle the redirect into the dashboard
});

// ── Forgot password ───────────────────────────────────
function showForgotPassword() {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('forgot-form').classList.remove('hidden');
    document.getElementById('auth-tabs').classList.add('hidden');
    document.getElementById('forgot-email-input').value = document.getElementById('login-email').value;
    document.getElementById('forgot-msg').textContent = '';
}
function hideForgotPassword() {
    document.getElementById('forgot-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('auth-tabs').classList.remove('hidden');
}

document.getElementById('forgot-link').addEventListener('click', e => { e.preventDefault(); showForgotPassword(); });
document.getElementById('forgot-back-btn').addEventListener('click', hideForgotPassword);

document.getElementById('forgot-send-btn').addEventListener('click', async () => {
    const email = document.getElementById('forgot-email-input').value.trim();
    const msg   = document.getElementById('forgot-msg');
    const btn   = document.getElementById('forgot-send-btn');
    if (!email) { msg.style.color = 'var(--danger)'; msg.textContent = 'Please enter your email address.'; return; }

    btn.disabled = true; btn.textContent = 'Sending…';
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/?reset=true'
    });
    btn.disabled = false; btn.textContent = 'Send reset email';

    if (error) {
        msg.style.color = 'var(--danger)';
        msg.textContent = error.message;
    } else {
        msg.style.color = 'var(--green)';
        msg.textContent = '✅ Reset email sent! Check your inbox and follow the link to set a new password.';
        btn.disabled = true;
    }
});

// Handle password reset redirect (user clicked link in email)
async function checkPasswordResetFlow() {
    const params = new URLSearchParams(window.location.search);
    const hash   = window.location.hash;
    // Supabase puts the token in the hash as #access_token=...&type=recovery
    if (hash.includes('type=recovery') || params.get('reset') === 'true') {
        // Let onAuthStateChange handle the session, then show reset UI
        supabaseClient.auth.onAuthStateChange(async (event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
                window.history.replaceState(null, '', window.location.pathname);
                showPasswordResetModal();
            }
        });
    }
}

function showPasswordResetModal() {
    const modal = document.getElementById('password-reset-modal');
    modal.classList.remove('hidden');
}

document.getElementById('save-new-password-btn')?.addEventListener('click', async () => {
    const pw  = document.getElementById('new-password-input').value;
    const msg = document.getElementById('reset-modal-msg');
    if (!pw || pw.length < 6) { msg.style.color='var(--danger)'; msg.textContent='Password must be at least 6 characters.'; return; }

    const { error } = await supabaseClient.auth.updateUser({ password: pw });
    if (error) {
        msg.style.color = 'var(--danger)'; msg.textContent = error.message;
    } else {
        msg.style.color = 'var(--green)'; msg.textContent = '✅ Password updated! You are now signed in.';
        setTimeout(() => document.getElementById('password-reset-modal').classList.add('hidden'), 2000);
    }
});

async function googleOAuth() {
    const { error } = await supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/' } });
    if (error) console.error('Google OAuth:', error.message);
}
document.getElementById('google-login-btn').addEventListener('click',  googleOAuth);
document.getElementById('google-signup-btn').addEventListener('click', googleOAuth);

function showAuth() { authScreen.classList.remove('hidden'); dashboardScreen.classList.add('hidden'); }

async function showDashboard(user) {
    authScreen.classList.add('hidden'); dashboardScreen.classList.remove('hidden');
    await loadProfile();
    updateDateUI();
    await loadTodayLogs();
}

// ── Sign-out ──────────────────────────────────────────
document.getElementById('signout-btn').addEventListener('click', () => {
    document.getElementById('signout-modal').classList.remove('hidden');
});
document.getElementById('cancel-signout-btn').addEventListener('click', () => {
    document.getElementById('signout-modal').classList.add('hidden');
});
document.getElementById('confirm-signout-btn').addEventListener('click', async () => {
    document.getElementById('signout-modal').classList.add('hidden');
    await supabaseClient.auth.signOut();
});

// ── Reset account ─────────────────────────────────────
document.getElementById('reset-account-btn').addEventListener('click', () => {
    document.getElementById('reset-account-modal').classList.remove('hidden');
});
document.getElementById('cancel-reset-btn').addEventListener('click', () => {
    document.getElementById('reset-account-modal').classList.add('hidden');
});
document.getElementById('confirm-reset-btn').addEventListener('click', async () => {
    document.getElementById('reset-account-modal').classList.add('hidden');
    if (!currentUserId) return;
    try {
        showToast('Resetting account…', 'info', 2000);
        await fetch('/api/reset-account', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUserId })
        });
        userProfile = {};
        todayLogs   = [];
        document.getElementById('p-name').value      = '';
        document.getElementById('p-age').value       = '';
        document.getElementById('p-weight').value    = '';
        document.getElementById('p-height').value    = '';
        document.getElementById('p-cal-goal').value  = '';
        document.getElementById('p-diet-type').value = '';
        document.getElementById('p-diet-notes').value = '';
        document.getElementById('profile-avatar').textContent = '?';
        updateRingAndMacros([]);
        renderTodayLog([]);
        showToast('Account reset! Fresh start.', 'success');
        switchTab('today');
    } catch (e) { console.error(e); showToast('Reset failed', 'error'); }
});

// ── Tab switching ─────────────────────────────────────
function switchTab(tab) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById(tab + '-tab').classList.add('active');
    document.getElementById('nav-' + tab).classList.add('active');
    if (tab === 'history') loadHistory();
}

// ── Date navigation ───────────────────────────────────
function dateKey(d) {
    return d.toISOString().split('T')[0];
}
function isToday(d) {
    const t = new Date(); t.setHours(0,0,0,0);
    return d.getTime() === t.getTime();
}
function updateDateUI() {
    const heading = document.getElementById('date-heading');
    const sub     = document.getElementById('date-subheading');
    if (isToday(currentDate)) {
        heading.textContent = 'Today';
    } else {
        heading.textContent = currentDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    }
    sub.textContent = currentDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

document.getElementById('date-prev').addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() - 1);
    updateDateUI(); loadTodayLogs(); resetScanZone();
});
document.getElementById('date-next').addEventListener('click', () => {
    const tomorrow = new Date(); tomorrow.setHours(0,0,0,0); tomorrow.setDate(tomorrow.getDate() + 1);
    if (currentDate >= tomorrow) return;
    currentDate.setDate(currentDate.getDate() + 1);
    updateDateUI(); loadTodayLogs(); resetScanZone();
});
document.getElementById('date-today').addEventListener('click', () => {
    currentDate = new Date(); currentDate.setHours(0,0,0,0);
    updateDateUI(); loadTodayLogs(); resetScanZone();
});

// ── Meal label chips ──────────────────────────────────
document.querySelectorAll('.meal-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        document.querySelectorAll('.meal-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedMeal = chip.dataset.val;
    });
});

// ── Scan zone / image handling ────────────────────────
const scanZone    = document.getElementById('scan-zone');
const fileInput   = document.getElementById('file-input');
const previewWrap = document.getElementById('preview-wrap');
const previewImg  = document.getElementById('preview-img');
const previewActions = document.getElementById('preview-actions');
const analyseBtn  = document.getElementById('analyse-btn');
const retakeBtn   = document.getElementById('retake-btn');
const resultWrap  = document.getElementById('result-wrap');

scanZone.addEventListener('click', () => fileInput.click());
scanZone.addEventListener('dragover', e => { e.preventDefault(); scanZone.classList.add('drag-over'); });
scanZone.addEventListener('dragleave', () => scanZone.classList.remove('drag-over'));
scanZone.addEventListener('drop', e => {
    e.preventDefault(); scanZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
});

fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

function handleFile(file) {
    if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); return; }
    selectedMime = file.type;
    const reader = new FileReader();
    reader.onload = e => {
        const dataUrl = e.target.result;
        // Strip the data:...;base64, prefix
        selectedImage = dataUrl.split(',')[1];
        previewImg.src = dataUrl;
        scanZone.classList.add('hidden');
        previewWrap.classList.remove('hidden');
        previewActions.classList.remove('hidden');
        resultWrap.classList.add('hidden');
        resultWrap.innerHTML = '';
    };
    reader.readAsDataURL(file);
}

retakeBtn.addEventListener('click', resetScanZone);

function resetScanZone() {
    selectedImage = null;
    fileInput.value = '';
    previewImg.src = '';
    scanZone.classList.remove('hidden');
    previewWrap.classList.add('hidden');
    previewActions.classList.add('hidden');
    resultWrap.classList.add('hidden');
    resultWrap.innerHTML = '';
}

// ── Analyse ───────────────────────────────────────────
analyseBtn.addEventListener('click', analyseImage);

async function analyseImage() {
    if (!selectedImage || !currentUserId) return;

    const overlay = document.getElementById('analysing-overlay');
    const txt     = document.getElementById('analysing-text');
    const phrases = ['Analysing your meal…', 'Counting calories…', 'Checking macros…', 'Almost there…'];
    let pi = 0;
    overlay.classList.remove('hidden');
    const phraseInterval = setInterval(() => {
        pi = (pi + 1) % phrases.length;
        txt.textContent = phrases[pi];
    }, 1800);

    analyseBtn.disabled = true;

    try {
        const res  = await fetch('/api/analyse', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId:     currentUserId,
                image:      selectedImage,
                mimeType:   selectedMime,
                mealLabel:  selectedMeal
            })
        });
        const data = await res.json();

        clearInterval(phraseInterval);
        overlay.classList.add('hidden');
        analyseBtn.disabled = false;

        if (data.error) { showToast('Analysis failed: ' + data.error, 'error'); return; }

        renderResult(data.nutrition);
        await loadTodayLogs();
        resetScanZone();
    } catch (e) {
        clearInterval(phraseInterval);
        overlay.classList.add('hidden');
        analyseBtn.disabled = false;
        showToast('Connection error — try again', 'error');
        console.error(e);
    }
}

// ── Render result card ────────────────────────────────
function renderResult(n) {
    const confEmoji = { high: '🟢', medium: '🟡', low: '🔴' }[n.confidence] || '🟡';
    const itemsHtml = (n.items || []).map(it =>
        `<div class="result-item-row">
            <span class="result-item-name">${it.name}</span>
            <div class="result-item-right">
                <span>${it.amount || ''}</span>
                <span>${it.calories} kcal</span>
            </div>
        </div>`
    ).join('');

    resultWrap.innerHTML = `
        <div class="result-card">
            <div class="result-header">
                <div class="result-dish">${n.dish}</div>
                <div class="result-serving">${n.servingNote || ''}</div>
                <div class="result-confidence">${confEmoji} ${n.confidence} confidence</div>
                <div class="result-cal-big">${n.calories} <span>kcal</span></div>
            </div>
            <div class="result-macros">
                <div class="result-macro-cell"><div class="rmc-val">${n.protein_g}g</div><div class="rmc-lbl">Protein</div></div>
                <div class="result-macro-cell"><div class="rmc-val">${n.carbs_g}g</div><div class="rmc-lbl">Carbs</div></div>
                <div class="result-macro-cell"><div class="rmc-val">${n.fat_g}g</div><div class="rmc-lbl">Fat</div></div>
            </div>
            <div class="result-macros" style="border-top:1px solid var(--border);">
                <div class="result-macro-cell"><div class="rmc-val">${n.fiber_g || 0}g</div><div class="rmc-lbl">Fiber</div></div>
                <div class="result-macro-cell"><div class="rmc-val">${n.sugar_g || 0}g</div><div class="rmc-lbl">Sugar</div></div>
                <div class="result-macro-cell"><div class="rmc-val">${n.sodium_mg || 0}mg</div><div class="rmc-lbl">Sodium</div></div>
            </div>
            ${itemsHtml ? `<div class="result-items">${itemsHtml}</div>` : ''}
            ${n.tip ? `<div class="result-tip">💡 ${n.tip}</div>` : ''}
        </div>`;
    resultWrap.classList.remove('hidden');
    resultWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    showToast(`${n.dish} logged — ${n.calories} kcal`, 'success');
}

// ── Today logs ────────────────────────────────────────
async function loadTodayLogs() {
    if (!currentUserId) return;
    try {
        const dateStr = dateKey(currentDate);
        const res  = await fetch(`/api/logs/${currentUserId}?date=${dateStr}`);
        todayLogs  = await res.json();
        renderTodayLog(todayLogs);
        updateRingAndMacros(todayLogs);
    } catch (e) { console.error('loadTodayLogs:', e); }
}

function renderTodayLog(logs) {
    const list = document.getElementById('today-log-list');
    if (!logs.length) {
        list.innerHTML = `<div class="empty-state"><div class="es-icon">🍽️</div>No meals logged yet.<br>Snap a photo above to get started!</div>`;
        return;
    }
    list.innerHTML = logs.map(log => {
        const time = new Date(log.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const macroStr = `${log.protein_g}g P · ${log.carbs_g}g C · ${log.fat_g}g F`;
        return `<div class="log-entry">
            <div class="log-entry-left">
                <div class="log-dish">${log.dish}</div>
                <div class="log-meta">${macroStr} · ${time}</div>
            </div>
            <div class="log-entry-right">
                <span class="log-meal-badge">${log.meal_label}</span>
                <span class="log-cal">${log.calories} kcal</span>
                <button class="log-delete" onclick="deleteLog('${log.id}')" title="Delete">🗑</button>
            </div>
        </div>`;
    }).join('');
}

async function deleteLog(id) {
    try {
        await fetch(`/api/logs/${id}`, { method: 'DELETE' });
        await loadTodayLogs();
        showToast('Entry removed', 'info');
    } catch (e) { showToast('Failed to delete', 'error'); }
}

// ── Ring + macros ─────────────────────────────────────
function updateRingAndMacros(logs) {
    const totalCal  = logs.reduce((a, l) => a + (l.calories  || 0), 0);
    const totalProt = logs.reduce((a, l) => a + (l.protein_g || 0), 0);
    const totalCarb = logs.reduce((a, l) => a + (l.carbs_g   || 0), 0);
    const totalFat  = logs.reduce((a, l) => a + (l.fat_g     || 0), 0);

    const goal = parseInt(userProfile.calorie_goal) || 2000;
    const pct  = Math.min(totalCal / goal, 1);
    const circ = 2 * Math.PI * 66; // 414.69
    const offset = circ - pct * circ;

    document.getElementById('ring-cal-num').textContent  = totalCal;
    document.getElementById('ring-cal-goal').textContent = `/ ${goal} kcal`;
    document.getElementById('cal-ring').style.strokeDashoffset = offset;
    // Colour ring red if over goal
    document.getElementById('cal-ring').style.stroke = totalCal > goal ? '#ef4444' : 'var(--accent)';

    document.getElementById('mac-protein').textContent = totalProt + 'g';
    document.getElementById('mac-carbs').textContent   = totalCarb + 'g';
    document.getElementById('mac-fat').textContent     = totalFat  + 'g';

    // Bars (rough % of daily targets: protein 25%, carbs 50%, fat 25% of goal cals)
    const protTarget = goal * 0.25 / 4;   // g (4 kcal/g)
    const carbTarget = goal * 0.50 / 4;
    const fatTarget  = goal * 0.25 / 9;   // g (9 kcal/g)
    document.getElementById('bar-protein').style.width = Math.min(totalProt / protTarget * 100, 100) + '%';
    document.getElementById('bar-carbs').style.width   = Math.min(totalCarb / carbTarget * 100, 100) + '%';
    document.getElementById('bar-fat').style.width     = Math.min(totalFat  / fatTarget  * 100, 100) + '%';
}

// ── History ───────────────────────────────────────────
async function loadHistory() {
    if (!currentUserId) return;
    try {
        const res  = await fetch(`/api/logs/history/${currentUserId}`);
        const rows = await res.json();
        buildHistoryUI(rows);
    } catch (e) { console.error('loadHistory:', e); }
}

function buildHistoryUI(rows) {
    // Aggregate by date
    const byDate = {};
    rows.forEach(r => {
        const d = r.created_at.split('T')[0];
        if (!byDate[d]) byDate[d] = { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
        byDate[d].calories += r.calories || 0;
        byDate[d].protein  += r.protein_g || 0;
        byDate[d].carbs    += r.carbs_g   || 0;
        byDate[d].fat      += r.fat_g     || 0;
        byDate[d].count++;
    });

    // Last 7 days
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
        days.push(d.toISOString().split('T')[0]);
    }

    // Stats
    const calValues = days.map(d => byDate[d]?.calories || 0);
    const daysWithData = calValues.filter(v => v > 0);
    const avgCal = daysWithData.length ? Math.round(daysWithData.reduce((a,b)=>a+b,0)/daysWithData.length) : 0;
    const totalLogs = rows.length;
    const streak = computeStreak(byDate);

    document.getElementById('h-avg-cal').textContent   = avgCal || '—';
    document.getElementById('h-total-logs').textContent = totalLogs;
    document.getElementById('h-streak').textContent     = streak;

    // Bar chart
    const maxCal = Math.max(...calValues, 1);
    const dayLabels = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    const chart = document.getElementById('history-bar-chart');
    chart.innerHTML = days.map((d, i) => {
        const cal  = byDate[d]?.calories || 0;
        const pct  = (cal / maxCal) * 100;
        const dt   = new Date(d + 'T12:00:00');
        const lbl  = dayLabels[dt.getDay()];
        const isT  = d === new Date().toISOString().split('T')[0];
        return `<div class="bar-col">
            <div class="bar-fill ${cal===0?'empty':''}" style="height:${Math.max(pct,3)}%;${isT?'background:var(--accent-hover);':''}"></div>
            <div class="bar-lbl" style="${isT?'color:var(--accent);font-weight:700;':''}">${lbl}</div>
            <div class="bar-val">${cal||''}</div>
        </div>`;
    }).join('');

    // Daily list
    const list = document.getElementById('history-list');
    const sortedDays = [...days].reverse().filter(d => byDate[d]);
    if (!sortedDays.length) {
        list.innerHTML = `<div class="empty-state"><div class="es-icon">📊</div>No data yet. Start logging meals!</div>`;
        return;
    }
    list.innerHTML = sortedDays.map(d => {
        const info = byDate[d];
        const label = d === new Date().toISOString().split('T')[0] ? 'Today' :
            new Date(d+'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        return `<div class="history-log-item">
            <div class="hli-left">
                <div class="hli-date">${label}</div>
                <div class="hli-meals">${info.count} meal${info.count!==1?'s':''} · P:${Math.round(info.protein)}g C:${Math.round(info.carbs)}g F:${Math.round(info.fat)}g</div>
            </div>
            <div class="hli-cal">${info.calories} kcal</div>
        </div>`;
    }).join('');
}

function computeStreak(byDate) {
    let streak = 0;
    const today = new Date(); today.setHours(0,0,0,0);
    for (let i = 0; i <= 365; i++) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        if (byDate[key] && byDate[key].calories > 0) streak++;
        else if (i > 0) break;
    }
    return streak;
}

// ── Profile ───────────────────────────────────────────
function updateAvatar(name) {
    const el = document.getElementById('profile-avatar');
    if (!el || !name) return;
    const parts = name.trim().split(' ');
    const initials = parts.length >= 2
        ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase()
        : name.slice(0,2).toUpperCase();
    el.textContent = initials;
}

async function loadProfile() {
    if (!currentUserId) return;
    try {
        const res  = await fetch(`/api/profile/${currentUserId}`);
        const data = await res.json();
        if (data && data.user_id) {
            userProfile = data;
            document.getElementById('p-name').value      = data.name       || '';
            document.getElementById('p-age').value       = data.age        || '';
            document.getElementById('p-weight').value    = data.weight_kg  || '';
            document.getElementById('p-height').value    = data.height_cm  || '';
            document.getElementById('p-cal-goal').value  = data.calorie_goal || '';
            document.getElementById('p-diet-type').value = data.diet_type  || '';
            document.getElementById('p-diet-notes').value = data.diet_notes || '';
            if (data.name) updateAvatar(data.name);
            if (data.theme_primary) {
                applyTheme(data.theme_primary, data.theme_secondary, data.theme_bg, data.theme_card, data.theme_text, data.theme_muted);
                markThemeSwatch(data.theme_primary);
            }
        }
    } catch (e) { console.error('loadProfile:', e); }
}

document.getElementById('save-profile-btn').addEventListener('click', async () => {
    if (!currentUserId) return;
    const name = document.getElementById('p-name').value.trim();
    const profile = {
        userId:          currentUserId,
        name,
        age:             parseInt(document.getElementById('p-age').value)    || null,
        weight_kg:       parseFloat(document.getElementById('p-weight').value) || null,
        height_cm:       parseFloat(document.getElementById('p-height').value) || null,
        calorie_goal:    parseInt(document.getElementById('p-cal-goal').value) || null,
        diet_type:       document.getElementById('p-diet-type').value,
        diet_notes:      document.getElementById('p-diet-notes').value.trim(),
        theme_primary:   userProfile.theme_primary   || null,
        theme_secondary: userProfile.theme_secondary || null,
        theme_bg:        userProfile.theme_bg        || null,
        theme_card:      userProfile.theme_card      || null,
    };
    try {
        await fetch('/api/profile', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profile)
        });
        userProfile = { ...userProfile, ...profile };
        if (name) updateAvatar(name);
        updateRingAndMacros(todayLogs);
        showToast('Profile saved!', 'success');
    } catch (e) { showToast('Failed to save profile', 'error'); }
});

// ── Boot ──────────────────────────────────────────────
initApp();
