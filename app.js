const OPENFREEMAP_STYLE_URL = "./data/openfreemap-liberty-style.json";
const FOOD_STORES_REGIONAL_URL = (macroId) => `./data/food-stores-${macroId}-202603.geojson.gz`;
const CONVENIENCE_STORES_REGIONAL_URL = (macroId) =>
  `./data/convenience-stores-${macroId}-202603.geojson.gz`;
const FOOD_ADMIN_HIERARCHY_GEOJSON_GZ_URL = "./data/food-admin-hierarchy-202603.geojson.gz";
const FOOD_MACRO_BOUNDARIES_URL = "./data/food-macro-boundaries-202603.geojson";
const FOOD_SIGUNGU_BOUNDARIES_URL = "./data/food-sigungu-boundaries-202603.geojson";
const FOOD_DONG_BOUNDARIES_GZ_URL = "./data/food-dong-boundaries-202603.geojson.gz";
const STORE_SEARCH_MANIFEST_URL = "./data/store-search-manifest.json";
const SEOUL_SUBWAY_EXITS_URL = "./data/seoul-subway-exits.geojson";
const SUBWAY_EXITS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const APP_BUILD_ID = "2026-07-13-foodmile-step07-gps-visit";
const APP_VERSION_URL = "./version.json";
const AUTO_UPDATE_STATE_KEY = "food-map-auto-update-state";
const AUTO_UPDATE_RELOAD_KEY = "food-map-auto-update-reload-build";
const AUTO_UPDATE_INTERVAL_MS = 30_000;

const ZOOM_MACRO_MAX = 7.2;
const ZOOM_SIGUNGU_MAX = 10.2;
const ZOOM_DONG_MAX = 12.7;

const INITIAL_VIEW = {
  center: [127.7669, 35.9078],
  zoom: 6.75,
  pitch: 0,
  bearing: 0,
};
const KOREA_OVERVIEW_BOUNDS = [
  [124.35, 32.75],
  [130.95, 38.75],
];
const KOREA_PAN_BOUNDS = [
  [123.5, 31.8],
  [132.0, 39.7],
];

const statusEl = document.querySelector("#status");
const categoryPanelEl = document.querySelector("#category-panel");
const searchFormEl = document.querySelector("#search-form");
const searchInputEl = document.querySelector("#search-input");
const searchResultsEl = document.querySelector("#search-results");
const storeSheetEl = document.querySelector("#store-sheet");
const storeSheetContentEl = document.querySelector("#store-sheet-content");
const storeSheetOverlayEl = document.querySelector("#store-sheet-overlay");
const selectedMarkerIndicatorEl = document.querySelector("#selected-marker-indicator");
let selectedMarkerCoordinates = null;
let storeSheetDragState = null;
let storeSheetDragResetTimer = null;
let multiStoreSheetState = null;
let activeRestaurantVisitContext = null;
const SUBTLE_BUILDING_OUTLINE_STYLE = {
  fillColor: "hsl(35,8%,83%)",
  fillOutlineColor: "#b8b3ad",
  fillOpacity: 0.96,
  outlineLayerColor: "#b4aea8",
};
const BACKUP_DARK_BUILDING_STYLE = {
  fillColor: "#8f8f8f",
  fillOutlineColor: "#666666",
  fillOpacity: 0.86,
};
const INSTITUTION_POI_TYPES = [
  "town_hall",
  "government",
  "public_building",
  "courthouse",
  "police",
  "fire_station",
  "post_office",
  "post",
  "school",
  "kindergarten",
  "college",
  "university",
  "hospital",
  "clinic",
  "doctors",
  "library",
];

let foodStoreInteractionsReady = false;
let fullFoodStoreData = null;
let selectedFoodCategory = "all";
let loadedFoodMacroId = null;
let foodStoreLoadToken = 0;
let loadedConvenienceMacroId = null;
let convenienceStoreLoadToken = 0;
let adminNavigationStack = [];
let activeAdminProperties = null;
let macroBoundaryData = null;
let sigunguBoundaryData = null;
let dongBoundaryData = null;
let activeAdminBoundaryKey = null;
let gpsTrackingActive = false;
let lastGpsCoordinates = null;
let gpsUpdatesSuppressed = false;
let subwayExitRequestController = null;
let subwayExitRefreshTimer = null;
let autoUpdateCheckInProgress = false;
let adminPresentationFrame = null;
let gpsHasCentered = false;
let adminSearchFeatures = [];
let storeSearchManifest = null;
let currentSearchResults = [];
let searchDebounceTimer = null;
let searchRequestId = 0;
let searchReturnState = null;
const storeSearchShardCache = new Map();

function readPendingAutoUpdateState() {
  try {
    const raw = sessionStorage.getItem(AUTO_UPDATE_STATE_KEY);
    sessionStorage.removeItem(AUTO_UPDATE_STATE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    return Date.now() - Number(state.savedAt || 0) < 120_000 ? state : null;
  } catch {
    return null;
  }
}

const pendingAutoUpdateState = readPendingAutoUpdateState();

const FOOD_CATEGORY_FILTERS = [
  { id: "all", label: "전체", color: "#343a40" },
  { id: "korean", label: "한식", color: "#e03131", keywords: ["한식", "백반", "국밥"] },
  { id: "cafe", label: "카페", color: "#7950f2", keywords: ["커피", "카페"] },
  { id: "bunsik", label: "분식", color: "#f08c00", keywords: ["분식", "김밥", "떡볶이"] },
  { id: "dessert", label: "디저트", color: "#f06595", keywords: ["디저트", "제과", "제빵", "베이커리"] },
  { id: "bar", label: "술집", color: "#c2255c", keywords: ["주점", "호프", "술집"] },
];

const EXCLUDED_FOOD_KEYWORDS = ["노래", "노래방", "노래연습장", "가라오케", "뮤직타운", "karaoke"];

function setStatus(message) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function hasFinalConsonant(text) {
  const last = [...String(text || "")].pop();
  if (!last) {
    return false;
  }

  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) {
    return false;
  }

  return (code - 0xac00) % 28 !== 0;
}

function directionParticle(text) {
  const last = [...String(text || "")].pop();
  if (last) {
    const code = last.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8) {
      return "로";
    }
  }

  return hasFinalConsonant(text) ? "으로" : "로";
}

function geometryBounds(geometry) {
  const bounds = new maplibregl.LngLatBounds();

  const extendCoordinates = (coordinates) => {
    if (
      Array.isArray(coordinates) &&
      coordinates.length >= 2 &&
      typeof coordinates[0] === "number" &&
      typeof coordinates[1] === "number"
    ) {
      bounds.extend(coordinates);
      return;
    }

    for (const child of coordinates || []) {
      extendCoordinates(child);
    }
  };

  extendCoordinates(geometry?.coordinates);
  return bounds.isEmpty() ? null : bounds;
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  return Boolean(polygon?.[0]) && pointInRing(point, polygon[0]) &&
    !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

function macroFeatureAt(point) {
  return macroBoundaryData?.features?.find((feature) => {
    if (feature.geometry?.type === "Polygon") {
      return pointInPolygon(point, feature.geometry.coordinates);
    }
    if (feature.geometry?.type === "MultiPolygon") {
      return feature.geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
    }
    return false;
  });
}

function fitKoreaOverview({ animated = false } = {}) {
  map.fitBounds(KOREA_OVERVIEW_BOUNDS, {
    padding: 8,
    duration: animated ? 650 : 0,
  });
  if (!animated) {
    map.setMinZoom(map.getZoom());
    document.body.dataset.overviewMinZoom = String(map.getMinZoom());
  }
}

function hideLayer(layerId) {
  if (!map.getLayer(layerId)) {
    return false;
  }

  map.setLayoutProperty(layerId, "visibility", "none");
  return true;
}

function applyMapCleanup() {
  const style = map.getStyle();
  const stats = {
    hiddenTextLayers: 0,
    hiddenIconLayers: 0,
    hiddenBuildingDepthLayers: 0,
    addedBuildingOutlineLayers: 0,
    restoredBuildingLayers: 0,
  };

  for (const layer of style.layers || []) {
    if (layer.type === "symbol" && layer.layout?.["text-field"]) {
      map.setLayoutProperty(layer.id, "text-field", "");
      stats.hiddenTextLayers += 1;
    }
  }

  for (const layer of style.layers || []) {
    if (layer.type === "symbol" && layer["source-layer"] === "poi" && hideLayer(layer.id)) {
      stats.hiddenIconLayers += 1;
    }
  }

  for (const layerId of [
    "building-3d",
    "highway-shield-non-us",
    "highway-shield-us-interstate",
    "road_shield_us",
  ]) {
    if (!hideLayer(layerId)) {
      continue;
    }

    if (layerId === "building-3d") {
      stats.hiddenBuildingDepthLayers += 1;
    } else {
      stats.hiddenIconLayers += 1;
    }
  }

  if (map.getLayer("building")) {
    map.setPaintProperty("building", "fill-color", SUBTLE_BUILDING_OUTLINE_STYLE.fillColor);
    map.setPaintProperty("building", "fill-outline-color", SUBTLE_BUILDING_OUTLINE_STYLE.fillOutlineColor);
    map.setPaintProperty("building", "fill-opacity", SUBTLE_BUILDING_OUTLINE_STYLE.fillOpacity);
    stats.restoredBuildingLayers += 1;

    if (!map.getLayer("building-outline")) {
      map.addLayer(
        {
          id: "building-outline",
          type: "line",
          source: "openmaptiles",
          "source-layer": "building",
          minzoom: 13,
          paint: {
            "line-color": SUBTLE_BUILDING_OUTLINE_STYLE.outlineLayerColor,
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.35, 16, 0.55],
            "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.35, 17, 0.7, 20, 1],
          },
        },
        "building",
      );
      stats.addedBuildingOutlineLayers += 1;
    }
  }

  return stats;
}

function institutionPoiFilter() {
  return [
    "any",
    ["in", ["get", "class"], ["literal", INSTITUTION_POI_TYPES]],
    ["in", ["get", "subclass"], ["literal", INSTITUTION_POI_TYPES]],
  ];
}

function institutionIconImage() {
  return [
    "match",
    ["get", "class"],
    ["school", "kindergarten"],
    "school",
    ["college", "university"],
    "college",
    ["hospital", "clinic", "doctors"],
    "hospital",
    "library",
    "library",
    ["post", "post_office"],
    "post",
    "town_hall",
  ];
}

function addInstitutionPoiLayers() {
  if (map.getLayer("institution-poi-symbols")) {
    return;
  }

  map.addLayer({
    id: "institution-poi-symbols",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "poi",
    minzoom: 13,
    filter: institutionPoiFilter(),
    layout: {
      "icon-image": institutionIconImage(),
      "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 0.72, 17, 0.95],
      "icon-allow-overlap": false,
      "icon-ignore-placement": false,
      "icon-optional": false,
      "text-field": [
        "step",
        ["zoom"],
        "",
        15,
        ["coalesce", ["get", "name:nonlatin"], ["get", "name"], ["get", "name_en"]],
      ],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 15, 10.5, 18, 12.5],
      "text-anchor": "top",
      "text-offset": [0, 0.85],
      "text-allow-overlap": false,
      "text-optional": true,
      "text-padding": 4,
    },
    paint: {
      "text-color": "#264653",
      "text-halo-color": "rgba(255,255,255,0.94)",
      "text-halo-width": 1.5,
      "text-halo-blur": 0.3,
    },
  });
}

function poiNameExpression() {
  return ["coalesce", ["get", "name:nonlatin"], ["get", "name"], ["get", "name_en"], ""];
}

function nameContains(text) {
  return [">=", ["index-of", text.toLowerCase(), ["downcase", poiNameExpression()]], 0];
}

function anyNameContains(values) {
  return ["any", ...values.map(nameContains)];
}

function retailSearchTextExpression() {
  return [
    "downcase",
    [
      "concat",
      poiNameExpression(),
      " ",
      ["coalesce", ["get", "brand"], ""],
      " ",
      ["coalesce", ["get", "operator"], ""],
      " ",
      ["coalesce", ["get", "network"], ""],
    ],
  ];
}

function anyRetailFieldContains(values) {
  const searchText = retailSearchTextExpression();
  return ["any", ...values.map((value) => [">=", ["index-of", value.toLowerCase(), searchText], 0])];
}

function transitNameExpression() {
  return [
    "downcase",
    ["coalesce", ["get", "ref"], ["get", "name:nonlatin"], ["get", "name"], ["get", "name_en"], ""],
  ];
}

function transitNameContains(value) {
  return [">=", ["index-of", value, transitNameExpression()], 0];
}

