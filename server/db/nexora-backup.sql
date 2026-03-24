PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE negocios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    telefono TEXT,
    email TEXT,
    direccion TEXT,
    logo TEXT,
    moneda TEXT DEFAULT 'RD$',
    formato_moneda TEXT DEFAULT '$#,##0.00',
    hora_apertura TEXT DEFAULT '09:00',
    hora_cierre TEXT DEFAULT '18:00',
    dias_laborales TEXT DEFAULT '1,2,3,4,5',
    duracion_minima_cita INTEGER DEFAULT 30,
    permitir_solapamiento INTEGER DEFAULT 0,
    tiempo_anticipacion INTEGER DEFAULT 60,
    tiempo_cancelacion INTEGER DEFAULT 24,
    mostrar_impuestos INTEGER DEFAULT 0,
    activar_descuentos INTEGER DEFAULT 1,
    seleccion_obligatoria_cliente INTEGER DEFAULT 0,
    metodo_efectivo INTEGER DEFAULT 1,
    metodo_transferencia INTEGER DEFAULT 1,
    metodo_tarjeta INTEGER DEFAULT 0,
    chatbot_activo INTEGER DEFAULT 0,
    chatbot_bienvenida TEXT DEFAULT '¡Bienvenido! ¿En qué puedo ayudarte?',
    notificaciones_activas INTEGER DEFAULT 1,
    estado TEXT DEFAULT 'activo',
    fecha_registro TEXT DEFAULT CURRENT_TIMESTAMP
