# FerroTrack

Sistema de vigilancia longitudinal del estado del hierro. Anónimo por
construcción, sin servidor, publicado como sitio estático en GitHub Pages.

No responde «¿hay anemia?». Responde algo más útil y más difícil: **qué está
pasando con el hierro a lo largo del tiempo**, incluso cuando la hemoglobina se
ve bien.

---

## El problema que resuelve

Dos análisis de la misma persona, con dos meses de diferencia:

| Indicador                 | 27 jun 2026 | 15 ago 2026 |        |
| ------------------------- | ----------: | ----------: | ------ |
| Hemoglobina (g/dL)        |        12,1 |    **12,8** | ↑      |
| Ferritina (ng/mL)         |           7 |       **8** | ↑      |
| Hierro sérico (µg/dL)     |        32,2 |    **25,5** | ↓      |
| Saturación transferrina % |        7,21 |    **5,62** | ↓      |
| RDW-CV (%)                |        15,6 |    **17,2** | ↑      |

Mirando solo la hemoglobina, esto es una buena noticia. Mirando el conjunto, la
fábrica de glóbulos rojos está trabajando más rápido de lo que llega el
material: sube la hemoglobina mientras cae la disponibilidad de hierro y sube la
dispersión del tamaño celular.

Ese patrón es el que un PDF suelto no muestra y una app de «nivel de hierro»
tampoco. FerroTrack lo detecta, lo nombra y explica en qué se basó.

---

## Principios

**1. El caso no tiene identidad.** No hay nombre, documento, dirección ni
contacto. Cada seguimiento es un caso anónimo con un código generado al azar
(`FE-2026-A7K92`). El anonimizador corre **antes** que el lector de resultados:
lo que no se remueve, no entra.

**2. Nada de un solo número.** El metabolismo del hierro tiene compartimentos
que se mueven a distinta velocidad. El índice global existe solo para seguir la
evolución, y siempre se muestra descompuesto en sus ejes.

**3. Las reglas son datos, no código.** Cada umbral vive en un archivo
versionado con su fuente y su fecha. Cada conclusión declara qué regla la
produjo. Si la OMS cambia un punto de corte en 2028, se cambia el archivo, y los
análisis viejos siguen diciendo con qué versión fueron interpretados.

**4. La IA no diagnostica.** El motor clínico es determinista y auditable.

**5. Se cuenta el hierro que entra, no el de la etiqueta.** De las lentejas se
absorbe un 2 %; del hígado, un 25 %; y un vaso de té al lado borra la mitad de
lo que se comió.

---

## Qué hace

### Núcleo clínico

- **Lectura de informes.** Se pega el texto de un PDF de cualquier laboratorio.
  El sistema reconoce cada examen por su nombre, lo identifica por **LOINC**,
  convierte las unidades a la unidad canónica **UCUM**, recupera el rango que
  informó el laboratorio y, si el informe trae la columna del control anterior,
  la guarda también como un análisis propio — así hay comparación desde el
  primer día.
- **Anonimización verificable.** Nombre, documento, teléfono, colegiatura,
  dirección y números de orden se remueven y se reportan uno por uno. Los
  patrones están ajustados para no destruir resultados: `HC` sin puntos vive
  dentro de `HCM`, y esa clase de detalle está cubierta por pruebas.
- **Motor longitudinal.** Diferencia, porcentaje, velocidad por mes, tendencia
  por regresión sobre la serie y proyección al objetivo con su margen.
- **Motor de reglas.** Nueve patrones clínicos, alertas de seguridad, y un
  módulo de «qué análisis podría faltar» que avisa, por ejemplo, que sin un
  marcador de inflamación la ferritina baja se lee con menos certeza.
- **Umbrales por contexto.** Hemoglobina según edad, sexo y gestación
  (OMS 2024), **ajustada por altitud**. Ferritina según edad y según haya o no
  inflamación documentada (OMS 2020).
- **Índice de Recuperación del Hierro.** Cinco ejes — reservas, disponibilidad,
  hemograma, nutrición y adherencia — cada uno con su fórmula visible.

### Motor nutricional

- **Modelo de absorción** basado en el algoritmo de Hallberg y Hulthén (2000):
  hierro hemo y no hemo, fitatos, polifenoles, calcio, vitamina C, proteína
  animal y estado de las reservas.
- **Catálogo de 85 alimentos** de la canasta peruana, con los tres factores que
  ninguna API publica: fracción de hemo, fitatos y polifenoles.
- **Constructor de platos** con puntuación de compatibilidad y sugerencias
  calculadas probando el cambio, no adivinándolo.
