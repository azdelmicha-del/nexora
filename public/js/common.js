/* Shared helpers for admin pages */

/* ── Text formatting utilities (centralized) ── */
window.toTitleCase = function(str) {
    if (!str) return '';
    return String(str).trim().toLowerCase().replace(/(?:^|\s)\S/g, function(c) { return c.toUpperCase(); });
};

window.capitalizeFirst = function(str) {
    if (!str) return '';
    const s = String(str).trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
};

window.toUpperCase = function(str) {
    if (!str) return '';
    return String(str).trim().toUpperCase();
};

window.toPhone = function(str) {
    if (!str) return '';
    return str.replace(/\D/g, '');
};

window.toEmail = function(str) {
    if (!str) return '';
    return str.trim().toLowerCase();
};

(function(){
  if (typeof window.verDetalle === 'function') return;
  window.verDetalle = async function(id){
    const endpoints = [
      `/api/details/${id}`,
      `/api/detail/${id}`,
      `/admin/details/${id}`,
      `/admin/detalles/${id}`,
      `/details/${id}`
    ];
    let unauthorized = false;
    for (const url of endpoints) {
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (res.status === 401) {
          unauthorized = true;
          // Trigger login flow and remember last target id
          showLoginPrompt(id);
          // Do not continue trying other endpoints
          break;
        }
        if (res.ok) {
          let data;
          try { data = await res.json(); } catch {
            const text = await res.text();
            showDetailModal({ text });
            return;
          }
          showDetailModal(data);
          return;
        }
      } catch (e) { /* ignore and try next */ }
    }
    // Si no hubo respuesta exitosa (y no se disparó login), mostramos fallback
    if (unauthorized) {
      // ya iniciamos login, reintentaremos tras login exitoso
      return;
    }
    // Fallback sin datos reales
    showDetailModal({ id, note: 'No detail endpoint found. Displaying mock data for UI progress.', fields: { title: 'Detalle simulado', timestamp: new Date().toISOString(), id } });
  };

  function showDetailModal(payload){
    const existingModal = document.getElementById('oc-detail-modal');
    const existingOverlay = document.getElementById('oc-detail-overlay');
    if (existingModal) existingModal.remove();
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'oc-detail-overlay';
    overlay.className = 'oc-modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:999999;backdrop-filter:blur(4px);';
    overlay.addEventListener('click', (e) => { if(e.target===overlay){ overlay.remove(); } });
    document.body.appendChild(overlay);

    const modal = document.createElement('div');
    modal.id = 'oc-detail-modal';
    modal.style.cssText = 'background:#fff;border-radius:16px;padding:0;width:min(90vw,500px);max-height:85vh;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);z-index:1000000;animation:ocModalIn 0.2s ease-out;';
    
    const style = document.createElement('style');
    style.textContent = '@keyframes ocModalIn{from{opacity:0;transform:scale(0.95) translateY(10px);}to{opacity:1;transform:scale(1) translateY(0);}}';
    document.head.appendChild(style);

    const header = document.createElement('div');
    header.style.cssText = 'background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:20px 24px;color:#fff;display:flex;justify-content:space-between;align-items:center;';
    const title = document.createElement('h3');
    title.style.margin = '0;font-size:18px;font-weight:600;';
    title.textContent = payload?.found ? `Detalle: ${payload.found.charAt(0).toUpperCase() + payload.found.slice(1)}` : 'Detalle';
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = 'border:none;background:rgba(255,255,255,0.2);color:#fff;width:32px;height:32px;border-radius:50%;font-size:16px;cursor:pointer;transition:background 0.2s;';
    closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(255,255,255,0.3)';
    closeBtn.onmouseout = () => closeBtn.style.background = 'rgba(255,255,255,0.2)';
    closeBtn.addEventListener('click', () => { modal.remove(); overlay.remove(); });
    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const content = document.createElement('div');
    content.style.cssText = 'padding:20px 24px;max-height:60vh;overflow-y:auto;';

    if (payload && payload.data && typeof payload.data === 'object') {
      const excludeFields = ['password', 'token', 'secret', '__v'];
      const fieldLabels = { id: 'ID', nombre: 'Nombre', email: 'Email', telefono: 'Teléfono', rol: 'Rol', estado: 'Estado', negocio_id: 'Negocio ID', fecha_creacion: 'Creado', last_login: 'Último acceso', horario_tipo: 'Horario', hora_entrada: 'Entrada', hora_salida: 'Salida', login_attempts: 'Intentos', licencia_plan: 'Plan', licencia_fecha_expiracion: 'Expiración', slug: 'Link', direccion: 'Dirección', moneda: 'Moneda', hora_apertura: 'Apertura', hora_cierre: 'Cierre', dias_laborales: 'Días' };
      
      for (const [key, value] of Object.entries(payload.data)) {
        if (excludeFields.some(f => key.toLowerCase().includes(f))) continue;
        
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0f0f0;';
        if (key === Object.keys(payload.data).find(k => !excludeFields.some(f => k.toLowerCase().includes(f)))) {
          row.style.borderTop = '1px solid #f0f0f0';
          row.style.marginTop = '8px';
          row.style.paddingTop = '18px';
        }
        
        const label = document.createElement('span');
        label.style.cssText = 'color:#6b7280;font-size:13px;font-weight:500;';
        label.textContent = fieldLabels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        
        const val = document.createElement('span');
        val.style.cssText = 'color:#1f2937;font-size:13px;font-weight:600;text-align:right;max-width:60%;word-break:break-word;';
        
        if (key === 'estado') {
          val.style.color = value === 'activo' ? '#10b981' : value === 'inactivo' ? '#ef4444' : '#f59e0b';
        } else if (key === 'rol') {
          val.style.color = value === 'admin' ? '#8b5cf6' : '#6b7280';
        }
        
        val.textContent = value ?? '-';
        row.appendChild(label);
        row.appendChild(val);
        content.appendChild(row);
      }
    } else {
      content.innerHTML = '<pre style="margin:0;white-space:pre-wrap;word-wrap:break-word;font-size:12px;color:#4b5563;">' + JSON.stringify(payload, null, 2) + '</pre>';
    }
    modal.appendChild(content);

    const footer = document.createElement('div');
    footer.style.cssText = 'padding:16px 24px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:10px;';
    const okBtn = document.createElement('button');
    okBtn.textContent = 'Cerrar';
    okBtn.style.cssText = 'padding:10px 24px;border:none;border-radius:8px;background:#6366f1;color:#fff;font-size:14px;font-weight:500;cursor:pointer;transition:all 0.2s;';
    okBtn.onmouseover = () => okBtn.style.background = '#4f46e5';
    okBtn.onmouseout = () => okBtn.style.background = '#6366f1';
    okBtn.addEventListener('click', () => { modal.remove(); overlay.remove(); });
    footer.appendChild(okBtn);
    modal.appendChild(footer);

    document.body.appendChild(modal);
  }

  function showLoginPrompt(targetId){
    // If a login prompt already exists, do nothing
    if (document.getElementById('oc-login-prompt')) return;
    const prompt = document.createElement('div');
    prompt.id = 'oc-login-prompt';
    Object.assign(prompt.style, {
      position: 'fixed', top: '10px', right: '10px', zIndex: '10001',
      background: '#fff', border: '1px solid #ddd', borderRadius: '8px', padding: '12px 14px', boxShadow: '0 6px 20px rgba(0,0,0,.15)'
    });
    prompt.innerHTML = `Sesión expirada. <a href="/superadmin" style="font-weight:600; text-decoration: underline;" id="oc-login-link">Inicia sesión</a> para continuar.`;
    document.body.appendChild(prompt);
    // Guardar id objetivo para reintentar tras login
    window.__oc_last_verDetalle_id = targetId;
    // Auto eliminar después de 15s
    const t = setTimeout(() => { prompt.remove(); }, 15000);
    // Polling de sesión para reintentar automaticamente tras login
    if (!window.__oc_login_poll) {
      window.__oc_login_poll = setInterval(async () => {
        try {
          const res = await fetch('/api/superadmin/session');
          const data = await res.json();
          if (data && data.authenticated) {
            clearInterval(window.__oc_login_poll);
            window.__oc_login_poll = null;
            prompt.remove();
            clearTimeout(t);
            const idToRetry = window.__oc_last_verDetalle_id;
            if (typeof idToRetry !== 'undefined' && typeof window.verDetalle === 'function') {
              window.verDetalle(idToRetry);
            }
          }
        } catch (e) { /* ignore */ }
      }, 2000);
    }
  }

  function showLoginPrompt(){
    // Si ya existe un prompt, no volver a crear
    if (document.getElementById('oc-login-prompt')) return;
    const prompt = document.createElement('div');
    prompt.id = 'oc-login-prompt';
    Object.assign(prompt.style, {
      position: 'fixed', top: '10px', right: '10px', zIndex: '10001',
      background: '#fff', border: '1px solid #ddd', borderRadius: '8px', padding: '12px 14px', boxShadow: '0 6px 20px rgba(0,0,0,.15)'
    });
    prompt.innerHTML = `Sesión expirada. <a href="/superadmin" style="font-weight:600; text-decoration: underline;">Inicia sesión</a> para continuar.`;
    document.body.appendChild(prompt);
    // Auto eliminar después de 15s
    setTimeout(() => { prompt.remove(); }, 15000);
  }
})();
