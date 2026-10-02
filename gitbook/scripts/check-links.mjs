// Checks that every relative Markdown link under gitbook/ points at an existing file. Run: node gitbook/scripts/check-links.mjs
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".md")) files.push(p);
  }
};
walk(root);

let broken = 0;
for (const file of files) {
  // Drop fenced code so GraphQL and TypeScript samples aren't read as links.
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = resolve(dirname(file), target.split("#")[0]);
    if (!existsSync(path)) {
      console.error(`${file.slice(root.length + 1)}: broken link ${target}`);
      broken++;
    }
  }
}
console.log(`${files.length} files checked, ${broken} broken links`);
process.exit(broken ? 1 : 0);
