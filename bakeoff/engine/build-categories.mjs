// Builds engine/categories-big.js from Darius Kazemi's Corpora (https://github.com/dariusk/corpora, CC0).
//   1. Download and unpack https://codeload.github.com/dariusk/corpora/tar.gz/refs/heads/master somewhere outside the repo.
//   2. npm run categories -- <path to corpora>/data
// Only family-friendly lists are used (no people, drugs, alcohol, diseases, politics; moods were dropped for words
// like "aroused"). Every entry is cleaned to what the font can draw (A-Z and one space, at most
// 12 characters), offensive words are dropped, and for lists of ordinary words (not names) every word must be in
// the SCOWL dictionary, which removes typos and very obscure entries. The hand-checked lists in categories.js stay
// the default; these bigger lists are opt-in (category(name, { big: true })).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { isBlocked } from "../harness/blocklist.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.argv[2];
if (!dataDir || !fs.existsSync(path.join(dataDir, "animals", "common.json"))) {
  console.error("usage: npm run categories -- <path to corpora>/data");
  process.exit(1);
}

// name: [file, how to get the list from the JSON, proper (names, so no dictionary check)]
const pick = (key, field) => (j) => (field ? j[key].map((x) => x[field]) : j[key]);
const keysOf = (key) => (j) => Object.keys(j[key]);
const SOURCES = {
  ANIMALS: ["animals/common", pick("animals")],
  "CAT BREEDS": ["animals/cats", pick("cats"), true],
  "DOG BREEDS": ["animals/dogs", pick("dogs"), true],
  "HORSE BREEDS": ["animals/horses", pick("horses"), true],
  DINOSAURS: ["animals/dinosaurs", pick("dinosaurs"), true],
  ROOMS: ["architecture/rooms", pick("rooms")],
  CRAYONS: ["colors/crayola", pick("colors", "color"), true],
  "COLOUR NAMES": ["colors/wikipedia", (j) => Object.values(j).map((x) => x.name), true],
  ZODIAC: ["divination/zodiac", keysOf("western_zodiac"), true],
  "CHINESE ZODIAC": ["divination/zodiac", keysOf("eastern_zodiac"), true],
  BREADS: ["foods/breads_and_pastries", pick("breads")],
  PASTRIES: ["foods/breads_and_pastries", pick("pastries")],
  CONDIMENTS: ["foods/condiments", pick("condiments"), true],
  SEAFOOD: ["foods/fish", pick("fish")],
  FRUITS: ["foods/fruits", pick("fruits")],
  HERBS: ["foods/herbs_n_spices", pick("herbs"), true],
  SPICES: ["foods/herbs_n_spices", pick("spices"), true],
  "PIZZA TOPPINGS": ["foods/pizzaToppings", pick("pizzaToppings")],
  SANDWICHES: ["foods/sandwiches", pick("sandwiches", "name"), true],
  SHELLFISH: ["foods/shellfish", pick("fish")],
  VEGETABLES: ["foods/vegetables", pick("vegetables")],
  COUNTRIES: ["geography/countries", pick("countries"), true],
  OCEANS: ["geography/oceans", pick("oceans", "name"), true],
  SEAS: ["geography/oceans", pick("seas", "name"), true],
  RIVERS: ["geography/rivers", pick("rivers", "name"), true],
  LANDFORMS: ["geography/geographic_features", pick("entries")],
  BODY: ["humans/bodyParts", pick("bodyParts")],
  FAMILY: ["humans/familyRelations", pick("familyRelations", "member")],
  JOBS: ["humans/occupations", pick("occupations")],
  FABRICS: ["materials/fabrics", pick("fabrics")],
  GEMS: ["materials/gemstones", pick("gemstones")],
  METALS: ["materials/metals", pick("metals")],
  "BUILDING MATERIALS": ["materials/building-materials", pick("building materials")],
  "MUSIC GENRES": ["music/genres", pick("genres")],
  INSTRUMENTS: ["music/instruments", pick("instruments")],
  "GREEK GODS": ["mythology/greek_gods", pick("greek_gods"), true],
  "GREEK MONSTERS": ["mythology/greek_monsters", pick("greek_monsters"), true],
  "ROMAN GODS": ["mythology/roman_deities", pick("roman_deities"), true],
  "NORSE GODS": ["mythology/norse_gods", (j) => j.norse_deities.gods, true],
  "EGYPTIAN GODS": ["mythology/egyptian_gods", keysOf("egyptian_gods"), true],
  MONSTERS: ["mythology/monsters", pick("names")],
  CLOTHING: ["objects/clothing", pick("clothes")],
  CONTAINERS: ["objects/containers", pick("containers")],
  OBJECTS: ["objects/objects", pick("objects")],
  FLOWERS: ["plants/flowers", pick("flowers")],
  PLANTS: ["plants/plants", pick("plants", "name")],
  ELEMENTS: ["science/elements", pick("elements", "name")],
  PLANETS: ["science/planets", pick("planets", "name"), true],
  SPORTS: ["sports/sports", pick("sports")],
  APPLIANCES: ["technology/appliances", pick("appliances")],
  KNOTS: ["technology/knots", pick("knots")],
  "TIME UNITS": ["words/units_of_time", pick("formal_time_units")],
  WEAPONS: ["objects/premodern_weapons", (j) => Object.values(j.data).flat()],
};

// Every SCOWL word (sizes 10-50, any length), for the dictionary check.
const dict = new Set();
for (const n of [10, 20, 35, 40, 50]) for (const v of ["english", "american"]) for (const w of require(`wordlist-english/${v}-words-${n}.json`)) dict.add(w.toUpperCase());

const clean = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
const out = {}, report = [];
for (const [name, [file, get, proper]] of Object.entries(SOURCES)) {
  const raw = get(JSON.parse(fs.readFileSync(path.join(dataDir, file + ".json"), "utf8")));
  const kept = [...new Set(raw.map(clean))].filter((w) =>
    /^[A-Z]+( [A-Z]+)?$/.test(w) && w.length >= 2 && w.length <= 12
    && !w.split(" ").some(isBlocked)
    && (proper || w.split(" ").every((t) => dict.has(t)))).sort();
  if (kept.length >= 4) out[name] = kept;
  report.push(`${name.padEnd(20)} ${String(kept.length).padStart(4)} of ${raw.length}`);
}
fs.writeFileSync(path.join(here, "categories-big.js"),
  "// Generated by build-categories.mjs from Corpora by Darius Kazemi (https://github.com/dariusk/corpora), CC0.\n" +
  "// Not hand-checked: bigger but less certain than categories.js. Do not edit by hand.\n" +
  `export const BIG_CATEGORIES = ${JSON.stringify(out, null, 0).replace(/\],"/g, '],\n  "').replace(/^\{/, "{\n  ").replace(/\}$/, ",\n}")};\n`);
console.log(report.join("\n"));
console.log(`${Object.keys(out).length} lists, ${Object.values(out).flat().length} entries`);
