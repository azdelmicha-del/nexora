const API_BASE = '/api';

async function apiCall(endpoint, options = {}) {
    const config = {
        headers: {
            'Content-Type': 'application/json'
        },
        ...options
    };

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, config);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error en la solicitud');
        }

        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

let toastContainer = null;

function initToastContainer() {
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
}

function showToast(message, type = 'error', title = null, duration = 4000) {
    initToastContainer();
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
        success: '<svg width="20" height="20" fill="none" stroke="var(--secondary)" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>',
        error: '<svg width="20" height="20" fill="none" stroke="var(--danger)" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>',
        warning: '<svg width="20" height="20" fill="none" stroke="var(--warning)" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>',
        info: '<svg width="20" height="20" fill="none" stroke="var(--primary)" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
    };
    
    const titles = {
        success: 'Éxito',
        error: 'Error',
        warning: 'Advertencia',
        info: 'Información'
    };
    
    toast.innerHTML = `
        <div class="toast-icon">${icons[type]}</div>
        <div class="toast-content">
            <div class="toast-title">${title || titles[type]}</div>
            ${message ? `<div class="toast-message">${message}</div>` : ''}
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
    `;
    
    toastContainer.appendChild(toast);
    
    if (duration > 0) {
        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
}

function showAlert(message, type = 'error') {
    showToast(message, type);
}

function showLoading(element) {
    if (!element) return null;
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = '<div class="spinner spinner-sm"></div>';
    element.style.position = 'relative';
    element.appendChild(overlay);
    return overlay;
}

function hideLoading(overlay) {
    if (overlay && overlay.parentElement) {
        overlay.remove();
    }
}

function getSkeletonHTML(type = 'table', count = 5) {
    if (type === 'table') {
        return Array(count).fill(0).map(() => `
            <tr>
                <td><div class="skeleton skeleton-text medium"></div></td>
                <td><div class="skeleton skeleton-text short"></div></td>
                <td><div class="skeleton skeleton-text short"></div></td>
                <td><div class="skeleton skeleton-text medium"></div></td>
            </tr>
        `).join('');
    }
    if (type === 'cards') {
        return Array(count).fill(0).map(() => `
            <div class="card">
                <div class="skeleton skeleton-card"></div>
            </div>
        `).join('');
    }
    return '<div class="spinner"></div>';
}

function getEmptyStateHTML(icon, title, message, actionText = null, actionOnClick = null) {
    return `
        <div class="empty-state">
            ${icon}
            <h4>${title}</h4>
            ${message ? `<p>${message}</p>` : ''}
            ${actionText ? `<button class="btn btn-primary" onclick="${actionOnClick}">${actionText}</button>` : ''}
        </div>
    `;
}

function getEmptyTableHTML(message, colspan = 5) {
    return `<tr><td colspan="${colspan}" class="text-center text-muted" style="padding: 3rem;">${message}</td></tr>`;
}

function validateField(input, validator) {
    const value = input.value.trim();
    const result = validator(value);
    
    const existingError = input.parentElement.querySelector('.field-error');
    if (existingError) existingError.remove();
    
    input.classList.remove('invalid', 'valid');
    
    if (result !== true) {
        input.classList.add('invalid');
        if (typeof result === 'string') {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'field-error';
            errorDiv.textContent = result;
            input.parentElement.appendChild(errorDiv);
        }
        return false;
    }
    
    if (value) {
        input.classList.add('valid');
    }
    return true;
}

const validators = {
    required: (value) => value ? true : 'Este campo es requerido',
    email: (value) => {
        if (!value) return true;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || 'Correo electrónico inválido';
    },
    phone: (value) => {
        if (!value) return true;
        return /^[\d\s\-\+]{8,}$/.test(value) || 'Teléfono inválido';
    },
    positiveNumber: (value) => {
        if (!value) return true;
        return (parseFloat(value) > 0 && !isNaN(value)) || 'Debe ser un número positivo';
    },
    minLength: (min) => (value) => {
        if (!value) return true;
        return value.length >= min || `Mínimo ${min} caracteres`;
    },
    maxLength: (max) => (value) => {
        if (!value) return true;
        return value.length <= max || `Máximo ${max} caracteres`;
    }
};

function setSessionStorage(data) {
    if (data.user) {
        sessionStorage.setItem('userId', data.user.id);
        sessionStorage.setItem('userName', data.user.nombre);
        sessionStorage.setItem('userRol', data.user.rol);
        sessionStorage.setItem('userEmail', data.user.email);
        sessionStorage.setItem('negocioId', data.negocioId);
    }
}

function getSessionStorage() {
    return {
        userId: sessionStorage.getItem('userId'),
        userName: sessionStorage.getItem('userName'),
        userRol: sessionStorage.getItem('userRol'),
        userEmail: sessionStorage.getItem('userEmail'),
        negocioId: sessionStorage.getItem('negocioId')
    };
}

function clearSessionStorage() {
    sessionStorage.removeItem('userId');
    sessionStorage.removeItem('userName');
    sessionStorage.removeItem('userRol');
    sessionStorage.removeItem('userEmail');
    sessionStorage.removeItem('negocioId');
}

async function checkSession() {
    try {
        const data = await apiCall('/auth/session');
        if (data.authenticated) {
            setSessionStorage(data);
            return data;
        }
        return null;
    } catch (error) {
        return null;
    }
}

let notificacionesInterval = null;

