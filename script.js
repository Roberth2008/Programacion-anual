/* ============================================================================
   PROGRAMACIÓN ANUAL DREC — DRE Cañas · MEP
   Lógica principal del sistema (Vanilla JS modular)
   ----------------------------------------------------------------------------
   PASOS PARA ACTIVAR FIREBASE EN PRODUCCIÓN:
   1. Cree un proyecto en https://console.firebase.google.com (o reutilice el
      de su dirección regional). Añada una "Web app" y copie su firebaseConfig.
   2. Reemplace los valores PEGA_AQUI_* de la constante firebaseConfig de abajo.
   3. En Authentication → Sign-in method habilite "Correo/contraseña".
   4. En Firestore Database cree la base (modo producción) y publique estas
      reglas de seguridad:

      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {

          // ==================== FUNCIONES ====================

          function esAdmin() {
            return request.auth != null
              && exists(/databases/$(database)/documents/drec_usuarios/$(request.auth.uid))
              && get(/databases/$(database)/documents/drec_usuarios/$(request.auth.uid)).data.rol == 'admin'
              && get(/databases/$(database)/documents/drec_usuarios/$(request.auth.uid)).data.activo != false;
          }
          function esAutorizado() {
            return request.auth != null
              && exists(/databases/$(database)/documents/drec_usuarios/$(request.auth.uid))
              && get(/databases/$(database)/documents/drec_usuarios/$(request.auth.uid)).data.activo != false;
          }

          // Blindaje del bootstrap: el auto-registro del primer administrador
          // solo funciona mientras NO exista «drec_configuracion/bootstrap_cerrado».
          function bootstrapAbierto() {
            return !exists(/databases/$(database)/documents/drec_configuracion/bootstrap_cerrado);
          }

          // Integridad del documento de usuario que crea la aplicación:
          // rol válido, nombre y correo presentes y cuenta activa.
          function datosUsuarioValidos() {
            return request.resource.data.rol in ['admin', 'asesor']
              && request.resource.data.nombre is string
              && request.resource.data.nombre.size() > 0
              && request.resource.data.email is string
              && request.resource.data.email.size() > 0
              && request.resource.data.activo != false;
          }

          // ==================== USUARIOS AUTORIZADOS ====================
          match /drec_usuarios/{userId} {
            allow read: if request.auth != null;
            allow create: if (esAdmin() && datosUsuarioValidos() && request.resource.data.uid == userId)
              || (bootstrapAbierto()
                  && request.auth.uid == userId
                  && request.resource.data.rol == 'admin'
                  && request.resource.data.activo == true
                  && request.resource.data.uid == userId
                  && request.resource.data.nombre is string
                  && request.resource.data.nombre.size() > 0);
            allow update: if esAdmin()
              && !(request.auth.uid == userId
                   && (request.resource.data.rol != 'admin'
                       || request.resource.data.activo == false))
              && (!('rol' in request.resource.data)
                  || request.resource.data.rol in ['admin', 'asesor']);
            allow delete: if esAdmin() && request.auth.uid != userId;
          }

          // ==================== DATOS PÚBLICOS (MODO LECTURA) ====================
          // LECTURA PÚBLICA SIN SESIÓN: el portal consulta estas colecciones con
          // «onSnapshot» de colección completa (consulta «list»), de modo que la
          // regla de lectura DEBE permitir el acceso anónimo a nivel de colección.
          // Condiciones por documento (p. ej. «resource.data.estado == 'publicada'»)
          // ROMPEN la consulta anónima y provocan el error «permission-denied»;
          // la aplicación filtra en el cliente lo que el Modo Lectura puede ver
          // (actividades «publicada» y config.publicado == true).
          match /drec_actividades/{doc} {
            allow read: if true;
            allow write: if esAdmin();
          }
          match /drec_directorio/{doc} {
            allow read: if true;
            allow write: if esAdmin();
          }
          match /drec_configuracion/{doc} {
            allow read: if true;
            allow write: if esAdmin();
          }
        }
      }
   5. Cree ÚNICAMENTE el primer usuario en Authentication → Users → "Add user"
      e inicie sesión con él en el sistema: como la colección drec_usuarios
      está vacía, ese primer inicio de sesión lo registra automáticamente
      como ADMIN. El resto de cuentas de Administrador se registra
      directamente desde la vista "Configuración → Registrar usuario":
      la cuenta se crea en Firebase Authentication desde la propia
      aplicación y su documento/rol queda guardado en drec_usuarios al
      instante, sin usar la consola ni copiar UIDs manualmente. En cuanto ese
      primer administrador inicie sesión, el sistema cierra automáticamente
      el auto-registro inicial (documento «bootstrap_cerrado» en
      drec_configuracion): a partir de ahí, las reglas de seguridad solo
      permiten crear cuentas a un administrador desde la aplicación.

   CONTROL DE ACCESO (refactorización 2026):
   · El acceso a la información es PÚBLICO: cualquier visitante entra
     automáticamente en MODO LECTURA (solo consulta) sin credenciales.
   · El botón «Iniciar sesión» de la barra superior gestiona ÚNICAMENTE
     cuentas de rol Administrador.
   · Las cuentas creadas desde «Configuración → Registrar usuario» son
     siempre de Administrador (el selector de rol fue eliminado).

   Mientras firebaseConfig tenga los valores PEGA_AQUI, el sistema corre en
   MODO DEMO: datos de ejemplo guardados en LocalStorage, con acceso de
   demostración para Administrador (el público navega sin sesión).
   ============================================================================ */

/* ==================== CONFIGURACIÓN FIREBASE ==================== */
const firebaseConfig = {
    apiKey: "AIzaSyC7g9EGUKuua3ibz0-3TA5zXqt4ZhrCwBQ",
  authDomain: "programacion-anual.firebaseapp.com",
  projectId: "programacion-anual",
  storageBucket: "programacion-anual.firebasestorage.app",
  messagingSenderId: "783987508630",
  appId: "1:783987508630:web:d2d5bf6797943e0534c9b7",
  measurementId: "G-02GCH55XMR"
};

const COLECCIONES = {
    actividades: "drec_actividades",
    directorio: "drec_directorio",
    usuarios: "drec_usuarios",
    config: "drec_configuracion"
};

/* ==================== ESTADO GLOBAL ==================== */
let firebaseDB = null;
let firebaseAuth = null;
let MODO_DEMO = false;
let unsubsTiempoReal = [];

let currentUser = null; // { uid, nombre, email, rol: "admin"|"lectura", activo }
// «lectura» = Modo Lectura / Solo Lectura (acceso público sin credenciales).
// Nota: en Firestore el rol de solo lectura se almacena con la clave histórica
// «asesor» (compatibilidad con datos ya guardados); NUNCA se muestra esa
// palabra en la interfaz: siempre se etiqueta como «Solo Lectura».

let dbActividades = [];   // todos los registros de drec_actividades (todos los módulos)
let dbDirectorio = [];    // drec_directorio
let dbUsuarios = [];      // drec_usuarios (solo administradores lo consultan)

let config = {
    anio: new Date().getFullYear(),
    version: "Vs.001",
    publicado: true,
    saludo: "",
    firma: "",
    ideasRectoras: []
};

let editorModulo = null;      // módulo abierto en el editor ("usuarios" | id de MODULOS)
let editorId = null;          // id del documento en edición (null = nuevo)
let editorPrefillFecha = null; // fecha precargada al agregar desde el calendario

let calAnio = new Date().getFullYear();
let calMes = new Date().getMonth(); // 0-11
let calDiaSel = null;         // ISO "YYYY-MM-DD"

let filtrosState = {};         // { modulo: { campo: valor } }

/* ==================== CATÁLOGO OFICIAL Y REGLAS DE CALIDAD DE DATOS ====================
   Catálogo cerrado de Circuitos de la DRE Cañas: es la ÚNICA fuente válida para los
   selectores de Circuito/Región y para sus filtros. No se aceptan valores escritos a
   mano, con errores ortográficos ni fuera de lista: se rechazan tanto en el formulario
   (en vivo) como al guardar, y los filtros solo ofrecen las opciones oficiales. */
const CIRCUITOS_OFICIALES = ["Regional (todos)", "Dirección Regional", "Circuito 01 (Cañas)", "Circuito 02 (Abangares)", "Circuito 03 (Tilarán)", "Circuito 04 (Colorado)", "Circuito 05 (La Altura)"];

/* Reglas de validación, formateo y normalización por campo:
   · min / max ......... longitud mínima y máxima del texto ya normalizado
   · normalizar ........ "titulo" | "nombre" | "texto" | "correo" | "telefono" | "hora"
   · telefono .......... exige formato costarricense válido: fijo 8 dígitos (2xxx-xxxx),
                         celular 8 dígitos (inicia 5–9) o extensión corta (2–5 dígitos)
   · correoInstitucional exige formato de correo válido y dominio oficial del MEP
   · catalogo .......... fuerza que el valor pertenezca exactamente al catálogo oficial
   · noAnteriorQue ..... valida que esta fecha no sea anterior a la de otro campo */
