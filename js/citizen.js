// ═══════════════════════════════════════════
//  GRIEEVIO — citizen.js
// ═══════════════════════════════════════════
let currentUser = null;
let map = null, mapVoice = null;
let mapMarker = null, mapVoiceMarker = null;
let cameraStream = null, vCameraStream = null;
let selectedLang = '';
let voiceTranscript = '';
let persistentTranscript = '';
let recognition = null;
let isRecording = false;
let currentGeoCoords = null;   // text form coords
let vCurrentGeoCoords = null;  // voice form coords

// ─── NAV ───────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    currentUser = await getCurrentUser();
    if (!currentUser) { window.location.href = 'index.html'; return; }

    document.getElementById('welcomeText').textContent = `Welcome, ${currentUser.name}!`;
    loadStats();
    setupNav();
    setupCategoryTags();
    setupPriorityTags();
    setupVoiceTags();
    setupCamera();
    setupVoiceCamera();
    setupLangPills();
    setupVoiceRecorder();

    // Channel 1: Watch own complaint status changes
    supabase.channel('citizen-complaints')
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'complaints', filter: `user_id=eq.${currentUser.id}` },
            (payload) => {
                const c = payload.new;
                const statusEmoji = c.status === 'Resolved' ? '✅' : c.status === 'In Progress' ? '🔄' : '📋';
                showToast(`${statusEmoji} Your complaint status: ${c.status}`);
                loadStats();
                unreadNotifications++;
                updateNotifyBadge();
            }
        ).subscribe();

    // Channel 2: Watch admin-pushed update messages
    supabase.channel('citizen-updates')
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'updates' },
            (payload) => {
                const msg = payload.new?.message;
                if (msg) {
                    showToast(`🔔 ${msg.slice(0, 80)}`);
                    unreadNotifications++;
                    updateNotifyBadge();
                }
            }
        ).subscribe();
});

let unreadNotifications = 0;

function setupNav() {
    const views = { home: 'viewDashboard', new: 'viewNew', history: 'viewHistory', notify: 'viewNotify' };
    Object.keys(views).forEach(key => {
        document.getElementById('nav' + key.charAt(0).toUpperCase() + key.slice(1))
            .addEventListener('click', (e) => { e.preventDefault(); switchView(key, views); });
    });
}

function switchView(active, views) {
    Object.keys(views).forEach(k => {
        document.getElementById(views[k]).style.display = 'none';
        const sideLink = document.getElementById('nav' + k.charAt(0).toUpperCase() + k.slice(1));
        if (sideLink) sideLink.classList.remove('active');
    });
    
    document.getElementById(views[active]).style.display = 'block';
    const activeSideLink = document.getElementById('nav' + active.charAt(0).toUpperCase() + active.slice(1));
    if (activeSideLink) activeSideLink.classList.add('active');

    // Update Mobile Nav Active State
    const mobileLinks = document.querySelectorAll('.mobile-nav a');
    mobileLinks.forEach(link => {
        link.classList.remove('active');
        const text = link.textContent.toLowerCase();
        if ((active === 'home' && text.includes('home')) ||
            (active === 'new' && text.includes('report')) ||
            (active === 'history' && text.includes('history')) ||
            (active === 'notify' && text.includes('inbox'))) {
            link.classList.add('active');
        }
    });

    if (active === 'history') loadComplaints();
    if (active === 'notify') { unreadNotifications = 0; updateNotifyBadge(); loadNotifications(); }
    if (active !== 'new') { stopCamera(); }
    lucide.createIcons();
}

function updateNotifyBadge() {
    const b = document.getElementById('notifyBadge');
    b.style.display = unreadNotifications > 0 ? 'inline-flex' : 'none';
    b.textContent = unreadNotifications;
}