, licencia_plan TEXT DEFAULT "trial", licencia_fecha_inicio TEXT, licencia_fecha_expiracion TEXT, licencia_hardware_id TEXT, suspendido INTEGER DEFAULT 0, booking_activo INTEGER DEFAULT 1, slug TEXT);
INSERT INTO negocios VALUES(1,'ava shop express','(809) 775-8962','azdelmicha@gmail.com','',NULL,'RD$','$#,##0.00','09:00','17:01','1,2,3,4,5',20,0,30,24,0,1,1,1,1,1,0,'¡Bienvenido! ¿En qué puedo ayudarte?',1,'activo','2026-03-18 17:57:56','trial','2026-03-18 17:57:56',NULL,NULL,0,1,'ava-shop-express');
INSERT INTO negocios VALUES(2,'PROBANDO','8296895525','azdmichael93@gmail.com','',NULL,'RD$','$#,##0.00','08:00','23:00','7,1,2,3,4,5,6',5,0,60,24,0,1,1,1,1,0,0,'¡Bienvenido! ¿En qué puedo ayudarte?',1,'activo','2026-03-21 21:21:45','trial','2026-03-21 21:21:45',NULL,NULL,0,1,'probando');
INSERT INTO negocios VALUES(8,'Niña bonita','8298417741','lorenzosierra1593@gmail.com','',NULL,'RD$','$#,##0.00','08:00','20:00','1,2,3,4,5',30,0,60,24,0,1,0,1,1,0,0,'¡Bienvenido! ¿En qué puedo ayudarte?',1,'activo','2026-03-22 14:11:41','trial','2026-03-22 14:11:41',NULL,NULL,0,1,'nina-bonita');
INSERT INTO negocios VALUES(9,'PROBANDO 7 DIAS','+18097758962','probando7dias@gmail.com',NULL,NULL,'RD$','$#,##0.00','09:00','18:00','1,2,3,4,5',30,0,60,24,0,1,0,1,1,0,0,'¡Bienvenido! ¿En qué puedo ayudarte?',1,'activo','2026-03-23 03:09:38','trial','2026-03-23 03:09:38',NULL,NULL,0,1,'probando-7-dias');
INSERT INTO negocios VALUES(10,'CONSULTORIO DENTAL DRA. YAKAIRA GARCÍA','8298702141','joselygarciaj06@gmail.com',NULL,NULL,'RD$','$#,##0.00','09:00','18:00','1,2,3,4,5',30,0,60,24,0,1,0,1,1,0,0,'¡Bienvenido! ¿En qué puedo ayudarte?',1,'activo','2026-03-23 14:25:53','trial','2026-03-23T14:25:53.419Z',NULL,NULL,0,1,'consultorio-dental-dra-yakaira-garcia');
INSERT INTO negocios VALUES(11,'GRANJA MONTERO','8297494228','henrytraderparajesus@gmail.com',NULL,NULL,'RD$','$#,##0.00','09:00','18:00','1,2,3,4,5',30,0,60,24,0,1,0,1,1,0,0,'¡Bienvenido! ¿En qué puedo ayudarte?',1,'activo','2026-03-23 19:28:07','trial','2026-03-23T19:28:07.135Z',NULL,NULL,0,1,'');
CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    rol TEXT DEFAULT 'empleado',
    estado TEXT DEFAULT 'activo',
    fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP, horario_tipo TEXT DEFAULT "completo", hora_entrada TEXT DEFAULT "08:00", hora_salida TEXT DEFAULT "18:00", last_login TEXT,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id)
);
INSERT INTO usuarios VALUES(1,1,'Arsedo zabala','azdelmicha@gmail.com','$2a$10$n4Ycmm4ZQKpVc4r8ZQgUbOvMrJ92NuV5Kk2L7wpuz/TUq6ufGI.Ym','admin','activo','2026-03-18 17:57:56','completo','08:00','18:00','2026-03-23T19:14:27.602Z');
INSERT INTO usuarios VALUES(2,1,'VALERYN','valerybeltre@gmail.com','$2a$10$r4p/9NdYqPoFOQWINaiBNeIfRKxuBjupmmn9ARAltKS1b5nc9cUuG','empleado','activo','2026-03-18 19:47:28','manana','08:00','14:00','2026-03-23T19:27:57.267Z');
INSERT INTO usuarios VALUES(4,2,'michael','azdmichael93@gmail.com','$2a$10$lP5/.boTwjEg4BjJak9xPOK95/neWS8zMv1lcOSc4GyN/ERg.Q5Vy','admin','activo','2026-03-21 21:21:45','completo','08:00','18:00','2026-03-23T19:45:13.394Z');
INSERT INTO usuarios VALUES(8,2,'maceta','azdmichael933@gmail.com','$2a$10$/ZArfg8M2AWFfJzGQXxbgefAeZbgevrmXdzh2cBusWM4OONVEdEna','empleado','activo','2026-03-21 23:15:39','manana','08:00','14:00',NULL);
INSERT INTO usuarios VALUES(11,8,'Ismael','lorenzosierra1593@gmail.com','$2a$10$aVK7JITtZ2E5ywZU6ZeCu.bDMS5jPFPTfBaAGmnoU8zVEJBhXbx1O','admin','activo','2026-03-22 14:11:41','completo','08:00','18:00',NULL);
INSERT INTO usuarios VALUES(12,9,'Probando 7 Dias','probando7dias@gmail.com','$2a$10$GJNTmMt9KrhP/RRptruefeEotNopfHqx.em4ftl8.QflFrU1XY2zS','admin','activo','2026-03-23 03:09:38','completo','08:00','18:00',NULL);
INSERT INTO usuarios VALUES(13,10,'Yakaira García Javier','joselygarciaj06@gmail.com','$2a$10$hp2TpwiepTy8mTfJN//A..5PY.ndWDB59HjpWYXC6zYCbJbHJU.xC','admin','activo','2026-03-23 14:25:53','completo','08:00','18:00',NULL);
INSERT INTO usuarios VALUES(14,11,'Henry Montero Bueno','henrytraderparajesus@gmail.com','$2a$10$W5KTUgON6jKwKGJbAwHqCusAP6/IdgWRJ2hyyClBe3n7C7lrujObG','admin','activo','2026-03-23 19:28:07','completo','08:00','18:00',NULL);
CREATE TABLE servicios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    precio REAL NOT NULL,
    duracion INTEGER NOT NULL,
    categoria_id INTEGER,
    descripcion TEXT,
    estado TEXT DEFAULT 'activo',
    fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id),
    FOREIGN KEY (categoria_id) REFERENCES categorias(id)
);
INSERT INTO servicios VALUES(3,1,'Despigmentación',850.0,30,6,NULL,'activo','2026-03-19 03:04:17');
INSERT INTO servicios VALUES(4,2,'afdfadfdf',5000.0,30,9,NULL,'activo','2026-03-22 01:16:34');
INSERT INTO servicios VALUES(5,8,'Soft Gel XS',500.0,60,10,'Este servicio puede variar en el tiempo de ejecución','activo','2026-03-22 14:17:46');
INSERT INTO servicios VALUES(6,8,'Soft Gel S',550.0,60,10,NULL,'activo','2026-03-22 14:18:15');
INSERT INTO servicios VALUES(7,8,'Soft Gel M',650.0,60,10,NULL,'activo','2026-03-22 14:18:40');
INSERT INTO servicios VALUES(8,2,'CORTE DE PELO',350.0,30,9,NULL,'activo','2026-03-22 17:58:06');
INSERT INTO servicios VALUES(9,2,'UÑAS',1000.0,300,12,NULL,'activo','2026-03-22 18:48:45');
INSERT INTO servicios VALUES(10,2,'Cejeas',5000.0,10,12,NULL,'activo','2026-03-22 18:52:23');
INSERT INTO servicios VALUES(11,2,'Labios',500.0,5,12,NULL,'activo','2026-03-22 18:53:06');
INSERT INTO servicios VALUES(12,2,'NARIZ',1000.0,60,12,NULL,'activo','2026-03-22 18:55:15');
INSERT INTO servicios VALUES(13,2,'Barbas',150.0,15,13,NULL,'activo','2026-03-22 19:40:37');
CREATE TABLE categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    estado TEXT DEFAULT 'activo',
    fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id)
);
INSERT INTO categorias VALUES(6,1,'Depilacion','activo','2026-03-19 03:02:35');
INSERT INTO categorias VALUES(9,2,'oreja','activo','2026-03-22 01:16:49');
INSERT INTO categorias VALUES(10,8,'Manicura','activo','2026-03-22 14:15:48');
INSERT INTO categorias VALUES(11,8,'Pedicura','activo','2026-03-22 14:15:54');
INSERT INTO categorias VALUES(12,2,'PEDICURIS','activo','2026-03-22 18:43:41');
INSERT INTO categorias VALUES(13,2,'RECORTES','activo','2026-03-22 19:40:04');
CREATE TABLE clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    telefono TEXT,
    email TEXT,
    notas TEXT,
    estado TEXT DEFAULT 'activo',
    fecha_registro TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id)
);
INSERT INTO clientes VALUES(4,1,'Arsedo Zabala de la rosa','8097758962','azdmichael93@gmail.com','Vendedor profesional','activo','2026-03-19 03:02:11');
INSERT INTO clientes VALUES(6,2,'maria','8026545dfs',NULL,NULL,'activo','2026-03-22 01:09:11');
INSERT INTO clientes VALUES(7,2,'afdfadfdf','dfdfdf','azdmichadfdfael93@gmail.com',NULL,'activo','2026-03-22 01:12:57');
INSERT INTO clientes VALUES(9,1,'Janny Rodriguez','8096631169',NULL,'Esta cliente es muy exigente','activo','2026-03-22 14:08:46');
INSERT INTO clientes VALUES(10,8,'Janny Rodriguez','8096631169',NULL,'Cliente safada del caco','activo','2026-03-22 14:12:26');
INSERT INTO clientes VALUES(11,2,'JUAN MARTIN','8097758963',NULL,NULL,'activo','2026-03-22 17:58:26');
INSERT INTO clientes VALUES(12,2,'Ster Garicia','755123659456',NULL,NULL,'activo','2026-03-22 18:49:40');
INSERT INTO clientes VALUES(13,2,'Valeryn Beltre Sierra','8296895585',NULL,'mi esposa','activo','2026-03-22 18:55:45');
INSERT INTO clientes VALUES(14,2,'Henry Montoro','+1 (829) 749-4228',NULL,NULL,'activo','2026-03-22 20:45:53');
INSERT INTO clientes VALUES(15,2,'Arsedo Zabala','8097758962',NULL,NULL,'activo','2026-03-22 21:23:36');
INSERT INTO clientes VALUES(16,2,'aMAURY LORENZO','8097785965',NULL,NULL,'activo','2026-03-23 01:37:15');
INSERT INTO clientes VALUES(17,1,'POPOLO','8095563625','POPOLO@gmail.com',NULL,'activo','2026-03-23 19:26:34');
INSERT INTO clientes VALUES(18,2,'popolo','8096532654','popolo@gmail.com',NULL,'activo','2026-03-23 19:34:24');
INSERT INTO clientes VALUES(19,1,'Cliente Prueba','809-555-1234','test@test.com',NULL,'activo','2026-03-23 19:37:57');
INSERT INTO clientes VALUES(20,1,'Test','809-555-9999',NULL,NULL,'activo','2026-03-23 19:42:38');
INSERT INTO clientes VALUES(21,1,'Test Usuario','809-111-2222',NULL,NULL,'activo','2026-03-23 19:48:26');
INSERT INTO clientes VALUES(22,1,'Prueba Frontend','809-333-4444',NULL,NULL,'activo','2026-03-23 19:50:03');
INSERT INTO clientes VALUES(23,1,'Test Final','809-555-7777',NULL,NULL,'activo','2026-03-23 19:50:39');
INSERT INTO clientes VALUES(24,2,'popolo','8095633265','popolo@gmail.com',NULL,'activo','2026-03-23 19:51:56');
INSERT INTO clientes VALUES(25,2,'Valeryn Beltre Sierra','8296895525','valerybeltresierraperez@gmail.com',NULL,'activo','2026-03-23 19:56:47');
CREATE TABLE ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    cliente_id INTEGER,
    user_id INTEGER NOT NULL,
    total REAL NOT NULL,
    descuento REAL DEFAULT 0,
    metodo_pago TEXT NOT NULL,
    fecha TEXT DEFAULT CURRENT_TIMESTAMP, fuera_cuadre INTEGER DEFAULT 0,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (user_id) REFERENCES usuarios(id)
);
INSERT INTO ventas VALUES(1,1,NULL,1,1000.0,0.0,'efectivo','2026-03-18 18:12:46',0);
INSERT INTO ventas VALUES(2,1,NULL,1,2500.0,0.0,'transferencia','2026-03-18 18:13:24',0);
INSERT INTO ventas VALUES(3,1,NULL,1,41000.0,0.0,'tarjeta','2026-03-18 19:44:13',0);
INSERT INTO ventas VALUES(4,1,NULL,2,10500.0,0.0,'efectivo','2026-03-18 19:52:06',0);
INSERT INTO ventas VALUES(5,1,NULL,2,10000.0,0.0,'efectivo','2026-03-18 19:52:17',0);
INSERT INTO ventas VALUES(6,1,NULL,1,10000.0,0.0,'efectivo','2026-03-18 21:04:45',0);
INSERT INTO ventas VALUES(7,1,NULL,1,1000.0,0.0,'efectivo','2026-03-18 23:17:25',1);
INSERT INTO ventas VALUES(8,1,NULL,1,10000.0,0.0,'efectivo','2026-03-19 01:26:36',1);
INSERT INTO ventas VALUES(9,1,NULL,2,32000.0,0.0,'tarjeta','2026-03-19 02:22:50',1);
INSERT INTO ventas VALUES(10,1,NULL,2,850.0,0.0,'efectivo','2026-03-22 01:46:19',0);
INSERT INTO ventas VALUES(11,2,14,4,1000.0,0.0,'efectivo','2026-03-22 20:52:16',0);
INSERT INTO ventas VALUES(12,2,14,4,150.0,0.0,'efectivo','2026-03-22 21:01:30',0);
INSERT INTO ventas VALUES(13,2,13,4,2850.0,0.0,'efectivo','2026-03-22 21:04:02',0);
INSERT INTO ventas VALUES(14,2,13,4,7500.0,0.0,'transferencia','2026-03-22 21:06:19',0);
INSERT INTO ventas VALUES(15,2,NULL,4,5350.0,0.0,'efectivo','2026-03-22 21:08:26',0);
INSERT INTO ventas VALUES(16,2,NULL,4,150.0,0.0,'efectivo','2026-03-22 21:12:51',0);
INSERT INTO ventas VALUES(17,2,NULL,4,250.0,100.0,'efectivo','2026-03-22 21:21:20',0);
INSERT INTO ventas VALUES(18,2,14,4,315.0,35.0,'efectivo','2026-03-22 21:22:13',0);
INSERT INTO ventas VALUES(19,2,15,4,145.5,4.5,'transferencia','2026-03-22 21:23:58',0);
INSERT INTO ventas VALUES(20,2,6,4,500.0,0.0,'efectivo','2026-03-23 01:20:59',0);
INSERT INTO ventas VALUES(21,2,16,4,150.0,0.0,'efectivo','2026-03-23 01:38:46',0);
INSERT INTO ventas VALUES(22,2,15,4,350.0,0.0,'transferencia','2026-03-23 10:31:08',1);
INSERT INTO ventas VALUES(23,2,15,4,150.0,0.0,'efectivo','2026-03-23 10:55:07',0);
CREATE TABLE venta_detalles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER NOT NULL,
    servicio_id INTEGER NOT NULL,
    cantidad INTEGER DEFAULT 1,
    precio REAL NOT NULL,
    subtotal REAL NOT NULL,
    FOREIGN KEY (venta_id) REFERENCES ventas(id),
    FOREIGN KEY (servicio_id) REFERENCES servicios(id)
);
INSERT INTO venta_detalles VALUES(13,10,3,1,850.0,850.0);
INSERT INTO venta_detalles VALUES(14,11,11,2,500.0,1000.0);
INSERT INTO venta_detalles VALUES(15,12,13,1,150.0,150.0);
INSERT INTO venta_detalles VALUES(16,13,8,1,350.0,350.0);
INSERT INTO venta_detalles VALUES(17,13,12,1,1000.0,1000.0);
INSERT INTO venta_detalles VALUES(18,13,9,1,1000.0,1000.0);
INSERT INTO venta_detalles VALUES(19,13,11,1,500.0,500.0);
INSERT INTO venta_detalles VALUES(20,14,10,1,5000.0,5000.0);
INSERT INTO venta_detalles VALUES(21,14,11,1,500.0,500.0);
INSERT INTO venta_detalles VALUES(22,14,12,1,1000.0,1000.0);
INSERT INTO venta_detalles VALUES(23,14,9,1,1000.0,1000.0);
INSERT INTO venta_detalles VALUES(24,15,8,1,350.0,350.0);
INSERT INTO venta_detalles VALUES(25,15,10,1,5000.0,5000.0);
INSERT INTO venta_detalles VALUES(26,16,13,1,150.0,150.0);
INSERT INTO venta_detalles VALUES(27,17,8,1,350.0,350.0);
INSERT INTO venta_detalles VALUES(28,18,8,1,350.0,350.0);
INSERT INTO venta_detalles VALUES(29,19,13,1,150.0,150.0);
INSERT INTO venta_detalles VALUES(30,20,11,1,500.0,500.0);
INSERT INTO venta_detalles VALUES(31,21,13,1,150.0,150.0);
INSERT INTO venta_detalles VALUES(32,22,8,1,350.0,350.0);
INSERT INTO venta_detalles VALUES(33,23,13,1,150.0,150.0);
CREATE TABLE citas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    cliente_id INTEGER NOT NULL,
    servicio_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    hora_inicio TEXT NOT NULL,
    hora_fin TEXT NOT NULL,
    estado TEXT DEFAULT 'pendiente',
    notas TEXT,
    fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP, origen TEXT DEFAULT "interno",
    FOREIGN KEY (negocio_id) REFERENCES negocios(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (servicio_id) REFERENCES servicios(id),
    FOREIGN KEY (user_id) REFERENCES usuarios(id)
);
INSERT INTO citas VALUES(24,2,13,8,4,'2026-03-22','17:30','18:00','finalizada','Mi mujer','2026-03-22 21:03:14','interno');
INSERT INTO citas VALUES(25,2,15,8,4,'2026-03-22','20:00','20:30','finalizada',NULL,'2026-03-22 23:58:27','interno');
INSERT INTO citas VALUES(29,2,15,8,4,'2026-03-23','19:00','19:30','pendiente',NULL,'2026-03-23 19:09:43','interno');
INSERT INTO citas VALUES(30,1,19,3,1,'2026-03-25','10:00','10:30','pendiente','Prueba','2026-03-23 19:40:29','web');
INSERT INTO citas VALUES(31,1,20,3,1,'2026-03-26','11:00','11:30','pendiente',NULL,'2026-03-23 19:42:38','web');
INSERT INTO citas VALUES(32,1,21,3,1,'2026-03-27','14:00','14:30','pendiente',NULL,'2026-03-23 19:48:26','web');
INSERT INTO citas VALUES(33,1,22,3,1,'2026-03-28','15:00','15:30','pendiente',NULL,'2026-03-23 19:50:03','web');
INSERT INTO citas VALUES(34,1,23,3,1,'2026-03-29','16:00','16:30','pendiente',NULL,'2026-03-23 19:50:39','web');
INSERT INTO citas VALUES(35,2,24,8,4,'2026-03-23','18:00','18:30','pendiente','popolo','2026-03-23 19:51:56','web');
INSERT INTO citas VALUES(36,2,25,12,4,'2026-03-23','16:00','17:00','pendiente','llegare un poco tarde','2026-03-23 19:56:47','web');
CREATE TABLE notificaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    mensaje TEXT NOT NULL,
    referencia_id INTEGER,
    leida INTEGER DEFAULT 0,
    fecha TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id)
);
INSERT INTO notificaciones VALUES(1,1,'venta','Nueva venta registrada',1,0,'2026-03-18 18:12:46');
INSERT INTO notificaciones VALUES(2,1,'venta','Nueva venta registrada',2,0,'2026-03-18 18:13:24');
INSERT INTO notificaciones VALUES(3,1,'cita','Nueva cita programada',1,0,'2026-03-18 18:19:39');
INSERT INTO notificaciones VALUES(4,1,'cita','Nueva cita programada',2,0,'2026-03-18 18:26:48');
INSERT INTO notificaciones VALUES(5,1,'cita','Nueva cita programada',3,0,'2026-03-18 18:27:34');
INSERT INTO notificaciones VALUES(6,1,'cita','Nueva cita programada',4,0,'2026-03-18 19:06:27');
INSERT INTO notificaciones VALUES(7,1,'cita','Nueva cita programada',5,0,'2026-03-18 19:09:26');
INSERT INTO notificaciones VALUES(8,1,'cita','Nueva cita programada',6,0,'2026-03-18 19:17:29');
INSERT INTO notificaciones VALUES(9,1,'cita','Nueva cita programada',7,0,'2026-03-18 19:29:33');
INSERT INTO notificaciones VALUES(10,1,'venta','Nueva venta registrada',3,0,'2026-03-18 19:44:13');
INSERT INTO notificaciones VALUES(11,1,'cita','Nueva cita programada',8,0,'2026-03-18 19:49:56');
INSERT INTO notificaciones VALUES(12,1,'venta','Nueva venta registrada',4,0,'2026-03-18 19:52:06');
INSERT INTO notificaciones VALUES(13,1,'venta','Nueva venta registrada',5,0,'2026-03-18 19:52:17');
INSERT INTO notificaciones VALUES(14,1,'venta','Nueva venta registrada',6,0,'2026-03-18 21:04:45');
INSERT INTO notificaciones VALUES(15,1,'venta','Nueva venta registrada',7,0,'2026-03-18 23:17:25');
INSERT INTO notificaciones VALUES(16,1,'venta','Nueva venta registrada',8,0,'2026-03-19 01:26:36');
INSERT INTO notificaciones VALUES(17,1,'venta','Nueva venta registrada',9,0,'2026-03-19 02:22:50');
INSERT INTO notificaciones VALUES(18,1,'cita','Nueva cita programada',9,0,'2026-03-20 02:04:13');
INSERT INTO notificaciones VALUES(19,2,'cita','Nueva cita programada',10,0,'2026-03-22 01:18:13');
INSERT INTO notificaciones VALUES(20,1,'cita','Nueva cita programada',11,0,'2026-03-22 01:33:30');
INSERT INTO notificaciones VALUES(21,1,'venta','Nueva venta registrada',10,0,'2026-03-22 01:46:19');
INSERT INTO notificaciones VALUES(22,2,'cita','Nueva cita programada',12,0,'2026-03-22 18:05:56');
INSERT INTO notificaciones VALUES(23,2,'cita','Nueva cita programada',13,0,'2026-03-22 18:06:31');
INSERT INTO notificaciones VALUES(24,2,'cita','Nueva cita programada',14,0,'2026-03-22 18:42:27');
INSERT INTO notificaciones VALUES(25,2,'cita','Nueva cita programada',15,0,'2026-03-22 18:51:01');
INSERT INTO notificaciones VALUES(26,2,'cita','Nueva cita programada',16,0,'2026-03-22 18:51:41');
INSERT INTO notificaciones VALUES(27,2,'cita','Nueva cita programada',17,0,'2026-03-22 18:54:53');
INSERT INTO notificaciones VALUES(28,2,'cita','Nueva cita programada',18,0,'2026-03-22 18:56:06');
INSERT INTO notificaciones VALUES(29,2,'cita','Nueva cita programada',19,0,'2026-03-22 18:57:23');
INSERT INTO notificaciones VALUES(30,2,'cita','Nueva cita programada',20,0,'2026-03-22 19:08:51');
INSERT INTO notificaciones VALUES(31,2,'cita','Nueva cita programada',21,0,'2026-03-22 19:41:39');
INSERT INTO notificaciones VALUES(32,2,'cita','Nueva cita programada',22,0,'2026-03-22 19:55:21');
INSERT INTO notificaciones VALUES(33,2,'cita','Nueva cita programada',23,0,'2026-03-22 20:51:05');
INSERT INTO notificaciones VALUES(34,2,'venta','Nueva venta registrada',11,0,'2026-03-22 20:52:16');
INSERT INTO notificaciones VALUES(35,2,'venta','Nueva venta registrada',12,0,'2026-03-22 21:01:30');
INSERT INTO notificaciones VALUES(36,2,'cita','Nueva cita programada',24,0,'2026-03-22 21:03:14');
INSERT INTO notificaciones VALUES(37,2,'venta','Nueva venta registrada',13,0,'2026-03-22 21:04:02');
INSERT INTO notificaciones VALUES(38,2,'venta','Nueva venta registrada',14,0,'2026-03-22 21:06:19');
INSERT INTO notificaciones VALUES(39,2,'venta','Nueva venta registrada',15,0,'2026-03-22 21:08:26');
INSERT INTO notificaciones VALUES(40,2,'venta','Nueva venta registrada',16,0,'2026-03-22 21:12:51');
INSERT INTO notificaciones VALUES(41,2,'venta','Nueva venta registrada',17,0,'2026-03-22 21:21:20');
INSERT INTO notificaciones VALUES(42,2,'venta','Nueva venta registrada',18,0,'2026-03-22 21:22:13');
INSERT INTO notificaciones VALUES(43,2,'venta','Nueva venta registrada',19,0,'2026-03-22 21:23:58');
INSERT INTO notificaciones VALUES(44,2,'cita','Nueva cita programada',25,0,'2026-03-22 23:58:27');
INSERT INTO notificaciones VALUES(45,2,'cita','Nueva cita programada',26,0,'2026-03-23 00:16:23');
INSERT INTO notificaciones VALUES(46,2,'cita','Nueva cita programada',27,0,'2026-03-23 01:15:30');
INSERT INTO notificaciones VALUES(47,2,'venta','Nueva venta registrada',20,0,'2026-03-23 01:20:59');
INSERT INTO notificaciones VALUES(48,2,'cita','Nueva cita programada',28,0,'2026-03-23 01:37:23');
INSERT INTO notificaciones VALUES(49,2,'venta','Nueva venta registrada',21,0,'2026-03-23 01:38:46');
INSERT INTO notificaciones VALUES(50,2,'venta','Nueva venta registrada',22,0,'2026-03-23 10:31:08');
INSERT INTO notificaciones VALUES(51,2,'venta','Nueva venta registrada',23,0,'2026-03-23 10:55:07');
INSERT INTO notificaciones VALUES(52,2,'cita','Nueva cita programada',29,0,'2026-03-23 19:09:43');
INSERT INTO notificaciones VALUES(53,1,'cita','Nueva cita web: Cliente Prueba - Despigmentación',30,0,'2026-03-23 19:40:29');
INSERT INTO notificaciones VALUES(54,1,'cita','Nueva cita web: Test - Despigmentación',31,0,'2026-03-23 19:42:38');
INSERT INTO notificaciones VALUES(55,1,'cita','Nueva cita web: Test Usuario - Despigmentación',32,0,'2026-03-23 19:48:26');
INSERT INTO notificaciones VALUES(56,1,'cita','Nueva cita web: Prueba Frontend - Despigmentación',33,0,'2026-03-23 19:50:03');
INSERT INTO notificaciones VALUES(57,1,'cita','Nueva cita web: Test Final - Despigmentación',34,0,'2026-03-23 19:50:39');
INSERT INTO notificaciones VALUES(58,2,'cita','Nueva cita web: popolo - CORTE DE PELO',35,0,'2026-03-23 19:51:56');
INSERT INTO notificaciones VALUES(59,2,'cita','Nueva cita web: Valeryn Beltre Sierra - NARIZ',36,0,'2026-03-23 19:56:47');
CREATE TABLE conversaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    cliente_id INTEGER,
    estado TEXT DEFAULT 'activa',
    fecha_inicio TEXT DEFAULT CURRENT_TIMESTAMP,
    ultima_actividad TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);
