// Supabase Configuration
const SUPABASE_URL = 'https://vpdnmejmtedogsurjxrp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Zt_rd9RDVOhHFaJTZyoadw_W0f9TcWd';

// Initialize Supabase
let _supabaseLib = window.supabase;
window.supabase = _supabaseLib.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: true,
        storage: window.sessionStorage, // Only keep login for the current session (tab), don't remember the device.
        autoRefreshToken: true
    }
});

// --- Toast ---
function showToast(message, isError = false) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.background = isError
        ? 'linear-gradient(135deg, #ef4444, #b91c1c)'
        : 'linear-gradient(135deg, #6366f1, #a855f7)';
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 3500);
}

const ADMIN_EMAIL = 'admin@grieevio.com';

// --- Get Current User ---
async function getCurrentUser() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return null;

        const sessionEmail = session.user.email?.toLowerCase();

        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('auth_id', session.user.id)
            .maybeSingle();

        let user = data;

        // Fallback: match by email if auth_id not found
        if (error || !user) {
            const { data: byEmail } = await supabase
                .from('users')
                .select('*')
                .eq('email', sessionEmail)
                .maybeSingle();
            user = byEmail || null;
        }

        // If user record is missing, AUTO-CREATE it (Self-healing)
        if (!user) {
            console.log('User profile missing. Auto-creating for:', sessionEmail);
            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .insert([{
                    auth_id: session.user.id,
                    email: sessionEmail,
                    name: session.user.user_metadata?.full_name || 'GRIEEVIO User',
                    role: sessionEmail === ADMIN_EMAIL ? 'Admin' : 'Citizen'
                }])
                .select()
                .single();
            
            if (insertError) {
                console.error('Auto-create failed:', insertError);
                return null;
            }
            return newUser;
        }

        // Enforce: admin@grieevio.com MUST have Admin role
        const correctRole = sessionEmail === ADMIN_EMAIL ? 'Admin' : 'Citizen';
        if (user.role !== correctRole) {
            // Auto-fix role in DB silently
            await supabase.from('users').update({ role: correctRole }).eq('id', user.id);
            user.role = correctRole;
        }

        return user;
    } catch (e) {
        console.error('getCurrentUser error:', e);
        return null;
    }
}

// --- Logout ---
async function logout() {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', (e) => { e.preventDefault(); logout(); });
});
