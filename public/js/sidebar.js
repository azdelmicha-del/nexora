// Sidebar dinámico para Nexora
async function renderSidebar() {
    const currentPage = window.location.pathname;
    
    let tipoNegocio = 'ambos';
    try {
        const config = await fetch('/api/config', { credentials: 'same-origin' }).then(r => r.json());
        if (config && config.tipo_negocio) tipoNegocio = config.tipo_negocio;
        try {
            const session = JSON.parse(sessionStorage.getItem('session'));
            if (session) { session.tipo_negocio = tipoNegocio; sessionStorage.setItem('session', JSON.stringify(session)); }
        } catch(e) {}
    } catch (e) {}
    
    const menuItems = [
        { href: '/dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', label: 'Dashboard' },
        { href: '/pos', icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z', label: 'Facturar' },
        { href: '/citas', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', label: 'Citas', tipo: 'servicios' },
        { href: '/servicios', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', label: 'Servicios', tipo: 'servicios' },
        { href: '/categorias', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z', label: 'Categorías' },
        { href: '/egresos', icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z', label: 'Egresos', adminOnly: true },
        { href: '/estado-resultado', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', label: 'Estado Resultado', adminOnly: true },
        { href: '/clientes', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z', label: 'Clientes' },
        { href: '/inventario', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4', label: 'Inventario', adminOnly: true },
        { href: '/usuarios', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z', label: 'Usuarios', adminOnly: true },
        { href: '/comisiones', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Comisiones', adminOnly: true },
        { href: '/menu', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253', label: 'Menu Digital', adminOnly: true, tipo: 'comida' },
        { href: '/pedidos', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01', label: 'Pedidos', adminOnly: true, tipo: 'comida' },
        { href: '/notas', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: 'Notas C/D', adminOnly: true },
        { href: '/auditoria', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z', label: 'Auditoria', adminOnly: true },
        { href: '/backup', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4', label: 'Backup', superAdminOnly: true },
        { href: '/reportes', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: 'Reportes' },
        { href: '/configuracion', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z', label: 'Configuración', adminOnly: true },
    ];
    
    let isAdmin = false;
    let isSuperAdmin = false;
    try {
        const session = JSON.parse(sessionStorage.getItem('session'));
        isAdmin = session && session.user && session.user.rol === 'admin';
        isSuperAdmin = session && session.superAdminId ? true : false;
    } catch (e) {}
    
    let navHTML = '';
    menuItems.forEach(item => {
        if (item.superAdminOnly && !isSuperAdmin) return;
        if (item.adminOnly && !isAdmin && !isSuperAdmin) return;
        if (item.tipo && tipoNegocio !== 'ambos' && tipoNegocio !== item.tipo) return;
        
        const isActive = currentPage === item.href || currentPage.startsWith(item.href + '/');
        navHTML += `
            <a href="${item.href}" class="nav-item${isActive ? ' active' : ''}" onclick="closeMobileMenu()">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${item.icon}"></path></svg>
                ${item.label}
            </a>
        `;
    });
    
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
        <aside class="sidebar" id="sidebar">
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
    
    const layout = document.querySelector('.layout');
    if (layout) {
        const existingSidebar = layout.querySelector('.sidebar');
        if (existingSidebar) {
            existingSidebar.outerHTML = sidebarHTML;
        } else {
            layout.insertAdjacentHTML('afterbegin', sidebarHTML);
        }
    }
    
    // Crear botón hamburguesa y overlay
    createMobileMenu();
}

function createMobileMenu() {
    if (document.getElementById('hamburgerBtn')) return;
    
    const header = document.querySelector('.page-header') || document.querySelector('.dash-welcome');
    if (!header) return;
    
    const hamburgerBtn = document.createElement('button');
    hamburgerBtn.id = 'hamburgerBtn';
    hamburgerBtn.className = 'hamburger-btn';
    hamburgerBtn.setAttribute('aria-label', 'Abrir menú');
    hamburgerBtn.innerHTML = `
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
    `;
    hamburgerBtn.addEventListener('click', toggleMobileMenu);
    
    header.insertBefore(hamburgerBtn, header.firstChild);
    
    const overlay = document.createElement('div');
    overlay.id = 'sidebarOverlay';
    overlay.className = 'sidebar-overlay';
    overlay.addEventListener('click', closeMobileMenu);
    document.body.appendChild(overlay);
}

function toggleMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const btn = document.getElementById('hamburgerBtn');
    if (!sidebar) return;
    
    const isOpen = sidebar.classList.contains('open');
    if (isOpen) {
        closeMobileMenu();
    } else {
        sidebar.classList.add('open');
        overlay.classList.add('active');
        btn.classList.add('active');
        btn.setAttribute('aria-label', 'Cerrar menú');
        document.body.style.overflow = 'hidden';
    }
}

function closeMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const btn = document.getElementById('hamburgerBtn');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    if (btn) {
        btn.classList.remove('active');
        btn.setAttribute('aria-label', 'Abrir menú');
    }
    document.body.style.overflow = '';
}

function logout() {
    closeMobileMenu();
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    sessionStorage.clear();
    window.location.href = '/';
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderSidebar);
} else {
    renderSidebar();
}
