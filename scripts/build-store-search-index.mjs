import { readFile, writeFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";

const regions = [
  "gangwon",
  "gyeonggi",
  "gyeongnam",
  "gyeongbuk",
  "incheon",
  "jeju",
  "jeonnam",
  "jeonbuk",
  "chungnam",
  "chungbuk",
  "seoul",
];
const choseongKeys = [
  "g", "gg", "n", "d", "dd", "r", "m", "b", "bb", "s",
  "ss", "ng", "j", "jj", "ch", "k", "t", "p", "h",
];
const shards = new Map();

function normalize(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function shardKey(value) {
  const first = [...normalize(value)][0] || "";
  const code = first.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return choseongKeys[Math.floor((code - 0xac00) / 588)];
  }
  if (/[a-z]/.test(first)) return `latin-${first}`;
  if (/\d/.test(first)) return "digit";
  return "other";
}

for (const region of regions) {
  const path = new URL(`../data/food-stores-${region}-202603.geojson.gz`, import.meta.url);
  const data = JSON.parse(gunzipSync(await readFile(path)));

  for (const feature of data.features || []) {
    const properties = feature.properties || {};
    const [longitude, latitude] = feature.geometry?.coordinates || [];
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;

    for (const store of properties.l || []) {
      if (!Array.isArray(store) || !store[0]) continue;
      const key = shardKey(store[0]);
      if (!shards.has(key)) shards.set(key, []);
      shards.get(key).push([
        normalize(store[0]),
        store[0],
        store[1] || "",
        properties.a || "",
        properties.r || "",
        longitude,
        latitude,
        region,
        store[2] || "",
        store[3] || "",
      ]);
    }
  }
}

const manifest = { total: 0, shards: {} };
for (const [key, entries] of [...shards].sort(([a], [b]) => a.localeCompare(b))) {
  entries.sort((a, b) => a[0].localeCompare(b[0], "ko-KR") || a[3].localeCompare(b[3], "ko-KR"));
  const json = JSON.stringify(entries);
  const fileName = `store-search-${key}.json.gz`;
  await writeFile(new URL(`../data/${fileName}`, import.meta.url), gzipSync(json, { level: 9 }));
  manifest.shards[key] = { file: fileName, count: entries.length };
  manifest.total += entries.length;
}

await writeFile(
  new URL("../data/store-search-manifest.json", import.meta.url),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`Built ${manifest.total} store search entries in ${Object.keys(manifest.shards).length} shards.`);
