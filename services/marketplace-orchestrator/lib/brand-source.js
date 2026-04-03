const fs = require('fs');

const { sha256, stripHtml, unique } = require('./util');

function extractJsonLd(html) {
  const matches = [...String(html || '').matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  return matches.flatMap((match) => {
    try {
      const parsed = JSON.parse(match[1].trim());
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      return [];
    }
  });
}

function extractMeta(html, name) {
  const regex = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
  const match = String(html || '').match(regex);
  return match ? match[1].trim() : '';
}

function extractListItems(html) {
  return [...String(html || '').matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter(Boolean);
}

function chooseBrandEvidence(jsonLdObjects) {
  const productObject = jsonLdObjects.find((item) => {
    if (!item || 'object' !== typeof item) {
      return false;
    }

    const itemType = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
    return itemType.some((value) => String(value).toLowerCase() === 'product');
  }) || {};

  const brand = productObject.brand;

  return {
    title: productObject.name || '',
    description: productObject.description || '',
    brand: typeof brand === 'string' ? brand : brand?.name || '',
    images: unique(Array.isArray(productObject.image) ? productObject.image : [productObject.image]).filter(Boolean),
  };
}

async function loadBrandSource(source) {
  if (source.fixturePath) {
    const html = fs.readFileSync(source.fixturePath, 'utf8');
    return {
      sourceUrl: source.fixturePath,
      sourceLabel: source.label || source.code || source.fixturePath,
      html,
    };
  }

  if (!source.url) {
    throw new Error('Brand source requires a url or fixturePath.');
  }

  const response = await fetch(source.url, {
    headers: {
      'User-Agent': 'coppermind-marketplace-orchestrator/0.2.0',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  const html = await response.text();
  if (!response.ok) {
    throw new Error(`Unable to fetch brand source ${source.url}: HTTP ${response.status}`);
  }

  return {
    sourceUrl: source.url,
    sourceLabel: source.label || source.code || source.url,
    html,
  };
}

async function snapshotBrandSource(source) {
  const loaded = await loadBrandSource(source);
  const jsonLdObjects = extractJsonLd(loaded.html);
  const evidence = chooseBrandEvidence(jsonLdObjects);
  const bullets = extractListItems(loaded.html)
    .filter((item) => item.length > 20)
    .slice(0, 5);

  const snapshot = {
    sourceCode: source.code || null,
    sourceLabel: loaded.sourceLabel,
    sourceUrl: loaded.sourceUrl,
    title: evidence.title || extractMeta(loaded.html, 'og:title') || extractMeta(loaded.html, 'twitter:title') || '',
    description: evidence.description || extractMeta(loaded.html, 'description') || extractMeta(loaded.html, 'og:description') || '',
    brand: evidence.brand || '',
    images: evidence.images || [],
    bullets,
    textDigest: stripHtml(loaded.html).slice(0, 5000),
    extractedAt: new Date().toISOString(),
  };

  return {
    snapshot,
    hash: sha256(JSON.stringify(snapshot)),
  };
}

module.exports = {
  snapshotBrandSource,
};