const RE_CORREO = /^[a-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+\/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const RE_TELEFONO_CR_8 = /^[2-9]\d{3}-?\d{4}$/;   // fijo 2xxx-xxxx y celular 8 dígitos (5–9)
const RE_EXTENSION_CR = /^\d{2,5}$/;              // extensión telefónica interna
const DOMINIOS_CORREO_OFICIALES = ["mep.go.cr", "qe.edu.cr", "dtpe.edu.cr"];

const F = {
    titulo:  { clave: "titulo", etiqueta: "Título / Actividad", tipo: "text", requerido: true,
               min: 5, max: 120, normalizar: "titulo",
               ayuda: "Entre 5 y 120 caracteres. Se formatea automáticamente con iniciales en mayúscula." },
    fecha:   { clave: "fecha", etiqueta: "Fecha inicial", tipo: "date", requerido: true },
    fechaFin:{ clave: "fechaFin", etiqueta: "Fecha final (opcional)", tipo: "date", noAnteriorQue: "fecha" },
    hora:    { clave: "hora", etiqueta: "Hora", tipo: "text", max: 60, normalizar: "hora",
               ayuda: "Ej: 8:00 a.m. · 2:00 p.m. · 8:00 a.m. – 12:00 m.d." },
    sede:    { clave: "sede", etiqueta: "Sede / Lugar", tipo: "text", max: 120, normalizar: "titulo" },
    part:    { clave: "participantes", etiqueta: "Participantes / Público", tipo: "text", max: 200, normalizar: "texto" },
    resp:    { clave: "responsable", etiqueta: "Responsable / Coordinación", tipo: "text", max: 120, normalizar: "nombre" },
    desc:    { clave: "descripcion", etiqueta: "Descripción / Observaciones", tipo: "textarea", max: 600, normalizar: "texto",
               ayuda: "Máximo 600 caracteres, sin bloques de texto sin formato." },
    circuito:{ clave: "circuito", etiqueta: "Circuito", tipo: "select", catalogo: CIRCUITOS_OFICIALES,
               opciones: [""].concat(CIRCUITOS_OFICIALES) }
};

const MODULOS = {
    celebrativos: {
        id: "celebrativos", etiqueta: "Celebrativos",
        titulo: "Semanas y Días Celebrativos",
        descripcion: "Fechas cívicas, semanas festivas y conmemoraciones oficiales del año lectivo.",
        icono: "sparkles", color: "#D97706", prefijo: "CEL",
        coleccion: COLECCIONES.actividades,
        columnas: [ {campo:"titulo",etiqueta:"Semana / Día"}, {campo:"tipo",etiqueta:"Tipo"}, {campo:"fecha",etiqueta:"Inicio"}, {campo:"fechaFin",etiqueta:"Finaliza"}, {campo:"descripcion",etiqueta:"Detalle"} ],
        filtros: [ {campo:"tipo",etiqueta:"Tipo",opciones:["","Semana","Día Celebrativo"]}, {campo:"circuito",etiqueta:"Circuito",opciones:[""].concat(CIRCUITOS_OFICIALES)} ],
        campos: [ F.titulo,
            { clave:"tipo", etiqueta:"Tipo", tipo:"select", requerido:true, catalogo:["Semana","Día Celebrativo"], opciones:["Semana","Día Celebrativo"] },
            F.fecha, F.fechaFin, F.circuito, F.desc ]
    },
    ferias_festivales: {
        id: "ferias_festivales", etiqueta: "Ferias y Festivales",
        titulo: "Ferias Regionales y Festivales",
        descripcion: "FEA, ferias de ciencias y tecnología, y demás festivales: etapas institucionales, circuitos 01–05 y ejecución regional.",
        icono: "theater", color: "#DC2626", prefijo: "FF",
        coleccion: COLECCIONES.actividades,
        columnas: [ {campo:"titulo",etiqueta:"Feria / Festival"}, {campo:"etapa",etiqueta:"Etapa"}, {campo:"circuito",etiqueta:"Circuito"}, {campo:"fecha",etiqueta:"Fecha"}, {campo:"sede",etiqueta:"Sede"} ],
        filtros: [ {campo:"etapa",etiqueta:"Etapa",opciones:["","Institucional","Circuito","Regional","Nacional"]}, {campo:"circuito",etiqueta:"Circuito",opciones:[""].concat(CIRCUITOS_OFICIALES)} ],
        campos: [ F.titulo,
            { clave:"etapa", etiqueta:"Etapa", tipo:"select", requerido:true, catalogo:["Institucional","Circuito","Regional","Nacional"], opciones:["Institucional","Circuito","Regional","Nacional"] },
            F.circuito, F.fecha, F.fechaFin, F.hora, F.sede, F.part, F.resp, F.desc ]
    },
    pruebas_academicas: {
        id: "pruebas_academicas", etiqueta: "Pruebas Académicas",
        titulo: "Pruebas Académicas y Períodos Lectivos",
        descripcion: "Fechas de I y II período lectivo: educación formal, CINDEA, IPEC y modalidades técnicas (TP).",
        icono: "graduation-cap", color: "#1E40AF", prefijo: "PA",
        coleccion: COLECCIONES.actividades,
        columnas: [ {campo:"titulo",etiqueta:"Prueba / Período"}, {campo:"modalidad",etiqueta:"Modalidad"}, {campo:"periodo",etiqueta:"Período"}, {campo:"fecha",etiqueta:"Inicio"}, {campo:"fechaFin",etiqueta:"Finaliza"} ],
        filtros: [ {campo:"modalidad",etiqueta:"Modalidad",opciones:["","Educación Formal","CINDEA","IPEC","Técnico Profesional (TP)"]}, {campo:"periodo",etiqueta:"Período",opciones:["","I Período","II Período"]} ],
        campos: [ F.titulo,
            { clave:"modalidad", etiqueta:"Modalidad", tipo:"select", requerido:true, catalogo:["Educación Formal","CINDEA","IPEC","Técnico Profesional (TP)"], opciones:["Educación Formal","CINDEA","IPEC","Técnico Profesional (TP)"] },
            { clave:"periodo", etiqueta:"Período", tipo:"select", catalogo:["","I Período","II Período"], opciones:["","I Período","II Período"] },
            F.fecha, F.fechaFin, F.sede, F.part, F.desc ]
    },
    pruebas_estandarizadas: {
        id: "pruebas_estandarizadas", etiqueta: "Estandarizadas",
        titulo: "Pruebas Estandarizadas y Ampliación",
        descripcion: "Cronograma de convocatorias, pruebas nacionales y pruebas de ampliación.",
        icono: "clipboard-check", color: "#059669", prefijo: "PE",
        coleccion: COLECCIONES.actividades,
        columnas: [ {campo:"titulo",etiqueta:"Prueba"}, {campo:"etapa",etiqueta:"Etapa"}, {campo:"nivel",etiqueta:"Nivel"}, {campo:"fecha",etiqueta:"Fecha"}, {campo:"sede",etiqueta:"Sede"} ],
        filtros: [ {campo:"etapa",etiqueta:"Etapa",opciones:["","Convocatoria","Prueba Nacional","Ampliación"]}, {campo:"nivel",etiqueta:"Nivel",opciones:null} ],
        campos: [ F.titulo,
            { clave:"etapa", etiqueta:"Etapa", tipo:"select", requerido:true, catalogo:["Convocatoria","Prueba Nacional","Ampliación"], opciones:["Convocatoria","Prueba Nacional","Ampliación"] },
            { clave:"nivel", etiqueta:"Nivel / Población", tipo:"text", max:120, normalizar:"titulo" },
            F.fecha, F.fechaFin, F.hora, F.sede, F.part, F.desc ]
    },
    deportivos: {
        id: "deportivos", etiqueta: "Deportivos",
        titulo: "Juegos Deportivos Estudiantiles",
        descripcion: "Fases de inscripción, ejecución institucional, interregional y nacional por disciplina.",
        icono: "trophy", color: "#EA580C", prefijo: "DEP",
        coleccion: COLECCIONES.actividades,
        columnas: [ {campo:"titulo",etiqueta:"Actividad"}, {campo:"disciplina",etiqueta:"Disciplina"}, {campo:"fase",etiqueta:"Fase"}, {campo:"fecha",etiqueta:"Fecha"}, {campo:"sede",etiqueta:"Sede"} ],
        filtros: [ {campo:"disciplina",etiqueta:"Disciplina",opciones:null}, {campo:"fase",etiqueta:"Fase",opciones:["","Inscripción","Institucional","Circuitos","Interregional","Nacional"]} ],
        campos: [ F.titulo,
            { clave:"disciplina", etiqueta:"Disciplina", tipo:"text", requerido:true, min:3, max:60, normalizar:"titulo" },
            { clave:"fase", etiqueta:"Fase", tipo:"select", catalogo:["","Inscripción","Institucional","Circuitos","Interregional","Nacional"], opciones:["","Inscripción","Institucional","Circuitos","Interregional","Nacional"] },
            F.fecha, F.fechaFin, F.hora, F.sede, F.part, F.resp, F.desc ]
    },
    ctp_tecnicos: {
        id: "ctp_tecnicos", etiqueta: "CTP y Técnicos",
        titulo: "CTP y Módulos Técnicos y Especiales",
        descripcion: "Colegios Técnico Profesionales (CTP) y modalidades nocturnas y especiales: CINDEA, IPEC y educación técnica de los circuitos 01–05.",
        icono: "wrench", color: "#DB2777", prefijo: "CTP",
        coleccion: COLECCIONES.actividades,
        columnas: [ {campo:"titulo",etiqueta:"Actividad / Gestión"}, {campo:"centro",etiqueta:"Centro / CTP"}, {campo:"modalidad",etiqueta:"Modalidad"}, {campo:"fecha",etiqueta:"Fecha"}, {campo:"sede",etiqueta:"Sede"} ],
        filtros: [ {campo:"modalidad",etiqueta:"Modalidad",opciones:["","CTP Diurno","CTP Nocturno","CINDEA","IPEC","Educación Especial","Otra"]}, {campo:"circuito",etiqueta:"Circuito",opciones:[""].concat(CIRCUITOS_OFICIALES)} ],
        campos: [ F.titulo,
            { clave:"centro", etiqueta:"Centro educativo / CTP", tipo:"text", max:120, normalizar:"titulo" },
            { clave:"modalidad", etiqueta:"Modalidad", tipo:"select", requerido:true, catalogo:["CTP Diurno","CTP Nocturno","CINDEA","IPEC","Educación Especial","Otra"], opciones:["CTP Diurno","CTP Nocturno","CINDEA","IPEC","Educación Especial","Otra"] },
            F.circuito, F.fecha, F.fechaFin, F.hora, F.sede, F.part, F.resp, F.desc ]
    },
    permanencia: {
        id: "permanencia", etiqueta: "Permanencia",
        titulo: "Permanencia y Mitigación de la Exclusión",
        descripcion: "Estrategias de retención: equipos ERP / EPI, protocolos UPRE y Alerta Temprana.",
        icono: "heart-handshake", color: "#7C3AED", prefijo: "PER",
        coleccion: COLECCIONES.actividades,
        columnas: [ {campo:"titulo",etiqueta:"Estrategia / Actividad"}, {campo:"estrategia",etiqueta:"Componente"}, {campo:"fecha",etiqueta:"Fecha"}, {campo:"sede",etiqueta:"Sede"}, {campo:"responsable",etiqueta:"Responsable"} ],
        filtros: [ {campo:"estrategia",etiqueta:"Componente",opciones:["","ERP","EPI","UPRE","Alerta Temprana","Otro"]} ],
        campos: [ F.titulo,
            { clave:"estrategia", etiqueta:"Componente", tipo:"select", catalogo:["","ERP","EPI","UPRE","Alerta Temprana","Otro"], opciones:["","ERP","EPI","UPRE","Alerta Temprana","Otro"] },
            F.fecha, F.fechaFin, F.hora, F.sede, F.part, F.resp, F.desc ]
    },
    oferta_formativa: {
        id: "oferta_formativa", etiqueta: "Oferta Formativa",
        titulo: "Oferta Formativa",
        descripcion: "Capacitaciones, talleres y formación permanente organizados por mes, hora, sede y público participante.",
        icono: "presentation", color: "#0891B2", prefijo: "OF",
        coleccion: COLECCIONES.actividades,
        columnas: [ {campo:"titulo",etiqueta:"Capacitación / Taller"}, {campo:"fecha",etiqueta:"Fecha"}, {campo:"hora",etiqueta:"Hora"}, {campo:"sede",etiqueta:"Sede"}, {campo:"participantes",etiqueta:"Público"} ],
        filtros: [ {campo:"sede",etiqueta:"Sede",opciones:null} ],
        campos: [ F.titulo, F.fecha, F.fechaFin, F.hora, F.sede,
            { clave:"facilitador", etiqueta:"Facilitador / Ponente", tipo:"text", max:120, normalizar:"nombre" },
            F.part, F.desc ]
    },
    programacion_mensual: {
        id: "programacion_mensual", etiqueta: "Programación Mensual",
        titulo: "Programaciones Mensuales (Enero – Diciembre)",
        descripcion: "Programación detallada mes a mes: fecha, actividad, hora, sede, participantes y compromisos.",
        icono: "calendar-days", color: "#0A192F", prefijo: "PM",
        coleccion: COLECCIONES.actividades,
        columnas: [ {campo:"fecha",etiqueta:"Fecha"}, {campo:"titulo",etiqueta:"Actividad"}, {campo:"hora",etiqueta:"Hora"}, {campo:"sede",etiqueta:"Sede"}, {campo:"compromiso",etiqueta:"Compromiso"} ],
        filtros: [ {campo:"mes",etiqueta:"Mes",opciones:null} ],
        campos: [ F.titulo, F.fecha, F.fechaFin, F.hora, F.sede, F.part, F.resp,
            { clave:"compromiso", etiqueta:"Compromiso", tipo:"text", max:200, normalizar:"texto" },
            F.desc ]
    },
    directorio: {
        id: "directorio", etiqueta: "Directorio",
        titulo: "Directorio Telefónico Institucional",
        descripcion: "Departamentos, funcionarios, teléfonos, extensiones y correos de la DREC y sus circuitos.",
        icono: "phone", color: "#64748B", prefijo: "DIR",
        coleccion: COLECCIONES.directorio,
        columnas: [ {campo:"departamento",etiqueta:"Departamento / Oficina"}, {campo:"funcionario",etiqueta:"Funcionario"}, {campo:"puesto",etiqueta:"Puesto"}, {campo:"telefono",etiqueta:"Teléfono"}, {campo:"extension",etiqueta:"Ext."}, {campo:"correo",etiqueta:"Correo"}, {campo:"circuito",etiqueta:"Circuito"} ],
        filtros: [ {campo:"circuito",etiqueta:"Circuito",opciones:[""].concat(CIRCUITOS_OFICIALES)} ],
        campos: [
            { clave:"departamento", etiqueta:"Departamento / Oficina", tipo:"text", requerido:true,
              min:3, max:100, normalizar:"titulo" },
            { clave:"funcionario", etiqueta:"Nombre del funcionario", tipo:"text", requerido:true,
              min:5, max:100, normalizar:"nombre" },
            { clave:"puesto", etiqueta:"Puesto", tipo:"text", max:80, normalizar:"titulo" },
            { clave:"telefono", etiqueta:"Teléfono", tipo:"text", telefono:true, max:20, normalizar:"telefono",
              ayuda:"Formato costarricense: 2695-5151 (fijo), 8 dígitos (celular) o extensión." },
            { clave:"extension", etiqueta:"Extensión", tipo:"text", extension:true, max:5, normalizar:"extension",
              ayuda:"Solo dígitos (2 a 5)." },
            { clave:"correo", etiqueta:"Correo institucional", tipo:"email", correoInstitucional:true, max:120, normalizar:"correo" },
            { clave:"circuito", etiqueta:"Circuito / Región", tipo:"select", catalogo:CIRCUITOS_OFICIALES,
              opciones:[""].concat(CIRCUITOS_OFICIALES) }
        ]
    }
};

const EDITOR_USUARIOS = {
    id: "usuarios", titulo: "Usuario administrador",
    campos: [
        { clave:"nombre", etiqueta:"Nombre completo", tipo:"text", requerido:true,
          min:5, max:100, normalizar:"nombre" },
        { clave:"email", etiqueta:"Correo institucional", tipo:"email", requerido:true,
          correoInstitucional:true, max:120, normalizar:"correo" }
    ]
};
// La contraseña NO se guarda en Firestore: se establece directamente en
// Firebase Authentication al crear la cuenta (campo ef-password del editor).

const VISTAS = [
    { id:"inicio", etiqueta:"Inicio", icono:"home" },
    { id:"dashboard", etiqueta:"Panel de control", icono:"layout-dashboard" }, // Panel de control visible también en Modo Lectura (consulta pública)
    { id:"calendario", etiqueta:"Calendario", icono:"calendar-days" }
];

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Setiembre","Octubre","Noviembre","Diciembre"];
const MESES_AB = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Set","Oct","Nov","Dic"];
const DIAS = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

/* ==================== HELPERS ==================== */
function $(id) { return document.getElementById(id); }
function esc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function normalize(t) {
    return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}
function pad(n) { return String(n).padStart(2, "0"); }
function hoyISO() {
    const d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
function fmtFecha(iso) {
    if (!iso) return "—";
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return esc(iso);
    return m[3] + "/" + m[2] + "/" + m[1];
}
function fmtRango(a, b) {
    if (a && b && a !== b) return fmtFecha(a) + " al " + fmtFecha(b);
    return fmtFecha(a || b);
}
function fmtTelefono(t) {
    const d = String(t || "").replace(/\D/g, "");
    if (d.length === 8) return d.slice(0, 4) + "-" + d.slice(4);
    return esc(t || "");
}
function generarId(prefijo) {
    return prefijo + "-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
}
function esAdmin() { return !!currentUser && currentUser.rol === "admin"; }
function mesDeFecha(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-/);
    return m ? parseInt(m[2], 10) : null;
}
function crearIconos() { try { if (window.lucide) lucide.createIcons(); } catch (e) {} }

/* ==================== NORMALIZACIÓN Y VALIDACIÓN DE DATOS (CALIDAD / INTEGRIDAD) ====================
   Motor central de reglas: se usa en los formularios (en vivo, mientras el
   administrador escribe), al guardar cualquier registro y como respaldo
   preventivo antes de escribir en Firestore / LocalStorage. */

// Limpieza base: elimina caracteres de control, normaliza espacios y saltos de línea.
function limpiarTextoCrudo(s) {
    return String(s == null ? "" : s)
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .replace(/[ \t\u00A0]+/g, " ")
        .replace(/\s*\n\s*/g, "\n")
        .trim();
}

// Mayúsculas iniciales respetando minúsculas institucionales y grados académicos.
function capitalizarPalabras(txt) {
    const minusculas = ["de", "del", "la", "el", "los", "las", "y", "e", "a", "b", "c", "d", "g", "i", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "en", "con", "por", "para", "desde", "hacia", "the"];
    const partes = txt.split(/(\s+)/);
    let salida = "";
    partes.forEach(palabra => {
        if (/^\s+$/.test(palabra)) { salida += palabra; return; }
        if (!palabra) return;
        // Conserva siglas y códigos oficiales escritos íntegros en mayúsculas (MEP, CINDEA, FEA…)
        if (/^[A-ZÁÉÍÓÚÜÑ]{2,4}$/.test(palabra)) { salida += palabra.toUpperCase(); return; }
        // Conserva grados académicos con su forma estándar (M.Sc., Ph.D., M.A.)
        if (/^(m|ph|ma|msc|ing|lic)\./i.test(palabra)) { salida += palabra.replace(/^(m|ph|ma|msc|ing|lic)\./i, m => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase()); return; }
        // Conserva horas y abreviaturas de minuto (a.m., p.m., m.d.)
        if (/^(a\.m\.|p\.m\.|m\.d\.)$/i.test(palabra)) { salida += palabra.toLowerCase(); return; }
        const primera = palabra.charAt(0);
        const resto = palabra.slice(1);
        // Si la palabra venía toda en MAYÚSCULAS como bloque largo, se pasa a formato título
        // (evita "GRITOS" en documentos oficiales); las cortas se consideran siglas.
        const esGritoLargo = /^[A-ZÁÉÍÓÚÜÑ0-9\s\-–—/&().,]+$/.test(palabra) && palabra.length > 4;
        const cuerpo = esGritoLargo ? palabra.toLowerCase() : (primera === primera.toLowerCase() && primera !== primera.toUpperCase() ? palabra : palabra.toLowerCase());
        const iniciales = /^([^\p{L}\p{N}]*)(\S)/u.exec(cuerpo);
        if (!iniciales) { salida += cuerpo; return; }
        const prefijo = iniciales[1];
        const letra = iniciales[2].toUpperCase();
        let nueva = prefijo + letra + cuerpo.slice(prefijo.length + 1);
        const raiz = nueva.replace(/^[^\p{L}]+/u, "").split(/[^p{L}]/u)[0] || nueva;
        if (minusculas.indexOf(raiz.toLowerCase()) !== -1 && salida.trim().length > 0 && !/[:.!?]\s*$/.test(salida)) {
            nueva = nueva.replace(raiz, raiz.toLowerCase());
        }
        salida += nueva;
    });
    return salida;
}

// Normalizadores por tipo de dato.
function normalizarTitulo(s) {
    const t = limpiarTextoCrudo(s);
    if (!t) return "";
    return capitalizarPalabras(t);
}
function normalizarNombre(s) {
    // Nombres de funcionarios: respeta títulos/grados ("Lic.", "M.Sc.", "Ph.D.")
    const t = limpiarTextoCrudo(s);
    if (!t) return "";
    const conGrados = t
        .replace(/\bm\.?\s*sc\b/gi, "M.Sc.")
        .replace(/\bmster\b/gi, "M.Sc.")
        .replace(/\bma\b(?=\s)/g, "M.A.")
        .replace(/\bph\.?\s*d\b/gi, "Ph.D.")
        .replace(/\blic\b/gi, "Lic.")
        .replace(/\bling\b/gi, "Ing.")
        .replace(/\bprofa?\b/gi, "Prof.");
    return capitalizarPalabras(conGrados);
}
function normalizarTextoSimple(s) {
    // Descripciones: conserva el sentido, limpia espacios dobles y pegado de oraciones.
    const t = limpiarTextoCrudo(s);
    if (!t) return "";
    const sinPegote = t.replace(/([.;:!?])\(?[a-záéíóúñ]/g, (m, p1, p2) => p1 + " " + p2);
    return sinPegote.charAt(0).toUpperCase() + sinPegote.slice(1);
}
function normalizarCorreo(s) {
    return String(s == null ? "" : s).replace(/\s+/g, "").toLowerCase();
}
function soloDigitos(s) { return String(s == null ? "" : s).replace(/\D/g, ""); }

// Teléfono costarricense → formato estándar "2695-5151" / "88123456".
function normalizarTelefono(s) {
    const d = soloDigitos(s);
    if (!d) return "";
    if (d.length === 8) return d.slice(0, 4) + "-" + d.slice(4);
    return d; // longitudes inválidas: se dejan tal cual para que la validación las marque
}
function normalizarExtension(s) { return soloDigitos(s).slice(0, 5); }

// Hora MEP → "8:00 a.m." · "2:00 p.m." · "10:00 m.d." (acepta rangos unidos por – o -).
function normalizarHoraParte(parte) {
    let t = limpiarTextoCrudo(parte).replace(/\s+/g, " ");
    const m = t.match(/^(\d{1,2})(?:[:;.](\d{1,2}))?\s*(am|a\.?m\.?|pm|p\.?m\.?|md|m\.?d\.?)?$/i);
    if (!m) return t;
    const hh = parseInt(m[1], 10);
    const mm = m[2] != null && m[2] !== "" ? m[2].padStart(2, "0") : "00";
    let suf = (m[3] || "").toLowerCase().replace(/\./g, "").replace(/\s/g, "");
    if (!suf) suf = hh >= 12 ? "pm" : "am";
    if (suf === "md") return (hh < 10 ? "0" : "") + hh + ":" + mm + " m.d.";
    const h12 = suf === "pm" ? ((hh % 12) || 12) : ((hh % 12) || 12);
    return h12 + ":" + mm + " " + (suf === "pm" ? "p.m." : "a.m.");
}
function normalizarHora(s) {
    const t = limpiarTextoCrudo(s);
    if (!t) return "";
    const partes = t.split(/\s+[–—-]\s+|\s+-\s+/);
    return partes.map(normalizarHoraParte).join(" – ");
}

// ¿Teléfono válido para Costa Rica? (fijo 8 dígitos, celular 8 dígitos o extensión corta)
function esTelefonoValidoCr(valor, permitirExtension) {
    const v = String(valor || "").trim();
    if (!v) return true; // vacío: solo obligatorio si el campo lo exige
    if (RE_TELEFONO_CR_8.test(v)) {
        const d = soloDigitos(v);
        return d.length === 8;
    }
    if (permitirExtension && RE_EXTENSION_CR.test(v)) return true;
    return false;
}

// ¿El correo pertenece a un dominio oficial del MEP u otro dominio válido?
function clasificarCorreo(valor) {
    const v = normalizarCorreo(valor);
    if (!RE_CORREO.test(v)) return "invalido";
    const dominio = v.split("@")[1] || "";
    const oficial = DOMINIOS_CORREO_OFICIALES.some(d => dominio === d || dominio.endsWith("." + d));
    return oficial ? "oficial" : "valido";
}

// Detecta "masas de texto basura": caracteres extraños repetidos, glifos no
// imprimibles o bloques larguísimos sin puntuación.
function textoSuspicioso(txt) {
    const t = String(txt || "");
    if (!t) return null;
    if (/(.)\1{6,}/.test(t)) return "Contiene cadenas de caracteres repetidos.";
    if (/[\uFFFD\uFFFE\ufffe\uffff]/.test(t)) return "Contiene caracteres extraños o no imprimibles.";
    // Bloques muy largos sin signos de puntuación: posible masa de texto sin formato.
    const oraciones = t.split(/[.!?;:\n]/).filter(x => x.trim().length > 0);
    const masLarga = oraciones.reduce((a, b) => b.trim().length > a.length ? b.trim() : a, "");
    if (masLarga.length > 260) return "Contiene un bloque de texto muy largo sin puntuación. Redacte oraciones claras y breves.";
    return null;
}

/* Normaliza un valor según el tipo de campo declarado en el esquema. */
function normalizarValor(campo, bruto) {
    const modo = campo.normalizar;
    if (modo === "correo" || campo.tipo === "email") return normalizarCorreo(bruto);
    if (modo === "telefono") return normalizarTelefono(bruto);
    if (modo === "extension") return normalizarExtension(bruto);
    if (modo === "hora") return normalizarHora(bruto);
    if (modo === "titulo") return normalizarTitulo(bruto);
    if (modo === "nombre") return normalizarNombre(bruto);
    if (modo === "texto") return normalizarTextoSimple(bruto);
    if (campo.tipo === "date") return String(bruto == null ? "" : bruto).trim();
    if (campo.tipo === "select") return String(bruto == null ? "" : bruto).trim();
    return limpiarTextoCrudo(bruto);
}

/* Valida UN campo contra todas sus reglas. Devuelve string de error o null. */
function validarCampo(campo, valor, otrosValores) {
    const v = String(valor == null ? "" : valor).trim();
    const nombre = campo.etiqueta || campo.clave;

    if (campo.requerido && !v) return "«" + nombre + "» es obligatorio.";

    if (!v) return null; // campos opcionales vacíos: nada más que revisar

    // Selectores de catálogo cerrado: solo opciones oficiales, nunca texto libre.
    if (campo.tipo === "select") {
        const permitidas = campo.catalogo || campo.opciones || [];
        if (permitidas.indexOf(v) === -1) return "«" + nombre + "» debe ser una opción oficial del catálogo. Revise el selector.";
        return null;
    }

    // Fechas
    if (campo.tipo === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "«" + nombre + "» no es una fecha válida (formato AAAA-MM-DD).";
        const partes = v.split("-");
        const anio = parseInt(partes[0], 10), mes = parseInt(partes[1], 10), dia = parseInt(partes[2], 10);
        const fecha = new Date(anio, mes - 1, dia);
        if (anio < 2000 || anio > 2100 || isNaN(fecha.getTime()) ||
            fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) {
            return "«" + nombre + "» no corresponde a una fecha real. Verifique el día y el mes.";
        }
        if (campo.noAnteriorQue && otrosValores) {
            const base = otrosValores[campo.noAnteriorQue];
            if (base && /^\d{4}-\d{2}-\d{2}$/.test(base) && v < base) {
                return "La «Fecha final» no puede ser anterior a la «Fecha inicial» (" + fmtFecha(base) + "). Corrija el rango de fechas.";
            }
        }
        return null;
    }

    // Longitudes
    if (campo.min && v.length < campo.min) return "«" + nombre + "» debe tener al menos " + campo.min + " caracteres (actualmente " + v.length + ").";
    if (campo.max && v.length > campo.max) return "«" + nombre + "» no puede superar los " + campo.max + " caracteres (actualmente " + v.length + ").";

    // Teléfonos costarricenses
    if (campo.telefono) {
        if (!esTelefonoValidoCr(v, true)) {
            return "«" + nombre + "» no tiene un formato válido. Use teléfono fijo de 8 dígitos (Ej: 2695-5151), celular de 8 dígitos (Ej: 8812-3456) o una extensión de 2 a 5 dígitos.";
        }
        return null;
    }
    if (campo.extension) {
        if (!RE_EXTENSION_CR.test(v)) return "«" + nombre + "» debe contener únicamente de 2 a 5 dígitos.";
        return null;
    }

    // Correos
    if (campo.tipo === "email" || campo.correoInstitucional) {
        const estado = clasificarCorreo(v);
        if (estado === "invalido") return "«" + nombre + "» no tiene un formato de correo válido (Ej: nombre.apellido@mep.go.cr).";
        if (campo.correoInstitucional && estado !== "oficial") {
            return "«" + nombre + "» debe pertenecer a un dominio institucional oficial (@mep.go.cr, @qe.edu.cr o @dtpe.edu.cr).";
        }
        return null;
    }

    // Hora: si se escribió algo, debe reconocerse como hora
    if (campo.normalizar === "hora") {
        if (!/\d/.test(v) || !/(a\.m\.|p\.m\.|m\.d\.)/i.test(v)) {
            return "«" + nombre + "» no se reconoce como hora. Use el formato regional: 8:00 a.m., 2:00 p.m. o rangos como 8:00 a.m. – 12:00 m.d.";
        }
    }

    // Texto sospechoso / basura
    const sospecha = textoSuspicioso(v);
    if (sospecha) return "«" + nombre + "»: " + sospecha;

    // Títulos y nombres: deben iniciar con letra o número (evita símbolos sueltos)
    if ((campo.normalizar === "titulo" || campo.normalizar === "nombre") && !/^[\p{L}\p{N}]/u.test(v)) {
        return "«" + nombre + "» debe comenzar con una letra o un número, no con símbolos.";
    }

    return null;
}

/* Recorre todo el formulario del editor: normaliza cada campo, devuelve los
   errores encontrados y deja mensajes visuales bajo cada campo. */
function procesarFormularioEditor(cfg, mostrarMensajes) {
    const doc = {};
    const errores = [];
    cfg.campos.forEach(c => {
        const el = document.getElementById("ef-" + c.clave);
        if (!el) return;
        const normalizado = normalizarValor(c, el.value);
        if (normalizado !== el.value) el.value = normalizado; // formateo automático en vivo
        doc[c.clave] = normalizado;
    });
    cfg.campos.forEach(c => {
        const el = document.getElementById("ef-" + c.clave);
        if (!el) return;
        const err = validarCampo(c, doc[c.clave] == null ? "" : String(doc[c.clave]), doc);
        if (mostrarMensajes) pintarErrorCampo(el, err);
        if (err) errores.push(err);
    });
    return { doc: doc, errores: errores };
}

// Pinta / limpia el mensaje de error visual debajo de un campo del modal.
function pintarErrorCampo(el, msg) {
    const cont = el.closest("[data-campo-cont]");
    const errEl = cont ? cont.querySelector("[data-error]"): null;
    const aviso = cont ? cont.querySelector("[data-aviso]") : null;
    if (msg) {
        el.classList.add("campo-invalido");
        el.classList.remove("campo-valido");
        el.setAttribute("aria-invalid", "true");
        if (errEl) { errEl.textContent = msg; errEl.classList.remove("hidden"); }
        if (aviso) aviso.classList.add("hidden");
    } else {
        el.classList.remove("campo-invalido");
        el.setAttribute("aria-invalid", "false");
        if (el.value != null && String(el.value).trim() !== "") el.classList.add("campo-valido");
        else el.classList.remove("campo-valido");
        if (errEl) { errEl.textContent = ""; errEl.classList.add("hidden"); }
        if (aviso && el.value && String(el.value).trim() !== "") aviso.classList.remove("hidden");
    }
}

// Habilita o bloquea el botón «Guardar» del modal según el estado del formulario.
function actualizarBotonGuardarEditor() {
    const btn = document.getElementById("btnGuardarEditor");
    if (!btn || btn.disabled === true && btn.getAttribute("data-ocupado") === "1") return;
    const cfg = configDeEditor();
    if (!cfg) return;
    const r = procesarFormularioEditor(cfg, false);
    const bloqueado = r.errores.length > 0;
    btn.disabled = bloqueado;
    btn.classList.toggle("btn-bloqueado", bloqueado);
    const pista = document.getElementById("ef-pista-validacion");
    if (pista) {
        if (bloqueado) {
            pista.textContent = "⚠ Revise los campos marcados: " + r.errores.length + (r.errores.length === 1 ? " detalle pendiente" : " detalles pendientes") + ". El botón Guardar se habilita al corregirlos.";
            pista.classList.remove("hidden");
        } else {
            pista.classList.add("hidden");
        }
    }
}

// Enlazado de eventos de validación en vivo dentro del modal del editor.
function activarValidacionEnVivoEditor() {
    const form = document.getElementById("editorForm");
    if (!form) return;
    form.querySelectorAll("[id^='ef-']").forEach(el => {
        if (el.dataset.validado === "1") return;
        el.dataset.validado = "1";
        const evento = (el.tagName === "SELECT" || el.type === "date" || el.type === "checkbox") ? "change" : "input";
        el.addEventListener(evento, () => {
            const clave = el.id.replace(/^ef-/, "");
            const cfg = configDeEditor();
            if (!cfg) return;
            const campo = cfg.campos.find(c => c.clave === clave);
            if (campo) {
                const norm = normalizarValor(campo, el.value);
                if (clave !== "fechaFin" && clave !== "fecha" && norm !== el.value) el.value = norm;
                const docTemp = {};
                cfg.campos.forEach(c => { const e2 = document.getElementById("ef-" + c.clave); if (e2) docTemp[c.clave] = e2.value; });
                const err = validarCampo(campo, el.value, docTemp);
                pintarErrorCampo(el, err);
                if (campo.noAnteriorQue) {
                    const base = document.getElementById("ef-" + campo.noAnteriorQue);
                    if (base) {
                        const errBase = validarCampo({ ...campo, noAnteriorQue: null }, base.value, docTemp);
                        pintarErrorCampo(base, errBase);
                    }
                }
            }
            crearContadorCaracteres(el);
            actualizarBotonGuardarEditor();
        });
        el.addEventListener("blur", () => {
            const clave = el.id.replace(/^ef-/, "");
            const cfg = configDeEditor();
            if (!cfg) return;
            const campo = cfg.campos.find(c => c.clave === clave);
            if (!campo) return;
            const norm = normalizarValor(campo, el.value);
            if (norm !== el.value) el.value = norm;
            const docTemp = {};
            cfg.campos.forEach(c => { const e2 = document.getElementById("ef-" + c.clave); if (e2) docTemp[c.clave] = e2.value; });
            pintarErrorCampo(el, validarCampo(campo, el.value, docTemp));
            actualizarBotonGuardarEditor();
        });
    });
    actualizarBotonGuardarEditor();
}

// Contador de caracteres para campos con límite máximo.
function crearContadorCaracteres(el) {
    const cont = el.closest("[data-campo-cont]");
    const contador = cont ? cont.querySelector("[data-contador]") : null;
    if (!contador) return;
    const max = parseInt(contador.getAttribute("data-max"), 10) || 0;
    const len = String(el.value || "").length;
    contador.textContent = len + " / " + max + " caracteres";
    contador.classList.toggle("text-red-600", max > 0 && len > max);
    contador.classList.toggle("text-emerald-600", max > 0 && len > 0 && len <= max);
}
function aplicarAnio() {
    const anio = String(config.anio || new Date().getFullYear());
    document.querySelectorAll(".anio-dinamico").forEach(el => { el.textContent = anio; });
    document.title = "Programación Anual DREC-" + anio + " | DRE Cañas · MEP";
    calAnio = parseInt(anio, 10) || calAnio;
}

function showToast(msg, type) {
    type = type || "info";
    const container = $("toastContainer");
    if (!container) return;
    const colors = { success: "bg-emerald-600", warning: "bg-amber-600", danger: "bg-mep-red", info: "bg-mep-blue" };
    const toast = document.createElement("div");
    toast.className = (colors[type] || colors.info) + " text-white px-4 py-3 rounded-xl shadow-xl text-xs font-bold pointer-events-auto transition-all duration-300 transform translate-y-2 opacity-0";
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.classList.remove("translate-y-2", "opacity-0"), 10);
    setTimeout(() => { toast.classList.add("opacity-0"); setTimeout(() => toast.remove(), 350); }, 3800);
}

function abrirModal(id) { const m = $(id); if (m) { m.classList.remove("hidden"); crearIconos(); } }
function cerrarModal(id) { const m = $(id); if (m) m.classList.add("hidden"); }

function mostrarErrorLogin(msg) {
    const el = $("loginError");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
}

/* ==================== SEGURIDAD / VISIBILIDAD ==================== */
// Los usuarios en Modo Lectura (públicos, sin credenciales) solo ven
// actividades publicadas y solo si la programación está publicada
// oficialmente por la administración.
function actividadesVisibles() {
    if (esAdmin()) return dbActividades;
    if (config.publicado === false) return [];
    return dbActividades.filter(a => a.estado === "publicada");
}
function directorioVisible() {
    if (esAdmin()) return dbDirectorio;
    if (config.publicado === false) return [];
    return dbDirectorio;
}
function registrosDe(modulo) {
    if (modulo.coleccion === COLECCIONES.directorio) return directorioVisible();
    return actividadesVisibles().filter(a => a.modulo === modulo.id);
}
function registroDe(modulo, id) {
    const lista = modulo.coleccion === COLECCIONES.directorio ? dbDirectorio : dbActividades;
    return lista.find(r => String(r.id) === String(id));
}

/* ==================== FIREBASE / AUTENTICACIÓN ==================== */
function iniciarFirebase() {
    try {
        const ok = firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith("PEGA_AQUI") &&
                  firebaseConfig.projectId && !String(firebaseConfig.projectId).startsWith("PEGA_AQUI") &&
                  firebaseConfig.appId && !String(firebaseConfig.appId).startsWith("PEGA_AQUI");
        if (!ok) {
            MODO_DEMO = true;
            const demo = $("loginDemo"), info = $("loginInfo"), rec = $("btnRecuperar");
            if (demo) demo.classList.remove("hidden");
            if (info) {
                info.textContent = "Modo demostración: Firebase no está configurado aún. Use los accesos de demostración o configure firebaseConfig en script.js.";
                info.classList.remove("hidden");
            }
            if (rec) rec.classList.add("hidden");
            const status = $("firebaseStatus");
            if (status) {
                status.textContent = "Modo demo";
                status.className = "chip chip-demo";
            }
            return;
        }
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        firebaseDB = firebase.firestore();
        firebaseAuth = firebase.auth();
        const status = $("firebaseStatus");
        if (status) {
            status.textContent = "Firebase: conectado";
            status.className = "chip chip-vivo";
        }
        firebaseAuth.onAuthStateChanged(manejarAuthState);
    } catch (e) {
        console.error("Error iniciando Firebase:", e);
        MODO_DEMO = true;
        const demo = $("loginDemo");
        if (demo) demo.classList.remove("hidden");
    }
}

async function manejarAuthState(user) {
    if (!user) {
        // Sin sesión administrativa: la aplicación permanece abierta al público
        // en Modo Lectura (no se exige iniciar sesión para consultar).
        detenerSincronizacion();
        entrarModoLectura(true);
        return;
    }
    try {
        const ref = firebaseDB.collection(COLECCIONES.usuarios).doc(user.uid);
        const snap = await ref.get();
        if (snap.exists) {
            const datos = snap.data();
            if (datos.activo === false) {
                await firebaseAuth.signOut();
                mostrarErrorLogin("Su cuenta está desactivada. Contacte a la administración regional.");
                return;
            }
            // El inicio de sesión gestiona ÚNICAMENTE cuentas de Administrador.
            if (datos.rol !== "admin") {
                await firebaseAuth.signOut();
                mostrarErrorLogin("Este acceso es exclusivo para cuentas de Administrador. Los demás usuarios consultan la información en Modo Lectura sin iniciar sesión.");
                return;
            }
            currentUser = { uid: user.uid, nombre: datos.nombre || user.email, email: datos.email || user.email, rol: "admin", activo: true };
            cerrarBootstrap(); // blindaje: el sistema ya tiene administración → se cierra el auto-registro inicial
        } else {
            // Bootstrap: si no hay usuarios registrados, el primer inicio de sesión es admin
            const total = await firebaseDB.collection(COLECCIONES.usuarios).limit(1).get();
            if (total.empty) {
                await ref.set({ nombre: user.email, email: user.email, uid: user.uid, rol: "admin", activo: true, fechaCreacion: new Date().toISOString(), creadoPor: "Autorregistro inicial (primer acceso)", creadoPorUid: user.uid });
                currentUser = { uid: user.uid, nombre: user.email, email: user.email, rol: "admin", activo: true };
                await cerrarBootstrap(); // el sistema ya tiene administración: se cierra el auto-registro para siempre
                showToast("Primer usuario registrado automáticamente como Administrador.", "success");
            } else {
                await firebaseAuth.signOut();
                mostrarErrorLogin("Su cuenta no tiene rol de Administrador. Los demás usuarios consultan la información en Modo Lectura sin iniciar sesión.");
                return;
            }
        }
        postLogin();
    } catch (e) {
        console.error("Error verificando autorización:", e);
        mostrarErrorLogin("No se pudo verificar su autorización. Revise las reglas de Firestore.");
    }
}

/* Blindaje del bootstrap: deja constancia en Firestore (documento
   «drec_configuracion/bootstrap_cerrado») de que el sistema ya tiene
   administración. Mientras ese documento NO exista, las reglas de seguridad
   permiten que el primer usuario se auto-registre como administrador; en
   cuanto existe, las reglas CIERRAN ese auto-registro de forma permanente y
   solo un administrador puede dar de alta cuentas desde la aplicación. Así,
   nadie con una simple cuenta de Firebase Authentication puede fabricarse
   un documento de administrador. La escritura es única (solo ocurre si el
   documento no existe) y nunca interrumpe el inicio de sesión. */
async function cerrarBootstrap() {
    if (MODO_DEMO || !firebaseDB || !currentUser || currentUser.rol !== "admin") return;
    try {
        const refMarcador = firebaseDB.collection(COLECCIONES.config).doc("bootstrap_cerrado");
        const snap = await refMarcador.get();
        if (!snap.exists) {
            await refMarcador.set({ cerrado: true, cerradoPor: currentUser.nombre, cerradoPorUid: currentUser.uid, fecha: new Date().toISOString() });
        }
    } catch (e) {
        console.warn("No se pudo registrar el cierre del bootstrap:", e);
    }
}

async function iniciarSesion() {
    const email = $("loginEmail").value.trim();
    const pass = $("loginPassword").value;
    $("loginError").classList.add("hidden");
    if (MODO_DEMO) {
        showToast("Modo demostración: use los botones de acceso demo.", "warning");
        return;
    }
    try {
        await firebaseAuth.signInWithEmailAndPassword(email, pass);
    } catch (e) {
        const codigos = {
            "auth/invalid-credential": "Correo o contraseña incorrectos.",
            "auth/wrong-password": "Contraseña incorrecta.",
            "auth/user-not-found": "No existe una cuenta con ese correo.",
            "auth/too-many-requests": "Demasiados intentos. Intente más tarde."
        };
        mostrarErrorLogin(codigos[e.code] || "No se pudo iniciar sesión (" + (e.code || e.message) + ").");
    }
}

async function recuperarContrasena() {
    const email = $("loginEmail").value.trim();
    if (!email) { mostrarErrorLogin("Escriba su correo institucional para enviar el enlace de restablecimiento."); return; }
    if (MODO_DEMO) { showToast("Modo demostración: no hay contraseñas reales.", "warning"); return; }
    try {
        await firebaseAuth.sendPasswordResetEmail(email);
        showToast("Enlace de restablecimiento enviado a " + email + ".", "success");
    } catch (e) {
        mostrarErrorLogin("No se pudo enviar el enlace (" + (e.code || e.message) + ").");
    }
}

function iniciarSesionDemo(rol) {
    if (!MODO_DEMO) { showToast("Firebase ya está configurado: use su cuenta institucional.", "warning"); return; }
    if (rol !== "admin") { cerrarLoginPublico(); return; } // el acceso público ya está en Modo Lectura
    currentUser = {
        uid: "demo-admin",
        nombre: "Administrador(a) Demo",
        email: "admin.demo@drec.local",
        rol: "admin",
        activo: true
    };
    postLogin();
}

/* ==================== ACCESO PÚBLICO EN MODO LECTURA ==================== */
// Cualquier visitante entra automáticamente a consultar la programación
// (cronograma, actividades, directorio, etc.) con un rol estricto de
// SOLO LECTURA, sin credenciales y sin botones de administración.
function entrarModoLectura(silencioso) {
    detenerSincronizacion();
    currentUser = {
        uid: "publico",
        nombre: "Modo Lectura",
        email: "",
        rol: "lectura",
        activo: true
    };
    postLogin(silencioso);
}

// Muestra el panel de autenticación (exclusivo para Administradores).
function abrirLoginPublico() {
    $("loginError").classList.add("hidden");
    const scr = $("loginScreen");
    if (scr) scr.classList.remove("hidden");
    crearIconos();
    try { $("loginEmail").focus(); } catch (e) {}
}

// Cierra el panel de autenticación y continúa en Modo Lectura.
function cerrarLoginPublico() {
    const scr = $("loginScreen");
    if (scr) scr.classList.add("hidden");
    $("loginError").classList.add("hidden");
    showToast("Continúa en Modo Lectura (solo consulta).", "info");
}

// Alterna en la barra superior el botón «Iniciar sesión» (visitante en
// Modo Lectura) o el chip de usuario con salida (Administrador con sesión).
function actualizarHeaderSesion() {
    const btnLogin = $("btnHeaderLogin");
    const chip = $("userChipWrap");
    const admin = esAdmin();
    if (btnLogin) btnLogin.classList.toggle("hidden", admin);
    if (chip) chip.classList.toggle("hidden", !admin);
    if (admin && currentUser) $("userName").textContent = currentUser.nombre;
}

async function cerrarSesion() {
    if (MODO_DEMO && esAdmin()) {
        entrarModoLectura();
        showToast("Sesión de administración cerrada. Continúa en Modo Lectura.", "info");
        return;
    }
    try { await firebaseAuth.signOut(); } catch (e) { console.error(e); }
    // onAuthStateChanged devuelve automáticamente al Modo Lectura público.
    if (MODO_DEMO) entrarModoLectura();
}

function postLogin(silencioso) {
    // Si hay un mensaje de error visible en el panel de autenticación (p. ej.
    // un intento de inicio de sesión rechazado), se mantiene abierto para que
    // el administrador pueda leerlo; el Modo Lectura sigue activo detrás.
    const errLogin = $("loginError");
    if (!errLogin || errLogin.classList.contains("hidden")) {
        $("loginScreen").classList.add("hidden");
    }
    $("appShell").classList.remove("hidden");
    $("roleBadge").textContent = "Rol: " + (currentUser.rol === "admin" ? "Administrador" : "Solo Lectura");
    // «asesor» se conserva SOLO como llave interna de CSS (style.css oculta
    // los controles de administración con [data-rol="asesor"]). En pantalla
    // el rol siempre se muestra como «Solo Lectura».
    document.body.setAttribute("data-rol", currentUser.rol === "admin" ? "admin" : "asesor");
    actualizarHeaderSesion();
    const bannerDemo = $("bannerDemo");
    if (bannerDemo) bannerDemo.classList.toggle("hidden", !MODO_DEMO);
    const cardDemo = $("cardDatosDemo");
    if (cardDemo) cardDemo.classList.toggle("hidden", !(MODO_DEMO && esAdmin()));
    calAnio = parseInt(config.anio, 10) || new Date().getFullYear();
    calMes = new Date().getMonth();
    calDiaSel = null;
    construirNav();
    construirSecciones();
    if (MODO_DEMO) {
        refrescarTodo();
    } else {
        escucharDatos();
    }
    switchTab("inicio");
    crearIconos();
    showToast(esAdmin()
        ? "Bienvenido(a), " + currentUser.nombre + " (Administrador)."
        : "Está consultando la Programación Anual en Modo de Solo Lectura.", "info");
}

function detenerSincronizacion() {
    unsubsTiempoReal.forEach(u => { try { u(); } catch (e) {} });
    unsubsTiempoReal = [];
}

/* ==================== SINCRONIZACIÓN EN TIEMPO REAL (FIRESTORE) ==================== */
function escucharDatos() {
    if (!firebaseDB || unsubsTiempoReal.length > 0) return;
    const status = $("firebaseStatus");
    if (status) {
        status.textContent = "Firebase: en vivo";
        status.className = "chip chip-vivo";
    }
    unsubsTiempoReal.push(firebaseDB.collection(COLECCIONES.actividades).onSnapshot(snap => {
        dbActividades = [];
        snap.forEach(d => dbActividades.push(Object.assign({ id: d.id }, d.data())));
        dbActividades.sort((a, b) => String(a.fecha || "").localeCompare(String(b.fecha || "")));
        refrescarTodo();
    }, err => { console.error("Actividades:", err); showToast("No se pudieron cargar las actividades. Si está en Modo Lectura sin sesión, publique en Firestore las reglas con lectura pública (allow read: if true).", "danger"); }));

    unsubsTiempoReal.push(firebaseDB.collection(COLECCIONES.directorio).onSnapshot(snap => {
        dbDirectorio = [];
        snap.forEach(d => dbDirectorio.push(Object.assign({ id: d.id }, d.data())));
        dbDirectorio.sort((a, b) => String(a.departamento || "").localeCompare(String(b.departamento || "")));
        refrescarTodo();
    }, err => { console.error("Directorio:", err); showToast("Se perdió la sincronización del directorio.", "warning"); }));

    unsubsTiempoReal.push(firebaseDB.collection(COLECCIONES.config).doc("sistema").onSnapshot(d => {
        if (d.exists) config = Object.assign({ anio: new Date().getFullYear(), version: "Vs.001", publicado: true, saludo: "", firma: "", ideasRectoras: [] }, d.data());
        refrescarTodo();
    }, err => console.error("Configuración:", err)));

    if (esAdmin()) {
        unsubsTiempoReal.push(firebaseDB.collection(COLECCIONES.usuarios).onSnapshot(snap => {
            dbUsuarios = [];
            snap.forEach(d => dbUsuarios.push(Object.assign({ id: d.id }, d.data())));
            // Sincronización en vivo para el usuario con sesión iniciada: si otro
            // administrador cambió su rol, su nombre, lo desactivó o lo eliminó,
            // se refleja al instante (o se cierra su sesión si ya no está autorizado).
            if (currentUser && !MODO_DEMO) {
                const mio = dbUsuarios.find(u => String(u.uid) === String(currentUser.uid));
                if (!mio || mio.activo === false) {
                    showToast("Su cuenta fue desactivada o eliminada por otro administrador. Se cerrará su sesión.", "danger");
                    cerrarSesion();
                    return;
                }
                currentUser.nombre = mio.nombre || currentUser.nombre;
                currentUser.email = mio.email || currentUser.email;
                // El inicio de sesión es exclusivo para Administradores: si otro
                // administrador le quitó el rol, se cierra la sesión y se vuelve
                // al Modo Lectura público.
                if (mio.rol !== "admin") {
                    showToast("Su cuenta ya no tiene rol de Administrador. Se cerrará su sesión.", "danger");
                    cerrarSesion();
                    return;
                }
                if (currentUser.rol === "admin") {
                    $("userName").textContent = currentUser.nombre;
                    renderConfiguracion();
                }
            } else {
                renderConfiguracion();
            }
        }, err => { console.error("Usuarios:", err); showToast("Se perdió la sincronización de usuarios. Revise conexión y reglas de Firestore.", "danger"); }));
    }
}

/* Respaldo preventivo de integridad: revisa las claves del documento contra
   el catálogo oficial y los formatos exigidos, sin importar el origen de la
   escritura (formulario, registro parcial o datos heredados). Devuelve la
   lista de infracciones; si no está vacía, la escritura se bloquea. */
function validarDocData(coleccion, doc) {
    const errs = [];
    if (!doc || typeof doc !== "object") return ["Documento inválido."];
    const textoClaves = ["titulo", "departamento", "funcionario", "puesto", "centro", "facilitador", "compromiso", "nivel", "disciplina", "responsable", "sede", "participantes"];
    textoClaves.forEach(k => {
        if (doc[k] == null || String(doc[k]).trim() === "") return;
        const v = String(doc[k]);
        if (v.length > 250) errs.push("El campo «" + k + "» supera los 250 caracteres permitidos.");
        const sospecha = textoSuspicioso(v);
        if (sospecha) errs.push("El campo «" + k + "»: " + sospecha);
    });
    ["fecha", "fechaFin"].forEach(k => {
        if (doc[k] == null || String(doc[k]).trim() === "") return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(doc[k]))) errs.push("La fecha «" + k + "» no tiene formato AAAA-MM-DD.");
    });
    if (doc.fecha && doc.fechaFin && /^\d{4}-\d{2}-\d{2}$/.test(String(doc.fecha)) && /^\d{4}-\d{2}-\d{2}$/.test(String(doc.fechaFin)) && String(doc.fechaFin) < String(doc.fecha)) {
        errs.push("La fecha final («" + fmtFecha(doc.fechaFin) + "») es anterior a la fecha inicial («" + fmtFecha(doc.fecha) + "»).");
    }
    if (doc.telefono != null && String(doc.telefono).trim() !== "" && !esTelefonoValidoCr(String(doc.telefono), true)) {
        errs.push("El teléfono «" + doc.telefono + "» no cumple el formato costarricense (8 dígitos tipo 2695-5151 o extensión).");
    }
    if (doc.extension != null && String(doc.extension).trim() !== "" && !RE_EXTENSION_CR.test(String(doc.extension).trim())) {
        errs.push("La extensión «" + doc.extension + "» debe tener únicamente de 2 a 5 dígitos.");
    }
    if (doc.correo != null && String(doc.correo).trim() !== "" && clasificarCorreo(doc.correo) === "invalido") {
        errs.push("El correo «" + doc.correo + "» no tiene un formato válido.");
    }
    if (doc.circuito != null && String(doc.circuito).trim() !== "" && CIRCUITOS_OFICIALES.indexOf(String(doc.circuito).trim()) === -1) {
        errs.push("El circuito «" + doc.circuito + "» no pertenece al catálogo oficial de la DRE Cañas.");
    }
    Object.values(MODULOS).forEach(m => {
        if (m.coleccion !== coleccion) return;
        (m.campos || []).forEach(c => {
            if (c.tipo !== "select") return;
            const v = doc[c.clave];
            if (v == null || String(v).trim() === "") return;
            const permitidas = c.catalogo || c.opciones || [];
            if (permitidas.indexOf(String(v).trim()) === -1) errs.push("«" + c.etiqueta + "» con valor «" + v + "» no es una opción oficial del catálogo.");
        });
    });
    return errs;
}