// ─── MODE SELECTOR ─────────────────────────
window.selectMode = function(mode) {
    document.getElementById('modeSelector').style.display = mode ? 'none' : 'grid';
    document.getElementById('textReportForm').style.display = mode === 'text' ? 'block' : 'none';
    document.getElementById('voiceReportForm').style.display = mode === 'voice' ? 'block' : 'none';

    if (mode === 'text' && !map) initMap('map',
        (lat, lng) => {
            document.getElementById('cLocation').value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            showGeoBadge('geoBadge', 'geoText', lat, lng);
            currentGeoCoords = { lat, lng };
        },
        (m) => { mapMarker = m; }, () => mapMarker
    );

    if (mode === 'voice') {
        document.getElementById('voiceAnalysisResult').style.display = 'block';
        voiceTranscript = '';
        persistentTranscript = '';
        document.getElementById('transcriptBox').textContent = 'Your speech will appear here in real time...';
        document.getElementById('transcriptBox').classList.add('empty');
        if (!mapVoice) {
            setTimeout(() => {
                initMap('mapVoice',
                    (lat, lng) => {
                        document.getElementById('voiceLocation').value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
                        showGeoBadge('vGeoBadge', 'vGeoText', lat, lng);
                        vCurrentGeoCoords = { lat, lng };
                    },
                    (m) => { mapVoiceMarker = m; }, () => mapVoiceMarker
                );
            }, 100);
        } else {
            setTimeout(() => mapVoice.invalidateSize(), 100);
        }
    }

    if (mode !== 'text') { stopCamera(); }
    if (mode !== 'voice') { stopVoiceCamera(); }
};

// ─── MAP ───────────────────────────────────
function initMap(elementId, onPin, setMarker, getMarker) {
    const m = L.map(elementId).setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19
    }).addTo(m);

    m.on('click', (e) => {
        const { lat, lng } = e.latlng;
        const existing = getMarker();
        if (existing) existing.setLatLng(e.latlng);
        else setMarker(L.marker(e.latlng).addTo(m));
        onPin(lat, lng);
    });

    const gpsBtnId = elementId === 'map' ? 'gpsBtn' : 'gpsBtnVoice';
    const gpsBtn = document.getElementById(gpsBtnId);
    if (gpsBtn) gpsBtn.addEventListener('click', () => {
        if (!navigator.geolocation) { showToast('Geolocation not supported', true); return; }
        navigator.geolocation.getCurrentPosition(pos => {
            const { latitude: lat, longitude: lng } = pos.coords;
            m.setView([lat, lng], 16);
            const ex = getMarker();
            if (ex) ex.setLatLng([lat, lng]); else setMarker(L.marker([lat, lng]).addTo(m));
            onPin(lat, lng);
            if (elementId === 'map') currentGeoCoords = { lat, lng };
            else vCurrentGeoCoords = { lat, lng };
            showToast('📍 Location detected!');
        }, () => showToast('GPS access denied', true));
    });

    if (elementId === 'map') map = m;
    else mapVoice = m;

    setTimeout(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(pos => {
                const { latitude: lat, longitude: lng } = pos.coords;
                m.setView([lat, lng], 14);
                const ex = getMarker();
                if (ex) ex.setLatLng([lat, lng]); else setMarker(L.marker([lat, lng]).addTo(m));
                onPin(lat, lng);
                if (elementId === 'map') currentGeoCoords = { lat, lng };
                else vCurrentGeoCoords = { lat, lng };
            });
        }
        m.invalidateSize();
    }, 200);
}

function showGeoBadge(badgeId, textId, lat, lng) {
    document.getElementById(badgeId).style.display = 'inline-flex';
    document.getElementById(textId).textContent = `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E`;
    lucide.createIcons();
}

// ─── VOICE CATEGORY & PRIORITY TAGS ─────────
function setupVoiceTags() {
    document.querySelectorAll('#vCategoryTags .category-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            document.querySelectorAll('#vCategoryTags .category-tag').forEach(t => t.classList.remove('active'));
            tag.classList.add('active');
            document.getElementById('vCategory').value = tag.dataset.value;
        });
    });
    document.querySelectorAll('#vPriorityTags .priority-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            document.querySelectorAll('#vPriorityTags .priority-tag').forEach(t => t.classList.remove('active'));
            tag.classList.add('active');
            document.getElementById('vPriority').value = tag.dataset.value;
        });
    });
}

