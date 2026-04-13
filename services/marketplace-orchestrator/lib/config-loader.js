require('./bootstrap-env');

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_FILE = process.env.MARKETPLACE_ORCHESTRATOR_CONFIG_FILE
  || path.resolve(__dirname, '..', 'config', 'tenants.json');
const DEFAULT_OVERRIDE_FILE = process.env.MARKETPLACE_ORCHESTRATOR_OVERRIDE_FILE
  || path.resolve(__dirname, '..', 'config', 'tenant-overrides.json');

function loadJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function loadConfig() {
  return loadJsonFile(DEFAULT_CONFIG_FILE, { tenants: [] });
}

function loadOverrides() {
  return loadJsonFile(DEFAULT_OVERRIDE_FILE, { tenants: {} });
}

function ensureOverrideDirectory() {
  fs.mkdirSync(path.dirname(DEFAULT_OVERRIDE_FILE), { recursive: true });
}

function saveOverrides(payload) {
  ensureOverrideDirectory();
  fs.writeFileSync(DEFAULT_OVERRIDE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (undefined !== value && null !== value && '' !== String(value).trim()) {
      return String(value).trim();
    }
  }

  return null;
}

function envBoolean(...names) {
  const value = envValue(...names);
  if (null === value) {
    return null;
  }

  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) {
    return false;
  }

  return null;
}

