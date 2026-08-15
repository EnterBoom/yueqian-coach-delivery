import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { buildD1Migration } from "../lib/migration.mjs";

const { values } = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    output: { type: "string", short: "o" },
    archive: { type: "string" },
  },
});
if (!values.input || !values.output) throw new Error("Usage: node scripts/build-d1-import.mjs --input export.json --output import.sql");

const raw = values.input === "-"
  ? await new Promise((resolve, reject) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { data += chunk; });
      process.stdin.on("end", () => resolve(data));
      process.stdin.on("error", reject);
    })
  : await readFile(values.input, "utf8");
const payload = JSON.parse(raw);
const migration = buildD1Migration(payload);
if (values.archive) await writeFile(values.archive, raw, { mode: 0o600 });
await writeFile(values.output, migration.sql, { mode: 0o600 });
const manifest = {
  ...migration.manifest,
  sqlSha256: createHash("sha256").update(migration.sql).digest("hex"),
};
await writeFile(`${values.output}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ exportedAt: manifest.exportedAt, counts: manifest.counts, sqlSha256: manifest.sqlSha256 }, null, 2)}\n`);
