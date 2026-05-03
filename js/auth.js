document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');

    // Handle Login
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            const btn = document.getElementById('loginBtn');

            btn.textContent = 'Signing in...';
            btn.disabled = true;

            const { data, error } = await supabase.auth.signInWithPassword({ email, password });

            if (error) {
                showToast(error.message, true);
                btn.textContent = 'Sign In';
                btn.disabled = false;
            } else {
                showToast('Welcome back!');
                setTimeout(() => checkUserRoleAndRedirect(), 800);
            }
        });
    }

    // Handle Signup
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('signupName').value.trim();
            const email = document.getElementById('signupEmail').value.trim().toLowerCase();
            const password = document.getElementById('signupPassword').value;
            const btn = document.getElementById('signupBtn');

            // Only admin@grieevio.com gets Admin role
            const ADMIN_EMAIL = 'admin@grieevio.com';
            const role = (email === ADMIN_EMAIL) ? 'Admin' : 'Citizen';

            btn.textContent = 'Creating account...';
            btn.disabled = true;

            try {
                const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
                if (authError) throw authError;

                if (authData.user) {
                    const { error: dbError } = await supabase.from('users').insert([{
                        auth_id: authData.user.id,
                        name: name,
                        email: email,
                        role: role
                    }]);

                    if (dbError) {
                        showToast('Profile setup failed: ' + dbError.message, true);
                    } else if (authData.session) {
                        showToast(role === 'Admin' ? '👑 Admin access granted!' : '🎉 Welcome to GRIEEVIO!');
                        setTimeout(() => checkUserRoleAndRedirect(), 1000);
                    } else {
                        showToast('Account created! Check your email to verify.');
                        btn.textContent = '📧 Check Your Email';
                    }
                }
            } catch (err) {
                showToast(err.message || 'Signup failed.', true);
                btn.textContent = 'Create Account';
                btn.disabled = false;
            }
        });
    }

    // Auto-redirect removed as per user request (Don't remember device/Direct login only)
});

async function checkUserRoleAndRedirect() {
    try {
        const user = await getCurrentUser();
        if (user) {
            window.location.href = user.role === 'Admin' ? 'admin.html' : 'dashboard.html';
        } else {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) window.location.href = 'dashboard.html';
        }
    } catch (err) {
        console.error('Redirect error:', err);
    }
}
