const { getTenantListingWriterConfig } = require('./config-loader');

function createListingWriterClient(tenantCode) {
  const config = getTenantListingWriterConfig(tenantCode);

  return {
    config,
    enabled() {
      return Boolean(config?.enabled && config?.baseUrl && config?.bearerToken);
    },
    readiness() {
      return {
        enabled: Boolean(config?.enabled),
        hasBaseUrl: Boolean(config?.baseUrl),
        hasBearerToken: Boolean(config?.bearerToken),
        providerIds: config?.providerIds || [],
      };
    },
    async generateListingDraft({ marketplaceCode, sku, product, brandEvidence, amazonIssues, existingDraft }) {
      if (!config?.enabled) {
        return {
          skipped: true,
          reason: 'Epic AI listing writer is not enabled for this tenant.',
        };
      }

      if (!config.baseUrl || !config.bearerToken) {
        throw new Error('Epic AI listing writer requires both baseUrl and bearerToken.');
      }

      const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/api/integrations/listing-writer`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.bearerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantCode,
          marketplaceCode,
          sku,
          product,
          brandEvidence,
          amazonIssues,
          existingDraft,
          providerIds: config.providerIds || [],
        }),
        signal: AbortSignal.timeout(Math.max(1000, Number(config.timeoutMs || 180000) || 180000)),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || `Epic AI listing writer returned HTTP ${response.status}.`);
      }

      return payload;
    },
  };
}

module.exports = {
  createListingWriterClient,
};
