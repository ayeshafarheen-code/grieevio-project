// ══════════════════════════════════════════
//  GRIEEVIO — admin.js  (full featured)
// ══════════════════════════════════════════
let adminUser = null;
let allComplaints = [];

document.addEventListener('DOMContentLoaded', async () => {
    adminUser = await getCurrentUser();
    if (!adminUser || adminUser.role !== 'Admin') {
        window.location.href = 'index.html';
        return;
    }

    // Show admin info in settings
    const nameEl = document.getElementById('adminName');
    const emailEl = document.getElementById('adminEmail');
    if (nameEl) nameEl.textContent = adminUser.name || 'Admin';
    if (emailEl) emailEl.textContent = adminUser.email;
    const nameInput = document.getElementById('settingName');
    if (nameInput) nameInput.value = adminUser.name || '';

    setupNav();
    loadOverview();
    setupFilters();
    subscribeRealtime();
});

// ─── NAVIGATION ────────────────────────────
function setupNav() {
    const views = {
        Overview: 'viewOverview',
        Complaints: 'viewComplaints',
        Analytics: 'viewAnalytics',
        Settings: 'viewSettings'
    };
    Object.keys(views).forEach(key => {
        document.getElementById('nav' + key).addEventListener('click', (e) => {
            e.preventDefault();
            Object.keys(views).forEach(k => {
                document.getElementById(views[k]).style.display = 'none';
                document.getElementById('nav' + k).classList.remove('active');
            });
            document.getElementById(views[key]).style.display = 'block';
            document.getElementById('nav' + key).classList.add('active');
            if (key === 'Overview') loadOverview();
            if (key === 'Complaints') loadAllComplaints();
            if (key === 'Analytics') loadAnalytics();
            lucide.createIcons();
        });
    });
}

// ─── SUPABASE REALTIME ─────────────────────
function subscribeRealtime() {
    supabase.channel('admin-live')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'complaints' }, (payload) => {
            showToast(`📣 New complaint: "${payload.new.title?.slice(0,30)}..."`);
            loadOverview();
            if (document.getElementById('viewComplaints').style.display !== 'none') loadAllComplaints();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'complaints' }, (payload) => {
            showToast(`🔄 Updated: "${payload.new.title?.slice(0,25)}..." → ${payload.new.status}`);
            loadOverview();
            if (document.getElementById('viewComplaints').style.display !== 'none') loadAllComplaints();
        })
        .subscribe();
}

// ─── LOAD DATA ─────────────────────────────
async function fetchComplaints() {
    const { data, error } = await supabase
        .from('complaints')
        .select('*, users(name, email)')
        .order('created_at', { ascending: false });
    if (error) { console.error(error); return []; }
    allComplaints = data || [];
    return allComplaints;
}

