#!/usr/bin/env python3
"""
Construye site/data/foods.json.

Dos capas:

1. SEED — tabla curada a mano, con los datos que ninguna API entrega bien:
   fraccion de hierro hemo, fitatos y polifenoles. Son los tres factores que
   deciden cuanto hierro se absorbe realmente, y sin ellos el calculo de
   biodisponibilidad no tiene sentido. Valores de composicion tomados de tablas
   publicas (Tablas Peruanas de Composicion de Alimentos - CENAN/INS, y USDA
   SR Legacy) y redondeados a la precision util para planificar comidas.

2. ENRIQUECIMIENTO EN LINEA — si hay red y una API key de USDA FoodData Central,
   se consulta cada alimento que declara `fdc` y se refrescan los nutrientes que
   la API si conoce (hierro total, vitamina C, calcio, proteina, energia, B12,
   folato, zinc). Los factores de absorcion del SEED nunca se sobrescriben.

Uso:
    python3 scripts/build_food_db.py                 # solo seed
    FDC_API_KEY=xxxx python3 scripts/build_food_db.py --online
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timezone, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data" / "foods.json"

FDC_SEARCH = "https://api.nal.usda.gov/fdc/v1/foods/search"

# Numeros de nutriente USDA -> campo interno
FDC_NUTRIENTS = {
    1089: "fe",    # Iron, Fe (mg)
    1162: "c",     # Vitamin C (mg)
    1087: "ca",    # Calcium (mg)
    1003: "pro",   # Protein (g)
    1008: "kcal",  # Energy (kcal)
    1178: "b12",   # Vitamin B-12 (ug)
    1177: "fol",   # Folate, total (ug)
    1095: "zn",    # Zinc (mg)
    1004: "fat",   # Total lipid (g)
    1005: "cho",   # Carbohydrate (g)
    1079: "fib",   # Fiber (g)
}

# ---------------------------------------------------------------------------
# SEED
# ---------------------------------------------------------------------------
# Campos por 100 g de alimento listo para comer:
#   fe   hierro total (mg)
#   heme fraccion del hierro que es hemo (0 a 1) -- solo tejido animal
#   c    vitamina C (mg)
#   ca   calcio (mg)
#   phy  fitatos (mg, como acido fitico)
#   pol  polifenoles (mg, equivalentes de acido tanico)
#   pro  proteina (g)
#   kcal energia
#   b12  vitamina B12 (ug)
#   fol  folato (ug)
#   zn   zinc (mg)
# Etiquetas: grupo, momentos del dia sugeridos, dieta, portabilidad escolar,
# costo relativo en Peru (1 economico - 3 caro) y region.

SEED = [
    # ---------------- Hierro hemo: visceras y sangre ----------------
    dict(id="sangrecita", n="Sangrecita de pollo guisada", g="visceras", fe=29.5, heme=0.85, c=0, ca=12, phy=0, pol=0,
         pro=19.0, kcal=110, b12=1.2, fol=6, zn=1.5, porc=60, pu="porcion (60 g)",
         tags=["almuerzo", "cena", "omnivoro", "economico", "peru", "estrella"], cost=1, fdc="blood sausage",
         nota="El alimento con mas hierro hemo disponible en la canasta peruana. Una porcion chica rinde muchisimo."),
    dict(id="higado_pollo", n="Hígado de pollo guisado", g="visceras", fe=11.6, heme=0.7, c=3, ca=11, phy=0, pol=0,
         pro=24.5, kcal=167, b12=16.6, fol=578, zn=3.9, porc=80, pu="porcion (80 g)",
         tags=["almuerzo", "cena", "omnivoro", "economico", "peru", "estrella"], cost=1, fdc="chicken liver cooked",
         nota="Trae hierro hemo, B12 y folato a la vez: los tres ladrillos en un solo plato."),
    dict(id="higado_res", n="Hígado de res a la plancha", g="visceras", fe=6.5, heme=0.7, c=1.9, ca=6, phy=0, pol=0,
         pro=29.0, kcal=175, b12=70.6, fol=253, zn=5.2, porc=80, pu="porcion (80 g)",
         tags=["almuerzo", "cena", "omnivoro", "economico", "peru"], cost=1, fdc="beef liver cooked"),
    dict(id="bazo", n="Bazo de res guisado", g="visceras", fe=33.0, heme=0.8, c=5, ca=12, phy=0, pol=0,
         pro=25.0, kcal=145, b12=5.4, fol=4, zn=2.7, porc=70, pu="porcion (70 g)",
         tags=["almuerzo", "cena", "omnivoro", "economico", "peru"], cost=1),
    dict(id="mollejita", n="Mollejita de pollo guisada", g="visceras", fe=3.2, heme=0.65, c=3.7, ca=15, phy=0, pol=0,
         pro=30.4, kcal=154, b12=1.6, fol=5, zn=4.4, porc=80, pu="porcion (80 g)",
         tags=["almuerzo", "cena", "omnivoro", "economico", "peru"], cost=1),

    # ---------------- Hierro hemo: carnes ----------------
    dict(id="carne_res", n="Carne de res magra a la plancha", g="carnes", fe=2.9, heme=0.6, c=0, ca=18, phy=0, pol=0,
         pro=30.0, kcal=205, b12=2.6, fol=9, zn=6.3, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "omnivoro", "peru"], cost=3, fdc="beef loin cooked"),
    dict(id="carne_cordero", n="Cordero guisado", g="carnes", fe=2.0, heme=0.6, c=0, ca=17, phy=0, pol=0,
         pro=25.6, kcal=258, b12=2.7, fol=18, zn=4.5, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "omnivoro", "peru", "sierra"], cost=3),
    dict(id="alpaca", n="Carne de alpaca guisada", g="carnes", fe=3.4, heme=0.6, c=0, ca=11, phy=0, pol=0,
         pro=26.0, kcal=140, b12=2.4, fol=8, zn=3.8, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "omnivoro", "sierra", "peru"], cost=2),
    dict(id="cuy", n="Cuy guisado", g="carnes", fe=1.9, heme=0.6, c=0, ca=29, phy=0, pol=0,
         pro=21.0, kcal=96, b12=1.0, fol=5, zn=2.0, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "omnivoro", "sierra", "peru"], cost=3),
    dict(id="pollo_pechuga", n="Pechuga de pollo a la plancha", g="carnes", fe=1.0, heme=0.4, c=0, ca=15, phy=0, pol=0,
         pro=31.0, kcal=165, b12=0.3, fol=4, zn=1.0, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "omnivoro", "peru"], cost=2, fdc="chicken breast roasted",
         nota="Aporta poco hierro, pero su proteina animal ayuda a absorber el hierro de las menestras del mismo plato."),
    dict(id="pollo_pierna", n="Pierna de pollo guisada", g="carnes", fe=1.3, heme=0.45, c=0, ca=12, phy=0, pol=0,
         pro=26.0, kcal=209, b12=0.4, fol=8, zn=2.4, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "omnivoro", "economico", "peru"], cost=1),
    dict(id="cerdo", n="Lomo de cerdo a la plancha", g="carnes", fe=0.9, heme=0.45, c=0.6, ca=19, phy=0, pol=0,
         pro=27.0, kcal=201, b12=0.7, fol=1, zn=2.4, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "omnivoro", "peru"], cost=2),
    dict(id="pavita", n="Pavita a la plancha", g="carnes", fe=1.4, heme=0.4, c=0, ca=17, phy=0, pol=0,
         pro=29.0, kcal=157, b12=0.4, fol=8, zn=2.5, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "omnivoro", "peru"], cost=2),

    # ---------------- Hierro hemo: pescados y mariscos ----------------
    dict(id="anchoveta", n="Anchoveta al horno", g="pescados", fe=4.9, heme=0.4, c=0, ca=232, phy=0, pol=0,
         pro=22.0, kcal=180, b12=8.8, fol=10, zn=1.7, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "omnivoro", "economico", "peru", "costa", "estrella"], cost=1,
         nota="Barata, con hierro hemo y omega 3. Su calcio compite un poco con el hierro, asi que va mejor con limon."),
    dict(id="bonito", n="Bonito a la plancha", g="pescados", fe=1.8, heme=0.4, c=0, ca=25, phy=0, pol=0,
         pro=25.0, kcal=168, b12=9.4, fol=9, zn=0.8, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "omnivoro", "economico", "peru", "costa"], cost=1),
    dict(id="jurel", n="Jurel al horno", g="pescados", fe=1.6, heme=0.4, c=0, ca=41, phy=0, pol=0,
         pro=23.0, kcal=158, b12=7.0, fol=6, zn=0.9, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "omnivoro", "economico", "peru", "costa"], cost=1),
    dict(id="trucha", n="Trucha a la plancha", g="pescados", fe=1.5, heme=0.4, c=2.4, ca=43, phy=0, pol=0,
         pro=24.0, kcal=168, b12=5.4, fol=15, zn=0.8, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "omnivoro", "sierra", "peru"], cost=2),
    dict(id="conchas_negras", n="Conchas negras", g="mariscos", fe=24.0, heme=0.5, c=8, ca=88, phy=0, pol=0,
         pro=14.0, kcal=86, b12=12.0, fol=16, zn=2.7, porc=60, pu="porcion (60 g)",
         tags=["almuerzo", "omnivoro", "costa", "peru"], cost=3),
    dict(id="almejas", n="Almejas cocidas", g="mariscos", fe=28.0, heme=0.5, c=22, ca=92, phy=0, pol=0,
         pro=25.5, kcal=148, b12=98.9, fol=29, zn=2.7, porc=60, pu="porcion (60 g)",
         tags=["almuerzo", "omnivoro", "costa", "peru"], cost=3, fdc="clams cooked"),
    dict(id="choros", n="Choros al vapor", g="mariscos", fe=6.7, heme=0.5, c=13.6, ca=33, phy=0, pol=0,
         pro=24.0, kcal=172, b12=24.0, fol=76, zn=2.7, porc=80, pu="porcion (80 g)",
         tags=["almuerzo", "omnivoro", "costa", "peru"], cost=2),
    dict(id="huevo", n="Huevo de gallina cocido", g="huevos", fe=1.2, heme=0.15, c=0, ca=50, phy=0, pol=0,
         pro=12.6, kcal=155, b12=1.1, fol=44, zn=1.1, porc=55, pu="unidad (55 g)",
         tags=["desayuno", "almuerzo", "cena", "lonchera", "vegetariano", "economico", "peru"], cost=1,
         fdc="egg whole cooked hard-boiled",
         nota="Buen alimento, pero su yema contiene fosvitina, que frena la absorcion del hierro no hemo del mismo plato."),
    dict(id="huevo_codorniz", n="Huevo de codorniz cocido", g="huevos", fe=3.7, heme=0.15, c=0, ca=64, phy=0, pol=0,
         pro=13.1, kcal=158, b12=1.6, fol=66, zn=1.5, porc=45, pu="5 unidades (45 g)",
         tags=["desayuno", "lonchera", "vegetariano", "peru"], cost=2),

    # ---------------- Menestras ----------------
    dict(id="lentejas", n="Lentejas cocidas", g="menestras", fe=3.3, heme=0, c=1.5, ca=19, phy=270, pol=90,
         pro=9.0, kcal=116, b12=0, fol=181, zn=1.3, porc=140, pu="taza (140 g)",
         tags=["almuerzo", "cena", "vegano", "economico", "peru", "estrella"], cost=1, fdc="lentils cooked",
         nota="Clasico peruano y muy buena base. Sin vitamina C al lado, su hierro se aprovecha poco."),
    dict(id="frejol_negro", n="Frejol negro cocido", g="menestras", fe=2.1, heme=0, c=0, ca=27, phy=310, pol=180,
         pro=8.9, kcal=132, b12=0, fol=149, zn=1.1, porc=140, pu="taza (140 g)",
         tags=["almuerzo", "cena", "vegano", "economico", "peru"], cost=1, fdc="black beans cooked"),
    dict(id="frejol_canario", n="Frejol canario cocido", g="menestras", fe=2.6, heme=0, c=1, ca=48, phy=300, pol=120,
         pro=8.2, kcal=127, b12=0, fol=130, zn=1.0, porc=140, pu="taza (140 g)",
         tags=["almuerzo", "cena", "vegano", "economico", "peru"], cost=1),
    dict(id="garbanzo", n="Garbanzo cocido", g="menestras", fe=2.9, heme=0, c=1.3, ca=49, phy=280, pol=70,
         pro=8.9, kcal=164, b12=0, fol=172, zn=1.5, porc=140, pu="taza (140 g)",
         tags=["almuerzo", "cena", "vegano", "peru"], cost=2, fdc="chickpeas cooked"),
    dict(id="pallar", n="Pallar cocido", g="menestras", fe=2.4, heme=0, c=0, ca=17, phy=260, pol=60,
         pro=7.8, kcal=115, b12=0, fol=83, zn=0.9, porc=140, pu="taza (140 g)",
         tags=["almuerzo", "cena", "vegano", "economico", "peru", "costa"], cost=1),
    dict(id="arveja_seca", n="Arveja seca cocida", g="menestras", fe=1.3, heme=0, c=0.4, ca=14, phy=190, pol=50,
         pro=8.3, kcal=118, b12=0, fol=65, zn=1.0, porc=140, pu="taza (140 g)",
         tags=["almuerzo", "cena", "vegano", "economico", "peru"], cost=1),
    dict(id="tarwi", n="Tarwi (chocho) cocido", g="menestras", fe=2.3, heme=0, c=2, ca=54, phy=200, pol=80,
         pro=17.5, kcal=151, b12=0, fol=98, zn=1.4, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "lonchera", "vegano", "sierra", "peru"], cost=1,
         nota="Muy proteico y andino. Va perfecto con cebolla, tomate y limon: la vitamina C hace el trabajo."),
    dict(id="soya", n="Soya cocida", g="menestras", fe=5.1, heme=0, c=1.7, ca=102, phy=350, pol=110,
         pro=18.2, kcal=173, b12=0, fol=54, zn=1.2, porc=120, pu="porcion (120 g)",
         tags=["almuerzo", "cena", "vegano", "peru"], cost=2),

    # ---------------- Granos andinos y cereales ----------------
    dict(id="quinua", n="Quinua cocida", g="granos", fe=1.5, heme=0, c=0, ca=17, phy=180, pol=40,
         pro=4.4, kcal=120, b12=0, fol=42, zn=1.1, porc=150, pu="taza (150 g)",
         tags=["desayuno", "almuerzo", "cena", "vegano", "sierra", "peru", "estrella"], cost=2, fdc="quinoa cooked"),
    dict(id="kiwicha", n="Kiwicha cocida", g="granos", fe=2.1, heme=0, c=0, ca=47, phy=200, pol=50,
         pro=3.8, kcal=102, b12=0, fol=22, zn=0.9, porc=150, pu="taza (150 g)",
         tags=["desayuno", "vegano", "sierra", "peru"], cost=2),
    dict(id="canihua", n="Cañihua cocida", g="granos", fe=4.8, heme=0, c=0, ca=54, phy=210, pol=60,
         pro=5.6, kcal=110, b12=0, fol=25, zn=1.2, porc=150, pu="taza (150 g)",
         tags=["desayuno", "vegano", "sierra", "peru"], cost=2),
    dict(id="avena", n="Avena cocida", g="granos", fe=1.0, heme=0, c=0, ca=14, phy=230, pol=30,
         pro=2.5, kcal=71, b12=0, fol=6, zn=0.7, porc=200, pu="taza (200 g)",
         tags=["desayuno", "vegano", "economico", "peru"], cost=1, fdc="oats cooked"),
    dict(id="arroz", n="Arroz blanco cocido", g="granos", fe=1.2, heme=0, c=0, ca=10, phy=60, pol=10,
         pro=2.7, kcal=130, b12=0, fol=58, zn=0.5, porc=150, pu="taza (150 g)",
         tags=["almuerzo", "cena", "vegano", "economico", "peru"], cost=1),
    dict(id="pan_integral", n="Pan integral", g="cereales", fe=2.5, heme=0, c=0, ca=107, phy=320, pol=60,
         pro=9.0, kcal=247, b12=0, fol=42, zn=1.6, porc=60, pu="2 rebanadas (60 g)",
         tags=["desayuno", "lonchera", "vegano", "peru"], cost=1),
    dict(id="pan_frances", n="Pan francés", g="cereales", fe=1.9, heme=0, c=0, ca=45, phy=90, pol=20,
         pro=8.2, kcal=270, b12=0, fol=60, zn=0.7, porc=50, pu="unidad (50 g)",
         tags=["desayuno", "lonchera", "vegano", "economico", "peru"], cost=1),
    dict(id="cereal_fortificado", n="Cereal fortificado con hierro", g="cereales", fe=12.0, heme=0, c=15, ca=200, phy=150, pol=20,
         pro=8.0, kcal=380, b12=2.0, fol=200, zn=4.0, porc=30, pu="porcion (30 g)",
         tags=["desayuno", "vegano", "peru"], cost=2,
         nota="El hierro anadido se absorbe mejor si el cereal se acompana con fruta citrica y no con leche sola."),

    # ---------------- Tuberculos ----------------
    dict(id="papa", n="Papa amarilla sancochada", g="tuberculos", fe=0.8, heme=0, c=14, ca=8, phy=40, pol=30,
         pro=2.0, kcal=87, b12=0, fol=10, zn=0.3, porc=150, pu="2 unidades (150 g)",
         tags=["almuerzo", "cena", "vegano", "economico", "peru"], cost=1),
    dict(id="camote", n="Camote sancochado", g="tuberculos", fe=0.7, heme=0, c=19.6, ca=38, phy=30, pol=40,
         pro=1.6, kcal=90, b12=0, fol=6, zn=0.3, porc=150, pu="porcion (150 g)",
         tags=["almuerzo", "cena", "lonchera", "vegano", "economico", "peru"], cost=1),
    dict(id="olluco", n="Olluco cocido", g="tuberculos", fe=1.1, heme=0, c=11, ca=3, phy=30, pol=25,
         pro=1.1, kcal=62, b12=0, fol=5, zn=0.2, porc=150, pu="porcion (150 g)",
         tags=["almuerzo", "vegano", "sierra", "peru"], cost=1),
    dict(id="yuca", n="Yuca sancochada", g="tuberculos", fe=0.3, heme=0, c=20.6, ca=16, phy=20, pol=20,
         pro=1.4, kcal=160, b12=0, fol=27, zn=0.3, porc=150, pu="porcion (150 g)",
         tags=["almuerzo", "cena", "vegano", "economico", "selva", "peru"], cost=1),

    # ---------------- Verduras ----------------
    dict(id="espinaca", n="Espinaca cocida", g="verduras", fe=3.6, heme=0, c=9.8, ca=136, phy=60, pol=350,
         pro=3.0, kcal=23, b12=0, fol=146, zn=0.8, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "vegano", "economico", "peru"], cost=1, fdc="spinach cooked",
         nota="Tiene hierro, pero sus oxalatos y polifenoles lo retienen. Rinde mucho mas si va con limon."),
    dict(id="acelga", n="Acelga cocida", g="verduras", fe=2.3, heme=0, c=18, ca=58, phy=50, pol=280,
         pro=1.9, kcal=20, b12=0, fol=9, zn=0.3, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "vegano", "economico", "peru"], cost=1),
    dict(id="brocoli", n="Brócoli al vapor", g="verduras", fe=0.7, heme=0, c=64.9, ca=40, phy=20, pol=90,
         pro=2.4, kcal=35, b12=0, fol=108, zn=0.5, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "vegano", "peru", "potenciador"], cost=2, fdc="broccoli cooked"),
    dict(id="tomate", n="Tomate fresco", g="verduras", fe=0.3, heme=0, c=13.7, ca=10, phy=10, pol=45,
         pro=0.9, kcal=18, b12=0, fol=15, zn=0.2, porc=80, pu="unidad (80 g)",
         tags=["almuerzo", "cena", "vegano", "economico", "peru", "potenciador"], cost=1),
    dict(id="pimiento", n="Pimiento rojo crudo", g="verduras", fe=0.4, heme=0, c=127.7, ca=7, phy=10, pol=40,
         pro=1.0, kcal=31, b12=0, fol=46, zn=0.3, porc=60, pu="porcion (60 g)",
         tags=["almuerzo", "cena", "vegano", "peru", "potenciador", "estrella"], cost=2, fdc="peppers sweet red raw",
         nota="Uno de los potenciadores mas fuertes: muchisima vitamina C y sabor suave."),
    dict(id="rocoto", n="Rocoto (poca cantidad)", g="verduras", fe=0.5, heme=0, c=144, ca=10, phy=10, pol=60,
         pro=1.0, kcal=30, b12=0, fol=20, zn=0.2, porc=15, pu="cucharada (15 g)",
         tags=["almuerzo", "vegano", "sierra", "peru", "potenciador"], cost=1),
    dict(id="zapallo", n="Zapallo cocido", g="verduras", fe=0.6, heme=0, c=9, ca=21, phy=15, pol=30,
         pro=1.0, kcal=26, b12=0, fol=16, zn=0.3, porc=120, pu="porcion (120 g)",
         tags=["almuerzo", "cena", "vegano", "economico", "peru"], cost=1),
    dict(id="zanahoria", n="Zanahoria rallada", g="verduras", fe=0.3, heme=0, c=5.9, ca=33, phy=10, pol=35,
         pro=0.9, kcal=41, b12=0, fol=19, zn=0.2, porc=80, pu="porcion (80 g)",
         tags=["almuerzo", "cena", "lonchera", "vegano", "economico", "peru"], cost=1),
    dict(id="beterraga", n="Beterraga cocida", g="verduras", fe=0.8, heme=0, c=3.6, ca=16, phy=20, pol=90,
         pro=1.7, kcal=44, b12=0, fol=80, zn=0.4, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "vegano", "economico", "peru"], cost=1),
    dict(id="col", n="Col cruda en ensalada", g="verduras", fe=0.5, heme=0, c=36.6, ca=40, phy=15, pol=50,
         pro=1.3, kcal=25, b12=0, fol=43, zn=0.2, porc=80, pu="porcion (80 g)",
         tags=["almuerzo", "cena", "vegano", "economico", "peru", "potenciador"], cost=1),
    dict(id="coliflor", n="Coliflor al vapor", g="verduras", fe=0.4, heme=0, c=44.3, ca=16, phy=15, pol=40,
         pro=1.9, kcal=25, b12=0, fol=57, zn=0.3, porc=100, pu="porcion (100 g)",
         tags=["almuerzo", "cena", "vegano", "peru", "potenciador"], cost=2),

    # ---------------- Frutas ----------------
    dict(id="naranja", n="Naranja", g="frutas", fe=0.1, heme=0, c=53.2, ca=40, phy=0, pol=60,
         pro=0.9, kcal=47, b12=0, fol=30, zn=0.1, porc=150, pu="unidad (150 g)",
         tags=["desayuno", "recreo", "lonchera", "almuerzo", "vegano", "economico", "peru", "potenciador", "estrella"],
         cost=1, fdc="oranges raw"),
    dict(id="mandarina", n="Mandarina", g="frutas", fe=0.2, heme=0, c=26.7, ca=37, phy=0, pol=50,
         pro=0.8, kcal=53, b12=0, fol=16, zn=0.1, porc=120, pu="unidad (120 g)",
         tags=["recreo", "lonchera", "vegano", "economico", "peru", "potenciador"], cost=1),
    dict(id="camu_camu", n="Camu camu (pulpa o refresco)", g="frutas", fe=0.5, heme=0, c=2780, ca=27, phy=0, pol=180,
         pro=0.5, kcal=17, b12=0, fol=10, zn=0.1, porc=20, pu="cucharada de pulpa (20 g)",
         tags=["desayuno", "recreo", "vegano", "selva", "peru", "potenciador", "estrella"], cost=2,
         nota="La fruta con mas vitamina C del mundo. Una cucharadita convierte cualquier plato de menestras en un buen absorbedor de hierro."),
    dict(id="aguaymanto", n="Aguaymanto", g="frutas", fe=1.0, heme=0, c=43, ca=9, phy=0, pol=90,
         pro=1.9, kcal=53, b12=0, fol=8, zn=0.2, porc=80, pu="porcion (80 g)",
         tags=["recreo", "lonchera", "vegano", "sierra", "peru", "potenciador"], cost=2),
    dict(id="papaya", n="Papaya", g="frutas", fe=0.3, heme=0, c=60.9, ca=20, phy=0, pol=40,
         pro=0.5, kcal=43, b12=0, fol=37, zn=0.1, porc=150, pu="porcion (150 g)",
         tags=["desayuno", "recreo", "vegano", "economico", "selva", "peru", "potenciador"], cost=1),
    dict(id="fresa", n="Fresas", g="frutas", fe=0.4, heme=0, c=58.8, ca=16, phy=0, pol=230,
         pro=0.7, kcal=32, b12=0, fol=24, zn=0.1, porc=120, pu="porcion (120 g)",
         tags=["recreo", "lonchera", "vegano", "peru", "potenciador"], cost=2),
    dict(id="kiwi", n="Kiwi", g="frutas", fe=0.3, heme=0, c=92.7, ca=34, phy=0, pol=80,
         pro=1.1, kcal=61, b12=0, fol=25, zn=0.1, porc=100, pu="unidad (100 g)",
         tags=["recreo", "lonchera", "vegano", "peru", "potenciador"], cost=3),
    dict(id="mango", n="Mango", g="frutas", fe=0.2, heme=0, c=36.4, ca=11, phy=0, pol=70,
         pro=0.8, kcal=60, b12=0, fol=43, zn=0.1, porc=150, pu="porcion (150 g)",
         tags=["recreo", "lonchera", "vegano", "economico", "peru", "potenciador"], cost=1),
    dict(id="limon", n="Jugo de limón", g="frutas", fe=0.1, heme=0, c=38.7, ca=6, phy=0, pol=30,
         pro=0.4, kcal=22, b12=0, fol=20, zn=0.1, porc=15, pu="chorrito (15 g)",
         tags=["almuerzo", "cena", "vegano", "economico", "peru", "potenciador", "estrella"], cost=1,
         nota="El truco mas barato que existe: exprimirlo sobre las menestras o la ensalada."),
    dict(id="platano", n="Plátano de seda", g="frutas", fe=0.3, heme=0, c=8.7, ca=5, phy=0, pol=45,
         pro=1.1, kcal=89, b12=0, fol=20, zn=0.2, porc=120, pu="unidad (120 g)",
         tags=["recreo", "lonchera", "desayuno", "vegano", "economico", "peru"], cost=1),
    dict(id="manzana", n="Manzana", g="frutas", fe=0.1, heme=0, c=4.6, ca=6, phy=0, pol=130,
         pro=0.3, kcal=52, b12=0, fol=3, zn=0.0, porc=150, pu="unidad (150 g)",
         tags=["recreo", "lonchera", "vegano", "economico", "peru"], cost=1),
    dict(id="pasas", n="Pasas", g="frutas", fe=1.9, heme=0, c=2.3, ca=50, phy=20, pol=190,
         pro=3.1, kcal=299, b12=0, fol=5, zn=0.2, porc=30, pu="punado (30 g)",
         tags=["recreo", "lonchera", "vegano", "peru"], cost=2),

    # ---------------- Semillas y frutos secos ----------------
    dict(id="mani", n="Maní tostado", g="semillas", fe=2.3, heme=0, c=0, ca=54, phy=760, pol=160,
         pro=25.8, kcal=567, b12=0, fol=145, zn=3.3, porc=30, pu="punado (30 g)",
         tags=["recreo", "lonchera", "vegano", "economico", "peru"], cost=1),
    dict(id="semilla_zapallo", n="Semillas de zapallo tostadas", g="semillas", fe=8.8, heme=0, c=1.9, ca=46, phy=1100, pol=120,
         pro=30.2, kcal=559, b12=0, fol=58, zn=7.8, porc=25, pu="punado (25 g)",
         tags=["recreo", "lonchera", "vegano", "peru"], cost=2),
    dict(id="ajonjoli", n="Ajonjolí", g="semillas", fe=14.6, heme=0, c=0, ca=975, phy=1400, pol=210,
         pro=17.7, kcal=573, b12=0, fol=97, zn=7.8, porc=15, pu="cucharada (15 g)",
         tags=["desayuno", "almuerzo", "vegano", "peru"], cost=2,
         nota="Mucho hierro en la tabla, pero tambien mucho calcio y fitatos: en la practica se absorbe poco."),
    dict(id="chia", n="Chía", g="semillas", fe=7.7, heme=0, c=1.6, ca=631, phy=900, pol=140,
         pro=16.5, kcal=486, b12=0, fol=49, zn=4.6, porc=15, pu="cucharada (15 g)",
         tags=["desayuno", "vegano", "peru"], cost=3),
    dict(id="nuez", n="Nueces", g="semillas", fe=2.9, heme=0, c=1.3, ca=98, phy=760, pol=1550,
         pro=15.2, kcal=654, b12=0, fol=98, zn=3.1, porc=25, pu="punado (25 g)",
         tags=["recreo", "lonchera", "vegano", "peru"], cost=3),
    dict(id="castana", n="Castaña de Brasil", g="semillas", fe=2.4, heme=0, c=0.7, ca=160, phy=1200, pol=110,
         pro=14.3, kcal=659, b12=0, fol=22, zn=4.1, porc=20, pu="punado (20 g)",
         tags=["recreo", "lonchera", "vegano", "selva", "peru"], cost=3),

    # ---------------- Lacteos e inhibidores ----------------
    dict(id="leche", n="Leche de vaca", g="lacteos", fe=0.0, heme=0, c=0, ca=113, phy=0, pol=0,
         pro=3.2, kcal=61, b12=0.5, fol=5, zn=0.4, porc=200, pu="vaso (200 mL)",
         tags=["desayuno", "cena", "vegetariano", "peru", "inhibidor"], cost=1,
         nota="Nutritiva, pero su calcio compite con el hierro. Mejor separarla de la comida principal rica en hierro."),
    dict(id="yogurt", n="Yogurt natural", g="lacteos", fe=0.1, heme=0, c=0.5, ca=121, phy=0, pol=0,
         pro=3.5, kcal=61, b12=0.4, fol=7, zn=0.6, porc=150, pu="vaso (150 g)",
         tags=["desayuno", "recreo", "lonchera", "vegetariano", "peru", "inhibidor"], cost=2),
    dict(id="queso_fresco", n="Queso fresco", g="lacteos", fe=0.2, heme=0, c=0, ca=683, phy=0, pol=0,
         pro=18.0, kcal=264, b12=0.8, fol=12, zn=2.9, porc=40, pu="tajada (40 g)",
         tags=["desayuno", "lonchera", "vegetariano", "peru", "inhibidor"], cost=2),
    dict(id="te", n="Té negro o infusión de hoja", g="bebidas", fe=0.0, heme=0, c=0, ca=0, phy=0, pol=1500,
         pro=0.0, kcal=1, b12=0, fol=1, zn=0.0, porc=200, pu="taza (200 mL)",
         tags=["desayuno", "cena", "vegano", "peru", "inhibidor", "evitar_con_hierro"], cost=1,
         nota="Sus taninos son el freno mas potente del hierro vegetal. Dejarlo para una o dos horas despues de comer."),
    dict(id="cafe", n="Café", g="bebidas", fe=0.0, heme=0, c=0, ca=2, phy=0, pol=900,
         pro=0.1, kcal=2, b12=0, fol=0, zn=0.0, porc=200, pu="taza (200 mL)",
         tags=["desayuno", "vegano", "peru", "inhibidor", "evitar_con_hierro"], cost=1),
    dict(id="chicha_morada", n="Chicha morada", g="bebidas", fe=0.3, heme=0, c=5, ca=12, phy=0, pol=420,
         pro=0.2, kcal=45, b12=0, fol=2, zn=0.1, porc=200, pu="vaso (200 mL)",
         tags=["almuerzo", "vegano", "economico", "peru", "inhibidor"], cost=1,
         nota="Rica y tradicional, pero sus antocianinas frenan algo el hierro. Va mejor entre comidas."),
    dict(id="refresco_maracuya", n="Refresco de maracuyá sin azúcar añadida", g="bebidas", fe=0.3, heme=0, c=30, ca=4, phy=0, pol=40,
         pro=0.4, kcal=36, b12=0, fol=8, zn=0.1, porc=200, pu="vaso (200 mL)",
         tags=["almuerzo", "recreo", "lonchera", "vegano", "peru", "potenciador"], cost=1),
    dict(id="agua", n="Agua", g="bebidas", fe=0, heme=0, c=0, ca=0, phy=0, pol=0,
         pro=0, kcal=0, b12=0, fol=0, zn=0, porc=250, pu="vaso (250 mL)",
         tags=["desayuno", "recreo", "almuerzo", "cena", "lonchera", "vegano", "economico", "peru"], cost=1),

    # ---------------- Preparados y otros ----------------
    dict(id="aceituna", n="Aceitunas", g="otros", fe=3.3, heme=0, c=0.9, ca=88, phy=0, pol=160,
         pro=1.0, kcal=115, b12=0, fol=0, zn=0.2, porc=25, pu="porcion (25 g)",
         tags=["desayuno", "lonchera", "vegano", "peru", "costa"], cost=2),
    dict(id="palta", n="Palta", g="otros", fe=0.6, heme=0, c=10, ca=12, phy=30, pol=110,
         pro=2.0, kcal=160, b12=0, fol=81, zn=0.6, porc=80, pu="media unidad (80 g)",
         tags=["desayuno", "almuerzo", "lonchera", "vegano", "peru"], cost=2),
    dict(id="choclo", n="Choclo desgranado", g="granos", fe=0.5, heme=0, c=6.8, ca=2, phy=90, pol=40,
         pro=3.3, kcal=96, b12=0, fol=42, zn=0.6, porc=120, pu="porcion (120 g)",
         tags=["almuerzo", "lonchera", "vegano", "economico", "peru", "sierra"], cost=1),
    dict(id="mote", n="Mote de maíz", g="granos", fe=1.1, heme=0, c=0, ca=5, phy=110, pol=40,
         pro=3.0, kcal=110, b12=0, fol=20, zn=0.6, porc=150, pu="porcion (150 g)",
         tags=["almuerzo", "lonchera", "vegano", "economico", "sierra", "peru"], cost=1),
    dict(id="humita", n="Humita salada", g="preparados", fe=0.8, heme=0, c=4, ca=30, phy=80, pol=30,
         pro=5.0, kcal=180, b12=0.2, fol=25, zn=0.7, porc=120, pu="unidad (120 g)",
         tags=["desayuno", "lonchera", "vegetariano", "sierra", "peru"], cost=1),
    dict(id="tortilla_verduras", n="Tortilla de verduras", g="preparados", fe=1.5, heme=0.1, c=12, ca=60, phy=60, pol=60,
         pro=8.0, kcal=150, b12=0.6, fol=50, zn=0.8, porc=120, pu="porcion (120 g)",
         tags=["cena", "lonchera", "vegetariano", "economico", "peru"], cost=1),
]

# Alias legibles de los grupos, para la interfaz.
GROUPS = {
    "visceras": "Vísceras y sangre",
    "carnes": "Carnes",
    "pescados": "Pescados",
    "mariscos": "Mariscos",
    "huevos": "Huevos",
    "menestras": "Menestras",
    "granos": "Granos y andinos",
    "cereales": "Panes y cereales",
    "tuberculos": "Tubérculos",
    "verduras": "Verduras",
    "frutas": "Frutas",
    "semillas": "Semillas y frutos secos",
    "lacteos": "Lácteos",
    "bebidas": "Bebidas",
    "preparados": "Preparados",
    "otros": "Otros",
}


def fetch_fdc(query: str, api_key: str, timeout: int = 20) -> dict | None:
    """Consulta USDA FoodData Central y devuelve el primer alimento SR Legacy."""
    params = urllib.parse.urlencode({
        "query": query,
        "api_key": api_key,
        "pageSize": 1,
        "dataType": "SR Legacy,Foundation",
    })
    url = f"{FDC_SEARCH}?{params}"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            payload = json.load(resp)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        print(f"  ! {query}: {exc}", file=sys.stderr)
        return None
    foods = payload.get("foods") or []
    if not foods:
        return None
    food = foods[0]
    values: dict[str, float] = {}
    for nut in food.get("foodNutrients", []):
        num = nut.get("nutrientId") or nut.get("nutrientNumber")
        try:
            num = int(num)
        except (TypeError, ValueError):
            continue
        field = FDC_NUTRIENTS.get(num)
        if field is not None and nut.get("value") is not None:
            values[field] = round(float(nut["value"]), 2)
    if not values:
        return None
    return {
        "fdcId": food.get("fdcId"),
        "description": food.get("description"),
        "values": values,
    }


def build(online: bool, api_key: str | None) -> dict:
    foods = []
    enriched = 0

    for item in SEED:
        food = dict(item)
        food["gLabel"] = GROUPS.get(food["g"], food["g"])
        food.setdefault("cost", 2)
        food.setdefault("nota", "")
        food["src"] = "seed"

        query = food.pop("fdc", None)
        if online and api_key and query:
            print(f"  · consultando USDA FDC: {query}")
            hit = fetch_fdc(query, api_key)
            time.sleep(0.4)  # cortesia con la API
            if hit:
                for field, value in hit["values"].items():
                    # Los factores de absorcion del seed mandan siempre.
                    if field in ("heme", "phy", "pol"):
                        continue
                    food[field] = value
                food["src"] = "seed+fdc"
                food["fdcId"] = hit["fdcId"]
                food["fdcDesc"] = hit["description"]
                enriched += 1

        foods.append(food)

    ids = [f["id"] for f in foods]
    duplicates = {i for i in ids if ids.count(i) > 1}
    if duplicates:
        raise SystemExit(f"IDs duplicados en el seed: {sorted(duplicates)}")

    for food in foods:
        for field in ("fe", "c", "ca", "pro", "kcal"):
            if food.get(field) is None:
                raise SystemExit(f"{food['id']}: falta el campo obligatorio {field}")

    return {
        "version": date.today().isoformat(),
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "count": len(foods),
        "enrichedFromFDC": enriched,
        "units": "Todos los valores por 100 g de alimento listo para consumir.",
        "groups": GROUPS,
        "sources": [
            "Tablas Peruanas de Composición de Alimentos — CENAN / Instituto Nacional de Salud",
            "USDA FoodData Central (SR Legacy / Foundation Foods)",
            "Hallberg L, Hulthén L. Am J Clin Nutr 2000;71:1147-60 (factores de absorción)",
            "NIH Office of Dietary Supplements — Iron Fact Sheet",
        ],
        "foods": foods,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--online", action="store_true",
                        help="enriquecer con USDA FoodData Central (necesita FDC_API_KEY)")
    parser.add_argument("--out", default=str(OUT))
    args = parser.parse_args()

    api_key = os.environ.get("FDC_API_KEY", "").strip() or None
    if args.online and not api_key:
        print("FDC_API_KEY no definida: se genera solo el seed.", file=sys.stderr)

    db = build(args.online, api_key)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(db, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{out}: {db['count']} alimentos, {db['enrichedFromFDC']} enriquecidos desde FDC")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