/* ==================== ESCRITURA DE DATOS ==================== */
function guardarDoc(coleccion, doc) {
    // Integridad garantizada: ningún dato con formato inválido llega a Firestore/LocalStorage.
    const bloqueos = validarDocData(coleccion, doc);
    if (bloqueos.length > 0) {
        console.warn("Escritura bloqueada por reglas de integridad de datos:", bloqueos);
        if ($("ef-error")) mostrarErrorEditor("No se pudo guardar por problemas de integridad: " + bloqueos[0]);
        else showToast("No se pudo guardar por problemas de integridad: " + bloqueos[0], "danger");
        return Promise.resolve(false);
    }
    if (MODO_DEMO) {
        if (coleccion === COLECCIONES.actividades) {
            const i = dbActividades.findIndex(a => String(a.id) === String(doc.id));
            if (i >= 0) dbActividades[i] = Object.assign({}, dbActividades[i], doc); else dbActividades.push(doc);
        } else if (coleccion === COLECCIONES.directorio) {
            const i = dbDirectorio.findIndex(a => String(a.id) === String(doc.id));
            if (i >= 0) dbDirectorio[i] = Object.assign({}, dbDirectorio[i], doc); else dbDirectorio.push(doc);
        } else if (coleccion === COLECCIONES.usuarios) {
            const i = dbUsuarios.findIndex(a => String(a.uid) === String(doc.uid));
            if (i >= 0) dbUsuarios[i] = Object.assign({}, dbUsuarios[i], doc); else dbUsuarios.push(doc);
        }
        persistirDemo();
        refrescarTodo();
        return Promise.resolve(true);
    }
    return firebaseDB.collection(coleccion).doc(String(doc.id)).set(doc, { merge: true })
        .then(() => true)
        .catch(e => {
            console.error("Error guardando en " + coleccion + ":", e);
            let extra = "";
            if (e.code === "permission-denied") {
                extra = coleccion === COLECCIONES.usuarios
                    ? "Firestore rechazó la escritura: publique las reglas de seguridad actualizadas (bloque drec_usuarios con «allow create/update: if esAdmin()»)."
                    : "Revise las reglas de Firestore publicadas.";
            }
            showToast("No se pudo guardar (" + (e.code || e.message) + "). " + extra, "danger");
            return false;
        });
}

