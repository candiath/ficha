import { readFileSync } from 'node:fs';
import path from 'node:path';

// The build version this process serves: the commit time of the commit it was
// built from (scripts/build-version.mjs). Sent on every response so the web
// can tell when it is out of step with the API it talks to: a tab opened
// before a release, or a release whose API deploy is still running or failed.
//
// FICHA_BUILD_VERSION wins (the Docker image sets it); otherwise the file the
// build writes next to dist/index.js. Neither in `npm run dev` or the tests:
// no version, no header, no check.

export const BUILD_VERSION_HEADER = 'X-Build-Version';

const VERSION_PATTERN = /^\d+$/;

function readStampedVersion(): string | null {
  try {
    const file = path.join(__dirname, '..', 'build-version.json');
    const { version } = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
    return typeof version === 'string' && VERSION_PATTERN.test(version) ? version : null;
  } catch {
    return null;
  }
}

const stampedVersion = readStampedVersion();

export function buildVersion(): string | null {
  const fromEnv = process.env.FICHA_BUILD_VERSION?.trim();
  if (fromEnv && VERSION_PATTERN.test(fromEnv)) return fromEnv;
  return stampedVersion;
}
