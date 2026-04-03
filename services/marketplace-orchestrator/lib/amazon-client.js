const crypto = require('crypto');

const { findMarketplace, findTenant, getTenantAmazonConfig } = require('./config-loader');
const { nowIso } = require('./store');

const AMAZON_ENDPOINTS = {
  na: {
    baseUri: 'https://sellingpartnerapi-na.amazon.com',
    awsRegion: 'us-east-1',
  },
  eu: {
    baseUri: 'https://sellingpartnerapi-eu.amazon.com',
    awsRegion: 'eu-west-1',
  },
  fe: {
    baseUri: 'https://sellingpartnerapi-fe.amazon.com',
    awsRegion: 'us-west-2',
  },
};

const DEFAULT_NOTIFICATION_TYPES = [
  'LISTINGS_ITEM_STATUS_CHANGE',
  'LISTINGS_ITEM_ISSUES_CHANGE',
  'ITEM_PRODUCT_TYPE_CHANGE',
  'PRODUCT_TYPE_DEFINITIONS_CHANGE',
  'ACCOUNT_STATUS_CHANGED',
];

const accessTokenCache = new Map();

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest(encoding);
}

function hash(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function toDateStamp(date) {
  return toAmzDate(date).slice(0, 8);
}

function canonicalQuery(query = {}) {
  return Object.entries(query)
    .flatMap(([key, value]) => {
      if (undefined === value || null === value || '' === value) {
        return [];
      }

      if (Array.isArray(value)) {
        return [[key, value.join(',')]];
      }

      return [[key, `${value}`]];
    })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function ensureOk(response, bodyText) {
  if (response.ok) {
    return;
  }

  throw new Error(`Amazon SP-API request failed with HTTP ${response.status}: ${bodyText}`);
}

function parseMaybeJson(text) {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return { raw: text };
  }
}

function resolveAmazonContext(tenantCode, marketplaceCode) {
  const tenant = findTenant(tenantCode);
  if (!tenant) {
    throw new Error(`Unknown tenant "${tenantCode}".`);
  }

  const tenantAmazon = getTenantAmazonConfig(tenantCode);
  if (!tenantAmazon) {
    throw new Error(`Tenant "${tenantCode}" has no Amazon configuration.`);
  }

  const marketplace = marketplaceCode ? findMarketplace(tenantCode, marketplaceCode) : null;
  const regionKey = (tenantAmazon.region || 'na').toLowerCase();
  const endpoint = AMAZON_ENDPOINTS[regionKey];
  if (!endpoint) {
    throw new Error(`Unsupported Amazon region "${tenantAmazon.region}".`);
  }

  return {
    tenant,
    marketplace,
    amazon: {
      ...tenantAmazon,
      baseUri: tenantAmazon.baseUri || endpoint.baseUri,
      awsRegion: tenantAmazon.awsRegion || endpoint.awsRegion,
      mode: (tenantAmazon.mode || 'mock').toLowerCase(),
      sellerId: tenantAmazon.sellerId || null,
    },
  };
}

async function getAccessToken(amazon) {
  const cacheKey = [amazon.lwaClientId, amazon.refreshToken].join(':');
  const cached = accessTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  if (!amazon.lwaClientId || !amazon.lwaClientSecret || !amazon.refreshToken) {
    throw new Error('Missing Login with Amazon credentials or refresh token.');
  }

  const response = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: amazon.refreshToken,
      client_id: amazon.lwaClientId,
      client_secret: amazon.lwaClientSecret,
    }),
  });

  const text = await response.text();
  ensureOk(response, text);
  const json = parseMaybeJson(text);
  const expiresInMs = Math.max(60, Number(json.expires_in || 3600)) * 1000;

  accessTokenCache.set(cacheKey, {
    accessToken: json.access_token,
    expiresAt: Date.now() + expiresInMs,
  });

  return json.access_token;
}

