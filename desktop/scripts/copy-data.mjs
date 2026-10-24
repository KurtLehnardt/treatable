// Copies the shipped study snapshot into desktop/resources/data and writes provenance.json.
// Mirrors the 2,000-study check in extension/scripts/build.mjs.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "../scaffold/data");
const target = path.join(root, "resources/data");

await mkdir(target, { recursive: true });
for (const name of ["studies.json", "us-zip-centroids.json"]) {
  await cp(path.join(source, name), path.join(target, name));
}
const studies = JSON.parse(await readFile(path.join(target, "studies.json"), "utf8"));
if (studies.length !== 2000) throw new Error(`Expected 2,000 shipped studies, got ${studies.length}`);
await writeFile(
  path.join(target, "provenance.json"),
  JSON.stringify(
    {
      count: studies.length,
      fetchedAt: studies[0]?.fetchedAt,
      source: "ClinicalTrials.gov API v2",
      search: "Local BM25 retrieval with optional OpenAI or local-model scoring; snapshot is incomplete and recruitment may change",
      zipAttribution: "GeoNames, CC BY 4.0; approximate postal-area centers",
    },
    null,
    2,
  ),
);
console.log(`Copied ${studies.length} studies to resources/data`);