// ─── VOICE CAMERA (separate stream) ──────────
function setupVoiceCamera() {
    document.getElementById('vOpenCameraBtn').addEventListener('click', async () => {
        try {
            vCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            document.getElementById('vCameraPreview').srcObject = vCameraStream;
            document.getElementById('vCameraContainer').style.display = 'block';
            document.getElementById('vCapturedImg').style.display = 'none';
            lucide.createIcons();
        } catch { showToast('Camera access denied', true); }
    });

    document.getElementById('vImageFile').addEventListener('change', (e) => {
        if (e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = document.getElementById('vCapturedImg');
                img.src = ev.target.result; img.style.display = 'block';
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    });

    document.getElementById('vSnapBtn').addEventListener('click', () => {
        const video = document.getElementById('vCameraPreview');
        const canvas = document.getElementById('vPhotoCanvas');
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);

        const geo = vCurrentGeoCoords || currentGeoCoords;
        if (geo) {
            const label = `\u{1F4CD} ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)} | ${new Date().toLocaleString()}`;
            ctx.font = 'bold 16px Arial';
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0, canvas.height - 36, canvas.width, 36);
            ctx.fillStyle = '#34d399';
            ctx.fillText(label, 10, canvas.height - 10);
            document.getElementById('vCapturedGeoBadge').style.display = 'inline-flex';
            document.getElementById('vCapturedGeoText').textContent = `${geo.lat.toFixed(4)}\u00B0N, ${geo.lng.toFixed(4)}\u00B0E`;
        }
        const img = document.getElementById('vCapturedImg');
        img.src = canvas.toDataURL('image/jpeg', 0.9); img.style.display = 'block';
        stopVoiceCamera(); lucide.createIcons();
    });
}

function stopVoiceCamera() {
    if (vCameraStream) { vCameraStream.getTracks().forEach(t => t.stop()); vCameraStream = null; }
    document.getElementById('vCameraContainer').style.display = 'none';
}

// ─── CATEGORY TAGS ─────────────────────────
function setupCategoryTags() {
    document.querySelectorAll('#categoryTags .category-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            document.querySelectorAll('#categoryTags .category-tag').forEach(t => t.classList.remove('active'));
            tag.classList.add('active');
            document.getElementById('cCategory').value = tag.dataset.value;
            autoSetPriority(tag.dataset.value);
        });
    });
}

function autoSetPriority(category) {
    const map = { Safety: 'Critical', Water: 'High', Roads: 'High', Electricity: 'Moderate', Garbage: 'Low', Other: 'Low' };
    const p = map[category] || 'Moderate';
    document.querySelectorAll('#priorityTags .priority-tag').forEach(t => {
        t.classList.toggle('active', t.dataset.value === p);
    });
    document.getElementById('cPriority').value = p;
}

// ─── PRIORITY TAGS ──────────────────────────
function setupPriorityTags() {
    document.querySelectorAll('#priorityTags .priority-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            document.querySelectorAll('#priorityTags .priority-tag').forEach(t => t.classList.remove('active'));
            tag.classList.add('active');
            document.getElementById('cPriority').value = tag.dataset.value;
        });
    });
}

