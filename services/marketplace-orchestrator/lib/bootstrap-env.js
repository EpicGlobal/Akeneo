const fs = require('fs');
const path = require('path');

const serviceRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serviceRoot, '..', '..');

const CANDIDATE_FILES = [
  path.join(repoRoot, '.env.marketplace.local'),
  path.join(repoRoot, '.env.marketplace'),
  path.join(repoRoot, '.env.local'),
  path.join(serviceRoot, '.env.local'),
  path.join(serviceRoot, '.env'),
  path.join(repoRoot, '.env'),
];

let loaded = false;

function parseEnvLine(line) {
  const match = String(line || '').match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!match) {
    return null;
  }

  let value = match[2] || '';
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith('\'') && value.endsWith('\''))
  ) {
    value = value.slice(1, -1);
  }

  return {
    key: match[1],
    value: value.replace(/\\n/g, '\n'),
  };
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    if (!line || /^\s*#/.test(line)) {
      return;
    }

    const parsed = parseEnvLine(line);
    if (!parsed) {
      return;
    }

    if (undefined === process.env[parsed.key] || '' === process.env[parsed.key]) {
      process.env[parsed.key] = parsed.value;
    }
  });
}

function loadEnv() {
  if (loaded) {
    return;
  }

  CANDIDATE_FILES.forEach(loadEnvFile);
  loaded = true;
}

loadEnv();

module.exports = {
  loadEnv,
  repoRoot,
  serviceRoot,
};
