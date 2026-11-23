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
    comisiones: "drec_comisiones",
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
let dbComisiones = [];    // drec_comisiones
let comisionActiva = "equipo-regional-convivir";
let miembroEditando = null;
let dbUsuarios = [];      // drec_usuarios (solo administradores lo consultan)

// Textos por defecto del marco filosófico institucional (Misión · Visión ·
// Valores). Un Administrador puede editarlos en vivo y se guardan en
// drec_configuracion/sistema; los usuarios en Modo Lectura los ven
// actualizarse automáticamente gracias a onSnapshot.
const MARCO_DEFAULT = {
    mision: "El MEP es el ente rector que garantiza a los habitantes del país el derecho fundamental a una educación de calidad, con acceso equitativo e inclusivo, con aprendizajes pertinentes y relevantes, para la formación plena e integral de las personas y la convivencia.",
    vision: "Ser una institución reconocida a nivel nacional e internacional, como la rectora del sistema educativo costarricense mediante el mejoramiento continuo de la gestión, con estándares modernos de eficacia, eficiencia y transparencia; orientada a la construcción de una sociedad inclusiva e integrada.",
    valores: {
        compromiso: "Es una decisión de vida de aceptación libre y conciencia de dar más de lo mínimo requerido. Con entrega, mística, honestidad y dedicación ante cualquier acción ejecutada a nivel laboral, personal y profesional; para el logro de los objetivos institucionales y el bienestar de la organización.",
        respeto: "Cuidar en el trato al otro, el valor y la dignidad que posee como persona humana, el entorno, atendiendo la particularidad sin imponer convicciones o creencias en congruencia con la normativa vigente.",
        transparencia: "Conjunto de acciones coherentes con aspectos de la política institucional y la normativa vigente, para el acceso de la ciudadanía a información veraz, comunicándola de forma asertiva, que genere confianza y promueva la imparcialidad. Que dé cuenta de las actuaciones del MEP, de tal forma que permita la evaluación de su gestión.",
        responsabilidad: "Es el cumplimiento continuo, consciente, diligente y oportuno de los deberes y obligaciones inherentes al cargo, según la normativa vigente, que conlleva al funcionario a asumir las consecuencias de sus actuaciones y tiene como finalidad la satisfacción del interés público."
    }
};

let config = {
    anio: new Date().getFullYear(),
    version: "Vs.001",
    publicado: true,
    saludo: "",
    firma: "",
    mision: MARCO_DEFAULT.mision,
    vision: MARCO_DEFAULT.vision,
    valores: Object.assign({}, MARCO_DEFAULT.valores),
    valoresLista: null,          // lista dinámica de valores [{titulo, texto, icono}] (migración automática)
    oferentesTexto: "Complete el formulario de registro para manifestar su interés en participar en los procesos de nombramiento de la Dirección Regional de Educación Cañas. Antes de enviarlo, verifique que la información proporcionada esté actualizada.",
    oferentesUrl: "",
    satisfaccionTexto: "Le invitamos a compartir su experiencia con el servicio recibido. Sus respuestas serán de gran utilidad para identificar oportunidades de mejora y continuar fortaleciendo la atención a la comunidad educativa.",
    satisfaccionUrl: "",
    pestanasInhabilitadas: []   // ids de pestañas ocultas para el Modo Lectura
};

let editorModulo = null;      // módulo abierto en el editor ("usuarios" | id de MODULOS)
let editorId = null;          // id del documento en edición (null = nuevo)
let editorPrefillFecha = null; // fecha precargada al agregar desde el calendario

let calAnio = new Date().getFullYear();
let calMes = new Date().getMonth(); // 0-11
let calDiaSel = null;         // ISO "YYYY-MM-DD"

let filtrosState = {};         // { modulo: { campo: valor } }

/* ==================== SELECCIÓN MÚLTIPLE Y OPERACIONES POR LOTES ====================
   Selección de registros en las tablas de datos (módulos de programación,
   Directorio y usuarios autorizados en Configuración). La selección respeta
   SIEMPRE los filtros activos: el checkbox maestro marca/desmarca únicamente
   los registros visibles (filtrados) de la tabla actual. */
let seleccion = { modulo: null, ids: [] }; // selección activa (un módulo a la vez)

function seleccionDeModulo(modId) {
    if (seleccion.modulo !== modId) return [];
    return seleccion.ids;
}
function estaSeleccionado(modId, id) {
    return seleccion.modulo === modId && seleccion.ids.indexOf(String(id)) !== -1;
}
// Alterna la selección de un registro individual (checkbox de fila).
function alternarSeleccion(modId, id, checkbox) {
    if (seleccion.modulo !== modId) seleccion = { modulo: modId, ids: [] };
    const clave = String(id);
    const i = seleccion.ids.indexOf(clave);
    if (checkbox && checkbox.checked) { if (i === -1) seleccion.ids.push(clave); }
    else if (i !== -1) seleccion.ids.splice(i, 1);
    if (!seleccion.ids.length) seleccion.modulo = modId;
    const filaSel = checkbox && checkbox.closest ? checkbox.closest("tr") : null;
    if (filaSel) filaSel.classList.toggle("fila-seleccionada", !!checkbox.checked);
    sincronizarCheckMaestro(modId);
    actualizarBarraSeleccion();
}
// Checkbox maestro: marca/desmarca TODOS los registros visibles (filtrados).
function alternarSeleccionTodos(modId, marcado) {
    const ids = idsVisiblesDeTabla(modId);
    if (marcado) seleccion = { modulo: modId, ids: ids.map(String) };
    else seleccion = { modulo: null, ids: [] };
    sincronizarCheckMaestro(modId);
    actualizarBarraSeleccion();
    if (modId === "usuarios") renderConfiguracion();
    else if (MODULOS[modId]) renderTabla(MODULOS[modId]);
}
function limpiarSeleccion() {
    seleccion = { modulo: null, ids: [] };
    actualizarBarraSeleccion();
}
// «Deseleccionar»: cancela la selección con un solo clic. Desmarca todas las
// casillas, quita el resaltado de las filas y oculta la barra flotante.
function deseleccionarTodo() {
    seleccion = { modulo: null, ids: [] };
    document.querySelectorAll(".check-fila").forEach(cb => {
        cb.checked = false;
        const tr = cb.closest("tr");
        if (tr) tr.classList.remove("fila-seleccionada");
    });
    document.querySelectorAll(".check-maestro").forEach(cb => { cb.checked = false; cb.indeterminate = false; });
    actualizarBarraSeleccion();
}
// Retira de la selección activa los ids que acaban de eliminarse.
function quitarDeSeleccion(modId, ids) {
    if (seleccion.modulo !== modId) return;
    const quitar = (Array.isArray(ids) ? ids : [ids]).map(String);
    seleccion.ids = seleccion.ids.filter(id => quitar.indexOf(id) === -1);
    actualizarBarraSeleccion();
}
// Nombre legible de un registro (para los resúmenes de confirmación).
function nombreRegistro(r, id) {
    if (!r) return String(id || "");
    const n = String(r.titulo || r.funcionario || r.institucion || r.departamento || r.oficina || r.nombre || "").trim();
    return n || String(id || "");
}
// Registros visibles (respetando filtros) de un módulo o de la tabla de usuarios.
function idsVisiblesDeTabla(modId) {
    if (modId === "usuarios") return dbUsuarios.map(u => String(u.uid));
    const mod = MODULOS[modId];
    if (!mod) return [];
    return listaFiltrada(mod).map(r => String(r.id));
}
// Sincroniza el estado visual (marcado / indeterminado) del checkbox maestro.
function sincronizarCheckMaestro(modId) {
    const cb = $("check-maestro-" + modId);
    if (!cb) return;
    const sel = seleccionDeModulo(modId);
    const ids = idsVisiblesDeTabla(modId);
    cb.checked = ids.length > 0 && ids.every(id => sel.indexOf(String(id)) !== -1);
    cb.indeterminate = !cb.checked && ids.some(id => sel.indexOf(String(id)) !== -1);
}

// Barra flotante de acciones por lotes: contador, «Deseleccionar» y eliminación masiva.
function actualizarBarraSeleccion() {
    const barra = $("barraSeleccion");
    if (!barra) return;
    const n = seleccion.ids.length;
    if (!esAdmin() || !seleccion.modulo || n === 0) {
        barra.classList.add("hidden");
        barra.innerHTML = "";
        return;
    }
    const esUsuarios = seleccion.modulo === "usuarios";
    const cfg = esUsuarios ? { titulo: "Usuarios autorizados" } : MODULOS[seleccion.modulo];
    if (!cfg) { barra.classList.add("hidden"); return; }
    barra.innerHTML =
        '<div class="barra-sel-info">' +
            '<span class="barra-sel-count"><i data-lucide="check-check" class="w-4 h-4"></i>' + n + '</span>' +
            '<span class="barra-sel-texto">' +
                '<span class="barra-sel-titulo">' + (n === 1 ? "1 registro seleccionado" : n + " registros seleccionados") + '</span>' +
                '<span class="barra-sel-modulo">' + esc(cfg.titulo || cfg.etiqueta || "") + '</span>' +
            '</span>' +
        '</div>' +
        '<div class="barra-sel-acciones">' +
            '<button type="button" onclick="deseleccionarTodo()" class="btn-suave barra-sel-limpiar" title="Cancelar la selección actual">' +
                '<i data-lucide="x" class="w-4 h-4"></i> Deseleccionar</button>' +
            '<button type="button" onclick="eliminarSeleccionados()" class="btn-mep-danger px-4 py-2 rounded-2xl font-bold text-xs flex items-center gap-1.5">' +
                '<i data-lucide="trash-2" class="w-4 h-4"></i> Eliminar seleccionados</button>' +
        '</div>';
    barra.classList.remove("hidden");
    crearIconos();
}

// Eliminación en lote: LocalStorage (Modo Demo) o Firestore (writeBatch por
// bloques de 400 borrados, el límite seguro de una transacción por lotes).
async function eliminarRegistrosLote(coleccion, ids) {
    if (!ids || !ids.length) return true;
    if (MODO_DEMO) {
        if (coleccion === COLECCIONES.actividades) dbActividades = dbActividades.filter(a => ids.indexOf(String(a.id)) === -1);
        if (coleccion === COLECCIONES.directorio) dbDirectorio = dbDirectorio.filter(d => ids.indexOf(String(d.id)) === -1);
        if (coleccion === COLECCIONES.usuarios) dbUsuarios = dbUsuarios.filter(u => ids.indexOf(String(u.uid)) === -1);
        persistirDemo();
        refrescarTodo();
        return true;
    }
    let ok = true;
    for (let i = 0; i < ids.length; i += 400) {
        try {
            const batch = firebaseDB.batch();
            ids.slice(i, i + 400).forEach(id => batch.delete(firebaseDB.collection(coleccion).doc(String(id))));
            await batch.commit();
        } catch (e) {
            console.error("Error en borrado por lotes:", e);
            showToast("No se pudo eliminar el lote (" + (e.code || e.message) + ").", "danger");
            ok = false;
            break;
        }
    }
    return ok;
}

// «Eliminar seleccionados»: borrado masivo de los registros marcados, con el
// modal de confirmación institucional (resumen de lo que se va a borrar).
async function eliminarSeleccionados() {
    if (!esAdmin()) return;
    const modId = seleccion.modulo;
    const ids = seleccion.ids.slice();
    if (!modId || !ids.length) { showToast("No hay registros seleccionados.", "warning"); return; }
    if (modId === "usuarios") {
        // Nunca se elimina la cuenta propia del administrador en sesión.
        const propios = ids.filter(id => currentUser && String(id) === String(currentUser.uid));
        const objetivo = ids.filter(id => !propios.length || propios.indexOf(id) === -1);
        if (!objetivo.length) { showToast("Acción bloqueada: no puede eliminar su propia cuenta.", "danger"); return; }
        const nombres = objetivo.map(uid => {
            const u = dbUsuarios.find(x => String(x.uid) === String(uid));
            return u ? ((u.nombre || u.email || uid) + (u.nombre && u.email ? " · " + u.email : "")) : String(uid);
        });
        const okU = await mostrarConfirmacion({
            variante: "danger",
            titulo: objetivo.length === 1 ? "¿Eliminar 1 usuario del sistema?" : "¿Eliminar " + objetivo.length + " usuarios del sistema?",
            mensaje: "Se retirará su autorización de acceso. Las cuentas permanecen en Firebase Authentication; solo se quita su autorización. Esta acción no se puede deshacer.",
            items: [
                { etiqueta: "Sección", valor: "Usuarios autorizados" },
                { etiqueta: "Total a eliminar", valor: objetivo.length + (objetivo.length === 1 ? " usuario" : " usuarios") }
            ],
            lista: nombres,
            textoCancelar: "Cancelar",
            textoAceptar: "Eliminar definitivamente",
            iconoAceptar: "trash-2"
        });
        if (!okU) return;
        limpiarSeleccion();
        const ok = await eliminarRegistrosLote(COLECCIONES.usuarios, objetivo);
        if (ok) showToast(objetivo.length + (objetivo.length === 1 ? " usuario eliminado" : " usuarios eliminados") + " del sistema.", "info");
        renderConfiguracion();
        return;
    }
    const cfg = MODULOS[modId];
    if (!cfg) return;
    const nombres = ids.map(id => nombreRegistro(registroDe(cfg, id), id));
    const okM = await mostrarConfirmacion({
        variante: "danger",
        titulo: ids.length === 1 ? "¿Eliminar el registro seleccionado?" : "¿Eliminar " + ids.length + " registros seleccionados?",
        mensaje: "Se eliminarán de forma permanente de la programación. Esta acción no se puede deshacer.",
        items: [
            { etiqueta: "Módulo", valor: cfg.titulo },
            { etiqueta: "Total a eliminar", valor: ids.length + (ids.length === 1 ? " registro" : " registros") }
        ],
        lista: nombres,
        textoCancelar: "Cancelar",
        textoAceptar: "Eliminar definitivamente",
        iconoAceptar: "trash-2"
    });
    if (!okM) return;
    limpiarSeleccion();
    const ok = await eliminarRegistrosLote(cfg.coleccion, ids);
    if (ok) showToast(ids.length + (ids.length === 1 ? " registro eliminado" : " registros eliminados") + ".", "info");
}

// «Eliminar todos»: borrado masivo de TODOS los registros del módulo actual.
// Confirmación estricta: el administrador debe escribir ELIMINAR para continuar.
async function eliminarTodosDelModulo(modId) {
    if (!esAdmin()) return;
    const cfg = MODULOS[modId];
    if (!cfg) return;
    let ids;
    if (cfg.coleccion === COLECCIONES.directorio) ids = dbDirectorio.map(r => String(r.id));
    else ids = dbActividades.filter(a => a.modulo === modId).map(r => String(r.id));
    if (!ids.length) { showToast("El módulo «" + cfg.titulo + "» no tiene registros.", "info"); return; }
    const ok0 = await mostrarConfirmacion({
        variante: "danger",
        titulo: "¿Eliminar TODOS los registros del módulo?",
        mensaje: "Está a punto de borrar todo el contenido de «" + cfg.titulo + "». Los demás módulos y el Directorio Telefónico DIRECA no se modifican. Esta acción no se puede deshacer.",
        items: [
            { etiqueta: "Módulo", valor: cfg.titulo },
            { etiqueta: "Total a eliminar", valor: ids.length + (ids.length === 1 ? " registro" : " registros") }
        ],
        escribir: "ELIMINAR",
        textoCancelar: "Cancelar",
        textoAceptar: "Eliminar definitivamente",
        iconoAceptar: "trash-2"
    });
    if (!ok0) return;
    limpiarSeleccion();
    const ok = await eliminarRegistrosLote(cfg.coleccion, ids);
    if (ok) showToast("Eliminados " + ids.length + " registros de «" + cfg.titulo + "».", "info");
}

/* ==================== DIRECTORIO TELEFÓNICO DIRECA (DATOS OFICIALES) ====================
   Fuente: «DIRECTORIO TELEFÓNICO DIRECA» (documento institucional).
   Cada entrada es [oficina, extensión]. Los registros se siembran de forma
   NO destructiva (solo se agregan los que aún no existen, sin sobreescribir
   datos previos del directorio). */
const OFICINAS_DIRECA = [
    ["Plataforma de Servicios (recepción)", "3000"],
    ["Oficiales de Seguridad", "3001"],
    ["Educación Abierta", "3002"],
    // EXCLUSIÓN OBLIGATORIA: Nidia Briceño Jiménez / Extensión 3003 NO debe
    // aparecer en ninguna opción desplegable ni en la interfaz. No se incluye
    // aquí y además registroDIRECAExcluido() la filtra siempre que exista.
    ["Of. Archivo", "3004"],
    ["Of. Archivo", "3005"],
    ["Contador de Juntas", "3006"],
    ["Coordinador de Juntas", "3007"],
    ["Secretaria de DSAF", "3008"],
    ["Jefatura DSAF", "3009"],
    ["Asesoría de capacitación", "3010"],
    ["Director Regional", "3011"],
    ["Secretaría de Dirección", "3012"],
    ["Asesoría Legal", "3013"],
    ["Asesoría de Educación Musical", "3014"],
    ["Asesoría de Orientación", "3015"],
    ["Asesoría de EPJA.", "3016"],
    ["Asesoría de Artes Plásticas", "3017"],
    ["Jefatura DAP", "3018"],
    ["Secretaría DAP", "3019"],
    ["Psicología", "3020"],
    ["Trabajo Social", "3021"],
    ["Área Educativa 1", "3022"],
    ["Área Educativa 2", "3023"],
    ["Asesoría de Educación Física", "3024"],
    ["Asesoría de Inglés", "3025"],
    ["Asesoría de Educación Preescolar", "3026"],
    ["Programa Vivamos la Guanacastequidad", "3027"],
    ["Asesoría de Evaluación", "3028"],
    ["Asesoría de Ciencias", "3029"],
    ["Asesoría de Español", "3030"],
    ["Asesoría de Matemática", "3031"],
    ["Asesoría de Educación Religiosa", "3032"],
    ["Asesoría de Estudios Sociales", "3033"],
    ["Asesoría de Cívica", "3034"],
    ["Asesoría de Educación Especial", "3035"],
    ["Oficina de Informática", "3036"],
    ["Comedor", "3037"]
];
// Opciones del desplegable de oficinas + entrada manual («__OTRA__»).
const OPCIONES_OFICINAS_DIRECA = OFICINAS_DIRECA.map(o => o[0]).concat(["__OTRA__"]);
function extensionDeOficina(oficina) {
    const e = OFICINAS_DIRECA.find(o => o[0] === oficina);
    return e ? e[1] : "";
}

/* Oficinas de supervisión escolar por circuito (categoría «Circuitos»). */
const SUPERVISIONES_CIRCUITOS = [
    ["Supervisión circuito 01", "2669-2611"],
    ["Supervisión circuito 02", "2662-0685"],
    ["Supervisión circuito 03", "2695-5509"],
    ["Supervisión circuito 04", "2668-6836"],
    ["Supervisión circuito 05", "2100 5138"]
];
const OPCIONES_SUPERVISIONES = SUPERVISIONES_CIRCUITOS.map(o => o[0]);
function telefonoDeSupervision(oficina) {
    const e = SUPERVISIONES_CIRCUITOS.find(o => o[0] === oficina);
    return e ? e[1] : "";
}

/* Registros precargados (siembra no destructiva por id de documento). */
const REGISTROS_DIRECA = OFICINAS_DIRECA.map(o => ({
    id: "DIRECA-OF-" + o[1],
    categoria: "Directorio Telefónico DIRECA",
    oficina: o[0],
    extension: o[1]
}));
const REGISTROS_SUPERVISIONES = SUPERVISIONES_CIRCUITOS.map(o => ({
    id: "DIRECA-SUP-" + o[0].replace(/\D/g, ""),
    categoria: "Circuitos",
    oficinaSupervision: o[0],
    telefono: o[1]
}));

/* EXCLUSIÓN OBLIGATORIA: la extensión 3003 / Nidia Briceño Jiménez jamás se
   muestra en la interfaz (ni en Modo Lectura ni al Administrador). */
function registroDIRECAExcluido(r) {
    if (!r) return false;
    if (String(r.extension || "").replace(/\D/g, "") === "3003") return true;
    return normalize(r.oficina || r.departamento || r.funcionario || "") === "nidia briceno jimenez";
}

/* Siembra idempotente y NO destructiva: agrega únicamente los registros del
   directorio DIRECA que aún no existan (por id), conservando íntegramente los
   registros previos. En modo demo se guardan en LocalStorage; en producción
   los escribe en Firestore solo un Administrador (reglas: allow write: esAdmin). */
async function sincronizarDirectorioDIRECA() {
    const faltantes = REGISTROS_DIRECA.concat(REGISTROS_SUPERVISIONES)
        .filter(nuevo => !dbDirectorio.some(r => String(r.id) === String(nuevo.id)));
    if (!faltantes.length) return;
    if (MODO_DEMO) {
        dbDirectorio = dbDirectorio.concat(faltantes.map(r => Object.assign({}, r)));
        persistirDemo();
        refrescarTodo();
        return;
    }
    if (!esAdmin() || !firebaseDB) return;
    for (const r of faltantes) {
        try {
            await firebaseDB.collection(COLECCIONES.directorio).doc(r.id).set(Object.assign({}, r), { merge: true });
        } catch (e) {
            console.warn("No se pudo sembrar el registro DIRECA " + r.id + ":", e);
        }
    }
}

/* ==================== CATÁLOGO DE MÓDULOS ==================== */
/* Deportivos: jerarquía exacta de los desplegables en cascada
   (Categoría / Programa → Etapa / Subcategoría), sin duplicados. */
const DEP_CATEGORIAS = [
    "Juegos Deportivos Estudiantiles",
    "Juegos Deportivos Estudiantiles Regional"
];
const DEP_ETAPAS = {
    "Juegos Deportivos Estudiantiles": [
        "Inscripciones y ejecución Institucional",
        "Periodos Verificaciones Interregionales",
        "Verificaciones Circuitales",
        "Periodos Verificaciones Nacionales"
    ],
    "Juegos Deportivos Estudiantiles Regional": [
        "Periodos Verificaciones Regionales",
        "Ejecución de Etapas Regionales",
        "Juegos Deportivos Estudiantiles Interregional",
        "Juegos Deportivos Estudiantiles Etapas Nacionales"
    ]
};

/* ==================== CTP Y TÉCNICOS: FORMULARIO EN CASCADA (3 NIVELES) ====================
   Nivel 1 «Opción» → Nivel 2 «Nivel de pruebas» → campos específicos según
   la rama elegida (actividad + fecha, bimensual NEO, o sub-opción + periodo
   de pruebas + fecha). Retrocompatible: los registros previos conservan sus
   campos históricos y el resumen se guarda en «titulo». */
const CTP_N2_7_11 = "FECHA DE APLICACIÓN DE PRUEBAS PARA 7°, 8°, 9°, 10° Y 11°";
const CTP_N2_DUODECIMO = "FECHA DE APLICACIÓN DE PRUEBAS PARA DUODÉCIMO AÑO";
const CTP_N2_NEO = "SEGUIMIENTO BIMENSUAL DE NEO";
const CTP_N2_IPEC = "FECHA DE APLICACIÓN DE PRUEBAS PARA IPEC-CINDEAs";
const CTP_N2_NOCTURNO = "FECHA DE APLICACIÓN DE PRUEBAS PARA COLEGIOS ACADÉMICOS NOCTURNO";

const CTP_OPCIONES_N1 = [
    "Programación Académica Colegio Técnico Profesional",
    "Coordinación Técnica, Con La Empresa Y Emprendedurismo, Colegio Técnico Profesional",
    "Seguimiento Bimensual de NEO",
    "Programación Académica, Colegios Académicos Nocturnos, CINDEAs e IPEC"
];

// Segundo nivel según la opción principal elegida.
const CTP_SEGUNDO_NIVEL = {};
CTP_OPCIONES_N1.slice(0, 2).forEach(o => { CTP_SEGUNDO_NIVEL[o] = [CTP_N2_7_11, CTP_N2_DUODECIMO]; });
CTP_SEGUNDO_NIVEL["Seguimiento Bimensual de NEO"] = [CTP_N2_NEO];
CTP_SEGUNDO_NIVEL["Programación Académica, Colegios Académicos Nocturnos, CINDEAs e IPEC"] = [CTP_N2_IPEC, CTP_N2_NOCTURNO];

// A) Actividades para pruebas de 7° a 11° (CTP).
const CTP_ACT_7_11 = [
    "Inicio del I Periodo 2026",
    "I Pruebas del I Periodo",
    "II Pruebas del I Periodo",
    "Culmina el I Periodo",
    "Inicio del II Periodo 2026",
    "I Pruebas del II Periodo",
    "II Pruebas del II Periodo",
    "I Prueba de ampliación",
    "II Pruebas de ampliación",
    "Finaliza el II Periodo 2026"
];

