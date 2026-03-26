let businessData = null;
let slug = null;
let selectedService = null;
let selectedHora = null;

const DIAS_COMPLETOS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Iconos por categoría
const ICONOS_CATEGORIA = {
    'CORTE': '✂️',
    'CORTE DE PELO': '✂️',
    'BARBA': '🪒',
    'PEINADO': '💇',
    'COLOR': '🎨',
    'TINTE': '🎨',
    'UÑAS': '💅',
    'MANICURE': '💅',
    'PEDICURE': '🦶',
    'FACIAL': '🧖',
    'MASAJE': '💆',
    'CEJA': '👁️',
    'PESTAÑA': '👁️',
    'DEFAULT': '✨'
};

document.addEventListener('DOMContentLoaded', () => {
    slug = window.location.pathname.split('/booking/')[1];
    if (!slug) {
        document.getElementById('form-container').innerHTML = '<div style="text-align:center;padding:40px;"><h2>URL no válida</h2></div>';
        return;
    }
    loadBusiness();
    
    // Buscador de servicios
    document.getElementById('search-service').addEventListener('input', filterServices);
    
    // Fecha change
    document.getElementById('fecha').addEventListener('change', cargarHorarios);
    
    // Botones navegación
    document.getElementById('btn-next-servicio').addEventListener('click', () => goToSection('fecha'));
    document.getElementById('btn-next-fecha').addEventListener('click', () => goToSection('datos'));
    document.getElementById('btn-next-datos').addEventListener('click', () => {
        if (validateDatos()) showPreview();
    });
    
    // Submit
    document.getElementById('booking-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitBooking();
    });
});

async function loadBusiness() {
    try {
        const response = await fetch('/api/public/business/' + slug);
        if (!response.ok) throw new Error('Negocio no encontrado');
        businessData = await response.json();
        renderBusinessHeader();
        renderServices();
        configurarFecha();
    } catch (error) {
        document.getElementById('form-container').innerHTML = '<div style="text-align:center;padding:40px;"><h2>Error</h2><p>' + error.message + '</p></div>';
    }
}

function renderBusinessHeader() {
    const n = businessData.negocio;
    const logoEl = document.getElementById('business-logo');
    logoEl.innerHTML = n.logo ? '<img src="' + n.logo + '">' : n.nombre.charAt(0).toUpperCase();
    document.getElementById('business-name').textContent = n.nombre;
    
    let info = '';
    if (n.direccion) info += n.direccion + ' • ';
    if (n.telefono) info += n.telefono + ' • ';
    info += n.hora_apertura + ' - ' + n.hora_cierre;
    document.getElementById('business-info').textContent = info;
    document.title = n.nombre + ' - Agendar Cita';
}

function getIconoCategoria(categoria) {
    if (!categoria) return ICONOS_CATEGORIA['DEFAULT'];
    const catUpper = categoria.toUpperCase();
    for (const [key, icon] of Object.entries(ICONOS_CATEGORIA)) {
        if (catUpper.includes(key)) return icon;
    }
    return ICONOS_CATEGORIA['DEFAULT'];
}

function renderServices() {
    const container = document.getElementById('service-list');
    let html = '';
    
    if (businessData.categorias) {
        businessData.categorias.forEach(cat => {
            try {
                const servicios = JSON.parse(cat.servicios);
                if (servicios[0] && servicios[0].id) {
                    servicios.forEach(s => {
                        html += createServiceCard(s, cat.nombre);
                    });
                }
            } catch(e) {}
        });
    }
    
    if (businessData.serviciosSinCategoria) {
        businessData.serviciosSinCategoria.forEach(s => {
            html += createServiceCard(s, '');
        });
    }
    
    container.innerHTML = html || '<div style="padding:30px;text-align:center;color:#9ca3af;">No hay servicios disponibles</div>';
    
    container.addEventListener('click', (e) => {
        const card = e.target.closest('.service-card[data-id]');
        if (!card) return;
        
        document.querySelectorAll('.service-card').forEach(o => o.classList.remove('selected'));
        card.classList.add('selected');
        
        selectedService = {
            id: parseInt(card.dataset.id),
            nombre: card.dataset.name,
            precio: parseFloat(card.dataset.price),
            duracion: parseInt(card.dataset.duration),
            categoria: card.dataset.category
        };
        
        document.getElementById('btn-next-servicio').disabled = false;
    });
}