function envInteger(...names) {
  const value = envValue(...names);
  if (null === value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function envList(...names) {
  const value = envValue(...names);
  if (null === value) {
    return null;
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function envJson(...names) {
  const value = envValue(...names);
  if (null === value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function tenantPrefix(tenant) {
  return tenant?.envPrefix || `MARKETPLACE_${String(tenant?.code || '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
}

function sanitizeString(value, maxLength = 255) {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, maxLength) : '';
}

function normalizeCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function sanitizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((entry) => sanitizeString(entry, 160)).filter(Boolean))];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeMarketplaces(baseMarketplaces = [], overrideMarketplaces = {}) {
  const overrides = Array.isArray(overrideMarketplaces)
    ? Object.fromEntries(overrideMarketplaces.map((marketplace) => [marketplace.code, marketplace]))
    : overrideMarketplaces;

  const merged = baseMarketplaces.map((marketplace) => {
    const override = overrides?.[marketplace.code] || null;
    if (!override) {
      return marketplace;
    }

    return {
      ...marketplace,
      ...override,
      amazon: marketplace.amazon || override.amazon ? {
        ...(marketplace.amazon || {}),
        ...(override.amazon || {}),
      } : undefined,
    };
  });

  const knownCodes = new Set(baseMarketplaces.map((marketplace) => marketplace.code));
  for (const [marketplaceCode, override] of Object.entries(overrides || {})) {
    if (knownCodes.has(marketplaceCode) || !override || 'object' !== typeof override) {
      continue;
    }

    merged.push({
      code: sanitizeString(override.code, 80) || marketplaceCode,
      label: sanitizeString(override.label, 120) || marketplaceCode,
      channel: sanitizeString(override.channel, 80) || '',
      locale: sanitizeString(override.locale, 32) || '',
      market: sanitizeString(override.market, 32) || '',
      requiredAttributes: sanitizeStringList(override.requiredAttributes),
      requiredAssetRoles: sanitizeStringList(override.requiredAssetRoles),
      requiredApprovals: sanitizeStringList(override.requiredApprovals),
      minimumImageCount: Number.isFinite(Number(override.minimumImageCount)) ? Number(override.minimumImageCount) : 0,
      automation: sanitizeStringList(override.automation),
      amazon: override.amazon ? {
        ...override.amazon,
      } : undefined,
    });
  }

  return merged;
}

function mergeTenant(baseTenant, overrideTenant) {
  if (!overrideTenant) {
    return baseTenant;
  }

  const merged = {
    ...baseTenant,
    ...overrideTenant,
  };

  if (baseTenant.governance || overrideTenant.governance) {
    merged.governance = {
      ...(baseTenant.governance || {}),
      ...(overrideTenant.governance || {}),
    };
  }

  if (baseTenant.amazon || overrideTenant.amazon) {
    merged.amazon = {
      ...(baseTenant.amazon || {}),
      ...(overrideTenant.amazon || {}),
      notifications: {
        ...(baseTenant.amazon?.notifications || {}),
        ...(overrideTenant.amazon?.notifications || {}),
      },
      alerts: {
        ...(baseTenant.amazon?.alerts || {}),
        ...(overrideTenant.amazon?.alerts || {}),
        email: {
          ...(baseTenant.amazon?.alerts?.email || {}),
          ...(overrideTenant.amazon?.alerts?.email || {}),
        },
        sellerCentral: {
          ...(baseTenant.amazon?.alerts?.sellerCentral || {}),
          ...(overrideTenant.amazon?.alerts?.sellerCentral || {}),
        },
      },
    };
  }

  if (baseTenant.ai || overrideTenant.ai) {
    merged.ai = {
      ...(baseTenant.ai || {}),
      ...(overrideTenant.ai || {}),
      listingWriter: {
        ...(baseTenant.ai?.listingWriter || {}),
        ...(overrideTenant.ai?.listingWriter || {}),
      },
    };
  }

  merged.marketplaces = mergeMarketplaces(baseTenant.marketplaces || [], overrideTenant.marketplaces || {});

  return merged;
}

function resolveAmazonConfig(tenant) {
  if (!tenant.amazon) {
    return null;
  }

  const prefix = tenant.amazon.envPrefix || `${tenantPrefix(tenant)}_AMAZON`;
  const alerts = tenant.amazon.alerts || {};
  const sellerCentral = alerts.sellerCentral || {};
  const destinationPayload = envJson(`${prefix}_NOTIFICATION_DESTINATION_PAYLOAD_JSON`);

  return {
    ...tenant.amazon,
    enabled: envBoolean(`${prefix}_ENABLED`) ?? tenant.amazon.enabled !== false,
    mode: envValue(`${prefix}_MODE`) || tenant.amazon.mode || 'mock',
    pilotFamilyCodes: envList(`${prefix}_PILOT_FAMILY_CODES`) || tenant.amazon.pilotFamilyCodes || [],
    region: envValue(`${prefix}_REGION`) || tenant.amazon.region || 'na',
    baseUri: envValue(`${prefix}_BASE_URI`) || tenant.amazon.baseUri || null,
    awsRegion: envValue(`${prefix}_AWS_REGION`) || tenant.amazon.awsRegion || null,
    sellerId: envValue(`${prefix}_SELLER_ID`) || tenant.amazon.sellerId || null,
    marketplaceId: envValue(`${prefix}_MARKETPLACE_ID`) || tenant.amazon.marketplaceId || null,
    lwaClientId: envValue(`${prefix}_LWA_CLIENT_ID`) || tenant.amazon.lwaClientId || null,
    lwaClientSecret: envValue(`${prefix}_LWA_CLIENT_SECRET`) || tenant.amazon.lwaClientSecret || null,
    refreshToken: envValue(`${prefix}_REFRESH_TOKEN`) || tenant.amazon.refreshToken || null,
    awsAccessKeyId: envValue(`${prefix}_AWS_ACCESS_KEY_ID`) || tenant.amazon.awsAccessKeyId || null,
    awsSecretAccessKey: envValue(`${prefix}_AWS_SECRET_ACCESS_KEY`) || tenant.amazon.awsSecretAccessKey || null,
    awsSessionToken: envValue(`${prefix}_AWS_SESSION_TOKEN`) || tenant.amazon.awsSessionToken || null,
    userAgent: envValue(`${prefix}_USER_AGENT`) || tenant.amazon.userAgent || null,
    notifications: {
      ...(tenant.amazon.notifications || {}),
      destinationId: envValue(`${prefix}_NOTIFICATION_DESTINATION_ID`) || tenant.amazon.notifications?.destinationId || null,
      destinationPayload: destinationPayload || tenant.amazon.notifications?.destinationPayload || null,
      types: envList(`${prefix}_NOTIFICATION_TYPES`) || tenant.amazon.notifications?.types || [],
    },
    alerts: {
      ...alerts,
      slackWebhookUrl: envValue(`${prefix}_SLACK_WEBHOOK_URL`) || alerts.slackWebhookUrl || null,
      pagerDutyRoutingKey: envValue(`${prefix}_PAGERDUTY_ROUTING_KEY`) || alerts.pagerDutyRoutingKey || null,
      email: {
        ...(alerts.email || {}),
        enabled: envBoolean(`${prefix}_ALERT_EMAIL_ENABLED`) ?? alerts.email?.enabled ?? false,
        to: envList(`${prefix}_ALERT_EMAIL_TO`) || alerts.email?.to || [],
      },
      sellerCentral: {
        ...sellerCentral,
        enabled: envBoolean(`${prefix}_SELLER_CENTRAL_ENABLED`) ?? sellerCentral.enabled ?? false,
        marketplaceId: envValue(`${prefix}_SELLER_CENTRAL_MARKETPLACE_ID`) || sellerCentral.marketplaceId || null,
        destinationUserId: envValue(`${prefix}_SELLER_CENTRAL_DESTINATION_USER_ID`) || sellerCentral.destinationUserId || null,
        notificationType: envValue(`${prefix}_SELLER_CENTRAL_NOTIFICATION_TYPE`) || sellerCentral.notificationType || 'WARNING',
      },
    },
  };
}

function resolveListingWriterConfig(tenant) {
  const listingWriter = tenant.ai?.listingWriter;
  if (!listingWriter) {
    return null;
  }

  const prefix = listingWriter.envPrefix || `${tenantPrefix(tenant)}_EPIC_AI`;
  return {
    ...listingWriter,
    enabled: envBoolean(`${prefix}_LISTING_WRITER_ENABLED`) ?? listingWriter.enabled !== false,
    baseUrl: envValue(`${prefix}_BASE_URL`) || listingWriter.baseUrl || null,
    bearerToken: envValue(`${prefix}_BEARER_TOKEN`) || listingWriter.bearerToken || null,
    timeoutMs: envInteger(`${prefix}_TIMEOUT_MS`) || listingWriter.timeoutMs || 180000,
    providerIds: envList(`${prefix}_PROVIDER_IDS`) || listingWriter.providerIds || [],
  };
}

function resolveTenant(tenant) {
  return {
    ...tenant,
    amazon: resolveAmazonConfig(tenant),
    ai: tenant.ai ? {
      ...tenant.ai,
      listingWriter: resolveListingWriterConfig(tenant),
    } : null,
  };
}

function buildSyntheticBaseTenant(overrideTenant, baseTenants) {
  const templateCode = sanitizeString(overrideTenant?.templateCode, 64) || 'default';
  const template = (baseTenants || []).find((tenant) => tenant.code === templateCode) || (baseTenants || [])[0] || null;
  if (!template) {
    return null;
  }

  const code = normalizeCode(overrideTenant?.code) || template.code;
  const label = sanitizeString(overrideTenant?.label, 191) || `${template.label} Tenant`;
  const synthetic = clone(template);
  synthetic.code = code;
  synthetic.label = label;
  return synthetic;
}

function listTenants() {
  const config = loadConfig();
  const overrides = loadOverrides();
  const baseTenants = config.tenants || [];
  const merged = new Map();

  for (const tenant of baseTenants) {
    merged.set(tenant.code, mergeTenant(tenant, overrides?.tenants?.[tenant.code] || null));
  }

  for (const [tenantCode, overrideTenant] of Object.entries(overrides?.tenants || {})) {
    if (merged.has(tenantCode)) {
      continue;
    }

    const syntheticBase = buildSyntheticBaseTenant({ ...overrideTenant, code: tenantCode }, baseTenants);
    if (!syntheticBase) {
      continue;
    }

    merged.set(tenantCode, mergeTenant(syntheticBase, { ...overrideTenant, code: tenantCode }));
  }

  return [...merged.values()].map(resolveTenant);
}

function findTenant(tenantCode) {
  return listTenants().find((tenant) => tenant.code === tenantCode) || null;
}

function findMarketplace(tenantCode, marketplaceCode) {
  const tenant = findTenant(tenantCode);
  if (!tenant) {
    return null;
  }

  return (tenant.marketplaces || []).find((marketplace) => marketplace.code === marketplaceCode) || null;
}

function listMarketplaces(tenantCode) {
  const tenant = findTenant(tenantCode);
  if (!tenant) {
    return [];
  }

  return tenant.marketplaces || [];
}

function getTenantAmazonConfig(tenantCode) {
  const tenant = findTenant(tenantCode);
  if (!tenant) {
    return null;
  }

  return tenant.amazon || null;
}

function getTenantListingWriterConfig(tenantCode) {
  const tenant = findTenant(tenantCode);
  if (!tenant) {
    return null;
  }

  return tenant.ai?.listingWriter || null;
}

function amazonCredentialStatus(amazonConfig) {
  if (!amazonConfig) {
    return null;
  }

  return {
    liveMode: (amazonConfig.mode || 'mock').toLowerCase() === 'live',
    hasLwaClientId: Boolean(amazonConfig.lwaClientId),
    hasLwaClientSecret: Boolean(amazonConfig.lwaClientSecret),
    hasRefreshToken: Boolean(amazonConfig.refreshToken),
    hasAwsAccessKeyId: Boolean(amazonConfig.awsAccessKeyId),
    hasAwsSecretAccessKey: Boolean(amazonConfig.awsSecretAccessKey),
    hasSellerId: Boolean(amazonConfig.sellerId),
    hasMarketplaceId: Boolean(amazonConfig.marketplaceId),
    hasPilotFamilyCodes: (amazonConfig.pilotFamilyCodes || []).length > 0,
    hasNotificationDestination: Boolean(
      amazonConfig.notifications?.destinationId || amazonConfig.notifications?.destinationPayload
    ),
    hasSlackWebhook: Boolean(amazonConfig.alerts?.slackWebhookUrl),
    hasPagerDutyRoutingKey: Boolean(amazonConfig.alerts?.pagerDutyRoutingKey),
    hasAlertEmailRecipients: (amazonConfig.alerts?.email?.to || []).length > 0,
    hasSellerCentralNotificationTarget: Boolean(
      amazonConfig.alerts?.sellerCentral?.enabled && amazonConfig.alerts?.sellerCentral?.marketplaceId
    ),
  };
}

function getTenantAdminSettings(tenantCode) {
  const tenant = findTenant(tenantCode);
  if (!tenant) {
    return null;
  }

  return {
    tenantCode: tenant.code,
    label: tenant.label,
    governance: tenant.governance || null,
    amazon: tenant.amazon ? {
      enabled: tenant.amazon.enabled !== false,
      mode: tenant.amazon.mode || 'mock',
      pilotFamilyCodes: tenant.amazon.pilotFamilyCodes || [],
      notificationTypes: tenant.amazon.notifications?.types || [],
      alerts: {
        email: {
          enabled: tenant.amazon.alerts?.email?.enabled ?? false,
          to: tenant.amazon.alerts?.email?.to || [],
        },
        sellerCentral: tenant.amazon.alerts?.sellerCentral || {},
      },
      credentialStatus: amazonCredentialStatus(tenant.amazon),
    } : null,
    ai: tenant.ai?.listingWriter ? {
      enabled: tenant.ai.listingWriter.enabled !== false,
      providerIds: tenant.ai.listingWriter.providerIds || [],
    } : null,
    marketplaces: (tenant.marketplaces || []).map((marketplace) => ({
      code: marketplace.code,
      label: marketplace.label,
      channel: marketplace.channel,
      requiredAttributes: marketplace.requiredAttributes || [],
      requiredAssetRoles: marketplace.requiredAssetRoles || [],
      requiredApprovals: marketplace.requiredApprovals || [],
      minimumImageCount: marketplace.minimumImageCount || 0,
      automation: marketplace.automation || [],
      amazon: marketplace.amazon || null,
    })),
  };
}

function createTenantConfig(payload = {}) {
  const code = normalizeCode(payload.code || payload.label);
  if (!code) {
    throw new Error('Tenant code is required.');
  }

  const label = sanitizeString(payload.label, 191);
  if (!label) {
    throw new Error('Tenant label is required.');
  }

  const existingTenant = findTenant(code);
  if (existingTenant) {
    throw new Error(`Tenant "${code}" already exists.`);
  }

  const config = loadConfig();
  const baseTenants = config.tenants || [];
  const templateCode = sanitizeString(payload.templateCode, 64) || 'default';
  const template = baseTenants.find((tenant) => tenant.code === templateCode) || baseTenants[0] || null;
  if (!template) {
    throw new Error('No tenant template is available.');
  }

  const overrides = loadOverrides();
  overrides.tenants = overrides.tenants || {};
  overrides.tenants[code] = {
    templateCode: template.code,
    code,
    label,
    ownerEmail: sanitizeString(payload.ownerEmail, 191) || '',
    status: sanitizeString(payload.status, 32) || 'draft',
    amazon: {
      ...(payload.amazon && 'object' === typeof payload.amazon ? {
        mode: sanitizeString(payload.amazon.mode, 32) || template.amazon?.mode || 'mock',
        pilotFamilyCodes: sanitizeStringList(payload.amazon.pilotFamilyCodes || []),
        notifications: {
          types: sanitizeStringList(payload.amazon.notificationTypes || []),
        },
        alerts: {
          email: {
            enabled: Boolean(payload.amazon.alerts?.email?.enabled),
            to: sanitizeStringList(payload.amazon.alerts?.email?.to || []),
          },
        },
      } : {}),
    },
    ai: payload.ai && 'object' === typeof payload.ai ? {
      listingWriter: {
        enabled: undefined !== payload.ai.listingWriter?.enabled
          ? Boolean(payload.ai.listingWriter.enabled)
          : (template.ai?.listingWriter?.enabled ?? true),
        providerIds: sanitizeStringList(payload.ai.listingWriter?.providerIds || []),
      },
    } : undefined,
  };

  saveOverrides(overrides);
  return findTenant(code);
}

function updateTenantAdminSettings(tenantCode, payload = {}) {
  const baseTenant = findTenant(tenantCode);
  if (!baseTenant) {
    return null;
  }

  const overrides = loadOverrides();
  const tenantOverrides = {
    ...(overrides.tenants?.[tenantCode] || {}),
  };

  if (undefined !== payload.label) {
    tenantOverrides.label = sanitizeString(payload.label, 191) || baseTenant.label;
  }

  if (payload.amazon && 'object' === typeof payload.amazon) {
    tenantOverrides.amazon = {
      ...(tenantOverrides.amazon || {}),
      mode: sanitizeString(payload.amazon.mode, 32) || tenantOverrides.amazon?.mode || baseTenant.amazon?.mode || 'mock',
      pilotFamilyCodes: undefined !== payload.amazon.pilotFamilyCodes
        ? sanitizeStringList(payload.amazon.pilotFamilyCodes)
        : (tenantOverrides.amazon?.pilotFamilyCodes || baseTenant.amazon?.pilotFamilyCodes || []),
      notifications: {
        ...(tenantOverrides.amazon?.notifications || {}),
        types: undefined !== payload.amazon.notificationTypes
          ? sanitizeStringList(payload.amazon.notificationTypes)
          : (tenantOverrides.amazon?.notifications?.types || baseTenant.amazon?.notifications?.types || []),
      },
      alerts: {
        ...(tenantOverrides.amazon?.alerts || {}),
        email: {
          ...(tenantOverrides.amazon?.alerts?.email || {}),
          enabled: undefined !== payload.amazon.alerts?.email?.enabled
            ? Boolean(payload.amazon.alerts.email.enabled)
            : (tenantOverrides.amazon?.alerts?.email?.enabled ?? baseTenant.amazon?.alerts?.email?.enabled ?? false),
          to: undefined !== payload.amazon.alerts?.email?.to
            ? sanitizeStringList(payload.amazon.alerts.email.to)
            : (tenantOverrides.amazon?.alerts?.email?.to || baseTenant.amazon?.alerts?.email?.to || []),
        },
      },
    };
  }

  if (payload.ai && 'object' === typeof payload.ai && payload.ai.listingWriter && 'object' === typeof payload.ai.listingWriter) {
    tenantOverrides.ai = {
      ...(tenantOverrides.ai || {}),
      listingWriter: {
        ...(tenantOverrides.ai?.listingWriter || {}),
        enabled: undefined !== payload.ai.listingWriter.enabled
          ? Boolean(payload.ai.listingWriter.enabled)
          : (tenantOverrides.ai?.listingWriter?.enabled ?? baseTenant.ai?.listingWriter?.enabled ?? true),
        providerIds: undefined !== payload.ai.listingWriter.providerIds
          ? sanitizeStringList(payload.ai.listingWriter.providerIds)
          : (tenantOverrides.ai?.listingWriter?.providerIds || baseTenant.ai?.listingWriter?.providerIds || []),
      },
    };
  }

  overrides.tenants = overrides.tenants || {};
  overrides.tenants[tenantCode] = tenantOverrides;
  saveOverrides(overrides);

  return getTenantAdminSettings(tenantCode);
}

module.exports = {
  amazonCredentialStatus,
  createTenantConfig,
  findMarketplace,
  findTenant,
  getTenantAdminSettings,
  getTenantAmazonConfig,
  getTenantListingWriterConfig,
  listMarketplaces,
  listTenants,
  loadConfig,
  updateTenantAdminSettings,
};