async function cargarNotificaciones() {
    try {
        const data = await apiCall('/notifications/contador');
        const badge = document.getElementById('notifBadge');
        if (badge) {
            if (data.total > 0) {
                badge.textContent = data.total > 9 ? '9+' : data.total;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error notificaciones:', error);
    }
}

async function abrirNotificaciones() {
    const dropdown = document.getElementById('notifDropdown');
    if (!dropdown) return;

    if (dropdown.style.display === 'block') {
        dropdown.style.display = 'none';
        return;
    }

    try {
        const notificaciones = await apiCall('/notifications');
        
        dropdown.innerHTML = `
            <div style="padding: 0.75rem; border-bottom: 1px solid var(--gray-200); display: flex; justify-content: space-between; align-items: center;">
                <strong>Notificaciones</strong>
                <button onclick="marcarTodasLeidas()" style="background: none; border: none; color: var(--primary); cursor: pointer; font-size: 0.75rem;">Marcar todas como leídas</button>
            </div>
            <div style="max-height: 300px; overflow-y: auto;">
                ${notificaciones.length === 0 ? 
                    '<p style="padding: 1rem; text-align: center; color: var(--gray-500);">Sin notificaciones</p>' :
                    notificaciones.map(n => `
                        <div style="padding: 0.75rem; border-bottom: 1px solid var(--gray-100); cursor: pointer; ${n.leida ? 'opacity: 0.6;' : ''}" onclick="handleNotificacionClick(${n.id}, '${n.tipo}', ${n.referencia_id})">
                            <div style="display: flex; align-items: flex-start; gap: 0.5rem;">
                                <span class="badge badge-${getNotifColor(n.tipo)}" style="flex-shrink: 0;">${n.tipo}</span>
                                <div style="flex: 1; min-width: 0;">
                                    <p style="margin: 0; font-size: 0.875rem;">${escapeHtml(n.mensaje)}</p>
                                    <small style="color: var(--gray-500);">${formatNotifDate(n.fecha)}</small>
                                </div>
                                ${!n.leida ? '<span style="width: 8px; height: 8px; background: var(--primary); border-radius: 50%; flex-shrink: 0;"></span>' : ''}
                            </div>
                        </div>
                    `).join('')
                }
            </div>
        `;

        dropdown.style.display = 'block';
    } catch (error) {
        console.error('Error:', error);
    }
}

async function marcarTodasLeidas() {
    try {
        await apiCall('/notifications/leer-todas', { method: 'PUT' });
        await cargarNotificaciones();
        await abrirNotificaciones();
    } catch (error) {
        console.error('Error:', error);
    }
}

async function handleNotificacionClick(notifId, tipo, referenciaId) {
    try {
        await apiCall(`/notifications/${notifId}/leer`, { method: 'PUT' });
        await cargarNotificaciones();

        const dropdown = document.getElementById('notifDropdown');
        if (dropdown) dropdown.style.display = 'none';

        switch (tipo) {
            case 'venta':
                window.location.href = '/pos';
                break;
            case 'cita':
                window.location.href = '/citas';
                break;
            case 'cliente':
                window.location.href = '/clientes';
                break;
            default:
                break;
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

function getNotifColor(tipo) {
    const colors = {
        venta: 'success',
        cita: 'info',
        cliente: 'warning',
        sistema: 'secondary'
    };
    return colors[tipo] || 'secondary';
}

function formatNotifDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const ahora = new Date();
    const diff = ahora - date;
    const minutos = Math.floor(diff / 60000);
    const horas = Math.floor(diff / 3600000);
    const dias = Math.floor(diff / 86400000);

    if (minutos < 1) return 'Hace un momento';
    if (minutos < 60) return `Hace ${minutos} min`;
    if (horas < 24) return `Hace ${horas} hr`;
    if (dias < 7) return `Hace ${dias} días`;
    return date.toLocaleDateString('es-DO');
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function iniciarNotificaciones() {
    cargarNotificaciones();
    if (notificacionesInterval) clearInterval(notificacionesInterval);
    notificacionesInterval = setInterval(cargarNotificaciones, 30000);
}

function detenerNotificaciones() {
    if (notificacionesInterval) {
        clearInterval(notificacionesInterval);
        notificacionesInterval = null;
    }
}

async function checkLicense() {
    try {
        const response = await fetch('/api/license/status');
        const data = await response.json();
        return data;
    } catch (e) {
        return { valid: true, type: 'unknown' };
    }
}

async function requireLicense() {
    const status = await checkLicense();
    
    if (status.isOwner) return true;
    
    if (!status.valid && (status.type === 'expired' || status.type === 'wrong_hardware')) {
        window.location.href = '/actualizar';
        return false;
    }
    
    return true;
}

function showTrialBanner(daysRemaining) {
    if (daysRemaining <= 0) return;
    
    const session = getSessionStorage();
    if (session.userEmail === 'azdelmicha@gmail.com') return;
    
    const existing = document.querySelector('.trial-banner');
    if (existing) return;
    
    const banner = document.createElement('div');
    banner.className = 'trial-banner';
    banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: ${daysRemaining <= 2 ? '#fef3c7' : '#eef2ff'};
        border-bottom: 2px solid ${daysRemaining <= 2 ? '#f59e0b' : '#4f46e5'};
        padding: 0.75rem;
        text-align: center;
        z-index: 9999;
        font-size: 0.875rem;
    `;
    
    const text = daysRemaining === 1 
        ? 'Último día de prueba. ¡Activa tu licencia!'
        : `Te quedan ${daysRemaining} días de prueba. <a href="/actualizar" style="color: #4f46e5; font-weight: 600;">Actualizar ahora</a>`;
    
    banner.innerHTML = text;
    document.body.appendChild(banner);
    
    if (document.querySelector('.main-content')) {
        document.querySelector('.main-content').style.marginTop = '50px';
    }
}
