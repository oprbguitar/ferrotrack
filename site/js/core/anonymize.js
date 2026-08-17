/**
 * Detector y removedor de datos personales.
 *
 * Se ejecuta ANTES que cualquier otra cosa sobre el texto de un informe de
 * laboratorio. Lo que este módulo no reconoce, no entra al historial: el parser
 * solo recibe el texto ya tachado.
 *
 * Los patrones están deliberadamente ajustados: un patrón laxo no solo tacha
 * datos personales, también destruye resultados. "HC" sin puntos, por ejemplo,
 * aparece dentro de "HCM" (hemoglobina corpuscular media), así que se exige la
 * forma con puntos. Las pruebas de tests/parser.test.mjs verifican que ningún
 * analito del hemograma se pierda al anonimizar.
 */

const REDACTED = '‹dato personal removido›';

/**
 * Cada regla puede tachar toda la coincidencia o solo un grupo de captura,
 * de modo que la etiqueta del campo sobreviva y el informe siga siendo legible.
 */
const PATTERNS = [
  {
    id: 'email',
    label: 'correo electrónico',
    re: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g,
  },
  {
    id: 'documento',
    label: 'documento de identidad',
    re: /\b(DNI|D\.N\.I\.?|C\.E\.?|CARNET\s+DE\s+EXTRANJER[ÍI]A|PASAPORTE|RUC|CURP|NIF)\s*:?\s*([\w-]{6,15})\b/gi,
    group: 2,
  },
  {
    // Cadenas largas de dígitos sin decimales: en un informe de laboratorio
    // siempre son identificadores, nunca resultados.
    id: 'id_numerico',
    label: 'número identificador (8 dígitos o más)',
    re: /(?<![\d.,-])\d{8,}(?![\d.,-])/g,
  },
  {
    id: 'telefono',
    label: 'teléfono',
    re: /\b(?:tel[eé]fono|tel|telf|celular|cel|m[oó]vil|whatsapp|anexo)\s*\.?\s*:?\s*((?:\+?\d{1,3}[\s-]?)?(?:\(\d{1,4}\)[\s-]?)?[\d][\d\s-]{5,14}\d)/gi,
    group: 1,
  },
  {
    // Va antes que la regla de orden a propósito: en "Orden Externa : CMP :
    // 061457", aquella se comería la etiqueta CMP y dejaría el número al aire.
    id: 'colegiatura',
    label: 'colegiatura profesional',
    re: /\b(CMP|RNE|COP|CNP|C\.M\.P\.)\s*:?\s*(\d{3,8})\b/gi,
    group: 2,
  },
  {
    id: 'orden',
    label: 'número de orden, solicitud o historia',
    re: /\b(SOLICITUD|ORDEN(?:\s+EXTERNA)?|PREFACTURA|HISTORIA(?:\s+CL[ÍI]NICA)?|H\.C\.?|EPISODIO|AFILIACI[ÓO]N|P[ÓO]LIZA)\s*:?\s*([\w/-]{3,})/gi,
    group: 2,
  },
  {
    id: 'nombre',
    label: 'nombre de persona',
    re: /\b(PACIENTE|NOMBRES?(?:\s+Y\s+APELLIDOS)?|APELLIDOS?|SOLICITANTE|M[ÉE]DICO(?:\s+SOLICITANTE)?|DIRECTOR(?:\s+M[ÉE]DICO)?|DRA?\.)\s*:?\s*((?:[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ'’.-]+[ \t]+){1,4}[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ'’.-]+)/g,
    group: 2,
  },
  {
    // Un bloque de 3 a 5 palabras enteramente en mayúsculas y sin dígitos:
    // la firma tipográfica de un nombre propio en estos informes.
    id: 'nombre_mayusculas',
    label: 'nombre en mayúsculas',
    re: /(?<![\wÁÉÍÓÚÑ])[A-ZÁÉÍÓÚÑ]{3,}(?:[ \t]+[A-ZÁÉÍÓÚÑ]{3,}){2,4}(?![\wÁÉÍÓÚÑ])/g,
    guard: isLikelyPersonName,
  },
  {
    id: 'nacimiento',
    label: 'fecha de nacimiento',
    re: /\b(F\.?\s*NACIMIENTO|FECHA\s+DE\s+NACIMIENTO|NACIDO(?:\s+EL)?)\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/gi,
    group: 2,
  },
  {
    // Al extraer texto de un PDF, las columnas salen desordenadas y la etiqueta
    // suele quedar DESPUÉS del valor: "... : 15/11/2013 Edad: 12 Años
    // F.Nacimiento :". Sin esta variante, la fecha de nacimiento sobrevive.
    id: 'nacimiento_invertido',
    label: 'fecha de nacimiento',
    re: /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})(?=[^\n]{0,48}?F\.?\s*NACIMIENTO)/gi,
    group: 1,
  },
  {
    id: 'direccion',
    label: 'dirección',
    re: /\b(DIRECCI[ÓO]N|DOMICILIO)\s*:?\s*([^\n]{4,60})/gi,
    group: 2,
  },
  {
    id: 'direccion_via',
    label: 'dirección',
    re: /\b(?:AV\.|AVENIDA|JR\.|JIR[ÓO]N|CALLE|PASAJE|PSJE\.|MZ\.|URB\.)\s+[^\n]{4,50}/gi,
  },
];