function eliminarDoc(coleccion, id) {
    if (MODO_DEMO) {
        if (coleccion === COLECCIONES.actividades) dbActividades = dbActividades.filter(a => String(a.id) !== String(id));
        if (coleccion === COLECCIONES.directorio) dbDirectorio = dbDirectorio.filter(a => String(a.id) !== String(id));
        if (coleccion === COLECCIONES.usuarios) dbUsuarios = dbUsuarios.filter(a => String(a.uid) !== String(id));
        persistirDemo();
        refrescarTodo();
        return Promise.resolve(true);
    }
    return firebaseDB.collection(coleccion).doc(String(id)).delete()
        .then(() => true)
        .catch(e => {
            console.error("Error eliminando:", e);
            showToast("No se pudo eliminar (" + (e.code || e.message) + ").", "danger");
            return false;
        });
}

function guardarConfig(nuevaConfig) {
    config = Object.assign({}, config, nuevaConfig);
    if (MODO_DEMO) {
        persistirDemo();
        refrescarTodo();
        return Promise.resolve(true);
    }
    return firebaseDB.collection(COLECCIONES.config).doc("sistema").set(config, { merge: true })
        .then(() => true)
        .catch(e => { showToast("No se pudo guardar la configuración: " + (e.code || e.message), "danger"); return false; });
}

/* ==================== MODO DEMO (LOCALSTORAGE) ==================== */
const DEMO_KEYS = {
    actividades: "drec_demo_actividades",
    directorio: "drec_demo_directorio",
    usuarios: "drec_demo_usuarios",
    config: "drec_demo_config"
};

function persistirDemo() {
    if (!MODO_DEMO) return;
    try {
        localStorage.setItem(DEMO_KEYS.actividades, JSON.stringify(dbActividades));
        localStorage.setItem(DEMO_KEYS.directorio, JSON.stringify(dbDirectorio));
        localStorage.setItem(DEMO_KEYS.usuarios, JSON.stringify(dbUsuarios));
        localStorage.setItem(DEMO_KEYS.config, JSON.stringify(config));
    } catch (e) { console.warn("No se pudo persistir el modo demo:", e); }
}

function cargarDatosDemo() {
    try {
        const a = localStorage.getItem(DEMO_KEYS.actividades);
        const d = localStorage.getItem(DEMO_KEYS.directorio);
        const u = localStorage.getItem(DEMO_KEYS.usuarios);
        const c = localStorage.getItem(DEMO_KEYS.config);
        if (a) dbActividades = JSON.parse(a);
        if (d) dbDirectorio = JSON.parse(d);
        if (u) dbUsuarios = JSON.parse(u);
        if (c) config = Object.assign(config, JSON.parse(c));
        if (!a && !d) sembrarDatosDemo(); // primera vez: datos de ejemplo
    } catch (e) {
        console.error("Error cargando datos demo:", e);
        sembrarDatosDemo();
    }
}

function restaurarDemo() {
    if (!MODO_DEMO) { showToast("Disponible solo en modo demostración.", "warning"); return; }
    sembrarDatosDemo();
    persistirDemo();
    refrescarTodo();
    showToast("Datos de ejemplo restaurados.", "success");
}

function borrarTodoDemo() {
    if (!MODO_DEMO) { showToast("Disponible solo en modo demostración.", "warning"); return; }
    if (!confirm("¿Borrar TODOS los datos guardados en este navegador? Esta acción no se puede deshacer.")) return;
    dbActividades = [];
    dbDirectorio = [];
    config = { anio: new Date().getFullYear(), version: "Vs.001", publicado: true, saludo: "", firma: "", ideasRectoras: [] };
    persistirDemo();
    refrescarTodo();
    showToast("Datos borrados.", "info");
}

