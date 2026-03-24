// Función global para mostrar banner de licencia
async function loadLicenseBanner() {
    try {
        const res = await fetch('/api/auth/license-info');
        if (!res.ok) return;
        
        const data = await res.json();
        
        // El propietario no ve banner de licencia
        if (data.isOwner || data.type === 'owner') {
            const banner = document.getElementById('licenseBanner');
            if (banner) banner.style.display = 'none';
            return;
        }
        
        // Buscar o crear el banner
        let banner = document.getElementById('licenseBanner');
        if (!banner) {
            // Crear banner si no existe
            banner = document.createElement('div');
            banner.id = 'licenseBanner';
            banner.style.cssText = 'padding: 1rem; border-radius: 0.75rem; margin-bottom: 1rem; text-align: center; font-weight: 600;';
            
            // Insertar al inicio del main content
            const main = document.querySelector('.main-content') || document.querySelector('main') || document.body;
            main.insertBefore(banner, main.firstChild);
        }
        
        if (!data.valid) {
            // Licencia expirada
            banner.style.display = 'block';
            banner.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
            banner.style.color = 'white';
            banner.innerHTML = '🔒 Tu período de prueba ha finalizado. <a href="/licencias" style="color: white; text-decoration: underline;">Activa una licencia</a> para continuar.';
            
            // Bloquear funcionalidad después de 3 segundos
            setTimeout(() => {
                if (window.location.pathname !== '/licencias') {
                    window.location.href = '/licencias';
                }
            }, 5000);
        } else if (data.daysRemaining <= 3) {
            // Quedan pocos días
            banner.style.display = 'block';
            banner.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
            banner.style.color = 'white';
            banner.innerHTML = '⚠️ Te quedan <strong>' + data.daysRemaining + ' días</strong> de prueba. <a href="/licencias" style="color: white; text-decoration: underline;">Activa una licencia</a>';
        } else if (data.daysRemaining <= 5) {
            // Quedan días moderados
            banner.style.display = 'block';
            banner.style.background = 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)';
            banner.style.color = 'white';
            banner.innerHTML = 'ℹ️ Te quedan <strong>' + data.daysRemaining + ' días</strong> de prueba.';
        } else {
            // Más de 5 días, no mostrar banner
            banner.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading license banner:', error);
    }
}

// Ejecutar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadLicenseBanner);
} else {
    loadLicenseBanner();
}
