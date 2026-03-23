document.addEventListener('DOMContentLoaded', async () => {
    const session = await checkSession();
    if (session && session.authenticated) {
        window.location.href = '/dashboard';
        return;
    }

    const loginForm = document.getElementById('loginForm');
    
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                const data = await apiCall('/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({ email, password })
                });

                setSessionStorage(data);
                window.location.href = '/dashboard';
            } catch (error) {
                showAlert(error.message);
            }
        });
    }
});