// B) Actividades para pruebas de Duodécimo año (CTP).
const CTP_ACT_DUODECIMO = [
    "Inicio del I Periodo 2026",
    "I Pruebas del I Periodo para estudiantes de Duodécimo año",
    "II Pruebas del I Periodo para estudiantes de Duodécimo año",
    "Culmina el I Periodo para estudiantes Duodécimo año",
    "Inicio del II Periodo 2026",
    "I Pruebas del II Periodo para estudiantes de Duodécimo año",
    "II Pruebas del II Periodo para estudiantes de Duodécimo año",
    "I Prueba de ampliación",
    "Finaliza el II Periodo para estudiantes de Duodécimo"
];

// C) Bimestres del seguimiento NEO.
const CTP_BIMESTRES = ["Marzo", "Mayo", "Julio", "Setiembre", "Noviembre"];

// D) Sub-opciones y periodos de prueba de IPEC-CINDEAs.
const CTP_SUB_IPEC = {
    "-I SEMESTRE IPEC-CINDEA": ["I Pruebas Ordinaria", "II Pruebas Ordinaria", "I Prueba Ampliación", "II Prueba Ampliación"],
    "-II SEMESTRE IPEC-CINDEA": ["I Pruebas Ordinaria", "II Pruebas Ordinaria", "I Prueba Ampliación"],
    "-II Semestre IPEC-CINDEA módulos IV-P y VIII-P (estandarizadas)": ["I Pruebas Ordinaria", "II Pruebas Ordinaria", "I Prueba Ampliación", "II Prueba Ampliación"]
};

// E) Sub-opciones y periodos de prueba de Colegios Académicos Nocturnos.
const CTP_SUB_NOCTURNO = {
    "-I PERIODO COLEGIO ACADÉMICO NOCTURNO": ["I Pruebas Ordinaria", "II Pruebas Ordinaria"],
    "-II PERIODO COLEGIO ACADÉMICO NOCTURNO (7°, 8° Y 10°)": ["I Pruebas Ordinaria", "II Pruebas Ordinaria", "I Prueba Ampliación"],
    "-II PERIODO COLEGIO ACADÉMICO NOCTURNO (9° Y 11°)": ["I Pruebas Ordinaria", "II Pruebas Ordinaria", "I Prueba Ampliación", "II Prueba Ampliación"]
};

// Definiciones de campo del módulo CTP y Técnicos.
const F_CTP = {
    opcion:            { clave: "opcion", etiqueta: "Opción", tipo: "select", requerido: true, opciones: CTP_OPCIONES_N1 },
    subopcion:         { clave: "subopcion", etiqueta: "Nivel de pruebas", tipo: "select", requerido: true, opciones: [] },
    actividad:         { clave: "actividad", etiqueta: "Actividades", tipo: "select", requerido: true, opciones: [] },
    bimensual:         { clave: "bimensual", etiqueta: "Bimensual", tipo: "select", requerido: true, opciones: CTP_BIMESTRES },
    entregaDocentes:   { clave: "entregaDocentes", etiqueta: "Entrega de Docentes a Dirección", tipo: "date", requerido: true },
    entregaPlataforma: { clave: "entregaPlataforma", etiqueta: "Entrega Dirección en Plataforma", tipo: "date", requerido: true },
    nivel3:            { clave: "nivel3", etiqueta: "Sub-opción", tipo: "select", requerido: true, opciones: [] },
    periodoPruebas:    { clave: "periodoPruebas", etiqueta: "Periodo de pruebas", tipo: "select", requerido: true, opciones: [] },
    fecha:             { clave: "fecha", etiqueta: "Fecha", tipo: "date", requerido: true }
};

// Periodos de prueba disponibles según la sub-opción (ramas D y E).
function opcionesPeriodoCTP(nivel3) {
    if (CTP_SUB_IPEC[nivel3]) return CTP_SUB_IPEC[nivel3];
    if (CTP_SUB_NOCTURNO[nivel3]) return CTP_SUB_NOCTURNO[nivel3];
    return [];
}

// Campos específicos (tercer nivel) según el nivel de pruebas elegido.
// Devuelve las definiciones completas de los campos del bloque dinámico.
function camposCTP(subopcion) {
    const s = String(subopcion || "");
    if (s === CTP_N2_7_11) {
        return [Object.assign({}, F_CTP.actividad, { opciones: CTP_ACT_7_11 }), F_CTP.fecha];
    }
    if (s === CTP_N2_DUODECIMO) {
        return [Object.assign({}, F_CTP.actividad, { opciones: CTP_ACT_DUODECIMO }), F_CTP.fecha];
    }
    if (s === CTP_N2_NEO) {
        return [F_CTP.bimensual, F_CTP.entregaDocentes, F_CTP.entregaPlataforma];
    }
    if (s === CTP_N2_IPEC || s === CTP_N2_NOCTURNO) {
        const subs = s === CTP_N2_IPEC ? CTP_SUB_IPEC : CTP_SUB_NOCTURNO;
        return [
            Object.assign({}, F_CTP.nivel3, { opciones: Object.keys(subs) }),
            Object.assign({}, F_CTP.periodoPruebas),
            F_CTP.fecha
        ];
    }
    return [];
}

const F = {
    titulo:  { clave: "titulo", etiqueta: "Actividad", tipo: "text", requerido: true },
    fecha:   { clave: "fecha", etiqueta: "Fecha inicial", tipo: "date", requerido: true },
    fechaFin:{ clave: "fechaFin", etiqueta: "Fecha final (opcional)", tipo: "date" },
    hora:    { clave: "hora", etiqueta: "Hora" , tipo: "time" },
    sede:    { clave: "sede", etiqueta: "Sede", tipo: "text" },
    part:    { clave: "participantes", etiqueta: "Participantes", tipo: "chips" },
    resp:    { clave: "responsable", etiqueta: "Responsable", tipo: "text" },
    desc:    { clave: "descripcion", etiqueta: "Observaciones", tipo: "textarea" },
    circuito:{ clave: "circuito", etiqueta: "Circuito", tipo: "select",
               opciones: ["", "Regional (todos)", "Circuito 01 (Cañas)", "Circuito 02 (Abangares)", "Circuito 03 (Tilarán)", "Circuito 04 (Colorado)", "Circuito 05 (La Altura)"] },
    // Deportivos: desplegables en cascada (Categoría → Etapa).
    depCategoria: { clave: "categoria", etiqueta: "Categoría / Programa", tipo: "select", requerido: true, opciones: DEP_CATEGORIAS },
    depEtapa:     { clave: "etapa", etiqueta: "Etapa / Subcategoría", tipo: "select", requerido: true, opciones: [] },
    logro:{ clave: "logro", etiqueta: "Nivel de logro", tipo: "select",
               opciones: ["", "logrado", "no logrado"] },
    tipo: { clave: "tipo", etiqueta: "Tipo", tipo: "select", opciones: ["Festival estudiantil de las Artes"	
,"Feria de la Ciencia y la Tecnología"] },           

};

const COMISIONES_OFICIALES = [{"id": "equipo-regional-convivir", "tipo": "Equipo / Comité", "nombre": "Equipo Regional Convivir"}, {"id": "equipo-regional-permanencia", "tipo": "Equipo / Comité", "nombre": "Equipo Regional de Permanencia"}, {"id": "equipo-regional-steam", "tipo": "Equipo / Comité", "nombre": "Equipo Regional STEAM"}, {"id": "interculturalidad-vivamos-guanacastequidad", "tipo": "Equipo / Comité", "nombre": "Interculturalidad / Programa Vivamos la Guanacastequidad"}, {"id": "comite-regional-avancesmos", "tipo": "Equipo / Comité", "nombre": "Comité Regional de Avancesmos"}, {"id": "comite-regional-emergencia-salud-ocupacional", "tipo": "Equipo / Comité", "nombre": "Comité Regional de Emergencia y Salud Ocupacional"}, {"id": "comite-regional-bandera-azul", "tipo": "Equipo / Comité", "nombre": "Comité Regional de Bandera Azul"}, {"id": "comite-regional-pgai", "tipo": "Equipo / Comité", "nombre": "Comité Regional del Plan de Gestión Ambiental (PGAI) Ley 8839"}, {"id": "comite-regional-fea", "tipo": "Equipo / Comité", "nombre": "Comité Regional del FEA"}, {"id": "comite-regional-feria-cientifica", "tipo": "Equipo / Comité", "nombre": "Comité Regional de Feria Científica"}, {"id": "comite-regional-etica-valores", "tipo": "Equipo / Comité", "nombre": "Comité Regional de Ética y Valores"}, {"id": "comite-desarrollo-organizacional", "tipo": "Equipo / Comité", "nombre": "Comité Desarrollo Organizacional"}, {"id": "alto-potencial", "tipo": "Equipo / Comité", "nombre": "Alto Potencial"}, {"id": "saiid-risa-salud-nutricion", "tipo": "Equipo / Comité", "nombre": "SAIID / Servicios de Salud Integral e Intersectorial del Desarrollo de la Niñez en C.R (RISA) / Salud y Nutrición Escolar"}, {"id": "resolucion-conflictos", "tipo": "Equipo / Comité", "nombre": "Resolución de Conflictos"}, {"id": "juegos-deportivos-olimpiadas-especiales", "tipo": "Equipo / Comité", "nombre": "Juegos Deportivos Estudiantiles / Olimpiadas Especiales"}, {"id": "poa-informes", "tipo": "Grupo de apoyo", "nombre": "POA / Informes"}, {"id": "ccci-recadeh", "tipo": "Grupo de apoyo", "nombre": "CCCI / RECADEH"}, {"id": "recafis-irais", "tipo": "Grupo de apoyo", "nombre": "RECAFIS / Red Costarricense de Actividad Física y Salud-IRAIS"}, {"id": "aceleradores", "tipo": "Grupo de apoyo", "nombre": "Aceleradores"}, {"id": "fiestas-patrias", "tipo": "Grupo de apoyo", "nombre": "Fiestas Patrias"}, {"id": "fomento-lectura", "tipo": "Grupo de apoyo", "nombre": "Fomento de la lectura"}, {"id": "junta-proteccion-ninez", "tipo": "Grupo de apoyo", "nombre": "Junta de Protección de la Niñez"}, {"id": "robotica", "tipo": "Grupo de apoyo", "nombre": "Robótica"}, {"id": "olimpiadas-matematicas", "tipo": "Grupo de apoyo", "nombre": "Olimpiadas matemáticas (OLCOMA-OLCOMEP)"}, {"id": "bibliotecologos", "tipo": "Grupo de apoyo", "nombre": "Bibliotecólogos"}, {"id": "pastoral-educativa", "tipo": "Grupo de apoyo", "nombre": "Pastoral Educativa"}, {"id": "actividades-sociales", "tipo": "Grupo de apoyo", "nombre": "Actividades Sociales"}, {"id": "pruebas-nacionales", "tipo": "Grupo de apoyo", "nombre": "Pruebas Nacionales"}];

const MODULOS = {
    celebrativos: {
        id: "celebrativos", etiqueta: "Celebrativos",
        titulo: "Semanas y Días Celebrativos",
        descripcion: "Fechas cívicas, semanas festivas y conmemoraciones oficiales del año lectivo.",
        icono: "sparkles", color: "#D97706", prefijo: "CEL",
        coleccion: COLECCIONES.actividades,
        columnas: [ {campo:"tipo",etiqueta:"Tipo"}, {campo:"fecha",etiqueta:"Inicio"}, {campo:"fechaFin",etiqueta:"Finaliza"}, {campo:"titulo",etiqueta:"Actividad"} ],
        filtros: [ {campo:"tipo",etiqueta:"Tipo",opciones:["","Día","Semana"]} ],
        campos: [
            { clave:"tipo", etiqueta:"Tipo", tipo:"select", requerido:true, opciones:["Día","Semana"] },
            F.fecha, F.fechaFin,{ clave:"titulo", etiqueta:"Actividad", tipo:"text", requerido:true } ]
    },
    ferias_festivales: {
        id: "ferias_festivales", etiqueta: "Ferias y Festivales",
        titulo: "Ferias Regionales y Festivales",   
        descripcion: "FEA, ferias de ciencias y tecnología, y demás festivales: etapas institucionales, circuitos 01–05 y ejecución regional.",
        icono: "theater", color: "#DC2626", prefijo: "FF",
        coleccion: COLECCIONES.actividades,
       columnas: [ {campo:"tipo",etiqueta:"Tipo de evento"}, {campo:"fecha",etiqueta:"Fecha"}, {campo:"fechaFin",etiqueta:"Fecha de Finalizacion"}, {campo:"titulo",etiqueta:"Actividad"} ],
       filtros: [ {campo:"tipo",etiqueta:"Tipo",opciones:["Festival estudiantil de las Artes"	
,"Feria de la Ciencia y la Tecnología"]}, ],
        // Primer campo obligatorio: «¿Será Día o Semana?». El resto de campos
        // se despliega dinámicamente (camposCelebrativos / refrescarCamposCelebrativos).
        campos: [
            { clave:"tipo", etiqueta:"Seleccione el tipo de evento", tipo:"select", requerido:true, opciones:["Festival estudiantil de las Artes"	
,"Feria de la Ciencia y la Tecnología"] },
            F.fecha, F.fechaFin,  { clave:"titulo", etiqueta:"Actividad ", tipo:"text", requerido:true,  } ]
    },
    pruebas_academicas: {
        id: "pruebas_academicas", etiqueta: "Pruebas Académicas",
        titulo: "Pruebas Académicas y Períodos Lectivos",
        descripcion: "Fechas de I y II período lectivo: educación formal, CINDEA, IPEC y modalidades técnicas (TP).",
        icono: "graduation-cap", color: "#1E40AF", prefijo: "PA",
        coleccion: COLECCIONES.actividades,
        columnas: [ {campo:"titulo",etiqueta:"Prueba / Período"}, {campo:"modalidad",etiqueta:"Modalidad"}, {campo:"periodo",etiqueta:"Período"}, {campo:"fecha",etiqueta:"Inicio"}, {campo:"fechaFin",etiqueta:"Finaliza"} ],
        filtros: [ {campo:"modalidad",etiqueta:"Modalidad",opciones:["","Educación Formal","CINDEA","IPEC","Técnico Profesional (TP)"]}, {campo:"periodo",etiqueta:"Período",opciones:["","I Período","II Período"]}, {campo:"circuito",etiqueta:"Circuito",opciones:null} ],
        campos: [ F.titulo,
            { clave:"modalidad", etiqueta:"Modalidad", tipo:"select", requerido:true, opciones:["Educación Formal","CINDEA","IPEC","Técnico Profesional (TP)"] },
            { clave:"periodo", etiqueta:"Período", tipo:"select", opciones:["","I Período","II Período"] },
            F.circuito, F.fecha, F.fechaFin, F.sede, F.part, F.desc ]
    },
    pruebas_estandarizadas: {
        id: "pruebas_estandarizadas", etiqueta: "Estandarizadas",
        titulo: "Pruebas Estandarizadas y Ampliación",
        descripcion: "Cronograma de convocatorias, pruebas nacionales y pruebas de ampliación.",
        icono: "clipboard-check", color: "#059669", prefijo: "PE",
        coleccion: COLECCIONES.actividades,
        columnas: [ {campo:"titulo",etiqueta:"Prueba"}, {campo:"etapa",etiqueta:"Etapa"}, {campo:"nivel",etiqueta:"Nivel"}, {campo:"fecha",etiqueta:"Fecha"}, {campo:"sede",etiqueta:"Sede"} ],
        filtros: [ {campo:"etapa",etiqueta:"Etapa",opciones:["","Convocatoria","Prueba Nacional","Ampliación"]}, {campo:"nivel",etiqueta:"Nivel",opciones:null}, {campo:"circuito",etiqueta:"Circuito",opciones:null} ],
        campos: [ F.titulo,
            { clave:"etapa", etiqueta:"Etapa", tipo:"select", requerido:true, opciones:["Convocatoria","Prueba Nacional","Ampliación"] },
            { clave:"nivel", etiqueta:"Nivel / Población", tipo:"text" },
            F.circuito, F.fecha, F.fechaFin, F.hora, F.sede, F.part, F.desc ]
    },
    deportivos: {
        id: "deportivos", etiqueta: "Deportivos",
        titulo: "Juegos Deportivos Estudiantiles",
        descripcion: "Juegos Deportivos Estudiantiles: categorías, etapas y periodos de verificación y ejecución (institucional, circunal, regional, interregional y nacional).",
        icono: "trophy", color: "#EA580C", prefijo: "DEP",
        coleccion: COLECCIONES.actividades,
        columnas: [ {campo:"categoria",etiqueta:"Categoría / Programa"}, {campo:"etapa",etiqueta:"Etapa / Subcategoría"}, {campo:"titulo",etiqueta:"Actividad"}, {campo:"fecha",etiqueta:"Fecha"}, {campo:"fechaFin",etiqueta:"Fecha de fin"} ],
        filtros: [ {campo:"categoria",etiqueta:"Categoría",opciones:null}, {campo:"etapa",etiqueta:"Etapa",opciones:null} ],
        // Desplegables en cascada: Categoría / Programa → Etapa / Subcategoría.
        // El bloque de Actividad y Fechas se despliega solo cuando ambos
        // desplegables tienen una opción válida (camposDeportivos /
        // refrescarCamposDeportivos). Campos retirados: sede, participantes,
        // responsable y observaciones.
        campos: [ F.depCategoria, F.depEtapa, F.titulo, F.fecha, F.fechaFin ]
    },
    ctp_tecnicos: {
        id: "ctp_tecnicos", etiqueta: "CTP y Técnicos",
        titulo: "CTP y Módulos Técnicos y Especiales",
        descripcion: "Programación académica CTP, coordinación técnica, seguimiento NEO y pruebas de Nocturnos, CINDEAs e IPEC: formulario en cascada de tres niveles.",
        icono: "wrench", color: "#DB2777", prefijo: "CTP",
        coleccion: COLECCIONES.actividades,
        // Columnas adaptadas a la estructura en cascada. El campo «titulo» se
        // compone automáticamente al guardar (resumen legible del registro).
        columnas: [ {campo:"opcion",etiqueta:"Opción"}, {campo:"subopcion",etiqueta:"Nivel de pruebas"}, {campo:"actividad",etiqueta:"Actividad"}, {campo:"periodoPruebas",etiqueta:"Periodo de pruebas"}, {campo:"bimensual",etiqueta:"Bimensual"}, {campo:"fecha",etiqueta:"Fecha"} ],
        filtros: [ {campo:"opcion",etiqueta:"Opción",opciones:null}, {campo:"subopcion",etiqueta:"Nivel de pruebas",opciones:null} ],
        // Formulario en cascada: Opción → Nivel de pruebas → campos
        // específicos (renderizados dinámicamente por refrescarCamposCTP).
        campos: [ F_CTP.opcion, F_CTP.subopcion ]
    },
    permanencia: {
        id: "permanencia", etiqueta: "Permanencia",
        titulo: "Permanencia y Mitigación de la Exclusión",
        descripcion: "Estrategias de retención: equipos ERP / EPI, protocolos UPRE y Alerta Temprana.",
        icono: "heart-handshake", color: "#7C3AED", prefijo: "PER",
        coleccion: COLECCIONES.actividades,
        columnas: [ {campo:"fecha",etiqueta:"Fecha de inicio"},{campo:"fechaFin",etiqueta:"Fecha de Finalización"}, {campo:"titulo",etiqueta:"Titulo"} ],
        filtros: [ {campo:"estrategia",etiqueta:"Componente",opciones:["","ERP","EPI","UPRE","Alerta Temprana","Otro"]} ],
        campos: [   F.fecha, F.fechaFin, F.titulo, ]
    },
    oferta_formativa: {
        id: "oferta_formativa", etiqueta: "Oferta Formativa",
        titulo: "Oferta Formativa",
        descripcion: "Capacitaciones, talleres y formación permanente organizados por mes, hora, sede y público participante.",
        icono: "presentation", color: "#0891B2", prefijo: "OF",
        coleccion: COLECCIONES.actividades,
        columnas: [  {campo:"fecha",etiqueta:"Fecha"}, {campo:"titulo",etiqueta:"Actividad"}, {campo:"hora",etiqueta:"Hora"}, {campo:"sede",etiqueta:"Sede"}, {campo:"participantes",etiqueta:"Participantes"} ],
        filtros: [ {campo:"sede",etiqueta:"Sede",opciones:null} ],
        campos: [   F.fecha, F.titulo, F.hora, F.sede, F.part, ]
    },
    programacion_mensual: {
        id: "programacion_mensual", etiqueta: "Programación Mensual",
        titulo: "Programaciones Mensuales",
        descripcion: "Programación detallada mes a mes: fecha, actividad, hora, sede, participantes y compromisos.",
        icono: "calendar-days", color: "#0A192F", prefijo: "PM",
        coleccion: COLECCIONES.actividades,
        columnas: [ {campo:"fecha",etiqueta:"Fecha"}, {campo:"titulo",etiqueta:"Actividad"}, {campo:"hora",etiqueta:"Hora"}, {campo:"sede",etiqueta:"Sede"},{campo:"participantes",etiqueta:"Participantes"}, {campo:"logro",etiqueta:"Nivel de logro"} ],
        filtros: [ {campo:"logro",etiqueta:"Nivel de logro",opciones:null} ],
        campos: [ F.titulo, F.fecha, F.hora, F.sede, F.part, F.logro]
    },
    directorio: {
        id: "directorio", etiqueta: "Directorio",
        titulo: "Directorio Telefónico Institucional",
        descripcion: "Telefonía fija, Asesoría Pedagógica, Supervisiones Escolares y Centros Educativos de la DREC y sus circuitos 01–05.",
        icono: "phone", color: "#64748B", prefijo: "DIR",
        coleccion: COLECCIONES.directorio,
        // Columnas universales (cuando el filtro de categoría está en «Todos»
        // o mezcla categorías). Con categoría seleccionada se usan las
        // columnas específicas de CATEGORIAS_DIRECTORIO.
        columnas: [ {campo:"categoria",etiqueta:"Categoría"}, {campo:"circuito",etiqueta:"Circuito"}, {campo:"departamento",etiqueta:"Departamento / Institución"}, {campo:"oficina",etiqueta:"Oficina"}, {campo:"funcionario",etiqueta:"Funcionario / Director"}, {campo:"telefono",etiqueta:"Teléfono"}, {campo:"extension",etiqueta:"Ext."}, {campo:"movil",etiqueta:"Móvil"}, {campo:"correo",etiqueta:"Correo"} ],
        filtros: [ {campo:"categoria",etiqueta:"Categoría",opciones:["","Telefonía Fija","Asesoría Pedagógica","Supervisiones Escolares","Centros Educativos por Circuitos Escolares","Directorio Telefónico DIRECA","Circuitos"]}, {campo:"circuito",etiqueta:"Circuito",opciones:null} ],
        campos: [
            { clave:"categoria", etiqueta:"Categoría / Tipo de registro", tipo:"select", requerido:true,
              opciones:["Telefonía Fija","Asesoría Pedagógica","Supervisiones Escolares","Centros Educativos por Circuitos Escolares","Directorio Telefónico DIRECA","Circuitos"] },
            { clave:"circuito", etiqueta:"Circuito / Región", tipo:"select", categorias:["Centros Educativos por Circuitos Escolares"], requerido:true,
              opciones:["","Dirección Regional","Circuito 01 (Cañas)","Circuito 02 (Abangares)","Circuito 03 (Tilarán)","Circuito 04 (Colorado)","Circuito 05 (La Altura)"] },
            { clave:"departamento", etiqueta:"Departamento / Oficina", tipo:"text", requerido:true,
              categorias:["Telefonía Fija","Asesoría Pedagógica","Supervisiones Escolares"] },
            { clave:"funcionario", etiqueta:"Nombre de funcionario / directora o director", tipo:"text", requerido:true },
            { clave:"puesto", etiqueta:"Puesto", tipo:"text",
              categorias:["Telefonía Fija","Asesoría Pedagógica","Supervisiones Escolares"] },
            { clave:"telefono", etiqueta:"Teléfono", tipo:"text" },
            { clave:"extension", etiqueta:"Extensión", tipo:"text", categorias:["Telefonía Fija","Directorio Telefónico DIRECA"] },
            { clave:"oficina", etiqueta:"Oficina", tipo:"select", requerido:true,
              categorias:["Directorio Telefónico DIRECA"], opciones: OPCIONES_OFICINAS_DIRECA },
            { clave:"oficinaSupervision", etiqueta:"Oficina de supervisión", tipo:"select", requerido:true,
              categorias:["Circuitos"], opciones: OPCIONES_SUPERVISIONES },
            { clave:"movil", etiqueta:"Móvil / Celular", tipo:"text", categorias:["Centros Educativos por Circuitos Escolares"] },
            { clave:"correo", etiqueta:"Correo(s) electrónico(s)", tipo:"text" },
            { clave:"numero", etiqueta:"Número", tipo:"text", categorias:["Centros Educativos por Circuitos Escolares"] },
            { clave:"codigoPresupuestario", etiqueta:"Código presupuestario", tipo:"text", categorias:["Centros Educativos por Circuitos Escolares"] },
            { clave:"institucion", etiqueta:"Institución / Centro educativo", tipo:"text", requerido:true, categorias:["Centros Educativos por Circuitos Escolares"] },
            { clave:"tipoDireccion", etiqueta:"Tipo de dirección", tipo:"select", categorias:["Centros Educativos por Circuitos Escolares"],
              opciones:["","UNIDOCENTE","Dirección 1","Dirección 2","Dirección 3","Dirección 4","PEU","DEGB1","DEGB2","DEGB4","Director CTP","Director Colegio","Preescolar","Preescolar y Primaria","Preescolar, primaria y secundaria","Otra"] },
            { clave:"notas", etiqueta:"Notas / Observaciones", tipo:"textarea" }
        ]
    }
};

