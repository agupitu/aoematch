// Región y terreno de cada mapa, para filtrar el pool al armar un torneo. Datos
// a mano, por slug (web/src/logica/datos/maps.json los regenera `npm run assets`
// y esto no lo pisa).
//
//   región   donde queda el lugar que representa; los genéricos o de fantasía van
//            en "otros".
//   terreno  agua si el mapa es de islas o de mar abierto (se juega con barcos),
//            ambos si mezcla tierra y agua (costa, lagos, grandes ríos), tierra si
//            es sin agua o casi. Sale de la proporción de agua del minimapa
//            (`node tools/medir-mapas.mjs`): menos de 10% tierra, de 10% a 33%
//            ambos y 33% o más agua. A mano: Panamá, Española y Territorios árticos
//            son ambos; los mares y las islas chicas (Báltico, Negro, Caspio,
//            Malta, Estrechos daneses) son agua. Es aproximado: si un mapa te
//            parece mal clasificado, se cambia acá.

export const REGIONES = ['america', 'europa', 'asia', 'africa', 'otros'];
export const TERRENOS = ['tierra', 'agua', 'ambos'];

export const ETIQUETA_REGION = { america: 'América', europa: 'Europa', asia: 'Asia', africa: 'África', otros: 'Otros' };
export const ETIQUETA_TERRENO = { tierra: 'Tierra', agua: 'Agua', ambos: 'Ambos' };

const POR_REGION = {
  america: [
    'alaska', 'amazonas', 'andes', 'araucania', 'artico', 'bahia-de-hudson', 'baja-california', 'bayou', 'california',
    'caribe', 'carolina', 'colorado', 'cordillera-de-las-cascadas', 'dakota', 'desierto-pintado', 'espanola', 'florida',
    'frontera-de-texas', 'gran-chaco', 'grandes-lagos', 'grandes-llanuras', 'groenlandia', 'guayanas', 'islas-virgenes',
    'labrador', 'mexico', 'minas-gerais', 'nueva-escocia', 'nueva-inglaterra', 'nunavut', 'orinoco', 'ozarks',
    'paisaje-altoandino', 'pampa', 'panama', 'paso-del-noroeste', 'patagonia', 'plymouth', 'quebec', 'rocosas', 'saguenay',
    'sierras-pampeanas', 'sonora', 'territorios-articos', 'territorios-del-noroeste', 'texas', 'yucatan', 'yukon',
  ],
  europa: [
    'acropolis', 'alpes', 'bohemia', 'budapest', 'carpatos', 'caucaso', 'corcega-y-cerdena', 'cuenca-del-dnieper',
    'cuenca-del-vistula', 'curlandia', 'escandinavia', 'escocia', 'espana', 'estrechos-daneses', 'finlandia', 'francia',
    'francia-comercio', 'gales', 'gotland', 'guerra-de-livonia', 'guerra-de-los-siete-anos', 'guerras-de-los-tres-reinos',
    'guerras-sueco-danesas', 'heligoland', 'inglaterra', 'irlanda', 'islandia', 'islas-feroe', 'italia',
    'la-gran-guerra-del-norte', 'la-gran-guerra-turca', 'la-guerra-de-flandes', 'la-guerra-de-los-treinta-anos',
    'lagos-de-carelia', 'lagos-suecos', 'las-guerras-italianas', 'las-guerras-napoleonicas', 'las-guerras-ruso-turcas',
    'lituania', 'llanuras-hungaras', 'malta', 'mar-baltico', 'mar-de-noruega', 'mar-del-norte', 'mar-negro', 'mediterraneo',
    'montanas-de-los-balcanes', 'moscovia', 'paises-bajos', 'pantanos-de-pinsk', 'pirineos', 'pomerania', 'portugal', 'rin',
    'sajonia', 'sapmi', 'selva-negra', 'selva-negra-arena', 'selva-negra-forest-nothing', 'shetland', 'sur-de-noruega',
    'svalbard', 'valaquia',
  ],
  asia: [
    'anatolia', 'arabia', 'asia-central', 'bengala', 'borneo', 'ceilan', 'corea', 'decan', 'estepa-euroasiatica',
    'estepa-euroasiatica-perdido', 'estepa-euroasiatica-supervivencia', 'himalaya', 'himalaya-superior', 'hokkaido',
    'honshu', 'indochina', 'indonesia', 'kamchatka', 'malasia', 'manchuria', 'mar-caspio', 'media-luna-fertil', 'mongolia',
    'punyab', 'rio-amarillo', 'rios-paralelos', 'ruta-de-la-seda', 'siberia', 'yamal',
  ],
  africa: [
    'atlas', 'costa-de-la-pimienta', 'costa-de-marfil', 'costa-de-oro', 'costa-de-oro-fuerte', 'costa-swahili',
    'cuenca-del-congo', 'cuerno', 'darfur', 'delta-del-niger', 'dunas', 'dunas-el-ojo', 'gran-rift', 'lago-chad',
    'lago-victoria', 'oasis-de-siwa', 'rio-niger', 'rutas-en-el-sahara', 'rutas-en-el-sahara-perdido', 'sabana', 'sahel',
    'sudd', 'tassili', 'tripolitania', 'valle-del-nilo',
  ],
  otros: [
    'archipielago', 'bahia', 'desconocido', 'desconocido-perdido', 'desconocido-supervivencia', 'el-diluvio',
    'estrecho-de-bering', 'llanura-central', 'montanas',
  ],
};

