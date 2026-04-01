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
        success: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
        error: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
        warning: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        info: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
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

function showConfirm(title, message) {
    return new Promise((resolve) => {
        const existing = document.getElementById('oc-confirm-modal');
        if (existing) existing.remove();
        
        const overlay = document.createElement('div');
        overlay.id = 'oc-confirm-modal';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999999;backdrop-filter:blur(4px);';
        
        const modal = document.createElement('div');
        modal.style.cssText = 'background:white;border-radius:16px;padding:0;width:90%;max-width:400px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);animation:ocModalIn 0.2s ease-out;';
        
        const style = document.createElement('style');
        style.textContent = '@keyframes ocModalIn{from{opacity:0;transform:scale(0.95);}to{opacity:1;transform:scale(1);}}';
        document.head.appendChild(style);
        
        modal.innerHTML = `
            <div style="padding:24px;text-align:center;">
                <div style="width:56px;height:56px;background:#fef3c7;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                </div>
                <h3 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827;">${title}</h3>
                <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.5;">${message}</p>
                <div style="display:flex;gap:12px;">
                    <button id="oc-confirm-cancel" style="flex:1;padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;color:#374151;font-size:14px;font-weight:500;cursor:pointer;">Cancelar</button>
                    <button id="oc-confirm-ok" style="flex:1;padding:12px;border:none;border-radius:8px;background:#ef4444;color:#fff;font-size:14px;font-weight:500;cursor:pointer;">Confirmar</button>
                </div>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        document.getElementById('oc-confirm-cancel').onclick = () => { overlay.remove(); resolve(false); };
        document.getElementById('oc-confirm-ok').onclick = () => { overlay.remove(); resolve(true); };
        overlay.onclick = (e) => { if(e.target===overlay){ overlay.remove(); resolve(false); } };
    });
}

function showPrompt(title, placeholder = '') {
    return new Promise((resolve) => {
        const existing = document.getElementById('oc-prompt-modal');
        if (existing) existing.remove();
        
        const overlay = document.createElement('div');
        overlay.id = 'oc-prompt-modal';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999999;backdrop-filter:blur(4px);';
        
        const modal = document.createElement('div');
        modal.style.cssText = 'background:white;border-radius:16px;padding:0;width:90%;max-width:400px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);animation:ocModalIn 0.2s ease-out;';
        
        const style = document.createElement('style');
        style.textContent = '@keyframes ocModalIn{from{opacity:0;transform:scale(0.95);}to{opacity:1;transform:scale(1);}}';
        document.head.appendChild(style);
        
        modal.innerHTML = `
            <div style="padding:24px;text-align:center;">
                <h3 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827;">${title}</h3>
                <input type="text" id="oc-prompt-input" placeholder="${placeholder}" style="width:100%;padding:12px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;margin-bottom:20px;outline:none;box-sizing:border-box;">
                <div style="display:flex;gap:12px;">
                    <button id="oc-prompt-cancel" style="flex:1;padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;color:#374151;font-size:14px;font-weight:500;cursor:pointer;">Cancelar</button>
                    <button id="oc-prompt-ok" style="flex:1;padding:12px;border:none;border-radius:8px;background:#6366f1;color:#fff;font-size:14px;font-weight:500;cursor:pointer;">Aceptar</button>
                </div>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        const input = document.getElementById('oc-prompt-input');
        input.focus();
        
        document.getElementById('oc-prompt-cancel').onclick = () => { overlay.remove(); resolve(null); };
        document.getElementById('oc-prompt-ok').onclick = () => { overlay.remove(); resolve(input.value); };
        overlay.onclick = (e) => { if(e.target===overlay){ overlay.remove(); resolve(null); } };
        input.addEventListener('keypress', (e) => { if(e.key === 'Enter'){ overlay.remove(); resolve(input.value); } });
    });
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
    // No bloqueamos el acceso por licencia expirada
    // Solo mostramos advertencia en el banner
    return true;
}

function showTrialBanner(daysRemaining) {
    // Desactivado: el banner se maneja en license-banner.js y dashboard.js
    return;
}

// ============================================
// SISTEMA GLOBAL DE MODALES ESTILIZADOS
// ============================================

let modalContainer = null;

function initModalContainer() {
    if (!modalContainer) {
        modalContainer = document.createElement('div');
        modalContainer.id = 'global-modal-container';
        document.body.appendChild(modalContainer);
    }
}