function transitLineColorExpression() {
  return [
    "case",
    transitNameContains("1"),
    "#0052a4",
    transitNameContains("2"),
    "#00a84d",
    transitNameContains("3"),
    "#ef7c1c",
    transitNameContains("4"),
    "#00a5de",
    transitNameContains("5"),
    "#996cac",
    transitNameContains("6"),
    "#cd7c2f",
    transitNameContains("7"),
    "#747f00",
    transitNameContains("8"),
    "#e6186c",
    transitNameContains("9"),
    "#bdb092",
    transitNameContains("경의"),
    "#77c4a3",
    transitNameContains("경춘"),
    "#0c8e72",
    transitNameContains("수인"),
    "#f5a200",
    transitNameContains("분당"),
    "#f5a200",
    transitNameContains("신분당"),
    "#d4003b",
    transitNameContains("공항"),
    "#0090d2",
    transitNameContains("airport"),
    "#0090d2",
    transitNameContains("incheon"),
    "#7ca8d5",
    "#6c757d",
  ];
}

function addTransitLineLayers() {
  for (const [id, brunnel] of [
    ["custom-transit-lines-tunnel", "tunnel"],
    ["custom-transit-lines-surface", null],
    ["custom-transit-lines-bridge", "bridge"],
  ]) {
    if (map.getLayer(id)) {
      continue;
    }

    const filter = brunnel
      ? ["all", ["==", ["get", "brunnel"], brunnel], ["in", ["get", "class"], ["literal", ["rail", "transit"]]]]
      : [
          "all",
          ["match", ["get", "brunnel"], ["bridge", "tunnel"], false, true],
          ["in", ["get", "class"], ["literal", ["rail", "transit"]]],
        ];

    map.addLayer({
      id,
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 10,
      filter,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": transitLineColorExpression(),
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.45, 13, 0.86],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 14, 2.4, 17, 4],
      },
    });
  }
}

const RETAIL_LOGO_ASSETS = {
  "brand-homeplus": "./assets/retail-logos/homeplus.png",
  "brand-emart": "./assets/retail-logos/emart.png",
  "brand-lotte": "./assets/retail-logos/lotte.png",
  "brand-costco": "./assets/retail-logos/costco.png",
  "brand-cu": "./assets/retail-logos/cu.png",
  "brand-gs25": "./assets/retail-logos/gs25.png",
  "brand-seven": "./assets/retail-logos/seven.png",
  "brand-emart24": "./assets/retail-logos/emart24.png",
  "brand-ministop": "./assets/retail-logos/ministop.png",
  "brand-lawson": "./assets/retail-logos/lawson.png",
  "brand-seicomart": "./assets/retail-logos/seicomart.png",
  "brand-storyway": "./assets/retail-logos/storyway.png",
  "brand-poplar": "./assets/retail-logos/poplar.png",
  "brand-familymart": "./assets/retail-logos/familymart.png",
  "brand-cspace": "./assets/retail-logos/cspace.png",
  "brand-iga": "./assets/retail-logos/iga.png",
};

async function loadRetailLogoImages() {
  await Promise.all(
    Object.entries(RETAIL_LOGO_ASSETS).map(async ([id, url]) => {
      if (map.hasImage(id)) {
        return;
      }
      const image = await map.loadImage(url);
      map.addImage(id, image.data, { pixelRatio: 2 });
    }),
  );
  document.body.dataset.retailLogoCount = String(Object.keys(RETAIL_LOGO_ASSETS).length);
}

function addRetailLayer({ id, icon, filter, minzoom = 13.5, iconSize = null }) {
  map.addLayer({
    id,
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "poi",
    minzoom,
    filter,
    layout: {
      "icon-image": icon,
      "icon-size": iconSize || ["interpolate", ["linear"], ["zoom"], minzoom, 0.2, 17, 0.3],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-optional": false,
    },
  });
}

async function addRetailPoiLayers() {
  await loadRetailLogoImages();

  const supermarketFilter = [
    "any",
    ["==", ["get", "class"], "supermarket"],
    ["==", ["get", "subclass"], "supermarket"],
  ];
  const brandDefinitions = [
    ["homeplus", "brand-homeplus", ["홈플러스", "homeplus"], []],
    ["emart", "brand-emart", ["이마트", "emart", "트레이더스", "traders"], ["이마트24", "emart24"]],
    ["lotte", "brand-lotte", ["롯데마트", "lotte mart"], []],
    ["costco", "brand-costco", ["코스트코", "costco"], []],
  ];

  for (const [id, icon, names, excludedNames] of brandDefinitions) {
    const filters = [
      "all",
      ["match", ["geometry-type"], ["MultiPoint", "Point"], true, false],
      anyRetailFieldContains(names),
    ];
    if (excludedNames.length) {
      filters.push(["!", anyRetailFieldContains(excludedNames)]);
    }
    addRetailLayer({
      id: `retail-${id}`,
      icon,
      filter: filters,
    });
  }

  map.addSource("supplemental-convenience-stores", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "supplemental-convenience-symbols",
    type: "symbol",
    source: "supplemental-convenience-stores",
    minzoom: 13.5,
    layout: {
      "icon-image": [
        "match",
        ["get", "brand"],
        "gs25", "brand-gs25",
        "cu", "brand-cu",
        "seven", "brand-seven",
        "emart24", "brand-emart24",
        "ministop", "brand-ministop",
        "cspace", "brand-cspace",
        "iga", "brand-iga",
        "storyway", "brand-storyway",
        "convenience",
      ],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 13.5, 0.2, 17, 0.3],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-optional": false,
    },
  });

  document.body.dataset.retailBrandMatcherCount = String(brandDefinitions.length);
  document.body.dataset.retailFallbackEnabled = "false";
  document.body.dataset.gs25LayerReady = String(Boolean(map.getLayer("supplemental-convenience-symbols")));
}

function addTerrainNameLayers() {
  map.addLayer({
    id: "mountain-name-labels",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "mountain_peak",
    minzoom: 9,
    filter: ["has", "name"],
    layout: {
      "text-field": poiNameExpression(),
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 9, 10, 14, 12],
      "text-allow-overlap": false,
      "text-padding": 5,
    },
    paint: {
      "text-color": "#44633f",
      "text-halo-color": "rgba(255,255,255,0.9)",
      "text-halo-width": 1.4,
    },
  });

  map.addLayer({
    id: "river-name-labels",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "waterway",
    minzoom: 8,
    filter: ["all", ["has", "name"], ["==", ["get", "class"], "river"]],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 420,
      "text-field": poiNameExpression(),
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 14, 12],
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#3577ad",
      "text-halo-color": "rgba(255,255,255,0.88)",
      "text-halo-width": 1.3,
    },
  });
}

function stationDisplayNameExpression() {
  const name = poiNameExpression();
  return [
    "case",
    ["==", name, ""],
    "",
    ["==", ["slice", name, ["-", ["length", name], 1]], "역"],
    name,
    ["concat", name, "역"],
  ];
}

function stationExitNameExpression() {
  const name = poiNameExpression();
  return [
    "case",
    ["has", "ref"],
    ["concat", ["to-string", ["get", "ref"]], "번 출구"],
    [">=", ["index-of", "출구", name], 0],
    name,
    ["concat", name, " 출구"],
  ];
}

function stationExitFilter() {
  return [
    "all",
    ["match", ["geometry-type"], ["MultiPoint", "Point"], true, false],
    [
      "any",
      ["in", ["get", "class"], ["literal", ["entrance", "subway_entrance"]]],
      ["in", ["get", "subclass"], ["literal", ["entrance", "subway_entrance"]]],
    ],
  ];
}

function addStationNameLayer() {
  map.addLayer({
    id: "station-point-dots",
    type: "circle",
    source: "openmaptiles",
    "source-layer": "poi",
    minzoom: 12,
    filter: [
      "any",
      ["==", ["get", "class"], "rail"],
      ["in", ["get", "subclass"], ["literal", ["station", "halt", "subway", "railway"]]],
    ],
    paint: {
      "circle-color": "#ffffff",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2.8, 16, 4.2],
      "circle-stroke-color": "#315a7d",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 1.2, 16, 1.8],
    },
  });

  map.addLayer({
    id: "station-name-labels",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "poi",
    minzoom: 12,
    filter: [
      "any",
      ["==", ["get", "class"], "rail"],
      ["in", ["get", "subclass"], ["literal", ["station", "halt", "subway", "railway"]]],
    ],
    layout: {
      "text-field": stationDisplayNameExpression(),
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9.5, 16, 11.5],
      "text-anchor": "top",
      "text-offset": [0, 0.65],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-optional": true,
      "text-padding": 4,
    },
    paint: {
      "text-color": "#315a7d",
      "text-halo-color": "rgba(255,255,255,0.94)",
      "text-halo-width": 1.4,
    },
  });

  map.addLayer({
    id: "station-exit-dots",
    type: "circle",
    source: "openmaptiles",
    "source-layer": "poi",
    minzoom: 16,
    filter: stationExitFilter(),
    paint: {
      "circle-color": "#ffffff",
      "circle-radius": 2.6,
      "circle-stroke-color": "#495057",
      "circle-stroke-width": 1.2,
    },
  });

  map.addLayer({
    id: "station-exit-labels",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "poi",
    minzoom: 16,
    filter: ["all", stationExitFilter(), ["any", ["has", "ref"], ["has", "name"], ["has", "name:nonlatin"]]],
    layout: {
      "text-field": stationExitNameExpression(),
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 16, 9, 18, 10.5],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-padding": 3,
    },
    paint: {
      "text-color": "#495057",
      "text-halo-color": "rgba(255,255,255,0.96)",
      "text-halo-width": 1.2,
    },
  });

  document.body.dataset.stationLayersReady = String(
    Boolean(map.getLayer("station-name-labels")) && Boolean(map.getLayer("station-exit-labels")),
  );
}

async function addSubwayExitLayers() {
  const response = await fetch(SEOUL_SUBWAY_EXITS_URL);
  if (!response.ok) throw new Error(`Failed to load Seoul subway exits: ${response.status}`);
  const seoulExitData = await response.json();

  map.addSource("seoul-subway-exits", {
    type: "geojson",
    data: seoulExitData,
    attribution: "서울특별시 S-Map",
  });

  map.addLayer({
    id: "seoul-subway-exit-dots",
    type: "circle",
    source: "seoul-subway-exits",
    minzoom: 14.5,
    paint: {
      "circle-color": "#ffd43b",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 14.5, 5.5, 18, 8],
      "circle-stroke-color": "#525252",
      "circle-stroke-width": 1,
    },
  });

  map.addLayer({
    id: "seoul-subway-exit-numbers",
    type: "symbol",
    source: "seoul-subway-exits",
    minzoom: 14.5,
    filter: ["all", ["has", "enternum"], ["!=", ["get", "enternum"], ""]],
    layout: {
      "text-field": ["get", "enternum"],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 14.5, 8, 18, 10.5],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": "#343a40" },
  });

  map.addSource("korea-subway-exits", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "korea-subway-exit-dots",
    type: "circle",
    source: "korea-subway-exits",
    minzoom: 15,
    paint: {
      "circle-color": ["case", ["has", "ref"], "#ffd43b", "#ffffff"],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 4.5, 18, 7],
      "circle-stroke-color": "#525252",
      "circle-stroke-width": 1,
    },
  });

  map.addLayer({
    id: "korea-subway-exit-numbers",
    type: "symbol",
    source: "korea-subway-exits",
    minzoom: 15,
    filter: ["all", ["has", "ref"], ["!=", ["get", "ref"], ""]],
    layout: {
      "text-field": ["get", "ref"],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 15, 8, 18, 10],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": "#343a40" },
  });

  document.body.dataset.officialSubwayExitCount = String(seoulExitData.features?.length || 0);
  document.body.dataset.subwayExitLayerReady = "true";
}

function raiseSubwayExitLayers() {
  for (const layerId of [
    "korea-subway-exit-dots",
    "korea-subway-exit-numbers",
    "seoul-subway-exit-dots",
    "seoul-subway-exit-numbers",
  ]) {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  }
}