// ─── OVERVIEW ──────────────────────────────
async function loadOverview() {
    const data = await fetchComplaints();
    const total = data.length;
    const pending = data.filter(d => d.status === 'Pending').length;
    const inprog = data.filter(d => d.status === 'In Progress').length;
    const resolved = data.filter(d => d.status === 'Resolved').length;

    setText('statTotal', total);
    setText('statPending', pending);
    setText('statProgress', inprog);
    setText('statResolved', resolved);

    // Recent 5 in table
    const tbody = document.getElementById('overviewTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    data.slice(0, 5).forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div style="font-weight:600;">${c.users?.name || 'Unknown'}</div><div style="font-size:0.72rem;color:var(--text-dim);">${c.users?.email || ''}</div></td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.title}</td>
            <td>${statusBadge(c.status)}</td>`;
        tbody.appendChild(tr);
    });

    // Activity feed (last 6 updates)
    const feed = document.getElementById('activityFeed');
    if (!feed) return;
    feed.innerHTML = '';
    data.slice(0, 6).forEach(c => {
        const dotColor = c.status === 'Resolved' ? 'var(--green)' : c.status === 'In Progress' ? 'var(--accent)' : 'var(--yellow)';
        const el = document.createElement('div');
        el.className = 'activity-item';
        el.innerHTML = `
            <div class="activity-dot" style="background:${dotColor};"></div>
            <div>
                <div style="font-weight:600; font-size:0.88rem;">${c.title?.slice(0, 45)}</div>
                <div style="color:var(--text-dim); font-size:0.76rem; margin-top:2px;">${c.users?.name || 'Citizen'} · ${new Date(c.created_at).toLocaleDateString()} · ${c.status}</div>
            </div>`;
        feed.appendChild(el);
    });
    lucide.createIcons();
}

// ─── COMPLAINTS ────────────────────────────
window.loadAllComplaints = async function() {
    await fetchComplaints();
    renderComplaintsTable(allComplaints);
};

function setupFilters() {
    ['searchInput', 'filterStatus', 'filterCategory', 'filterPriority'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', applyFilters);
    });
}

function applyFilters() {
    const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const status = document.getElementById('filterStatus')?.value || '';
    const cat = document.getElementById('filterCategory')?.value || '';
    const pri = document.getElementById('filterPriority')?.value || '';

    const filtered = allComplaints.filter(c => {
        const matchSearch = !search || c.title?.toLowerCase().includes(search) || c.users?.name?.toLowerCase().includes(search);
        const matchStatus = !status || c.status === status;
        const matchCat = !cat || c.category === cat;
        const matchPri = !pri || c.priority === pri;
        return matchSearch && matchStatus && matchCat && matchPri;
    });
    renderComplaintsTable(filtered);
}

function renderComplaintsTable(data) {
    const tbody = document.getElementById('complaintsTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-dim);">No complaints found.</td></tr>';
        return;
    }
    data.forEach(c => {
        const tr = document.createElement('tr');
        const priColor = { Critical:'var(--red)', High:'var(--orange)', Moderate:'var(--yellow)', Low:'var(--green)' }[c.priority] || '#fff';
        let actions = '';
        if (c.status === 'Pending') {
            actions = `<button class="action-btn" style="color:var(--accent); border-color:var(--accent);" onclick="updateStatus('${c.id}','In Progress')">▶ Start</button>`;
        } else if (c.status === 'In Progress') {
            actions = `<button class="action-btn" style="color:var(--green); border-color:var(--green);" onclick="openResolveModal('${c.id}')">✓ Resolve</button>`;
        } else {
            actions = `<span style="color:var(--text-dim); font-size:0.8rem;">✓ Done</span>`;
        }
        tr.innerHTML = `
            <td><div style="font-weight:600;">${c.users?.name || '—'}</div><div style="font-size:0.72rem;color:var(--text-dim);">${c.users?.email || ''}</div></td>
            <td><div style="font-weight:600; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${c.title}</div><div style="font-size:0.72rem;color:var(--text-dim);">${c.location || ''}</div></td>
            <td><span style="background:rgba(255,255,255,0.06); border:1px solid var(--glass-border); padding:4px 10px; border-radius:20px; font-size:0.75rem;">${c.category || '—'}</span></td>
            <td><span style="color:${priColor}; font-weight:700; font-size:0.8rem;">${getPriorityDot(c.priority)} ${c.priority || '—'}</span></td>
            <td>${statusBadge(c.status)}</td>
            <td style="color:var(--text-dim); font-size:0.8rem;">${new Date(c.created_at).toLocaleDateString()}</td>
            <td>${actions}</td>`;
        tbody.appendChild(tr);
    });
    lucide.createIcons();
}

// ─── ANALYTICS ─────────────────────────────
async function loadAnalytics() {
    const data = await fetchComplaints();
    const total = data.length || 1;

    // Category chart
    const cats = ['Roads', 'Water', 'Garbage', 'Electricity', 'Safety', 'Other'];
    const catColors = ['#6366f1', '#22d3ee', '#34d399', '#fbbf24', '#f87171', '#a78bfa'];
    const catChart = document.getElementById('categoryChart');
    if (catChart) {
        catChart.innerHTML = cats.map((cat, i) => {
            const count = data.filter(d => d.category === cat).length;
            const pct = Math.round((count / total) * 100);
            return `<div style="margin-bottom:16px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:0.85rem;">
                    <span style="font-weight:600;">${cat}</span>
                    <span style="color:var(--text-dim);">${count} (${pct}%)</span>
                </div>
                <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${catColors[i]};"></div></div>
            </div>`;
        }).join('');
    }

    // Priority chart
    const pris = ['Critical', 'High', 'Moderate', 'Low'];
    const priColors = ['var(--red)', 'var(--orange)', 'var(--yellow)', 'var(--green)'];
    const priChart = document.getElementById('priorityChart');
    if (priChart) {
        priChart.innerHTML = pris.map((p, i) => {
            const count = data.filter(d => d.priority === p).length;
            const pct = Math.round((count / total) * 100);
            return `<div style="margin-bottom:16px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:0.85rem;">
                    <span style="font-weight:600;">${getPriorityDot(p)} ${p}</span>
                    <span style="color:var(--text-dim);">${count} (${pct}%)</span>
                </div>
                <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${priColors[i]};"></div></div>
            </div>`;
        }).join('');
    }

    // Resolution stats
    const resolved = data.filter(d => d.status === 'Resolved').length;
    const inprog = data.filter(d => d.status === 'In Progress').length;
    const pending = data.filter(d => d.status === 'Pending').length;
    const resEl = document.getElementById('resolutionStats');
    if (resEl) {
        resEl.innerHTML = [
            { label: 'Resolution Rate', value: `${Math.round((resolved / total) * 100)}%`, color: 'var(--green)' },
            { label: 'In Progress Rate', value: `${Math.round((inprog / total) * 100)}%`, color: 'var(--accent)' },
            { label: 'Backlog Rate', value: `${Math.round((pending / total) * 100)}%`, color: 'var(--yellow)' },
        ].map(s => `
            <div style="text-align:center;">
                <div style="font-size:3rem; font-weight:800; color:${s.color}; margin-bottom:8px;">${s.value}</div>
                <div style="color:var(--text-dim); font-size:0.85rem;">${s.label}</div>
            </div>`).join('');
    }
    lucide.createIcons();
}

// ─── SETTINGS ──────────────────────────────
window.saveProfile = async function() {
    const name = document.getElementById('settingName')?.value.trim();
    if (!name) { showToast('Name cannot be empty', true); return; }
    const { error } = await supabase.from('users').update({ name }).eq('id', adminUser.id);
    if (error) showToast(error.message, true);
    else { showToast('✅ Profile saved!'); document.getElementById('adminName').textContent = name; }
};

window.exportData = async function() {
    const data = await fetchComplaints();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'grieevio_complaints.json'; a.click();
    showToast('📦 Data exported!');
};

window.confirmClear = async function() {
    if (!confirm('Are you sure? This will permanently delete all RESOLVED complaints.')) return;
    const { error } = await supabase.from('complaints').delete().eq('status', 'Resolved');
    if (error) showToast(error.message, true);
    else { showToast('🗑️ Resolved complaints cleared.'); loadOverview(); }
};

// ─── STATUS UPDATE → NOTIFIES CITIZEN ──────
window.updateStatus = async function(id, newStatus) {
    try {
        const complaint = allComplaints.find(c => c.id === id);
        const { error } = await supabase.from('complaints')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;

        // Push real-time notification to citizen via updates table
        await supabase.from('updates').insert([{
            complaint_id: id,
            status: newStatus,
            message: `Your complaint "${complaint?.title?.slice(0,50)}" has been updated to: ${newStatus}`
        }]);
        showToast(`✅ Status → ${newStatus}`);
        loadAllComplaints();
    } catch (err) { showToast(err.message, true); }
};

// ─── RESOLVE MODAL ─────────────────────────
window.openResolveModal = function(id) {
    document.getElementById('resolveId').value = id;
    document.getElementById('resolveModal').classList.add('open');
    lucide.createIcons();
};

window.closeResolveModal = function() {
    document.getElementById('resolveModal').classList.remove('open');
    document.getElementById('resolveRemarks').value = '';
};

window.submitResolve = async function() {
    const id = document.getElementById('resolveId').value;
    const remarks = document.getElementById('resolveRemarks').value.trim();
    const fileInput = document.getElementById('resolveImage');
    const btn = document.getElementById('confirmResolveBtn');

    if (!remarks) { showToast('Please add closing remarks', true); return; }

    btn.disabled = true;
    btn.textContent = '⚙️ Verifying Evidence...';

    // Handle image upload (Base64 for this version)
    let afterImageUrl = null;
    if (fileInput.files && fileInput.files[0]) {
        afterImageUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(fileInput.files[0]);
        });
    }

    // Simulate AI verification delay (2s)
    await new Promise(r => setTimeout(r, 1500));

    try {
        const complaint = allComplaints.find(c => c.id === id);
        const { error } = await supabase.from('complaints').update({
            status: 'Resolved',
            admin_remarks: remarks,
            after_image_url: afterImageUrl,
            updated_at: new Date().toISOString()
        }).eq('id', id);
        if (error) throw error;

        // Real-time push to citizen
        await supabase.from('updates').insert([{
            complaint_id: id,
            status: 'Resolved',
            message: `✅ Resolved! "${complaint?.title?.slice(0,35)}..." remarks: ${remarks}`
        }]);

        showToast('✅ Resolved! Citizen notified.');
        closeResolveModal();
        loadAllComplaints();
        loadOverview();
    } catch (err) { showToast(err.message, true); }
    finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="check-circle"></i> Verify & Resolve';
        lucide.createIcons();
    }
};

// ─── HELPERS ───────────────────────────────
function statusBadge(status) {
    const map = {
        'Pending': 'badge-pending',
        'In Progress': 'badge-progress',
        'Resolved': 'badge-resolved'
    };
    return `<span class="badge ${map[status] || ''}">${status}</span>`;
}

function getPriorityDot(p) {
    return { Critical: '🔴', High: '🟠', Moderate: '🟡', Low: '🟢' }[p] || '⚪';
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