function sembrarDatosDemo() {
    const A = [];
    let n = 0;
    const act = (modulo, o) => {
        n++;
        A.push(Object.assign({ id: "DEMO-" + String(n).padStart(3, "0"), modulo: modulo, estado: "publicada" }, o));
    };
    // Semanas y días celebrativos
    act("celebrativos", { titulo: "Semana de la Familia", tipo: "Semana", fecha: "2026-05-11", fechaFin: "2026-05-15", circuito: "Regional (todos)", descripcion: "Actividades lúdico-recreativas en los centros educativos." });
    act("celebrativos", { titulo: "Semana de la Nutrición", tipo: "Semana", fecha: "2026-06-01", fechaFin: "2026-06-05", circuito: "Regional (todos)" });
    act("celebrativos", { titulo: "Semana de la Salud Mental", tipo: "Semana", fecha: "2026-08-31", fechaFin: "2026-09-04", circuito: "Regional (todos)" });
    act("celebrativos", { titulo: "Semana de Orientación", tipo: "Semana", fecha: "2026-09-07", fechaFin: "2026-09-11", circuito: "Regional (todos)" });
    act("celebrativos", { titulo: "Día del Maestro", tipo: "Día Celebrativo", fecha: "2026-11-22", circuito: "Regional (todos)" });
    // Ferias y festivales (FEA: etapas y circuitos 01–05)
    act("ferias_festivales", { titulo: "Festival Estudiantil de las Artes (FEA) · Etapa Institucional", etapa: "Institucional", circuito: "Regional (todos)", fecha: "2026-03-09", fechaFin: "2026-03-27", sede: "Todos los centros educativos", participantes: "Estudiantes de I a VI de Primaria y de I a VI de Secundaria" });
    act("ferias_festivales", { titulo: "FEA · Etapa de Circuito", etapa: "Circuito", circuito: "Circuito 01 (Cañas)", fecha: "2026-04-13", fechaFin: "2026-04-15", sede: "C.T.P Cañas", hora: "8:00 a.m." });
    act("ferias_festivales", { titulo: "FEA · Etapa de Circuito", etapa: "Circuito", circuito: "Circuito 02 (Abangares)", fecha: "2026-04-13", fechaFin: "2026-04-15", sede: "CTP de Abangares", hora: "8:00 a.m." });
    act("ferias_festivales", { titulo: "FEA · Etapa de Circuito", etapa: "Circuito", circuito: "Circuito 03 (Tilarán)", fecha: "2026-04-20", fechaFin: "2026-04-22", sede: "Liceo Maurilio Alvarado Vargas", hora: "8:00 a.m." });
    act("ferias_festivales", { titulo: "FEA · Etapa de Circuito", etapa: "Circuito", circuito: "Circuito 04 (Colorado)", fecha: "2026-04-20", fechaFin: "2026-04-22", sede: "Liceo de Colorado", hora: "8:00 a.m." });
    act("ferias_festivales", { titulo: "FEA · Etapa de Circuito", etapa: "Circuito", circuito: "Circuito 05 (La Altura)", fecha: "2026-04-27", fechaFin: "2026-04-29", sede: "Colegio San Rafael", hora: "8:00 a.m." });
    act("ferias_festivales", { titulo: "FEA · Etapa Regional DRE Cañas", etapa: "Regional", circuito: "Regional (todos)", fecha: "2026-05-25", fechaFin: "2026-05-28", sede: "Por confirmar", participantes: "Delegaciones de los cinco circuitos" });
    act("ferias_festivales", { titulo: "Feria de Ciencias y Tecnología · Etapa Regional", etapa: "Regional", circuito: "Regional (todos)", fecha: "2026-08-17", fechaFin: "2026-08-19", sede: "Gimnasio Municipal de Cañas" });
    // Pruebas académicas y períodos lectivos
    act("pruebas_academicas", { titulo: "Apertura del I Período Lectivo", modalidad: "Educación Formal", periodo: "I Período", fecha: "2026-02-09", fechaFin: "2026-02-09" });
    act("pruebas_academicas", { titulo: "Cierre del I Período y pruebas trimestrales", modalidad: "Educación Formal", periodo: "I Período", fecha: "2026-05-18", fechaFin: "2026-05-29" });
    act("pruebas_academicas", { titulo: "Apertura del II Período Lectivo", modalidad: "Educación Formal", periodo: "II Período", fecha: "2026-06-08", fechaFin: "2026-06-08" });
    act("pruebas_academicas", { titulo: "Período de pruebas CINDEA (meses de matrícula)", modalidad: "CINDEA", periodo: "", fecha: "2026-06-01", fechaFin: "2026-06-19", sede: "CINDEA de cada circuito" });
    act("pruebas_academicas", { titulo: "Pruebas de diagnóstico IPEC", modalidad: "IPEC", periodo: "", fecha: "2026-03-02", fechaFin: "2026-03-06", sede: "IPEC Cañas" });
    act("pruebas_academicas", { titulo: "Pruebas de aprovechamiento TP", modalidad: "Técnico Profesional (TP)", periodo: "II Período", fecha: "2026-09-14", fechaFin: "2026-09-25" });
    // Pruebas estandarizadas
    act("pruebas_estandarizadas", { titulo: "Pruebas nacionales de Bachillerato · Convocatoria", etapa: "Convocatoria", nivel: "Educación Diversificada", fecha: "2026-10-05", fechaFin: "2026-10-16", sede: "Aulas autorizadas por circuito" });
    act("pruebas_estandarizadas", { titulo: "Pruebas nacionales de Sexto Grado", etapa: "Prueba Nacional", nivel: "Primaria (VI grado)", fecha: "2026-11-09", fechaFin: "2026-11-13" });
    act("pruebas_estandarizadas", { titulo: "Pruebas de Ampliación · Convocatoria extraordinaria", etapa: "Ampliación", nivel: "Diversificada", fecha: "2026-12-07", fechaFin: "2026-12-11" });
    // Juegos deportivos estudiantiles
    act("deportivos", { titulo: "Inscripción de delegaciones institucionales", disciplina: "Todas", fase: "Inscripción", fecha: "2026-03-02", fechaFin: "2026-03-13" });
    act("deportivos", { titulo: "Fase institucional · Ajedrez", disciplina: "Ajedrez", fase: "Institucional", fecha: "2026-04-06", fechaFin: "2026-04-10" });
    act("deportivos", { titulo: "Fase de circuitos · Atletismo", disciplina: "Atletismo", fase: "Circuitos", fecha: "2026-05-04", fechaFin: "2026-05-08", sede: "Estadio de Cañas" });
    act("deportivos", { titulo: "Fase interregional · Fútbol", disciplina: "Fútbol", fase: "Interregional", fecha: "2026-07-20", fechaFin: "2026-07-24", sede: "Sede interregional (por definir)" });
    act("deportivos", { titulo: "Fase nacional · Fútbol sala", disciplina: "Fútbol sala", fase: "Nacional", fecha: "2026-09-28", fechaFin: "2026-10-02" });
    // CTP y módulos técnicos y especiales (CTP, CINDEA, IPEC)
    act("ctp_tecnicos", { titulo: "Matrícula y apertura de módulos nocturnos (CINDEA e IPEC)", centro: "CINDEA e IPEC de la región", modalidad: "CINDEA", circuito: "Regional (todos)", fecha: "2026-01-26", fechaFin: "2026-02-06", responsable: "Departamento de Educación de Jóvenes y Adultos" });
    act("ctp_tecnicos", { titulo: "Supervisión técnica pedagógica a los CTP de los circuitos", centro: "C.T.P de la región", modalidad: "CTP Diurno", circuito: "Regional (todos)", fecha: "2026-03-16", fechaFin: "2026-04-10", responsable: "Asesoría de Educación Técnica" });
    act("ctp_tecnicos", { titulo: "Feria técnica y vocional estudiantil", centro: "C.T.P Cañas", modalidad: "CTP Diurno", circuito: "Circuito 01 (Cañas)", fecha: "2026-05-20", hora: "9:00 a.m.", sede: "C.T.P Cañas", participantes: "Estudiantes de III ciclo y educación diversificada" });
    act("ctp_tecnicos", { titulo: "Aplicación de pruebas de aprovechamiento en modalidad nocturna", centro: "IPEC Cañas", modalidad: "IPEC", circuito: "Circuito 01 (Cañas)", fecha: "2026-09-07", fechaFin: "2026-09-18" });
    // Permanencia
    act("permanencia", { titulo: "Sesiones ordinarias de los Equipos de Retención Permanente (ERP)", estrategia: "ERP", fecha: "2026-03-18", hora: "9:00 a.m.", sede: "Sala de reuniones DREC", responsable: "Departamento de Permanencia" });
    act("permanencia", { titulo: "Mesa técnica interinstitucional EPI", estrategia: "EPI", fecha: "2026-04-15", hora: "2:00 p.m.", sede: "Dirección Regional", responsable: "Asesoría Regional" });
    act("permanencia", { titulo: "Aplicación del protocolo UPRE en centros educativos", estrategia: "UPRE", fecha: "2026-05-06", fechaFin: "2026-05-29", participantes: "Equipos institucionales" });
    act("permanencia", { titulo: "Implementación de Alerta Temprana: reporte mensual", estrategia: "Alerta Temprana", fecha: "2026-06-10", participantes: "Comités institucionales" });
    // Oferta formativa
    act("oferta_formativa", { titulo: "Taller: Planificación didáctica con enfoque de derechos", fecha: "2026-03-11", hora: "8:00 a.m. – 12:00 m.d.", sede: "Auditorio DREC", facilitador: "Asesoría Regional", participantes: "Docentes de Primaria" });
    act("oferta_formativa", { titulo: "Capacitación: Evaluación formativa y retroalimentación", fecha: "2026-05-13", hora: "1:00 p.m. – 4:00 p.m.", sede: "Sala de capacitación", facilitador: "Departamento de Evaluación", participantes: "Docentes de Secundaria" });
    act("oferta_formativa", { titulo: "Taller: Mediación pedagógica y tecnología educativa", fecha: "2026-08-12", hora: "8:00 a.m. – 3:00 p.m.", sede: "C.T.P Cañas", facilitador: "Asesoría de Informática", participantes: "Docentes de todas las modalidades" });
    // Programación mensual (ejemplos de cada mes)
    act("programacion_mensual", { titulo: "Reunión regional de directores", fecha: "2026-02-25", hora: "9:00 a.m.", sede: "Dirección Regional", compromiso: "Presentación de la Programación Anual" });
    act("programacion_mensual", { titulo: "Jornada de socialización de ideas rectoras", fecha: "2026-03-25", hora: "8:30 a.m.", sede: "Auditorio DREC", compromiso: "Acta de acuerdos" });
    act("programacion_mensual", { titulo: "Supervisión técnica de circuitos", fecha: "2026-04-08", fechaFin: "2026-04-24", sede: "Circuitos 01–05", compromiso: "Informes de supervisión" });
    act("programacion_mensual", { titulo: "Asamblea regional educativa", fecha: "2026-07-15", hora: "10:00 a.m.", sede: "Gimnasio Municipal", compromiso: "Memoria institucional" });
    act("programacion_mensual", { titulo: "Clausura del año lectivo y evaluación de la programación", fecha: "2026-12-11", hora: "9:00 a.m.", sede: "Dirección Regional", compromiso: "Informe de gestión" });

    dbActividades = A;
    dbDirectorio = [
        { id: "DEMO-D01", departamento: "Dirección Regional", funcionario: "M.Sc. Nombre Apellido I", puesto: "Directora Regional", telefono: "2695-5151", extension: "101", correo: "direccion.canas@mep.go.cr", circuito: "Dirección Regional" },
        { id: "DEMO-D02", departamento: "Subdirección Regional", funcionario: "Lic. Nombre Apellido II", puesto: "Subdirector", telefono: "2695-5151", extension: "102", correo: "subdireccion.canas@mep.go.cr", circuito: "Dirección Regional" },
        { id: "DEMO-D03", departamento: "Asesoría de Primaria", funcionario: "Lic. Nombre Apellido III", puesto: "Asesor(a) Supervisor(a)", telefono: "2695-5152", extension: "110", correo: "primaria.canas@mep.go.cr", circuito: "Dirección Regional" },
        { id: "DEMO-D04", departamento: "Asesoría de Secundaria", funcionario: "M.Sc. Nombre Apellido IV", puesto: "Asesor(a) Supervisor(a)", telefono: "2695-5152", extension: "111", correo: "secundaria.canas@mep.go.cr", circuito: "Dirección Regional" },
        { id: "DEMO-D05", departamento: "Asesoría de Educación Técnica (TP)", funcionario: "Lic. Nombre Apellido V", puesto: "Asesor(a) Supervisor(a)", telefono: "2695-5153", extension: "115", correo: "tecnica.canas@mep.go.cr", circuito: "Dirección Regional" },
        { id: "DEMO-D06", departamento: "Departamento de Permanencia", funcionario: "Lic. Nombre Apellido VI", puesto: "Coordinador(a)", telefono: "2695-5154", extension: "120", correo: "permanencia.canas@mep.go.cr", circuito: "Dirección Regional" },
        { id: "DEMO-D07", departamento: "Asesoría Circuitual 01", funcionario: "Lic. Nombre Apellido VII", puesto: "Asesor(a) Supervisor(a)", telefono: "2695-5160", extension: "201", correo: "circuito01.canas@mep.go.cr", circuito: "Circuito 01 (Cañas)" },
        { id: "DEMO-D08", departamento: "Asesoría Circuitual 02", funcionario: "Lic. Nombre Apellido VIII", puesto: "Asesor(a) Supervisor(a)", telefono: "2695-5161", extension: "202", correo: "circuito02.canas@mep.go.cr", circuito: "Circuito 02 (Abangares)" },
        { id: "DEMO-D09", departamento: "Asesoría Circuitual 03", funcionario: "M.Sc. Nombre Apellido IX", puesto: "Asesor(a) Supervisor(a)", telefono: "2695-5162", extension: "203", correo: "circuito03.canas@mep.go.cr", circuito: "Circuito 03 (Tilarán)" },
        { id: "DEMO-D10", departamento: "Asesoría Circuitual 04", funcionario: "Lic. Nombre Apellido X", puesto: "Asesor(a) Supervisor(a)", telefono: "2695-5163", extension: "204", correo: "circuito04.canas@mep.go.cr", circuito: "Circuito 04 (Colorado)" }
    ];
    config = {
        anio: 2026,
        version: "Vs.001",
        publicado: true,
        saludo: "Para la Dirección Regional de Educación Cañas es un honor presentar la Programación Anual, instrumento rector que orienta la gestión educativa de nuestros circuitos y centros educativos. Invitamos a toda la comunidad educativa a conocer y apropiarse de las acciones aquí planificadas.",
        firma: "Dirección Regional de Educación Cañas · MEP",
        ideasRectoras: [
            "Cultura de paz y clima escolar positivo",
            "Pertinencia cultural y equidad educativa",
            "Permanencia y mitigación de la exclusión",
            "Educación socioemocional y salud mental",
            "Innovación y tecnología educativa",
            "Trabajo colaborativo y corresponsabilidad"
        ]
    };
    persistirDemo();
}

/* ==================== REFRESCO GLOBAL DE VISTAS ==================== */
function refrescarTodo() {
    aplicarAnio();
    renderPortada();
    renderDashboard();
    renderCalendario();
    if (calDiaSel) renderCalDetalle();
    Object.values(MODULOS).forEach(m => renderTabla(m));
    renderConfiguracion();
    const banner = $("bannerPublicacion");
    if (banner) banner.classList.toggle("hidden", config.publicado !== false);
    crearIconos();
}

/* ==================== NAVEGACIÓN Y SECCIONES ==================== */
function navCompleta() {
    const items = VISTAS.slice();
    Object.values(MODULOS).forEach(m => items.push({ id: m.id, etiqueta: m.etiqueta, icono: m.icono }));
    items.push({ id: "configuracion", etiqueta: "Configuración", icono: "settings", soloAdmin: true });
    return items.filter(v => !v.soloAdmin || esAdmin());
}

function construirNav() {
    const nav = $("navTabs");
    if (!nav) return;
    const items = navCompleta();
    let grupo = "";
    let html = "";
    items.forEach(v => {
        const g = (v.id === "inicio" || v.id === "dashboard" || v.id === "calendario")
            ? "General"
            : (v.id === "configuracion" ? "Administración" : "Programación");
        if (g !== grupo) { grupo = g; html += '<p class="nav-grupo">' + g + "</p>"; }
        html += '<a href="#" id="tab-' + v.id + '" onclick="switchTab(\'' + v.id + '\')" class="nav-item" data-vista="' + v.id + '">' +
            '<span class="nav-item-icono"><i data-lucide="' + v.icono + '"></i></span>' +
            '<span class="nav-item-label">' + esc(v.etiqueta) + "</span></a>";
    });
    nav.innerHTML = html;
    crearIconos();
}

function toggleSidebar() {
    document.body.classList.toggle("sidebar-open");
}

function construirSecciones() {
    const cont = $("contenedorModulos");
    if (!cont) return;
    cont.innerHTML = Object.values(MODULOS).map(m =>
        '<section id="view-' + m.id + '" class="vista hidden space-y-4">' +
        '<div class="card card-hover p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">' +
            '<div class="flex items-start gap-3">' +
                '<span class="icono-tile" style="background:' + m.color + '14;color:' + m.color + '"><i data-lucide="' + m.icono + '"></i></span>' +
                '<div><h2 class="font-display text-base sm:text-lg font-bold text-mep-navy">' + esc(m.titulo) + '</h2>' +
                '<p class="text-xs text-slate-500 max-w-2xl">' + esc(m.descripcion) + '</p></div>' +
            '</div>' +
            '<div class="flex items-center gap-2 shrink-0 self-start md:self-auto">' +
                '<span id="contador-' + m.id + '" class="chip" style="background:var(--lienzo);color:#64748B;border:1px solid var(--borde);text-transform:none;letter-spacing:0">0 registros</span>' +
                '<button onclick="abrirEditor(\'' + m.id + '\')" class="solo-admin btn-mep-primary px-4 py-2 rounded-2xl font-bold text-xs flex items-center gap-1.5"><i data-lucide="plus" class="w-4 h-4"></i> Nuevo</button>' +
                '<button onclick="exportarModulo(\'' + m.id + '\')" class="btn-suave btn-suave-acento"><i data-lucide="download" class="w-4 h-4"></i> Excel</button>' +
            '</div>' +
        '</div>' +
        '<div id="filtros-' + m.id + '" class="card p-4 flex flex-wrap gap-2 items-center"></div>' +
        '<div class="card overflow-hidden">' +
            '<div class="overflow-x-auto"><table class="tabla">' +
            '<thead id="thead-' + m.id + '"></thead>' +
            '<tbody id="tbody-' + m.id + '" class="divide-y divide-slate-100 font-medium text-slate-700"></tbody>' +
            '</table></div>' +
        '</div></section>'
    ).join("");
}