/* ==================== DIRECTORIO: CATEGORÍAS DINÁMICAS ====================
   Cada categoría define qué campos muestra el formulario de alta/edición y
   qué columnas usa la tabla (administrativa y pública). El selector de
   «Categoría / Tipo de registro» re-renderiza el formulario en vivo sin
   perder lo ya escrito. */
const CATEGORIAS_DIRECTORIO = {
    "Telefonía Fija": {
        campos: ["categoria", "departamento", "funcionario", "telefono", "extension", "correo"],
        columnas: [
            {campo:"departamento", etiqueta:"Departamento / Oficina"},
            {campo:"funcionario", etiqueta:"Funcionario"},
            {campo:"puesto", etiqueta:"Puesto"},
            {campo:"telefono", etiqueta:"Teléfono"},
            {campo:"extension", etiqueta:"Ext."},
            {campo:"correo", etiqueta:"Correo"}
        ]
    },
    "Asesoría Pedagógica": {
        campos: ["categoria", "departamento", "funcionario", "telefono", "correo"],
        columnas: [
            {campo:"departamento", etiqueta:"Departamento / Oficina"},
            {campo:"funcionario", etiqueta:"Funcionario"},
            {campo:"puesto", etiqueta:"Puesto"},
            {campo:"telefono", etiqueta:"Teléfono"},
            {campo:"correo", etiqueta:"Correo"}
        ]
    },
    "Supervisiones Escolares": {
        campos: ["categoria", "departamento", "funcionario", "telefono", "correo"],
        columnas: [
            {campo:"departamento", etiqueta:"Departamento / Oficina"},
            {campo:"funcionario", etiqueta:"Funcionario"},
            {campo:"telefono", etiqueta:"Teléfono"},
            {campo:"correo", etiqueta:"Correo"}
        ]
    },
    "Centros Educativos por Circuitos Escolares": {
        campos: ["categoria", "circuito", "institucion", "telefono", "codigoPresupuestario",  "tipoDireccion", "funcionario",  "movil", "correo"],
        columnas: [
            {campo:"circuito", etiqueta:"Circuito"},
            {campo:"codigoPresupuestario", etiqueta:"Cód. Presupuestario"},
            {campo:"institucion", etiqueta:"Institución"},
            {campo:"tipoDireccion", etiqueta:"Tipo de dirección"},
            {campo:"funcionario", etiqueta:"Director(a)"},
            {campo:"telefono", etiqueta:"Teléfono"},
            {campo:"movil", etiqueta:"Móvil"},
            {campo:"correo", etiqueta:"Correo"}
        ]
    },
    // ==================== DIRECTORIO TELEFÓNICO DIRECA ====================
    // Campos: «Oficina» (desplegable con autocompletado de la extensión y
    // opción de oficina manual) y «# de Extensión» (editable a mano).
    "Directorio Telefónico DIRECA": {
        campos: ["categoria", "oficina", "extension", "funcionario", "correo", "notas"],
        columnas: [
            {campo:"oficina", etiqueta:"Oficina"},
            {campo:"extension", etiqueta:"# de Extensión"},
            {campo:"funcionario", etiqueta:"Funcionario"},
            {campo:"correo", etiqueta:"Correo"}
        ]
    },
    // ==================== CIRCUITOS (OFICINAS DE SUPERVISIÓN) ====================
    // Campos: «Oficina de supervisión» (autocompleta el teléfono), «Teléfono»,
    // «Supervisor» y «Correo electrónico».
    "Circuitos": {
        campos: ["categoria", "oficinaSupervision", "telefono", "funcionario", "correo", "notas"],
        columnas: [
            {campo:"oficinaSupervision", etiqueta:"Oficina de supervisión"},
            {campo:"telefono", etiqueta:"Teléfono"},
            {campo:"funcionario", etiqueta:"Supervisor"},
            {campo:"correo", etiqueta:"Correo electrónico"}
        ]
    }
};

// Definiciones de campo del directorio por clave (referencia al catálogo).
function campoDirectorio(clave) {
    return MODULOS.directorio.campos.find(c => c.clave === clave) || null;
}

// Campos (definiciones completas) que el formulario muestra para una categoría.
// En «Centros Educativos» el campo «funcionario» se etiqueta como Director(a).
function camposDeCategoria(categoria) {
    const def = CATEGORIAS_DIRECTORIO[categoria];
    const claves = def ? def.campos : MODULOS.directorio.campos.map(c => c.clave);
    return claves.map(clave => {
        const c = Object.assign({}, campoDirectorio(clave));
        if (categoria === "Centros Educativos por Circuitos Escolares" && clave === "funcionario") c.etiqueta = "Nombre del director / de la directora";
        if (categoria === "Circuitos" && clave === "funcionario") c.etiqueta = "Supervisor";
        if (categoria === "Circuitos" && clave === "correo") c.etiqueta = "Correo electrónico";
        if (categoria === "Directorio Telefónico DIRECA" && clave === "extension") c.etiqueta = "# de Extensión";
        return c;
    }).filter(Boolean);
}

// Columnas de la tabla del directorio para la categoría seleccionada
// (o las universales si el filtro está en «Todos»).
function columnasDirectorio(categoria) {
    const def = categoria && CATEGORIAS_DIRECTORIO[categoria];
    return def ? def.columnas.slice() : MODULOS.directorio.columnas.slice();
}

// Re-render en vivo de los campos del formulario al cambiar la categoría,
// conservando lo que ya se escribió en los campos visibles.
function refrescarCamposDirectorio() {
    const cont = $("ef-campos-dinamicos");
    const selCat = $("ef-categoria");
    if (!cont || !selCat) return;
    // 1) Conservar los valores ya digitados.
    const valores = {};
    cont.querySelectorAll("select[id^='ef-'], input[id^='ef-'], textarea[id^='ef-']").forEach(el => { valores[el.id.slice(3)] = el.value; });
    // 2) Re-render con los campos de la nueva categoría.
    const categoria = selCat.value;
    cont.innerHTML = camposDeCategoria(categoria)
        .filter(c => c.clave !== "categoria")
        .map(c => campoInput(c, valores[c.clave] != null ? valores[c.clave] : ""))
        .join("");
    activarAutocompletadoDirectorio(categoria);
    crearIconos();
}

/* ==================== CELEBRATIVOS: CAMPOS DINÁMICOS «¿SERÁ DÍA O SEMANA?» ====================
   · Día   → Fecha, Título (+ Circuito, Observaciones).
   · Semana → Fecha de inicio, Fecha de finalización, Título (+ Circuito, Observaciones).
   La elección re-renderiza el formulario en vivo conservando lo ya digitado. */
function camposCelebrativos(tipo) {
    const base = String(tipo || "") === "Semana"
        ? [F.fecha, F.fechaFin, F.titulo]
        : [F.fecha, F.titulo];
    return base.concat([F.circuito, F.desc]);
}
function refrescarCamposCelebrativos() {
    const cont = $("ef-campos-dinamicos");
    const selTipo = $("ef-tipo");
    if (!cont || !selTipo) return;
    // 1) Conservar los valores ya digitados.
    const valores = {};
    cont.querySelectorAll("select[id^='ef-'], input[id^='ef-'], textarea[id^='ef-']").forEach(el => { valores[el.id.slice(3)] = el.value; });
    // 2) Re-render con los campos del tipo elegido.
    cont.innerHTML = camposCelebrativos(selTipo.value)
        .map(c => campoInput(c, valores[c.clave] != null ? valores[c.clave] : ""))
        .join("");
    crearIconos();
}

/* ==================== DEPORTIVOS: DESPLEGABLES EN CASCADA ====================
   · Categoría / Programa → habilita el desplegable de Etapa / Subcategoría.
   · Etapa / Subcategoría → despliega el bloque de detalle: Actividad y fechas.
   · Fechas: por defecto «Un solo día»; el modo «Rango de fechas» muestra
     Fecha de inicio y Fecha de fin (validadas: fin ≥ inicio).
   Retrocompatible: los registros previos (con «fase» textual) se precargan
   mapeando su fase histórica a la categoría/etapa equivalentes. */
const DEP_FASE_HISTORICA = {
    "Inscripción":     ["Juegos Deportivos Estudiantiles", "Inscripciones y ejecución Institucional"],
    "Institucional":   ["Juegos Deportivos Estudiantiles", "Inscripciones y ejecución Institucional"],
    "Circuitos":       ["Juegos Deportivos Estudiantiles", "Verificaciones Circuitales"],
    "Regional":        ["Juegos Deportivos Estudiantiles Regional", "Periodos Verificaciones Regionales"],
    "Interregional":   ["Juegos Deportivos Estudiantiles Regional", "Periodos Verificaciones Interregionales"],
    "Nacional":        ["Juegos Deportivos Estudiantiles", "Periodos Verificaciones Nacionales"]
};

// Campos de detalle visibles SOLO cuando categoría y etapa están elegidas.
function camposDeportivos(categoria, etapa) {
    if (!categoria || !etapa || (DEP_ETAPAS[categoria] || []).indexOf(etapa) === -1) return [];
    return [F.titulo, F.fecha, F.fechaFin];
}

// Re-render en vivo del desplegable de etapa y del bloque de detalle,
// conservando lo ya digitado (patrón idéntico al de celebrativos/directorio).
function refrescarCamposDeportivos() {
    const cont = $("ef-campos-dinamicos");
    const selCat = $("ef-categoria");
    const selEta = $("ef-etapa");
    if (!cont || !selCat || !selEta) return;
    // 1) Poblar el desplegable de etapa según la categoría elegida.
    const categoria = selCat.value;
    const opciones = (DEP_ETAPAS[categoria] || []).slice();
    if (!opciones.length) {
        selEta.innerHTML = '<option value="">Seleccione primero una categoría...</option>';
        selEta.disabled = true;
    } else {
        // Conservar la etapa ya elegida si sigue siendo válida.
        const previa = selEta.value;
        selEta.disabled = false;
        selEta.innerHTML = '<option value="">— Seleccione la etapa / subcategoría —</option>' +
            opciones.map(o => '<option value="' + esc(o) + '"' + (previa === o ? " selected" : "") + ">" + esc(o) + "</option>").join("");
        if (opciones.indexOf(previa) === -1) selEta.value = "";
    }
    const etapa = selEta.value;
    // 2) Bloque de detalle: visible solo con categoría y etapa válidas.
    const activos = camposDeportivos(categoria, etapa);
    if (!activos.length) {
        cont.innerHTML = '<div class="bg-blue-50 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-900 font-medium">Seleccione la categoría y la etapa / subcategoría para desplegar la Actividad y las fechas.</div>';
        return;
    }
    // 3) Conservar los valores ya digitados antes de re-renderizar.
    const valores = {};
    cont.querySelectorAll("input[id^='ef-']").forEach(el => { valores[el.id.slice(3)] = el.value; });
    const modoPrevio = document.querySelector("input[name='depModo']:checked");
    const modoRango = modoPrevio ? modoPrevio.value === "rango" : (valores.fechaFin ? true : false);
    cont.innerHTML =
        campoInput(F.titulo, valores.titulo != null ? valores.titulo : "") +
        '<div class="bg-slate-50 border border-slate-200 rounded-xl p-3">' +
            '<p class="text-xs font-bold text-slate-700 uppercase mb-2">Modalidad de fecha</p>' +
            '<div class="flex flex-wrap gap-4 text-xs font-bold text-slate-700">' +
                '<label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="depModo" value="dia"' + (!modoRango ? " checked" : "") + ' onchange="refrescarModoFechaDeportivos()"> Un solo día</label>' +
                '<label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="depModo" value="rango"' + (modoRango ? " checked" : "") + ' onchange="refrescarModoFechaDeportivos()"> Rango de fechas</label>' +
            "</div>" +
        "</div>" +
        '<div id="depCampoFecha">' + campoInput(F.fecha, valores.fecha != null ? valores.fecha : (editorPrefillFecha || "")) + "</div>" +
        '<div id="depCampoFechaFin"' + (modoRango ? "" : ' class="hidden"') + ">" + campoInput(F.fechaFin, valores.fechaFin != null ? valores.fechaFin : "") + "</div>";
    crearIconos();
}

// Alterna «Un solo día» ↔ «Rango de fechas» sin perder lo digitado.
function refrescarModoFechaDeportivos() {
    const modo = (document.querySelector("input[name='depModo']:checked") || {}).value || "dia";
    const fIni = $("depCampoFecha"), fFin = $("depCampoFechaFin");
    if (!fIni || !fFin) return;
    if (modo === "rango") {
        fFin.classList.remove("hidden");
        // Al pasar a rango, la fecha de fin parte de la fecha ya digitada.
        const ini = $("ef-fecha"), fin = $("ef-fechaFin");
        if (fin && !fin.value && ini) fin.value = ini.value;
    } else {
        fFin.classList.add("hidden");
    }
}

/* ==================== CTP Y TÉCNICOS: CASCADA DE 3 NIVELES ====================
   · Nivel 1 «Opción» → habilita el desplegable de «Nivel de pruebas».
   · Nivel 2 → despliega el bloque de campos específicos:
       – Pruebas 7°–11° / Duodécimo: Actividades (desplegable) + Fecha.
       – NEO: Bimensual + Entrega de Docentes a Dirección + Entrega Dirección
         en Plataforma.
       – IPEC-CINDEAs / Nocturnos: Sub-opción → Periodo de pruebas + Fecha.
   Re-render en vivo conservando lo ya digitado (patrón de deportivos). */
function refrescarCamposCTP() {
    const cont = $("ef-campos-dinamicos");
    const selOp = $("ef-opcion");
    const selSub = $("ef-subopcion");
    if (!cont || !selOp || !selSub) return;
    // 1) Poblar el desplegable de segundo nivel según la opción elegida.
    const opciones = (CTP_SEGUNDO_NIVEL[selOp.value] || []).slice();
    if (!opciones.length) {
        selSub.innerHTML = '<option value="">Seleccione primero una opción...</option>';
        selSub.disabled = true;
    } else {
        const previa = selSub.value;
        selSub.disabled = false;
        selSub.innerHTML = '<option value="">— Seleccione el nivel de pruebas —</option>' +
            opciones.map(o => '<option value="' + esc(o) + '"' + (previa === o ? " selected" : "") + ">" + esc(o) + "</option>").join("");
        if (opciones.indexOf(previa) === -1) selSub.value = "";
    }
    // 2) Bloque de campos específicos según el nivel de pruebas.
    const activos = camposCTP(selSub.value);
    if (!activos.length) {
        cont.innerHTML = '<div class="bg-blue-50 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-900 font-medium">Seleccione la Opción y el Nivel de pruebas para desplegar los campos específicos.</div>';
        return;
    }
    // 3) Conservar los valores ya digitados (solo claves del bloque actual).
    const valores = {};
    cont.querySelectorAll("select[id^='ef-'], input[id^='ef-']").forEach(el => { valores[el.id.slice(3)] = el.value; });
    const selN3Previo = valores.nivel3 || "";
    cont.innerHTML = activos.map(c => {
        let def = Object.assign({}, c);
        // El desplegable de «Periodo de pruebas» depende de la sub-opción.
        if (c.clave === "periodoPruebas") def.opciones = opcionesPeriodoCTP(selN3Previo);
        let valor = valores[c.clave] != null ? valores[c.clave] : "";
        if (c.clave === "fecha" && !valor && editorPrefillFecha) valor = editorPrefillFecha;
        return campoInput(def, valor);
    }).join("");
    // 4) La sub-opción (nivel 3) re-renderiza el bloque para actualizar los
    //    periodos de prueba disponibles, conservando lo ya digitado.
    const selN3 = $("ef-nivel3");
    if (selN3) selN3.addEventListener("change", refrescarCamposCTP);
    crearIconos();
}

/* ==================== AUTOCOMPLETADO DIRECTORIO DIRECA / CIRCUITOS ====================
   · Oficina (DIRECA): al elegirla en el desplegable se autocompleta su «# de
     Extensión». La extensión SIEMPRE queda editable a mano (correcciones).
   · Oficina manual: la opción «Otra oficina (escribir manualmente)» despliega
     un campo de texto libre para digitar una oficina no listada.
   · Oficina de supervisión (Circuitos): al elegirla se autocompleta su
     «Teléfono», que permanece editable a mano. */
function activarAutocompletadoDirectorio(categoria) {
    const selOf = $("ef-oficina");
    if (selOf && categoria === "Directorio Telefónico DIRECA") {
        selOf.addEventListener("change", () => {
            const ext = $("ef-extension");
            if (selOf.value === "__OTRA__") {
                mostrarOficinaManual(true);
                if (ext) ext.value = "";
            } else {
                mostrarOficinaManual(false);
                const auto = extensionDeOficina(selOf.value);
                if (ext && auto) ext.value = auto; // editable manualmente tras el autocompletado
            }
        });
        if (selOf.value === "__OTRA__") mostrarOficinaManual(true, true);
    }
    const selSup = $("ef-oficinaSupervision");
    if (selSup && categoria === "Circuitos") {
        selSup.addEventListener("change", () => {
            const tel = $("ef-telefono");
            const auto = telefonoDeSupervision(selSup.value);
            if (tel && auto) tel.value = auto; // editable manualmente tras el autocompletado
        });
    }
}

// Campo de texto libre para registrar una oficina fuera de la lista DIRECA.
function mostrarOficinaManual(mostrar, conservarValor) {
    const wrap = $("ef-oficinaManualWrap");
    if (!mostrar) {
        if (wrap) wrap.classList.add("hidden");
        return;
    }
    if (!wrap) {
        const sel = $("ef-oficina");
        if (!sel) return;
        const nuevo = document.createElement("div");
        nuevo.id = "ef-oficinaManualWrap";
        nuevo.innerHTML = '<label class="block text-xs font-bold text-slate-700 uppercase mb-1">Nombre de la oficina (manual) *</label>' +
            '<input type="text" id="ef-oficinaManual" maxlength="300" placeholder="Escriba el nombre de la oficina" ' +
            'class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-mep-blue focus:bg-white outline-none">';
        sel.closest("div").after(nuevo);
    } else {
        wrap.classList.remove("hidden");
        if (!conservarValor) { const inp = wrap.querySelector("input"); if (inp) inp.value = ""; }
    }
}

const EDITOR_USUARIOS = {
    id: "usuarios", titulo: "Usuario administrador",
    campos: [
        { clave:"nombre", etiqueta:"Nombre completo", tipo:"text", requerido:true },
        { clave:"email", etiqueta:"Correo institucional", tipo:"email", requerido:true }
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

/* ==================== DIÁLOGO DE CONFIRMACIÓN PERSONALIZADO ====================
   Sustituye a window.confirm(): tarjeta institucional con desenfoque de fondo,
   ícono de advertencia, resumen de lo que se va a borrar y botones explícitos.
   mostrarConfirmacion(opts) devuelve una Promesa<boolean>.
   opts: { variante: "danger"|"warning"|"info", titulo, mensaje, items:[{etiqueta,valor}],
           lista:[texto], escribir:"PALABRA", textoCancelar, textoAceptar, iconoAceptar } */
let _confirmResolver = null;
let _confirmFocoPrevio = null;

function confirmacionAbierta() {
    const o = $("modalConfirmacion");
    return !!o && !o.classList.contains("hidden");
}

function mostrarConfirmacion(opts) {
    opts = opts || {};
    return new Promise(resolve => {
        const overlay = $("modalConfirmacion");
        if (!overlay) { // Respaldo defensivo si el marcado no existiera
            resolve(window.confirm((opts.titulo || "") + (opts.mensaje ? "\n\n" + opts.mensaje : "")));
            return;
        }
        if (_confirmResolver) { const previo = _confirmResolver; _confirmResolver = null; previo(false); }
        const variante = opts.variante || "danger";
        const card = $("confirmCard");
        card.setAttribute("data-variante", variante);
        $("confirmIcono").innerHTML = '<i data-lucide="' + (variante === "info" ? "info" : "triangle-alert") + '"></i>';
        $("confirmTitulo").textContent = opts.titulo || "¿Desea continuar?";
        $("confirmMensaje").textContent = opts.mensaje || "";
        $("confirmMensaje").classList.toggle("hidden", !opts.mensaje);

        // Resumen: pares etiqueta/valor + vista previa de los elementos afectados.
        let resumen = "";
        if (opts.items && opts.items.length) {
            resumen += '<dl class="confirm-dl">' + opts.items.map(i =>
                "<div><dt>" + esc(i.etiqueta) + "</dt><dd>" + esc(i.valor) + "</dd></div>").join("") + "</dl>";
        }
        if (opts.lista && opts.lista.length) {
            const MAX = 5;
            resumen += '<ul class="confirm-lista">' + opts.lista.slice(0, MAX).map(t => "<li>" + esc(t) + "</li>").join("") +
                (opts.lista.length > MAX ? '<li class="confirm-mas">y ' + (opts.lista.length - MAX) + " más…</li>" : "") + "</ul>";
        }
        const cajaResumen = $("confirmResumen");
        cajaResumen.innerHTML = resumen;
        cajaResumen.classList.toggle("hidden", !resumen);

        // Confirmación estricta opcional: escribir una palabra para habilitar el botón.
        const wrap = $("confirmEscribirWrap");
        const inp = $("confirmEscribir");
        inp.value = "";
        wrap.classList.toggle("hidden", !opts.escribir);
        $("confirmPalabra").textContent = opts.escribir || "";
        inp.setAttribute("data-palabra", opts.escribir || "");

        const btnCancelar = $("confirmCancelar");
        const btnAceptar = $("confirmAceptar");
        btnCancelar.textContent = opts.textoCancelar || "Cancelar";
        btnAceptar.className = (variante === "danger" ? "btn-mep-danger" : "btn-mep-primary") + " px-5 py-2.5 rounded-2xl font-bold text-xs flex items-center gap-2";
        btnAceptar.innerHTML = '<i data-lucide="' + esc(opts.iconoAceptar || "check") + '" class="w-4 h-4"></i><span></span>';
        btnAceptar.querySelector("span").textContent = opts.textoAceptar || "Aceptar";
        btnAceptar.disabled = !!opts.escribir;

        _confirmFocoPrevio = document.activeElement;
        _confirmResolver = resolve;
        overlay.classList.remove("hidden");
        crearIconos();
        // Foco seguro: en «Cancelar» (o en el campo de confirmación estricta).
        setTimeout(() => { try { (opts.escribir ? inp : btnCancelar).focus(); } catch (e) {} }, 30);
    });
}

function resolverConfirmacion(valor) {
    const overlay = $("modalConfirmacion");
    if (overlay) overlay.classList.add("hidden");
    const r = _confirmResolver;
    _confirmResolver = null;
    const foco = _confirmFocoPrevio;
    _confirmFocoPrevio = null;
    if (foco && foco.focus) { try { foco.focus(); } catch (e) {} }
    if (r) r(!!valor);
}

function atraparFocoConfirmacion(e) {
    const o = $("modalConfirmacion");
    if (!o) return;
    const f = Array.prototype.slice.call(o.querySelectorAll("button:not([disabled]), input:not([disabled])"))
        .filter(el => el.offsetParent !== null);
    if (!f.length) return;
    const primero = f[0], ultimo = f[f.length - 1];
    if (!o.contains(document.activeElement)) { e.preventDefault(); primero.focus(); }
    else if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
}

function inicializarConfirmacion() {
    const overlay = $("modalConfirmacion");
    if (!overlay) return;
    $("confirmCancelar").addEventListener("click", () => resolverConfirmacion(false));
    $("confirmAceptar").addEventListener("click", () => resolverConfirmacion(true));
    $("confirmEscribir").addEventListener("input", e => {
        const palabra = e.target.getAttribute("data-palabra") || "";
        $("confirmAceptar").disabled = !!palabra && e.target.value.trim().toUpperCase() !== palabra.toUpperCase();
    });
    $("confirmEscribir").addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); const b = $("confirmAceptar"); if (!b.disabled) resolverConfirmacion(true); }
    });
    // Clic en el fondo = cancelar (solo si el clic empezó también en el fondo).
    let downEnFondo = false;
    overlay.addEventListener("mousedown", e => { downEnFondo = (e.target === overlay); });
    overlay.addEventListener("click", e => { if (e.target === overlay && downEnFondo) resolverConfirmacion(false); downEnFondo = false; });
}

/* ==================== MODALES: APERTURA, CIERRE Y PROTECCIÓN CONTRA PÉRDIDA DE DATOS ====================
   Los 4 formularios de ingreso/edición guardan una «instantánea» de sus campos
   al abrirse. Si al intentar cerrarlos (X, Cancelar, clic fuera, Escape) o al
   salir de la pestaña la instantánea difiere, el formulario está «sucio» y se
   pide confirmación antes de descartar. cerrarModal() cierra SIEMPRE (se usa
   tras guardar con éxito); solicitarCierreModal() es el cierre iniciado por el
   usuario y pasa por la protección. */