- **Planificador adaptado al horario real**: colegio, recreos, desayuno rápido o
  en ayuno, almuerzo, entre comida y cena. Todo configurable.
- **Proyección a corto, mediano y largo plazo**, con déficit total estimado por
  la fórmula de Ganzoni — y con la parte que la gente realmente pregunta: cómo
  se sentiría en dos semanas, dos meses y seis meses.

### Cómo se adapta el plan al horario

El horario no es decoración: de él salen los momentos de comida y el peso de
cada uno en el aporte del día.

- Si el desayuno no entra antes de la hora de entrada, **se adelanta solo** y lo
  dice.
- En modo ayuno, **el primer recreo pasa a ser la primera comida** y carga más
  peso.
- En los recreos solo entran cosas que caben en una lonchera y se comen de pie.
- Los lácteos, el té y el café se agrupan en el momento reservado para ellos,
  lejos de las comidas con hierro.
- Si el almuerzo y la cena quedan a menos de cuatro horas, **se reparte la
  carga**.
- A una menestra no la acompaña otro alimento cargado de fitatos: el plan
  prefiere papa o arroz antes que quinua, porque cambia el rendimiento del plato
  más que el plato mismo.
- Si una comida rinde por debajo del 12 %, el planificador la corrige — con el
  **arreglo mínimo suficiente**, no metiendo vísceras en cada plato.

### Ferrín

Un consejero con forma de gota de sangre que celebra, anima y explica trucos de
cocina. Nunca da indicaciones médicas ni habla de dosis, y nunca miente para
motivar: si un indicador bajó, lo dice.

---

## Estructura

```
site/                     el sitio publicado (sin build, sin dependencias)
  index.html
  css/ferrotrack.css      sistema de diseño
  data/
    analytes.json         diccionario LOINC + UCUM
    rules.2026-08.json    base de reglas clínicas versionada
    foods.json            catálogo de alimentos (generado)
  js/
    core/                 store · anonymize · parser · longitudinal · rules · score
    nutrition/            absorption · schedule · planner · projection · live
    ui/                   dom · charts · diagrams · coach
    views/                clinical · nutrition · settings
    app.js                enrutado y arranque
scripts/build_food_db.py  genera el catálogo; opcionalmente desde USDA FDC
tests/                    46 pruebas unitarias + prueba de humo en navegador
.github/workflows/
  pages.yml               pruebas y despliegue a GitHub Pages
  nutricion.yml           actualización semanal del catálogo, vía pull request
```

---

## Desarrollo

```bash
npm test                  # motor clínico y nutricional
npm run serve             # http://127.0.0.1:8099
npm run smoke             # recorrido completo en navegador real
npm run datos             # regenerar el catálogo de alimentos
FDC_API_KEY=xxx npm run datos:online
```

No hay paso de compilación. El sitio son módulos ES que el navegador carga
directamente; `site/` se puede publicar tal cual.

---

## Publicar en GitHub Pages

En **Settings → Pages**, elegir *GitHub Actions* como origen. El flujo
`pages.yml` corre las pruebas y la prueba de humo antes de desplegar; si algo
falla, no publica.

---

## Datos de nutrición en tiempo real

Un sitio estático no tiene servidor que consulte fuentes externas, así que la
actualización ocurre en dos caminos:

1. **El flujo semanal** (`nutricion.yml`) corre con red abierta, consulta USDA
   FoodData Central, regenera el catálogo y abre un pull request con la
   diferencia. Es el camino fiable: queda versionado y revisable.
2. **La consulta en vivo** desde el navegador, si la persona configura su propia
   clave de la API. Sirve para comprobar un alimento puntual sin esperar al
   siguiente ciclo.

En ambos casos, los factores de absorción del seed quedan intactos.

---

## Fuentes

- OMS — *Guideline on haemoglobin cutoffs to define anaemia in individuals and
  populations* (2024)
- OMS — *WHO guideline on use of ferritin concentrations to assess iron status*
  (2020)
- Hallberg L, Hulthén L. *Prediction of dietary iron absorption: an algorithm
  for calculating absorption and bioavailability of dietary iron.*
  Am J Clin Nutr 2000;71:1147-60
- NIH Office of Dietary Supplements — *Iron Fact Sheet for Health Professionals*
- Tablas Peruanas de Composición de Alimentos — CENAN / Instituto Nacional de
  Salud
- USDA FoodData Central (SR Legacy / Foundation Foods)
- Sistema de diagramas editoriales inspirado en
  [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design)

---

## Advertencia

Esta aplicación **no reemplaza la evaluación médica**. Describe patrones y
estima escenarios; no diagnostica ni indica tratamientos. Los resultados e
interpretaciones son orientativos y deben ser validados por un profesional de la
salud.