// ─── CAMERA ────────────────────────────────
function setupCamera() {
    document.getElementById('openCameraBtn').addEventListener('click', async () => {
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            document.getElementById('cameraPreview').srcObject = cameraStream;
            document.getElementById('cameraContainer').style.display = 'block';
            document.getElementById('capturedImg').style.display = 'none';
            lucide.createIcons();
        } catch { showToast('Camera access denied', true); }
    });

    document.getElementById('cImageFile').addEventListener('change', (e) => {
        if (e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = document.getElementById('capturedImg');
                img.src = ev.target.result;
                img.style.display = 'block';
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    });

    document.getElementById('snapBtn').addEventListener('click', () => {
        const video = document.getElementById('cameraPreview');
        const canvas = document.getElementById('photoCanvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);

        // Geo-tag overlay
        if (currentGeoCoords) {
            const label = `📍 ${currentGeoCoords.lat.toFixed(4)}, ${currentGeoCoords.lng.toFixed(4)} | ${new Date().toLocaleString()}`;
            ctx.font = 'bold 18px Arial';
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0, canvas.height - 40, canvas.width, 40);
            ctx.fillStyle = '#34d399';
            ctx.fillText(label, 12, canvas.height - 12);

            document.getElementById('capturedGeoBadge').style.display = 'inline-flex';
            document.getElementById('capturedGeoText').textContent = `${currentGeoCoords.lat.toFixed(4)}°N, ${currentGeoCoords.lng.toFixed(4)}°E`;
        }

        const img = document.getElementById('capturedImg');
        img.src = canvas.toDataURL('image/jpeg', 0.9);
        img.style.display = 'block';
        stopCamera();
        lucide.createIcons();
    });
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    document.getElementById('cameraContainer').style.display = 'none';
}

// ─── LANGUAGE PILLS ────────────────────────
function setupLangPills() {
    document.querySelectorAll('#langPills .lang-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('#langPills .lang-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            selectedLang = pill.dataset.lang;
        });
    });
}

// ─── VOICE RECORDER ────────────────────────
function setupVoiceRecorder() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = document.getElementById('recordBtn');
    const statusEl = document.getElementById('recordStatus');
    const transcriptEl = document.getElementById('transcriptBox');
    const waveform = document.getElementById('waveform');
    const pulse = document.getElementById('pulseRing');

    if (!SpeechRecognition) {
        btn.disabled = true;
        statusEl.textContent = '⚠️ Speech recognition not supported in this browser. Use Chrome.';
        return;
    }

    btn.addEventListener('click', () => {
        if (!isRecording) startRecording();
        else stopRecording();
    });

    function startRecording() {
        if (!isRecording && !recognition) {
            persistentTranscript = voiceTranscript; // Preserve text if manual resume
        }

        recognition = new SpeechRecognition();
        if (selectedLang) {
            recognition.lang = selectedLang;
        }
        recognition.interimResults = true;
        recognition.continuous = true;

        recognition.onstart = () => {
            isRecording = true;
            btn.textContent = '⏹';
            btn.classList.add('recording');
            pulse.classList.add('recording');
            waveform.classList.add('active');
            statusEl.textContent = '🔴 Recording... speak now';
            transcriptEl.classList.remove('empty');
            // We don't clear voiceTranscript here so it survives auto-restarts
        };

        recognition.onresult = (e) => {
            let interim = '';
            let currentFinal = '';
            for (let i = 0; i < e.results.length; i++) {
                const t = e.results[i][0].transcript;
                if (e.results[i].isFinal) {
                    currentFinal += t + ' ';
                } else {
                    interim += t;
                }
            }
            // Overwrite using persistent text + current session final text
            voiceTranscript = persistentTranscript + ' ' + currentFinal;
            transcriptEl.textContent = voiceTranscript + (interim ? ' ' + interim + '...' : '');
        };

        recognition.onerror = (e) => {
            if (e.error !== 'no-speech') {
                showToast('Mic error: ' + e.error, true);
                stopRecording();
            }
        };

        recognition.onend = () => {
            if (isRecording) {
                // Keep alive on pause
                persistentTranscript = voiceTranscript;
                recognition.start(); 
            }
        };

        recognition.start();
    }

    function stopRecording() {
        isRecording = false;
        if (recognition) { recognition.stop(); recognition = null; }
        btn.textContent = '🎤';
        btn.classList.remove('recording');
        pulse.classList.remove('recording');
        waveform.classList.remove('active');
        statusEl.textContent = 'Tap to start recording';
        persistentTranscript = voiceTranscript;

        if (voiceTranscript.trim()) processVoiceTranscript(voiceTranscript);
        else showToast('No speech detected, try again.', true);
    }
}

