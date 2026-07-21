#!/usr/bin/env node
// Compare two package-lock.json files and classify every resolved-version move.
//
// Usage: node lockfile-gate.mjs <old-lockfile> <new-lockfile>
// Emits JSON on stdout: { moves, patch, nonPatch, added, removed, clean }
//
// Only "patch" moves are eligible for unattended commit. Anything else is
// reported so a human decides. npm update never crosses a declared semver
// range, so "major" here means a range that itself permits majors (e.g. "*"),
// which is exactly the case worth surfacing.

import { readFileSync } from 'node:fs';

const parse = (p) => {
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  const out = new Map();
  for (const [key, val] of Object.entries(raw.packages ?? {})) {
    if (!key.startsWith('node_modules/')) continue; // skip the root ("") entry
    if (!val?.version) continue;
    out.set(key.replace(/^node_modules\//, ''), val.version);
  }
  return out;
};

// Returns 'patch' | 'minor' | 'major' | 'other'
const level = (from, to) => {
  // Strict full match: a prerelease/build suffix (1.2.3-rc.1, 1.2.3+meta), a git
  // URL, or an alias must fall through to 'other' so it is never auto-committed.
  // A loose ^-anchored match would read "3.1.4 -> 3.1.4-rc.1" as a patch move.
  const a = /^(\d+)\.(\d+)\.(\d+)$/.exec(from);
  const b = /^(\d+)\.(\d+)\.(\d+)$/.exec(to);
  if (!a || !b) return 'other'; // prerelease/git/alias — never auto-commit
  const [, aMaj, aMin] = a, [, bMaj, bMin] = b;
  if (aMaj !== bMaj) return 'major';
  if (aMin !== bMin) return 'minor';
  return 'patch';
};

const [, , oldPath, newPath] = process.argv;
if (!oldPath || !newPath) {
  console.error('usage: lockfile-gate.mjs <old-lockfile> <new-lockfile>');
  process.exit(2);
}

const before = parse(oldPath);
const after = parse(newPath);

const moves = [], added = [], removed = [];
for (const [name, to] of after) {
  const from = before.get(name);
  if (from === undefined) added.push({ name, version: to });
  else if (from !== to) moves.push({ name, from, to, level: level(from, to) });
}
for (const [name, version] of before) {
  if (!after.has(name)) removed.push({ name, version });
}

const patch = moves.filter((m) => m.level === 'patch');
const nonPatch = moves.filter((m) => m.level !== 'patch');

// A pure version refresh must not add or drop packages. If it does, the
// dependency graph itself changed — treat that as needing review.
const clean = nonPatch.length === 0 && added.length === 0 && removed.length === 0;

console.log(JSON.stringify({ moves, patch, nonPatch, added, removed, clean }, null, 2));