async function refreshVisibleSubwayExits() {
  if (map.getZoom() < 15 || !map.getSource("korea-subway-exits")) return;

  subwayExitRequestController?.abort();
  subwayExitRequestController = new AbortController();
  const bounds = map.getBounds();
  const bbox = [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()]
    .map((value) => value.toFixed(6))
    .join(",");
  const query = `[out:json][timeout:15];(
node["railway"="subway_entrance"](${bbox});
node["public_transport"="station_entrance"](${bbox});
node["entrance"]["ref"](${bbox});
node["subway"="yes"]["ref"](${bbox});
);out tags;`;

  try {
    const response = await fetch(SUBWAY_EXITS_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ data: query }),
      signal: subwayExitRequestController.signal,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    const payload = await response.json();
    const features = payload.elements.flatMap((element) => {
      if (!Number.isFinite(element.lon) || !Number.isFinite(element.lat)) return [];
      const tags = element.tags || {};
      return [{
        type: "Feature",
        id: element.id,
        properties: {
          ref: tags.ref || "",
          name: tags["name:ko"] || tags.name || "",
        },
        geometry: { type: "Point", coordinates: [element.lon, element.lat] },
      }];
    });

    map.getSource("korea-subway-exits")?.setData({ type: "FeatureCollection", features });
    raiseSubwayExitLayers();
    document.body.dataset.subwayExitCount = String(features.length);
    document.body.dataset.numberedSubwayExitCount = String(
      features.filter((feature) => feature.properties.ref).length,
    );
    delete document.body.dataset.subwayExitError;
  } catch (error) {
    if (error.name !== "AbortError") {
      document.body.dataset.subwayExitError = error.message;
    }
  }
}

function scheduleSubwayExitRefresh() {
  clearTimeout(subwayExitRefreshTimer);
  subwayExitRefreshTimer = setTimeout(refreshVisibleSubwayExits, 250);
}

async function fetchGzipJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load data: ${response.status} ${response.statusText}`);
  }

  if (window.pako) {
    const buffer = await response.arrayBuffer();
    const text = window.pako.ungzip(new Uint8Array(buffer), { to: "string" });
    return JSON.parse(text);
  }

  if (!response.body || !("DecompressionStream" in window)) {
    throw new Error("This browser cannot decompress gzip data.");
  }

  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return JSON.parse(text);
}

function adminFilter(level) {
  return ["==", ["get", "level"], level];
}

function cityParentName(name) {
  return String(name || "").match(/^(.+시)\s+.+구$/)?.[1] || null;
}

function mergeCityDistrictBoundaries(data) {
  const groups = new Map();

  for (const feature of data.features || []) {
    const properties = feature.properties || {};
    const cityName = cityParentName(properties.name || properties.sigungu);
    const key = cityName ? `${properties.macro_id}|${properties.sido}|${cityName}` : `feature|${properties.code}`;
    const group = groups.get(key) || { cityName, features: [] };
    group.features.push(feature);
    groups.set(key, group);
  }

  const features = [...groups.values()].map(({ cityName, features: groupedFeatures }) => {
    if (!cityName) return groupedFeatures[0];

    const polygons = [];
    let storeCount = 0;
    let weightedLng = 0;
    let weightedLat = 0;
    const sigunguNames = [];

    for (const feature of groupedFeatures) {
      if (feature.geometry?.type === "Polygon") polygons.push(feature.geometry.coordinates);
      if (feature.geometry?.type === "MultiPolygon") polygons.push(...feature.geometry.coordinates);
      const count = Number(feature.properties?.store_count || 0);
      storeCount += count;
      weightedLng += Number(feature.properties?.center_lng || 0) * count;
      weightedLat += Number(feature.properties?.center_lat || 0) * count;
      sigunguNames.push(...(feature.properties?.sigungu_names || [feature.properties?.sigungu]));
    }

    const first = groupedFeatures[0].properties || {};
    return {
      type: "Feature",
      properties: {
        ...first,
        code: `city:${first.sido}:${cityName}`,
        name: cityName,
        sigungu: cityName,
        sigungu_names: sigunguNames,
        store_count: storeCount,
        center_lng: storeCount ? weightedLng / storeCount : first.center_lng,
        center_lat: storeCount ? weightedLat / storeCount : first.center_lat,
      },
      geometry: { type: "MultiPolygon", coordinates: polygons },
    };
  });

  return { ...data, features };
}

function adminMacroFilter(level, macroId) {
  return ["all", adminFilter(level), ["==", ["get", "macro_id"], macroId]];
}

function stringArrayProperty(value, fallback) {
  if (Array.isArray(value) && value.length) return value;
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
  }
  return fallback ? [fallback] : [];
}

function adminSigunguFilter({ macroId, sido, sigungu, sigunguNames }) {
  const names = stringArrayProperty(sigunguNames, sigungu);
  const sigunguFilter = ["in", ["get", "sigungu"], ["literal", names]];

  return [
    "all",
    adminFilter("dong"),
    ["==", ["get", "macro_id"], macroId],
    ["==", ["get", "sido"], sido],
    sigunguFilter,
  ];
}

function boundaryParentFilter(properties) {
  const sigunguNames = stringArrayProperty(properties.sigungu_names, properties.sigungu);

  return [
    "all",
    ["==", ["get", "macro_id"], properties.macro_id],
    ["==", ["get", "sido"], properties.sido],
    ["in", ["get", "sigungu"], ["literal", sigunguNames]],
  ];
}

const ADMIN_LEVEL_LAYERS = {
  macro: ["food-admin-macro-fills", "food-admin-macro-labels"],
  sigungu: ["food-admin-sigungu-fills", "food-admin-sigungu-outlines", "food-admin-sigungu-labels"],
  dong: ["food-admin-dong-fills", "food-admin-dong-outlines", "food-admin-dong-labels"],
};

function hiddenAdminFilter() {
  return ["==", ["get", "macro_id"], "__none__"];
}

function setAdminLevelFilter(level, filter) {
  for (const layerId of ADMIN_LEVEL_LAYERS[level] || []) {
    if (!map.getLayer(layerId)) continue;
    if (map.getLayoutProperty(layerId, "visibility") === "none") {
      map.setLayoutProperty(layerId, "visibility", "visible");
    }
    const currentFilter = map.getFilter(layerId);
    if (JSON.stringify(currentFilter) !== JSON.stringify(filter)) {
      map.setFilter(layerId, filter);
    }
  }
}

function setActiveAdminBoundaries(key, features) {
  const source = map.getSource("food-active-admin-boundaries");
  const labelSource = map.getSource("food-active-admin-labels");
  if (!source || !labelSource) return;

  for (const layerId of [
    "food-active-admin-fills",
    "food-active-admin-outlines",
    "food-active-admin-labels",
  ]) {
    if (map.getLayer(layerId) && map.getLayoutProperty(layerId, "visibility") === "none") {
      map.setLayoutProperty(layerId, "visibility", "visible");
    }
  }

  if (activeAdminBoundaryKey === key) return;
  activeAdminBoundaryKey = key;
  source.setData({ type: "FeatureCollection", features });
  labelSource.setData({
    type: "FeatureCollection",
    features: features.map((feature) => ({
      type: "Feature",
      properties: feature.properties,
      geometry: {
        type: "Point",
        coordinates: [
          Number(feature.properties?.center_lng),
          Number(feature.properties?.center_lat),
        ],
      },
    })),
  });
  document.body.dataset.activeAdminBoundaryCount = String(features.length);
}

function activeSigunguFeatures(macroId) {
  return sigunguBoundaryData?.features?.filter(
    (feature) => feature.properties?.macro_id === macroId,
  ) || [];
}

function activeDongFeatures(properties) {
  const names = stringArrayProperty(properties.sigungu_names, properties.sigungu);
  return dongBoundaryData?.features?.filter((feature) => {
    const item = feature.properties || {};
    return item.macro_id === properties.macro_id && item.sido === properties.sido && names.includes(item.sigungu);
  }) || [];
}

function scheduleAdminPresentationRestore() {
  if (!activeAdminProperties || gpsTrackingActive || adminPresentationFrame != null) return;
  adminPresentationFrame = requestAnimationFrame(() => {
    adminPresentationFrame = null;
    updateAdminFilters(activeAdminProperties);
    document.body.dataset.adminPresentationRestoredAt = String(Date.now());
  });
}

function setFoodStoreLayersVisible(visible) {
  for (const layerId of [
    "food-store-clusters",
    "food-store-cluster-count",
    "food-store-single-points",
    "food-store-building-points",
  ]) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    }
  }
}

function updateBackButton() {
  const button = document.querySelector("#back-button");
  if (button) {
    button.disabled = adminNavigationStack.length === 0 && !gpsTrackingActive && !searchReturnState;
  }
  document.body.dataset.adminHistoryDepth = String(adminNavigationStack.length);
}

function rememberAdminNavigation(feature) {
  const bounds = geometryBounds(feature.geometry);
  adminNavigationStack.push({
    properties: { ...(feature.properties || {}) },
    bounds: bounds ? bounds.toArray() : null,
  });
  updateBackButton();
}

function updateAdminFilters(properties) {
  if (!properties?.level) {
    return;
  }

  activeAdminProperties = { ...properties };
  document.body.dataset.activeAdminLevel = properties.level;
  document.body.dataset.activeAdminName = properties.name || "";

  if (properties.level === "macro") {
    setAdminLevelFilter("macro", hiddenAdminFilter());
    setAdminLevelFilter("sigungu", hiddenAdminFilter());
    setAdminLevelFilter("dong", hiddenAdminFilter());
    setActiveAdminBoundaries(`macro:${properties.macro_id}`, activeSigunguFeatures(properties.macro_id));
    setFoodStoreLayersVisible(false);
    return;
  }

  if (properties.level === "sigungu") {
    setAdminLevelFilter("macro", hiddenAdminFilter());
    setAdminLevelFilter("sigungu", hiddenAdminFilter());
    setAdminLevelFilter("dong", hiddenAdminFilter());
    setActiveAdminBoundaries(
      `sigungu:${properties.macro_id}:${properties.sido}:${stringArrayProperty(properties.sigungu_names, properties.sigungu).join("|")}`,
      activeDongFeatures(properties),
    );
    setFoodStoreLayersVisible(false);
    return;
  }

  if (properties.level === "dong") {
    setAdminLevelFilter("macro", hiddenAdminFilter());
    setAdminLevelFilter("sigungu", hiddenAdminFilter());
    setAdminLevelFilter("dong", hiddenAdminFilter());
    setActiveAdminBoundaries("stores", []);
    setFoodStoreLayersVisible(true);
  }
}

function clearActiveAdminState() {
  activeAdminProperties = null;
  setActiveAdminBoundaries("none", []);
  delete document.body.dataset.activeAdminLevel;
  delete document.body.dataset.activeAdminName;
}

function adjustedAdminCamera(camera, properties) {
  if (!camera) {
    return null;
  }

  const currentZoom = map.getZoom();
  const fittedZoom = properties.level === "dong"
    ? Math.max(camera.zoom, currentZoom + 0.9, ZOOM_DONG_MAX + 0.3)
    : camera.zoom;

  return {
    ...camera,
    zoom: Math.min(fittedZoom, properties.level === "dong" ? 16 : 14.5),
  };
}

function adminFitOptions(level) {
  const padding = level === "macro" ? 8 : level === "sigungu" ? 12 : 18;
  return {
    padding: {
      top: padding,
      bottom: padding,
      left: padding,
      right: window.innerWidth < 700 ? 96 : 112,
    },
    offset: [0, 0],
    maxZoom: level === "dong" ? 16 : 14.5,
  };
}

function resetAdminFilters() {
  clearActiveAdminState();
  setAdminLevelFilter("macro", ["has", "macro_id"]);
  setAdminLevelFilter("sigungu", hiddenAdminFilter());
  setAdminLevelFilter("dong", hiddenAdminFilter());
  setFoodStoreLayersVisible(false);
}

function restoreAdminNavigation() {
  if (searchReturnState) {
    const previousSearchState = searchReturnState;
    searchReturnState = null;
    map.stop();
    closeStoreSheet();

    if (previousSearchState.activeAdminProperties?.level) {
      updateAdminFilters(previousSearchState.activeAdminProperties);
    } else {
      resetAdminFilters();
    }
    map.easeTo({ ...previousSearchState.camera, duration: 600 });
    recordMapView("search-back");
    updateBackButton();
    return;
  }

  if (gpsTrackingActive) {
    gpsUpdatesSuppressed = true;
    document.body.dataset.gpsUpdatesSuppressed = "true";
    resetGeolocateControl();
    map.stop();
    gpsTrackingActive = false;
    document.body.dataset.gpsTracking = "false";
    const current = adminNavigationStack.at(-1);

    if (current) {
      updateAdminFilters(current.properties);
      if (current.bounds) {
        const camera = map.cameraForBounds(current.bounds, adminFitOptions(current.properties.level));
        if (camera) map.easeTo({ ...camera, duration: 600 });
      }
    } else {
      resetAdminFilters();
      fitKoreaOverview({ animated: true });
    }

    recordMapView("gps-back");
    updateBackButton();
    return;
  }

  if (!adminNavigationStack.length) return;

  map.stop();
  adminNavigationStack.pop();
  const previous = adminNavigationStack.at(-1);

  if (!previous) {
    resetAdminFilters();
    fitKoreaOverview({ animated: true });
    recordMapView("admin-back-overview");
    updateBackButton();
    return;
  }

  updateAdminFilters(previous.properties);
  if (previous.bounds) {
    const camera = map.cameraForBounds(previous.bounds, adminFitOptions(previous.properties.level));
    if (camera) map.easeTo({ ...camera, duration: 600 });
  }
  recordMapView("admin-back");
  updateBackButton();
}

function recordMapView(reason = "move") {
  const center = map.getCenter();
  document.body.dataset.mapCenter = JSON.stringify([center.lng, center.lat]);
  document.body.dataset.mapZoom = String(map.getZoom());
  document.body.dataset.mapViewReason = reason;
}

function saveAutoUpdateState() {
  try {
    const center = map.getCenter();
    sessionStorage.setItem(AUTO_UPDATE_STATE_KEY, JSON.stringify({
      savedAt: Date.now(),
      camera: {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      },
      adminNavigationStack,
      activeAdminProperties,
      selectedFoodCategory,
    }));
  } catch {}
}

async function checkForAppUpdate() {
  if (autoUpdateCheckInProgress || document.visibilityState === "hidden") return;
  autoUpdateCheckInProgress = true;

  try {
    const response = await fetch(`${APP_VERSION_URL}?time=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const version = await response.json();
    document.body.dataset.deployedBuildId = version.build || "";
    if (version.build && version.build !== APP_BUILD_ID) {
      const lastReloadBuild = sessionStorage.getItem(AUTO_UPDATE_RELOAD_KEY);
      if (lastReloadBuild === version.build) {
        document.body.dataset.autoUpdateReady = "version-mismatch-held";
        return;
      }
      sessionStorage.setItem(AUTO_UPDATE_RELOAD_KEY, version.build);
      saveAutoUpdateState();
      window.location.reload();
    }
  } catch (error) {
    document.body.dataset.autoUpdateError = error.message;
  } finally {
    autoUpdateCheckInProgress = false;
  }
}