function processVoiceTranscript(text) {
    const ai = mockAIAnalysis(text);
    const words = text.trim().split(' ');
    const autoTitle = words.slice(0, 8).join(' ') + (words.length > 8 ? '...' : '');

    document.getElementById('voiceCategory').textContent = `${getCategoryEmoji(ai.category)} ${ai.category}`;
    document.getElementById('voicePriority').innerHTML = getPriorityBadge(ai.priority);
    document.getElementById('voiceTitle').value = autoTitle;

    // Auto-select voice override tags
    document.querySelectorAll('#vCategoryTags .category-tag').forEach(t => t.classList.toggle('active', t.dataset.value === ai.category));
    document.getElementById('vCategory').value = ai.category;
    document.querySelectorAll('#vPriorityTags .priority-tag').forEach(t => t.classList.toggle('active', t.dataset.value === ai.priority));
    document.getElementById('vPriority').value = ai.priority;

    showToast('✅ Voice processed! Review details below.');
    lucide.createIcons();
}

// ─── TEXT FORM SUBMISSION ──────────────────
document.addEventListener('DOMContentLoaded', () => {
    // listen only after DOM is ready
    setTimeout(() => {
        const form = document.getElementById('complaintForm');
        if (form) form.addEventListener('submit', submitTextComplaint);

        const voiceBtn = document.getElementById('submitVoiceBtn');
        if (voiceBtn) voiceBtn.addEventListener('click', submitVoiceComplaint);

        // AI on desc blur
        const desc = document.getElementById('cDesc');
        if (desc) desc.addEventListener('blur', () => {
            if (desc.value.length > 10) {
                const ai = mockAIAnalysis(desc.value);
                const fb = document.getElementById('aiFeedback');
                fb.innerHTML = `<strong>🤖 AI:</strong> Detected as <b>${ai.category}</b> — Priority <b>${ai.priority}</b>`;
                fb.style.display = 'block';
                autoSetPriorityByValue(ai.priority);
                setCategoryByValue(ai.category);
            }
        });
    }, 500);
});

async function submitTextComplaint(e) {
    e.preventDefault();
    const btn = document.getElementById('submitComplaintBtn');
    btn.disabled = true;
    btn.innerHTML = '<span style="animation:spin 1s linear infinite; display:inline-block">⚙️</span> Submitting...';

    try {
        const capturedImg = document.getElementById('capturedImg');
        const imageUrl = capturedImg.style.display !== 'none' ? capturedImg.src : null;

        const { error } = await supabase.from('complaints').insert([{
            user_id: currentUser.id,
            title: document.getElementById('cTitle').value,
            description: document.getElementById('cDesc').value,
            category: document.getElementById('cCategory').value,
            priority: document.getElementById('cPriority').value,
            location: document.getElementById('cLocation').value,
            before_image_url: imageUrl || 'https://placehold.co/400x300/0f172a/6366f1?text=No+Image',
            status: 'Pending'
        }]);
        if (error) throw error;
        await addPoints(15);
        showToast('✅ Complaint submitted!');
        e.target.reset();
        document.getElementById('capturedImg').style.display = 'none';
        selectMode(null);
    } catch (err) { showToast(err.message, true); }
    finally { btn.disabled = false; btn.innerHTML = '<i data-lucide="send"></i> Submit Complaint'; lucide.createIcons(); }
}