/**
 * Vocabulario que aparece en mayúsculas en los informes y que NO es un nombre.
 * Sin esta lista, la regla de "tres palabras en mayúsculas" borraría encabezados
 * y nombres de exámenes.
 */
const NOT_A_NAME = new Set([
  'EXAMENES', 'EXAMEN', 'LABORATORIO', 'CLINICO', 'CLINICA', 'RESULTADO', 'RESULTADOS',
  'ANTERIOR', 'REFERENCIA', 'VALORES', 'METODO', 'MUESTRA', 'MUESTRAS', 'SUERO', 'SANGRE',
  'TOTAL', 'RECUENTO', 'CELULAR', 'FORMULA', 'DIFERENCIAL', 'PORCENTUAL', 'ABSOLUTA',
  'CONSTANTES', 'CORPUSCULARES', 'HEMOGLOBINA', 'HEMATOCRITO', 'HEMOGRAMA', 'FERRITINA',
  'HIERRO', 'SERICO', 'TRANSFERRINA', 'SATURACION', 'VITAMINA', 'ACIDO', 'FOLICO',
  'INMUNOBIOQUIMICA', 'HEMATOLOGIA', 'PEDIAT', 'CITOMETRIA', 'FLUJO', 'IMPEDANCIA',
  'MICROSCOPIA', 'FOTOMETRIA', 'ENFOQUE', 'HIDRODINAMICO', 'CORRIENTE', 'CONTINUA',
  'VALIDADO', 'CLINICAMENTE', 'POR', 'FECHA', 'IMPRESION', 'VALIDACION', 'CERTIFICACION',
  'ACREDITACION', 'LEUCOCITOS', 'HEMATIES', 'PLAQUETAS', 'SEGMENTADOS', 'LINFOCITOS',
  'MONOCITOS', 'EOSINOFILOS', 'BASOFILOS', 'ABASTONADOS', 'METAMIELOCITOS', 'MIELOCITOS',
  'PROMIELOCITOS', 'BLASTOS', 'GRANULOCITOS', 'INMADUROS', 'SUMATORIA', 'VOLUMEN',
  'PLAQUETARIO', 'MEDIO', 'MASCULINO', 'FEMENINO', 'ADULTOS', 'NINOS', 'AÑOS', 'ANOS',
  'MESES', 'EDAD', 'SEXO', 'PRIORIDAD', 'RUTINA', 'PROCEDENCIA', 'LUGAR', 'TOMA',
  'RECEPCION', 'INGRESO', 'TIPO', 'UNIDAD', 'DIRECTOR', 'MEDICO', 'PATOLOGO', 'CRITICO',
  'VALOR', 'COMENTARIO', 'SEGUN', 'CONSIDERA', 'SIN', 'ANEMIA', 'MUJERES', 'VARONES',
  'EMBARAZADAS', 'MAYOR', 'IGUAL', 'PAGINA', 'INFORME', 'ORDEN', 'EXTERNA', 'SOLICITUD',
]);

function isLikelyPersonName(match) {
  const words = match.trim().split(/[ \t]+/);
  if (words.length < 3) return false;
  // Si alguna palabra pertenece al vocabulario del informe, no es un nombre.
  return !words.some((w) => NOT_A_NAME.has(w.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
}

/**
 * Analiza un texto y devuelve el texto anonimizado junto con el detalle de lo
 * que se removió, para que la persona pueda verificar que nada se filtró.
 */
export function anonymizeText(input) {
  let text = String(input || '');
  const found = [];

  for (const rule of PATTERNS) {
    const samples = [];
    let count = 0;

    rule.re.lastIndex = 0;
    text = text.replace(rule.re, (...args) => {
      const match = args[0];
      const groups = args.slice(1, -2);

      if (rule.guard && !rule.guard(match)) return match;

      if (rule.group) {
        const target = groups[rule.group - 1];
        if (!target) return match;
        count += 1;
        if (samples.length < 2) samples.push(mask(target));
        return match.replace(target, REDACTED);
      }

      count += 1;
      if (samples.length < 2) samples.push(mask(match));
      return REDACTED;
    });

    if (count) found.push({ id: rule.id, label: rule.label, count, samples });
  }

  return { text, found, clean: found.length === 0 };
}

/** Enmascara una muestra para poder mostrarla sin revelar el dato completo. */
function mask(value) {
  const s = String(value).trim();
  if (s.length <= 4) return '••••';
  return `${s.slice(0, 2)}${'•'.repeat(Math.min(10, s.length - 4))}${s.slice(-2)}`;
}

/**
 * Extrae los pocos datos clínicos no identificatorios que sí sirven (edad y
 * sexo). Se lee del texto original, se guarda solo el resultado.
 */
export function extractSafeProfileHints(input) {
  const text = String(input || '');
  const hints = {};

  const age = text.match(/Edad\s*:?\s*(\d{1,3})\s*(a[ñn]os|meses)/i);
  if (age) {
    const n = parseInt(age[1], 10);
    hints.ageYears = /mes/i.test(age[2]) ? +(n / 12).toFixed(1) : n;
  }

  if (/\bfemenino\b/i.test(text)) hints.sex = 'female';
  else if (/\bmasculino\b/i.test(text)) hints.sex = 'male';

  if (/\bgestante\b|\bembarazad/i.test(text)) hints.pregnant = true;

  return hints;
}

/** Comprueba si un texto todavía contiene algo que parezca un dato personal. */
export function auditText(input) {
  return anonymizeText(input).found;
}
