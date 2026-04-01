document.addEventListener('DOMContentLoaded', async () => {
    const session = await checkSession();
    if (!session || !session.authenticated) {
        window.location.href = '/';
        return;
    }

    const sessionData = getSessionStorage();
    
    await verificarLicencia();
    
    setInterval(verificarLicencia, 60000);

    // Info del usuario la maneja sidebar.js

    if (sessionData.userRol !== 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    }

    await loadDashboard();
});

async function verificarLicencia() {
    try {
        const res = await fetch('/api/license/status');
        const data = await res.json();
        
        if (data.isOwner) return;
        
        const isTrial = data.type === 'trial';
        const isPaid = ['monthly', 'semiannual', 'annual'].includes(data.type);
        
        // Plan pagado activo → no hacer nada
        if (isPaid && data.valid) return;
        
        // Plan pagado expirado → no redirigir, el banner de license-banner.js lo maneja
        if (isPaid && !data.valid) return;
        
        // Trial con más de 5 días → no mostrar banner
        if (isTrial && data.valid && data.daysRemaining > 5) return;
        
        // Trial con ≤5 días → mostrar banner
        if (isTrial && data.valid && data.daysRemaining <= 5) {
            mostrarBannerPrueba(data.daysRemaining);
        }
        
        // Trial expirado → mostrar banner
        if (isTrial && !data.valid) {
            mostrarBannerPrueba(0);
        }
    } catch (e) {
        console.error('Error verificando licencia:', e);
    }
}

function mostrarBannerPrueba(dias) {
    let banner = document.getElementById('bannerPrueba');
    
    const bgColor = dias <= 0 ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' :
                    dias <= 2 ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' : 
                    dias <= 4 ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : 
                    'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)';
    
    const msg = dias <= 0 
        ? 'Tu período de prueba ha finalizado. <a href="/actualizar" style="color: white; text-decoration: underline; font-weight:700;">Activa una licencia</a>'
        : `Te quedan <strong>${dias} día${dias !== 1 ? 's' : ''}</strong> de prueba. <a href="/actualizar" style="color: white; text-decoration: underline;">${dias <= 2 ? 'Activa una licencia' : 'Ver planes'}</a>`;
    
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'bannerPrueba';
        banner.style.cssText = `
            color: white;
            padding: 0.75rem 1rem;
            text-align: center;
            font-size: 0.875rem;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        `;
        document.body.insertBefore(banner, document.body.firstChild);
    }
    
    banner.style.background = bgColor;
    banner.innerHTML = `
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
        <span>${msg}</span>
    `;
}

async function loadDashboard() {
    try {
        const data = await apiCall('/config/dashboard');
        
        if (data.caja_cerrada) {
            document.getElementById('alertaCajaCerradaDash').style.display = 'block';
        } else {
            document.getElementById('alertaCajaCerradaDash').style.display = 'none';
        }
        
        document.getElementById('ventasHoy').textContent = formatCurrency(data.hoy.ventas.total);
        document.getElementById('ventasCount').textContent = data.hoy.ventas.cantidad;
        document.getElementById('citasHoy').textContent = data.hoy.citas.cantidad;
        document.getElementById('clientesNuevos').textContent = data.hoy.clientesNuevos.cantidad;
        document.getElementById('totalClientes').textContent = data.resumen.totalClientes;
        document.getElementById('serviciosActivos').textContent = data.resumen.serviciosActivos;
        document.getElementById('categoriasActivas').textContent = data.resumen.categoriasActivas;

        renderCitasProximas(data.ultimasCitas, data.caja_cerrada);
    } catch (error) {
        console.error('Error cargando dashboard:', error);
    }
}

function renderCitasProximas(citas, cajaCerrada = false) {
    const container = document.getElementById('citasProximas');
    if (!container) return;

    if (cajaCerrada) {
        container.innerHTML = '<p class="text-muted">Panel bloqueado - Caja cerrada</p>';
        return;
    }

    if (citas.length === 0) {
        container.innerHTML = '<p class="text-muted">No hay citas próximas</p>';
        return;
    }

    container.innerHTML = citas.map(cita => `
        <div style="display: flex; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid var(--gray-100);">
            <div>
                <strong>${cita.cliente}</strong>
                <p class="text-muted" style="font-size: 0.75rem;">${cita.servicio}</p>
            </div>
            <div style="text-align: right;">
                <span class="badge badge-${getEstadoColor(cita.estado)}">${cita.estado}</span>
                <p class="text-muted" style="font-size: 0.75rem;">${formatDate(cita.fecha)} ${cita.hora_inicio}</p>
            </div>
        </div>
    `).join('');
}

async function logout() {
    try {
        await apiCall('/auth/logout', { method: 'POST' });
        clearSessionStorage();
        window.location.href = '/';
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
    }
}

function formatCurrency(amount) {
    return '$' + parseFloat(amount || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getEstadoColor(estado) {
    const colors = {
        pendiente: 'warning',
        confirmada: 'info',
        'en_proceso': 'primary',
        finalizada: 'success',
        cancelada: 'danger'
    };
    return colors[estado] || 'secondary';
}