function createServiceCard(s, categoria) {
    const dur = s.duracion < 60 ? s.duracion + ' min' : Math.floor(s.duracion/60) + 'h' + (s.duracion%60 ? ' ' + s.duracion%60 + 'm' : '');
    const icono = getIconoCategoria(categoria || s.nombre);
    
    return '<div class="service-card" data-id="' + s.id + '" data-name="' + escapeHtml(s.nombre) + '" data-price="' + s.precio + '" data-duration="' + s.duracion + '" data-category="' + escapeHtml(categoria) + '">' +
        '<div class="icon-wrapper">' + icono + '</div>' +
        '<div class="service-name">' + escapeHtml(s.nombre) + '</div>' +
        '<div class="service-duration">' + dur + '</div>' +
        '<div class="service-price">RD$' + Number(s.precio).toFixed(2) + '</div>' +
        (categoria ? '<div class="service-category">' + escapeHtml(categoria) + '</div>' : '') +
    '</div>';
}

function filterServices() {
    const query = document.getElementById('search-service').value.toLowerCase().trim();
    document.querySelectorAll('.service-card').forEach(card => {
        const name = card.dataset.name.toLowerCase();
        const cat = (card.dataset.category || '').toLowerCase();
        if (!query || name.includes(query) || cat.includes(query)) {
            card.classList.remove('service-hidden');
        } else {
            card.classList.add('service-hidden');
        }
    });
}

function configurarFecha() {
    const fi = document.getElementById('fecha');
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    fi.min = `${year}-${month}-${day}`;
    const max = new Date(today);
    max.setDate(max.getDate() + 60);
    const maxYear = max.getFullYear();
    const maxMonth = String(max.getMonth() + 1).padStart(2, '0');
    const maxDay = String(max.getDate()).padStart(2, '0');
    fi.max = `${maxYear}-${maxMonth}-${maxDay}`;
}

async function cargarHorarios() {
    const fecha = document.getElementById('fecha').value;
    const hc = document.getElementById('horarios-container');
    const hg = document.getElementById('horarios-grid');
    
    if (!selectedService) { showError('Selecciona un servicio primero'); return; }
    if (!fecha) { hc.style.display = 'none'; return; }
    
    // Verificar día laboral
    const diasLaborales = businessData.negocio.dias_laborales.split(',').map(Number);
    const fObj = new Date(fecha + 'T12:00:00');
    let dia = fObj.getDay();
    if (dia === 0) dia = 7;
    if (!diasLaborales.includes(dia)) {
        showError('El negocio no atiende este día');
        document.getElementById('fecha').value = '';
        return;
    }
    
    hideError();
    hc.style.display = 'block';
    hg.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';
    selectedHora = null;
    document.getElementById('hora').value = '';
    document.getElementById('btn-next-fecha').disabled = true;
    
    try {
        const resp = await fetch('/api/public/availability/' + slug + '?fecha=' + fecha + '&servicio_id=' + selectedService.id);
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error);
        
        if (!data.horarios.length) {
            hg.innerHTML = '<div class="no-horarios">No hay horarios disponibles</div>';
            return;
        }
        
        let html = '';
        data.horarios.forEach(s => {
            html += '<button type="button" class="horario-btn" data-hora="' + s.hora + '" data-horafin="' + (s.horaFin || '') + '">' + s.hora + '</button>';
        });
        hg.innerHTML = html;
        
        hg.onclick = (e) => {
            const btn = e.target.closest('.horario-btn');
            if (!btn) return;
            document.querySelectorAll('.horario-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedHora = { hora: btn.dataset.hora, horaFin: btn.dataset.horafin };
            document.getElementById('hora').value = btn.dataset.hora;
            document.getElementById('hora_fin').value = btn.dataset.horafin;
            document.getElementById('btn-next-fecha').disabled = false;
            
            // Actualizar summary
            document.getElementById('summary-servicio').classList.add('show');
            document.getElementById('summary-servicio-nombre').textContent = selectedService.nombre;
            document.getElementById('summary-servicio-duracion').textContent = selectedService.duracion + ' min';
            document.getElementById('summary-servicio-precio').textContent = 'RD$' + selectedService.precio.toFixed(2);
        };
    } catch (error) {
        hg.innerHTML = '<div class="no-horarios">' + error.message + '</div>';
    }
}

