# Nexora - Guía de Deployment en Cyclic.sh

## ✅ Pre-requisitos

1. Cuenta en [Cyclic.sh](https://cyclic.sh) (100% gratis)
2. Cuenta en [GitHub](https://github.com)
3. Git instalado en tu computadora

---

## 📋 Paso 1: Subir código a GitHub

### Crear repositorio en GitHub:
1. Ve a [github.com/new](https://github.com/new)
2. Nombre: `nexora`
3. Descripción: "Sistema SaaS multi-negocio"
4. Público o Privado (tu elección)
5. NO inicializar con README
6. Clic en "Create repository"

### Subir tu código:
```bash
# Inicializar Git (si no lo has hecho)
git init

# Agregar todos los archivos
git add .

# Hacer commit
git commit -m "Nexora SaaS - Listo para deploy"

# Conectar con GitHub (reemplaza TU-USUARIO)
git remote add origin https://github.com/TU-USUARIO/nexora.git

# Subir código
git push -u origin main
```

---

## 📋 Paso 2: Conectar Cyclic con GitHub

1. Ve a [cyclic.sh](https://cyclic.sh)
2. Clic en "Sign Up" o "Log In"
3. Selecciona "Sign in with GitHub"
4. Autoriza Cyclic para acceder a tus repositorios
5. Clic en "Link My Account"

---

## 📋 Paso 3: Deploy en Cyclic

1. En el dashboard de Cyclic, haz clic en "Deploy"
2. Busca y selecciona tu repositorio `nexora`
3. Clic en "Connect"

---

## 📋 Paso 4: Configurar variables de entorno

En Cyclic, ve a **Environment Variables** y agrega:

| Variable | Valor |
|----------|-------|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | `tu-secreto-super-seguro-aqui-123456789` |

> ⚠️ Cambia `tu-secreto-super-seguro-aqui-123456789` por una cadena aleatoria larga

---

## 📋 Paso 5: Verificar deployment

1. Cyclic hará deploy automáticamente
2. Espera 1-3 minutos
3. Haz clic en el enlace de tu app (ej: `https://tu-app.cyclic.app`)
4. Deberías ver la página de login de Nexora

---

## 🎉 ¡Listo!

Tu Nexora estará disponible en:
```
https://tu-app.cyclic.app
```

### URLs importantes:
- Login: `https://tu-app.cyclic.app/`
- Registro: `https://tu-app.cyclic.app/registro`
- Booking público: `https://tu-app.cyclic.app/booking/tu-slug`

---

## ⚠️ Notas importantes

### Base de datos:
- Cyclic soporta SQLite nativamente
- Los datos se persisten automáticamente
- No necesitas configurar base de datos externa

### Variables de entorno:
- `NODE_ENV=production` activa modo producción
- `SESSION_SECRET` protege las sesiones

### Primer uso:
1. Ve a `/registro`
2. Crea tu primer negocio y usuario
3. Configura tus servicios
4. ¡Listo para usar!

---

## 🔧 Solución de problemas

### Error: "Cannot find module"
- Verifica que `package.json` tenga todas las dependencias
- Cyclic ejecuta `npm install` automáticamente

### Error: "Database locked"
- SQLite maneja concurrencia automáticamente
- No debería ocurrir en Cyclic

### Error: "Session not persisting"
- Verifica que `SESSION_SECRET` esté configurado
- En producción, las sesiones usan cookies seguras

### App no inicia:
1. Verifica logs en Cyclic dashboard
2. Asegúrate que `npm start` funcione localmente
3. Verifica que `PORT` esté configurado (Cyclic lo asigna automáticamente)

---

## 📞 Soporte

Si tienes problemas:
1. Revisa los logs en Cyclic dashboard
2. Verifica que todo funcione localmente primero
3. Consulta la documentación de Cyclic: [docs.cyclic.sh](https://docs.cyclic.sh)
