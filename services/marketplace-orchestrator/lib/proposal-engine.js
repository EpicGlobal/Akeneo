const { unique } = require('./util');

const HUMAN_REVIEW_FIELDS = new Set([
  'title',
  'brand',
  'productType',
  'category',
  'safety_and_compliance',
]);

const LOW_RISK_FIELDS = new Set([
  'description',
  'bullet_1',
  'bullet_2',
  'bullet_3',
  'bullet_4',
  'bullet_5',
  'search_terms',
  'keywords',
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function buildProposal({ tenantCode, marketplaceCode, sku, field, currentValue, proposedValue, reason, evidence }) {
  const autoApplyEligible = LOW_RISK_FIELDS.has(field) && !HUMAN_REVIEW_FIELDS.has(field);

  return {
    tenantCode,
    marketplaceCode,
    sku,
    field,
    currentValue,
    proposedValue,
    risk: autoApplyEligible ? 'low' : 'high',
    reason,
    evidence: unique(evidence || []),
    autoApplyEligible,
    status: 'open',
  };
}

function compareBrandEvidence({ tenantCode, marketplaceCode, sku, product, brandEvidence, issues }) {
  const proposals = [];
  const attributes = product.attributes || {};

  if (brandEvidence.description) {
    const currentDescription = normalizeText(attributes.description);
    const proposedDescription = normalizeText(brandEvidence.description);
    if (proposedDescription && proposedDescription !== currentDescription) {
      proposals.push(buildProposal({
        tenantCode,
        marketplaceCode,
        sku,
        field: 'description',
        currentValue: currentDescription,
        proposedValue: proposedDescription,
        reason: 'Brand source description differs from the current marketplace draft.',
        evidence: [brandEvidence.sourceLabel, brandEvidence.sourceUrl, brandEvidence.extractedAt],
      }));
    }
  }

  const currentBullets = [1, 2, 3, 4, 5]
    .map((index) => normalizeText(attributes[`bullet_${index}`]))
    .filter(Boolean);

  (brandEvidence.bullets || []).slice(0, 5).forEach((bullet, index) => {
    const currentValue = currentBullets[index] || '';
    const proposedValue = normalizeText(bullet);
    if (proposedValue && proposedValue !== currentValue) {
      proposals.push(buildProposal({
        tenantCode,
        marketplaceCode,
        sku,
        field: `bullet_${index + 1}`,
        currentValue,
        proposedValue,
        reason: 'Brand source bullet copy differs from the current marketplace draft.',
        evidence: [brandEvidence.sourceLabel, brandEvidence.sourceUrl, brandEvidence.extractedAt],
      }));
    }
  });

  if (brandEvidence.title) {
    const currentTitle = normalizeText(attributes.marketplace_title || attributes.name);
    const proposedTitle = normalizeText(brandEvidence.title);
    if (proposedTitle && proposedTitle !== currentTitle) {
      proposals.push(buildProposal({
        tenantCode,
        marketplaceCode,
        sku,
        field: 'title',
        currentValue: currentTitle,
        proposedValue: proposedTitle,
        reason: 'Brand source title differs from the current marketplace draft.',
        evidence: [brandEvidence.sourceLabel, brandEvidence.sourceUrl, brandEvidence.extractedAt],
      }));
    }
  }

  if ((issues || []).some((issue) => String(issue.code || '').toLowerCase().includes('bullet'))) {
    proposals.push(buildProposal({
      tenantCode,
      marketplaceCode,
      sku,
      field: 'bullet_3',
      currentValue: normalizeText(attributes.bullet_3),
      proposedValue: normalizeText((brandEvidence.bullets || [])[2] || attributes.bullet_3 || ''),
      reason: 'Amazon returned a listing issue that points to incomplete or invalid bullet content.',
      evidence: issues.map((issue) => issue.code || issue.message || '').filter(Boolean),
    }));
  }

  return proposals.filter((proposal) => proposal.currentValue !== proposal.proposedValue && proposal.proposedValue);
}

function compareGeneratedDraft({ tenantCode, marketplaceCode, sku, product, draft, reasonPrefix, evidence }) {
  const proposals = [];
  const attributes = product.attributes || {};
  const reason = reasonPrefix || 'Generated marketplace draft differs from the current marketplace copy.';
  const proof = unique(evidence || []);

  if (draft?.description) {
    const currentDescription = normalizeText(attributes.description);
    const proposedDescription = normalizeText(draft.description);
    if (proposedDescription && proposedDescription !== currentDescription) {
      proposals.push(buildProposal({
        tenantCode,
        marketplaceCode,
        sku,
        field: 'description',
        currentValue: currentDescription,
        proposedValue: proposedDescription,
        reason,
        evidence: proof,
      }));
    }
  }

  (draft?.bullets || []).slice(0, 5).forEach((bullet, index) => {
    const field = `bullet_${index + 1}`;
    const currentValue = normalizeText(attributes[field]);
    const proposedValue = normalizeText(bullet);
    if (proposedValue && proposedValue !== currentValue) {
      proposals.push(buildProposal({
        tenantCode,
        marketplaceCode,
        sku,
        field,
        currentValue,
        proposedValue,
        reason,
        evidence: proof,
      }));
    }
  });

  if (draft?.title) {
    const currentTitle = normalizeText(attributes.marketplace_title || attributes.name);
    const proposedTitle = normalizeText(draft.title);
    if (proposedTitle && proposedTitle !== currentTitle) {
      proposals.push(buildProposal({
        tenantCode,
        marketplaceCode,
        sku,
        field: 'title',
        currentValue: currentTitle,
        proposedValue: proposedTitle,
        reason,
        evidence: proof,
      }));
    }
  }

  return proposals.filter((proposal) => proposal.currentValue !== proposal.proposedValue && proposal.proposedValue);
}

function applyAutoApprovedChanges(product, proposals) {
  const nextProduct = JSON.parse(JSON.stringify(product || {}));
  nextProduct.attributes = nextProduct.attributes || {};

  proposals
    .filter((proposal) => proposal.autoApplyEligible)
    .forEach((proposal) => {
      if ('description' === proposal.field) {
        nextProduct.attributes.description = proposal.proposedValue;
        return;
      }

      nextProduct.attributes[proposal.field] = proposal.proposedValue;
    });

  return nextProduct;
}

module.exports = {
  applyAutoApprovedChanges,
  compareBrandEvidence,
  compareGeneratedDraft,
  HUMAN_REVIEW_FIELDS,
  LOW_RISK_FIELDS,
};
