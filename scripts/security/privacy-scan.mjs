import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

const root = process.cwd();
const skippedDirectories = new Set([
  ".git",
  ".next",
  ".vinext",
  ".wrangler",
  "dist",
  "node_modules",
  "outputs",
]);
const skippedFiles = new Set(["package-lock.json", "pnpm-lock.yaml"]);
const textExtensions = new Set([
  "",
  ".css",
  ".html",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const rasterExtensions = new Set([".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const deploymentIdPrefix = ["app", "gprj", "_"].join("");
const privateSiteSuffix = ["chatgpt", ".", "site"].join("");
const allowedEmailDomains = new Set(["example.com", "users.noreply.github.com"]);

function normalize(path) {
  return path.split(sep).join("/");
}

function filesIn(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (skippedDirectories.has(entry)) continue;
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) files.push(...filesIn(absolute));
    else files.push(absolute);
  }
  return files;
}

const violations = [];
for (const absolute of filesIn(root)) {
  const path = normalize(relative(root, absolute));
  const extension = extname(path).toLowerCase();
  if (skippedFiles.has(path)) continue;
  if (rasterExtensions.has(extension)) {
    violations.push(`${path}: raster asset requires OCR, metadata review, and an explicit release decision`);
    continue;
  }
  if (!textExtensions.has(extension)) continue;

  const contents = readFileSync(absolute, "utf8");
  if (contents.includes(deploymentIdPrefix)) {
    violations.push(`${path}: contains a platform deployment identifier prefix`);
  }
  if (contents.toLowerCase().includes(privateSiteSuffix)) {
    violations.push(`${path}: contains a deployed private-site hostname`);
  }

  const emails = contents.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  for (const email of emails) {
    const domain = email.toLowerCase().split("@").at(-1);
    if (!domain || !allowedEmailDomains.has(domain)) {
      violations.push(`${path}: contains non-fictional email ${email}`);
    }
  }

  if (/^(?:drizzle|migrations)\//.test(path) || path.endsWith(".sql")) {
    if (/\b(?:insert|replace)\s+into\s+(?:candidate_access|candidate_profiles)\b/i.test(contents)) {
      violations.push(`${path}: migration or database source seeds candidate identity/access data`);
    }
  }

  if (/^(?:db\/seed|tests?\/|fixtures?\/)/.test(path)) {
    const urls = contents.match(/https:\/\/[^\s'"`<>]+/g) ?? [];
    for (const url of urls) {
      try {
        if (new URL(url).hostname !== "example.com") {
          violations.push(`${path}: fixture or seed contains a non-example URL`);
        }
      } catch {
        violations.push(`${path}: fixture or seed contains an invalid URL`);
      }
    }
  }
}

try {
  const log = execFileSync("git", ["log", "--format=%an%x00%ae"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  for (const record of log.split("\n").filter(Boolean)) {
    const [, email = ""] = record.split("\0");
    const domain = email.toLowerCase().split("@").at(-1);
    if (email && !allowedEmailDomains.has(domain)) {
      violations.push(`git history: commit author email is not public-safe (${email})`);
    }
  }
} catch {
  // No git history exists yet. The working-tree scan still runs.
}

const extraTerms = (process.env.PUBLIC_TEMPLATE_DENY_TERMS ?? "")
  .split(",")
  .map((term) => term.trim())
  .filter(Boolean);
if (extraTerms.length) {
  for (const absolute of filesIn(root)) {
    const path = normalize(relative(root, absolute));
    if (!textExtensions.has(extname(path).toLowerCase())) continue;
    const contents = readFileSync(absolute, "utf8").toLowerCase();
    for (const term of extraTerms) {
      if (contents.includes(term.toLowerCase())) {
        violations.push(`${path}: contains an operator-provided deny term`);
      }
    }
  }
}

if (violations.length) {
  console.error("Privacy scan failed:\n" + violations.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log("Privacy scan passed.");