function updateProgressBar(step) {
    // Reset all
    for (let i = 1; i <= 3; i++) {
        const stepEl = document.getElementById('step' + i);
        const labelEl = document.getElementById('step' + i + '-label');
        stepEl.classList.remove('active', 'completed');
        labelEl.classList.remove('active');
    }
    for (let i = 1; i <= 2; i++) {
        document.getElementById('line' + i).classList.remove('completed');
    }
    
    // Set current and completed
    for (let i = 1; i < step; i++) {
        document.getElementById('step' + i).classList.add('completed');
        document.getElementById('step' + i).innerHTML = '✓';
        document.getElementById('line' + i).classList.add('completed');
    }
    
    document.getElementById('step' + step).classList.add('active');
    document.getElementById('step' + step + '-label').classList.add('active');
}

function goToSection(name) {
    document.querySelectorAll('.form-section').forEach(s => s.classList.remove('show'));
    document.getElementById('section-' + name).classList.add('show');
    hideError();
    
    // Actualizar barra de progreso
    const steps = { 'servicio': 1, 'fecha': 2, 'datos': 3, 'preview': 3 };
    updateProgressBar(steps[name] || 1);
    
    if (name === 'fecha') {
        document.getElementById('summary-servicio').classList.add('show');
        document.getElementById('summary-servicio-nombre').textContent = selectedService.nombre;
        document.getElementById('summary-servicio-duracion').textContent = selectedService.duracion + ' min';
        document.getElementById('summary-servicio-precio').textContent = 'RD$' + selectedService.precio.toFixed(2);
    }
    
    if (name === 'datos') {
        const fecha = document.getElementById('fecha').value;
        // Parsear como fecha local, no UTC
        const [year, month, day] = fecha.split('-').map(Number);
        const fechaObj = new Date(year, month - 1, day);
        const fechaStr = DIAS_COMPLETOS[fechaObj.getDay()] + ' ' + fechaObj.getDate() + '/' + (fechaObj.getMonth()+1) + '/' + fechaObj.getFullYear();
        
        document.getElementById('summary2-servicio').textContent = selectedService.nombre;
        document.getElementById('summary2-fecha').textContent = fechaStr;
        document.getElementById('summary2-hora').textContent = selectedHora.hora;
        document.getElementById('summary2-precio').textContent = 'RD$' + selectedService.precio.toFixed(2);
    }
}

function validateDatos() {
    const nombre = document.getElementById('nombre').value.trim();
    const whatsapp = document.getElementById('whatsapp').value.trim();
    if (!nombre) { showError('Ingresa tu nombre'); return false; }
    if (!whatsapp) { showError('Ingresa tu WhatsApp'); return false; }
    hideError();
    return true;
}

