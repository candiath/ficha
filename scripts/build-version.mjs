// The build version of the web and the API: the commit time (Unix seconds) of
// the commit a build was made from. Both deploy every commit of the same
// branch, so the one with the larger number is the newer build, and equal
// numbers mean they were built from the same commit. Nobody bumps it.
//
// Where it comes from, first match wins:
//   1. FICHA_BUILD_VERSION, when a build has no git repository (the API's
//      Docker image: .git is not in its build context).
//   2. `git log -1 --format=%ct`, which works on a shallow clone (Render and
//      Netlify clone the repository before building).
//   3. Nothing: the build carries no version and the web does no check.
//
// As a script it writes {"version": "..."} to the path it is given (the API's
// build), or prints the version.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VERSION_PATTERN = /^\d+$/;

/** @returns {string | null} */
export function resolveBuildVersion() {
  const fromEnv = process.env.FICHA_BUILD_VERSION?.trim();
  if (fromEnv && VERSION_PATTERN.test(fromEnv)) return fromEnv;

  try {
    const fromGit = execFileSync('git', ['log', '-1', '--format=%ct'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (VERSION_PATTERN.test(fromGit)) return fromGit;
  } catch {
    // No git, or no repository: fall through.
  }

  console.warn('[build-version] no commit time found: this build carries no version, so the web will not check it.');
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = resolveBuildVersion();
  const out = process.argv[2];
  if (out) {
    writeFileSync(out, `${JSON.stringify({ version })}\n`);
    console.log(`[build-version] ${version ?? 'none'} → ${out}`);
  } else {
    console.log(version ?? '');
  }
}
