// Función global para mostrar banner de licencia
async function loadLicenseBanner() {
    try {
        const res = await fetch('/api/auth/license-info');
        if (!res.ok) return;
        
        const data = await res.json();
        
        // Buscar o crear el banner
        let banner = document.getElementById('licenseBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'licenseBanner';
            banner.style.cssText = 'padding: 1rem; border-radius: 0.75rem; margin-bottom: 1rem; text-align: center; font-weight: 600;';
            
            const main = document.querySelector('.main-content') || document.querySelector('main') || document.body;
            main.insertBefore(banner, main.firstChild);
        }
        
        const isTrial = data.type === 'trial';
        const isPaid = ['monthly', 'semiannual', 'annual'].includes(data.type);
        
        // Plan pagado activo con más de 7 días → no mostrar nada
        if (isPaid && data.valid && data.daysRemaining > 7) {
            banner.style.display = 'none';
            return;
        }
        
        // Plan pagado por vencer (≤7 días)
        if (isPaid && data.valid && data.daysRemaining <= 7) {
            banner.style.display = 'block';
            banner.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
            banner.style.color = 'white';
            banner.innerHTML = '⚠️ Tu suscripción vence en <strong>' + data.daysRemaining + ' día' + (data.daysRemaining !== 1 ? 's' : '') + '</strong>. <a href="/actualizar" style="color: white; text-decoration: underline; font-weight:700;">Renovar ahora</a>';
            return;
        }
        
        // Plan pagado expirado
        if (isPaid && !data.valid) {
            banner.style.display = 'block';
            banner.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
            banner.style.color = 'white';
            banner.innerHTML = '🔴 Tu suscripción ha expirado. <a href="/actualizar" style="color: white; text-decoration: underline; font-weight:700;">Renovar licencia</a> para continuar.';
            return;
        }
        
        // Trial expirado
        if (isTrial && !data.valid) {
            banner.style.display = 'block';
            banner.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
            banner.style.color = 'white';
            banner.innerHTML = '⚠️ Tu período de prueba ha finalizado. <a href="/actualizar" style="color: white; text-decoration: underline; font-weight:700;">Activa una licencia</a> para continuar sin restricciones.';
            return;
        }
        
        // Trial con días restantes
        if (isTrial && data.valid) {
            const d = data.daysRemaining;
            
            if (d <= 3) {
                banner.style.display = 'block';
                banner.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
                banner.style.color = 'white';
                banner.innerHTML = '⚠️ Te quedan <strong>' + d + ' día' + (d !== 1 ? 's' : '') + '</strong> de prueba. <a href="/actualizar" style="color: white; text-decoration: underline; font-weight:700;">Activa una licencia</a>';
            } else if (d <= 5) {
                banner.style.display = 'block';
                banner.style.background = 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)';
                banner.style.color = 'white';
                banner.innerHTML = 'ℹ️ Te quedan <strong>' + d + ' días</strong> de prueba. <a href="/actualizar" style="color: white; text-decoration: underline;">Ver planes</a>';
            } else {
                // Más de 5 días de trial → no mostrar
                banner.style.display = 'none';
            }
            return;
        }
        
        // Fallback: ocultar
        banner.style.display = 'none';
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