const MODALES_PROTEGIDOS = {
    modalEditor:  { nombre: function () { const t = $("editorTitulo"); return (t && t.textContent.trim()) || "Formulario de registro"; } },
    modalUsuario: { nombre: function () { return "Registro de nuevo usuario"; } },
    modalPortada: { nombre: function () { return "Metadatos de la Programación Anual"; } },
    modalMarco:   { nombre: function () { return "Marco filosófico institucional"; } }
};
let _baselineModales = {};

function modalVisible(id) {
    const m = $(id);
    return !!m && !m.classList.contains("hidden");
}

// Instantánea del estado de todos los campos del modal (incluye las etiquetas de participantes).
function instantaneaFormulario(modalId) {
    const m = $(modalId);
    if (!m) return "";
    const partes = [];
    m.querySelectorAll("input, select, textarea").forEach((el, i) => {
        if (el.hasAttribute("data-sin-estado")) return;
        if (el.type === "button" || el.type === "submit" || el.type === "reset") return;
        const v = (el.type === "checkbox" || el.type === "radio") ? (el.checked ? "1" : "0") : String(el.value);
        partes.push((el.id || el.name || ("#" + i)) + "=" + v);
    });
    return partes.join("\u241E");
}

function esFormularioSucio(modalId) {
    if (!(modalId in _baselineModales)) return false;
    return instantaneaFormulario(modalId) !== _baselineModales[modalId];
}

function hayFormularioSucio() {
    return Object.keys(MODALES_PROTEGIDOS).some(id => modalVisible(id) && esFormularioSucio(id));
}

// Insignia «Cambios sin guardar» en la cabecera del modal (feedback visual).
function actualizarIndicadorSucio(id) {
    const m = $(id);
    if (!m) return;
    const cab = m.querySelector(".modal-cabecera");
    if (!cab) return;
    let b = cab.querySelector(".badge-sucio");
    if (!b) {
        b = document.createElement("span");
        b.className = "badge-sucio";
        b.setAttribute("role", "status");
        b.innerHTML = '<span class="badge-sucio-punto"></span>Cambios sin guardar';
        cab.insertBefore(b, cab.querySelector(".modal-cerrar") || null);
    }
    b.classList.toggle("visible", modalVisible(id) && esFormularioSucio(id));
}

function abrirModal(id) {
    const m = $(id);
    if (m) { m.classList.remove("hidden"); crearIconos(); }
    if (m && MODALES_PROTEGIDOS[id]) {
        _baselineModales[id] = instantaneaFormulario(id);
        actualizarIndicadorSucio(id);
    }
}

// Cierre incondicional (tras guardar con éxito o tras descartar). En los
// formularios protegidos limpia por completo los datos temporales.
function cerrarModal(id) {
    const m = $(id);
    if (!m) return;
    m.classList.add("hidden");
    if (MODALES_PROTEGIDOS[id]) {
        delete _baselineModales[id];
        limpiarModalProtegido(id);
        actualizarIndicadorSucio(id);
    }
}

function limpiarModalProtegido(id) {
    if (id === "modalEditor") {
        const f = $("editorForm");
        if (f) f.innerHTML = "";
    } else if (id === "modalUsuario") {
        ["nuNombre", "nuEmail", "nuPassword"].forEach(k => { const el = $(k); if (el) el.value = ""; });
        const p = $("nuPassword"); if (p) p.type = "password";
        ocultarErrorUsuario();
    } else if (id === "modalPortada") {
        const f = document.querySelector("#modalPortada form"); if (f) f.reset();
    } else if (id === "modalMarco") {
        ["mfMision", "mfVision"].forEach(k => { const el = $(k); if (el) el.value = ""; });
        const v = $("mfValores"); if (v) v.innerHTML = "";
    }
}

// Cierre iniciado por el usuario: si hay datos sin guardar pide confirmación.
async function solicitarCierreModal(id) {
    if (confirmacionAbierta()) return false;
    if (MODALES_PROTEGIDOS[id] && modalVisible(id) && esFormularioSucio(id)) {
        const descartar = await mostrarConfirmacion({
            variante: "warning",
            titulo: "Tiene cambios sin guardar",
            mensaje: "Escribió o modificó información que todavía no se ha guardado. Si sale ahora, todo lo ingresado se descartará por completo.",
            items: [{ etiqueta: "Formulario", valor: MODALES_PROTEGIDOS[id].nombre() }],
            textoCancelar: "Continuar editando",
            textoAceptar: "Descartar y salir",
            iconoAceptar: "log-out"
        });
        if (!descartar) return false;
    }
    cerrarModal(id);
    return true;
}

function inicializarProteccionFormularios() {
    Object.keys(MODALES_PROTEGIDOS).forEach(id => {
        const m = $(id);
        if (!m) return;
        let downEnFondo = false;
        m.addEventListener("mousedown", e => { downEnFondo = (e.target === m); });
        m.addEventListener("touchstart", e => { downEnFondo = (e.target === m); }, { passive: true });
        m.addEventListener("click", e => {
            if (e.target === m && downEnFondo) solicitarCierreModal(id);
            downEnFondo = false;
        });
        m.addEventListener("input", () => actualizarIndicadorSucio(id));
        m.addEventListener("change", () => actualizarIndicadorSucio(id));
    });
    // Modal de detalle (solo lectura): se cierra con clic fuera.
    const det = $("modalDetalle");
    if (det) {
        let downDet = false;
        det.addEventListener("mousedown", e => { downDet = (e.target === det); });
        det.addEventListener("click", e => { if (e.target === det && downDet) cerrarModal("modalDetalle"); downDet = false; });
    }
    // Evita cerrar o recargar la pestaña del navegador con datos sin guardar.
    window.addEventListener("beforeunload", e => {
        if (hayFormularioSucio()) { e.preventDefault(); e.returnValue = ""; return ""; }
    });
}

function manejarTeclaGlobal(e) {
    if (e.key === "Tab" && confirmacionAbierta()) { atraparFocoConfirmacion(e); return; }
    if (e.key !== "Escape") return;
    if (confirmacionAbierta()) { e.preventDefault(); resolverConfirmacion(false); return; }
    const abiertos = Object.keys(MODALES_PROTEGIDOS).filter(modalVisible);
    if (abiertos.length) { e.preventDefault(); solicitarCierreModal(abiertos[abiertos.length - 1]); return; }
    if (modalVisible("modalDetalle")) { cerrarModal("modalDetalle"); return; }
    document.body.classList.remove("sidebar-open");
}

/* ==================== PARTICIPANTES: COMPONENTE DE ETIQUETAS (CHIPS) ====================
   Reemplaza el campo de texto de «Participantes». Cada participante es una
   etiqueta con botón × (quitar), edición con doble clic y reordenamiento
   (arrastrar, botones ‹ › o Alt+←/→). El valor se guarda serializado como
   «A, B, C» en un <input hidden id="ef-participantes">, de modo que Firestore,
   LocalStorage, las tablas, el detalle y Excel siguen funcionando igual.
   Los registros antiguos (texto separado por comas, «;», saltos de línea o « · »)
   se convierten automáticamente en etiquetas al abrirse para editar. */
const SEPARADOR_PARTICIPANTES = ", ";
const MAX_PARTICIPANTES = 60;
const MAX_LARGO_PARTICIPANTE = 120;
const SVG_LAPIZ = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

// Texto (con cualquier separador histórico) → lista limpia, sin vacíos ni duplicados.
function parsearParticipantes(valor) {
    if (valor == null) return [];
    const texto = Array.isArray(valor) ? valor.join("\n") : String(valor);
    const vistos = {};
    const lista = [];
    texto.split(/[,;\n\r]+|\s[·•]\s/).forEach(p => {
        let t = p.replace(/\s+/g, " ").trim();
        if (!t) return;
        if (t.length > MAX_LARGO_PARTICIPANTE) t = t.slice(0, MAX_LARGO_PARTICIPANTE).trim();
        const k = normalize(t);
        if (!k || vistos[k]) return;
        vistos[k] = true;
        lista.push(t);
    });
    return lista;
}
function serializarParticipantes(lista) {
    return (lista || []).join(SEPARADOR_PARTICIPANTES);
}
function textoContadorParticipantes(n) {
    return n === 0 ? "Sin participantes" : n === 1 ? "1 participante" : n + " participantes";
}
// Etiquetas compactas de solo lectura (tablas y detalle).
function participantesHTML(valor) {
    const l = parsearParticipantes(valor);
    if (!l.length) return "—";
    return '<span class="chips-mini">' + l.map(p => '<span class="chip-mini">' + esc(p) + "</span>").join("") + "</span>";
}

function chipsHTML(items) {
    return items.map((p, i) =>
        '<span class="chip-part" role="listitem" tabindex="0" draggable="true" data-i="' + i + '" title="Doble clic para editar · Alt+←/→ para mover · Supr para quitar">' +
            '<button type="button" class="chip-mov" data-act="izq" tabindex="-1" aria-label="Mover «' + esc(p) + '» a la izquierda"' + (i === 0 ? " disabled" : "") + '>‹</button>' +
            '<span class="chip-txt">' + esc(p) + "</span>" +
            '<button type="button" class="chip-mov" data-act="der" tabindex="-1" aria-label="Mover «' + esc(p) + '» a la derecha"' + (i === items.length - 1 ? " disabled" : "") + '>›</button>' +
            '<button type="button" class="chip-ed" data-act="editar" tabindex="-1" aria-label="Editar «' + esc(p) + '»" title="Editar">' + SVG_LAPIZ + "</button>" +
            '<button type="button" class="chip-x" data-act="quitar" aria-label="Quitar «' + esc(p) + '»" title="Quitar">×</button>' +
        "</span>").join("");
}

// Marcado completo del campo (se usa desde campoInput al construir el editor).
function campoParticipantes(c, valor) {
    const items = parsearParticipantes(valor);
    const id = "ef-" + esc(c.clave);
    return '<div class="chips-campo" data-chips-root>' +
        '<label class="block text-xs font-bold text-slate-700 uppercase mb-1" for="' + id + '-nuevo">' + esc(c.etiqueta) + (c.requerido ? " *" : "") + "</label>" +
        '<div class="chips-caja" data-chips-caja>' +
            '<div class="chips-lista" data-chips-lista role="list" aria-label="Participantes agregados">' + chipsHTML(items) + "</div>" +
            '<input type="text" id="' + id + '-nuevo" data-chips-draft class="chips-input" maxlength="' + MAX_LARGO_PARTICIPANTE + '" autocomplete="off" placeholder="Escriba un participante, grupo o dependencia…">' +
        "</div>" +
        '<div class="chips-barra">' +
            '<button type="button" class="btn-suave chips-agregar" data-chips-add>+ Agregar</button>' +
            '<span class="chips-contador" data-chips-contador aria-live="polite">' + textoContadorParticipantes(items.length) + "</span>" +
            '<button type="button" class="chips-limpiar" data-chips-clear' + (items.length ? "" : " hidden") + ">Quitar todos</button>" +
        "</div>" +
        '<p class="chips-ayuda">Presione Enter o coma para agregar. Arrastre las etiquetas (o use ‹ ›) para reordenarlas; doble clic para editarlas.</p>' +
        '<input type="hidden" id="' + id + '" value="' + esc(serializarParticipantes(items)) + '">' +
    "</div>";
}

function chipsLeer(root) {
    const h = root.querySelector('input[type="hidden"]');
    return parsearParticipantes(h ? h.value : "");
}
function chipsEscribir(root, items) {
    const h = root.querySelector('input[type="hidden"]');
    if (h) {
        h.value = serializarParticipantes(items);
        h.dispatchEvent(new Event("input", { bubbles: true })); // actualiza el indicador de cambios
    }
    root.querySelector("[data-chips-lista]").innerHTML = chipsHTML(items);
    root.querySelector("[data-chips-contador]").textContent = textoContadorParticipantes(items.length);
    const limpiar = root.querySelector("[data-chips-clear]");
    if (limpiar) limpiar.hidden = items.length === 0;
}
function chipsEnfocarBorrador(root) {
    const d = root.querySelector("[data-chips-draft]");
    if (d) { try { d.focus(); } catch (e) {} }
}

// Convierte el texto dado en etiquetas (admite varias separadas por coma/línea).
function chipsAgregarTexto(root, texto) {
    const nuevos = parsearParticipantes(texto);
    if (!nuevos.length) return 0;
    const items = chipsLeer(root);
    let agregados = 0, repetidos = [];
    nuevos.forEach(n => {
        if (items.some(x => normalize(x) === normalize(n))) repetidos.push(n);
        else if (items.length < MAX_PARTICIPANTES) { items.push(n); agregados++; }
    });
    chipsEscribir(root, items);
    if (!agregados && repetidos.length) showToast("«" + repetidos[0] + "» ya está en la lista de participantes.", "warning");
    else if (items.length >= MAX_PARTICIPANTES && agregados < nuevos.length - repetidos.length) showToast("Se alcanzó el máximo de " + MAX_PARTICIPANTES + " participantes.", "warning");
    return agregados;
}
function chipsAgregarDesdeBorrador(root) {
    const d = root.querySelector("[data-chips-draft]");
    if (!d) return;
    chipsAgregarTexto(root, d.value);
    d.value = "";
}

function chipsMover(root, desde, hasta) {
    const items = chipsLeer(root);
    if (hasta < 0 || hasta >= items.length || desde === hasta) return;
    items.splice(hasta, 0, items.splice(desde, 1)[0]);
    chipsEscribir(root, items);
}

function chipsEditar(root, i) {
    chipsTerminarEdicion(root, true);
    const chip = root.querySelector('.chip-part[data-i="' + i + '"]');
    if (!chip) return;
    const items = chipsLeer(root);
    root.dataset.editando = String(i);
    chip.classList.add("chip-editando");
    chip.draggable = false;
    chip.innerHTML = '<input type="text" class="chip-edit-input" data-sin-estado maxlength="' + MAX_LARGO_PARTICIPANTE + '" value="' + esc(items[i]) + '" aria-label="Editar participante">';
    const inp = chip.querySelector("input");
    inp.focus();
    inp.select();
}
function chipsTerminarEdicion(root, guardar) {
    if (root.dataset.editando === undefined) return;
    const i = Number(root.dataset.editando);
    const inp = root.querySelector(".chip-edit-input");
    const texto = inp ? inp.value : "";
    delete root.dataset.editando;
    const items = chipsLeer(root);
    if (guardar && i >= 0 && i < items.length) {
        const nuevos = parsearParticipantes(texto);
        if (!nuevos.length) items.splice(i, 1); // vacío = quitar
        else {
            const resto = items.filter((_, k) => k !== i);
            const unicos = nuevos.filter(n => !resto.some(x => normalize(x) === normalize(n)));
            if (unicos.length) items.splice.apply(items, [i, 1].concat(unicos));
            else showToast("«" + nuevos[0] + "» ya está en la lista de participantes.", "warning");
        }
    }
    chipsEscribir(root, items);
}

// Antes de guardar: convierte el texto pendiente en etiquetas.
function consolidarChipsPendientes() {
    const form = $("editorForm");
    if (!form) return;
    form.querySelectorAll("[data-chips-root]").forEach(root => {
        chipsTerminarEdicion(root, true);
        chipsAgregarDesdeBorrador(root);
    });
}