// Modal de éxito
function showModalSuccess(message, title = '¡Éxito!') {
    initModalContainer();
    
    modalContainer.innerHTML = `
        <div class="modal-overlay active" onclick="if(event.target===this)closeGlobalModal()">
            <div style="background:white; border-radius:24px; padding:32px; max-width:420px; width:90%; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                <div style="width:80px; height:80px; background:linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 24px; font-size:40px; color:white; box-shadow:0 8px 25px rgba(16,185,129,0.4);">✓</div>
                <h2 style="font-size:22px; font-weight:700; margin-bottom:12px; color:#1a1a2e;">${title}</h2>
                <p style="color:#666; margin-bottom:28px; font-size:15px; line-height:1.5;">${message}</p>
                <button onclick="closeGlobalModal()" style="background:linear-gradient(135deg, #10b981 0%, #059669 100%); color:white; padding:16px 32px; border-radius:14px; border:none; font-weight:600; font-size:15px; cursor:pointer; font-family:inherit; width:100%; box-shadow:0 4px 15px rgba(16,185,129,0.4);">Aceptar</button>
            </div>
        </div>
    `;
}

// Modal de error
function showModalError(message, title = 'Error') {
    initModalContainer();
    
    modalContainer.innerHTML = `
        <div class="modal-overlay active" onclick="if(event.target===this)closeGlobalModal()">
            <div style="background:white; border-radius:24px; padding:32px; max-width:420px; width:90%; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                <div style="width:80px; height:80px; background:linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 24px; font-size:40px; color:white; box-shadow:0 8px 25px rgba(239,68,68,0.4);">✕</div>
                <h2 style="font-size:22px; font-weight:700; margin-bottom:12px; color:#1a1a2e;">${title}</h2>
                <p style="color:#666; margin-bottom:28px; font-size:15px; line-height:1.5;">${message}</p>
                <button onclick="closeGlobalModal()" style="background:linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color:white; padding:16px 32px; border-radius:14px; border:none; font-weight:600; font-size:15px; cursor:pointer; font-family:inherit; width:100%; box-shadow:0 4px 15px rgba(239,68,68,0.4);">Aceptar</button>
            </div>
        </div>
    `;
}

// Modal de confirmación
function showModalConfirm(message, onConfirm, onCancel = null, title = '¿Estás seguro?') {
    initModalContainer();
    
    // Guardar callbacks en variables locales para que no se pierdan al cerrar
    const confirmCallback = onConfirm;
    const cancelCallback = onCancel;
    
    modalContainer.innerHTML = `
        <div class="modal-overlay active">
            <div style="background:white; border-radius:24px; padding:32px; max-width:420px; width:90%; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
                <div style="width:80px; height:80px; background:linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 24px; font-size:40px; color:white; box-shadow:0 8px 25px rgba(245,158,11,0.4);">⚠️</div>
                <h2 style="font-size:22px; font-weight:700; margin-bottom:12px; color:#1a1a2e;">${title}</h2>
                <p style="color:#666; margin-bottom:28px; font-size:15px; line-height:1.5;">${message}</p>
                <div style="display:flex; gap:12px;">
                    <button id="modalCancelBtn" style="flex:1; background:#f3f4f6; color:#666; padding:16px; border-radius:14px; border:none; font-weight:600; font-size:15px; cursor:pointer; font-family:inherit; transition:all 0.2s;">Cancelar</button>
                    <button id="modalConfirmBtn" style="flex:1; background:linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color:white; padding:16px; border-radius:14px; border:none; font-weight:600; font-size:15px; cursor:pointer; font-family:inherit; box-shadow:0 4px 15px rgba(245,158,11,0.4); transition:all 0.2s;">Confirmar</button>
                </div>
            </div>
        </div>
    `;
    
    // Asignar eventos después de crear el HTML
    document.getElementById('modalConfirmBtn').addEventListener('click', () => {
        closeGlobalModal();
        if (confirmCallback) confirmCallback();
    });
    
    document.getElementById('modalCancelBtn').addEventListener('click', () => {
        closeGlobalModal();
        if (cancelCallback) cancelCallback();
    });
}

// Cerrar modal global
function closeGlobalModal() {
    const cierreModal = document.getElementById('cierre-modal-container');
    if (cierreModal) cierreModal.innerHTML = '';
    if (modalContainer) modalContainer.innerHTML = '';
}
