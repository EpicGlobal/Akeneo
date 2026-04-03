require('./bootstrap-env');

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_FILE = process.env.MARKETPLACE_ORCHESTRATOR_CONFIG_FILE
  || path.resolve(__dirname, '..', 'config', 'tenants.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(DEFAULT_CONFIG_FILE, 'utf8'));
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

function listTenants() {
  return (loadConfig().tenants || []).map(resolveTenant);
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

module.exports = {
  amazonCredentialStatus,
  findMarketplace,
  findTenant,
  getTenantAmazonConfig,
  getTenantListingWriterConfig,
  listMarketplaces,
  listTenants,
  loadConfig,
};