function inicializarChipsParticipantes() {
    const form = $("editorForm");
    if (!form) return;
    let arrastre = null; // { root, desde }

    form.addEventListener("click", async e => {
        const root = e.target.closest("[data-chips-root]");
        if (!root) return;
        if (e.target.closest("[data-chips-add]")) {
            const d = root.querySelector("[data-chips-draft]");
            if (d && d.value.trim()) chipsAgregarDesdeBorrador(root);
            chipsEnfocarBorrador(root);
            return;
        }
        if (e.target.closest("[data-chips-clear]")) {
            const ok = await mostrarConfirmacion({
                variante: "warning", titulo: "¿Quitar todos los participantes?",
                mensaje: "Se vaciará la lista de este registro. Podrá volver a agregarlos antes de guardar.",
                textoCancelar: "Cancelar", textoAceptar: "Quitar todos", iconoAceptar: "x"
            });
            if (ok) { chipsEscribir(root, []); chipsEnfocarBorrador(root); }
            return;
        }
        const btn = e.target.closest("[data-act]");
        if (btn && !btn.disabled) {
            const chip = btn.closest(".chip-part");
            if (!chip) return;
            const i = Number(chip.dataset.i);
            const act = btn.dataset.act;
            if (act === "quitar") { const it = chipsLeer(root); it.splice(i, 1); chipsEscribir(root, it); chipsEnfocarBorrador(root); }
            else if (act === "izq") chipsMover(root, i, i - 1);
            else if (act === "der") chipsMover(root, i, i + 1);
            else if (act === "editar") chipsEditar(root, i);
            return;
        }
        if (e.target.closest("[data-chips-caja]") && !e.target.closest(".chip-part")) chipsEnfocarBorrador(root);
    });

    form.addEventListener("dblclick", e => {
        const txt = e.target.closest(".chip-txt");
        if (!txt) return;
        const root = txt.closest("[data-chips-root]");
        const chip = txt.closest(".chip-part");
        if (root && chip) chipsEditar(root, Number(chip.dataset.i));
    });

    // Separadores escritos (coma, «;», salto de línea): crean la etiqueta al instante.
    form.addEventListener("input", e => {
        const d = e.target;
        if (!d.matches || !d.matches("[data-chips-draft]")) return;
        if (!/[,;\n\r]/.test(d.value)) return;
        const root = d.closest("[data-chips-root]");
        const partes = d.value.split(/[,;\n\r]/);
        const resto = partes.pop();
        chipsAgregarTexto(root, partes.join(","));
        d.value = resto.replace(/^\s+/, "");
    });

    // Pegar una lista (con comas o líneas): se convierte completa en etiquetas.
    form.addEventListener("paste", e => {
        const d = e.target;
        if (!d.matches || !d.matches("[data-chips-draft]")) return;
        const t = (e.clipboardData && e.clipboardData.getData("text")) || "";
        if (!/[,;\n\r]/.test(t)) return;
        e.preventDefault();
        const root = d.closest("[data-chips-root]");
        const ini = d.selectionStart == null ? d.value.length : d.selectionStart;
        const fin = d.selectionEnd == null ? d.value.length : d.selectionEnd;
        chipsAgregarTexto(root, d.value.slice(0, ini) + t + d.value.slice(fin));
        d.value = "";
    });

    form.addEventListener("keydown", e => {
        const t = e.target;
        if (!t.closest) return;
        const root = t.closest("[data-chips-root]");
        if (!root) return;
        // Campo de texto del nuevo participante
        if (t.matches("[data-chips-draft]")) {
            if (e.key === "Enter") { e.preventDefault(); chipsAgregarDesdeBorrador(root); }
            else if (e.key === "Backspace" && !t.value) {
                const it = chipsLeer(root);
                if (it.length) { it.pop(); chipsEscribir(root, it); }
            } else if (e.key === "Escape" && t.value) { e.preventDefault(); e.stopPropagation(); t.value = ""; }
            return;
        }
        // Edición en línea de una etiqueta
        if (t.matches(".chip-edit-input")) {
            if (e.key === "Enter") { e.preventDefault(); chipsTerminarEdicion(root, true); chipsEnfocarBorrador(root); }
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); chipsTerminarEdicion(root, false); chipsEnfocarBorrador(root); }
            return;
        }
        // Etiqueta enfocada: teclado
        if (t.matches(".chip-part")) {
            const i = Number(t.dataset.i);
            const enfocar = n => { const c = root.querySelector('.chip-part[data-i="' + n + '"]'); if (c) c.focus(); };
            if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                e.preventDefault();
                const n = i + (e.key === "ArrowLeft" ? -1 : 1);
                chipsMover(root, i, n);
                enfocar(Math.max(0, Math.min(n, chipsLeer(root).length - 1)));
            } else if (e.key === "ArrowLeft") { e.preventDefault(); enfocar(i - 1); }
            else if (e.key === "ArrowRight") { e.preventDefault(); if (i + 1 < chipsLeer(root).length) enfocar(i + 1); else chipsEnfocarBorrador(root); }
            else if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                const it = chipsLeer(root); it.splice(i, 1); chipsEscribir(root, it);
                if (it.length) enfocar(Math.min(i, it.length - 1)); else chipsEnfocarBorrador(root);
            } else if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); chipsEditar(root, i); }
        }
    });

    // Al salir de la edición en línea (clic fuera / Tab) se guarda el cambio.
    form.addEventListener("focusout", e => {
        const t = e.target;
        if (!t.matches || !t.matches(".chip-edit-input")) return;
        const root = t.closest("[data-chips-root]");
        if (root) chipsTerminarEdicion(root, true);
    });

    // Reordenamiento por arrastre
    const elemento = n => (n instanceof Element ? n : n && n.parentElement);
    form.addEventListener("dragstart", e => {
        const el = elemento(e.target);
        const chip = el && el.closest(".chip-part");
        if (!chip) return;
        arrastre = { root: chip.closest("[data-chips-root]"), desde: Number(chip.dataset.i) };
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", chip.textContent); } catch (err) {}
        chip.classList.add("chip-arrastrando");
    });
    form.addEventListener("dragover", e => {
        if (!arrastre) return;
        const el = elemento(e.target);
        const chip = el && el.closest(".chip-part");
        if (chip && chip.closest("[data-chips-root]") === arrastre.root) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            chip.classList.add("chip-destino");
        }
    });
    form.addEventListener("dragleave", e => {
        const el = elemento(e.target);
        const chip = el && el.closest(".chip-part");
        if (chip) chip.classList.remove("chip-destino");
    });
    form.addEventListener("drop", e => {
        if (!arrastre) return;
        const el = elemento(e.target);
        const chip = el && el.closest(".chip-part");
        if (chip && chip.closest("[data-chips-root]") === arrastre.root) {
            e.preventDefault();
            chipsMover(arrastre.root, arrastre.desde, Number(chip.dataset.i));
        }
        arrastre = null;
    });
    form.addEventListener("dragend", () => {
        arrastre = null;
        form.querySelectorAll(".chip-arrastrando, .chip-destino").forEach(c => c.classList.remove("chip-arrastrando", "chip-destino"));
    });
}


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
    // EXCLUSIÓN OBLIGATORIA: la extensión 3003 / Nidia Briceño Jiménez se
    // filtra SIEMPRE (admin y Modo Lectura); jamás aparece en la interfaz.
    if (esAdmin()) return dbDirectorio.filter(d => !registroDIRECAExcluido(d));
    if (config.publicado === false) return [];
    return dbDirectorio.filter(d => !registroDIRECAExcluido(d));
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
    // Siembra no destructiva del Directorio Telefónico DIRECA y de los
    // Circuitos: agrega solo lo que falte (en producción lo escribe un
    // Administrador; en demo se guarda en LocalStorage).
    sincronizarDirectorioDIRECA();
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

    unsubsTiempoReal.push(firebaseDB.collection(COLECCIONES.comisiones).onSnapshot(async snap => {
        dbComisiones = []; snap.forEach(d => dbComisiones.push(Object.assign({id:d.id}, d.data())));
        if (esAdmin()) {
            const existentes = new Set(dbComisiones.map(c => c.id));
            const faltantes = COMISIONES_OFICIALES.filter(c => !existentes.has(c.id));
            if (faltantes.length) {
                const batch = firebaseDB.batch();
                faltantes.forEach(c => batch.set(firebaseDB.collection(COLECCIONES.comisiones).doc(c.id), {nombre:c.nombre,tipo:c.tipo,miembros:[],actualizadoEn:firebase.firestore.FieldValue.serverTimestamp()},{merge:true}));
                try { await batch.commit(); } catch(e) { console.error("Precarga comisiones",e); }
            }
        }
        renderComisiones();
    }, err => { console.error("Comisiones",err); showToast("No se pudieron sincronizar las comisiones.","warning"); }));

    unsubsTiempoReal.push(firebaseDB.collection(COLECCIONES.config).doc("sistema").onSnapshot(d => {
        if (d.exists) config = Object.assign({
            anio: new Date().getFullYear(), version: "Vs.001", publicado: true, saludo: "", firma: "",
            mision: MARCO_DEFAULT.mision, vision: MARCO_DEFAULT.vision,
            valores: Object.assign({}, MARCO_DEFAULT.valores), valoresLista: null, pestanasInhabilitadas: []
        }, d.data());
        if (!config.valores) config.valores = Object.assign({}, MARCO_DEFAULT.valores);
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

/* ==================== ESCRITURA DE DATOS ==================== */
function guardarDoc(coleccion, doc) {
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
    comisiones: "drec_demo_comisiones",
    usuarios: "drec_demo_usuarios",
    config: "drec_demo_config"
};

function persistirDemo() {
    if (!MODO_DEMO) return;
    try {
        localStorage.setItem(DEMO_KEYS.actividades, JSON.stringify(dbActividades));
        localStorage.setItem(DEMO_KEYS.directorio, JSON.stringify(dbDirectorio));
        localStorage.setItem(DEMO_KEYS.comisiones, JSON.stringify(dbComisiones));
        localStorage.setItem(DEMO_KEYS.usuarios, JSON.stringify(dbUsuarios));
        localStorage.setItem(DEMO_KEYS.config, JSON.stringify(config));
    } catch (e) { console.warn("No se pudo persistir el modo demo:", e); }
}

function cargarDatosDemo() {
    try {
        const a = localStorage.getItem(DEMO_KEYS.actividades);
        const d = localStorage.getItem(DEMO_KEYS.directorio);
        const cm = localStorage.getItem(DEMO_KEYS.comisiones);
        const u = localStorage.getItem(DEMO_KEYS.usuarios);
        const c = localStorage.getItem(DEMO_KEYS.config);
        if (a) dbActividades = JSON.parse(a);
        if (d) dbDirectorio = JSON.parse(d);
        if (cm) dbComisiones = JSON.parse(cm);
        else dbComisiones = COMISIONES_OFICIALES.map(x => ({...x, miembros:[]}));
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

async function borrarTodoDemo() {
    if (!MODO_DEMO) { showToast("Disponible solo en modo demostración.", "warning"); return; }
    const okDemo = await mostrarConfirmacion({
        variante: "danger",
        titulo: "¿Borrar todos los datos de demostración?",
        mensaje: "Se eliminarán TODOS los datos guardados en este navegador (actividades, directorio y configuración). Esta acción no se puede deshacer.",
        items: [{ etiqueta: "Actividades", valor: String(dbActividades.length) }, { etiqueta: "Directorio", valor: String(dbDirectorio.length) }],
        escribir: "BORRAR",
        textoCancelar: "Cancelar",
        textoAceptar: "Eliminar definitivamente",
        iconoAceptar: "trash-2"
    });
    if (!okDemo) return;
    dbActividades = [];
    dbDirectorio = [];
    config = { anio: new Date().getFullYear(), version: "Vs.001", publicado: true, saludo: "", firma: "", mision: MARCO_DEFAULT.mision, vision: MARCO_DEFAULT.vision, valores: Object.assign({}, MARCO_DEFAULT.valores), pestanasInhabilitadas: [] };
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
    // Juegos deportivos estudiantiles (esquema nuevo: categoría → etapa)
    act("deportivos", { categoria: "Juegos Deportivos Estudiantiles", etapa: "Inscripciones y ejecución Institucional", titulo: "Inscripción de delegaciones institucionales", fecha: "2026-03-02", fechaFin: "2026-03-13" });
    act("deportivos", { categoria: "Juegos Deportivos Estudiantiles", etapa: "Inscripciones y ejecución Institucional", titulo: "Etapa Institucional · Ajedrez", fecha: "2026-04-06", fechaFin: "2026-04-10" });
    act("deportivos", { categoria: "Juegos Deportivos Estudiantiles", etapa: "Verificaciones Circuitales", titulo: "Verificación circuital · Atletismo", fecha: "2026-05-04", fechaFin: "2026-05-08" });
    act("deportivos", { categoria: "Juegos Deportivos Estudiantiles Regional", etapa: "Periodos Verificaciones Interregionales", titulo: "Verificación interregional · Fútbol", fecha: "2026-07-20", fechaFin: "2026-07-24" });
    act("deportivos", { categoria: "Juegos Deportivos Estudiantiles", etapa: "Periodos Verificaciones Nacionales", titulo: "Verificación nacional · Fútbol sala", fecha: "2026-09-28", fechaFin: "2026-10-02" });
    // CTP y módulos técnicos y especiales (CTP, CINDEA, IPEC)
    act("ctp_tecnicos", { opcion: "Programación Académica Colegio Técnico Profesional", subopcion: CTP_N2_7_11, actividad: "Inicio del I Periodo 2026", fecha: "2026-02-09", titulo: CTP_N2_7_11 + " — Inicio del I Periodo 2026" });
    act("ctp_tecnicos", { opcion: "Programación Académica Colegio Técnico Profesional", subopcion: CTP_N2_DUODECIMO, actividad: "I Pruebas del I Periodo para estudiantes de Duodécimo año", fecha: "2026-04-13", titulo: CTP_N2_DUODECIMO + " — I Pruebas del I Periodo para estudiantes de Duodécimo año" });
    act("ctp_tecnicos", { opcion: "Seguimiento Bimensual de NEO", subopcion: CTP_N2_NEO, bimensual: "Marzo", entregaDocentes: "2026-03-27", entregaPlataforma: "2026-03-31", fecha: "2026-03-27", titulo: "Seguimiento Bimensual de NEO — Marzo" });
    act("ctp_tecnicos", { opcion: "Programación Académica, Colegios Académicos Nocturnos, CINDEAs e IPEC", subopcion: CTP_N2_IPEC, nivel3: "-I SEMESTRE IPEC-CINDEA", periodoPruebas: "I Pruebas Ordinaria", fecha: "2026-06-01", titulo: CTP_N2_IPEC + " — -I SEMESTRE IPEC-CINDEA · I Pruebas Ordinaria" });
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
    dbDirectorio.forEach(d => { if (!d.categoria) d.categoria = "Telefonía Fija"; });
    // Directorio Telefónico DIRECA + Circuitos: se AGREGAN a los registros
    // previos (siembra no destructiva, sin sobreescribir datos existentes).
    dbDirectorio = dbDirectorio.concat(
        REGISTROS_DIRECA.map(r => Object.assign({}, r)),
        REGISTROS_SUPERVISIONES.map(r => Object.assign({}, r))
    );
    config = {
        anio: 2026,
        version: "Vs.001",
        publicado: true,
        saludo: "Para la Dirección Regional de Educación Cañas es un honor presentar la Programación Anual, instrumento rector que orienta la gestión educativa de nuestros circuitos y centros educativos. Invitamos a toda la comunidad educativa a conocer y apropiarse de las acciones aquí planificadas.",
        firma: "Dirección Regional de Educación Cañas · MEP",
        mision: MARCO_DEFAULT.mision,
        vision: MARCO_DEFAULT.vision,
        valores: Object.assign({}, MARCO_DEFAULT.valores),
        pestanasInhabilitadas: []
    };
    dbComisiones = COMISIONES_OFICIALES.map(c => ({...c, miembros:[]}));
    persistirDemo();
}

/* ==================== REFRESCO GLOBAL DE VISTAS ==================== */
function refrescarTodo() {
    aplicarAnio();
    sincronizarNav();
    renderPortada();
    renderMarco();
    renderDashboard();
    renderCalendario();
    if (calDiaSel) renderCalDetalle();
    Object.values(MODULOS).forEach(m => renderTabla(m));
    renderComisiones();
    renderEnlacesInstitucionales();
    renderConfiguracion();
    renderPestanasConfig();
    const banner = $("bannerPublicacion");
    if (banner) banner.classList.toggle("hidden", config.publicado !== false);
    crearIconos();
}

/* ==================== ENLACES INSTITUCIONALES CON CÓDIGO QR ==================== */
function urlInstitucionalSegura(valor) {
    const raw = String(valor || "").trim();
    if (!raw) return "";
    try {
        const u = new URL(raw);
        return (u.protocol === "https:" || u.protocol === "http:") ? u.href : "";
    } catch (_) { return ""; }
}

function renderEnlacePublico(tipo) {
    const url = urlInstitucionalSegura(config[tipo + "Url"]);
    const texto = String(config[tipo + "Texto"] || "").trim();
    const cont = $(tipo + "Publico");
    if (!cont) return;
    const tituloAccion = tipo === "oferentes" ? "Ingresar al registro" : "Completar encuesta";
    if (!url) {
        cont.innerHTML = '<p class="drec-enlace-descripcion">' + esc(texto) + '</p>' +
            '<div class="drec-qr-vacio"><i data-lucide="qr-code"></i><strong>Enlace pendiente de configuración</strong><span>El personal administrador habilitará aquí el código QR y el acceso correspondiente.</span></div>';
    } else {
        const qr = "https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=" + encodeURIComponent(url);
        cont.innerHTML = '<p class="drec-enlace-descripcion">' + esc(texto) + '</p>' +
            '<div class="drec-acceso-grid"><div class="drec-qr-marco"><img src="' + qr + '" alt="Código QR para acceder" loading="lazy"></div>' +
            '<div class="drec-acceso-info"><span class="drec-acceso-etiqueta">ACCESO DIGITAL</span><h3>Escanee el código QR</h3>' +
            '<p>Utilice la cámara de su dispositivo para abrir el formulario. También puede ingresar mediante el botón.</p>' +
            '<a class="drec-link-destacado" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' +
            '<i data-lucide="external-link"></i> ' + tituloAccion + '</a>' +
            '<a class="drec-link-texto" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a></div></div>';
    }
    crearIconos();
}

function renderEnlacesInstitucionales() {
    ["oferentes", "satisfaccion"].forEach(tipo => {
        renderEnlacePublico(tipo);
        const texto = $(tipo + "Texto"), url = $(tipo + "Url");
        if (texto && document.activeElement !== texto) texto.value = config[tipo + "Texto"] || "";
        if (url && document.activeElement !== url) url.value = config[tipo + "Url"] || "";
    });
}

function guardarEnlaceInstitucional(tipo) {
    if (!esAdmin()) return;
    if (tipo !== "oferentes" && tipo !== "satisfaccion") return;
    const texto = ($(tipo + "Texto")?.value || "").trim();
    const urlOriginal = ($(tipo + "Url")?.value || "").trim();
    const url = urlInstitucionalSegura(urlOriginal);
    if (urlOriginal && !url) {
        showToast("Ingrese un enlace válido que comience con https:// o http://.", "danger");
        return;
    }
    if (!texto) {
        showToast("Agregue una breve descripción antes de guardar.", "danger");
        return;
    }
    guardarConfig({ [tipo + "Texto"]: texto, [tipo + "Url"]: url })
        .then(ok => { if (ok) showToast("La sección se actualizó correctamente.", "success"); });
}

/* ==================== VISIBILIDAD DE PESTAÑAS ==================== */
// Una pestaña «inhabilitada» solo la ve y la usa el Administrador:
// para el Modo Lectura desaparece por completo del menú y de los accesos
// directos de la portada.
function pestanaHabilitada(id) {
    if (esAdmin()) return true;
    return (config.pestanasInhabilitadas || []).indexOf(id) === -1;
}

let navFirma = "";   // firma de las pestañas visibles (para reconstruir el menú en vivo)
let tabActiva = "inicio";

function sincronizarNav() {
    const firma = navCompleta().map(v => v.id).join("|") + "#" + (currentUser ? currentUser.rol : "lectura");
    if (firma === navFirma) return;
    navFirma = firma;
    construirNav();
    // Si la pestaña activa dejó de ser visible para este usuario (p. ej.
    // otro administrador la inhabilitó en vivo), se vuelve al Inicio.
    if (!navCompleta().some(v => v.id === tabActiva)) {
        switchTab("inicio");
    } else {
        const t = $("tab-" + tabActiva);
        if (t) t.classList.add("activo");
    }
}

/* ==================== NAVEGACIÓN Y SECCIONES ==================== */
function navCompleta() {
    const items = VISTAS.slice();
    // General: Directorio y Comisiones se presentan junto a Inicio, Panel y Calendario.
    const directorio = MODULOS.directorio;
    if (directorio) items.push({ id: directorio.id, etiqueta: directorio.etiqueta, icono: directorio.icono });
    items.push({ id: "comisiones", etiqueta: "Comisiones", icono: "users-round" });
    items.push({ id: "oferentes", etiqueta: "Registro de Oferentes", icono: "clipboard-list" });
    items.push({ id: "satisfaccion", etiqueta: "Satisfacción del Servicio", icono: "message-square-heart" });
    Object.values(MODULOS).filter(m => m.id !== "directorio").forEach(m => items.push({ id: m.id, etiqueta: m.etiqueta, icono: m.icono }));
    items.push({ id: "configuracion", etiqueta: "Configuración", icono: "settings", soloAdmin: true });
    return items.filter(v => (!v.soloAdmin || esAdmin()) && pestanaHabilitada(v.id));
}

function construirNav() {
    const nav = $("navTabs");
    if (!nav) return;
    const items = navCompleta();
    let grupo = "";
    let html = "";
    items.forEach(v => {
        const g = (v.id === "inicio" || v.id === "dashboard" || v.id === "calendario" || v.id === "directorio" || v.id === "comisiones" || v.id === "oferentes" || v.id === "satisfaccion")
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
                // Cambio 2026: exportación con opciones. Se puede exportar a Excel
                // la lista completa visible (respetando los filtros activos) o
                // únicamente los registros seleccionados (solo Administradores).
                '<select onchange="exportarModuloOpcion(this, \'' + m.id + '\')" title="Exportar a Excel" ' +
                    'class="text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-mep-blue" style="min-height:40px">' +
                    '<option value="">Exportar Excel…</option>' +
                    '<option value="todos">Excel · Registros visibles (según filtros)</option>' +
                    (esAdmin() ? '<option value="seleccion">Excel · Solo los seleccionados</option>' : "") +
                '</select>' +
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
    cont.insertAdjacentHTML("beforeend", `<section id="view-comisiones" class="vista hidden space-y-4"><div class="card p-5"><h2 class="font-display text-lg font-bold text-mep-navy">Comisiones</h2><p class="text-xs text-slate-500 mt-1">Equipos/Comités y Grupos de apoyo · Documento M.2</p></div><div id="comisionesApp"></div></section>`);
    crearIconos();
}

function switchTab(tabId) {
    const item = navCompleta().find(v => v.id === tabId);
    if (!item) return;
    if (!pestanaHabilitada(tabId)) return;
    tabActiva = tabId;
    const ids = ["inicio", "dashboard", "calendario"].concat(Object.keys(MODULOS), ["comisiones", "oferentes", "satisfaccion", "configuracion"]);
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
    if (tabId === "comisiones") renderComisiones();
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
        // Cambio 2026 (Directorio): el filtro de categoría ya NO ofrece la
        // opción «Todos». La vista del directorio telefónico debe consultarse
        // SIEMPRE por categoría, de modo que la tabla muestre únicamente las
        // columnas que esa categoría utiliza (sin campos vacíos). Si no hay
        // categoría activa, se selecciona automáticamente la primera.
        const esFiltroCategoriaDirectorio = mod.id === "directorio" && f.campo === "categoria";
        if (esFiltroCategoriaDirectorio) {
            opciones = opciones.filter(o => o !== "");
            filtrosState[mod.id] = filtrosState[mod.id] || {};
            if (!activos[f.campo] || opciones.indexOf(activos[f.campo]) === -1) {
                activos[f.campo] = opciones[0] || "";
                filtrosState[mod.id][f.campo] = activos[f.campo];
            }
        }
        html += '<select onchange="aplicarFiltro(\'' + mod.id + '\',\'' + f.campo + '\', this.value)" ' +
            'class="text-xs font-semibold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-mep-blue">' +
            opciones.map(o => '<option value="' + esc(o) + '"' + ((activos[f.campo] || "") === o ? " selected" : "") + '>' +
                (o === "" && !esFiltroCategoriaDirectorio ? esc(f.etiqueta + ": Todos") : esc(o)) + '</option>').join("") + "</select>";
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
    if (campo === "telefono" || campo === "movil") return fmtTelefono(v);
    if (campo === "correo") {
        // Lista de correos: cada uno con su enlace mailto.
        return String(v).trim().split(/[\s,;/]+/).filter(Boolean).map(c =>
            '<a class="text-mep-blue hover:underline break-all" href="mailto:' + esc(c) + '">' + esc(c) + '</a>').join(" · ");
    }
    if (campo === "categoria") {
        return '<span class="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">' + esc(v) + "</span>";
    }
    if (campo === "participantes") return participantesHTML(v); // etiquetas compactas
    if (campo === "departamento") return esc(r.institucion && !v ? r.institucion : v); // universal: centros educativos
    if (campo === "oficina") return esc(v || r.oficinaSupervision || ""); // universal: DIRECA / Circuitos
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

    // Directorio: las columnas se adaptan a la categoría seleccionada en el
    // filtro (columnas específicas) o usan las universales si está en «Todos».
    let cols = mod.coleccion === COLECCIONES.directorio
        ? columnasDirectorio((filtrosState[mod.id] || {}).categoria || "")
        : mod.columnas.slice();
    if (mod.coleccion !== COLECCIONES.directorio) cols = cols.concat([]); // estado/acciones abajo
    let head = '<tr class="bg-slate-100 text-slate-700 font-extrabold uppercase tracking-wider border-b border-slate-200">';
    if (esAdmin()) {
        // Columna inicial: checkbox maestro «Seleccionar todos» (respeta los
        // filtros activos: marca únicamente los registros visibles).
        head += '<th class="p-3 w-10 text-center" title="Seleccionar todos los registros visibles">' +
            '<input type="checkbox" id="check-maestro-' + esc(mod.id) + '" class="check-maestro" onchange="alternarSeleccionTodos(\'' + esc(mod.id) + '\', this.checked)" aria-label="Seleccionar todos los registros visibles"></th>';
    }
    head += cols.map(c => '<th class="p-3">' + esc(c.etiqueta) + "</th>").join("");
    if (esAdmin()) {
        if (mod.coleccion === COLECCIONES.actividades) head += '<th class="p-3">Estado</th>';
        head += '<th class="p-3 text-center">Acciones</th>';
    }
    head += "</tr>";
    thead.innerHTML = head;

    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="' + (cols.length + (esAdmin() ? 3 : 0)) + '" class="p-8 text-center text-slate-400 font-semibold">No hay registros para mostrar.</td></tr>';
        sincronizarCheckMaestro(mod.id);
        actualizarBarraSeleccion();
        return;
    }

    tbody.innerHTML = lista.map(r => {
        let fila = "<tr class='hover:bg-slate-50/80 transition" + (esAdmin() && estaSeleccionado(mod.id, r.id) ? " fila-seleccionada" : "") + "'>";
        if (esAdmin()) {
            fila += '<td class="p-3 align-top text-center celda-seleccion" data-label="Selección">' +
                '<input type="checkbox" class="check-fila"' + (estaSeleccionado(mod.id, r.id) ? " checked" : "") +
                ' onchange="alternarSeleccion(\'' + esc(mod.id) + '\',\'' + esc(r.id) + '\', this)" aria-label="Seleccionar registro"></td>';
        }
        cols.forEach(c => { fila += '<td class="p-3 align-top" data-label="' + esc(c.etiqueta) + '">' + valorCelda(r, c.campo) + "</td>"; });
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
    sincronizarCheckMaestro(mod.id);
    actualizarBarraSeleccion();
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
    const modulos = Object.values(MODULOS).filter(m => pestanaHabilitada(m.id)).map(m => {
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
    abrirModal("modalPortada");
}

async function guardarPortada(event) {
    event.preventDefault();
    if (!esAdmin()) return;
    const ok = await guardarConfig({
        anio: parseInt($("pcAnio").value, 10) || new Date().getFullYear(),
        version: $("pcVersion").value.trim() || "Vs.001",
        publicado: $("pcPublicado").checked,
        saludo: $("pcSaludo").value.trim(),
        firma: $("pcAutor").value.trim()
    });
    if (ok) {
        cerrarModal("modalPortada");
        showToast("Metadatos de la portada actualizados.", "success");
    }
}

/* ==================== MARCO FILOSÓFICO (MISIÓN · VISIÓN · VALORES) ==================== */
// Render en vivo de los 6 textos editables. Se ejecuta en cada refresco
// (onSnapshot de drec_configuracion), de modo que un cambio hecho por un
// Administrador se refleja al instante en los usuarios en Modo Lectura.
/* ---- Valores institucionales dinámicos ----
   El Administrador puede editar el TÍTULO y el TEXTO de cada valor,
   eliminar valores existentes y agregar nuevos. Se almacenan en
   drec_configuracion/sistema como «valoresLista»: [{titulo, texto, icono}].
   La clave histórica «valores» (objeto fijo compromiso/respeto/...) se
   mantiene sincronizada para compatibilidad con datos ya guardados. */
const ICONOS_VALORES = ["handshake", "heart-handshake", "scale", "shield-check", "sprout", "lightbulb", "target", "leaf", "award", "flag", "sun", "star"];
const COLORES_VALORES = ["#D97706", "#059669", "#1E40AF", "#7C3AED", "#DC2626", "#0891B2", "#DB2777", "#64748B"];

// Normaliza cualquier formato antiguo o nuevo a una LISTA de valores.
function valoresActivos() {
    if (Array.isArray(config.valoresLista) && config.valoresLista.length > 0) {
        return config.valoresLista.filter(v => v && (v.titulo || v.texto));
    }
    // Migración: convierte el objeto histórico {compromiso, respeto, ...}
    // a la lista dinámica conservando títulos en bonito.
    const base = config.valores || MARCO_DEFAULT.valores;
    const bonito = { compromiso: "Compromiso", respeto: "Respeto", transparencia: "Transparencia", responsabilidad: "Responsabilidad" };
    return Object.keys(base).map((k, i) => ({
        titulo: bonito[k] || k.charAt(0).toUpperCase() + k.slice(1),
        texto: base[k] || "",
        icono: ICONOS_VALORES[i % ICONOS_VALORES.length]
    })).filter(v => v.texto);
}

function renderMarco() {
    const set = (id, val) => { const el = $(id); if (el) el.textContent = val || ""; };
    set("misionTexto", config.mision || MARCO_DEFAULT.mision);
    set("visionTexto", config.vision || MARCO_DEFAULT.vision);
    const cont = $("valoresGrid");
    if (!cont) return;
    const lista = valoresActivos();
    cont.innerHTML = lista.map((v, i) => {
        const color = COLORES_VALORES[i % COLORES_VALORES.length];
        const icono = v.icono || ICONOS_VALORES[i % ICONOS_VALORES.length];
        return '<article class="valor-card col-span-12 md:col-span-6 xl:col-span-3">' +
            '<div class="valor-card-brillo" style="background:radial-gradient(420px 120px at 12% 0%, ' + color + '26, transparent 70%)"></div>' +
            '<header class="valor-card-head">' +
                '<span class="valor-badge" style="background:' + color + '17;color:' + color + ';border-color:' + color + '33"><i data-lucide="' + esc(icono) + '"></i></span>' +
                '<h4 class="valor-card-titulo">' + esc(v.titulo || "Valor institucional") + '</h4>' +
                '<span class="valor-card-num">' + pad(i + 1) + '</span>' +
            '</header>' +
            '<p class="valor-card-texto">' + esc(v.texto || "") + '</p>' +
            '</article>';
    }).join("");
    crearIconos();
}

// Filas dinámicas del editor del marco filosófico (título editable + texto + eliminar)
function renderFilasValores(lista) {
    const cont = $("mfValores");
    if (!cont) return;
    cont.innerHTML = lista.map(v =>
        '<div class="mf-valor" data-icono="' + esc(v.icono || "gem") + '">' +
            '<div class="flex items-center gap-2">' +
                '<span class="icono-tile bg-blue-50 text-mep-blue shrink-0" style="width:32px;height:32px;border-radius:10px"><i data-lucide="' + esc(v.icono || "gem") + '" class="w-4 h-4"></i></span>' +
                '<input type="text" data-tipo="titulo" maxlength="60" placeholder="Título del valor (ej: Honestidad) *" value="' + esc(v.titulo || "") + '" class="campo font-bold">' +
                '<button type="button" onclick="quitarValorFila(this)" title="Eliminar este valor" class="accion-btn accion-borrar shrink-0"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
            '</div>' +
            '<textarea data-tipo="texto" rows="3" maxlength="900" placeholder="Descripción del valor institucional *" class="campo">' + esc(v.texto || "") + '</textarea>' +
        '</div>').join("");
    crearIconos();
}

function leerFilasValores() {
    const cont = $("mfValores");
    if (!cont) return [];
    return Array.from(cont.querySelectorAll(".mf-valor")).map((fila, i) => ({
        titulo: (fila.querySelector('[data-tipo="titulo"]') || {}).value || "",
        texto: (fila.querySelector('[data-tipo="texto"]') || {}).value || "",
        icono: fila.getAttribute("data-icono") || ICONOS_VALORES[i % ICONOS_VALORES.length]
    }));
}

function agregarValorFila() {
    const cont = $("mfValores");
    if (!cont) return;
    const i = cont.querySelectorAll(".mf-valor").length;
    cont.insertAdjacentHTML("beforeend",
        '<div class="mf-valor" data-icono="' + ICONOS_VALORES[i % ICONOS_VALORES.length] + '">' +
            '<div class="flex items-center gap-2">' +
                '<span class="icono-tile bg-blue-50 text-mep-blue shrink-0" style="width:32px;height:32px;border-radius:10px"><i data-lucide="' + ICONOS_VALORES[i % ICONOS_VALORES.length] + '" class="w-4 h-4"></i></span>' +
                '<input type="text" data-tipo="titulo" maxlength="60" placeholder="Título del valor (ej: Honestidad) *" value="" class="campo font-bold">' +
                '<button type="button" onclick="quitarValorFila(this)" title="Eliminar este valor" class="accion-btn accion-borrar shrink-0"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
            '</div>' +
            '<textarea data-tipo="texto" rows="3" maxlength="900" placeholder="Descripción del valor institucional *" class="campo"></textarea>' +
        '</div>');
    crearIconos();
    const filas = cont.querySelectorAll(".mf-valor");
    filas[filas.length - 1].querySelector('[data-tipo="titulo"]').focus();
}

function quitarValorFila(btn) {
    const fila = btn.closest(".mf-valor");
    if (fila) fila.remove();
}

function abrirEditorMarco() {
    if (!esAdmin()) return;
    $("mfMision").value = config.mision || "";
    $("mfVision").value = config.vision || "";
    renderFilasValores(valoresActivos());
    abrirModal("modalMarco");
}

async function guardarMarco(event) {
    event.preventDefault();
    if (!esAdmin()) return;
    const lista = leerFilasValores();
    // Validación: cada valor necesita título y texto; se descartan filas vacías.
    const llenos = lista.filter(v => v.titulo.trim() || v.texto.trim());
    const incompletos = llenos.filter(v => !v.titulo.trim() || !v.texto.trim());
    if (incompletos.length > 0) {
        showToast("Cada valor institucional necesita un título y su descripción.", "warning");
        return;
    }
    if (llenos.length === 0) {
        showToast("Agregue al menos un valor institucional.", "warning");
        return;
    }
    // Sincroniza el objeto histórico «valores» para compatibilidad.
    const legado = {};
    llenos.forEach(v => { legado[normalize(v.titulo).replace(/[^a-z0-9]+/g, "_")] = v.texto.trim(); });
    const ok = await guardarConfig({
        mision: $("mfMision").value.trim(),
        vision: $("mfVision").value.trim(),
        valoresLista: llenos.map(v => ({ titulo: v.titulo.trim(), texto: v.texto.trim(), icono: v.icono })),
        valores: legado
    });
    if (ok) {
        cerrarModal("modalMarco");
        showToast("Marco filosófico institucional actualizado. Los usuarios en Modo Lectura lo verán al instante.", "success");
    }
}

/* ==================== CONTROL DE PESTAÑAS (ADMIN) ==================== */
// Panel de Configuración: interruptores para inhabilitar pestañas del menú.
// Las pestañas inhabilitadas solo las ve el Administrador.
function renderPestanasConfig() {
    const cont = $("pestanasConfig");
    if (!cont || !esAdmin()) return;
    const inhabilitadas = config.pestanasInhabilitadas || [];
    // La pestaña "Comisiones" se controla también desde este panel:
    // se agrega junto a VISTAS y los módulos para que pueda habilitarse
    // o inhabilitarse frente al Modo Lectura.
    const items = VISTAS.slice()
        .concat([{ id: "comisiones", etiqueta: "Comisiones", icono: "users-round" }])
        .concat(Object.values(MODULOS).map(m => ({ id: m.id, etiqueta: m.titulo, icono: m.icono })));
    cont.innerHTML = items.map(v => {
        const off = inhabilitadas.indexOf(v.id) !== -1;
        return '<label class="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 cursor-pointer hover:border-mep-blue/40 transition">' +
            '<span class="flex items-center gap-2.5 min-w-0">' +
            '<i data-lucide="' + v.icono + '" class="w-4 h-4 text-mep-blue shrink-0"></i>' +
            '<span class="text-xs font-bold text-mep-navy truncate">' + esc(v.etiqueta) + "</span></span>" +
            '<span class="flex items-center gap-2 shrink-0">' +
            '<span class="text-[10px] font-extrabold uppercase ' + (off ? "text-amber-600" : "text-emerald-600") + '">' + (off ? "Inhabilitada" : "Visible") + "</span>" +
            '<input type="checkbox" ' + (off ? "" : "checked") + ' onchange="togglePestana(\'' + v.id + '\', this.checked)" class="rounded text-mep-blue w-4 h-4">' +
            "</span></label>";
    }).join("");
    crearIconos();
}

async function togglePestana(id, visible) {
    if (!esAdmin()) return;
    let lista = (config.pestanasInhabilitadas || []).slice();
    if (visible) {
        lista = lista.filter(x => x !== id);
    } else {
        if (lista.indexOf(id) === -1) lista.push(id);
    }
    const ok = await guardarConfig({ pestanasInhabilitadas: lista });
    if (ok) {
        showToast(visible
            ? "Pestaña habilitada: vuelve a ser visible para el Modo Lectura."
            : "Pestaña inhabilitada: ahora solo la ve el Administrador.", "info");
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
    const okPub = await mostrarConfirmacion({
        variante: "info",
        titulo: "¿Publicar todas las actividades en borrador?",
        mensaje: "Pasarán a estado «Publicada» y serán visibles en el Modo Lectura público.",
        items: [{ etiqueta: "Actividades", valor: String(total) }],
        textoCancelar: "Cancelar",
        textoAceptar: "Publicar actividades",
        iconoAceptar: "check-circle-2"
    });
    if (!okPub) return;
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
// Selector de año: las estadísticas del panel (totales, próximas,
// distribución por módulo y actividades por mes) se calculan EXCLUSIVAMENTE
// con las actividades cuyo año (de su fecha inicial) coincide con el año
// seleccionado. Los datos de otros años no se mezclan en la vista.
let dashAnio = null; // año seleccionado en el Panel de Control

function anioDeFecha(iso) {
    const m = String(iso || "").match(/^(\d{4})-/);
    return m ? parseInt(m[1], 10) : null;
}

function cambiarAnioDashboard(anio) {
    dashAnio = parseInt(anio, 10) || new Date().getFullYear();
    renderDashboard();
}

function renderSelectorAnio() {
    const sel = $("dashAnio");
    if (!sel) return;
    // Años disponibles: los presentes en los datos + año de la config + actual.
    const set = {};
    dbActividades.forEach(a => { const y = anioDeFecha(a.fecha); if (y) set[y] = true; });
    set[parseInt(config.anio, 10) || new Date().getFullYear()] = true;
    set[new Date().getFullYear()] = true;
    const anios = Object.keys(set).map(Number).sort((a, b) => b - a);
    if (!dashAnio || anios.indexOf(dashAnio) === -1) dashAnio = parseInt(config.anio, 10) || new Date().getFullYear();
    sel.innerHTML = anios.map(y => '<option value="' + y + '"' + (y === dashAnio ? " selected" : "") + '>' + y + "</option>").join("");
    const lbl = $("dashAnioEtiqueta");
    if (lbl) lbl.textContent = String(dashAnio);
    const lblStat = $("dashAnioStat");
    if (lblStat) lblStat.textContent = String(dashAnio);
}

function renderDashboard() {
    renderSelectorAnio();
    // Filtrado estricto por año seleccionado: lo registrado en un año no
    // aparece en los demás (y viceversa).
    const act = actividadesVisibles().filter(a => anioDeFecha(a.fecha) === dashAnio);
    $("statActividades").textContent = act.length;
    const hoy = hoyISO();
    const en30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    $("statProximas").textContent = act.filter(a => a.fecha >= hoy && a.fecha <= en30).length;
    $("statDirectorio").textContent = directorioVisible().length;
    $("statModulos").textContent = Object.values(MODULOS).filter(m => m.coleccion === COLECCIONES.directorio || registrosDe(m).filter(r => anioDeFecha(r.fecha) === dashAnio).length > 0).length;

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

    // Distribución por módulo, también filtrada por el año seleccionado.
    const porModulo = {};
    Object.values(MODULOS).forEach(m => {
        porModulo[m.id] = m.coleccion === COLECCIONES.directorio
            ? registrosDe(m).length
            : registrosDe(m).filter(r => anioDeFecha(r.fecha) === dashAnio).length;
    });
    const max = Math.max(1, ...Object.values(MODULOS).map(m => porModulo[m.id]));
    $("modulosBars").innerHTML = Object.values(MODULOS).map(m => {
        const n = porModulo[m.id];
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
    if (cfg.coleccion === COLECCIONES.directorio) {
        // DIRECTORIO: selector de categoría + campos dinámicos según la
        // categoría elegida (despliega/oculta en vivo, sin recargar el modal).
        const catInicial = (registro && registro.categoria) || "Telefonía Fija";
        const campoCat = Object.assign({}, campoDirectorio("categoria"));
        campoCat.etiqueta = "Categoría / Tipo de registro *";
        html += campoInput(campoCat, catInicial).replace('id="ef-categoria"', 'id="ef-categoria" onchange="refrescarCamposDirectorio()"');
        html += '<div id="ef-campos-dinamicos" class="space-y-4">' +
            camposDeCategoria(catInicial).filter(c => c.clave !== "categoria").map(c => {
                let valor = registro ? (registro[c.clave] == null ? "" : registro[c.clave]) : "";
                return campoInput(c, valor);
            }).join("") + "</div>";
    } else if (cfg.id === "celebrativos") {
        // CELEBRATIVOS: primer campo obligatorio «¿Será Día o Semana?» y
        // despliegue dinámico de los campos según la opción elegida.
        let tipoInicial = (registro && registro.tipo) || "Día";
        if (tipoInicial === "Día Celebrativo") tipoInicial = "Día"; // compatibilidad con datos previos
        const campoTipo = Object.assign({}, cfg.campos[0]);
        html += campoInput(campoTipo, tipoInicial).replace('id="ef-tipo"', 'id="ef-tipo" onchange="refrescarCamposCelebrativos()"');
        html += '<div id="ef-campos-dinamicos" class="space-y-4">' +
            camposCelebrativos(tipoInicial).map(c => {
                let valor = registro ? (registro[c.clave] == null ? "" : registro[c.clave]) : "";
                if (!registro && c.clave === "fecha" && editorPrefillFecha) valor = editorPrefillFecha;
                return campoInput(c, valor);
            }).join("") + "</div>";
    } else if (cfg.id === "ctp_tecnicos") {
        // CTP Y TÉCNICOS: cascada de 3 niveles. Opción → Nivel de pruebas →
        // bloque de campos específicos (renderizado por refrescarCamposCTP).
        const opInicial = (registro && registro.opcion) || "";
        const subInicial = (registro && registro.subopcion) || "";
        html += campoInput(F_CTP.opcion, opInicial).replace('id="ef-opcion"', 'id="ef-opcion" onchange="refrescarCamposCTP()"').replace("— Sin especificar —", "— Seleccione la opción —");
        html += campoInput(F_CTP.subopcion, subInicial).replace("— Sin especificar —", "Seleccione primero una opción...");
        html += '<div id="ef-campos-dinamicos" class="space-y-4"></div>';
    } else if (cfg.id === "deportivos") {
        // DEPORTIVOS: desplegables en cascada Categoría / Programa →
        // Etapa / Subcategoría. El bloque de Actividad y Fechas (con
        // modalidad «un solo día» o «rango») se despliega dinámicamente
        // solo cuando ambos desplegables tienen una opción válida.
        let catInicial = (registro && registro.categoria) || "";
        let etaInicial = (registro && registro.etapa) || "";
        // Retrocompatibilidad: registros previos guardaban «fase» textual.
        if (!catInicial && registro && registro.fase && DEP_FASE_HISTORICA[registro.fase]) {
            catInicial = DEP_FASE_HISTORICA[registro.fase][0];
            etaInicial = DEP_FASE_HISTORICA[registro.fase][1];
        }
        const campoCat = Object.assign({}, F.depCategoria);
        html += campoInput(campoCat, catInicial).replace('id="ef-categoria"', 'id="ef-categoria" onchange="refrescarCamposDeportivos()"').replace("— Sin especificar —", "— Seleccione la categoría / programa —");
        const campoEta = Object.assign({}, F.depEtapa);
        // CORRECCIÓN: la etapa debe reaccionar de inmediato al cambio del
        // usuario; sin este onchange el bloque de detalle (ef-campos-dinamicos)
        // nunca se despliega al elegir una etapa.
        html += campoInput(campoEta, etaInicial).replace('id="ef-etapa"', 'id="ef-etapa" onchange="refrescarCamposDeportivos()"').replace("— Sin especificar —", "Seleccione primero una categoría...");
        html += '<div id="ef-campos-dinamicos" class="space-y-4"></div>';
    } else {
        cfg.campos.forEach(c => {
            let valor = registro ? (registro[c.clave] == null ? "" : registro[c.clave]) : "";
            if (!registro && c.clave === "fecha" && editorPrefillFecha) valor = editorPrefillFecha;
            html += campoInput(c, valor);
        });
    }
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
    html += '<div id="ef-error" class="hidden text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl p-3"></div>' +
        '<div class="flex justify-end gap-2 pt-4">' +
        '<button type="button" onclick="solicitarCierreModal(\'modalEditor\')" class="btn-suave">Cancelar</button>' +
        '<button type="submit" id="btnGuardarEditor" class="btn-mep-primary px-6 py-2.5 rounded-2xl font-bold text-sm">Guardar</button></div>';
    $("editorForm").innerHTML = html;
    if (cfg.coleccion === COLECCIONES.directorio) activarAutocompletadoDirectorio($("ef-categoria").value);
    if (cfg.id === "deportivos") refrescarCamposDeportivos(); // puebla la etapa y el bloque de detalle (edición incluida)
    if (cfg.id === "ctp_tecnicos") {
        // CTP y Técnicos: el cambio en el Nivel de pruebas (segundo nivel)
        // re-renderiza el bloque de campos específicos; la Opción ya lleva
        // su onchange en línea.
        const selSubCTP = $("ef-subopcion");
        if (selSubCTP) selSubCTP.addEventListener("change", refrescarCamposCTP);
        refrescarCamposCTP(); // puebla el nivel 2 y el bloque (edición incluida)
    }
    abrirModal("modalEditor");
}

function campoInput(c, valor) {
    if (c.tipo === "chips") return campoParticipantes(c, valor); // etiquetas (chips) de participantes
    const base = 'id="ef-' + esc(c.clave) + '" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-mep-blue focus:bg-white outline-none"';
    let input;
    if (c.tipo === "select") {
        // Si el registro guarda un valor fuera de la lista (p. ej. una oficina
        // registrada manualmente), se muestra como opción seleccionada extra.
        const opciones = (c.opciones || []).slice();
        if (valor !== "" && valor != null && opciones.indexOf(String(valor)) === -1) opciones.push(String(valor));
        input = "<select " + base + ">" + opciones.map(o =>
            '<option value="' + esc(o) + '"' + (String(valor) === String(o) ? " selected" : "") + ">" +
            (o === "" ? "— Sin especificar —" : o === "__OTRA__" ? "Otra oficina (escribir manualmente)" : esc(o)) + "</option>").join("") + "</select>";
    } else if (c.tipo === "textarea") {
        input = "<textarea " + base + " rows='3' maxlength='1500'>" + esc(valor) + "</textarea>";
    } else {
        let tipo = c.tipo === "email" ? "email" : c.tipo === "date" ? "date" : "text";
        let extra = 'maxlength="300"';
        if (c.clave === "hora") {
            // Hora estricta HH:MM (24 h): el control nativo «time» impide
            // letras y horas imposibles como 25:99.
            tipo = "time";
            extra = "";
        }
        if (c.clave === "telefono" || c.clave === "extension" || c.clave === "movil" || c.clave === "celular") {
            // Solo dígitos, espacios, guiones, paréntesis y «+».
            extra = 'maxlength="30" inputmode="tel" oninput="sanitizarTelefono(this)"';
        }
        if (c.clave === "correo") {
            // Puede contener varios correos separados por espacios, comas o «/».
            extra = 'maxlength="400"';
        }
        if (c.clave === "codigoPresupuestario" || c.clave === "numero") {
            extra = 'maxlength="30" inputmode="numeric" oninput="sanitizarCodigo(this)"';
        }
        input = '<input type="' + tipo + '" ' + base + ' ' + extra + ' value="' + esc(valor) + '">';
    }
    return '<div><label class="block text-xs font-bold text-slate-700 uppercase mb-1">' + esc(c.etiqueta) + (c.requerido ? " *" : "") + "</label>" + input + "</div>";
}

/* ==================== VALIDACIÓN ESTRICTA DE FORMULARIOS ==================== */
// Sanitización en vivo de teléfonos, extensiones y móviles: solo dígitos,
// espacios, guiones, paréntesis y «+».
function sanitizarTelefono(el) {
    const limpio = el.value.replace(/[^\d\s()\-+/]/g, "").slice(0, 30);
    if (el.value !== limpio) el.value = limpio;
}

// Sanitización de códigos presupuestarios y numeración: dígitos y guiones.
function sanitizarCodigo(el) {
    const limpio = el.value.replace(/[^\d\-]/g, "").slice(0, 30);
    if (el.value !== limpio) el.value = limpio;
}

// ¿Fecha ISO real del calendario? (impide 2026-02-30, 2026-13-01, etc.)
function fechaReal(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return false;
    const partes = iso.split("-");
    const y = parseInt(partes[0], 10), m = parseInt(partes[1], 10), d = parseInt(partes[2], 10);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Hora válida HH:MM (00:00 – 23:59).
function horaValida(h) {
    const m = String(h || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return false;
    return parseInt(m[1], 10) <= 23 && parseInt(m[2], 10) <= 59;
}

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Valida una lista de correos separados por espacios, comas, «;» o «/».
function correosValidos(txt) {
    return String(txt || "").trim().split(/[\s,;/]+/).filter(Boolean).every(c => RE_CORREO.test(c));
}

// Validación integral de un registro: fechas reales y coherentes, hora
// estricta, correos válidos, teléfonos sanos, códigos numéricos y textos sin
// caracteres de control. Devuelve un mensaje legible o null si todo está bien.
function validarRegistro(cfg, doc) {
    for (const clave of ["fecha", "fechaFin"]) {
        if (doc[clave] && !fechaReal(doc[clave])) {
            return "La fecha " + (clave === "fecha" ? "inicial" : "final") + " no es un día real del calendario.";
        }
    }
    if (doc.fecha && doc.fechaFin && doc.fechaFin < doc.fecha) {
        return "La fecha final no puede ser anterior a la fecha inicial.";
    }
    if ("hora" in doc && doc.hora && !horaValida(doc.hora)) {
        return "La hora debe tener el formato HH:MM (ej: 08:30) y ser un horario real.";
    }
    if ("correo" in doc && doc.correo && !correosValidos(doc.correo)) {
        return "El correo (o la lista de correos) no es válido (ej: nombre@mep.go.cr).";
    }
    for (const clave of ["telefono", "extension", "movil", "celular"]) {
        if (clave in doc && doc[clave]) {
            if (/[^\d\s()\-+/]/.test(doc[clave])) return "El campo de teléfono solo admite números, espacios, guiones, paréntesis y «+».";
            if (doc[clave].replace(/\D/g, "").length > 15) return "El campo de teléfono tiene demasiados dígitos.";
        }
    }
    if (doc.codigoPresupuestario && /[^\d\-]/.test(doc.codigoPresupuestario)) {
        return "El código presupuestario solo admite números y guiones (ej: 210-573-01-63-2594).";
    }
    if (doc.numero && /[^\d\-]/.test(doc.numero)) {
        return "El campo «Número» solo admite números y guiones.";
    }
    if (doc.titulo && doc.titulo.length > 300) return "El título es demasiado extenso (máximo 300 caracteres).";
    if (doc.titulo && /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(doc.titulo)) return "El título contiene caracteres no permitidos.";
    return null;
}

async function guardarEditor(event) {
    event.preventDefault();
    if (!esAdmin()) return;
    const cfg = configDeEditor();
    if (!cfg) return;
    consolidarChipsPendientes(); // convierte en etiqueta el texto pendiente de «Participantes»
    const doc = {};
    let valido = true;
    // Directorio: los obligatorios se evalúan SOLO sobre los campos visibles
    // de la categoría elegida (los campos ocultos van vacíos al documento).
    const esDirectorio = cfg.coleccion === COLECCIONES.directorio;
    const esCelebrativos = cfg.id === "celebrativos";
    const esDeportivos = cfg.id === "deportivos";
    // Los obligatorios se evalúan SOLO sobre los campos visibles (directorio
    // por categoría; celebrativos por «Día» o «Semana»; deportivos por la
    // categoría + etapa elegidas). Los ocultos van vacíos.
    const clavesActivas = esDirectorio
        ? camposDeCategoria(($("ef-categoria") || {}).value || "").map(c => c.clave)
        : esCelebrativos
            ? camposCelebrativos(($("ef-tipo") || {}).value || "Día").map(c => c.clave)
            : esDeportivos
                ? camposDeportivos(($("ef-categoria") || {}).value || "", ($("ef-etapa") || {}).value || "").map(c => c.clave)
                : null;
    cfg.campos.forEach(c => {
        const el = $("ef-" + c.clave);
        const v = el ? el.value.trim() : "";
        const obligatorio = c.requerido && (!clavesActivas || clavesActivas.indexOf(c.clave) !== -1);
        if (obligatorio && !v) { valido = false; if (el) el.classList.add("border-red-400", "ring-1", "ring-red-300"); }
        else if (el) el.classList.remove("border-red-400");
        doc[c.clave] = v;
    });
    if (!valido) { showToast("Complete los campos obligatorios (*).", "warning"); return; }

    // Directorio DIRECA: la opción «__OTRA__» se sustituye por el nombre de
    // oficina digitado manualmente en el campo desplegable adyacente.
    if (esDirectorio && doc.oficina === "__OTRA__") {
        const inp = $("ef-oficinaManual");
        const manual = inp ? inp.value.trim() : "";
        if (!manual) {
            showToast("Escriba el nombre de la oficina (campo manual).", "warning");
            if (inp) inp.classList.add("border-red-400", "ring-1", "ring-red-300");
            return;
        }
        doc.oficina = manual;
    }

    // Celebrativos: normaliza el valor histórico «Día Celebrativo» a «Día».
    if (esCelebrativos && doc.tipo === "Día Celebrativo") doc.tipo = "Día";

    // Deportivos: validación de los desplegables en cascada y de la
    // modalidad de fecha («un solo día» vs. «rango de fechas»).
    if (esDeportivos) {
        if (!doc.categoria || !doc.etapa) {
            showToast("Seleccione la Categoría / Programa y la Etapa / Subcategoría.", "warning");
            ["categoria", "etapa"].forEach(k => { const el = $("ef-" + k); if (el && !el.value) el.classList.add("border-red-400", "ring-1", "ring-red-300"); });
            return;
        }
        const modoDep = (document.querySelector("input[name='depModo']:checked") || {}).value || "dia";
        if (modoDep === "rango") {
            if (!doc.fechaFin) {
                showToast("Indique la fecha de fin del rango.", "warning");
                const el = $("ef-fechaFin"); if (el) el.classList.add("border-red-400", "ring-1", "ring-red-300");
                return;
            }
            // Validación del rango: la fecha final no puede ser anterior a la inicial.
            if (doc.fecha && doc.fechaFin && doc.fechaFin < doc.fecha) {
                showToast("La fecha final no puede ser anterior a la fecha inicial.", "warning");
                const el = $("ef-fechaFin"); if (el) el.classList.add("border-red-400", "ring-1", "ring-red-300");
                return;
            }
        } else {
            doc.fechaFin = ""; // un solo día: sin fecha de fin (dato limpio en Firestore)
        }
    }

    // CTP y Técnicos: lectura y validación del bloque dinámico según la
    // rama de la cascada, más la composición del resumen «titulo».
    const esCTP = cfg.id === "ctp_tecnicos";
    if (esCTP) {
        if (!doc.opcion || !doc.subopcion) {
            showToast("Seleccione la Opción y el Nivel de pruebas.", "warning");
            ["opcion", "subopcion"].forEach(k => { const el = $("ef-" + k); if (el && !el.value) el.classList.add("border-red-400", "ring-1", "ring-red-300"); });
            return;
        }
        let falta = null;
        camposCTP(doc.subopcion).forEach(c => {
            const el = $("ef-" + c.clave);
            doc[c.clave] = el ? el.value.trim() : "";
            if (c.requerido && !doc[c.clave]) {
                falta = c.etiqueta;
                if (el) el.classList.add("border-red-400", "ring-1", "ring-red-300");
            }
        });
        if (falta) { showToast("Complete el campo obligatorio: " + falta + ".", "warning"); return; }
        // Composición del resumen legible (usado por calendario, panel y detalle).
        if (doc.subopcion === CTP_N2_NEO) {
            doc.titulo = "Seguimiento Bimensual de NEO — " + doc.bimensual;
            doc.fecha = doc.entregaDocentes || doc.entregaPlataforma || "";
        } else if (doc.actividad) {
            doc.titulo = doc.subopcion + " — " + doc.actividad;
        } else {
            doc.titulo = doc.subopcion + " — " + doc.nivel3 + " · " + doc.periodoPruebas;
        }
        // Limpieza: los campos de ramas no aplicadas van vacíos en Firestore.
        ["actividad", "bimensual", "entregaDocentes", "entregaPlataforma", "nivel3", "periodoPruebas"].forEach(k => {
            if (!(k in doc)) doc[k] = "";
        });
    }

    // Validación estricta por tipo de campo (fechas reales, HH:MM, correos, teléfonos, códigos).
    const error = validarRegistro(cfg, doc);
    const cajaError = $("ef-error");
    if (error) {
        showToast(error, "warning");
        if (cajaError) { cajaError.textContent = error; cajaError.classList.remove("hidden"); }
        return;
    }
    if (cajaError) cajaError.classList.add("hidden");

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
    const items = [
        { etiqueta: "Módulo", valor: cfg.titulo },
        { etiqueta: "Registro", valor: nombreRegistro(r, id) }
    ];
    if (r.fecha) items.push({ etiqueta: "Fecha", valor: fmtFecha(r.fecha) + (r.fechaFin ? " – " + fmtFecha(r.fechaFin) : "") });
    if (r.sede) items.push({ etiqueta: "Sede", valor: r.sede });
    const confirmado = await mostrarConfirmacion({
        variante: "danger",
        titulo: "¿Eliminar este registro?",
        mensaje: "Se eliminará de forma permanente de la programación. Esta acción no se puede deshacer.",
        items: items,
        textoCancelar: "Cancelar",
        textoAceptar: "Eliminar definitivamente",
        iconoAceptar: "trash-2"
    });
    if (!confirmado) return;
    const ok = await eliminarDoc(cfg.coleccion, id);
    if (ok) { quitarDeSeleccion(modId, id); showToast("Registro eliminado.", "info"); }
}

function verDetalle(modId, id) {
    const cfg = MODULOS[modId];
    if (!cfg) return;
    const r = registroDe(cfg, id);
    if (!r) { showToast("Registro no encontrado.", "warning"); return; }
    $("detalleTitulo").textContent = r.titulo || r.funcionario || (r.institucion || r.departamento) || "Detalle";
    // Directorio: el detalle muestra únicamente los campos de la categoría
    // del registro (además de la categoría misma y las notas). CTP y
    // Técnicos: muestra el resumen y los campos de la rama de la cascada.
    const esDir = modId === "directorio";
    const esCTP = modId === "ctp_tecnicos";
    let camposDetalle = cfg.campos;
    if (esDir) {
        camposDetalle = camposDeCategoria(r.categoria || "Telefonía Fija").concat([{ clave: "notas", etiqueta: "Notas / Observaciones" }]);
    } else if (esCTP) {
        if (r.subopcion) {
            camposDetalle = [{ clave: "titulo", etiqueta: "Actividad / Gestión" }]
                .concat(cfg.campos)
                .concat(camposCTP(r.subopcion));
        } else {
            // Retrocompatibilidad: registros previos a la cascada (con centro,
            // modalidad, sede, etc.).
            camposDetalle = [{ clave: "titulo", etiqueta: "Actividad / Gestión" }].concat([
                { clave: "centro", etiqueta: "Centro / CTP" },
                { clave: "modalidad", etiqueta: "Modalidad" },
                { clave: "circuito", etiqueta: "Circuito" },
                { clave: "fecha", etiqueta: "Fecha" },
                { clave: "fechaFin", etiqueta: "Finaliza" },
                { clave: "hora", etiqueta: "Hora" },
                { clave: "sede", etiqueta: "Sede" },
                { clave: "participantes", etiqueta: "Participantes" },
                { clave: "responsable", etiqueta: "Responsable" },
                { clave: "descripcion", etiqueta: "Observaciones" }
            ]);
        }
    }
    $("detalleCuerpo").innerHTML = camposDetalle.map(c => {
        const v = r[c.clave];
        if (v == null || v === "") return "";
        let valor = esc(v);
        if (c.tipo === "date") valor = fmtFecha(v);
        if (c.clave === "participantes") valor = participantesHTML(v);
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
}

// Bloquea el botón «Guardar» mientras opera contra Firebase (evita doble clic
// y cuentas duplicadas).
function estadoBotonGuardar(ocupado) {
    const btn = $("btnGuardarEditor");
    if (!btn) return;
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
    const okReset = await mostrarConfirmacion({
        variante: "info",
        titulo: "¿Enviar enlace de restablecimiento?",
        mensaje: "Se enviará un correo con un enlace para que la persona cree una nueva contraseña.",
        items: [{ etiqueta: "Usuario", valor: u.nombre || "—" }, { etiqueta: "Correo", valor: u.email }],
        textoCancelar: "Cancelar",
        textoAceptar: "Enviar enlace",
        iconoAceptar: "send"
    });
    if (!okReset) return;
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
        body.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-slate-400 font-semibold">Aún no hay administradores registrados. Use «Registrar usuario» para crear la primera cuenta de Administrador.</td></tr>';
        sincronizarCheckMaestro("usuarios");
        actualizarBarraSeleccion();
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
        return "<tr class='hover:bg-slate-50/80" + (estaSeleccionado("usuarios", u.uid) ? " fila-seleccionada" : "") + "'>" +
            "<td class='p-3 text-center align-top celda-seleccion'>" +
                "<input type='checkbox' class='check-fila'" + (estaSeleccionado("usuarios", u.uid) ? " checked" : "") +
                " onchange=\"alternarSeleccion('usuarios','" + esc(u.uid) + "', this)\" aria-label='Seleccionar usuario'" + (propio ? " disabled title='No puede eliminar su propia cuenta'" : "") + "></td>" +
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
    sincronizarCheckMaestro("usuarios");
    actualizarBarraSeleccion();
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
    const usr = dbUsuarios.find(x => String(x.uid) === String(uid));
    const confirmado = await mostrarConfirmacion({
        variante: "danger",
        titulo: "¿Eliminar este usuario del sistema?",
        mensaje: "Se retirará su autorización de acceso. La cuenta de Firebase Authentication permanece; solo se quita del sistema. Esta acción no se puede deshacer.",
        items: [
            { etiqueta: "Nombre", valor: (usr && usr.nombre) || "—" },
            { etiqueta: "Correo", valor: (usr && usr.email) || "—" }
        ],
        textoCancelar: "Cancelar",
        textoAceptar: "Eliminar definitivamente",
        iconoAceptar: "trash-2"
    });
    if (!confirmado) return;
    const ok = await eliminarDoc(COLECCIONES.usuarios, uid);
    if (ok) { quitarDeSeleccion("usuarios", uid); showToast("Usuario eliminado del sistema.", "info"); }
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

// Despachador del selector de exportación de cada módulo.
// "todos"      → exporta los registros visibles (respetando los filtros).
// "seleccion"  → exporta únicamente los registros marcados con checkbox
//                (disponible solo para Administradores, en todas las
//                pestañas de módulos, incluido el Directorio).
function exportarModuloOpcion(sel, modId) {
    const modo = sel.value;
    sel.selectedIndex = 0; // vuelve a la opción guía tras cada exportación
    if (modo === "seleccion") exportarModulo(modId, true);
    else if (modo === "todos") exportarModulo(modId, false);
}

function exportarModulo(modId, soloSeleccionados) {
    const mod = MODULOS[modId];
    if (!mod) return;
    let lista = listaFiltrada(mod);
    if (soloSeleccionados) {
        if (!esAdmin()) { showToast("La exportación de seleccionados requiere sesión de Administrador.", "warning"); return; }
        lista = lista.filter(r => estaSeleccionado(mod.id, r.id));
        if (!lista.length) { showToast("No hay registros seleccionados para exportar.", "warning"); return; }
    }
    // Directorio: exporta las columnas de la categoría seleccionada en el
    // filtro (la categoría es obligatoria desde el cambio 2026, por lo que
    // siempre se usan las columnas específicas de esa categoría).
    const columnas = mod.coleccion === COLECCIONES.directorio
        ? columnasDirectorio((filtrosState[mod.id] || {}).categoria || "")
        : mod.columnas;
    const encabezados = columnas.map(c => c.etiqueta).concat(esAdmin() && mod.coleccion === COLECCIONES.actividades ? ["Estado"] : []);
    const filas = lista.map(r => {
        const fila = columnas.map(c => {
            let v = r[c.campo];
            // Universal: los centros educativos aportan su institución.
            if (c.campo === "departamento" && !v) v = r.institucion;
            // Universal: los Circuitos aportan su oficina de supervisión.
            if (c.campo === "oficina" && !v) v = r.oficinaSupervision;
            if (v == null) return "";
            if (c.campo === "fecha" || c.campo === "fechaFin") return fmtFecha(v);
            if (c.campo === "participantes") return serializarParticipantes(parsearParticipantes(v));
            return String(v);
        });
        if (esAdmin() && mod.coleccion === COLECCIONES.actividades) fila.push(r.estado === "borrador" ? "Borrador" : "Publicada");
        return fila;
    });
    exportarExcel(filas, encabezados,
        "DREC_" + config.anio + "_" + mod.id + (soloSeleccionados ? "_seleccion" : "") + ".xlsx",
        mod.titulo);
}

function exportarCalendario() {
    const act = actividadesVisibles().slice().sort((a, b) =>
        String(a.fecha || "").localeCompare(String(b.fecha || "")) || String(a.titulo || "").localeCompare(String(b.titulo || "")));
    const encabezados = ["Fecha", "Finaliza", "Módulo", "Actividad", "Hora", "Sede", "Participantes", "Circuito", "Estado"];
    const filas = act.map(a => {
        const mod = MODULOS[a.modulo] || { titulo: a.modulo || "" };
        return [fmtFecha(a.fecha), fmtFecha(a.fechaFin), mod.titulo, a.titulo || "", a.hora || "", a.sede || "", serializarParticipantes(parsearParticipantes(a.participantes)), a.circuito || "", a.estado === "borrador" ? "Borrador" : "Publicada"];
    });
    exportarExcel(filas, encabezados, "DREC_" + config.anio + "_Calendario_Completo.xlsx", "Calendario " + config.anio);
}

/* ==================== EXPORTACIÓN ANUAL COMPLETA A EXCEL (xlsx-js-style) ====================
   Genera «DREC_[AÑO]_Programacion_Anual_[VERSION].xlsx» con 12 hojas que
   replican el formato institucional de la Programación Anual DREC.
   · Administrador: todas las actividades del año elegido en #dashAnio + todo
     el directorio.
   · Modo Lectura: solo actividades «publicada» (y solo si config.publicado
     !== false) + directorio visible. Ambos casos usan actividadesVisibles() y
     directorioVisible(), que ya aplican esas reglas.
   · La exclusión obligatoria (extensión 3003 / Nidia Briceño Jiménez) se
     aplica siempre con registroDIRECAExcluido(). */
const EXC = {
    navy: "0A192F", azul: "1E40AF", blanco: "FFFFFF", texto: "1E293B",
    dorado: "FEF3C7", azulPalido: "DBEAFE", cebra: "F8FAFC",
    bordeEnc: "CBD5E1", bordeDato: "E2E8F0", gris: "64748B"
};
const EXC_TITULO_INSTITUCIONAL = "MINISTERIO DE EDUCACIÓN PÚBLICA · DIRECCIÓN REGIONAL DE EDUCACIÓN CAÑAS";
const EXC_ORDEN_CIRCUITOS = ["Dirección Regional", "Circuito 01 (Cañas)", "Circuito 02 (Abangares)", "Circuito 03 (Tilarán)", "Circuito 04 (Colorado)", "Circuito 05 (La Altura)"];

/* ---------- Estilos ---------- */
const _exCacheEstilos = {};
function exEstilo(o) {
    const clave = JSON.stringify(o);
    if (_exCacheEstilos[clave]) return _exCacheEstilos[clave];
    const bordeDe = rgb => ({ style: "thin", color: { rgb: rgb } });
    const s = {
        font: { name: "Calibri", sz: o.sz || 10, bold: !!o.bold, italic: !!o.italic, color: { rgb: o.color || EXC.texto } },
        alignment: { horizontal: o.h || "left", vertical: "center", wrapText: true }
    };
    if (o.bg) s.fill = { patternType: "solid", fgColor: { rgb: o.bg }, bgColor: { rgb: o.bg } };
    if (o.borde) { const b = bordeDe(o.borde); s.border = { top: b, bottom: b, left: b, right: b }; }
    _exCacheEstilos[clave] = s;
    return s;
}
const exEstBanner1 = () => exEstilo({ bg: EXC.navy, color: EXC.blanco, bold: true, sz: 13, h: "center" });
const exEstBanner2 = () => exEstilo({ bg: EXC.navy, color: EXC.blanco, bold: true, sz: 11, h: "center" });
const exEstEncabezado = () => exEstilo({ bg: EXC.azul, color: EXC.blanco, bold: true, sz: 10, h: "center", borde: EXC.bordeEnc });
const exEstSubDorado = () => exEstilo({ bg: EXC.dorado, color: EXC.navy, bold: true, sz: 10, h: "left", borde: EXC.bordeEnc });
const exEstSubAzul = () => exEstilo({ bg: EXC.azulPalido, color: EXC.navy, bold: true, sz: 11, h: "left", borde: EXC.bordeEnc });
const exEstNota = () => exEstilo({ color: EXC.gris, italic: true, sz: 10, h: "center", borde: EXC.bordeDato });
function exEstDato(zebra, centro, extra) {
    return exEstilo(Object.assign({ bg: zebra ? EXC.cebra : EXC.blanco, sz: 10, h: centro ? "center" : "left", borde: EXC.bordeDato }, extra || {}));
}

/* ---------- Utilidades de datos ---------- */
function exNombreHoja(n) { return String(n).replace(/[\\\/\?\*\[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31); }
function exFecha(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + "/" + m[2] + "/" + m[1] : "";
}
function exTxt(v) { return v == null ? "" : String(v).trim(); }
function exPart(v) { return serializarParticipantes(parsearParticipantes(v)); }
function exTel(t) {
    const d = String(t || "").replace(/\D/g, "");
    return d.length === 8 ? d.slice(0, 4) + "-" + d.slice(4) : exTxt(t);
}
function exCorreos(c) { return String(c || "").trim().split(/[\s,;\/]+/).filter(Boolean).join("\n"); }
function exFechaPrincipal(a) { return a.fecha || a.entregaDocentes || a.entregaPlataforma || ""; }
function exOrdenFecha(a, b) {
    return exFechaPrincipal(a).localeCompare(exFechaPrincipal(b)) || exTxt(a.hora).localeCompare(exTxt(b.hora)) || exTxt(a.titulo).localeCompare(exTxt(b.titulo), "es");
}
function exCmp(a, b) { return String(a || "").localeCompare(String(b || ""), "es", { numeric: true, sensitivity: "base" }); }
function exMayus1(t) { t = exTxt(t); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ""; }

/* ---------- Constructor de hojas ---------- */
function exHoja(n, anchosFijos) {
    const h = { ws: {}, merges: [], alturas: [], r: 0, n: n, ancho: new Array(n).fill(8), fijos: anchosFijos || null };
    h.celda = (r, c, v, est) => {
        h.ws[XLSX.utils.encode_cell({ r: r, c: c })] = { v: v == null ? "" : v, t: typeof v === "number" ? "n" : "s", s: est };
    };
    // Una fila compuesta por celdas con «span» (celdas combinadas horizontales).
    h.spans = (items, alto) => {
        let c = 0;
        const r = h.r;
        items.forEach(it => {
            const sp = it.span || 1;
            for (let k = 0; k < sp; k++) h.celda(r, c + k, k === 0 ? it.v : "", it.est);
            if (sp > 1) h.merges.push({ s: { r: r, c: c }, e: { r: r, c: c + sp - 1 } });
            else if (!it.sinAncho) {
                const largo = Math.max.apply(null, String(it.v == null ? "" : it.v).split("\n").map(x => x.length));
                h.ancho[c] = Math.max(h.ancho[c], Math.min(largo, it.tope || 48));
            }
            c += sp;
        });
        if (alto) h.alturas[r] = alto;
        h.r++;
    };
    h.completa = (texto, est, alto) => h.spans([{ v: texto, span: h.n, est: est }], alto);
    h.fin = (wb, nombre) => {
        h.ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(h.r - 1, 0), c: h.n - 1 } });
        h.ws["!merges"] = h.merges;
        let anchos = h.fijos ? h.fijos.slice() : h.ancho.map(w => Math.max(11, Math.min(52, Math.ceil(w * 1.1) + 2)));
        // Ancho total mínimo para que el banner institucional se lea completo.
        const total = anchos.reduce((a, b) => a + b, 0);
        if (total < 108) { let imax = 0; anchos.forEach((w, i) => { if (w > anchos[imax]) imax = i; }); anchos[imax] += 108 - total; }
        h.ws["!cols"] = anchos.map(w => ({ wch: w }));
        const filas = [];
        for (let i = 0; i < h.r; i++) filas.push(h.alturas[i] ? { hpt: h.alturas[i] } : {});
        h.ws["!rows"] = filas;
        XLSX.utils.book_append_sheet(wb, h.ws, exNombreHoja(nombre));
    };
    return h;
}
function exBanner(h, anio, version, subtitulo) {
    h.completa(EXC_TITULO_INSTITUCIONAL, exEstBanner1(), 28);
    h.completa("PROGRAMACIÓN ANUAL " + anio + " (" + version + ")" + (subtitulo ? " · " + subtitulo : ""), exEstBanner2(), 22);
    h.completa("", exEstilo({}), 8);
}
function exEncabezados(h, titulos) {
    h.spans(titulos.map(t => ({ v: t, est: exEstEncabezado(), tope: 16 })), 30);
}
// Fila de datos con cebra; «centros» = índices de columnas centradas.
function exDato(h, valores, zebra, centros) {
    h.spans(valores.map((v, i) => ({ v: v, est: exEstDato(zebra, centros.indexOf(i) !== -1) })));
}
function exSinRegistros(h, anio) {
    h.completa("No hay registros programados en este módulo para el año " + anio + ".", exEstNota(), 26);
}
function exAltoTexto(texto, caracteresPorLinea, pt) {
    let lineas = 0;
    String(texto || " ").split("\n").forEach(p => { lineas += Math.max(1, Math.ceil(p.length / caracteresPorLinea)); });
    return Math.max(20, Math.ceil(lineas * (pt || 10) * 1.45) + 8);
}

// Hoja estándar de módulo: banner + encabezados + filas ordenadas (o aviso sin registros).
function exHojaSimple(wb, nombre, titulo, encabezados, filas, centros, anio, version) {
    const h = exHoja(encabezados.length);
    exBanner(h, anio, version, titulo.toUpperCase());
    exEncabezados(h, encabezados);
    if (!filas.length) exSinRegistros(h, anio);
    else filas.forEach((f, i) => exDato(h, f, i % 2 === 1, centros));
    h.fin(wb, nombre);
}

/* ---------- Hoja 1: Portada y Marco ---------- */
function exHojaPortada(wb, anio, version, conteos, totalActs, totalDir) {
    const h = exHoja(4, [30, 30, 42, 42]);
    exBanner(h, anio, version, "");
    const sub = t => h.completa(t, exEstSubDorado(), 22);
    const texto = (t, alto) => h.completa(t, exEstilo({ sz: 10, h: "left", borde: EXC.bordeDato, bg: EXC.blanco }), alto);
    const CPL_TOTAL = 125;

    sub("SALUDO INSTITUCIONAL");
    const saludo = exTxt(config.saludo) || "El saludo institucional aún no ha sido redactado.";
    texto(saludo, exAltoTexto(saludo, CPL_TOTAL));
    h.completa(exTxt(config.firma), exEstilo({ bold: true, sz: 10, h: "right", color: EXC.navy, borde: EXC.bordeDato, bg: EXC.cebra }), 22);
    h.completa("", exEstilo({}), 10);

    sub("MARCO FILOSÓFICO INSTITUCIONAL");
    h.completa("MISIÓN", exEstSubAzul(), 22);
    const mision = exTxt(config.mision) || MARCO_DEFAULT.mision;
    texto(mision, exAltoTexto(mision, CPL_TOTAL));
    h.completa("VISIÓN", exEstSubAzul(), 22);
    const vision = exTxt(config.vision) || MARCO_DEFAULT.vision;
    texto(vision, exAltoTexto(vision, CPL_TOTAL));
    h.completa("", exEstilo({}), 10);

    sub("VALORES INSTITUCIONALES");
    h.spans([{ v: "Valor", est: exEstEncabezado() }, { v: "Descripción", span: 3, est: exEstEncabezado() }], 24);
    valoresActivos().forEach((v, i) => {
        const desc = exTxt(v.texto);
        h.spans([
            { v: exTxt(v.titulo), est: exEstDato(i % 2 === 1, false, { bold: true, color: EXC.navy }), sinAncho: true },
            { v: desc, span: 3, est: exEstDato(i % 2 === 1, false) }
        ], exAltoTexto(desc, 100));
    });
    h.completa("", exEstilo({}), 10);

    sub("RESUMEN DE ACTIVIDADES PROGRAMADAS · AÑO " + anio);
    h.spans([{ v: "N.°", est: exEstEncabezado() }, { v: "Módulo", span: 2, est: exEstEncabezado() }, { v: "Actividades", est: exEstEncabezado() }], 24);
    conteos.forEach((c, i) => {
        h.spans([
            { v: i + 1, est: exEstDato(i % 2 === 1, true), sinAncho: true },
            { v: c.titulo, span: 2, est: exEstDato(i % 2 === 1, false) },
            { v: c.cantidad, est: exEstDato(i % 2 === 1, true), sinAncho: true }
        ]);
    });
    const estTotal = exEstilo({ bg: EXC.azulPalido, bold: true, color: EXC.navy, sz: 10, h: "center", borde: EXC.bordeEnc });
    const estTotalIzq = exEstilo({ bg: EXC.azulPalido, bold: true, color: EXC.navy, sz: 10, h: "left", borde: EXC.bordeEnc });
    h.spans([{ v: "", est: estTotal, sinAncho: true }, { v: "TOTAL DE ACTIVIDADES", span: 2, est: estTotalIzq }, { v: totalActs, est: estTotal, sinAncho: true }]);
    h.spans([{ v: "", est: exEstDato(false, true), sinAncho: true }, { v: "Directorio institucional (registros)", span: 2, est: exEstDato(false, false) }, { v: totalDir, est: exEstDato(false, true), sinAncho: true }]);
    h.fin(wb, "Portada y Marco");
}

/* ---------- Hoja 6: Juegos Deportivos (Categoría → Etapa → Fecha) ---------- */
function exHojaDeportivos(wb, lista, anio, version) {
    const enc = ["Categoría / Programa", "Etapa / Subcategoría", "Actividad", "Fecha Inicio", "Fecha Finalización"];
    const h = exHoja(enc.length);
    exBanner(h, anio, version, "JUEGOS DEPORTIVOS ESTUDIANTILES");
    exEncabezados(h, enc);
    if (!lista.length) { exSinRegistros(h, anio); h.fin(wb, "Juegos Deportivos"); return; }
    const ord = lista.slice().sort((a, b) => exCmp(a.categoria, b.categoria) || exCmp(a.etapa, b.etapa) || exOrdenFecha(a, b));
    let cat = null, i = 0;
    ord.forEach(a => {
        if (a.categoria !== cat) { cat = a.categoria; h.completa("CATEGORÍA / PROGRAMA: " + (exTxt(cat) || "Sin categoría").toUpperCase(), exEstSubDorado(), 22); i = 0; }
        exDato(h, [exTxt(a.categoria), exTxt(a.etapa), exTxt(a.titulo), exFecha(a.fecha), exFecha(a.fechaFin)], i % 2 === 1, [3, 4]);
        i++;
    });
    h.fin(wb, "Juegos Deportivos");
}

/* ---------- Hoja 10: Programación Mensual (Enero–Diciembre) ---------- */
function exHojaMensual(wb, lista, anio, version) {
    const enc = ["Fecha", "Actividad", "Hora", "Sede", "Participantes", "Nivel de Logro / Compromiso"];
    const h = exHoja(enc.length);
    exBanner(h, anio, version, "PROGRAMACIÓN MENSUAL");
    exEncabezados(h, enc);
    if (!lista.length) { exSinRegistros(h, anio); h.fin(wb, "Programación Mensual"); return; }
    for (let m = 0; m < 12; m++) {
        h.completa(MESES[m].toUpperCase() + " " + anio, exEstSubAzul(), 24);
        const delMes = lista.filter(a => parseInt(String(a.fecha).slice(5, 7), 10) === m + 1).sort(exOrdenFecha);
        if (!delMes.length) { h.completa("Sin actividades programadas en " + MESES[m].toLowerCase() + ".", exEstNota(), 20); continue; }
        delMes.forEach((a, i) => exDato(h, [exFecha(a.fecha), exTxt(a.titulo), exTxt(a.hora), exTxt(a.sede), exPart(a.participantes), exMayus1(a.logro)], i % 2 === 1, [0, 2]));
    }
    h.fin(wb, "Programación Mensual");
}

/* ---------- Hoja 11: Directorio DIRECA (sub-bloques por categoría) ---------- */
function exValorDirectorio(r, campo) {
    if (campo === "departamento") return exTxt(r.departamento || r.institucion);
    if (campo === "oficina") return exTxt(r.oficina || r.oficinaSupervision);
    if (campo === "telefono" || campo === "movil") return exTel(r[campo]);
    if (campo === "correo") return exCorreos(r.correo);
    return exTxt(r[campo]);
}
function exHojaDirectorio(wb, dir, anio, version) {
    const categorias = ["Directorio Telefónico DIRECA", "Telefonía Fija", "Asesoría Pedagógica", "Supervisiones Escolares", "Circuitos"];
    const n = Math.max.apply(null, categorias.map(c => CATEGORIAS_DIRECTORIO[c].columnas.length));
    const h = exHoja(n);
    exBanner(h, anio, version, "DIRECTORIO TELEFÓNICO INSTITUCIONAL");
    let hubo = false;
    categorias.forEach(cat => {
        const regs = dir.filter(r => r.categoria === cat && !registroDIRECAExcluido(r));
        if (!regs.length) return;
        hubo = true;
        const cols = CATEGORIAS_DIRECTORIO[cat].columnas;
        h.completa(cat.toUpperCase() + "  ·  " + regs.length + (regs.length === 1 ? " registro" : " registros"), exEstSubDorado(), 22);
        // La última columna del bloque absorbe las columnas sobrantes (cuadrícula uniforme).
        const conSpan = (arr, mk) => arr.map((x, i) => Object.assign(mk(x, i), i === arr.length - 1 && n - arr.length > 0 ? { span: n - arr.length + 1 } : {}));
        h.spans(conSpan(cols, c => ({ v: c.etiqueta, est: exEstEncabezado(), tope: 16 })), 30);
        const ord = regs.slice().sort((a, b) => cat === "Directorio Telefónico DIRECA"
            ? (parseInt(String(a.extension).replace(/\D/g, ""), 10) || 0) - (parseInt(String(b.extension).replace(/\D/g, ""), 10) || 0)
            : exCmp(exValorDirectorio(a, cols[0].campo), exValorDirectorio(b, cols[0].campo)));
        ord.forEach((r, i) => {
            h.spans(conSpan(cols, c => ({ v: exValorDirectorio(r, c.campo), est: exEstDato(i % 2 === 1, c.campo === "extension" || c.campo === "telefono") })));
        });
        h.completa("", exEstilo({}), 10);
    });
    if (!hubo) {
        h.spans([{ v: "Sin registros", span: n, est: exEstEncabezado() }], 24);
        h.completa("No hay registros del directorio institucional disponibles.", exEstNota(), 26);
    }
    h.fin(wb, "Directorio DIRECA");
}

/* ---------- Hoja 12: Centros Educativos ---------- */
function exHojaCentros(wb, dir, anio, version) {
    const enc = ["Circuito", "Código Presupuestario", "Institución / Centro Educativo", "Tipo de Dirección", "Director(a)", "Teléfono", "Móvil", "Correo Electrónico"];
    const regs = dir.filter(r => r.categoria === "Centros Educativos por Circuitos Escolares");
    const idx = c => { const i = EXC_ORDEN_CIRCUITOS.indexOf(c); return i === -1 ? 99 : i; };
    const ord = regs.slice().sort((a, b) => idx(a.circuito) - idx(b.circuito) || exCmp(a.institucion || a.departamento, b.institucion || b.departamento));
    const h = exHoja(enc.length);
    exBanner(h, anio, version, "CENTROS EDUCATIVOS POR CIRCUITOS ESCOLARES");
    exEncabezados(h, enc);
    if (!ord.length) { h.completa("No hay centros educativos registrados en el directorio.", exEstNota(), 26); h.fin(wb, "Centros Educativos"); return; }
    let circ = null, i = 0;
    ord.forEach(r => {
        if (r.circuito !== circ) { circ = r.circuito; h.completa((exTxt(circ) || "Sin circuito").toUpperCase(), exEstSubDorado(), 22); i = 0; }
        exDato(h, [exTxt(r.circuito), exTxt(r.codigoPresupuestario), exTxt(r.institucion || r.departamento), exTxt(r.tipoDireccion), exTxt(r.funcionario), exTel(r.telefono), exTel(r.movil), exCorreos(r.correo)], i % 2 === 1, [1, 5, 6]);
        i++;
    });
    h.fin(wb, "Centros Educativos");
}

/* ---------- Registros históricos y cascada de CTP y Técnicos ---------- */
function exFilaCTP(a) {
    if (a.subopcion) {
        return [
            exTxt(a.opcion), exTxt(a.subopcion),
            exTxt(a.nivel3 || a.bimensual),
            exTxt(a.actividad || a.periodoPruebas),
            exFecha(a.fecha || a.entregaDocentes),
            exFecha(a.entregaPlataforma || a.fechaFin)
        ];
    }
    // Registro histórico (anterior a la cascada de 3 niveles).
    return [
        exTxt(a.opcion) || "Registro histórico", exTxt(a.modalidad), exTxt(a.centro),
        exTxt(a.titulo), exFecha(a.fecha), exFecha(a.fechaFin)
    ];
}

/* ---------- Hoja adicional: Comisiones (integrantes y cargos) ---------- */
function exHojaComisiones(wb, comisiones, anio, version) {
    const encabezados = ["Tipo", "Comisión / Grupo", "N.°", "Funcionario", "Puesto", "Correo electrónico"];
    const h = exHoja(encabezados.length, [20, 38, 8, 34, 34, 38]);
    exBanner(h, anio, version, "EQUIPOS, COMITÉS Y GRUPOS DE APOYO");
    exEncabezados(h, encabezados);
    if (!comisiones || !comisiones.length) {
        exSinRegistros(h, anio);
        h.fin(wb, "Comisiones");
        return;
    }
    const tipos = ["Equipo / Comité", "Grupo de apoyo"];
    let zebra = 0;
    tipos.forEach(tipo => {
        const grupo = comisiones.filter(c => c.tipo === tipo).sort((a, b) => exCmp(a.nombre, b.nombre));
        if (!grupo.length) return;
        h.completa(tipo === "Equipo / Comité" ? "EQUIPOS / COMITÉS" : "GRUPOS DE APOYO", exEstSubDorado(), 23);
        grupo.forEach(comision => {
            const miembros = Array.isArray(comision.miembros) ? comision.miembros : [];
            if (!miembros.length) {
                exDato(h, [tipo, exTxt(comision.nombre), 0, "Sin integrantes registrados", "", ""], zebra++ % 2 === 1, [2]);
                return;
            }
            miembros.forEach((m, i) => {
                exDato(h, [tipo, exTxt(comision.nombre), i + 1, exTxt(m.funcionario), exTxt(m.puesto), exTxt(m.correo)], zebra++ % 2 === 1, [2]);
            });
        });
    });
    h.fin(wb, "Comisiones");
}

/* ---------- Acción del botón del Panel de Control ---------- */
function exportarProgramacionAnual() {
    if (!window.XLSX || !XLSX.utils || !XLSX.writeFile) { showToast("La librería de Excel no está cargada.", "danger"); return; }
    const anio = dashAnio || parseInt(config.anio, 10) || new Date().getFullYear();
    const version = exTxt(config.version) || "Vs.001";
    // Visibilidad: actividadesVisibles()/directorioVisible() ya distinguen Administrador
    // (todo) de Modo Lectura (solo «publicada» y solo si config.publicado !== false).
    const delAnio = actividadesVisibles().filter(a => anioDeFecha(exFechaPrincipal(a)) === anio);
    const dir = directorioVisible().filter(r => !registroDIRECAExcluido(r));
    const comisionesExportables = listaComisionesActual();
    if (!delAnio.length && !dir.length && !comisionesExportables.length) {
        showToast("No hay información registrada para el año " + anio + ".", "warning");
        return;
    }
    try {
        const de = id => delAnio.filter(a => a.modulo === id);
        const ordenadas = id => de(id).sort(exOrdenFecha);
        const wb = XLSX.utils.book_new();

        const conteos = Object.values(MODULOS).filter(m => m.coleccion === COLECCIONES.actividades)
            .map(m => ({ titulo: m.titulo, cantidad: de(m.id).length }));
        exHojaPortada(wb, anio, version, conteos, delAnio.length, dir.length);

        exHojaSimple(wb, "Celebrativos", MODULOS.celebrativos.titulo,
            ["Tipo (Día / Semana)", "Fecha Inicio", "Fecha Finalización", "Actividad / Efeméride", "Circuito", "Observaciones"],
            ordenadas("celebrativos").map(a => [a.tipo === "Día Celebrativo" ? "Día" : exTxt(a.tipo), exFecha(a.fecha), exFecha(a.fechaFin), exTxt(a.titulo), exTxt(a.circuito), exTxt(a.descripcion)]),
            [0, 1, 2], anio, version);

        exHojaSimple(wb, "Ferias y Festivales", MODULOS.ferias_festivales.titulo,
            ["Tipo de Evento", "Fecha Inicio", "Fecha Finalización", "Actividad", "Etapa", "Circuito", "Sede", "Hora", "Participantes"],
            ordenadas("ferias_festivales").map(a => [exTxt(a.tipo), exFecha(a.fecha), exFecha(a.fechaFin), exTxt(a.titulo), exTxt(a.etapa), exTxt(a.circuito), exTxt(a.sede), exTxt(a.hora), exPart(a.participantes)]),
            [1, 2, 7], anio, version);

        exHojaSimple(wb, "Pruebas Académicas", MODULOS.pruebas_academicas.titulo,
            ["Modalidad", "Período", "Prueba / Actividad", "Fecha Inicio", "Fecha Finalización", "Circuito", "Sede", "Participantes", "Observaciones"],
            ordenadas("pruebas_academicas").map(a => [exTxt(a.modalidad), exTxt(a.periodo), exTxt(a.titulo), exFecha(a.fecha), exFecha(a.fechaFin), exTxt(a.circuito), exTxt(a.sede), exPart(a.participantes), exTxt(a.descripcion)]),
            [1, 3, 4], anio, version);

        exHojaSimple(wb, "Pruebas Estandarizadas", MODULOS.pruebas_estandarizadas.titulo,
            ["Etapa", "Nivel / Población", "Prueba", "Fecha Inicio", "Fecha Finalización", "Hora", "Sede", "Circuito", "Participantes"],
            ordenadas("pruebas_estandarizadas").map(a => [exTxt(a.etapa), exTxt(a.nivel), exTxt(a.titulo), exFecha(a.fecha), exFecha(a.fechaFin), exTxt(a.hora), exTxt(a.sede), exTxt(a.circuito), exPart(a.participantes)]),
            [3, 4, 5], anio, version);

        exHojaDeportivos(wb, de("deportivos"), anio, version);

        exHojaSimple(wb, "CTP y Técnicos", MODULOS.ctp_tecnicos.titulo,
            ["Opción", "Nivel de Pruebas", "Sub-opción / Bimensual", "Actividad / Periodo de Pruebas", "Fecha / Entrega Docentes", "Entrega Plataforma / Fin"],
            ordenadas("ctp_tecnicos").map(exFilaCTP),
            [4, 5], anio, version);

        exHojaSimple(wb, "Permanencia", MODULOS.permanencia.titulo,
            ["Fecha Inicio", "Fecha Finalización", "Componente / Estrategia", "Actividad", "Hora", "Sede", "Responsable", "Participantes"],
            ordenadas("permanencia").map(a => [exFecha(a.fecha), exFecha(a.fechaFin), exTxt(a.estrategia), exTxt(a.titulo), exTxt(a.hora), exTxt(a.sede), exTxt(a.responsable), exPart(a.participantes)]),
            [0, 1, 4], anio, version);

        exHojaSimple(wb, "Oferta Formativa", MODULOS.oferta_formativa.titulo,
            ["Mes", "Fecha", "Actividad", "Hora", "Sede", "Participantes", "Facilitador / Responsable"],
            ordenadas("oferta_formativa").map(a => [MESES[(parseInt(String(a.fecha).slice(5, 7), 10) || 1) - 1], exFecha(a.fecha), exTxt(a.titulo), exTxt(a.hora), exTxt(a.sede), exPart(a.participantes), exTxt(a.facilitador || a.responsable)]),
            [0, 1, 3], anio, version);

        exHojaMensual(wb, de("programacion_mensual"), anio, version);
        exHojaComisiones(wb, comisionesExportables, anio, version);
        exHojaDirectorio(wb, dir, anio, version);
        exHojaCentros(wb, dir, anio, version);

        const archivo = "DREC_" + anio + "_Programacion_Anual_" + version.replace(/[^\w.\-]+/g, "_") + ".xlsx";
        XLSX.writeFile(wb, archivo);
        showToast("Archivo «" + archivo + "» generado con " + wb.SheetNames.length + " hojas.", "success");
    } catch (e) {
        console.error("Error generando la exportación anual:", e);
        showToast("No se pudo generar el Excel: " + (e && e.message ? e.message : e), "danger");
    }
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
    // Confirmación personalizada, protección de formularios y chips de participantes.
    inicializarConfirmacion();
    inicializarProteccionFormularios();
    inicializarChipsParticipantes();
    // Escape: cierra primero la confirmación abierta; luego el modal activo (con
    // protección de cambios sin guardar); si no hay ninguno, el menú móvil.
    document.addEventListener("keydown", manejarTeclaGlobal);
});

/* ==================== GESTIÓN DE COMISIONES · DOCUMENTO M.2 ==================== */
let tipoComisionActivo = "Equipo / Comité";
function listaComisionesActual() {
    return COMISIONES_OFICIALES.map(oficial => {
        const doc = dbComisiones.find(x => x.id === oficial.id) || {};
        return Object.assign({}, oficial, doc, {
            miembros: Array.isArray(doc.miembros) ? doc.miembros : []
        });
    });
}
function iconoComision(comision) {
    if (comision.tipo === "Grupo de apoyo") return "handshake";
    const id = String(comision.id || "").toLowerCase();
    if (/emergencia|salud/.test(id)) return "heart-pulse";
    if (/steam|robotica|feria-cientifica|olimpiadas/.test(id)) return "flask-conical";
    if (/ambiente|bandera-azul/.test(id)) return "leaf";
    if (/deportivos/.test(id)) return "trophy";
    return "users-round";
}
function cambiarTipoComision(tipo) {
    tipoComisionActivo = tipo;
    const disponibles = listaComisionesActual().filter(c => c.tipo === tipo);
    if (disponibles.length && !disponibles.some(c => c.id === comisionActiva)) {
        comisionActiva = disponibles[0].id;
        miembroEditando = null;
    }
    renderComisiones();
}
function filtrarComisiones(valor) {
    const q = normalize(valor || "");
    document.querySelectorAll("#comisionesApp .comision-opcion").forEach(el => {
        el.hidden = q !== "" && !normalize(el.dataset.nombre || "").includes(q);
    });
    const visibles = Array.from(document.querySelectorAll("#comisionesApp .comision-opcion")).some(el => !el.hidden);
    const vacio = $("comisionesSinCoincidencias");
    if (vacio) vacio.classList.toggle("hidden", visibles);
}
function renderComisiones() {
    const root = $("comisionesApp");
    if (!root) return;
    const lista = listaComisionesActual();
    if (!lista.length) {
        root.innerHTML = '<div class="card p-6 text-sm text-slate-500">No hay comisiones configuradas.</div>';
        return;
    }
    let c = lista.find(x => x.id === comisionActiva) || lista[0];
    if (!lista.some(x => x.id === comisionActiva)) comisionActiva = c.id;
    tipoComisionActivo = c.tipo || tipoComisionActivo;
    const admin = esAdmin();
    const equipos = lista.filter(x => x.tipo === "Equipo / Comité");
    const grupos = lista.filter(x => x.tipo === "Grupo de apoyo");
    const totalTipo = tipo => lista.filter(x => x.tipo === tipo).length;
    const tarjetas = lista.filter(x => x.tipo === tipoComisionActivo).map(item => {
        const activo = item.id === c.id;
        return `<button type="button" class="comision-opcion ${activo ? "activa" : ""}" data-nombre="${esc(item.nombre)}" aria-selected="${activo ? "true" : "false"}" role="option" onclick="seleccionarComision('${esc(item.id)}')">
            <span class="comision-opcion-icono"><i data-lucide="${iconoComision(item)}"></i></span>
            <span class="comision-opcion-texto"><span class="comision-opcion-nombre">${esc(item.nombre)}</span><span class="comision-opcion-meta">${item.miembros.length} ${item.miembros.length === 1 ? "integrante" : "integrantes"}</span></span>
            <span class="comision-conteo" aria-label="${item.miembros.length} integrantes">${item.miembros.length}</span>
            ${activo ? '<i data-lucide="check-circle-2" class="comision-opcion-check" aria-hidden="true"></i>' : ""}
        </button>`;
    }).join("");
    const filas = c.miembros.map((m, i) => `<tr class="comision-miembro-fila">
        <td class="p-3 text-xs text-slate-400" data-label="N.°">${i + 1}</td>
        <td class="p-3 text-sm font-bold text-slate-800" data-label="Funcionario">${esc(m.funcionario || "")}</td>
        <td class="p-3 text-sm text-slate-600" data-label="Puesto">${esc(m.puesto || "")}</td>
        <td class="p-3 text-sm" data-label="Correo"><a class="text-mep-blue hover:underline break-all" href="mailto:${esc(m.correo || "")}">${esc(m.correo || "")}</a></td>
        ${admin ? `<td class="p-3 text-right whitespace-nowrap" data-label="Acciones"><button type="button" class="accion-btn accion-editar" onclick="editarMiembroComision(${i})" aria-label="Editar a ${esc(m.funcionario || "integrante")}" title="Editar"><i data-lucide="pencil"></i></button><button type="button" class="accion-btn accion-borrar" onclick="eliminarMiembroComision(${i})" aria-label="Eliminar a ${esc(m.funcionario || "integrante")}" title="Eliminar"><i data-lucide="trash-2"></i></button></td>` : ""}
    </tr>`).join("");
    const progreso = Math.min(100, Math.round((c.miembros.length / 9) * 100));
    root.innerHTML = `<div class="comisiones-layout">
        <aside class="comisiones-panel card">
            <div class="comisiones-panel-heading"><span class="comisiones-eyebrow">DIRECTORIO DE COMISIONES</span><h3>Seleccione una comisión</h3><p>Elija primero el tipo y después el equipo que desea consultar.</p></div>
            <div class="comisiones-segmentos" role="tablist" aria-label="Tipo de comisión">
                <button type="button" role="tab" id="tabEquiposComision" aria-selected="${tipoComisionActivo === "Equipo / Comité"}" class="comision-segmento ${tipoComisionActivo === "Equipo / Comité" ? "activo" : ""}" onclick="cambiarTipoComision('Equipo / Comité')"><i data-lucide="users-round"></i><span>Equipos / Comités</span><b>${totalTipo("Equipo / Comité")}</b></button>
                <button type="button" role="tab" id="tabGruposComision" aria-selected="${tipoComisionActivo === "Grupo de apoyo"}" class="comision-segmento ${tipoComisionActivo === "Grupo de apoyo" ? "activo" : ""}" onclick="cambiarTipoComision('Grupo de apoyo')"><i data-lucide="handshake"></i><span>Grupos de apoyo</span><b>${totalTipo("Grupo de apoyo")}</b></button>
            </div>
            <label class="comisiones-busqueda-label" for="buscarComision">Buscar por nombre</label>
            <div class="comisiones-busqueda"><i data-lucide="search" aria-hidden="true"></i><input id="buscarComision" type="search" autocomplete="off" placeholder="Escriba para filtrar..." oninput="filtrarComisiones(this.value)" aria-label="Buscar comisión por nombre"></div>
            <div class="comisiones-lista" role="listbox" aria-label="Comisiones disponibles">${tarjetas || '<p class="text-sm text-slate-500 p-3">No hay comisiones en esta categoría.</p>'}</div>
            <p id="comisionesSinCoincidencias" class="hidden comisiones-vacio">No se encontraron comisiones con ese nombre.</p>
            <div class="comisiones-referencia"><div class="comisiones-referencia-top"><span>MIEMBROS REGISTRADOS</span><strong>${c.miembros.length} <small>/ 9</small></strong></div><div class="comisiones-progreso" role="progressbar" aria-label="Integrantes respecto a la referencia de 9" aria-valuemin="0" aria-valuemax="9" aria-valuenow="${c.miembros.length}"><span style="width:${progreso}%"></span></div><p>${c.miembros.length >= 9 ? "Se alcanzó la referencia" : "Promedio de referencia: 9 miembros por comisión"}</p></div>
        </aside>
        <div class="comisiones-contenido">
            <section class="comision-encabezado card"><div class="comision-encabezado-icono"><i data-lucide="${iconoComision(c)}"></i></div><div class="min-w-0"><span class="comision-tipo-etiqueta">${esc(c.tipo)}</span><h3>${esc(c.nombre)}</h3><p>${c.miembros.length} ${c.miembros.length === 1 ? "integrante registrado" : "integrantes registrados"}</p></div></section>
            <section class="card comision-integrantes"><div class="comision-seccion-titulo"><div><span class="comisiones-eyebrow">INTEGRACIÓN ACTUAL</span><h4>Integrantes</h4></div><span class="comision-total-pill">${c.miembros.length} ${c.miembros.length === 1 ? "persona" : "personas"}</span></div>
                <div class="overflow-x-auto"><table class="tabla comision-tabla min-w-full"><thead><tr><th class="p-3">#</th><th class="p-3">Funcionario</th><th class="p-3">Puesto</th><th class="p-3">Correo electrónico</th>${admin ? '<th class="p-3 text-right">Acciones</th>' : ""}</tr></thead><tbody>${filas || `<tr><td colspan="${admin ? 5 : 4}" class="p-8 text-center text-sm text-slate-400">No hay miembros registrados en esta comisión.</td></tr>`}</tbody></table></div>
            </section>
            ${admin ? `<form class="card comision-formulario" onsubmit="guardarMiembroComision(event)"><div class="comision-formulario-heading"><div><span class="comisiones-eyebrow">GESTIÓN DE INTEGRANTES</span><h4>${miembroEditando === null ? "Agregar nuevo miembro" : "Editar miembro"}</h4><p>Complete los datos del funcionario y su responsabilidad.</p></div><button type="button" class="btn-suave comision-limpiar" onclick="cancelarEdicionComision()"><i data-lucide="rotate-ccw"></i> Limpiar</button></div><div class="comision-campos"><label for="cmFuncionario">Funcionario <span>*</span><input id="cmFuncionario" class="campo" required maxlength="160" autocomplete="name" placeholder="Nombre completo"></label><label for="cmPuesto">Puesto en la comisión <span>*</span><input id="cmPuesto" class="campo" required maxlength="120" placeholder="Cargo o responsabilidad"></label><label for="cmCorreo">Correo electrónico <span>*</span><input id="cmCorreo" type="email" class="campo" required maxlength="180" autocomplete="email" placeholder="nombre@dominio.go.cr"></label></div><div class="comision-formulario-acciones"><p><span>*</span> Campos obligatorios</p><button class="btn-mep-primary px-5 py-3 rounded-2xl text-xs font-bold" type="submit"><i data-lucide="${miembroEditando === null ? "user-plus" : "save"}"></i>${miembroEditando === null ? "Agregar miembro" : "Guardar cambios"}</button></div></form>` : '<p class="comision-solo-lectura"><i data-lucide="eye"></i> Modo de solo lectura. Inicie sesión como administrador para gestionar integrantes.</p>'}
        </div>
    </div>`;
    crearIconos();
}
function seleccionarComision(id) {
    comisionActiva = id;
    const elegida = listaComisionesActual().find(x => x.id === id);
    if (elegida) tipoComisionActivo = elegida.tipo;
    miembroEditando = null;
    renderComisiones();
}
function editarMiembroComision(i) {
    if (!esAdmin()) return;
    miembroEditando = i;
    renderComisiones();
    const c = listaComisionesActual().find(x => x.id === comisionActiva);
    const m = c && c.miembros[i];
    if (!m) return;
    $("cmFuncionario").value = m.funcionario || "";
    $("cmPuesto").value = m.puesto || "";
    $("cmCorreo").value = m.correo || "";
    $("cmFuncionario").focus();
}
function cancelarEdicionComision() {
    miembroEditando = null;
    renderComisiones();
}
async function persistirMiembrosComision(miembros) {
    if (!esAdmin()) return;
    const c = listaComisionesActual().find(x => x.id === comisionActiva);
    if (!c) throw new Error("No se encontró la comisión seleccionada.");
    if (firebaseDB && !MODO_DEMO) {
        await firebaseDB.collection(COLECCIONES.comisiones).doc(c.id).set({
            nombre: c.nombre,
            tipo: c.tipo,
            miembros,
            actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } else {
        dbComisiones = dbComisiones.length ? dbComisiones : COMISIONES_OFICIALES.map(x => Object.assign({}, x, { miembros: [] }));
        dbComisiones = dbComisiones.map(x => x.id === c.id ? Object.assign({}, x, { miembros }) : x);
        persistirDemo();
    }
}
async function guardarMiembroComision(e) {
    e.preventDefault();
    if (!esAdmin()) return;
    const m = {
        funcionario: $("cmFuncionario").value.trim(),
        puesto: $("cmPuesto").value.trim(),
        correo: $("cmCorreo").value.trim()
    };
    if (!m.funcionario || !m.puesto || !m.correo) return;
    const c = listaComisionesActual().find(x => x.id === comisionActiva);
    if (!c) return;
    const arr = c.miembros.slice();
    if (miembroEditando === null) arr.push(m);
    else arr[miembroEditando] = m;
    try {
        await persistirMiembrosComision(arr);
        miembroEditando = null;
        showToast("Miembro guardado correctamente.", "success");
        renderComisiones();
    } catch (err) {
        console.error(err);
        showToast("No se pudo guardar el miembro en Firestore.", "danger");
    }
}
async function eliminarMiembroComision(i) {
    if (!esAdmin() || !confirm("¿Desea eliminar este miembro?")) return;
    const c = listaComisionesActual().find(x => x.id === comisionActiva);
    if (!c) return;
    const arr = c.miembros.filter((_, n) => n !== i);
    try {
        await persistirMiembrosComision(arr);
        showToast("Miembro eliminado.", "success");
        renderComisiones();
    } catch (err) {
        console.error(err);
        showToast("No se pudo eliminar el miembro.", "danger");
    }
}