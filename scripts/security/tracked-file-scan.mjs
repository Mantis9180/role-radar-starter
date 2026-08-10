import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const allowedExact = new Set([".env.example", "wrangler.example.jsonc"]);
const deniedExact = new Set([
  ".dev.vars",
  ".openai/hosting.json",
  "wrangler.jsonc",
]);
const deniedSegments = new Set([
  ".next",
  ".vinext",
  ".wrangler",
  "dist",
  "exports",
  "node_modules",
  "outputs",
  "private",
  "resumes",
  "work",
]);
const deniedSuffixes = [
  ".backup",
  ".db",
  ".dump",
  ".pem",
  ".sqlite",
  ".sqlite-shm",
  ".sqlite-wal",
];

function normalize(path) {
  return path.split(sep).join("/").replace(/^\.\//, "");
}

function listFiles() {
  try {
    const output = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (output) return output.split("\0").filter(Boolean).map(normalize);
  } catch {
    // A fresh template may be scanned before git init; fall back to the tree.
  }

  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory)) {
      if (entry === ".git" || entry === "node_modules") continue;
      const absolute = join(directory, entry);
      const path = normalize(relative(root, absolute));
      if (statSync(absolute).isDirectory()) walk(absolute);
      else files.push(path);
    }
  }
  walk(root);
  return files;
}

const violations = [];
for (const path of listFiles()) {
  if (allowedExact.has(path)) continue;
  const parts = path.split("/");
  const basename = parts.at(-1) ?? path;
  if (deniedExact.has(path)) violations.push(`${path}: forbidden deployment or secret file`);
  if (parts.some((part) => deniedSegments.has(part))) {
    violations.push(`${path}: generated or private directory must not be tracked`);
  }
  if (/^\.env(?:\.|$)/.test(basename)) {
    violations.push(`${path}: environment file must not be tracked`);
  }
  if (deniedSuffixes.some((suffix) => basename.endsWith(suffix))) {
    violations.push(`${path}: database, backup, or key material must not be tracked`);
  }
}

if (violations.length) {
  console.error("Tracked-file safety scan failed:\n" + violations.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log("Tracked-file safety scan passed.");