CREATE TABLE cajas_cerradas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    total REAL NOT NULL,
    cantidad_ventas INTEGER NOT NULL,
    efectivo REAL DEFAULT 0,
    transferencia REAL DEFAULT 0,
    tarjeta REAL DEFAULT 0,
    user_id INTEGER NOT NULL,
    notas TEXT,
    fecha_cierre TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id),
    FOREIGN KEY (user_id) REFERENCES usuarios(id)
);
INSERT INTO cajas_cerradas VALUES(7,2,'2026-03-22',17710.5,9,10065.0,7645.5,0.0,4,NULL,'2026-03-22 21:44:11');
CREATE TABLE super_admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            nombre TEXT NOT NULL,
            estado TEXT DEFAULT 'activo',
            fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP
        );
INSERT INTO super_admins VALUES(1,'azdelmicha@gmail.com','$2a$10$Y0CF0p9aNZR3AI5a0jQPzuE2h7AzHeQFQYe5lobQMp/STJnOYPBwm','Arsedo Zabala - Super Admin','activo','2026-03-23 21:42:55');
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence VALUES('negocios',11);
INSERT INTO sqlite_sequence VALUES('usuarios',14);
INSERT INTO sqlite_sequence VALUES('servicios',13);
INSERT INTO sqlite_sequence VALUES('categorias',13);
INSERT INTO sqlite_sequence VALUES('clientes',25);
INSERT INTO sqlite_sequence VALUES('ventas',23);
INSERT INTO sqlite_sequence VALUES('venta_detalles',33);
INSERT INTO sqlite_sequence VALUES('notificaciones',59);
INSERT INTO sqlite_sequence VALUES('citas',36);
INSERT INTO sqlite_sequence VALUES('cajas_cerradas',9);
INSERT INTO sqlite_sequence VALUES('super_admins',1);
CREATE INDEX idx_usuarios_negocio ON usuarios(negocio_id);
CREATE INDEX idx_servicios_negocio ON servicios(negocio_id);
CREATE INDEX idx_clientes_negocio ON clientes(negocio_id);
CREATE INDEX idx_ventas_negocio ON ventas(negocio_id);
CREATE INDEX idx_citas_negocio ON citas(negocio_id);
CREATE INDEX idx_notificaciones_negocio ON notificaciones(negocio_id);
COMMIT;