function startAutoUpdateWatcher() {
  document.body.dataset.appBuildId = APP_BUILD_ID;
  document.body.dataset.autoUpdateReady = "true";
  checkForAppUpdate();
  window.setInterval(checkForAppUpdate, AUTO_UPDATE_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForAppUpdate();
  });
}

function restoreAutoUpdateState() {
  if (!pendingAutoUpdateState) return;

  adminNavigationStack = Array.isArray(pendingAutoUpdateState.adminNavigationStack)
    ? pendingAutoUpdateState.adminNavigationStack
    : [];
  selectedFoodCategory = pendingAutoUpdateState.selectedFoodCategory || "all";
  if (pendingAutoUpdateState.activeAdminProperties?.level) {
    updateAdminFilters(pendingAutoUpdateState.activeAdminProperties);
    const macroId = pendingAutoUpdateState.activeAdminProperties.macro_id;
    if (macroId) {
      loadRegionalFoodStores(macroId).catch((error) => {
        document.body.dataset.foodStoreError = error.message;
      });
      loadRegionalConvenienceStores(macroId).catch((error) => {
        document.body.dataset.convenienceStoreError = error.message;
      });
    }
  } else {
    resetAdminFilters();
  }
  updateCategoryButtons();
  updateBackButton();
  if (pendingAutoUpdateState.camera) {
    map.jumpTo(pendingAutoUpdateState.camera);
  }
  document.body.dataset.autoUpdateStateRestored = "true";
}

function addAdminHierarchyLayers(data, macroBoundaries, sigunguBoundaries, dongBoundaries) {
  if (map.getSource("food-admin-hierarchy")) {
    return;
  }

  map.addSource("food-admin-hierarchy", {
    type: "geojson",
    data,
  });

  sigunguBoundaryData = mergeCityDistrictBoundaries(sigunguBoundaries);
  dongBoundaryData = dongBoundaries;
  addMacroBoundaryLayers(macroBoundaries);
  addSigunguBoundaryLayers(sigunguBoundaryData);
  addDongBoundaryLayers(dongBoundaryData);
  addActiveAdminBoundaryLayers();
}

function addActiveAdminBoundaryLayers() {
  map.addSource("food-active-admin-boundaries", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource("food-active-admin-labels", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "food-active-admin-fills",
    type: "fill",
    source: "food-active-admin-boundaries",
    minzoom: 0,
    maxzoom: 24,
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.52,
    },
  });
  map.addLayer({
    id: "food-active-admin-outlines",
    type: "line",
    source: "food-active-admin-boundaries",
    minzoom: 0,
    maxzoom: 24,
    paint: {
      "line-color": "#ffffff",
      "line-opacity": 0.94,
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 14, 2],
    },
  });
  map.addLayer({
    id: "food-active-admin-labels",
    type: "symbol",
    source: "food-active-admin-labels",
    minzoom: 0,
    maxzoom: 24,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 6, 10, 14, 12],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-padding": 3,
    },
    paint: {
      "text-color": "#3f3430",
      "text-halo-color": "rgba(255,255,255,0.9)",
      "text-halo-width": 1.4,
    },
  });
}

function addMacroBoundaryLayers(data) {
  map.addSource("food-macro-boundaries", {
    type: "geojson",
    data,
  });
  map.addSource("food-macro-label-points", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: data.features.map((feature) => ({
        type: "Feature",
        properties: feature.properties,
        geometry: {
          type: "Point",
          coordinates: [
            Number(feature.properties.center_lng),
            Number(feature.properties.center_lat),
          ],
        },
      })),
    },
  });

  map.addLayer({
    id: "food-admin-macro-fills",
    type: "fill",
    source: "food-macro-boundaries",
    minzoom: 0,
    maxzoom: 24,
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.6,
    },
  });

  map.addLayer({
    id: "food-admin-macro-labels",
    type: "symbol",
    source: "food-macro-label-points",
    minzoom: 0,
    maxzoom: 24,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 5, 11, ZOOM_MACRO_MAX, 13],
      "text-allow-overlap": true,
      "text-padding": 6,
    },
    paint: {
      "text-color": "#3f3430",
      "text-halo-color": "rgba(255,255,255,0.9)",
      "text-halo-width": 1.5,
    },
  });
}

function addSigunguBoundaryLayers(data) {
  map.addSource("food-sigungu-boundaries", {
    type: "geojson",
    data,
  });
  map.addSource("food-sigungu-label-points", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: data.features.map((feature) => ({
        type: "Feature",
        properties: feature.properties,
        geometry: {
          type: "Point",
          coordinates: [
            Number(feature.properties.center_lng),
            Number(feature.properties.center_lat),
          ],
        },
      })),
    },
  });

  const hiddenFilter = ["==", ["get", "macro_id"], "__none__"];

  map.addLayer({
    id: "food-admin-sigungu-fills",
    type: "fill",
    source: "food-sigungu-boundaries",
    minzoom: 0,
    maxzoom: 24,
    filter: hiddenFilter,
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.5,
    },
  });

  map.addLayer({
    id: "food-admin-sigungu-outlines",
    type: "line",
    source: "food-sigungu-boundaries",
    minzoom: 0,
    maxzoom: 24,
    filter: hiddenFilter,
    paint: {
      "line-color": "#ffffff",
      "line-opacity": 0.92,
      "line-width": ["interpolate", ["linear"], ["zoom"], ZOOM_MACRO_MAX, 1.1, ZOOM_SIGUNGU_MAX, 2],
    },
  });

  map.addLayer({
    id: "food-admin-sigungu-labels",
    type: "symbol",
    source: "food-sigungu-label-points",
    minzoom: 0,
    maxzoom: 24,
    filter: hiddenFilter,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 5.8, 11, ZOOM_MACRO_MAX, 12, ZOOM_SIGUNGU_MAX, 13],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-padding": 3,
    },
    paint: {
      "text-color": "#3f3430",
      "text-halo-color": "rgba(255,255,255,0.88)",
      "text-halo-width": 1.4,
    },
  });
}

function addDongBoundaryLayers(data) {
  map.addSource("food-dong-boundaries", {
    type: "geojson",
    data,
  });
  map.addSource("food-dong-label-points", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: data.features.map((feature) => ({
        type: "Feature",
        properties: feature.properties,
        geometry: {
          type: "Point",
          coordinates: [
            Number(feature.properties.center_lng),
            Number(feature.properties.center_lat),
          ],
        },
      })),
    },
  });

  const hiddenFilter = ["==", ["get", "macro_id"], "__none__"];

  map.addLayer({
    id: "food-admin-dong-fills",
    type: "fill",
    source: "food-dong-boundaries",
    minzoom: 0,
    maxzoom: 24,
    filter: hiddenFilter,
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.52,
    },
  });

  map.addLayer({
    id: "food-admin-dong-outlines",
    type: "line",
    source: "food-dong-boundaries",
    minzoom: 0,
    maxzoom: 24,
    filter: hiddenFilter,
    paint: {
      "line-color": "#ffffff",
      "line-opacity": 0.94,
      "line-width": ["interpolate", ["linear"], ["zoom"], ZOOM_SIGUNGU_MAX, 0.8, ZOOM_DONG_MAX, 1.7],
    },
  });

  map.addLayer({
    id: "food-admin-dong-labels",
    type: "symbol",
    source: "food-dong-label-points",
    minzoom: 0,
    maxzoom: 24,
    filter: hiddenFilter,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 8.8, 9.5, ZOOM_SIGUNGU_MAX, 10.5, ZOOM_DONG_MAX, 12],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-padding": 3,
    },
    paint: {
      "text-color": "#3f3430",
      "text-halo-color": "rgba(255,255,255,0.9)",
      "text-halo-width": 1.3,
    },
  });
}

function addAdminLevelLayers({ level, minzoom, maxzoom, circleId, labelId, color, radius, textSize }) {
  map.addLayer({
    id: circleId,
    type: "circle",
    source: "food-admin-hierarchy",
    minzoom,
    maxzoom,
    filter: adminFilter(level),
    paint: {
      "circle-color": color,
      "circle-opacity": 0.82,
      "circle-radius": radius,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.7,
    },
  });

  if (!labelId) {
    return;
  }

  map.addLayer({
    id: labelId,
    type: "symbol",
    source: "food-admin-hierarchy",
    minzoom,
    maxzoom,
    filter: adminFilter(level),
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": textSize,
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });
}

function addMainFoodStoreLayers(data) {
  if (map.getSource("food-stores")) {
    return;
  }

  map.addSource("food-stores", {
    type: "geojson",
    data,
    cluster: true,
    clusterMaxZoom: 15,
    clusterRadius: 44,
  });

  map.addLayer({
    id: "food-store-clusters",
    type: "circle",
    source: "food-stores",
    minzoom: ZOOM_DONG_MAX,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": ["step", ["get", "point_count"], "#ff6b6b", 100, "#f03e3e", 1000, "#c92a2a"],
      "circle-opacity": 0.78,
      "circle-radius": ["step", ["get", "point_count"], 14, 100, 19, 1000, 25],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });

  map.addLayer({
    id: "food-store-cluster-count",
    type: "symbol",
    source: "food-stores",
    minzoom: ZOOM_DONG_MAX,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["step", ["zoom"], "", 9.5, ["get", "point_count_abbreviated"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });

  map.addLayer({
    id: "food-store-single-points",
    type: "circle",
    source: "food-stores",
    minzoom: ZOOM_DONG_MAX,
    filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "g"], 1]],
    paint: {
      "circle-color": "#e03131",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 1.8, 12.7, 2.5, 16, 4.2],
      "circle-opacity": 0.86,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 0.8,
    },
  });

  map.addLayer({
    id: "food-store-building-points",
    type: "circle",
    source: "food-stores",
    minzoom: ZOOM_DONG_MAX,
    filter: ["all", ["!", ["has", "point_count"]], [">", ["get", "g"], 1]],
    paint: {
      "circle-color": "#2f9e44",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 2.2, 12.7, 3.4, 16, 5.5],
      "circle-opacity": 0.9,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
    },
  });

  setFoodStoreLayersVisible(false);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "");
}

function storeSearchShardKey(value) {
  const choseongKeys = [
    "g", "gg", "n", "d", "dd", "r", "m", "b", "bb", "s",
    "ss", "ng", "j", "jj", "ch", "k", "t", "p", "h",
  ];
  const first = [...normalizeSearchText(value)][0] || "";
  const code = first.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return choseongKeys[Math.floor((code - 0xac00) / 588)];
  }
  if (/[a-z]/.test(first)) return `latin-${first}`;
  if (/\d/.test(first)) return "digit";
  return "other";
}

async function loadStoreSearchShard(query) {
  if (!storeSearchManifest) {
    const response = await fetch(STORE_SEARCH_MANIFEST_URL);
    if (!response.ok) throw new Error(`Failed to load store search manifest: ${response.status}`);
    storeSearchManifest = await response.json();
  }

  const key = storeSearchShardKey(query);
  const shard = storeSearchManifest.shards?.[key];
  if (!shard) return [];
  if (!storeSearchShardCache.has(key)) {
    storeSearchShardCache.set(key, fetchGzipJson(`./data/${shard.file}`));
  }
  return storeSearchShardCache.get(key);
}