function showPreview() {
    const fecha = document.getElementById('fecha').value;
    // Parsear como fecha local, no UTC
    const [year, month, day] = fecha.split('-').map(Number);
    const fechaObj = new Date(year, month - 1, day);
    const fechaStr = DIAS_COMPLETOS[fechaObj.getDay()] + ', ' + fechaObj.getDate() + ' de ' + MESES[fechaObj.getMonth()] + ' ' + fechaObj.getFullYear();
    
    document.getElementById('preview-negocio').textContent = businessData.negocio.nombre;
    document.getElementById('preview-servicio').textContent = selectedService.nombre;
    document.getElementById('preview-fecha').textContent = fechaStr;
    document.getElementById('preview-hora').textContent = selectedHora.hora;
    document.getElementById('preview-precio').textContent = 'RD$' + selectedService.precio.toFixed(2);
    document.getElementById('preview-nombre').textContent = document.getElementById('nombre').value.trim();
    document.getElementById('preview-whatsapp').textContent = document.getElementById('whatsapp').value.trim();
    document.getElementById('preview-email').textContent = document.getElementById('email').value.trim() || '-';
    document.getElementById('preview-notas').textContent = document.getElementById('notas').value.trim() || '-';
    
    goToSection('preview');
}

async function submitBooking() {
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = 'Procesando...';
    hideError();
    
    const data = {
        slug: slug,
        servicio_id: selectedService.id,
        fecha: document.getElementById('fecha').value,
        hora: selectedHora.hora,
        nombre: document.getElementById('nombre').value.trim(),
        whatsapp: document.getElementById('whatsapp').value.trim(),
        email: document.getElementById('email').value.trim() || null,
        notas: document.getElementById('notas').value.trim() || null
    };
    
    try {
        const resp = await fetch('/api/public/appointments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error);
        showSuccess(result.cita, data);
    } catch (error) {
        showError(error.message);
        btn.disabled = false;
        btn.textContent = 'Confirmar Cita';
    }
}

function showSuccess(cita, formData) {
    // Parsear fecha correctamente (sin desfase UTC)
    const [year, month, day] = cita.fecha.split('-').map(Number);
    const fechaObj = new Date(year, month - 1, day);
    const fechaStr = DIAS_COMPLETOS[fechaObj.getDay()] + ', ' + fechaObj.getDate() + ' de ' + MESES[fechaObj.getMonth()] + ' ' + fechaObj.getFullYear();
    
    // Mostrar resumen de la cita en el modal
    let summaryHtml = 
        '<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #eee;"><span style="color:#666;">Negocio:</span><span style="font-weight:600;">' + businessData.negocio.nombre + '</span></div>' +
        '<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #eee;"><span style="color:#666;">Servicio:</span><span style="font-weight:600;">' + selectedService.nombre + '</span></div>' +
        '<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #eee;"><span style="color:#666;">Fecha:</span><span style="font-weight:600;">' + fechaStr + '</span></div>' +
        '<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #eee;"><span style="color:#666;">Hora:</span><span style="font-weight:600;">' + cita.hora_inicio + '</span></div>' +
        '<div style="display:flex; justify-content:space-between; padding:8px 0;"><span style="color:#666;">Precio:</span><span style="font-weight:600; color:#667eea;">RD$' + Number(cita.precio).toFixed(2) + '</span></div>';
    
    document.getElementById('modal-summary').innerHTML = summaryHtml;
    
    // Configurar botón de WhatsApp
    if (businessData.negocio.telefono) {
        const tel = businessData.negocio.telefono.replace(/[^0-9]/g, '');
        const msg = encodeURIComponent('Hola! Cita agendada:\n' + selectedService.nombre + '\n' + fechaStr + ' a las ' + cita.hora_inicio + '\nCliente: ' + formData.nombre);
        document.getElementById('modal-whatsapp').href = 'https://wa.me/' + tel + '?text=' + msg;
        document.getElementById('modal-whatsapp').style.display = 'inline-flex';
    } else {
        document.getElementById('modal-whatsapp').style.display = 'none';
    }
    
    // Mostrar modal de confirmación
    document.getElementById('modal-overlay').classList.add('active');
}

function closeModalAndReset() {
    document.getElementById('modal-overlay').classList.remove('active');
    resetForm();
}

function closeModalAndShowInfo() {
    document.getElementById('modal-overlay').classList.remove('active');
    showBusinessInfoScreen();
}

function showBusinessInfoScreen() {
    // Ocultar el formulario
    document.getElementById('form-container').classList.add('hidden');
    document.getElementById('business-header').style.display = 'none';
    document.getElementById('progress-bar').style.display = 'none';
    
    // Construir pantalla de información del negocio
    const n = businessData.negocio;
    const infoScreen = document.getElementById('business-info-screen');
    
    // Horario de trabajo
    const diasNombres = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const diasLaborales = n.dias_laborales ? n.dias_laborales.split(',').map(Number) : [];
    const diasTexto = diasLaborales.map(d => {
        // Convertir de formato 1-7 (Lun-Dom) a 0-6 (Dom-Sáb)
        const idx = d === 7 ? 0 : d;
        return diasNombres[idx];
    }).join(', ');
    
    // Lista de servicios
    let serviciosHtml = '';
    if (businessData.categorias) {
        businessData.categorias.forEach(cat => {
            try {
                const servicios = JSON.parse(cat.servicios);
                if (servicios[0] && servicios[0].id) {
                    serviciosHtml += '<div style="margin-bottom: 16px;">';
                    if (cat.nombre) {
                        serviciosHtml += '<div style="font-size: 12px; color: #667eea; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">' + escapeHtml(cat.nombre) + '</div>';
                    }
                    serviciosHtml += '<div style="display: flex; flex-direction: column; gap: 8px;">';
                    servicios.forEach(s => {
                        const dur = s.duracion < 60 ? s.duracion + ' min' : Math.floor(s.duracion/60) + 'h' + (s.duracion%60 ? ' ' + s.duracion%60 + 'm' : '');
                        serviciosHtml += 
                            '<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f8f9fc; border-radius: 12px;">' +
                                '<div>' +
                                    '<div style="font-weight: 600; font-size: 14px;">' + escapeHtml(s.nombre) + '</div>' +
                                    '<div style="font-size: 12px; color: #9ca3af;">' + dur + '</div>' +
                                '</div>' +
                                '<div style="font-weight: 700; color: #667eea;">RD$' + Number(s.precio).toFixed(2) + '</div>' +
                            '</div>';
                    });
                    serviciosHtml += '</div></div>';
                }
            } catch(e) {}
        });
    }
    
    if (businessData.serviciosSinCategoria) {
        serviciosHtml += '<div style="display: flex; flex-direction: column; gap: 8px;">';
        businessData.serviciosSinCategoria.forEach(s => {
            const dur = s.duracion < 60 ? s.duracion + ' min' : Math.floor(s.duracion/60) + 'h' + (s.duracion%60 ? ' ' + s.duracion%60 + 'm' : '');
            serviciosHtml += 
                '<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f8f9fc; border-radius: 12px;">' +
                    '<div>' +
                        '<div style="font-weight: 600; font-size: 14px;">' + escapeHtml(s.nombre) + '</div>' +
                        '<div style="font-size: 12px; color: #9ca3af;">' + dur + '</div>' +
                    '</div>' +
                    '<div style="font-weight: 700; color: #667eea;">RD$' + Number(s.precio).toFixed(2) + '</div>' +
                '</div>';
        });
        serviciosHtml += '</div>';
    }
    
    infoScreen.innerHTML = 
        '<div style="text-align: center; padding: 20px 0;">' +
            '<div style="width: 70px; height: 70px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 35px; color: white; box-shadow: 0 8px 25px rgba(16,185,129,0.4);">✓</div>' +
            '<h2 style="font-size: 22px; font-weight: 700; margin-bottom: 8px;">¡Cita Agendada!</h2>' +
            '<p style="color: #666; font-size: 14px;">Tu cita ha sido registrada correctamente</p>' +
        '</div>' +
        
        '<div class="card" style="margin-top: 20px;">' +
            '<div style="font-size: 16px; font-weight: 600; margin-bottom: 12px;">📍 Sobre nosotros</div>' +
            '<p style="color: #666; font-size: 14px; line-height: 1.6;">' + (n.descripcion || 'Bienvenido a ' + n.nombre) + '</p>' +
            (n.direccion ? '<p style="color: #9ca3af; font-size: 13px; margin-top: 8px;">📍 ' + escapeHtml(n.direccion) + '</p>' : '') +
        '</div>' +
        
        '<div class="card">' +
            '<div style="font-size: 16px; font-weight: 600; margin-bottom: 16px;">💼 Nuestros Servicios</div>' +
            serviciosHtml +
        '</div>' +
        
        '<div class="card">' +
            '<div style="font-size: 16px; font-weight: 600; margin-bottom: 12px;">🕐 Horario de Atención</div>' +
            '<div style="display: flex; justify-content: space-between; padding: 12px; background: #f8f9fc; border-radius: 12px;">' +
                '<div>' +
                    '<div style="font-weight: 600; font-size: 14px;">Días laborales</div>' +
                    '<div style="font-size: 13px; color: #9ca3af;">' + diasTexto + '</div>' +
                '</div>' +
                '<div style="text-align: right;">' +
                    '<div style="font-weight: 600; font-size: 14px;">' + n.hora_apertura + ' - ' + n.hora_cierre + '</div>' +
                    '<div style="font-size: 13px; color: #9ca3af;">Horario</div>' +
                '</div>' +
            '</div>' +
        '</div>' +
        
        '<div style="display: flex; flex-direction: column; gap: 12px; margin-top: 20px;">' +
            (n.telefono ? 
                '<a href="https://wa.me/' + n.telefono.replace(/[^0-9]/g, '') + '" target="_blank" style="display: flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #25d366 0%, #128c7e 100%); color: white; padding: 14px; border-radius: 14px; text-decoration: none; font-weight: 600; font-size: 15px;">📱 Contactar por WhatsApp</a>'
                : ''
            ) +
            '<button onclick="resetAndShowForm()" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px; border-radius: 14px; border: none; font-weight: 600; font-size: 15px; cursor: pointer; font-family: inherit;">📅 Agendar otra cita</button>' +
        '</div>';
    
    infoScreen.style.display = 'block';
}

function resetAndShowForm() {
    // Ocultar pantalla de info
    document.getElementById('business-info-screen').style.display = 'none';
    document.getElementById('business-header').style.display = 'block';
    document.getElementById('progress-bar').style.display = 'flex';
    document.getElementById('form-container').classList.remove('hidden');
    
    // Resetear formulario
    resetForm();
}

function resetForm() {
    selectedService = null;
    selectedHora = null;
    document.getElementById('booking-form').reset();
    document.querySelectorAll('.service-card').forEach(o => o.classList.remove('selected'));
    document.querySelectorAll('.horario-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('horarios-container').style.display = 'none';
    document.getElementById('btn-next-servicio').disabled = true;
    document.getElementById('btn-next-fecha').disabled = true;
    document.getElementById('summary-servicio').classList.remove('show');
    document.getElementById('submit-btn').disabled = false;
    document.getElementById('submit-btn').textContent = 'Confirmar Cita';
    document.getElementById('search-service').value = '';
    filterServices();
    hideError();
    document.getElementById('success-screen').classList.remove('show');
    document.getElementById('form-container').classList.remove('hidden');
    document.getElementById('business-header').style.display = 'block';
    goToSection('servicio');
}

function showError(msg) {
    const el = document.getElementById('error-container');
    el.textContent = msg;
    el.classList.add('show');
}

function hideError() {
    document.getElementById('error-container').classList.remove('show');
}

function escapeHtml(t) {
    const d = document.createElement('div');
    d.textContent = t || '';
    return d.innerHTML;
}
