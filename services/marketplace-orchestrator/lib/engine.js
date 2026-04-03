function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function normalizeAssets(product) {
  return Array.isArray(product.assets) ? product.assets : [];
}

function normalizeApprovals(product) {
  return Array.isArray(product.approvals) ? product.approvals : [];
}

function buildIssue(code, message, severity = 'blocking') {
  return { code, message, severity };
}

function buildListingPayload(marketplace, product) {
  const attributes = product.attributes || {};
  const assets = normalizeAssets(product)
    .filter((asset) => asset.type === 'image' || !asset.type)
    .map((asset) => ({
      ref: asset.ref || asset.resourceRef || null,
      role: asset.role || null,
      isPrimary: Boolean(asset.isPrimary),
    }));

  return {
    marketplaceCode: marketplace.code,
    channel: marketplace.channel,
    locale: marketplace.locale,
    market: marketplace.market,
    sku: product.identifier || null,
    title: attributes.marketplace_title || attributes.name || null,
    description: attributes.description || null,
    brand: attributes.brand || null,
    bullets: Object.keys(attributes)
      .filter((key) => key.startsWith('bullet_') && !isBlank(attributes[key]))
      .sort()
      .map((key) => attributes[key]),
    assets,
  };
}

function evaluateWorkflow(tenant, marketplace, payload) {
  const product = payload.product || {};
  const attributes = product.attributes || {};
  const assets = normalizeAssets(product);
  const approvals = normalizeApprovals(product);
  const requiredAttributes = marketplace.requiredAttributes || [];
  const requiredAssetRoles = marketplace.requiredAssetRoles || [];
  const requiredApprovals = marketplace.requiredApprovals || [];

  const missingAttributes = requiredAttributes.filter((attributeCode) => isBlank(attributes[attributeCode]));
  const presentRoles = assets
    .map((asset) => asset.role)
    .filter((role) => !isBlank(role));
  const missingAssetRoles = requiredAssetRoles.filter((role) => !presentRoles.includes(role));
  const imageCount = assets.filter((asset) => asset.type === 'image' || !asset.type).length;
  const missingApprovals = requiredApprovals.filter((approval) => !approvals.includes(approval));

  const blockingIssues = [];
  const nextHumanTasks = [];

  if (missingAttributes.length > 0) {
    blockingIssues.push(buildIssue(
      'missing_required_attributes',
      `Missing required marketplace attributes: ${missingAttributes.join(', ')}.`
    ));
    nextHumanTasks.push(`Complete the missing attributes for ${marketplace.label}.`);
  }

  if (missingAssetRoles.length > 0) {
    blockingIssues.push(buildIssue(
      'missing_required_assets',
      `Missing required asset roles: ${missingAssetRoles.join(', ')}.`
    ));
    nextHumanTasks.push(`Attach the missing asset roles for ${marketplace.label}.`);
  }

  if (imageCount < (marketplace.minimumImageCount || 0)) {
    blockingIssues.push(buildIssue(
      'insufficient_image_count',
      `Marketplace requires at least ${marketplace.minimumImageCount} images but only ${imageCount} are present.`
    ));
    nextHumanTasks.push(`Add more marketplace-ready images for ${marketplace.label}.`);
  }

  if (missingApprovals.length > 0) {
    blockingIssues.push(buildIssue(
      'pending_approval',
      `Missing approvals: ${missingApprovals.join(', ')}.`
    ));
    nextHumanTasks.push(`Complete the outstanding approvals for ${marketplace.label}.`);
  }

  const automatedActions = (marketplace.automation || []).map((action) => ({
    code: action,
    status: blockingIssues.length === 0 ? 'ready' : 'blocked',
  }));

  return {
    tenantCode: tenant.code,
    tenantLabel: tenant.label,
    marketplaceCode: marketplace.code,
    marketplaceLabel: marketplace.label,
    readyToPublish: blockingIssues.length === 0,
    blockingIssues,
    nextHumanTasks,
    automatedActions,
    governance: tenant.governance || {},
    readiness: {
      attributes: {
        required: requiredAttributes,
        missing: missingAttributes,
      },
      assets: {
        requiredRoles: requiredAssetRoles,
        missingRoles: missingAssetRoles,
        imageCount,
        minimumImageCount: marketplace.minimumImageCount || 0,
      },
      approvals: {
        required: requiredApprovals,
        missing: missingApprovals,
      },
    },
    listingPayload: buildListingPayload(marketplace, product),
  };
}

module.exports = {
  evaluateWorkflow,
};
