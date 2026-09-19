import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_NAME = "jev";

/** The skill directory shipped inside this package. */
export function bundledSkillDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/setup/skills.js and src/setup/skills.ts both sit two levels below the package root.
  return join(here, "..", "..", "skills", SKILL_NAME);
}

export type SkillInstallStatus = "installed" | "updated" | "unchanged" | "planned";

/** Copy the bundled skill into `skillsDir/<name>`, reporting whether anything changed. */
export function installSkill(
  skillsDir: string,
  options: { dryRun?: boolean; source?: string } = {},
): { status: SkillInstallStatus; path: string } {
  const source = options.source ?? bundledSkillDir();
  const target = join(skillsDir, SKILL_NAME);
  if (!existsSync(source)) {
    throw new Error(`Bundled skill not found at ${source}.`);
  }
  const existed = existsSync(target);
  if (existed && sameTree(source, target)) return { status: "unchanged", path: target };
  if (options.dryRun) return { status: "planned", path: target };
  mkdirSync(skillsDir, { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
  return { status: existed ? "updated" : "installed", path: target };
}

/** Every regular file under a directory, as paths relative to it. */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(relative(root, full));
    }
  };
  walk(root);
  return out.sort();
}

function sameTree(a: string, b: string): boolean {
  if (!statSync(b, { throwIfNoEntry: false })?.isDirectory()) return false;
  const filesA = listFiles(a);
  const filesB = listFiles(b);
  if (filesA.length !== filesB.length || filesA.some((file, i) => file !== filesB[i])) return false;
  return filesA.every((file) => readFileSync(join(a, file)).equals(readFileSync(join(b, file))));
}
