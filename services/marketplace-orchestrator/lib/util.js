const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(values) {
  return [...new Set((values || []).filter((value) => value !== null && value !== undefined && `${value}`.trim() !== ''))];
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (null === value || undefined === value) {
    return [];
  }

  return [value];
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveFixturePath(...parts) {
  return path.resolve(__dirname, '..', ...parts);
}

module.exports = {
  asArray,
  readJsonFile,
  resolveFixturePath,
  sha256,
  slugify,
  stripHtml,
  unique,
};