function searchAdministrativeAreas(query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  return adminSearchFeatures
    .filter((feature) => feature.properties?.level === "dong")
    .map((feature) => {
      const properties = feature.properties || {};
      const normalizedName = normalizeSearchText(properties.name);
      const normalizedAlias = normalizedName.replace(/(?:제)?\d+(?:[.·]\d+)?(?=동$)/, "");
      const exact = normalizedName === normalizedQuery || normalizedAlias === normalizedQuery;
      const startsWith = normalizedName.startsWith(normalizedQuery) || normalizedAlias.startsWith(normalizedQuery);
      const rank = exact ? 0 : startsWith ? 1 : 2;
      return { type: "admin", feature, properties, rank, normalizedName, normalizedAlias, exact };
    })
    .filter((result) => result.normalizedName.includes(normalizedQuery) || result.normalizedAlias.includes(normalizedQuery))
    .sort((a, b) => a.rank - b.rank || String(a.properties.sido).localeCompare(String(b.properties.sido), "ko-KR"));
}

async function searchStores(query) {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return [];
  const entries = await loadStoreSearchShard(normalizedQuery);

  return entries
    .filter((entry) => entry[0].includes(normalizedQuery))
    .map((entry) => ({
      type: "store",
      entry,
      rank: entry[0] === normalizedQuery ? 0 : entry[0].startsWith(normalizedQuery) ? 1 : 2,
    }))
    .sort((a, b) => a.rank - b.rank || a.entry[0].localeCompare(b.entry[0], "ko-KR") || a.entry[3].localeCompare(b.entry[3], "ko-KR"));
}

function adminResultSubtitle(properties) {
  return [properties.sido, properties.sigungu, properties.name].filter(Boolean).join(" ");
}

function renderSearchResults(results, query) {
  if (!searchResultsEl || !searchInputEl) return;
  currentSearchResults = results.slice(0, 80);
  searchInputEl.setAttribute("aria-expanded", "true");
  searchResultsEl.hidden = false;

  if (!results.length) {
    searchResultsEl.innerHTML = `<p class="search-empty">‘${escapeHtml(query)}’ 검색 결과가 없습니다.</p>`;
    return;
  }

  const items = currentSearchResults.map((result, index) => {
    if (result.type === "admin") {
      return `
        <button class="search-result" type="button" role="option" data-search-index="${index}">
          <small class="search-result-type">동네</small>
          <strong>${escapeHtml(result.properties.name)}</strong>
          <span>${escapeHtml(adminResultSubtitle(result.properties))}</span>
        </button>`;
    }

    const entry = result.entry;
    const branch = entry[2] ? ` ${escapeHtml(entry[2])}` : "";
    return `
      <button class="search-result" type="button" role="option" data-search-index="${index}">
        <small class="search-result-type">가게</small>
        <strong>${escapeHtml(entry[1])}${branch}</strong>
        <span>${escapeHtml(entry[3] || entry[4])}</span>
      </button>`;
  }).join("");
  const overflow = results.length > currentSearchResults.length
    ? `<p class="search-empty">검색 결과 ${results.length.toLocaleString()}개 중 앞의 ${currentSearchResults.length}개를 표시합니다.</p>`
    : "";
  searchResultsEl.innerHTML = items + overflow;
  document.body.dataset.searchResultCount = String(results.length);
}

function closeSearchResults() {
  if (!searchResultsEl || !searchInputEl) return;
  searchResultsEl.hidden = true;
  searchInputEl.setAttribute("aria-expanded", "false");
}

function rememberSearchReturnState() {
  if (searchReturnState) return;
  const center = map.getCenter();
  searchReturnState = {
    camera: {
      center: [center.lng, center.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    },
    activeAdminProperties: activeAdminProperties ? { ...activeAdminProperties } : null,
  };
  updateBackButton();
}

function stopGpsForSearch() {
  if (!gpsTrackingActive) return;
  gpsUpdatesSuppressed = true;
  document.body.dataset.gpsUpdatesSuppressed = "true";
  resetGeolocateControl();
  gpsTrackingActive = false;
  document.body.dataset.gpsTracking = "false";
}

function boundaryFeatureForAdmin(properties) {
  if (properties.level === "macro") {
    return macroBoundaryData?.features?.find((feature) => feature.properties?.macro_id === properties.macro_id);
  }
  if (properties.level === "sigungu") {
    return sigunguBoundaryData?.features?.find((feature) => {
      const item = feature.properties || {};
      return item.macro_id === properties.macro_id && item.sido === properties.sido &&
        stringArrayProperty(item.sigungu_names, item.sigungu).includes(properties.sigungu);
    });
  }
  return dongBoundaryData?.features?.find((feature) => {
    const item = feature.properties || {};
    return item.macro_id === properties.macro_id && item.sido === properties.sido && item.sigungu === properties.sigungu &&
      (item.name === properties.name || stringArrayProperty(item.dong_names, item.name).includes(properties.name));
  });
}

async function focusAdminSearchResult(result) {
  const properties = result.properties;
  const boundaryFeature = boundaryFeatureForAdmin(properties);
  rememberSearchReturnState();
  stopGpsForSearch();
  closeStoreSheet();
  updateAdminFilters(properties);
  closeSearchResults();

  if (properties.macro_id) {
    await Promise.allSettled([
      loadRegionalFoodStores(properties.macro_id),
      loadRegionalConvenienceStores(properties.macro_id),
    ]);
  }

  const bounds = boundaryFeature ? geometryBounds(boundaryFeature.geometry) : null;
  if (bounds) {
    const camera = map.cameraForBounds(bounds, adminFitOptions("dong"));
    const adjustedCamera = adjustedAdminCamera(camera, properties);
    if (adjustedCamera) map.easeTo({ ...adjustedCamera, duration: 700 });
  } else {
    map.easeTo({
      center: [Number(properties.center_lng), Number(properties.center_lat)],
      zoom: 14.5,
      duration: 700,
    });
  }
  document.body.dataset.lastSearchSelection = `admin:${adminResultSubtitle(properties)}`;
}

async function focusStoreSearchResult(result) {
  const entry = result.entry;
  rememberSearchReturnState();
  stopGpsForSearch();
  clearActiveAdminState();
  setAdminLevelFilter("macro", hiddenAdminFilter());
  setAdminLevelFilter("sigungu", hiddenAdminFilter());
  setAdminLevelFilter("dong", hiddenAdminFilter());
  setFoodStoreLayersVisible(true);
  closeSearchResults();

  await Promise.allSettled([
    loadRegionalFoodStores(entry[7]),
    loadRegionalConvenienceStores(entry[7]),
  ]);
  map.easeTo({ center: [entry[5], entry[6]], zoom: 17, duration: 700 });
  // Search index entry[0] is normalized search text, not a durable store ID.
  // Leave the ID empty so visit verification derives one from stable store data and coordinates.
  const store = [entry[1], entry[2], entry[8], entry[9], ""];
  openStoreSheet(
    {
      l: [store],
      a: entry[3],
      r: entry[4],
      g: 1,
    },
    {
      name: entry[1],
      category: [entry[8], entry[9]].filter(Boolean).join(" / "),
      visitContext: createVisitContext(store, [entry[5], entry[6]], entry[3]),
    },
  );
  document.body.dataset.lastSearchSelection = `store:${entry[1]}`;
}

async function selectSearchResult(result) {
  if (!result) return;
  if (result.type === "admin") await focusAdminSearchResult(result);
  else await focusStoreSearchResult(result);
}

async function performMapSearch(query, navigateUnique = false) {
  const normalizedQuery = normalizeSearchText(query);
  const requestId = ++searchRequestId;
  if (!normalizedQuery) {
    closeSearchResults();
    return;
  }

  searchResultsEl.hidden = false;
  searchResultsEl.innerHTML = '<p class="search-empty">검색 중...</p>';
  try {
    const [adminResults, storeResults] = await Promise.all([
      Promise.resolve(searchAdministrativeAreas(normalizedQuery)),
      searchStores(normalizedQuery),
    ]);
    if (requestId !== searchRequestId) return;
    const results = [...adminResults, ...storeResults]
      .sort((a, b) => a.rank - b.rank || Number(b.type === "admin") - Number(a.type === "admin"));
    const exactResults = results.filter((result) => {
      return result.type === "admin" ? result.exact : result.entry[0] === normalizedQuery;
    });

    if (navigateUnique && exactResults.length === 1) {
      await selectSearchResult(exactResults[0]);
      return;
    }
    renderSearchResults(results, query);
  } catch (error) {
    if (requestId !== searchRequestId) return;
    searchResultsEl.innerHTML = '<p class="search-empty">검색 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>';
    document.body.dataset.searchError = error.message;
  }
}

function setupMapSearch() {
  if (!searchFormEl || !searchInputEl || !searchResultsEl || searchFormEl.dataset.ready) return;
  searchFormEl.dataset.ready = "true";
  searchInputEl.disabled = false;
  searchInputEl.placeholder = "오늘 뭐 먹으러 갈까?";
  searchFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(searchDebounceTimer);
    performMapSearch(searchInputEl.value, true);
  });
  searchInputEl.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    const query = searchInputEl.value.trim();
    if (!query) {
      closeSearchResults();
      return;
    }
    searchDebounceTimer = setTimeout(() => performMapSearch(query), 260);
  });
  searchInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSearchResults();
      searchInputEl.blur();
    }
  });
  searchInputEl.addEventListener("focus", () => {
    if (currentSearchResults.length && searchInputEl.value.trim()) {
      searchResultsEl.hidden = false;
      searchInputEl.setAttribute("aria-expanded", "true");
    }
  });
  searchResultsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-search-index]");
    if (!button) return;
    selectSearchResult(currentSearchResults[Number(button.dataset.searchIndex)]);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("#search-panel")) closeSearchResults();
  });
  document.body.dataset.mapSearchReady = "true";
}

function parseStoreList(properties) {
  if (Array.isArray(properties.l)) {
    return properties.l;
  }

  if (typeof properties.l === "string" && properties.l) {
    try {
      return JSON.parse(properties.l);
    } catch {
      return [];
    }
  }

  return [];
}

function isExcludedFoodStore(store) {
  if (!Array.isArray(store)) {
    return false;
  }

  const text = [store[0], store[1], store[2], store[3]]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return EXCLUDED_FOOD_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
}

function removeExcludedFoodStores(data) {
  return {
    ...data,
    features: (data.features || [])
      .map((feature) => {
        const stores = parseStoreList(feature.properties || {});
        const keptStores = stores.filter((store) => !isExcludedFoodStore(store));
        if (!keptStores.length) {
          return null;
        }
        if (keptStores.length === stores.length) {
          return feature;
        }

        return {
          ...feature,
          properties: {
            ...feature.properties,
            l: keptStores,
            g: keptStores.length,
            category_ids: "",
            category_labels: "",
          },
        };
      })
      .filter(Boolean),
  };
}

function normalizedStoreCategories(properties) {
  const categories = new Set();
  for (const store of parseStoreList(properties)) {
    if (!Array.isArray(store)) {
      continue;
    }

    const text = [store[2], store[3]].filter(Boolean).join(" ");
    let matched = false;
    for (const category of FOOD_CATEGORY_FILTERS) {
      if (!category.keywords?.length) {
        continue;
      }

      if (category.keywords.some((keyword) => text.includes(keyword))) {
        categories.add(category.id);
        matched = true;
      }
    }

    if (!matched) {
      categories.add("other");
    }
  }

  if (!categories.size) {
    categories.add("other");
  }

  return [...categories];
}

function prepareFoodStoreCategories(data) {
  for (const feature of data.features || []) {
    if (feature.properties?.category_ids) {
      continue;
    }
    const categories = normalizedStoreCategories(feature.properties || {});
    feature.properties.category_ids = categories.join("|");
    feature.properties.category_labels = categories
      .map((id) => FOOD_CATEGORY_FILTERS.find((category) => category.id === id)?.label)
      .filter(Boolean)
      .join(", ");
  }
  return data;
}

function foodCategoryFeatureMatches(feature, categoryId) {
  if (categoryId === "all") {
    return true;
  }

  return String(feature.properties?.category_ids || "")
    .split("|")
    .includes(categoryId);
}

function filteredFoodStoreData(categoryId) {
  if (!fullFoodStoreData || categoryId === "all") {
    return fullFoodStoreData;
  }

  return {
    ...fullFoodStoreData,
    features: fullFoodStoreData.features.filter((feature) => foodCategoryFeatureMatches(feature, categoryId)),
  };
}