async function submitVoiceComplaint() {
    const btn = document.getElementById('submitVoiceBtn');
    const loc = document.getElementById('voiceLocation').value;
    const title = document.getElementById('voiceTitle').value;
    const cat = document.getElementById('vCategory').value;
    const pri = document.getElementById('vPriority').value;

    if (!loc) { showToast('Please pin a location on the map', true); return; }
    if (!voiceTranscript) { showToast('No voice transcript found', true); return; }

    btn.disabled = true;
    btn.textContent = 'Submitting...';

    const vCaptured = document.getElementById('vCapturedImg');
    const imageUrl = vCaptured && vCaptured.style.display !== 'none'
        ? vCaptured.src
        : 'https://placehold.co/400x300/0f172a/6366f1?text=Voice+Complaint';

    try {
        const { error } = await supabase.from('complaints').insert([{
            user_id: currentUser.id,
            title: title || voiceTranscript.slice(0, 60),
            description: voiceTranscript,
            category: cat,
            priority: pri,
            location: loc,
            before_image_url: imageUrl,
            status: 'Pending'
        }]);
        if (error) throw error;
        await addPoints(15);
        showToast('✅ Voice complaint submitted!');
        voiceTranscript = '';
        persistentTranscript = '';
        document.getElementById('transcriptBox').textContent = 'Your speech will appear here...';
        document.getElementById('transcriptBox').classList.add('empty');
        selectMode(null);
    } catch (err) { showToast(err.message, true); }
    finally { btn.disabled = false; }
}

// ─── STATS ─────────────────────────────────
async function loadStats() {
    if (!currentUser) return;
    try {
        const { count } = await supabase.from('complaints').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id);
        const { count: resolved } = await supabase.from('complaints').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id).eq('status', 'Resolved');
        const { data: rewards } = await supabase.from('rewards').select('points').eq('user_id', currentUser.id).maybeSingle();
        const pts = rewards?.points || 0;
        document.getElementById('totalReports').textContent = count || 0;
        document.getElementById('resolvedReports').textContent = resolved || 0;
        document.getElementById('userPoints').textContent = pts;
        const ranks = [[0,'Active Citizen'],[50,'Top Reporter'],[200,'City Guardian'],[500,'Urban Hero']];
        document.getElementById('rankTitle').textContent = [...ranks].reverse().find(r => pts >= r[0])[1];
    } catch(e) { console.error(e); }
}

async function addPoints(amt) {
    const { data: ex } = await supabase.from('rewards').select('points').eq('user_id', currentUser.id).maybeSingle();
    if (ex) await supabase.from('rewards').update({ points: ex.points + amt }).eq('user_id', currentUser.id);
    else await supabase.from('rewards').insert([{ user_id: currentUser.id, points: amt }]);
}

// ─── HISTORY ───────────────────────────────
async function loadComplaints() {
    const grid = document.getElementById('complaintsGrid');
    grid.innerHTML = '<p style="color:var(--text-dim)">Loading...</p>';
    const { data, error } = await supabase.from('complaints').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
    if (error || !data?.length) { grid.innerHTML = '<p style="color:var(--text-dim)">No complaints yet.</p>'; return; }
    grid.innerHTML = '';
    data.forEach(item => {
        const card = document.createElement('div');
        card.className = 'complaint-card glass fade-in';
        const statusBadgeClass = item.status === 'Resolved' ? 'badge-resolved' : item.status === 'In Progress' ? 'badge-progress' : 'badge-pending';
        
        let imagesHtml = '';
        if (item.status === 'Resolved' && item.after_image_url) {
            imagesHtml = `
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
                    <div style="position:relative;"><img src="${item.before_image_url}" class="complaint-img" style="margin:0;"><span style="position:absolute; bottom:4px; left:4px; background:rgba(0,0,0,0.6); font-size:0.6rem; padding:2px 6px; border-radius:4px;">BEFORE</span></div>
                    <div style="position:relative;"><img src="${item.after_image_url}" class="complaint-img" style="margin:0;"><span style="position:absolute; bottom:4px; left:4px; background:var(--green); font-size:0.6rem; padding:2px 6px; border-radius:4px;">AFTER</span></div>
                </div>`;
        } else if (item.before_image_url) {
            imagesHtml = `<img src="${item.before_image_url}" class="complaint-img" onerror="this.style.display='none'">`;
        }

        card.innerHTML = `
            ${imagesHtml}
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
                <span class="badge ${statusBadgeClass}">${item.status}</span>
                <span class="badge" style="background:rgba(255,255,255,0.06); border:1px solid var(--glass-border);">${item.category}</span>
                <span class="priority-tag ${(item.priority||'Low').toLowerCase()}" style="cursor:default;">${getPriorityDot(item.priority)} ${item.priority}</span>
            </div>
            <h3 style="font-weight:700; font-size:1rem; margin-bottom:8px;">${item.title}</h3>
            <p style="color:var(--text-dim); font-size:0.85rem; line-height:1.5;">${item.description?.slice(0,120)}${item.description?.length > 120 ? '...' : ''}</p>
            ${item.admin_remarks ? `<div style="margin-top:12px; padding:12px; background:rgba(34,197,94,0.05); border-left:3px solid var(--green); font-size:0.8rem; border-radius:0 8px 8px 0;"><strong>Admin Remark:</strong> ${item.admin_remarks}</div>` : ''}
            <div style="font-size:0.75rem; color:var(--text-dim); margin-top:auto; padding-top:12px; border-top:1px solid var(--glass-border);">
                📍 ${item.location || 'Unknown'} &nbsp;|&nbsp; 📅 ${new Date(item.created_at).toLocaleDateString()}
            </div>`;
        grid.appendChild(card);
    });
}

