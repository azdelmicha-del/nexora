document.addEventListener('DOMContentLoaded', async () => {
    const session = await checkSession();
    if (session && session.authenticated) {
        window.location.href = '/dashboard';
        return;
    }

    const registerForm = document.getElementById('registerForm');
    
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const nombreNegocio = document.getElementById('nombreNegocio').value;
            const nombreAdmin = document.getElementById('nombreAdmin').value;
            const telefono = document.getElementById('telefono').value;
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            if (password !== confirmPassword) {
                showAlert('Las contraseñas no coinciden');
                return;
            }

            if (password.length < 8) {
                showAlert('La contraseña debe tener al menos 8 caracteres');
                return;
            }

            try {
                const data = await apiCall('/auth/registrar', {
                    method: 'POST',
                    body: JSON.stringify({ nombreNegocio, nombreAdmin, telefono, email, password })
                });

                setSessionStorage(data);
                window.location.href = '/dashboard';
            } catch (error) {
                showAlert(error.message);
            }
        });
    }
});
