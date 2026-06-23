#!/usr/bin/env node
/**
 * Installs Git hooks by copying them to .git/hooks/
 * Run via: npm run setup-hooks
 */
import { copyFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const hooksSource = join(projectRoot, "hooks");
const hooksTarget = join(projectRoot, ".git", "hooks");

// Ensure .git/hooks exists
if (!existsSync(hooksTarget)) {
  mkdirSync(hooksTarget, { recursive: true });
}

const hooks = ["commit-msg", "pre-push"];

for (const hook of hooks) {
  const src = join(hooksSource, hook);
  const dest = join(hooksTarget, hook);

  if (!existsSync(src)) {
    console.error(`⚠️  Source hook not found: ${src}`);
    continue;
  }

  copyFileSync(src, dest);
  chmodSync(dest, 0o755);
  console.log(`✅ Installed ${hook} → .git/hooks/${hook}`);
}

console.log("\nDone! Git hooks are now active.");
console.log("Make sure to run 'npm run build' so the TypeScript is compiled.");
