PROMPT MAESTRO - Nexora SaaS (VERSIÓN ULTIMATE PREMIUM)
📋 CONTEXTO DEL PROYECTO
Sistema SaaS de gestión y facturación en producción con datos reales intocables.

Repositorio: https://github.com/azdelmicha-del/nexora.git

Producción: https://nexora-alid.onrender.com

Local: http://localhost:3000/

Stack: Express.js + Node.js (Backend) | Vanilla JS + HTML/CSS puro (Frontend) | SQLite (DB Local).

🚀 1. FLUJO ESTRICTO DE TRABAJO Y DEPLOY
Todo se desarrolla y prueba PRIMERO en local (http://localhost:3000/).

NUNCA hacer push a Render sin confirmación explícita del usuario.

Al finalizar, recomienda ejecutar: git add . -> git commit -m "..." -> git push origin main.

Asume siempre que producción se afecta inmediatamente tras el push.

🚫 2. PROTECCIÓN DE DATOS Y SEGURIDAD CRÍTICA
Datos Intocables: PROHIBIDO eliminar datos, tablas o registros existentes.

NUNCA sugieras migraciones destructivas.

Soft Delete: Prohibido usar DELETE físico para servicios/categorías; siempre cambia estado = 'inactivo'.

SQL Injection: Uso obligatorio de prepared statements en SQLite para toda consulta.

Backups: Sugerir backup antes de cambios de riesgo ALTO y tener plan de reversión (Rollback).

💰 3. LÓGICA FINANCIERA Y TIEMPOS (REGLA ANTI-UTC)
Sincronización de Tiempo (Render/Cloud):

Prohibición de new Date() nativo: Prohibido usar el tiempo del servidor directamente para registros fiscales o citas.

Zona Horaria Forzada: Todo cálculo de tiempo debe estar anclado a 'America/Santo_Domingo' (UTC-4).

Implementación: Usa Intl.DateTimeFormat o lógica manual para asegurar que tanto en local como en Render, la hora sea la misma.

Consistencia: Las citas y ventas deben registrarse según la hora de RD, independientemente de la ubicación física del servidor.

Cuadre de Caja:

Punto de Corte: Al cerrar caja, es OBLIGATORIO asignar un cuadre_id a las ventas procesadas.

Borrón y Cuenta Nueva: Al abrir caja, el panel de "Cuadre Actual" debe mostrar $0.00 y el detalle de ventas debe resetearse visualmente.

Prevención de Errores: El botón "Abrir Caja" debe eliminar el último registro de cajas_cerradas por negocio_id para evitar bloqueos.

🔥 4. ESTÁNDAR UI/UX PREMIUM (SaaS CRÍTICO)
Toda interfaz DEBE ser nivel SaaS Premium (estilo Stripe, Linear).

Si el diseño actual es mediocre, REHÁZLO.

Layout: Flexbox/Grid, tarjetas claras con sombras suaves y border-radius: 8px–16px.

Modales Nexora (OBLIGATORIO): Cero alert() o confirm(). Usa el Sistema Estilizado:

Tarjeta central con border-radius: 24px y sombra profunda.

Overlay oscuro con backdrop-filter: blur(4px).

Iconografía central superior (Verde=Éxito, Naranja=Advertencia, Rojo=Error).

Botones tipo píldora (border-radius: 50px).

Tipografía: Nombres en Title Case, Categorías en MAYÚSCULAS.

📱💻 5. COMPATIBILIDAD MULTIPLATAFORMA (RESPONSIVE)
Responsive Design: Toda interfaz debe adaptarse fluidamente a cualquier tamaño de pantalla usando media queries.

Mobile First: El diseño debe comenzar desde resoluciones móviles y escalar hacia desktop.

Adaptabilidad Total: Ningún elemento debe desbordarse. Botones e inputs con tamaño mínimo de 44px para uso táctil.

Menús Dinámicos: Los menús deben transformarse (ej: sidebar → menú hamburguesa con icono de cierre 'X' y sticky header).

💻 6. CÓDIGO Y ESTRATEGIA DE DESARROLLO
Prohibición de Fragmentación: No crees archivos nuevos si la funcionalidad puede ser integrada de forma lógica y limpia en los archivos existentes. Mantén la cohesión del proyecto.

Identación Estricta: Siempre entrega el código perfectamente identado.

Formato de Respuesta: Toda explicación tuya debe darse obligatoriamente en una lista línea por línea.

Regla DRY: PROHIBIDO duplicar código. Reutiliza funciones.

Economía: Muestra solo lo que cambia usando // ... resto del código ... (excepto si mejoras la UI completa).

Riesgo: Clasifica siempre el cambio en BAJO, MEDIO o ALTO e indica el módulo afectado.

Abstención: Sólo responde a lo que se te pide, abstente de dar sugerencias.

🎯 7. PROTOCOLO DE CIERRE Y PRUEBA (QA)
Al final de cada respuesta, debes incluir:

Verificación DB: Cómo comprobar en SQLite que la data antigua no se corrompió.

Test Local: Instrucciones para probar el flujo visualmente.

Liberación de Puerto: Comando exacto para liberar el puerto 3000.

Ejecución: Recordatorio para arrancar npm run dev.

🔍 8. VALIDACIÓN FINAL OBLIGATORIA (ANTES DE ENTREGAR)
Antes de responder, verifica:

DRY Check: No existe duplicación de lógica ni consultas SQL.

Integración: El código respeta la arquitectura actual y reutiliza estructuras.

Seguridad: Uso de prepared statements y protección de datos.

Sincronización: Confirmación de que se ignora el UTC del servidor en favor de la hora de RD.

UI/UX: Cumple estándar SaaS Premium y es responsive.

♻️ 9. AUTO-CORRECCIÓN OBLIGATORIA (NIVEL ENTERPRISE)
Identifica errores, duplicaciones o debilidades en la solución generada.

Refactoriza automáticamente cualquier problema detectado SIN esperar feedback.

NO puedes entregar código en estado “mejorable”. Entrega solo cuando la solución esté en estado óptimo de producción.