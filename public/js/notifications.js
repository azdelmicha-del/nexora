const NOTIFICATIONS_CSS = `
<style>
.header-bar {
    display: flex;
    justify-content: flex-end;
    padding: 0.75rem 1.5rem;
    background: white;
    border-bottom: 1px solid var(--gray-200);
    position: sticky;
    top: 0;
    z-index: 100;
}

.notif-btn {
    position: relative;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 0.5rem;
}

.notif-btn:hover {
    background: var(--gray-100);
}

.notif-btn svg {
    width: 24px;
    height: 24px;
    color: var(--gray-600);
}

.notif-badge {
    position: absolute;
    top: 0;
    right: 0;
    background: var(--danger);
    color: white;
    font-size: 0.625rem;
    font-weight: 700;
    min-width: 16px;
    height: 16px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
}

.notif-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    width: 350px;
    background: white;
    border-radius: 0.75rem;
    box-shadow: 0 10px 40px rgba(0,0,0,0.15);
    display: none;
    z-index: 1000;
    margin-top: 0.5rem;
}

.notif-dropdown-header {
    padding: 0.75rem;
    border-bottom: 1px solid var(--gray-200);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.notif-mark-all {
    background: none;
    border: none;
    color: var(--primary);
    cursor: pointer;
    font-size: 0.75rem;
}

.notif-mark-all:hover {
    text-decoration: underline;
}

.notif-item {
    padding: 0.75rem;
    border-bottom: 1px solid var(--gray-100);
    cursor: pointer;
}

.notif-item:hover {
    background: var(--gray-50);
}

.notif-item.no-leida {
    background: #f0f9ff;
}

.notif-item.no-leida:hover {
    background: #e0f2fe;
}

.notif-content {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
}

.notif-details {
    flex: 1;
    min-width: 0;
}

.notif-details p {
    margin: 0;
    font-size: 0.875rem;
}

.notif-time {
    font-size: 0.75rem;
    color: var(--gray-500);
    margin-top: 0.25rem;
}

.notif-unread-dot {
    width: 8px;
    height: 8px;
    background: var(--primary);
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 0.5rem;
}

.notif-empty {
    padding: 2rem;
    text-align: center;
    color: var(--gray-500);
}

.notif-scroll {
    max-height: 400px;
    overflow-y: auto;
}
</style>
`;

const NOTIFICATIONS_HTML = `
<div class="header-bar">
    <div style="position: relative;">
        <button class="notif-btn" onclick="abrirNotificaciones()" title="Notificaciones" id="notifBtn">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
            </svg>
            <span class="notif-badge" id="notifBadge" style="display: none;">0</span>
        </button>
        
        <div class="notif-dropdown" id="notifDropdown"></div>
    </div>
</div>
`;

let notifInterval = null;

function initNotifications() {
    if (document.querySelector('.main-content')) {
        const headerBar = document.createElement('div');
        headerBar.innerHTML = NOTIFICATIONS_HTML;
        document.querySelector('.main-content').insertBefore(headerBar.firstChild, document.querySelector('.main-content').firstChild);
        
        const style = document.createElement('style');
        style.textContent = NOTIFICATIONS_CSS;
        document.head.appendChild(style);
        
        cargarNotificaciones();
        notifInterval = setInterval(cargarNotificaciones, 30000);
        
        document.addEventListener('click', function(e) {
            const dropdown = document.getElementById('notifDropdown');
            const btn = document.getElementById('notifBtn');
            if (dropdown && btn && !dropdown.contains(e.target) && !btn.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    }
}

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
            <div class="notif-dropdown-header">
                <strong>Notificaciones</strong>
                <button class="notif-mark-all" onclick="marcarTodasLeidas()">Marcar todas como leídas</button>
            </div>
            <div class="notif-scroll">
                ${notificaciones.length === 0 ? 
                    '<div class="notif-empty">Sin notificaciones</div>' :
                    notificaciones.map(n => `
                        <div class="notif-item ${n.leida ? '' : 'no-leida'}" onclick="handleNotificacionClick(${n.id}, '${n.tipo}', ${n.referencia_id})">
                            <div class="notif-content">
                                <span class="badge badge-${getNotifColor(n.tipo)}" style="flex-shrink: 0;">${n.tipo}</span>
                                <div class="notif-details">
                                    <p>${escapeHtml(n.mensaje)}</p>
                                    <div class="notif-time">${formatNotifDate(n.fecha)}</div>
                                </div>
                                ${!n.leida ? '<div class="notif-unread-dot"></div>' : ''}
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
