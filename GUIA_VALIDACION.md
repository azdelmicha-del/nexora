# Nexora - Guía de Validación Fase 1

## 1. Aislamiento Multi-tenant (negocio_id)

### Prueba: Acceso cruzado por URL

**Objetivo:** Verificar que un negocio NO pueda acceder a datos de otro.

**Pasos:**
1. Registrar Negocio A (email: a@test.com)
2. Registrar Negocio B (email: b@test.com) en navegador incógnito
3. En Negocio A: Crear cliente "Cliente A"
4. En Negocio B: Ir a Clientes - NO debe ver "Cliente A"
5. En Negocio A: Crear servicio "Servicio A"
6. En Negocio B: Ir a POS - NO debe ver "Servicio A"

**Resultado esperado:** Cada negocio ve SOLO sus datos.

---

## 2. Duplicados de Clientes por WhatsApp

### Prueba: Validación de teléfono duplicado

**Pasos:**
1. Ir a Clientes → Nuevo Cliente
2. Crear cliente con nombre "Test" y teléfono "809-555-1234"
3. Intentar crear otro cliente con el mismo teléfono "809-555-1234"

**Resultado esperado:** 
- Mensaje de error: "Ya existe un cliente con este teléfono"
- Cliente duplicado NO creado

---

## 3. Desactivación de Servicios

### Prueba: Impacto en POS y Citas

**Pasos:**
1. Crear servicio "Masaje Relajante - $800" (estado: activo)
2. Ir a POS - El servicio debe aparecer
3. Ir a Servicios - Editar el servicio - Cambiar a "Inactivo"
4. Ir a POS - El servicio NO debe aparecer
5. Ir a Citas - Intentar crear cita con ese servicio

**Resultado esperado:**
- Servicio inactivo NO aparece en POS
- Al crear cita: mensaje "Servicio no válido"

---

## 4. Validación de Horarios en Citas

### Prueba: Crear cita en horario ocupado

**Pasos:**
1. Ir a Citas → Nueva Cita
2. Seleccionar cliente y servicio (duración 60 min)
3. Seleccionar fecha y hora (ej: 10:00)
4. Guardar - Cita creada
5. Intentar crear OTRA cita con la MISMA hora

**Resultado esperado:**
- Mensaje de error: "Ya existe una cita en ese horario"
- Segunda cita NO creada

---

## 5. Flujo: Cita → Venta (Conversión automática)

### Prueba: Convertir cita en venta desde POS

**Pasos:**
1. Crear cita para "María García" con servicio "Corte"
2. Ir a POS
3. Buscar "María" en el panel de clientes

**Resultado esperado:**
- El panel "Citas de hoy" muestra las citas pendientes
- Al hacer clic en una cita:
  - Cliente se auto-selecciona en el buscador
  - Servicio se auto-agrega al carrito

---

## 6. Reportes con Datos Reales

### Prueba: Validar cálculos de reportes

**Pasos:**
1. Hacer 3 ventas en efectivo ($500, $300, $200)
2. Hacer 2 ventas en transferencia ($150, $250)
3. Ir a Reportes → Filtrar por "Hoy"

**Verificar:**
- Total de ventas: 5
- Monto total: $1,400
- Efectivo: $1,000
- Transferencia: $400

---

## 7. Estados de Citas

### Prueba: Ciclo de vida de una cita

**Pasos:**
1. Crear cita → Estado: **Pendiente**
2. Hacer clic en "Confirmar" → Estado: **Confirmada**
3. Hacer clic en "Finalizar" → Estado: **Finalizada**
4. Intentar cambiar estado de cita cancelada

**Verificar:**
- Los colores de los badges cambian según estado
- En calendario, las citas canceladas se ven diferentes

---

## 8. Validación de Acceso (Middleware)

### Prueba: Intentar acceder sin login

**Pasos:**
1. Cerrar sesión
2. Abrir directamente: `http://localhost:3000/api/sales`
3. Abrir directamente: `http://localhost:3000/api/users`

**Resultado esperado:**
- Respuesta: `{ "error": "No autenticado" }`
- Status HTTP: 401

---

## 9. Validación de Roles

### Prueba: Empleado no puede acceder a admin

**Pasos:**
1. Login como admin → Crear usuario "Empleado1" (rol: empleado)
2. Cerrar sesión → Login como "Empleado1"
3. Ir a: Configuración, Usuarios

**Resultado esperado:**
- Usuarios: Redirigido a Dashboard o error
- Configuración: Redirigido a Dashboard o error

---

## 10. Sanitización XSS

### Prueba: Intentar injectar código

**Pasos:**
1. Ir a Clientes → Nuevo Cliente
2. Nombre: `<script>alert('hack')</script>`
3. Guardar

**Resultado esperado:**
- Cliente creado sin ejecutar el script
- El nombre se muestra como texto plano

---

## Checklist Final

| # | Prueba | Estado | Notas |
|---|--------|--------|-------|
| 1 | Aislamiento multi-tenant | ⬜ | |
| 2 | Duplicados por WhatsApp | ⬜ | |
| 3 | Servicios desactivados | ⬜ | |
| 4 | Horarios ocupados | ⬜ | |
| 5 | Cita → Venta | ⬜ | |
| 6 | Reportes con datos reales | ⬜ | |
| 7 | Estados de citas | ⬜ | |
| 8 | Middleware de acceso | ⬜ | |
| 9 | Validación de roles | ⬜ | |
| 10 | Sanitización XSS | ⬜ | |

---

## Comandos para Iniciar

```bash
cd nexora
npm install  # Solo la primera vez
npm start
```

Abrir en navegadores diferentes:
- http://localhost:3000 (Negocio A)
- http://localhost:3000 (incógnito) (Negocio B)
