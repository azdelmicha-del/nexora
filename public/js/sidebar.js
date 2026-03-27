// Sidebar dinámico para Nexora
function renderSidebar() {
    const currentPage = window.location.pathname;
    
    const menuItems = [
        { href: '/dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', label: 'Dashboard' },
        { href: '/pos', icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z', label: 'Facturar' },
        { href: '/citas', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', label: 'Citas' },
        { href: '/servicios', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', label: 'Servicios' },
        { href: '/categorias', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z', label: 'Categorías' },
        { href: '/estado-resultado', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', label: 'Estado Resultado', adminOnly: true },
        { href: '/clientes', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z', label: 'Clientes' },
        { href: '/usuarios', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z', label: 'Usuarios', adminOnly: true },
        { href: '/reportes', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: 'Reportes' },
        { href: '/configuracion', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z', label: 'Configuración', adminOnly: true },
    ];
    
    // Verificar si es admin
    let isAdmin = false;
    try {
        const session = JSON.parse(sessionStorage.getItem('session'));
        isAdmin = session && session.user && session.user.rol === 'admin';
    } catch (e) {}
    
    let navHTML = '';
    menuItems.forEach(item => {
        if (item.adminOnly && !isAdmin) return;
        
        const isActive = currentPage === item.href || currentPage.startsWith(item.href + '/');
        navHTML += `
            <a href="${item.href}" class="nav-item${isActive ? ' active' : ''}">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${item.icon}"></path></svg>
                ${item.label}
            </a>
        `;
    });
    
    // Obtener info del usuario
    let userName = 'Usuario';
    let userRole = 'Empleado';
    let userInitial = 'U';
    try {
        const session = JSON.parse(sessionStorage.getItem('session'));
        if (session && session.user) {
            userName = session.user.nombre || 'Usuario';
            userRole = session.user.rol === 'admin' ? 'Administrador' : 'Empleado';
            userInitial = (session.user.nombre || 'U').charAt(0).toUpperCase();
        }
    } catch (e) {}
    
    const sidebarHTML = `
        <aside class="sidebar">
            <div class="sidebar-header">
                <h2>Nexora</h2>
                <p>Panel de gestión</p>
            </div>
            
            <nav class="sidebar-nav">
                ${navHTML}
            </nav>
            
            <div class="sidebar-footer">
                <div class="user-info">
                    <div class="user-avatar">${userInitial}</div>
                    <div class="user-details">
                        <h4>${userName}</h4>
                        <span>${userRole}</span>
                    </div>
                </div>
                <button onclick="logout()" class="btn btn-secondary btn-sm mt-2" style="width: 100%;">Cerrar Sesión</button>
            </div>
        </aside>
    `;
    
    // Insertar el sidebar en el DOM
    const layout = document.querySelector('.layout');
    if (layout) {
        const existingSidebar = layout.querySelector('.sidebar');
        if (existingSidebar) {
            existingSidebar.outerHTML = sidebarHTML;
        } else {
            layout.insertAdjacentHTML('afterbegin', sidebarHTML);
        }
    }
}

// Función de logout
function logout() {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    sessionStorage.clear();
    window.location.href = '/';
}

// Ejecutar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderSidebar);
} else {
    renderSidebar();
}