function switchTab(tabId) {
    const item = navCompleta().find(v => v.id === tabId);
    if (!item) return;
    if (item.soloAdmin && !esAdmin()) return;
    const ids = ["inicio", "dashboard", "calendario"].concat(Object.keys(MODULOS), ["configuracion"]);
    ids.forEach(id => {
        const v = $("view-" + id);
        const t = $("tab-" + id);
        if (v) v.classList.toggle("hidden", id !== tabId);
        if (t) t.classList.toggle("activo", id === tabId);
    });
    const titulo = $("pageHeaderTitulo");
    if (titulo) titulo.textContent = item.etiqueta;
    document.body.classList.remove("sidebar-open"); // cierra el drawer en móvil
    if (tabId === "calendario") renderCalendario();
    crearIconos();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ==================== FILTROS Y TABLAS DE MÓDULOS ==================== */
function aplicarFiltro(modId, campo, valor) {
    filtrosState[modId] = filtrosState[modId] || {};
    filtrosState[modId][campo] = valor;
    renderTabla(MODULOS[modId]);
}

function renderFiltros(mod) {
    const cont = $("filtros-" + mod.id);
    if (!cont) return;
    const activos = filtrosState[mod.id] || {};
    let html = "";
    (mod.filtros || []).forEach(f => {
        let opciones = f.opciones ? f.opciones.slice() : null;
        if (!opciones) { // opciones dinámicas: valores únicos de los datos
            const set = [];
            registrosDe(mod).forEach(r => {
                const v = r[f.campo];
                if (v && set.indexOf(v) === -1) set.push(v);
            });
            set.sort((a, b) => String(a).localeCompare(String(b)));
            opciones = [""].concat(set);
        }
        html += '<select onchange="aplicarFiltro(\'' + mod.id + '\',\'' + f.campo + '\', this.value)" ' +
            'class="text-xs font-semibold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-mep-blue">' +
            opciones.map(o => '<option value="' + esc(o) + '"' + ((activos[f.campo] || "") === o ? " selected" : "") + '>' +
                (o === "" ? esc(f.etiqueta + ": Todos") : esc(o)) + '</option>').join("") + "</select>";
    });
    cont.innerHTML = (html || '<p class="text-[11px] text-slate-400 font-medium">Sin filtros para este módulo.</p>');
}

function listaFiltrada(mod) {
    const activos = filtrosState[mod.id] || {};
    return registrosDe(mod).filter(r => {
        for (const campo in activos) {
            const v = activos[campo];
            if (v && String(r[campo] || "") !== v) return false;
        }
        return true;
    });
}

function valorCelda(r, campo) {
    const v = r[campo];
    if (v == null || v === "") return "—";
    if (campo === "fecha" || campo === "fechaFin") return fmtFecha(v);
    if (campo === "telefono") return fmtTelefono(v);
    if (campo === "correo") return '<a class="text-mep-blue hover:underline" href="mailto:' + esc(v) + '">' + esc(v) + '</a>';
    return esc(v);
}

function renderTabla(mod) {
    renderFiltros(mod);
    const thead = $("thead-" + mod.id);
    const tbody = $("tbody-" + mod.id);
    const contador = $("contador-" + mod.id);
    if (!thead || !tbody) return;
    const lista = listaFiltrada(mod);
    if (contador) contador.textContent = lista.length + (lista.length === 1 ? " registro" : " registros");

    let cols = mod.columnas.slice();
    if (mod.coleccion !== COLECCIONES.directorio) cols = cols.concat([]); // estado/acciones abajo
    let head = '<tr class="bg-slate-100 text-slate-700 font-extrabold uppercase tracking-wider border-b border-slate-200">' +
        cols.map(c => '<th class="p-3">' + esc(c.etiqueta) + "</th>").join("");
    if (esAdmin()) {
        if (mod.coleccion === COLECCIONES.actividades) head += '<th class="p-3">Estado</th>';
        head += '<th class="p-3 text-center">Acciones</th>';
    }
    head += "</tr>";
    thead.innerHTML = head;

    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="' + (cols.length + (esAdmin() ? 2 : 0)) + '" class="p-8 text-center text-slate-400 font-semibold">No hay registros para mostrar.</td></tr>';
        return;
    }

    tbody.innerHTML = lista.map(r => {
        let fila = "<tr class='hover:bg-slate-50/80 transition'>";
        cols.forEach(c => { fila += '<td class="p-3 align-top">' + valorCelda(r, c.campo) + "</td>"; });
        if (esAdmin()) {
            if (mod.coleccion === COLECCIONES.actividades) {
                const pub = r.estado !== "borrador";
                fila += '<td class="p-3 align-top"><span class="' + (pub ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-amber-100 text-amber-700 border-amber-200") +
                    ' border text-[10px] font-extrabold uppercase rounded-full px-2 py-0.5">' + (pub ? "Publicada" : "Borrador") + "</span></td>";
            }
            fila += '<td class="p-3 align-top text-center whitespace-nowrap">' +
                '<button onclick="verDetalle(\'' + mod.id + '\',\'' + esc(r.id) + '\')" class="accion-btn accion-ver" title="Ver detalle"><i data-lucide="eye" class="w-4 h-4"></i></button> ' +
                '<button onclick="abrirEditor(\'' + mod.id + '\',\'' + esc(r.id) + '\')" class="accion-btn accion-editar" title="Editar"><i data-lucide="pencil" class="w-4 h-4"></i></button> ' +
                (mod.coleccion === COLECCIONES.actividades ?
                    '<button onclick="alternarEstado(\'' + esc(r.id) + '\')" class="accion-btn accion-estado" title="Publicar / pasar a borrador"><i data-lucide="' + (r.estado === "borrador" ? "upload-cloud" : "file-pen") + '" class="w-4 h-4"></i></button> ' : "") +
                '<button onclick="eliminarRegistro(\'' + mod.id + '\',\'' + esc(r.id) + '\')" class="accion-btn accion-borrar" title="Eliminar"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
                "</td>";
        }
        return fila + "</tr>";
    }).join("");
    crearIconos();
}

/* ==================== PORTADA / INICIO ==================== */
function renderPortada() {
    $("portadaVersion").textContent = config.version || "—";
    const estado = $("portadaEstado");
    if (estado) {
        if (config.publicado !== false) {
            estado.textContent = "Publicada oficialmente";
            estado.className = "bg-emerald-400/20 border border-emerald-300/50 text-emerald-100 text-[11px] font-bold px-3 py-1.5 rounded-full";
        } else {
            estado.textContent = "No publicada";
            estado.className = "bg-amber-400/20 border border-amber-300/50 text-amber-100 text-[11px] font-bold px-3 py-1.5 rounded-full";
        }
    }
    $("saludoTexto").textContent = config.saludo || "El saludo institucional aún no ha sido redactado. La administración puede editarlo desde «Editar portada».";
    $("saludoAutor").textContent = config.firma || "";
    const ideas = (config.ideasRectoras || []).filter(i => String(i).trim());
    $("ideasGrid").innerHTML = ideas.length ? ideas.map(i =>
        '<div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-start gap-2.5">' +
        '<i data-lucide="lightbulb" class="w-4 h-4 text-mep-gold shrink-0 mt-0.5"></i>' +
        '<p class="text-xs font-semibold text-slate-700 leading-snug">' + esc(i) + "</p></div>").join("")
        : '<p class="text-xs text-slate-400">Aún no se han registrado ideas rectoras.</p>';
    const modulos = Object.values(MODULOS).map(m => {
        const n = registrosDe(m).length;
        return '<button onclick="switchTab(\'' + m.id + '\')" class="bento-tile group">' +
            '<div class="flex items-center justify-between mb-2.5">' +
            '<span class="icono-tile" style="background:' + m.color + '14;color:' + m.color + '"><i data-lucide="' + m.icono + '"></i></span>' +
            '<span class="font-display text-lg font-black text-slate-200 group-hover:text-mep-blue transition-colors">' + n + "</span></div>" +
            '<p class="text-xs font-bold text-mep-navy leading-snug">' + esc(m.titulo) + "</p>" +
            '<p class="text-[10px] text-slate-400 mt-1 font-semibold">' + (n === 1 ? "1 registro" : n + " registros") + "</p></button>";
    }).join("");
    $("portadaModulos").innerHTML = modulos;
}

function abrirEditorPortada() {
    if (!esAdmin()) return;
    $("pcAnio").value = config.anio || new Date().getFullYear();
    $("pcVersion").value = config.version || "";
    $("pcPublicado").checked = config.publicado !== false;
    $("pcSaludo").value = config.saludo || "";
    $("pcAutor").value = config.firma || "";
    $("pcIdeas").value = (config.ideasRectoras || []).join("\n");
    abrirModal("modalPortada");
}

async function guardarPortada(event) {
    event.preventDefault();
    if (!esAdmin()) return;
    const ideas = $("pcIdeas").value.split("\n").map(s => s.trim()).filter(Boolean);
    const ok = await guardarConfig({
        anio: parseInt($("pcAnio").value, 10) || new Date().getFullYear(),
        version: $("pcVersion").value.trim() || "Vs.001",
        publicado: $("pcPublicado").checked,
        saludo: $("pcSaludo").value.trim(),
        firma: $("pcAutor").value.trim(),
        ideasRectoras: ideas
    });
    if (ok) {
        cerrarModal("modalPortada");
        showToast("Metadatos de la portada actualizados.", "success");
    }
}

async function togglePublicado() {
    if (!esAdmin()) return;
    const nuevo = config.publicado === false;
    const ok = await guardarConfig({ publicado: nuevo });
    if (ok) showToast(nuevo ? "Programación publicada oficialmente. Ya es visible en el Modo Lectura público." : "Programación despublicada. El Modo Lectura ya no muestra la información.", nuevo ? "success" : "warning");
}

async function publicarTodo() {
    if (!esAdmin()) return;
    const total = dbActividades.filter(a => a.estado === "borrador").length;
    if (total === 0) { showToast("No hay actividades en borrador.", "info"); return; }
    if (!confirm("¿Publicar las " + total + " actividades que están en borrador?")) return;
    try {
        if (MODO_DEMO) {
            dbActividades.forEach(a => { if (a.estado === "borrador") a.estado = "publicada"; });
            persistirDemo();
            refrescarTodo();
        } else {
            const lote = [];
            for (let i = 0; i < dbActividades.length; i += 400) {
                const batch = firebaseDB.batch();
                dbActividades.slice(i, i + 400).forEach(a => {
                    if (a.estado === "borrador") batch.set(firebaseDB.collection(COLECCIONES.actividades).doc(String(a.id)), { estado: "publicada" }, { merge: true });
                });
                lote.push(batch.commit());
            }
            await Promise.all(lote);
        }
        showToast("Se publicaron " + total + " actividades.", "success");
    } catch (e) {
        showToast("No se pudieron publicar las actividades: " + (e.code || e.message), "danger");
    }
}

/* ==================== PANEL DE CONTROL ==================== */
function renderDashboard() {
    const act = actividadesVisibles();
    $("statActividades").textContent = act.length;
    const hoy = hoyISO();
    const en30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    $("statProximas").textContent = act.filter(a => a.fecha >= hoy && a.fecha <= en30).length;
    $("statDirectorio").textContent = directorioVisible().length;
    $("statModulos").textContent = Object.values(MODULOS).filter(m => registrosDe(m).length > 0).length;

    const proximas = act.filter(a => a.fecha >= hoy).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).slice(0, 8);
    $("proximasList").innerHTML = proximas.length ? proximas.map(a => {
        const mod = MODULOS[a.modulo] || { color: "#94A3B8", etiqueta: a.modulo };
        return '<div class="flex items-center gap-3 bg-slate-50 border border-slate-200/80 rounded-xl p-3 hover:border-mep-blue/40 transition">' +
            '<span class="w-2 h-2 rounded-full shrink-0" style="background:' + mod.color + '"></span>' +
            '<div class="min-w-0 flex-1"><p class="text-xs font-bold text-mep-navy truncate">' + esc(a.titulo) + "</p>" +
            '<p class="text-[10px] text-slate-500">' + esc(mod.etiqueta) + " · " + fmtRango(a.fecha, a.fechaFin) + (a.sede ? " · " + esc(a.sede) : "") + "</p></div>" +
            (a.estado === "borrador" ? '<span class="text-[9px] font-extrabold text-amber-600 uppercase shrink-0">Borrador</span>' : "") +
            "</div>";
    }).join("") : '<p class="text-xs text-slate-400 font-semibold p-4 text-center">No hay actividades próximas registradas.</p>';

    const max = Math.max(1, ...Object.values(MODULOS).map(m => registrosDe(m).length));
    $("modulosBars").innerHTML = Object.values(MODULOS).map(m => {
        const n = registrosDe(m).length;
        return '<div><div class="flex justify-between text-[10px] font-bold mb-1"><span class="text-slate-600 truncate">' + esc(m.etiqueta) + '</span><span class="text-mep-navy">' + n + "</span></div>" +
            '<div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden"><div class="h-full rounded-full transition-all duration-700" style="width:' + Math.round(n / max * 100) + "%;background:" + m.color + '"></div></div></div>';
    }).join("");

    const porMes = new Array(12).fill(0);
    act.forEach(a => { const m = mesDeFecha(a.fecha); if (m >= 1 && m <= 12) porMes[m - 1]++; });
    const maxMes = Math.max(1, ...porMes);
    $("mesesBars").innerHTML = porMes.map((n, i) =>
        '<div class="text-center group cursor-default" title="' + MESES[i] + ": " + n + ' actividad(es)">' +
        '<div class="w-full bg-gradient-to-t from-mep-blue to-blue-400 rounded-t-md mx-auto transition-all duration-700 hover:from-mep-red hover:to-mep-red" style="height:' + Math.max(6, Math.round(n / maxMes * 90)) + 'px"></div>' +
        '<p class="text-[10px] font-bold text-mep-navy mt-1">' + n + '</p>' +
        '<p class="text-[9px] font-semibold text-slate-400 uppercase">' + MESES_AB[i] + "</p></div>"
    ).join("");
}

/* ==================== CALENDARIO INTERACTIVO ==================== */
function cambiarMes(delta) {
    calMes += delta;
    if (calMes < 0) { calMes = 11; calAnio--; }
    if (calMes > 11) { calMes = 0; calAnio++; }
    calDiaSel = null;
    $("calDetalle").classList.add("hidden");
    renderCalendario();
}

function irAMesActual() {
    calAnio = new Date().getFullYear();
    calMes = new Date().getMonth();
    calDiaSel = null;
    $("calDetalle").classList.add("hidden");
    renderCalendario();
}

function actividadesDelDia(iso) {
    return actividadesVisibles().filter(a => String(a.fecha || "") <= iso && String(a.fechaFin || a.fecha || "") >= iso);
}

function renderCalendario() {
    const titulo = $("calMesAnio");
    if (!titulo) return;
    titulo.textContent = MESES[calMes] + " " + calAnio;

    const mods = Object.values(MODULOS).filter(m => m.coleccion === COLECCIONES.actividades);
    $("calLeyenda").innerHTML = mods.map(m =>
        '<span class="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">' +
        '<span class="w-2 h-2 rounded-full" style="background:' + m.color + '"></span>' + esc(m.etiqueta) + "</span>").join("");
    $("calHeaders").innerHTML = DIAS.map(d => '<div class="text-center text-[10px] font-extrabold text-slate-400 uppercase py-1">' + d + "</div>").join("");

    const primerDia = new Date(calAnio, calMes, 1);
    const offset = (primerDia.getDay() + 6) % 7; // lunes = 0
    const diasMes = new Date(calAnio, calMes + 1, 0).getDate();
    const hoy = hoyISO();
    let html = "";
    for (let i = 0; i < offset; i++) html += '<div class="cal-celda vacia"></div>';
    for (let d = 1; d <= diasMes; d++) {
        const iso = calAnio + "-" + pad(calMes + 1) + "-" + pad(d);
        const delDia = actividadesDelDia(iso);
        const colores = [];
        delDia.forEach(a => {
            const mod = MODULOS[a.modulo];
            const c = mod ? mod.color : "#94A3B8";
            if (colores.indexOf(c) === -1) colores.push(c);
        });
        const clases = "cal-celda" + (iso === hoy ? " hoy" : "") + (iso === calDiaSel ? " sel" : "") + (delDia.length ? " con-actividades cursor-pointer" : "");
        html += '<div class="' + clases + '" onclick="verDia(\'' + iso + '\')">' +
            '<span class="text-xs font-bold">' + d + "</span>" +
            '<span class="cal-puntos">' + colores.slice(0, 4).map(c => '<span class="cal-punto" style="background:' + c + '"></span>').join("") + "</span>" +
            (delDia.length > 4 ? '<span class="cal-cantidad">+' + (delDia.length - 4) + "</span>" : "") +
            "</div>";
    }
    $("calGrid").innerHTML = html;
    crearIconos();
}

function verDia(iso) {
    calDiaSel = iso;
    renderCalendario();
    renderCalDetalle();
    $("calDetalle").classList.remove("hidden");
}

function renderCalDetalle() {
    if (!calDiaSel) return;
    const delDia = actividadesDelDia(calDiaSel).sort((a, b) => String(a.hora || "").localeCompare(String(b.hora || "")));
    let html = '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">' +
        '<h3 class="font-extrabold text-mep-navy text-sm sm:text-base"><i data-lucide="calendar-check" class="w-4 h-4 inline-block align-text-bottom text-mep-blue"></i> Actividades del ' + fmtFecha(calDiaSel) + "</h3>" +
        (esAdmin() ? '<button onclick="agregarEnFecha(\'' + calDiaSel + '\')" class="btn-mep-primary px-4 py-2 rounded-2xl font-bold text-[11px] self-start"><i data-lucide="plus" class="w-3.5 h-3.5 inline-block align-text-bottom"></i> Agregar actividad en esta fecha</button>' : "") +
        "</div>";
    html += delDia.length ? '<div class="space-y-2.5">' + delDia.map(a => {
        const mod = MODULOS[a.modulo] || { color: "#94A3B8", etiqueta: a.modulo || "Sin módulo", titulo: a.modulo };
        return '<div class="flex items-start gap-3 bg-slate-50 border border-slate-200/80 rounded-xl p-3">' +
            '<span class="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style="background:' + mod.color + '"></span>' +
            '<div class="min-w-0 flex-1">' +
            '<p class="text-xs font-bold text-mep-navy">' + esc(a.titulo) + (a.estado === "borrador" ? ' <span class="text-[9px] font-extrabold text-amber-600 uppercase">(borrador)</span>' : "") + "</p>" +
            '<p class="text-[10px] text-slate-500">' + esc(mod.titulo || mod.etiqueta) +
            (a.hora ? " · " + esc(a.hora) : "") + (a.sede ? " · Sede: " + esc(a.sede) : "") + (a.circuito ? " · " + esc(a.circuito) : "") + "</p>" +
            "</div>" +
            '<button onclick="verDetalle(\'' + esc(a.modulo) + '\',\'' + esc(a.id) + '\')" class="text-[10px] font-bold text-mep-blue hover:underline shrink-0">Ver detalle</button>' +
            "</div>";
    }).join("") + "</div>"
        : '<p class="text-xs text-slate-400 font-semibold text-center py-6">No hay actividades programadas para esta fecha.</p>';
    $("calDetalle").innerHTML = html;
    crearIconos();
}

function agregarEnFecha(iso) {
    if (!esAdmin()) return;
    abrirEditor("programacion_mensual", null, iso);
}

/* ==================== EDITOR GENÉRICO (MODALES) ==================== */
function configDeEditor() {
    return editorModulo === EDITOR_USUARIOS ? EDITOR_USUARIOS : MODULOS[editorModulo];
}