function updateCategoryButtons() {
  if (!categoryPanelEl) {
    return;
  }

  categoryPanelEl.querySelectorAll(".category-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.category === selectedFoodCategory);
  });
}

function applyFoodCategory(categoryId) {
  const source = map.getSource("food-stores");
  selectedFoodCategory = categoryId;
  updateCategoryButtons();

  if (!source || !fullFoodStoreData) {
    setStatus("먼저 지도에서 지역을 선택해 주세요.");
    return;
  }

  const data = filteredFoodStoreData(categoryId);
  source.setData(data);

  const category = FOOD_CATEGORY_FILTERS.find((item) => item.id === categoryId);
  const count = data?.features?.reduce((total, feature) => total + Number(feature.properties?.g || 1), 0) || 0;
  document.body.dataset.selectedFoodCategory = categoryId;
  document.body.dataset.visibleFoodStoreCount = String(count);
  setStatus(`${category?.label || "선택"} 식당 ${count.toLocaleString()}곳을 표시 중입니다.`);
}

async function loadRegionalFoodStores(macroId) {
  if (!macroId || loadedFoodMacroId === macroId) return;

  const token = ++foodStoreLoadToken;
  setStatus("선택한 지역의 식당 좌표를 불러오는 중입니다...");
  const data = prepareFoodStoreCategories(
    removeExcludedFoodStores(await fetchGzipJson(FOOD_STORES_REGIONAL_URL(macroId))),
  );
  if (token !== foodStoreLoadToken) return;

  fullFoodStoreData = data;
  loadedFoodMacroId = macroId;
  const visibleData = filteredFoodStoreData(selectedFoodCategory);
  map.getSource("food-stores")?.setData(visibleData);

  const pointCount = data.features?.length || 0;
  const storeCount = data.features?.reduce((sum, feature) => sum + Number(feature.properties?.g || 1), 0) || 0;
  document.body.dataset.loadedFoodMacroId = macroId;
  document.body.dataset.foodDotCount = String(pointCount);
  document.body.dataset.foodStoreCount = String(storeCount);
  setStatus(`${storeCount.toLocaleString()}개 식당을 불러왔습니다.`);
}

async function loadRegionalConvenienceStores(macroId) {
  if (!macroId || loadedConvenienceMacroId === macroId) return;

  const token = ++convenienceStoreLoadToken;
  const data = await fetchGzipJson(CONVENIENCE_STORES_REGIONAL_URL(macroId));
  if (token !== convenienceStoreLoadToken) return;

  map.getSource("supplemental-convenience-stores")?.setData(data);
  loadedConvenienceMacroId = macroId;
  document.body.dataset.loadedConvenienceMacroId = macroId;
  document.body.dataset.convenienceStoreCount = String(data.features?.length || 0);
}

function setupCategoryPanel() {
  if (!categoryPanelEl) {
    return;
  }

  categoryPanelEl.innerHTML = FOOD_CATEGORY_FILTERS.map(
    (category) => `
      <button
        class="category-button"
        type="button"
        data-category="${category.id}"
        style="--category-color: ${category.color}"
      >
        ${category.label}
      </button>
    `,
  ).join("");

  categoryPanelEl.addEventListener("click", (event) => {
    const button = event.target.closest(".category-button");
    if (!button) {
      return;
    }

    applyFoodCategory(button.dataset.category || "all");
  });

  updateCategoryButtons();
}

function closeStoreSheet(options = {}) {
  const preserveDragOffset = options.preserveDragOffset === true;
  storeSheetEl?.classList.remove("is-open");
  storeSheetEl?.classList.remove("is-dragging");
  storeSheetOverlayEl?.classList.remove("is-open");
  selectedMarkerIndicatorEl?.classList.remove("is-selected");
  selectedMarkerIndicatorEl?.classList.remove("is-multi-store");
  selectedMarkerCoordinates = null;
  multiStoreSheetState = null;
  activeRestaurantVisitContext = null;
  window.FoodMileVisitVerification?.close({ restoreFocus: false });
  storeSheetEl?.classList.remove("is-multi-store", "is-multi-detail");
  storeSheetEl?.setAttribute("aria-hidden", "true");
  document.body.dataset.storeSheetOpen = "false";
  document.body.dataset.storeSheetMode = "closed";
  delete document.body.dataset.multiStoreCount;

  window.clearTimeout(storeSheetDragResetTimer);
  if (storeSheetEl) {
    if (preserveDragOffset) {
      storeSheetDragResetTimer = window.setTimeout(() => {
        storeSheetEl.style.setProperty("--store-sheet-drag-y", "0px");
      }, 220);
    } else {
      storeSheetEl.style.setProperty("--store-sheet-drag-y", "0px");
    }
  }
}

function updateSelectedMarkerPosition() {
  if (!selectedMarkerIndicatorEl || !selectedMarkerCoordinates) {
    return;
  }

  const point = map.project(selectedMarkerCoordinates);
  const mapBounds = map.getContainer().getBoundingClientRect();
  selectedMarkerIndicatorEl.style.left = `${mapBounds.left + point.x}px`;
  selectedMarkerIndicatorEl.style.top = `${mapBounds.top + point.y}px`;
}

function selectRestaurantMarker(feature, markerType = "single") {
  const coordinates = feature?.geometry?.coordinates;
  if (!selectedMarkerIndicatorEl || !Array.isArray(coordinates)) {
    return;
  }

  selectedMarkerCoordinates = coordinates;
  updateSelectedMarkerPosition();
  selectedMarkerIndicatorEl.classList.toggle("is-multi-store", markerType === "multi");
  selectedMarkerIndicatorEl.classList.add("is-selected");
}

function gentlyFocusSelectedMarker() {
  const focusOffset = Math.min(36, Math.max(24, window.innerHeight * 0.035));
  map.panBy([0, focusOffset], {
    duration: 200,
    easing: (progress) => 1 - (1 - progress) ** 3,
  });
}

function stableVisitFallbackId(store, coordinates, address) {
  const source = [coordinates?.[0], coordinates?.[1], store?.[0], store?.[1], address]
    .filter((value) => value != null && value !== "")
    .join("|");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `foodmile_${(hash >>> 0).toString(36)}`;
}