function signRequest({ method, url, body, amazon, accessToken }) {
  if (!amazon.awsAccessKeyId || !amazon.awsSecretAccessKey) {
    throw new Error('Missing AWS credentials for Amazon SP-API signing.');
  }

  const requestUrl = new URL(url);
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);
  const payloadHash = hash(body || '');
  const canonicalHeaders = {
    host: requestUrl.host,
    'user-agent': amazon.userAgent || 'coppermind-marketplace-orchestrator/0.2.0',
    'x-amz-access-token': accessToken,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  if (amazon.awsSessionToken) {
    canonicalHeaders['x-amz-security-token'] = amazon.awsSessionToken;
  }

  const headerNames = Object.keys(canonicalHeaders).sort();
  const canonicalHeaderBlock = headerNames.map((name) => `${name}:${canonicalHeaders[name]}\n`).join('');
  const signedHeaders = headerNames.join(';');
  const canonicalRequest = [
    method.toUpperCase(),
    requestUrl.pathname || '/',
    requestUrl.search.replace(/^\?/, ''),
    canonicalHeaderBlock,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${amazon.awsRegion}/execute-api/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hash(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${amazon.awsSecretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, amazon.awsRegion);
  const kService = hmac(kRegion, 'execute-api');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign, 'hex');

  return {
    ...canonicalHeaders,
    Authorization: [
      `AWS4-HMAC-SHA256 Credential=${amazon.awsAccessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', '),
  };
}

async function spApiRequest(amazon, method, path, { query, body, headers } = {}) {
  const requestUrl = `${amazon.baseUri}${path}${query ? `?${canonicalQuery(query)}` : ''}`;
  const serializedBody = undefined === body || null === body ? '' : JSON.stringify(body);

  if ('mock' === amazon.mode) {
    return mockRequest(amazon, method, path, { query, body });
  }

  const accessToken = await getAccessToken(amazon);
  const signedHeaders = signRequest({
    method,
    url: requestUrl,
    body: serializedBody,
    amazon,
    accessToken,
  });

  const response = await fetch(requestUrl, {
    method,
    headers: {
      ...signedHeaders,
      ...(headers || {}),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: ['GET', 'HEAD'].includes(method.toUpperCase()) ? undefined : serializedBody,
  });

  const text = await response.text();
  ensureOk(response, text);
  return parseMaybeJson(text);
}

function mockRequest(amazon, method, path, { query, body }) {
  const now = nowIso();

  if ('/notifications/v1/subscriptions' === path || path.includes('/subscriptions/')) {
    return {
      subscriptionId: `mock-subscription-${Date.now()}`,
      payloadVersion: body?.payloadVersion || '1.0',
      processingDirective: 'ACTIVE',
      notificationType: path.split('/').pop(),
      destinationId: body?.destinationId || amazon.notifications?.destinationId || 'mock-destination',
      createdAt: now,
    };
  }

  if ('/notifications/v1/destinations' === path) {
    return {
      destinationId: `mock-destination-${Date.now()}`,
      name: body?.name || 'mock-eventbridge',
      createdAt: now,
    };
  }

  if (path.includes('/definitions/2020-09-01/productTypes/')) {
    return {
      productType: path.split('/').pop(),
      requirements: query?.requirements || 'LISTING',
      productTypeVersion: {
        version: 'mock-2026-04-02',
        latest: true,
      },
      propertyGroups: {
        offer: {
          title: 'Offer',
          propertyNames: ['item_name', 'brand', 'product_description', 'bullet_point'],
        },
      },
      schema: {
        properties: {
          item_name: { type: 'string' },
          brand: { type: 'string' },
          product_description: { type: 'string' },
          bullet_point: { type: 'array' },
        },
      },
      retrievedAt: now,
    };
  }

  if (path.includes('/listings/2021-08-01/items/')) {
    const preview = query?.mode === 'VALIDATION_PREVIEW';
    const sku = path.split('/').pop();
    return {
      sku,
      status: preview ? 'VALIDATED' : 'ACCEPTED',
      submissionId: `mock-listing-${Date.now()}`,
      issues: [],
      summaries: [
        {
          marketplaceId: query?.marketplaceIds || amazon.marketplaceId || 'ATVPDKIKX0DER',
          status: ['BUYABLE', 'DISCOVERABLE'],
        },
      ],
      body,
      preview,
      submittedAt: now,
    };
  }

  if (path === '/feeds/2021-06-30/documents') {
    return {
      feedDocumentId: `mock-feed-document-${Date.now()}`,
      url: 'https://example.invalid/mock-feed-upload',
    };
  }

  if (path === '/feeds/2021-06-30/feeds') {
    return {
      feedId: `mock-feed-${Date.now()}`,
      processingStatus: 'IN_QUEUE',
      submittedAt: now,
    };
  }

  if (path === '/reports/2021-06-30/reports') {
    if ('POST' === method.toUpperCase()) {
      return {
        reportId: `mock-report-${Date.now()}`,
        processingStatus: 'DONE',
        createdTime: now,
      };
    }

    return {
      reportId: query?.reportId || `mock-report-${Date.now()}`,
      processingStatus: 'DONE',
      reportDocumentId: `mock-report-document-${Date.now()}`,
    };
  }

  if (path.includes('/reports/2021-06-30/documents/')) {
    return {
      reportDocumentId: path.split('/').pop(),
      compressionAlgorithm: null,
      url: 'https://example.invalid/mock-report-download',
      document: {
        accountHealth: 'GOOD',
        policyViolations: 0,
      },
    };
  }

  if (path === '/sellers/v1/marketplaceParticipations') {
    return {
      payload: [{
        marketplace: {
          id: amazon.marketplaceId || 'ATVPDKIKX0DER',
        },
        participation: {
          isParticipating: true,
          hasSuspendedListings: false,
        },
      }],
    };
  }

  if (path === '/appIntegrations/2024-04-01/notifications') {
    return {
      notificationId: `mock-app-notification-${Date.now()}`,
      status: 'ACCEPTED',
      createdAt: now,
    };
  }

  return {
    ok: true,
    method,
    path,
    query: query || {},
    body: body || null,
    mockedAt: now,
  };
}

function buildListingBody(marketplace, product, overrides = {}) {
  const attributes = product.attributes || {};
  const amazonMarketplace = marketplace.amazon || {};
  const marketplaceId = amazonMarketplace.marketplaceId || overrides.marketplaceId || null;
  const locale = amazonMarketplace.languageTag || marketplace.locale || 'en_US';
  const bulletPoints = Object.keys(attributes)
    .filter((key) => key.startsWith('bullet_') && attributes[key])
    .sort()
    .map((key) => ({
      value: attributes[key],
      marketplace_id: marketplaceId,
      language_tag: locale,
    }));

  const body = {
    productType: amazonMarketplace.productType || 'PRODUCT',
    requirements: amazonMarketplace.requirements || 'LISTING',
    attributes: {
      item_name: [{
        value: overrides.title || attributes.marketplace_title || attributes.name || '',
        marketplace_id: marketplaceId,
        language_tag: locale,
      }],
      brand: [{
        value: attributes.brand || '',
        marketplace_id: marketplaceId,
        language_tag: locale,
      }],
      product_description: [{
        value: overrides.description || attributes.description || '',
        marketplace_id: marketplaceId,
        language_tag: locale,
      }],
    },
  };

  if (bulletPoints.length > 0) {
    body.attributes.bullet_point = bulletPoints;
  }

  return body;
}

function createAmazonClient(tenantCode, marketplaceCode) {
  const context = resolveAmazonContext(tenantCode, marketplaceCode);

  return {
    context,
    isLive() {
      return context.amazon.mode === 'live';
    },
    trackedNotificationTypes() {
      return context.amazon.notifications?.types || DEFAULT_NOTIFICATION_TYPES;
    },
    async bootstrapNotifications() {
      let destinationId = context.amazon.notifications?.destinationId || null;

      if (!destinationId && context.amazon.notifications?.destinationPayload) {
        const destination = await spApiRequest(context.amazon, 'POST', '/notifications/v1/destinations', {
          body: context.amazon.notifications.destinationPayload,
        });
        destinationId = destination.destinationId;
      }

      if (!destinationId) {
        throw new Error('Amazon notifications require a destinationId or notifications.destinationPayload.');
      }

      const subscriptions = [];
      for (const notificationType of this.trackedNotificationTypes()) {
        const subscription = await spApiRequest(context.amazon, 'POST', `/notifications/v1/subscriptions/${notificationType}`, {
          body: {
            destinationId,
            payloadVersion: '1.0',
          },
        });
        subscriptions.push(subscription);
      }

      return {
        destinationId,
        subscriptions,
      };
    },
    async syncProductType(productType, marketplace) {
      const amazonMarketplace = marketplace.amazon || {};
      const marketplaceId = amazonMarketplace.marketplaceId || context.amazon.marketplaceId;
      if (!marketplaceId) {
        throw new Error(`Marketplace "${marketplace.code}" is missing amazon.marketplaceId.`);
      }

      return spApiRequest(context.amazon, 'GET', `/definitions/2020-09-01/productTypes/${productType}`, {
        query: {
          marketplaceIds: marketplaceId,
          requirements: amazonMarketplace.requirements || 'LISTING',
          locale: amazonMarketplace.locale || marketplace.locale || 'en_US',
        },
      });
    },
    buildListingBody(product, marketplace, overrides = {}) {
      return buildListingBody(marketplace, product, overrides);
    },
    async validateListing({ marketplace, product, sku, body, submissionMode }) {
      const amazonMarketplace = marketplace.amazon || {};
      const sellerId = context.amazon.sellerId;
      const marketplaceId = amazonMarketplace.marketplaceId || context.amazon.marketplaceId;
      if (!sellerId || !marketplaceId) {
        throw new Error('Amazon validation requires sellerId and marketplaceId.');
      }

      const payload = body || buildListingBody(marketplace, product);
      const method = (submissionMode || amazonMarketplace.submissionMode || 'put').toLowerCase() === 'patch'
        ? 'PATCH'
        : 'PUT';

      return spApiRequest(
        context.amazon,
        method,
        `/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(sku)}`,
        {
          query: {
            marketplaceIds: marketplaceId,
            mode: 'VALIDATION_PREVIEW',
            issueLocale: amazonMarketplace.issueLocale || marketplace.locale || 'en_US',
          },
          body: payload,
        }
      );
    },
    async submitListing({ marketplace, product, sku, body, submissionMode }) {
      const amazonMarketplace = marketplace.amazon || {};
      const sellerId = context.amazon.sellerId;
      const marketplaceId = amazonMarketplace.marketplaceId || context.amazon.marketplaceId;
      if (!sellerId || !marketplaceId) {
        throw new Error('Amazon submission requires sellerId and marketplaceId.');
      }

      const payload = body || buildListingBody(marketplace, product);
      const mode = (submissionMode || amazonMarketplace.submissionMode || 'put').toLowerCase();

      if ('feed' === mode) {
        const document = await spApiRequest(context.amazon, 'POST', '/feeds/2021-06-30/documents', {
          body: { contentType: 'application/json; charset=UTF-8' },
        });

        const feedContent = JSON.stringify({
          header: {
            sellerId,
            version: '2.0',
            issueLocale: amazonMarketplace.issueLocale || marketplace.locale || 'en_US',
          },
          messages: [{
            messageId: 1,
            sku,
            operationType: 'UPDATE',
            productType: payload.productType,
            requirements: payload.requirements,
            attributes: payload.attributes,
          }],
        });

        if (document.url && context.amazon.mode !== 'mock') {
          await fetch(document.url, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json; charset=UTF-8',
            },
            body: feedContent,
          });
        }

        const feed = await spApiRequest(context.amazon, 'POST', '/feeds/2021-06-30/feeds', {
          body: {
            feedType: 'JSON_LISTINGS_FEED',
            marketplaceIds: [marketplaceId],
            inputFeedDocumentId: document.feedDocumentId,
          },
        });

        return {
          mode: 'feed',
          feedDocumentId: document.feedDocumentId,
          feedId: feed.feedId,
          processingStatus: feed.processingStatus,
        };
      }

      const method = mode === 'patch' ? 'PATCH' : 'PUT';
      return spApiRequest(
        context.amazon,
        method,
        `/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(sku)}`,
        {
          query: {
            marketplaceIds: marketplaceId,
            issueLocale: amazonMarketplace.issueLocale || marketplace.locale || 'en_US',
          },
          body: payload,
        }
      );
    },
    async getListingStatus({ marketplace, sku }) {
      const amazonMarketplace = marketplace.amazon || {};
      const sellerId = context.amazon.sellerId;
      const marketplaceId = amazonMarketplace.marketplaceId || context.amazon.marketplaceId;
      if (!sellerId || !marketplaceId) {
        throw new Error('Amazon listing status lookup requires sellerId and marketplaceId.');
      }

      return spApiRequest(context.amazon, 'GET', `/listings/2021-08-01/items/${sellerId}/${encodeURIComponent(sku)}`, {
        query: {
          marketplaceIds: marketplaceId,
          includedData: 'issues,summaries,attributes',
        },
      });
    },
    async requestSellerPerformanceReport() {
      return spApiRequest(context.amazon, 'POST', '/reports/2021-06-30/reports', {
        body: {
          reportType: 'GET_V2_SELLER_PERFORMANCE_REPORT',
        },
      });
    },
    async getSellerPerformanceReport(reportId) {
      return spApiRequest(context.amazon, 'GET', `/reports/2021-06-30/reports/${reportId}`);
    },
    async getSellerPerformanceReportDocument(reportDocumentId) {
      return spApiRequest(context.amazon, 'GET', `/reports/2021-06-30/documents/${reportDocumentId}`);
    },
    async getMarketplaceParticipations() {
      return spApiRequest(context.amazon, 'GET', '/sellers/v1/marketplaceParticipations');
    },
    async createSellerCentralNotification(body) {
      return spApiRequest(context.amazon, 'POST', '/appIntegrations/2024-04-01/notifications', {
        body,
      });
    },
  };
}

module.exports = {
  AMAZON_ENDPOINTS,
  DEFAULT_NOTIFICATION_TYPES,
  createAmazonClient,
};