function abrirEditor(modId, id, prefillFecha) {
    if (!esAdmin()) return;
    editorModulo = modId;
    editorId = id || null;
    editorPrefillFecha = prefillFecha || null;
    const cfg = configDeEditor();
    if (!cfg) return;
    const registro = id ? (cfg === EDITOR_USUARIOS
        ? dbUsuarios.find(u => String(u.uid) === String(id))
        : registroDe(cfg, id)) : null;
    $("editorTitulo").textContent = (id ? "Editar: " : "Nuevo registro · ") + (cfg.titulo || cfg.etiqueta);

    let html = "";
    cfg.campos.forEach(c => {
        let valor = registro ? (registro[c.clave] == null ? "" : registro[c.clave]) : "";
        if (!registro && c.clave === "fecha" && editorPrefillFecha) valor = editorPrefillFecha;
        html += campoInput(c, valor);
    });
    // Usuarios: contraseña inicial al crear (no se guarda en Firestore)
    if (cfg === EDITOR_USUARIOS) {
        if (!editorId) {
            html += '<div><label class="block text-xs font-bold text-slate-700 uppercase mb-1">Contraseña inicial *</label>' +
                '<input type="password" id="ef-password" autocomplete="new-password" placeholder="Mínimo 6 caracteres" ' +
                'class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-mep-blue focus:bg-white outline-none">' +
                '<p class="text-[10px] text-slate-400 mt-1 font-medium">La cuenta se crea directamente en Firebase Authentication desde esta aplicación; no necesita usar la consola. El rol se guarda automáticamente.</p></div>';
        } else {
            html += '<div class="bg-blue-50 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-900 font-medium">' +
                'Para cambiar la contraseña de este usuario, use el botón «Enviar enlace de restablecimiento» en la tabla de usuarios.</div>';
        }
    }
    // Actividades: estado y metadatos
    if (cfg !== EDITOR_USUARIOS && cfg.coleccion === COLECCIONES.actividades) {
        const estado = registro ? (registro.estado || "publicada") : "publicada";
        html += '<div><label class="block text-xs font-bold text-slate-700 uppercase mb-1">Estado de publicación</label>' +
            '<select id="ef-estado" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-medium">' +
            '<option value="publicada"' + (estado === "publicada" ? " selected" : "") + '>Publicada (visible en Modo Lectura)</option>' +
            '<option value="borrador"' + (estado === "borrador" ? " selected" : "") + '>Borrador (solo administración)</option>' +
            "</select></div>";
    }
    html += '<div id="ef-pista-validacion" class="hidden text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 mt-4"></div>' +
        '<div id="ef-error" class="hidden text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 mt-3"></div>' +
        '<div class="flex justify-end gap-2 pt-4">' +
        '<button type="button" onclick="cerrarModal(\'modalEditor\')" class="btn-suave">Cancelar</button>' +
        '<button type="submit" id="btnGuardarEditor" class="btn-mep-primary px-6 py-2.5 rounded-2xl font-bold text-sm">Guardar</button></div>';
    $("editorForm").innerHTML = html;
    activarValidacionEnVivoEditor(); // validación, formateo y bloqueo preventivo en vivo
    abrirModal("modalEditor");
}

function campoInput(c, valor) {
    const base = 'id="ef-' + esc(c.clave) + '" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-mep-blue focus:bg-white outline-none"';
    // Atributos HTML5 de validación nativa (refuerzo de las reglas de JS)
    let attrs = "";
    if (c.requerido) attrs += " required";
    if (c.min) attrs += ' minlength="' + c.min + '" data-min="' + c.min + '"';
    if (c.max) attrs += ' maxlength="' + c.max + '"';
    if (c.tipo === "date") {
        attrs += ' min="2000-01-01" max="2100-12-31"';
        if (c.noAnteriorQue) attrs += ' data-no-anterior-que="' + esc(c.noAnteriorQue) + '"';
    }
    if (c.telefono) attrs += ' inputmode="tel" autocomplete="tel" placeholder="Ej: 2695-5151"';
    if (c.extension) attrs += ' inputmode="numeric" pattern="\d{2,5}" placeholder="Ej: 101"';
    if (c.tipo === "email" || c.correoInstitucional) attrs += ' inputmode="email" autocomplete="email" placeholder="nombre.apellido@mep.go.cr"';
    if (c.normalizar === "hora") attrs += ' placeholder="Ej: 8:00 a.m."';
    if (c.tipo === "text" && !c.telefono && !c.extension && c.normalizar !== "hora" && !c.correoInstitucional && c.tipo !== "email") {
        attrs += ' autocomplete="off" spellcheck="false"';
    }
    let input;
    if (c.tipo === "select") {
        // Catálogo cerrado: solo opciones oficiales; no admite escritura manual.
        input = "<select " + base + attrs + ">" + (c.opciones || []).map(o =>
            '<option value="' + esc(o) + '"' + (String(valor) === String(o) ? " selected" : "") + ">" + (o === "" ? "— Seleccione una opción oficial —" : esc(o)) + "</option>").join("") + "</select>";
    } else if (c.tipo === "textarea") {
        input = "<textarea " + base + attrs + " rows='3'>" + esc(valor) + "</textarea>";
    } else {
        const tipo = c.tipo === "email" ? "email" : c.tipo === "date" ? "date" : "text";
        input = '<input type="' + tipo + '" ' + base + attrs + ' value="' + esc(valor) + '">';
    }
    // Ayuda, contador de caracteres y espacio para el mensaje de error visual
    let pie = "";
    if (c.ayuda) pie += '<p data-aviso class="text-[10px] text-slate-400 mt-1 font-medium' + (valor ? " hidden" : "") + '">' + esc(c.ayuda) + "</p>";
    if (c.max) pie += '<p data-contador data-max="' + c.max + '" class="text-[10px] text-slate-400 mt-1 font-semibold">' + String(valor || "").length + " / " + c.max + " caracteres</p>";
    pie += '<p data-error class="hidden text-[11px] font-bold text-red-600 mt-1 flex items-start gap-1"><i data-lucide="alert-circle" class="w-3.5 h-3.5 shrink-0 mt-0.5"></i><span></span></p>';
    return '<div data-campo-cont data-clave="' + esc(c.clave) + '"><label class="block text-xs font-bold text-slate-700 uppercase mb-1">' + esc(c.etiqueta) + (c.requerido ? ' <span class="text-mep-red">*</span>' : "") + "</label>" + input + pie + "</div>";
}

async function guardarEditor(event) {
    event.preventDefault();
    if (!esAdmin()) return;
    const cfg = configDeEditor();
    if (!cfg) return;
    // Motor de calidad de datos: 1) formatea/normaliza todos los campos,
    // 2) valida cada uno contra sus reglas y 3) pinta los errores dentro del
    // modal (sin alertas genéricas). Si algo falla, el guardado se bloquea.
    const resultado = procesarFormularioEditor(cfg, true);
    const doc = resultado.doc;
    crearIconos();
    if (resultado.errores.length > 0) {
        actualizarBotonGuardarEditor();
        mostrarErrorEditor("El formulario tiene " + resultado.errores.length + (resultado.errores.length === 1 ? " inconsistencia" : " inconsistencias") + " que impiden guardar información oficial. Corrija los campos marcados en rojo.");
        const primerInvalido = document.querySelector("#editorForm .campo-invalido");
        if (primerInvalido) { primerInvalido.focus(); primerInvalido.scrollIntoView({ behavior: "smooth", block: "center" }); }
        return; // bloqueo preventivo: ningún dato inválido llega a Firestore / LocalStorage
    }
    ocultarErrorEditorGlobal();

    if (cfg === EDITOR_USUARIOS) {
        await guardarUsuarioDesdeEditor(doc);
        return;
    }

    if (cfg.coleccion === COLECCIONES.actividades) {
        doc.estado = ($("ef-estado") && $("ef-estado").value) || "publicada";
        doc.modulo = cfg.id;
        if (editorId) {
            doc.id = editorId;
            const original = registroDe(cfg, editorId);
            if (original) {
                doc.creadoPor = original.creadoPor || currentUser.nombre;
                doc.creadoPorUid = original.creadoPorUid || currentUser.uid;
                doc.fechaCreacion = original.fechaCreacion || new Date().toISOString();
            }
        } else {
            doc.id = generarId(cfg.prefijo);
            doc.creadoPor = currentUser.nombre;
            doc.creadoPorUid = currentUser.uid;
            doc.fechaCreacion = new Date().toISOString();
        }
    } else {
        doc.id = editorId || generarId(cfg.prefijo);
    }
    doc.ultimaEdicion = new Date().toISOString();
    const ok = await guardarDoc(cfg.coleccion, doc);
    if (ok) {
        cerrarModal("modalEditor");
        showToast(editorId ? "Registro actualizado correctamente." : "Registro creado correctamente.", "success");
    }
}

async function alternarEstado(id) {
    if (!esAdmin()) return;
    const r = dbActividades.find(a => String(a.id) === String(id));
    if (!r) return;
    const nuevo = r.estado === "borrador" ? "publicada" : "borrador";
    const ok = await guardarDoc(COLECCIONES.actividades, { id: r.id, estado: nuevo });
    if (ok) showToast(nuevo === "publicada" ? "Actividad publicada." : "Actividad pasada a borrador.", "success");
}

async function eliminarRegistro(modId, id) {
    if (!esAdmin()) return;
    const cfg = MODULOS[modId];
    if (!cfg) return;
    const r = registroDe(cfg, id);
    if (!r) return;
    if (!confirm("¿Eliminar definitivamente el registro «" + (r.titulo || r.funcionario || id) + "»?")) return;
    const ok = await eliminarDoc(cfg.coleccion, id);
    if (ok) showToast("Registro eliminado.", "info");
}

function verDetalle(modId, id) {
    const cfg = MODULOS[modId];
    if (!cfg) return;
    const r = registroDe(cfg, id);
    if (!r) { showToast("Registro no encontrado.", "warning"); return; }
    $("detalleTitulo").textContent = r.titulo || r.funcionario || "Detalle";
    $("detalleCuerpo").innerHTML = cfg.campos.map(c => {
        const v = r[c.clave];
        if (v == null || v === "") return "";
        let valor = esc(v);
        if (c.tipo === "date") valor = fmtFecha(v);
        if (c.clave === "telefono") valor = fmtTelefono(v);
        if (c.clave === "correo") valor = '<a class="text-mep-blue hover:underline" href="mailto:' + esc(v) + '">' + esc(v) + "</a>";
        return '<div class="py-2 border-b border-slate-100 last:border-0"><p class="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">' + esc(c.etiqueta) + "</p>" +
            '<p class="text-sm text-slate-700 font-medium mt-0.5 whitespace-pre-line">' + valor + "</p></div>";
    }).join("");
    abrirModal("modalDetalle");
}

/* ==================== GESTIÓN DE USUARIOS (REGISTRO DIRECTO DESDE LA APP) ====================
   Para crear cuentas sin cerrar la sesión del administrador se usa una app
   Firebase SECUNDARIA y temporal: el usuario se crea en Authentication con
   esa app, se cierra su sesión inmediatamente y la app temporal se destruye.
   La sesión del administrador (app principal) nunca se ve afectada. */

// Ejecuta una operación contra Firebase Authentication con reintentos
// automáticos: el error «auth/network-request-failed» suele ser intermitente
// (congestión de red, bloqueadores de anuncios, antivirus o proxy que filtra
// *.googleapis.com), así que se reintenta hasta 3 veces con una breve pausa
// entre intentos antes de reportar el problema al administrador.
async function conReintentosAuth(operacion) {
    let ultimoError = null;
    for (let intento = 1; intento <= 3; intento++) {
        try {
            return await operacion();
        } catch (e) {
            ultimoError = e;
            if (!e || e.code !== "auth/network-request-failed" || intento === 3) throw e;
            await new Promise(resolver => setTimeout(resolver, 900 * intento));
        }
    }
    throw ultimoError;
}

async function crearUsuarioAuth(email, password) {
    const appTemp = firebase.initializeApp(firebaseConfig, "temp-crear-" + Date.now());
    try {
        const authTemp = appTemp.auth();
        const cred = await authTemp.createUserWithEmailAndPassword(email, password);
        const uid = cred.user.uid;
        await authTemp.signOut();
        return uid;
    } finally {
        try { await appTemp.delete(); } catch (e) { /* la app temporal se limpia sola */ }
    }
}

// Recupera el UID de una cuenta que YA existe en Authentication iniciando
// sesión con la app temporal (se usa cuando un intento anterior quedó a medio
// camino: cuenta creada en Authentication pero sin documento en Firestore).
async function iniciarSesionTemporal(email, password) {
    const appTemp = firebase.initializeApp(firebaseConfig, "temp-login-" + Date.now());
    try {
        const authTemp = appTemp.auth();
        const cred = await authTemp.signInWithEmailAndPassword(email, password);
        const uid = cred.user.uid;
        await authTemp.signOut();
        return uid;
    } finally {
        try { await appTemp.delete(); } catch (e) {}
    }
}

function errorAuthAmigable(e) {
    const codigos = {
        "auth/email-already-in-use": "ya existe una cuenta con ese correo en Firebase Authentication",
        "auth/invalid-email": "el correo no tiene un formato válido",
        "auth/weak-password": "la contraseña debe tener al menos 6 caracteres",
        "auth/operation-not-allowed": "el proveedor Correo/contraseña no está habilitado en Firebase Console → Authentication → Sign-in method",
        "auth/unauthorized-domain": "el dominio donde está alojada la aplicación no está autorizado en Firebase Console → Authentication → Settings → Authorized domains",
        "auth/network-request-failed": "error de red, revise su conexión a internet",
        "auth/too-many-requests": "demasiados intentos, espere un momento e intente de nuevo",
        "auth/admin-restricted-operation": "el registro está restringido en la configuración del proyecto de Firebase"
    };
    return codigos[e && e.code] || (e && e.code ? e.code : (e && e.message ? e.message : "error desconocido"));
}