function createVisitContext(store, coordinates, address = "") {
  const latitude = Number(coordinates?.[1]);
  const longitude = Number(coordinates?.[0]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const name = [store?.[0] || "이름 미등록", store?.[1]].filter(Boolean).join(" ");
  return {
    storeId: String(store?.[4] || stableVisitFallbackId(store, coordinates, address)),
    name,
    latitude,
    longitude,
  };
}

function isVisitVerified(visitContext) {
  return Boolean(
    visitContext?.storeId &&
      window.FoodMileVisitVerification?.isRecentlyVerified(visitContext.storeId),
  );
}

function storeSheetHtml(properties, options = {}) {
  const stores = parseStoreList(properties);
  const groupCount = Number(properties.g || stores.length || 1);
  const distance = escapeHtml(options.distance || "120m");
  const verified = isVisitVerified(options.visitContext);
  const todayCheckins = Math.max(8, Math.min(88, groupCount * 5 + 13)) + Number(verified);
  const [storeName, branch, middle, small] = Array.isArray(stores[0]) ? stores[0] : [];
  const groupedName = groupCount > 1 ? `이 위치의 식당 ${groupCount.toLocaleString()}곳` : "";
  const name = escapeHtml(options.name || groupedName || storeName || properties.n || "상호명 없음");
  const branchText = branch ? ` ${escapeHtml(branch)}` : "";
  const rawCategory = options.category || [middle, small].filter(Boolean).join(" / ");
  const category = escapeHtml(groupCount > 1 ? "맛집 모음" : rawCategory || "맛집");

  return `
    <article class="sheet-card">
      <div class="sheet-image" role="img" aria-label="${name} 대표 음식 이미지">
        <span class="sheet-image-plate" aria-hidden="true"></span>
      </div>
      <div class="sheet-main">
        <p class="sheet-pill">${category.split(" / ")[0] || "맛집"}</p>
        <h2>${name}${branchText}</h2>
        <p class="sheet-hours"><strong>영업중</strong><span>오늘 22:00까지</span></p>
        <p class="sheet-distance-row"><span>${distance}</span><span>가까운 FoodMile</span></p>
      </div>
      <section class="foodmile-stats" aria-label="FoodMile 활동 정보">
        <div><span>오늘 인증</span><strong data-today-checkins="${todayCheckins}">${todayCheckins}명</strong></div>
        <div><span>친구 방문</span><strong>2명</strong></div>
        <div><span>오늘 인기</span><strong class="foodmile-stars">★★★★★</strong></div>
        <div><span>FoodMile Point</span><strong class="foodmile-point">+20P</strong></div>
      </section>
      <div class="sheet-tags"><span>#혼밥</span><span>#데이트</span><span>#매운맛</span><span>#가성비</span><span>#웨이팅없음</span></div>
      <div class="sheet-actions">
        <button type="button" aria-label="${name} 상세보기">상세보기</button>
        <button class="sheet-primary${verified ? " is-verified" : ""}" type="button" data-visit-verify aria-label="${verified ? `${name} 오늘 방문 인증 완료` : `${name} 방문 인증`}" aria-busy="false" ${verified ? "disabled" : ""}>${verified ? "✓ 오늘 인증 완료" : "방문 인증"}</button>
      </div>
    </article>
  `;
}

function applyVisitVerificationSuccess(result) {
  if (result?.context?.storeId !== activeRestaurantVisitContext?.storeId) {
    return;
  }
  const visitButton = storeSheetContentEl?.querySelector("[data-visit-verify]");
  if (visitButton) {
    visitButton.classList.remove("is-locating");
    visitButton.classList.add("is-verified");
    visitButton.disabled = true;
    visitButton.setAttribute("aria-busy", "false");
    visitButton.setAttribute("aria-label", `${activeRestaurantVisitContext.name} 오늘 방문 인증 완료`);
    visitButton.textContent = "✓ 오늘 인증 완료";
  }
  const todayCheckins = storeSheetContentEl?.querySelector("[data-today-checkins]");
  if (todayCheckins && !todayCheckins.dataset.visitIncremented) {
    const nextCount = Number.parseInt(todayCheckins.dataset.todayCheckins || todayCheckins.textContent, 10) + 1;
    todayCheckins.dataset.todayCheckins = String(nextCount);
    todayCheckins.dataset.visitIncremented = "true";
    todayCheckins.textContent = `${nextCount}명`;
  }
  document.body.dataset.demoPoints = String(result.points);
  document.body.dataset.lastVisitVerification = JSON.stringify({
    storeId: result.record.storeId,
    distanceMeters: result.record.distanceMeters,
    accuracy: result.record.accuracy,
    mode: result.record.mode,
  });
}

function startVisitVerification(triggerButton) {
  if (!activeRestaurantVisitContext || !window.FoodMileVisitVerification) {
    setStatus("선택한 가게의 위치 정보를 확인할 수 없습니다.");
    return;
  }
  window.FoodMileVisitVerification.open(
    { ...activeRestaurantVisitContext, triggerButton },
    { onVerified: applyVisitVerificationSuccess },
  );
}

function storeFloorInfo(store) {
  const source = [store?.[0], store?.[1]].filter(Boolean).join(" ");
  const basementMatch = source.match(/지하\s*(\d+)?\s*(?:층|상가|광장|$)/);
  if (basementMatch) {
    const level = Number(basementMatch[1] || 1);
    return { rank: -level, label: `지하 ${level}층` };
  }

  const floorMatch = source.match(/(?:^|\D)(\d{1,2})\s*층/);
  if (floorMatch) {
    const level = Number(floorMatch[1]);
    return { rank: level, label: `${level}층` };
  }

  return { rank: null, label: "" };
}

function multiStoreEntries(properties) {
  return parseStoreList(properties).map((store, originalIndex) => {
    const [rawName, branch, middle, small, id] = Array.isArray(store) ? store : [];
    const floor = storeFloorInfo(store);
    return {
      store: Array.isArray(store) ? store : [],
      originalIndex,
      id: String(id || originalIndex),
      name: rawName || "이름 미등록",
      branch: branch || "",
      category: [middle, small].filter(Boolean).join(" · ") || "업종 정보 없음",
      floorRank: floor.rank,
      floorLabel: floor.label,
    };
  }).sort((left, right) => {
    const leftHasFloor = left.floorRank != null;
    const rightHasFloor = right.floorRank != null;
    if (leftHasFloor && rightHasFloor && left.floorRank !== right.floorRank) {
      return left.floorRank - right.floorRank;
    }
    if (leftHasFloor !== rightHasFloor) {
      return leftHasFloor ? -1 : 1;
    }
    if (!leftHasFloor && !rightHasFloor) {
      return left.originalIndex - right.originalIndex;
    }
    return left.category.localeCompare(right.category, "ko") || left.name.localeCompare(right.name, "ko");
  });
}

function multiStoreListHtml(properties, entries) {
  const address = String(properties.a || "").trim();
  const rows = entries.map((entry, index) => {
    const location = [entry.floorLabel, address].filter(Boolean).join(" · ");
    const displayName = [entry.name, entry.branch].filter(Boolean).join(" ");
    return `
      <button class="multi-store-row" type="button" data-multi-store-index="${index}" aria-label="${escapeHtml(displayName)} 상세 보기">
        <span class="multi-store-row-copy">
          <strong>${escapeHtml(displayName)}</strong>
          <span class="multi-store-category">${escapeHtml(entry.category)}</span>
          ${location ? `<span class="multi-store-location">${escapeHtml(location)}</span>` : ""}
          <span class="multi-store-hours">영업정보 준비중</span>
        </span>
        <span class="multi-store-arrow" aria-hidden="true">›</span>
      </button>
    `;
  }).join("");

  return `
    <section class="multi-store-list-view" aria-label="이 위치의 음식점 목록">
      <header class="multi-store-header">
        <div>
          <h2>이 위치의 음식점</h2>
          <p>${entries.length.toLocaleString()}개 매장</p>
        </div>
      </header>
      <div class="multi-store-list" role="list">${rows}</div>
    </section>
    <section class="multi-store-detail-view" aria-label="선택한 음식점 상세" hidden></section>
  `;
}

function openMultiStoreDetail(index) {
  if (!multiStoreSheetState || !storeSheetContentEl) {
    return;
  }

  const entry = multiStoreSheetState.entries[index];
  const listView = storeSheetContentEl.querySelector(".multi-store-list-view");
  const list = storeSheetContentEl.querySelector(".multi-store-list");
  const detailView = storeSheetContentEl.querySelector(".multi-store-detail-view");
  if (!entry || !listView || !list || !detailView) {
    return;
  }

  multiStoreSheetState.scrollTop = list.scrollTop;
  multiStoreSheetState.selectedIndex = index;
  list.querySelectorAll(".multi-store-row").forEach((row, rowIndex) => {
    row.classList.toggle("is-selected", rowIndex === index);
  });

  const detailProperties = {
    ...multiStoreSheetState.properties,
    g: 1,
    l: [entry.store],
  };
  activeRestaurantVisitContext = createVisitContext(
    entry.store,
    multiStoreSheetState.coordinates,
    multiStoreSheetState.properties.a,
  );
  detailView.innerHTML = `
    <button class="multi-store-back" type="button" aria-label="다중매장 목록으로 돌아가기">← 목록으로</button>
    ${storeSheetHtml(detailProperties, {
      name: entry.name,
      category: entry.category.replace(" · ", " / "),
      visitContext: activeRestaurantVisitContext,
    })}
  `;
  listView.hidden = true;
  detailView.hidden = false;
  storeSheetEl?.classList.remove("is-multi-store");
  storeSheetEl?.classList.add("is-multi-detail");
  document.body.dataset.storeSheetMode = "multi-detail";
}

function restoreMultiStoreList() {
  if (!multiStoreSheetState || !storeSheetContentEl) {
    return;
  }

  const listView = storeSheetContentEl.querySelector(".multi-store-list-view");
  const list = storeSheetContentEl.querySelector(".multi-store-list");
  const detailView = storeSheetContentEl.querySelector(".multi-store-detail-view");
  if (!listView || !list || !detailView) {
    return;
  }

  detailView.hidden = true;
  activeRestaurantVisitContext = null;
  listView.hidden = false;
  storeSheetEl?.classList.remove("is-multi-detail");
  storeSheetEl?.classList.add("is-multi-store");
  list.scrollTop = multiStoreSheetState.scrollTop;
  document.body.dataset.storeSheetMode = "multi-list";
}

function openMultiStoreSheet(feature, entries) {
  if (!storeSheetEl || !storeSheetContentEl) {
    return;
  }

  const properties = feature.properties || {};
  activeRestaurantVisitContext = null;
  multiStoreSheetState = {
    coordinates: [...feature.geometry.coordinates],
    properties: { ...properties },
    entries,
    scrollTop: 0,
    selectedIndex: null,
  };
  window.clearTimeout(storeSheetDragResetTimer);
  storeSheetEl.style.setProperty("--store-sheet-drag-y", "0px");
  storeSheetContentEl.innerHTML = multiStoreListHtml(properties, entries);
  storeSheetEl.classList.remove("is-multi-detail");
  storeSheetEl.classList.add("is-multi-store", "is-open");
  storeSheetOverlayEl?.classList.add("is-open");
  storeSheetEl.setAttribute("aria-hidden", "false");
  document.body.dataset.storeSheetOpen = "true";
  document.body.dataset.storeSheetMode = "multi-list";
  document.body.dataset.multiStoreCount = String(entries.length);
}

function openStoreSheet(properties, options = {}) {
  if (!storeSheetEl || !storeSheetContentEl) {
    return;
  }
  window.clearTimeout(storeSheetDragResetTimer);
  multiStoreSheetState = null;
  activeRestaurantVisitContext = options.visitContext || null;
  storeSheetEl.classList.remove("is-multi-store", "is-multi-detail");
  storeSheetEl.style.setProperty("--store-sheet-drag-y", "0px");
  storeSheetContentEl.innerHTML = storeSheetHtml(properties || {}, options);
  storeSheetOverlayEl?.classList.add("is-open");
  storeSheetEl.classList.add("is-open");
  storeSheetEl.setAttribute("aria-hidden", "false");
  document.body.dataset.storeSheetOpen = "true";
  document.body.dataset.storeSheetMode = "restaurant-detail";
  delete document.body.dataset.multiStoreCount;
}

storeSheetEl?.querySelector(".store-sheet-close")?.addEventListener("click", closeStoreSheet);
storeSheetOverlayEl?.addEventListener("click", closeStoreSheet);
storeSheetContentEl?.addEventListener("click", (event) => {
  const visitButton = event.target.closest("[data-visit-verify]");
  if (visitButton) {
    startVisitVerification(visitButton);
    return;
  }

  const backButton = event.target.closest(".multi-store-back");
  if (backButton) {
    restoreMultiStoreList();
    return;
  }

  const row = event.target.closest("[data-multi-store-index]");
  if (row) {
    openMultiStoreDetail(Number(row.dataset.multiStoreIndex));
  }
});

const storeSheetHandleEl = storeSheetEl?.querySelector(".store-sheet-handle");

storeSheetHandleEl?.addEventListener("pointerdown", (event) => {
  if (!storeSheetEl?.classList.contains("is-open") || event.button > 0) {
    return;
  }

  event.preventDefault();
  storeSheetHandleEl.setPointerCapture?.(event.pointerId);
  storeSheetDragState = {
    pointerId: event.pointerId,
    startY: event.clientY,
    lastY: event.clientY,
    lastTime: performance.now(),
    velocity: 0,
  };
  storeSheetEl.classList.add("is-dragging");
});

storeSheetHandleEl?.addEventListener("pointermove", (event) => {
  if (!storeSheetDragState || storeSheetDragState.pointerId !== event.pointerId) {
    return;
  }

  const now = performance.now();
  const deltaTime = Math.max(1, now - storeSheetDragState.lastTime);
  storeSheetDragState.velocity = (event.clientY - storeSheetDragState.lastY) / deltaTime;
  storeSheetDragState.lastY = event.clientY;
  storeSheetDragState.lastTime = now;
  const dragY = Math.max(0, event.clientY - storeSheetDragState.startY);
  storeSheetEl.style.setProperty("--store-sheet-drag-y", `${dragY}px`);
});

function finishStoreSheetDrag(event) {
  if (!storeSheetDragState || storeSheetDragState.pointerId !== event.pointerId) {
    return;
  }

  const dragY = Math.max(0, event.clientY - storeSheetDragState.startY);
  const shouldClose = dragY > 72 || (dragY > 20 && storeSheetDragState.velocity > 0.45);
  storeSheetDragState = null;
  storeSheetEl?.classList.remove("is-dragging");

  if (shouldClose) {
    closeStoreSheet({ preserveDragOffset: true });
  } else {
    storeSheetEl?.style.setProperty("--store-sheet-drag-y", "0px");
  }
}

storeSheetHandleEl?.addEventListener("pointerup", finishStoreSheetDrag);
storeSheetHandleEl?.addEventListener("pointercancel", finishStoreSheetDrag);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && storeSheetEl?.classList.contains("is-open")) {
    closeStoreSheet();
  }
});

async function loadFoodStores() {
  setStatus("행정구역 지도를 불러오는 중입니다...");
  const [adminData, macroBoundaries, sigunguBoundaries, dongBoundaries] = await Promise.all([
    fetchGzipJson(FOOD_ADMIN_HIERARCHY_GEOJSON_GZ_URL),
    fetch(FOOD_MACRO_BOUNDARIES_URL).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load macro boundary data: ${response.status}`);
      }
      return response.json();
    }),
    fetch(FOOD_SIGUNGU_BOUNDARIES_URL).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load boundary data: ${response.status}`);
      }
      return response.json();
    }),
    fetchGzipJson(FOOD_DONG_BOUNDARIES_GZ_URL),
  ]);

  macroBoundaryData = macroBoundaries;
  adminSearchFeatures = adminData.features || [];

  addAdminHierarchyLayers(adminData, macroBoundaries, sigunguBoundaries, dongBoundaries);
  addMainFoodStoreLayers({ type: "FeatureCollection", features: [] });
  setupCategoryPanel();
  addInstitutionPoiLayers();
  await addRetailPoiLayers();
  addFoodStoreInteractions();
  setupMapSearch();
  restoreAutoUpdateState();

  if (gpsTrackingActive) {
    setAdminLevelFilter("macro", hiddenAdminFilter());
    setAdminLevelFilter("sigungu", hiddenAdminFilter());
    setAdminLevelFilter("dong", hiddenAdminFilter());
    setFoodStoreLayersVisible(true);
    const macroId = macroFeatureAt(lastGpsCoordinates)?.properties?.macro_id;
    if (macroId) {
      loadRegionalFoodStores(macroId).catch((error) => {
        document.body.dataset.foodStoreError = error.message;
        setStatus(`식당 좌표 로딩 오류: ${error.message}`);
      });
      loadRegionalConvenienceStores(macroId).catch((error) => {
        document.body.dataset.convenienceStoreError = error.message;
      });
    }
  }

  const adminCounts = adminData.features?.reduce(
    (counts, feature) => {
      const level = feature.properties?.level;
      counts[level] = (counts[level] || 0) + 1;
      return counts;
    },
    {},
  );

  document.body.dataset.adminMacroCount = String(adminCounts?.macro || 0);
  document.body.dataset.adminSigunguCount = String(adminCounts?.sigungu || 0);
  document.body.dataset.adminDongCount = String(adminCounts?.dong || 0);

  setStatus(
    `행정구역 지도를 불러왔습니다. ${
      adminCounts?.macro || 0
    }개 권역, ${adminCounts?.sigungu || 0}개 시군구, ${adminCounts?.dong || 0}개 읍면동.`,
  );
}

