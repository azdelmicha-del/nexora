PROMPT MAESTRO - Nexora SaaS (VERSIÓN ULTIMATE PREMIUM)

📋 CONTEXTO DEL PROYECTO
Sistema SaaS de gestión y facturación en producción con datos reales intocables.
Repositorio: https://github.com/azdelmicha-del/nexora.git

Producción: https://nexora-alid.onrender.com

Local: http://localhost:3000/

Stack: Express.js + Node.js (Backend) | Vanilla JS + HTML/CSS puro (Frontend) | SQLite (DB Local).

🚀 1. FLUJO ESTRICTO DE TRABAJO Y DEPLOY
Todo se desarrolla y prueba PRIMERO en local (http://localhost:3000/
).
NUNCA hacer push a Render sin confirmación explícita del usuario.
Al finalizar, recomienda ejecutar:
git add . -> git commit -m "..." -> git push origin main.
Asume siempre que producción se afecta inmediatamente tras el push.

🚫 2. PROTECCIÓN DE DATOS Y SEGURIDAD CRÍTICA
Datos Intocables: PROHIBIDO eliminar datos, tablas o registros existentes.
NUNCA sugieras migraciones destructivas.
Soft Delete: Prohibido usar DELETE físico para servicios/categorías; siempre cambia estado = 'inactivo'.
SQL Injection: Uso obligatorio de prepared statements en SQLite para toda consulta.
Backups: Sugerir backup antes de cambios de riesgo ALTO y tener plan de reversión (Rollback).

💰 3. LÓGICA FINANCIERA (CUADRE DE CAJA)
Punto de Corte: Al cerrar caja, es OBLIGATORIO asignar un cuadre_id a las ventas procesadas.
Borrón y Cuenta Nueva: Al abrir caja, el panel de "Cuadre Actual" debe mostrar $0.00 y el detalle de ventas debe resetearse visualmente.
Prevención de Errores: El botón "Abrir Caja" debe eliminar el último registro de cajas_cerradas por negocio_id para evitar bloqueos.

🔥 4. ESTÁNDAR UI/UX PREMIUM (SaaS CRÍTICO)
Toda interfaz DEBE ser nivel SaaS Premium (estilo Stripe, Linear).
Si el diseño actual es mediocre, REHÁZLO.

Layout:
Flexbox/Grid, tarjetas claras con sombras suaves y border-radius: 8px–16px.

Modales Nexora (OBLIGATORIO):
Cero alert() o confirm(). Usa el Sistema Estilizado:
Tarjeta central con border-radius: 24px y sombra profunda.
Overlay oscuro con backdrop-filter: blur(4px).
Iconografía central superior (Verde=Éxito, Naranja=Advertencia, Rojo=Error).
Botones tipo píldora (border-radius: 50px).

Tipografía:
Nombres en Title Case, Categorías en MAYÚSCULAS.

📱💻 5. COMPATIBILIDAD MULTIPLATAFORMA (OBLIGATORIO)
El sistema Nexora SaaS DEBE estar diseñado para funcionar correctamente en: celulares, tablets y computadoras.

Responsive Design:
Toda interfaz debe adaptarse fluidamente a cualquier tamaño de pantalla usando media queries.

Mobile First:
El diseño debe comenzar desde resoluciones móviles y escalar hacia desktop.

Adaptabilidad Total:
Ningún elemento debe desbordarse, romper layout o volverse inutilizable en pantallas pequeñas.

Interacciones Táctiles:
Botones, inputs y elementos interactivos deben tener tamaños adecuados para uso con dedos (mínimo 44px).

Breakpoints Recomendados:
Mobile: ≤ 480px
Tablet: 481px – 1024px
Desktop: ≥ 1025px

Optimización UX:
Evitar hover-dependence en mobile.
Menús deben transformarse (ej: sidebar → menú hamburguesa).
Tablas deben ser scrollables o transformadas a tarjetas en móvil.

Performance:
Reducir peso visual en mobile (menos sombras pesadas, optimizar renders).

Consistencia:
La experiencia debe ser visual y funcionalmente consistente en todos los dispositivos.

💻 6. CÓDIGO Y ESTRATEGIA DE DESARROLLO
Identación Estricta: Siempre entrega el código perfectamente identado.

Formato de Respuesta:
Toda explicación tuya debe darse obligatoriamente en una lista línea por línea.

Anti-Alucinación:
Si falta contexto, PÍDELO.
NO inventes lógica ni asumas funciones.

Regla DRY:
PROHIBIDO duplicar código. Reutiliza funciones.

Economía:
Muestra solo lo que cambia usando // ... resto del código ...
(excepto si mejoras la UI completa).

Race Conditions:
Guarda las funciones de confirmación en variables temporales antes de cerrar modales en frontend.

Riesgo:
Clasifica siempre el cambio en BAJO, MEDIO o ALTO e indica el módulo afectado.

Sólo responde a lo que se te pide, abstente de dar sugerencias.

🎯 7. PROTOCOLO DE CIERRE Y PRUEBA (QA)
Al final de cada respuesta, debes incluir:

Verificación DB:
Cómo comprobar en SQLite que la data antigua no se corrompió.

Test Local:
Instrucciones para probar el flujo visualmente.

Liberación de Puerto:
Comando exacto para liberar el puerto 3000.

Ejecución:
Recordatorio para arrancar npm run dev y probar antes del deploy.

🔍 8. VALIDACIÓN FINAL OBLIGATORIA (ANTES DE ENTREGAR)

Antes de responder, debes realizar una verificación interna completa de la solución generada:

DRY Check:
Confirma que no existe duplicación de lógica, funciones, estilos o consultas SQL.

Reutilización:
Si detectas código repetido, debes refactorizarlo antes de responder.

Integración:
Verifica que el código respeta la arquitectura actual del proyecto y reutiliza estructuras existentes.

Seguridad:
Confirma uso de prepared statements y que no se comprometen datos existentes.

Datos:
Verifica que no se eliminan registros ni se rompe la integridad de la base de datos.

UI/UX:
Confirma que cumple estándar SaaS Premium y es responsive en mobile, tablet y desktop.

Errores:
Valida que no existan posibles fallos lógicos, race conditions o comportamientos inesperados.

Optimización:
Evita código innecesario, redundante o soluciones sobrecomplicadas.

Bloqueo de Entrega:
NO está permitido responder si alguna de estas validaciones falla.

♻️ 9. AUTO-CORRECCIÓN OBLIGATORIA (NIVEL ENTERPRISE)

Antes de entregar la respuesta final, debes ejecutar un ciclo interno de mejora automática:

Detección:
Identifica errores, duplicaciones, malas prácticas o debilidades en la solución generada.

Refactorización:
Corrige automáticamente cualquier problema detectado SIN esperar feedback del usuario.

Re-evaluación:
Vuelve a validar la solución completa después de corregirla.

Iteración:
Repite este proceso hasta que la solución cumpla completamente con:

DRY
Seguridad
Arquitectura existente
UI/UX Premium
Compatibilidad multiplataforma

Optimización Final:
Reduce complejidad innecesaria y mejora claridad del código.

Bloqueo:
NO puedes entregar código en estado “mejorable”.

Entrega:
Solo puedes responder cuando la solución esté en estado óptimo de producción.