// ─── NOTIFICATIONS ─────────────────────────
async function loadNotifications() {
    const list = document.getElementById('notifyList');
    const { data } = await supabase.from('updates').select('*, complaints(title)').order('created_at', { ascending: false }).limit(20);
    if (!data?.length) { list.innerHTML = '<p style="color:var(--text-dim)">No notifications.</p>'; return; }
    list.innerHTML = '';
    data.forEach(n => {
        const el = document.createElement('div');
        el.className = 'glass fade-in';
        el.style.padding = '20px 24px';
        el.innerHTML = `
            <div style="font-size:0.72rem; color:var(--green); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Status: ${n.status}</div>
            <div style="font-weight:700; margin-bottom:4px;">${n.complaints?.title || 'Complaint Update'}</div>
            <div style="color:var(--text-dim); font-size:0.85rem;">${n.message}</div>`;
        list.appendChild(el);
    });
}

// ─── AI HELPERS ────────────────────────────
function mockAIAnalysis(text) {
    const t = text.toLowerCase();
    let cat = 'Other', pri = 'Moderate';
    if (t.includes('water') || t.includes('pipe') || t.includes('leak')) { cat = 'Water'; pri = 'High'; }
    else if (t.includes('road') || t.includes('pothole') || t.includes('traffic')) { cat = 'Roads'; pri = 'High'; }
    else if (t.includes('garbage') || t.includes('trash') || t.includes('waste')) { cat = 'Garbage'; pri = 'Low'; }
    else if (t.includes('light') || t.includes('electricity') || t.includes('power')) { cat = 'Electricity'; pri = 'Moderate'; }
    else if (t.includes('harass') || t.includes('threat') || t.includes('danger') || t.includes('safety')) { cat = 'Safety'; pri = 'Critical'; }
    if (t.includes('urgent') || t.includes('emergency') || t.includes('severe')) pri = 'Critical';
    return { category: cat, priority: pri };
}

function autoSetPriorityByValue(p) {
    document.querySelectorAll('#priorityTags .priority-tag').forEach(t => t.classList.toggle('active', t.dataset.value === p));
    document.getElementById('cPriority').value = p;
}

function setCategoryByValue(c) {
    document.querySelectorAll('#categoryTags .category-tag').forEach(t => t.classList.toggle('active', t.dataset.value === c));
    document.getElementById('cCategory').value = c;
}

function getCategoryEmoji(cat) {
    return { Roads:'🚧', Water:'💧', Garbage:'🗑️', Electricity:'💡', Safety:'🚨', Other:'❓' }[cat] || '❓';
}

function getPriorityDot(p) {
    return { Critical:'🔴', High:'🟠', Moderate:'🟡', Low:'🟢' }[p] || '⚪';
}

function getPriorityBadge(p) {
    const colors = { Critical:'var(--red)', High:'var(--orange)', Moderate:'var(--yellow)', Low:'var(--green)' };
    return `<span style="color:${colors[p]||'#fff'}; font-weight:800;">${getPriorityDot(p)} ${p}</span>`;
}
