#!/usr/bin/env node
/**
 * Mechanical design guard. A style guide nobody can fail gets ignored, so the
 * colour and radius decisions in plan/08-design/design-system.md are enforced
 * here and wired into CI.
 *
 * Rules come from plan/07-research/ui-craft-and-ai-tells.md.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const RULES = [
  {
    id: "banned-accent-hex",
    severity: "error",
    // Indigo/violet is the single most reliable signature of generated UI.
    pattern: /#(6366f1|4f46e5|4338ca|3730a3|818cf8|8b5cf6|7c3aed|a855f7|2563eb|3b82f6)\b/i,
    message: "Indigo/violet/default-blue hex. Use the accent tokens in globals.css.",
  },
  {
    id: "banned-tailwind-accent",
    severity: "error",
    pattern: /\b(bg|text|border|ring|from|to|via)-(indigo|violet|purple|fuchsia)-\d{2,3}\b/,
    message: "Tailwind indigo/violet/purple utility. Use accent tokens.",
  },
  {
    id: "banned-tailwind-neutral",
    severity: "error",
    // Our neutrals are a chosen cool-tinted ramp, not slate/zinc/gray defaults.
    pattern: /\b(bg|text|border|ring|divide)-(slate|zinc|gray|neutral|stone)-\d{2,3}\b/,
    message: "Default Tailwind neutral. Use canvas/surface/border/foreground tokens.",
  },
  {
    id: "max-rounding",
    severity: "error",
    pattern: /\brounded-(2xl|3xl|full)\b/,
    message: "Uniform maximum rounding. Radius is per element role: sm/md/lg/xl.",
  },
  {
    id: "trust-gradient",
    severity: "error",
    pattern: /bg-gradient-to-\w+[^"'`]*\b(purple|indigo|violet|fuchsia|cyan)-\d{2,3}/,
    message: "The two-stop 'trust' gradient. Use solid fills.",
  },
  {
    id: "pure-black-white",
    severity: "error",
    pattern: /(?:bg|text|border)-\[#(?:fff(?:fff)?|000(?:000)?)\]/i,
    message: "Pure #000/#fff vibrates. Use canvas/surface/foreground tokens.",
  },
  {
    id: "hover-scale",
    severity: "warn",
    pattern: /hover:scale-1(0[5-9]|1\d)\b/,
    message: "Uniform hover:scale is decorative motion; prefer a colour or elevation change.",
  },
  {
    id: "placeholder-copy",
    severity: "error",
    pattern: /\b(lorem ipsum|Feature one|Placeholder text|Supercharge|Unleash|Seamlessly)\b/i,
    message: "Placeholder or marketing filler copy.",
  },
  {
    id: "placeholder-image-cdn",
    severity: "error",
    pattern: /\b(unsplash\.com|placehold\.co|picsum\.photos|via\.placeholder)\b/,
    message: "External placeholder image CDN.",
  },
];

// Rounded-full is legitimate for genuinely circular things. The rule exists to
// stop UNIFORM max rounding on cards and buttons, not to ban circles.
const ALLOW = [
  { file: "src/components/ui/avatar.tsx", rules: ["max-rounding"] },
  { file: "src/components/account-menu.tsx", rules: ["max-rounding"] },
  { file: "src/app/(app)/settings/pipelines/pipeline-editor.tsx", rules: ["max-rounding"] },
  { file: "src/components/ui/badge.tsx", rules: ["max-rounding"] },
  { file: "src/components/crm/activity-timeline.tsx", rules: ["max-rounding"] },
  { file: "src/components/nav-link.tsx", rules: ["max-rounding"] },
  { file: "src/app/(app)/deals/page.tsx", rules: ["max-rounding"] },
  { file: "src/app/(app)/deals/pipeline-board.tsx", rules: ["max-rounding"] },
  { file: "src/app/(app)/settings/pipelines/pipeline-editor.tsx", rules: ["max-rounding"] },
  { file: "src/app/(app)/dashboard/page.tsx", rules: ["max-rounding"] },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "generated" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|ts|css)$/.test(full)) out.push(full);
  }
  return out;
}

let errors = 0;
let warnings = 0;

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  // globals.css is where the tokens are *defined*; it is the one file allowed
  // to contain raw colour values.
  const isTokenFile = rel.endsWith("globals.css");
  const exempt = ALLOW.filter((a) => a.file === rel).flatMap((a) => a.rules);
  const lines = readFileSync(file, "utf8").split("\n");

  for (const rule of RULES) {
    if (exempt.includes(rule.id)) continue;
    if (isTokenFile && rule.id.startsWith("banned-accent")) continue;

    lines.forEach((line, i) => {
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
      if (!rule.pattern.test(line)) return;
      const label = rule.severity === "error" ? "ERROR" : "warn ";
      console.log(`${label} ${rel}:${i + 1}  [${rule.id}] ${rule.message}`);
      if (rule.severity === "error") errors++;
      else warnings++;
    });
  }
}

console.log(
  errors === 0 && warnings === 0
    ? "design check: clean"
    : `design check: ${errors} error(s), ${warnings} warning(s)`,
);
process.exit(errors > 0 ? 1 : 0);