function addFoodStoreInteractions() {
  if (foodStoreInteractionsReady) {
    return;
  }

  let suppressMapClickUntil = 0;

  const nearbyFeatures = (point, layers) => {
    const hitBox = 10;
    const existingLayers = layers.filter((layerId) => map.getLayer(layerId));
    if (!existingLayers.length) {
      return [];
    }

    return map.queryRenderedFeatures(
      [
        [point.x - hitBox, point.y - hitBox],
        [point.x + hitBox, point.y + hitBox],
      ],
      { layers: existingLayers },
    );
  };

  const zoomCluster = async (feature) => {
    const clusterId = feature.properties.cluster_id;
    const source = map.getSource("food-stores");

    if (clusterId == null || !source) {
      return;
    }

    try {
      const zoom = await source.getClusterExpansionZoom(clusterId);
      map.easeTo({
        center: feature.geometry.coordinates,
        zoom,
        duration: 450,
      });
    } catch (error) {
      setStatus(`Cluster zoom error: ${error.message}`);
    }
  };

  const zoomAdmin = (feature) => {
    const properties = feature.properties || {};
    const targetZoom = Number(properties.zoom || ZOOM_DONG_MAX);
    const name = properties.name || "선택한 행정구역";
    const center =
      properties.center_lng != null && properties.center_lat != null
        ? [Number(properties.center_lng), Number(properties.center_lat)]
        : feature.geometry.coordinates;

    rememberAdminNavigation(feature);
    updateAdminFilters(properties);
    if (properties.level === "macro") {
      loadRegionalFoodStores(properties.macro_id).catch((error) => {
        document.body.dataset.foodStoreError = error.message;
        setStatus(`식당 좌표 로딩 오류: ${error.message}`);
      });
      loadRegionalConvenienceStores(properties.macro_id).catch((error) => {
        document.body.dataset.convenienceStoreError = error.message;
      });
    }
    const bounds = geometryBounds(feature.geometry);
    if (bounds) {
      document.body.dataset.lastAdminBounds = JSON.stringify(bounds.toArray());
      const camera = map.cameraForBounds(bounds, {
        ...adminFitOptions(properties.level),
      });
      const adjustedCamera = adjustedAdminCamera(camera, properties);
      if (adjustedCamera) {
        document.body.dataset.lastAdminCamera = JSON.stringify({
          center: [adjustedCamera.center.lng, adjustedCamera.center.lat],
          zoom: adjustedCamera.zoom,
          bearing: adjustedCamera.bearing,
          level: properties.level,
          name,
        });
        map.easeTo({
          ...adjustedCamera,
          duration: 700,
        });
      }
    } else {
      map.easeTo({
        center,
        zoom: targetZoom,
        duration: 650,
      });
    }
    document.body.dataset.lastAdminClick = JSON.stringify({
      level: properties.level,
      name,
      targetZoom,
      fittedZoom: map.getZoom(),
    });
    setStatus(`${name}${directionParticle(name)} 확대했습니다. 계속 행정구역을 따라 들어가면 가게 점이 나타납니다.`);
  };

  const openStorePopup = (feature) => {
    if (!feature) {
      return;
    }

    const entries = multiStoreEntries(feature.properties || {});
    const isMultiMarker = Number(feature.properties?.g || entries.length || 1) > 1;
    selectRestaurantMarker(feature, isMultiMarker ? "multi" : "single");
    if (isMultiMarker && entries.length > 1) {
      openMultiStoreSheet(feature, entries);
    } else {
      const onlyStore = entries[0]?.store;
      const detailProperties = onlyStore
        ? { ...(feature.properties || {}), g: 1, l: [onlyStore] }
        : feature.properties || {};
      openStoreSheet(
        detailProperties,
        {
          visitContext: createVisitContext(
            onlyStore || parseStoreList(detailProperties)[0] || [],
            feature.geometry.coordinates,
            feature.properties?.a,
          ),
        },
      );
    }
    gentlyFocusSelectedMarker();
  };

  const openConveniencePopup = (feature) => {
    const properties = feature?.properties || {};
    const store = [properties.n || "편의점", properties.b || "", "편의점", "", properties.id || ""];
    openStoreSheet(
      {
        l: [store],
        a: properties.a || properties.j || "",
        r: "편의점",
        g: 1,
      },
      {
        name: [properties.n, properties.b].filter(Boolean).join(" ") || "편의점",
        category: "편의점",
        distance: "근처",
        visitContext: createVisitContext(store, feature.geometry?.coordinates, properties.a || properties.j || ""),
      },
    );
  };

  const handleClusterClick = (event) => {
    const feature = event.features?.[0];
    if (!feature) {
      return;
    }
    suppressMapClickUntil = Date.now() + 350;
    event.preventDefault?.();
    zoomCluster(feature);
  };

  for (const layerId of ["food-store-cluster-count", "food-store-clusters"]) {
    if (map.getLayer(layerId)) {
      map.on("click", layerId, handleClusterClick);
    }
  }

  map.on("click", (event) => {
    if (Date.now() < suppressMapClickUntil) {
      return;
    }

    const clusterFeatures = nearbyFeatures(event.point, [
      "food-store-cluster-count",
      "food-store-clusters",
    ]);
    if (clusterFeatures[0]) {
      suppressMapClickUntil = Date.now() + 350;
      zoomCluster(clusterFeatures[0]);
      return;
    }

    const convenienceFeatures = nearbyFeatures(event.point, ["supplemental-convenience-symbols"]);
    if (convenienceFeatures[0]) {
      openConveniencePopup(convenienceFeatures[0]);
      return;
    }

    const storeFeatures = nearbyFeatures(event.point, [
      "food-store-building-points",
      "food-store-single-points",
    ]);
    if (storeFeatures[0]) {
      openStorePopup(storeFeatures[0]);
      return;
    }

    const adminFeatures = nearbyFeatures(event.point, [
      "food-active-admin-fills",
      "food-admin-dong-fills",
      "food-admin-sigungu-fills",
      "food-admin-macro-fills",
    ]);
    if (adminFeatures[0]) {
      zoomAdmin(adminFeatures[0]);
      return;
    }
  });

  for (const layerId of [
    "food-admin-macro-fills",
    "food-admin-macro-labels",
    "food-active-admin-fills",
    "food-active-admin-labels",
    "food-admin-sigungu-fills",
    "food-admin-sigungu-labels",
    "food-admin-dong-fills",
    "food-admin-dong-labels",
    "food-store-clusters",
    "food-store-cluster-count",
    "food-store-building-points",
    "food-store-single-points",
    "supplemental-convenience-symbols",
  ]) {
    if (!map.getLayer(layerId)) {
      continue;
    }

    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  foodStoreInteractionsReady = true;
}

const map = new maplibregl.Map({
  container: "map",
  style: OPENFREEMAP_STYLE_URL,
  center: INITIAL_VIEW.center,
  zoom: INITIAL_VIEW.zoom,
  pitch: INITIAL_VIEW.pitch,
  bearing: INITIAL_VIEW.bearing,
  maxBounds: KOREA_PAN_BOUNDS,
  attributionControl: {
    compact: true,
  },
});
window.map = map;

map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");
document.body.dataset.scaleControlReady = "true";
map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "bottom-right");
document.body.dataset.zoomControlReady = "true";

function activateGpsLocation(position) {
  if (gpsUpdatesSuppressed) {
    document.body.dataset.ignoredGpsUpdateAt = String(Date.now());
    return;
  }

  const coordinates = [position.coords.longitude, position.coords.latitude];
  gpsTrackingActive = true;
  lastGpsCoordinates = coordinates;
  document.body.dataset.gpsCoordinates = JSON.stringify(coordinates);
  document.body.dataset.gpsAccuracy = String(position.coords.accuracy ?? "");
  document.body.dataset.gpsTracking = "true";

  if (!gpsHasCentered) {
    gpsHasCentered = true;
    map.easeTo({ center: coordinates, zoom: 15.8, duration: 700 });
    document.body.dataset.gpsInitialZoom = "15.8";
  }

  clearActiveAdminState();

  setAdminLevelFilter("macro", hiddenAdminFilter());
  setAdminLevelFilter("sigungu", hiddenAdminFilter());
  setAdminLevelFilter("dong", hiddenAdminFilter());
  setFoodStoreLayersVisible(true);
  updateBackButton();

  const macroId = macroFeatureAt(coordinates)?.properties?.macro_id;
  if (macroId && loadedFoodMacroId !== macroId) {
    loadRegionalFoodStores(macroId).catch((error) => {
      document.body.dataset.foodStoreError = error.message;
      setStatus(`식당 좌표 로딩 오류: ${error.message}`);
    });
  }
  if (macroId && loadedConvenienceMacroId !== macroId) {
    loadRegionalConvenienceStores(macroId).catch((error) => {
      document.body.dataset.convenienceStoreError = error.message;
    });
  }
}

const geolocateControl = new maplibregl.GeolocateControl({
  positionOptions: {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 2000,
  },
  trackUserLocation: true,
  showUserLocation: true,
  showAccuracyCircle: true,
  showUserHeading: true,
  fitBoundsOptions: { maxZoom: 15.8 },
});
map.addControl(geolocateControl, "bottom-right");
document.body.dataset.gpsControlReady = "true";
document.body.dataset.gpsSecureContext = String(window.isSecureContext);
document.body.dataset.gpsSupported = String("geolocation" in navigator);

let geolocateButton = document.querySelector(".maplibregl-ctrl-geolocate");

function configureGeolocateButton() {
  geolocateButton = document.querySelector(".maplibregl-ctrl-geolocate");
  geolocateButton?.setAttribute("title", "내 위치 실시간 추적");
  geolocateButton?.setAttribute("aria-label", "내 위치 실시간 추적");
}

function resetGeolocateControl() {
  map.removeControl(geolocateControl);
  map.addControl(geolocateControl, "bottom-right");
  configureGeolocateButton();
  document.body.dataset.gpsControlResetAt = String(Date.now());
}

configureGeolocateButton();

geolocateControl.on("trackuserlocationstart", () => {
  gpsUpdatesSuppressed = false;
  document.body.dataset.gpsUpdatesSuppressed = "false";
  gpsTrackingActive = true;
  clearActiveAdminState();
  document.body.dataset.gpsTracking = "true";
  document.body.dataset.gpsFollowing = "true";
  updateBackButton();
});
geolocateControl.on("geolocate", activateGpsLocation);
geolocateControl.on("trackuserlocationend", () => {
  gpsTrackingActive = false;
  document.body.dataset.gpsTracking = "false";
  document.body.dataset.gpsFollowing = "false";
  gpsHasCentered = false;
  updateBackButton();
});
geolocateControl.on("userlocationfocus", () => {
  if (!gpsUpdatesSuppressed) document.body.dataset.gpsFollowing = "true";
});
geolocateControl.on("error", (event) => {
  const message = event?.message || "위치 권한을 사용할 수 없습니다.";
  document.body.dataset.gpsError = message;
  setStatus(`GPS 오류: ${message}`);
});

map.on("styleimagemissing", (event) => {
  if (event.id !== "rail" || map.hasImage("rail")) {
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext("2d");
  context.fillStyle = "#315a7d";
  context.beginPath();
  context.arc(8, 8, 5, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#ffffff";
  context.lineWidth = 2;
  context.stroke();
  map.addImage("rail", context.getImageData(0, 0, 16, 16), { pixelRatio: 2 });
});

document.querySelector("#overview-button")?.addEventListener("click", () => {
  map.stop();
  resetAdminFilters();
  fitKoreaOverview({ animated: true });
  recordMapView("overview-button");
  setStatus("대한민국 전체 화면으로 돌아왔습니다.");
});

document.querySelector("#back-button")?.addEventListener("click", restoreAdminNavigation);

document.addEventListener("pointerdown", (event) => {
  const button = event.target.closest?.("button:not(:disabled)");
  button?.classList.add("is-pressing");
});

for (const eventName of ["pointerup", "pointercancel"]) {
  document.addEventListener(eventName, () => {
    document.querySelectorAll("button.is-pressing").forEach((button) => {
      button.classList.remove("is-pressing");
    });
  });
}

document.querySelectorAll(".bottom-nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".bottom-nav-item").forEach((candidate) => {
      const isCurrent = candidate === item;
      candidate.classList.toggle("is-active", isCurrent);
      if (isCurrent) {
        candidate.setAttribute("aria-current", "page");
      } else {
        candidate.removeAttribute("aria-current");
      }
    });

    item.classList.remove("is-tab-bouncing");
    void item.offsetWidth;
    item.classList.add("is-tab-bouncing");
    window.setTimeout(() => item.classList.remove("is-tab-bouncing"), 130);
  });
});

map.on("move", updateSelectedMarkerPosition);

map.on("moveend", () => {
  scheduleAdminPresentationRestore();
  scheduleSubwayExitRefresh();
  raiseSubwayExitLayers();
  recordMapView("moveend");
});

map.on("zoomend", scheduleAdminPresentationRestore);
map.on("idle", scheduleAdminPresentationRestore);

map.on("load", () => {
  fitKoreaOverview();
  updateBackButton();
  recordMapView("initial-overview");
  const stats = applyMapCleanup();
  addTerrainNameLayers();
  addTransitLineLayers();
  addStationNameLayer();
  addSubwayExitLayers().catch((error) => {
    document.body.dataset.subwayExitError = error.message;
  });
  if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
    document.body.dataset.appBuildId = APP_BUILD_ID;
    document.body.dataset.autoUpdateReady = "local-disabled";
  } else {
    startAutoUpdateWatcher();
  }
  document.body.dataset.mapCleanupStats = JSON.stringify(stats);
  document.body.dataset.hiddenTextLayers = String(stats.hiddenTextLayers);
  setStatus(
    `Map loaded. Cleanup applied to ${
      stats.hiddenTextLayers +
      stats.hiddenIconLayers +
      stats.hiddenBuildingDepthLayers +
      stats.restoredBuildingLayers +
      stats.addedBuildingOutlineLayers
    } layers.`,
  );
  loadFoodStores().catch((error) => {
    document.body.dataset.foodStoreError = error.message;
    setStatus(`Store data loading error: ${error.message}`);
  });
});

map.on("error", (event) => {
  const message = event?.error?.message || "unknown map loading error";
  setStatus(`Map loading error: ${message}`);
});
