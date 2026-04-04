/**
 * Utilidades de formato y validación para Nexora
 */

// Formateadores de texto
const formatters = {
    // Title Case: Primera letra de cada palabra en mayúscula (Juan Perez)
    toTitleCase: (str) => {
        if (!str) return '';
        return str.trim().toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
    },

    // UPPERCASE: Todo en mayúsculas (BARBERÍA)
    toUpperCase: (str) => {
        if (!str) return '';
        return str.trim().toUpperCase();
    },

    // Capitalize: Primera letra en mayúscula, resto minúscula (Corte de pelo)
    capitalize: (str) => {
        if (!str) return '';
        const trimmed = str.trim();
        return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
    },

    // CapitalizeFirst: Primera letra en mayúscula, resto intacto (Calle principal #45)
    capitalizeFirst: (str) => {
        if (!str) return '';
        const trimmed = str.trim();
        return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    },

    // Email: Minúsculas y sin espacios
    toEmail: (str) => {
        if (!str) return '';
        return str.trim().toLowerCase();
    },

    // Teléfono: Solo números
    toPhone: (str) => {
        if (!str) return '';
        return str.replace(/\D/g, '');
    }
};

// Exportación individual para desestructuración directa
const { toTitleCase, toUpperCase, capitalize, capitalizeFirst, toEmail, toPhone } = formatters;

// Validadores
const validators = {
    // Validación de teléfono dominicano (809, 829, 849 - 10 dígitos)
    telefonoRD: (tel) => {
        if (!tel) return false;
        const numeros = tel.replace(/\D/g, '');
        const regex = /^(809|829|849)\d{7}$/;
        return regex.test(numeros);
    },

    // Validación de email con dominios permitidos
    email: (email) => {
        if (!email) return true; // Email es opcional
        const dominiosPermitidos = [
            '@gmail.com',
            '@hotmail.com',
            '@yahoo.com',
            '@hotmail.es',
            '@outlook.com',
            '@live.com'
        ];
        const emailLower = email.trim().toLowerCase();
        const regex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
        
        if (!regex.test(emailLower)) return false;
        
        return dominiosPermitidos.some(d => emailLower.endsWith(d));
    },

    // Validación de nombre (mínimo 2 caracteres)
    nombre: (str) => {
        if (!str) return false;
        return str.trim().length >= 2;
    }
};

// Mensajes de error
const errorMessages = {
    telefonoInvalido: 'El teléfono debe empezar por 809, 829 o 849 y tener 10 dígitos',
    emailInvalido: 'El email debe ser válido y usar un dominio permitido (@gmail.com, @hotmail.com, @yahoo.com, @outlook.com, @live.com)',
    nombreInvalido: 'El nombre debe tener al menos 2 caracteres',
    emailNoPermitido: 'Dominio de email no permitido. Use @gmail.com, @hotmail.com, @yahoo.com, @outlook.com o @live.com'
};

module.exports = { formatters, validators, errorMessages, toTitleCase, toUpperCase, capitalize, capitalizeFirst, toEmail, toPhone };