// Muestra un error PERSISTENTE dentro del modal del editor (no desaparece
// como un toast) para que el administrador pueda leer la causa completa.
function mostrarErrorEditor(msg) {
    const el = $("ef-error");
    if (!el) { showToast(msg, "danger"); return; }
    el.textContent = msg;
    el.classList.remove("hidden");
    try { el.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {}
}

// Limpia el error persistente del modal una vez el formulario vuelve a estar válido.
function ocultarErrorEditorGlobal() {
    const el = $("ef-error");
    if (el) { el.classList.add("hidden"); el.textContent = ""; }
}

// Bloquea el botón «Guardar» mientras opera contra Firebase (evita doble clic
// y cuentas duplicadas).
function estadoBotonGuardar(ocupado) {
    const btn = $("btnGuardarEditor");
    if (!btn) return;
    btn.setAttribute("data-ocupado", ocupado ? "1" : "0");
    btn.disabled = ocupado;
    btn.style.opacity = ocupado ? "0.6" : "";
    btn.style.pointerEvents = ocupado ? "none" : "";
    btn.textContent = ocupado ? "Guardando..." : "Guardar";
}

/* ==================== MODAL DE REGISTRO DE USUARIOS ====================
   Formulario dedicado (hoja tipo sheet con fondo desenfocado) con selección
   visual del rol, datos del nuevo usuario y auditoría automática de quién
   lo dio de alta («Agregado por»). */
// Desde la refactorización del control de acceso, TODAS las cuentas que se
// registran aquí son de rol ADMINISTRADOR: el público ingresa automáticamente
// en Modo Lectura y no requiere cuenta, por lo que ya no existe un selector
// de rol en este formulario.
let nuevoUsuarioRol = "admin";

// Abre el modal de registro dejando el formulario limpio.
function abrirModalUsuario() {
    if (!esAdmin()) return;
    nuevoUsuarioRol = "admin";
    ["nuNombre", "nuEmail", "nuPassword"].forEach(id => { const el = $(id); if (el) el.value = ""; });
    const inputPass = $("nuPassword");
    if (inputPass) inputPass.type = "password";
    const btnOjo = document.querySelector("#modalUsuario button[onclick^='alternarClave']");
    if (btnOjo) { btnOjo.innerHTML = '<i data-lucide="eye" class="w-4 h-4"></i>'; btnOjo.title = "Mostrar / ocultar contraseña"; }
    ocultarErrorUsuario();
    estadoBotonCrearUsuario(false);
    const audit = $("nuAuditoriaTexto");
    if (audit) audit.textContent = "Auditoría: este administrador quedará registrado como agregado por «" + (currentUser ? currentUser.nombre : "sistema") + "», de modo que la administración siempre podrá identificar quién lo dio de alta.";
    abrirModal("modalUsuario");
    try { $("nuNombre").focus(); } catch (e) {}
}

// Muestra u oculta la contraseña inicial dentro del modal de registro.
function alternarClave(idInput, btn) {
    const input = $(idInput);
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
    if (btn) {
        btn.innerHTML = '<i data-lucide="' + (input.type === "password" ? "eye" : "eye-off") + '" class="w-4 h-4"></i>';
        btn.title = input.type === "password" ? "Mostrar / ocultar contraseña" : "Ocultar contraseña";
    }
    crearIconos();
}

// Error persistente dentro del modal de registro (no desaparece como un toast).
function mostrarErrorUsuario(msg) {
    const el = $("nuError");
    if (!el) { showToast(msg, "danger"); return; }
    el.textContent = msg;
    el.classList.remove("hidden");
}

function ocultarErrorUsuario() {
    const el = $("nuError");
    if (el) { el.classList.add("hidden"); el.textContent = ""; }
}

// Bloquea el botón «Crear usuario» mientras opera contra Firebase (evita el
// doble clic y, con ello, cuentas duplicadas).
function estadoBotonCrearUsuario(ocupado) {
    const btn = $("btnCrearUsuario");
    if (!btn) return;
    btn.disabled = ocupado;
    btn.style.opacity = ocupado ? "0.6" : "";
    btn.style.pointerEvents = ocupado ? "none" : "";
    btn.innerHTML = ocupado
        ? '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Creando cuenta...'
        : '<i data-lucide="user-plus" class="w-4 h-4"></i> Crear usuario';
    crearIconos();
}

/* Núcleo compartido de creación de cuentas: crea (o recupera, si quedó
   huérfana de un intento anterior) la cuenta en Firebase Authentication
   mediante una app secundaria temporal —sin cerrar la sesión del
   administrador— y guarda su documento en «drec_usuarios» con el rol y la
   auditoría «Agregado por» (nombre y UID del administrador responsable). */
async function registrarUsuarioAuth(nombre, email, password, rol) {
    let uid = null;
    let cuentaPrevia = false;
    try {
        uid = await conReintentosAuth(() => crearUsuarioAuth(email, password));
    } catch (e) {
        if (e && e.code === "auth/email-already-in-use") {
            try {
                uid = await conReintentosAuth(() => iniciarSesionTemporal(email, password));
                cuentaPrevia = true;
            } catch (e2) {
                return { ok: false, error: "Ese correo ya tiene una cuenta en Firebase Authentication, pero la contraseña indicada no coincide con la de esa cuenta. Opciones: a) escriba la contraseña correcta de esa cuenta existente para vincularla al sistema, o b) elimínela en Firebase Console → Authentication → Users y vuelva a intentarlo." };
            }
        } else if (e && e.code === "auth/network-request-failed") {
            return { ok: false, error: "No se pudo contactar a Firebase Authentication: se reintentó automáticamente 3 veces sin éxito. Revise: 1) su conexión a internet y vuelva a intentarlo en unos minutos; 2) que el navegador no tenga bloqueadores de anuncios, antivirus o extensiones que filtren *.googleapis.com; 3) que la API key del proyecto no tenga restricciones HTTP en Google Cloud Console → APIs y servicios → Credenciales. Como alternativa momentánea, puede crear la cuenta en Firebase Console → Authentication → Users → Add user con esta misma contraseña y luego presionar «Crear usuario» aquí para vincularla: ningún dato se duplica." };
        } else {
            return { ok: false, error: "No se pudo crear la cuenta en Firebase Authentication: " + errorAuthAmigable(e) + ". Verifique en Firebase Console → Authentication → Sign-in method que el proveedor «Correo/contraseña» esté habilitado." };
        }
    }
    const ok = await guardarDoc(COLECCIONES.usuarios, {
        uid: uid, id: uid, nombre: nombre, email: email, rol: rol,
        activo: true, fechaCreacion: new Date().toISOString(),
        creadoPor: currentUser ? currentUser.nombre : "sistema",
        creadoPorUid: currentUser ? currentUser.uid : ""
    });
    if (!ok) return { ok: false, error: "La cuenta " + (cuentaPrevia ? "existente se vinculó" : "se creó") + " en Authentication, pero Firestore rechazó el guardado del rol. Causa más común: las reglas de seguridad PUBLICADAS en Firestore aún no permiten que un administrador cree documentos de otros usuarios en «drec_usuarios». Copie las reglas actualizadas en Firestore → Reglas → Publicar, y presione «Crear usuario» de nuevo (la cuenta ya no se duplicará)." };
    return { ok: true, uid: uid, cuentaPrevia: cuentaPrevia };
}

// Envío del formulario del modal de registro de usuarios.
async function guardarUsuarioModal(event) {
    event.preventDefault();
    if (!esAdmin()) return;
    const nombre = $("nuNombre").value.trim();
    const email = $("nuEmail").value.trim().toLowerCase();
    const password = $("nuPassword").value;
    ocultarErrorUsuario();
    if (!nombre) { mostrarErrorUsuario("Escriba el nombre completo del nuevo usuario."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { mostrarErrorUsuario("Escriba un correo institucional válido."); return; }
    if (!password || password.length < 6) { mostrarErrorUsuario("La contraseña inicial debe tener al menos 6 caracteres."); return; }
    const duplicado = dbUsuarios.find(u => normalize(u.email) === normalize(email));
    if (duplicado) { mostrarErrorUsuario("Ya existe un usuario registrado en el sistema con ese correo: " + duplicado.nombre + " (" + duplicado.email + ")."); return; }

    if (MODO_DEMO) {
        const uidDemo = "DEMO-U-" + Date.now().toString(36).toUpperCase();
        dbUsuarios.push({ uid: uidDemo, id: uidDemo, nombre: nombre, email: email, rol: nuevoUsuarioRol, activo: true, fechaCreacion: new Date().toISOString(), creadoPor: currentUser ? currentUser.nombre : "sistema", creadoPorUid: currentUser ? currentUser.uid : "" });
        persistirDemo();
        refrescarTodo();
        cerrarModal("modalUsuario");
        showToast("Usuario registrado (modo demostración).", "success");
        return;
    }

    estadoBotonCrearUsuario(true);
    try {
        const r = await registrarUsuarioAuth(nombre, email, password, nuevoUsuarioRol);
        if (r.ok) {
            cerrarModal("modalUsuario");
            showToast(r.cuentaPrevia
                ? "Cuenta existente en Authentication vinculada al sistema: «" + nombre + "» quedó registrado con su rol."
                : "Usuario «" + nombre + "» registrado: cuenta creada y rol asignado automáticamente.", "success");
        } else {
            mostrarErrorUsuario(r.error);
        }
    } finally {
        estadoBotonCrearUsuario(false);
    }
}

async function guardarUsuarioDesdeEditor(doc) {
    const email = String(doc.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast("Escriba un correo institucional válido.", "warning"); return; }
    const duplicado = dbUsuarios.find(u => normalize(u.email) === normalize(email) && (!editorId || String(u.uid) !== String(editorId)));
    if (duplicado) { mostrarErrorEditor("Ya existe un usuario registrado en el sistema con ese correo: " + duplicado.nombre + " (" + duplicado.email + ")."); return; }
    const rol = "admin"; // todas las cuentas registradas son de Administrador

    // ----- EDICIÓN de un usuario existente -----
    if (editorId) {
        const existente = dbUsuarios.find(u => String(u.uid) === String(editorId));
        if (!existente) { mostrarErrorEditor("El usuario que intenta editar ya no existe. Cierre este formulario y actualice la vista."); return; }
        const esPropio = currentUser && String(editorId) === String(currentUser.uid);
        const nuevoDoc = { uid: editorId, id: editorId, nombre: doc.nombre, email: email, rol: rol };
        if (esPropio) { nuevoDoc.rol = "admin"; nuevoDoc.activo = true; } // blindaje: un admin nunca se degrada ni se desactiva a sí mismo
        estadoBotonGuardar(true);
        const ok = await guardarDoc(COLECCIONES.usuarios, nuevoDoc);
        estadoBotonGuardar(false);
        if (ok) { cerrarModal("modalEditor"); showToast("Usuario actualizado correctamente.", "success"); }
        else { mostrarErrorEditor("No se pudo actualizar el usuario en Firestore. Si el error fue «permission-denied», verifique que las reglas de seguridad publicadas en Firestore > Reglas incluyan el bloque de drec_usuarios con «allow update: if esAdmin()»."); }
        return;
    }

    // ----- CREACIÓN de un nuevo usuario (siempre Administrador) -----
    const passEl = $("ef-password");
    const password = passEl ? passEl.value : "";
    if (!password || password.length < 6) {
        if (passEl) passEl.classList.add("border-red-400", "ring-1", "ring-red-300");
        showToast("La contraseña inicial debe tener al menos 6 caracteres.", "warning");
        return;
    }

    if (MODO_DEMO) {
        const uidDemo = "DEMO-U-" + Date.now().toString(36).toUpperCase();
        dbUsuarios.push({ uid: uidDemo, id: uidDemo, nombre: doc.nombre, email: email, rol: rol, activo: true, fechaCreacion: new Date().toISOString(), creadoPor: currentUser ? currentUser.nombre : "sistema", creadoPorUid: currentUser ? currentUser.uid : "" });
        persistirDemo();
        refrescarTodo();
        cerrarModal("modalEditor");
        showToast("Usuario registrado (modo demostración).", "success");
        return;
    }

    estadoBotonGuardar(true);
    try {
        showToast("Creando la cuenta en Firebase Authentication...", "info");
        const r = await registrarUsuarioAuth(doc.nombre, email, password, rol);
        if (r.ok) {
            cerrarModal("modalEditor");
            showToast(r.cuentaPrevia
                ? "Cuenta existente en Authentication vinculada al sistema: «" + doc.nombre + "» quedó registrado con su rol."
                : "Usuario «" + doc.nombre + "» registrado: cuenta creada y rol asignado automáticamente.", "success");
        } else {
            mostrarErrorEditor(r.error);
        }
    } finally {
        estadoBotonGuardar(false);
    }
}

async function restablecerContrasenaUsuario(uid) {
    const u = dbUsuarios.find(x => String(x.uid) === String(uid));
    if (!u || !u.email) { showToast("Usuario no encontrado o sin correo.", "warning"); return; }
    if (MODO_DEMO) { showToast("Modo demostración: no hay contraseñas reales.", "warning"); return; }
    if (!confirm("¿Enviar un enlace de restablecimiento de contraseña a «" + u.email + "»?")) return;
    const appTemp = firebase.initializeApp(firebaseConfig, "temp-reset-" + Date.now());
    try {
        await appTemp.auth().sendPasswordResetEmail(u.email);
        showToast("Enlace de restablecimiento enviado a " + u.email + ".", "success");
    } catch (e) {
        console.error("Error enviando restablecimiento:", e);
        showToast("No se pudo enviar el enlace: " + errorAuthAmigable(e) + ".", "danger");
    } finally {
        try { await appTemp.delete(); } catch (e) {}
    }
}

/* ==================== CONFIGURACIÓN Y USUARIOS ==================== */
function renderConfiguracion() {
    if (!esAdmin()) return;
    const anioEl = $("cfgAnioVal"), verEl = $("cfgVersionVal"), estEl = $("cfgEstadoVal");
    if (!anioEl) return;
    anioEl.textContent = config.anio || "—";
    verEl.textContent = config.version || "—";
    if (config.publicado !== false) {
        estEl.textContent = "PUBLICADA";
        estEl.className = "text-sm font-black text-emerald-600 mt-1.5";
    } else {
        estEl.textContent = "NO PUBLICADA";
        estEl.className = "text-sm font-black text-amber-600 mt-1.5";
    }
    $("miUid").textContent = currentUser ? currentUser.uid : "—";
    const body = $("tablaUsuariosBody");
    if (!body) return;
    if (dbUsuarios.length === 0) {
        body.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-slate-400 font-semibold">Aún no hay administradores registrados. Use «Registrar usuario» para crear la primera cuenta de Administrador.</td></tr>';
        return;
    }
    body.innerHTML = dbUsuarios.slice().sort((a, b) => {
        // El usuario actual siempre aparece primero, marcado como (USTED)
        const pa = currentUser && String(a.uid) === String(currentUser.uid) ? 0 : 1;
        const pb = currentUser && String(b.uid) === String(currentUser.uid) ? 0 : 1;
        return pa - pb || String(a.nombre || "").localeCompare(String(b.nombre || ""));
    }).map(u => {
        const propio = !!(currentUser && String(u.uid) === String(currentUser.uid));
        const activo = u.activo !== false;
        // El selector manual de rol fue eliminado: las cuentas creadas aquí son
        // siempre de Administrador y el público accede en Modo Lectura sin cuenta.
        const celdaRol = (u.rol === "admin")
            ? '<span class="inline-flex items-center gap-1 text-xs font-bold text-mep-blue"><i data-lucide="shield-check" class="w-3.5 h-3.5"></i> Administrador</span>'
            : '<span class="inline-flex items-center gap-1 text-xs font-bold text-slate-500"><i data-lucide="eye" class="w-3.5 h-3.5"></i> Solo Lectura</span>';
        const btnActivar =
            '<button onclick="toggleActivo(\'' + esc(u.uid) + '\')" class="accion-btn accion-editar' + (propio ? " opacity-30 pointer-events-none" : "") + '" title="' +
            (propio ? "No puede desactivar su propia cuenta" : (activo ? "Desactivar (no podrá iniciar sesión)" : "Reactivar cuenta")) +
            '"><i data-lucide="' + (activo ? "user-x" : "user-check") + '" class="w-4 h-4"></i></button>';
        const btnEliminar =
            '<button onclick="eliminarUsuario(\'' + esc(u.uid) + '\')" class="accion-btn accion-borrar' + (propio ? " opacity-30 pointer-events-none" : "") + '" title="' +
            (propio ? "No puede eliminar su propia cuenta" : "Eliminar del sistema") +
            '"><i data-lucide="trash-2" class="w-4 h-4"></i></button>';
        const btnReset =
            '<button onclick="restablecerContrasenaUsuario(\'' + esc(u.uid) + '\')" class="accion-btn accion-ver" title="Enviar enlace para restablecer la contraseña"><i data-lucide="key-round" class="w-4 h-4"></i></button>';
        return "<tr class='hover:bg-slate-50/80'>" +
            "<td class='p-3 font-bold text-mep-navy'>" + esc(u.nombre || "—") +
            (propio ? ' <span class="text-[9px] text-white bg-mep-blue font-extrabold uppercase rounded-full px-1.5 py-0.5 align-middle">(usted)</span>' : "") +
            "</td>" +
            "<td class='p-3'>" + esc(u.email || "—") + "</td>" +
            "<td class='p-3 text-[10px] text-slate-400 break-all max-w-[160px]'>" + esc(u.uid) + "</td>" +
            "<td class='p-3 text-[11px]'>" + (u.creadoPor
                ? "<span class='font-semibold text-slate-600' title='UID del administrador: " + esc(u.creadoPorUid || "—") + (u.fechaCreacion ? " · Fecha de registro: " + esc(fmtFecha(u.fechaCreacion)) : "") + "'>" + esc(u.creadoPor) + "</span>"
                : "<span class='text-slate-300 font-semibold' title='Sin dato de auditoría (usuario creado antes de esta función)'>—</span>") + "</td>" +
            "<td class='p-3'>" + celdaRol + "</td>" +
            "<td class='p-3 text-center'><span class='" + (activo ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700") + " border text-[10px] font-extrabold uppercase rounded-full px-2 py-0.5'>" + (propio ? "Activo (usted)" : (activo ? "Activo" : "Inactivo")) + "</span></td>" +
            "<td class='p-3 text-center whitespace-nowrap'>" + btnReset + " " + btnActivar + " " + btnEliminar + "</td></tr>";
    }).join("");
    crearIconos();
}

// cambiarRol fue retirado: el selector manual de rol ya no existe. Las cuentas
// registradas desde la aplicación son siempre de Administrador; el público
// consulta en Modo Lectura sin necesidad de cuenta.
async function cambiarRol(uid, rol) {
    if (!esAdmin()) return;
    renderConfiguracion();
}

async function toggleActivo(uid) {
    if (!esAdmin()) return;
    // Prevención de autodesactivación: el administrador con sesión iniciada
    // no puede desactivar (ni reactivar) su propia cuenta.
    if (currentUser && String(uid) === String(currentUser.uid)) {
        showToast("Acción bloqueada: no puede desactivar su propia cuenta.", "danger");
        renderConfiguracion();
        return;
    }
    const u = dbUsuarios.find(x => String(x.uid) === String(uid));
    if (!u) return;
    const nuevo = u.activo === false;
    const ok = await guardarDoc(COLECCIONES.usuarios, { uid: uid, id: uid, activo: nuevo });
    if (ok) showToast(nuevo ? "Usuario reactivado." : "Usuario desactivado: ya no podrá iniciar sesión.", nuevo ? "success" : "warning");
    else renderConfiguracion(); // si falla, restaura el estado visual del interruptor
}

async function eliminarUsuario(uid) {
    if (!esAdmin()) return;
    // Prevención de autoeliminación: el administrador con sesión iniciada
    // no puede eliminar su propia autorización del sistema.
    if (currentUser && String(uid) === String(currentUser.uid)) {
        showToast("Acción bloqueada: no puede eliminar su propia cuenta.", "danger");
        renderConfiguracion();
        return;
    }
    if (!confirm("¿Eliminar la autorización de este usuario? (La cuenta de Firebase Authentication permanece; solo se quita del sistema)")) return;
    const ok = await eliminarDoc(COLECCIONES.usuarios, uid);
    if (ok) showToast("Usuario eliminado del sistema.", "info");
}

/* ==================== EXPORTACIÓN A EXCEL ==================== */
function exportarExcel(filas, encabezados, nombreArchivo, nombreHoja) {
    if (!window.XLSX) { showToast("La librería de Excel no está cargada.", "danger"); return; }
    if (!filas.length) { showToast("No hay datos para exportar.", "warning"); return; }
    const aoa = [encabezados].concat(filas);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Estilo del encabezado: azul MEP, texto blanco en negrita
    for (let c = 0; c < encabezados.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: 0, c: c });
        if (!ws[addr]) ws[addr] = { v: "", t: "s" };
        ws[addr].s = { fill: { fgColor: { rgb: "0B3C8C" } }, font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 }, alignment: { horizontal: "center", vertical: "center" } };
    }
    ws["!cols"] = encabezados.map(e => ({ wch: Math.max(12, Math.min(42, e.length + 6)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (nombreHoja || "DREC").slice(0, 31));
    XLSX.writeFile(wb, nombreArchivo);
    showToast("Archivo «" + nombreArchivo + "» generado.", "success");
}

function exportarModulo(modId) {
    const mod = MODULOS[modId];
    if (!mod) return;
    const lista = listaFiltrada(mod);
    const encabezados = mod.columnas.map(c => c.etiqueta).concat(esAdmin() && mod.coleccion === COLECCIONES.actividades ? ["Estado"] : []);
    const filas = lista.map(r => {
        const fila = mod.columnas.map(c => {
            const v = r[c.campo];
            if (v == null) return "";
            if (c.campo === "fecha" || c.campo === "fechaFin") return fmtFecha(v);
            return String(v);
        });
        if (esAdmin() && mod.coleccion === COLECCIONES.actividades) fila.push(r.estado === "borrador" ? "Borrador" : "Publicada");
        return fila;
    });
    exportarExcel(filas, encabezados, "DREC_" + config.anio + "_" + mod.id + ".xlsx", mod.titulo);
}

function exportarCalendario() {
    const act = actividadesVisibles().slice().sort((a, b) =>
        String(a.fecha || "").localeCompare(String(b.fecha || "")) || String(a.titulo || "").localeCompare(String(b.titulo || "")));
    const encabezados = ["Fecha", "Finaliza", "Módulo", "Actividad", "Hora", "Sede", "Participantes", "Circuito", "Estado"];
    const filas = act.map(a => {
        const mod = MODULOS[a.modulo] || { titulo: a.modulo || "" };
        return [fmtFecha(a.fecha), fmtFecha(a.fechaFin), mod.titulo, a.titulo || "", a.hora || "", a.sede || "", a.participantes || "", a.circuito || "", a.estado === "borrador" ? "Borrador" : "Publicada"];
    });
    exportarExcel(filas, encabezados, "DREC_" + config.anio + "_Calendario_Completo.xlsx", "Calendario " + config.anio);
}

/* ==================== ARRANQUE ==================== */
window.addEventListener("DOMContentLoaded", () => {
    crearIconos();
    iniciarFirebase();
    if (MODO_DEMO) cargarDatosDemo();
    aplicarAnio();
    // ACCESO PÚBLICO DE LECTURA: cualquier visitante entra automáticamente a
    // consultar la programación (cronograma, actividades, directorio) en Modo
    // de Solo Lectura, sin iniciar sesión. Si existe una sesión administrativa
    // activa (Firebase), onAuthStateChanged la restaurará como Administrador.
    if (MODO_DEMO) {
        entrarModoLectura(true);
    }
    // En modo Firebase, manejarAuthState (disparado con usuario null al no
    // haber sesión) invoca entrarModoLectura automáticamente. Como respaldo,
    // si por cualquier motivo la app sigue cerrada tras unos segundos, se
    // abre igualmente en Modo Lectura público.
    setTimeout(() => {
        const shell = $("appShell");
        if (shell && shell.classList.contains("hidden") && (!currentUser || currentUser.rol !== "admin")) {
            entrarModoLectura(true);
        }
    }, 3500);
    // Cierra el sidebar móvil con la tecla Escape
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") document.body.classList.remove("sidebar-open");
    });
});