/** Mapas de islas o mar abierto. */
const AGUA = [
  'archipielago', 'artico', 'borneo', 'caribe', 'ceilan', 'corcega-y-cerdena', 'estrecho-de-bering', 'estrechos-daneses',
  'gotland', 'groenlandia', 'guerra-de-los-siete-anos', 'guerras-sueco-danesas', 'heligoland', 'honshu', 'indonesia',
  'islandia', 'islas-virgenes', 'malta', 'mar-baltico', 'mar-caspio', 'mar-de-noruega', 'mar-del-norte', 'mar-negro',
  'mediterraneo', 'paso-del-noroeste', 'svalbard',
];

/** Mapas que mezclan tierra y agua. El resto es tierra. */
const AMBOS = [
  'alaska', 'amazonas', 'araucania', 'bahia', 'bahia-de-hudson', 'baja-california', 'budapest', 'california', 'carolina',
  'caucaso', 'cordillera-de-las-cascadas', 'corea', 'costa-de-la-pimienta', 'costa-de-marfil', 'costa-de-oro',
  'costa-de-oro-fuerte', 'costa-swahili', 'cuerno', 'curlandia', 'delta-del-niger', 'escandinavia', 'escocia', 'espana',
  'espanola', 'finlandia', 'florida', 'gales', 'grandes-lagos', 'indochina', 'inglaterra', 'irlanda', 'labrador',
  'la-gran-guerra-del-norte', 'la-guerra-de-flandes', 'lago-chad', 'lago-victoria', 'lagos-de-carelia', 'las-guerras-ruso-turcas',
  'malasia', 'manchuria', 'nueva-escocia', 'nueva-inglaterra', 'nunavut', 'paises-bajos', 'panama', 'patagonia', 'plymouth',
  'pomerania', 'quebec', 'saguenay', 'sapmi', 'shetland', 'siberia', 'sur-de-noruega', 'territorios-articos',
  'territorios-del-noroeste', 'tripolitania', 'valaquia', 'yamal', 'yucatan',
];

export const SLUGS_CON_REGION = Object.values(POR_REGION).flat();
export const SLUGS_AGUA = AGUA;
export const SLUGS_AMBOS = AMBOS;

const REGION_DE = new Map(Object.entries(POR_REGION).flatMap(([region, slugs]) => slugs.map((s) => [s, region])));
const TERRENO_DE = new Map([...AGUA.map((s) => [s, 'agua']), ...AMBOS.map((s) => [s, 'ambos'])]);

/** { region, terreno } de un mapa por su slug. Un slug que no está en las listas es "otros" y tierra. */
export function infoDeMapa(slug) {
  return { region: REGION_DE.get(slug) ?? 'otros', terreno: TERRENO_DE.get(slug) ?? 'tierra' };
}

const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Los mapas que cumplen todos los filtros que vengan: `q` (busca en el nombre,
 * sin tildes ni mayúsculas), `elegidos` (lista de ids: solo esos), `terreno` y
 * `region`. Sin filtros, todos.
 * @param {any[]} mapas
 * @param {{ q?: string, elegidos?: number[] | null, terreno?: string, region?: string }} [filtros]
 * @returns {any[]}
 */
export function filtrarMapas(mapas, { q = '', elegidos = null, terreno = '', region = '' } = {}) {
  const buscado = normalizar(q.trim());
  const solo = elegidos ? new Set(elegidos) : null;
  return mapas.filter(
    (m) =>
      (!buscado || normalizar(m.name_es).includes(buscado) || normalizar(m.slug).includes(buscado)) &&
      (!solo || solo.has(m.id)) &&
      (!terreno || m.terreno === terreno) &&
      (!region || m.region === region)
  );
}
