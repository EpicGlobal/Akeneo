'use strict';

define(
  ['jquery', 'underscore', 'oro/translator', 'oro/messenger', 'pim/user-context', 'routing', 'pimui/js/view/base'],
  function ($, _, __, messenger, UserContext, Routing, BaseView) {
    var STYLE_ID = 'coppermind-resourcespace-dam-tab-style';
    var COMMON_ASSET_ROLES = ['hero_image', 'angle_left', 'angle_right', 'detail', 'lifestyle', 'swatch', 'manual', 'video'];

    var DamTab = BaseView.extend({
      className: 'CoppermindResourceSpaceTab',

      events: {
        'submit [data-role="resourcespace-search-form"]': 'onSearch',
        'click [data-action="refresh"]': 'onRefresh',
        'click [data-action="link"]': 'onLink',
        'click [data-action="primary"]': 'onPrimary',
        'click [data-action="primary-sync"]': 'onPrimarySync',
        'click [data-action="sync"]': 'onSync',
        'click [data-action="unlink"]': 'onUnlink',
        'click [data-action="retry-writeback"]': 'onRetryWriteback',
        'click [data-action="workflow-request"]': 'onWorkflowRequest',
        'click [data-action="workflow-approve"]': 'onWorkflowApprove',
        'click [data-action="workflow-reject"]': 'onWorkflowReject',
        'change [data-role="asset-role"]': 'onAssetRoleChange',
      },

      initialize: function (config) {
        this.config = (config && config.config) || {};
        this.state = {
          loading: true,
          data: null,
          error: null,
          query: '',
          busy: false,
          busyRef: null,
        };

        BaseView.prototype.initialize.apply(this, arguments);
      },

      configure: function () {
        this.injectStyles();

        this.trigger('tab:register', {
          code: this.config.tabCode || this.code,
          label: __('coppermind_resourcespace.tab.title'),
        });

        this.listenTo(this.getRoot(), 'pim_enrich:form:entity:post_save', function () {
          this.reload(this.state.query);
        }.bind(this));

        return BaseView.prototype.configure.apply(this, arguments).then(function () {
          return this.reload();
        }.bind(this));
      },

      render: function () {
        if (!this.configured) {
          return this;
        }

        this.$el.html(this.renderLayout());

        return this;
      },

      onSearch: function (event) {
        event.preventDefault();
        this.reload(this.$('[data-role="resourcespace-query"]').val() || '');
      },

      onRefresh: function () {
        this.reload(this.state.query);
      },

      onLink: function (event) {
        this.mutateLink($(event.currentTarget).data('resourceRef'), false, false, null);
      },

      onPrimary: function (event) {
        this.mutateLink($(event.currentTarget).data('resourceRef'), true, false, null);
      },

      onPrimarySync: function (event) {
        this.mutateLink($(event.currentTarget).data('resourceRef'), true, true, null);
      },

      onSync: function (event) {
        var button = $(event.currentTarget);

        this.runRequest({
          url: Routing.generate(this.config.syncRoute, _.extend(this.getRouteParameters(), {resourceRef: button.data('resourceRef')})),
          method: 'POST',
          payload: _.extend(this.buildSyncPayload(), {
            assetRole: button.data('assetRole') || null,
          }),
          successMessage: __('coppermind_resourcespace.tab.sync_queued_success'),
          resourceRef: button.data('resourceRef'),
        });
      },

      onUnlink: function (event) {
        var button = $(event.currentTarget);

        this.runRequest({
          url: Routing.generate(this.config.unlinkRoute, _.extend(this.getRouteParameters(), {resourceRef: button.data('resourceRef')})),
          method: 'DELETE',
          successMessage: __('coppermind_resourcespace.tab.unlink_success'),
          resourceRef: button.data('resourceRef'),
        });
      },

      onRetryWriteback: function (event) {
        var button = $(event.currentTarget);

        this.runRequest({
          url: Routing.generate(this.config.retryWritebackRoute, {resourceRef: button.data('resourceRef')}),
          method: 'POST',
          successMessage: __('coppermind_resourcespace.tab.writeback_retry_success'),
          resourceRef: button.data('resourceRef'),
        });
      },

      onWorkflowRequest: function (event) {
        this.updateWorkflow($(event.currentTarget).data('stageCode'), 'request');
      },

      onWorkflowApprove: function (event) {
        this.updateWorkflow($(event.currentTarget).data('stageCode'), 'approve');
      },

      onWorkflowReject: function (event) {
        this.updateWorkflow($(event.currentTarget).data('stageCode'), 'reject');
      },

      onAssetRoleChange: function (event) {
        var select = $(event.currentTarget);

        this.mutateLink(
          select.data('resourceRef'),
          Boolean(select.data('isPrimary')),
          false,
          select.val() || null
        );
      },

      updateWorkflow: function (stageCode, action) {
        this.runRequest({
          url: Routing.generate(this.config.workflowRoute, this.getRouteParameters()),
          method: 'POST',
          payload: {stageCode: stageCode, action: action},
          successMessage: __('coppermind_resourcespace.tab.workflow_' + action + '_success'),
        });
      },

      reload: function (query) {
        if (undefined !== query) {
          this.state.query = query;
        }

        this.state.loading = true;
        this.state.error = null;
        this.render();

        var requestData = {};
        if (undefined !== query) {
          requestData.q = query;
        }

        return $.getJSON(Routing.generate(this.config.listRoute, this.getRouteParameters()), requestData)
          .done(function (response) {
            this.state.loading = false;
            this.state.data = response;
            this.state.query = response.query || this.state.query;
            this.state.error = null;
            this.render();
          }.bind(this))
          .fail(function (xhr) {
            this.state.loading = false;
            this.state.data = null;
            this.state.error = this.extractError(xhr);
            this.render();
            messenger.notify('error', this.state.error);
          }.bind(this));
      },

      mutateLink: function (resourceRef, setPrimary, syncToAkeneo, assetRole) {
        this.runRequest({
          url: Routing.generate(this.config.linkRoute, this.getRouteParameters()),
          method: 'POST',
          payload: _.extend(
            {resourceRef: resourceRef, setPrimary: setPrimary, syncToAkeneo: syncToAkeneo, assetRole: assetRole},
            syncToAkeneo ? this.buildSyncPayload() : {}
          ),
          successMessage: syncToAkeneo
            ? __('coppermind_resourcespace.tab.primary_sync_success')
            : __('coppermind_resourcespace.tab.link_success'),
          resourceRef: resourceRef,
        });
      },

      runRequest: function (options) {
        this.state.busy = true;
        this.state.busyRef = options.resourceRef || null;
        this.render();

        return $.ajax({
          url: options.url,
          type: options.method,
          contentType: 'application/json',
          data: options.payload ? JSON.stringify(options.payload) : null,
        })
          .done(function (response) {
            messenger.notify('success', options.successMessage);
            if (response && response.warning) {
              messenger.notify('warning', response.warning);
            }
            this.reload(this.state.query);
          }.bind(this))
          .fail(function (xhr) {
            messenger.notify('error', this.extractError(xhr));
          }.bind(this))
          .always(function () {
            this.state.busy = false;
            this.state.busyRef = null;
            this.render();
          }.bind(this));
      },

      buildSyncPayload: function () {
        return {
          attributeCode: this.getDefaultAttributeCode(),
          locale: UserContext.get('catalogLocale'),
          scope: UserContext.get('catalogScope'),
        };
      },

      getDefaultAttributeCode: function () {
        return this.state.data &&
          this.state.data.configuration &&
          this.state.data.configuration.default_attribute_code
          ? this.state.data.configuration.default_attribute_code
          : null;
      },

      getRouteParameters: function () {
        var formData = this.getFormData();

        if ('product_model' === this.config.ownerType) {
          return {code: formData.code};
        }

        return {uuid: formData.meta.id};
      },

      availableAssetRoles: function () {
        var roles = COMMON_ASSET_ROLES.slice();

        _.each((((this.state.data || {}).workflow || {}).targets || []), function (target) {
          _.each(target.required_asset_roles || [], function (role) {
            if (role && !_.contains(roles, role)) {
              roles.push(role);
            }
          });
        });

        _.each(((this.state.data || {}).links || []), function (asset) {
          if (asset.asset_role && !_.contains(roles, asset.asset_role)) {
            roles.push(asset.asset_role);
          }
        });

        return roles.sort();
      },

      renderLayout: function () {
        if (this.state.loading) {
          return '<div class="CoppermindResourceSpaceTab-loading">' + _.escape(__('coppermind_resourcespace.tab.loading')) + '</div>';
        }

        if (this.state.error) {
          return '<div class="AknMessageBox AknMessageBox--error"><div class="AknMessageBox-text">' + _.escape(this.state.error) + '</div></div>';
        }

        var data = this.state.data || {};
        var configuration = data.configuration || {};

        return (
          '<div class="CoppermindResourceSpaceTab-header">' + this.renderToolbar(data.query || '', configuration) + '</div>' +
          this.renderWorkflowOverview(data.workflow || {}, data.operations || {}, data.audit || []) +
          '<div class="CoppermindResourceSpaceTab-grid">' +
          '<section class="CoppermindResourceSpaceTab-panel"><div class="CoppermindResourceSpaceTab-panelHeader">' +
          _.escape(__('coppermind_resourcespace.tab.linked_assets')) + '</div>' +
          this.renderAssetList(data.links || [], __('coppermind_resourcespace.tab.no_links'), true, !!configuration.default_attribute_code) +
          '</section>' +
          '<section class="CoppermindResourceSpaceTab-panel"><div class="CoppermindResourceSpaceTab-panelHeader">' +
          _.escape(__('coppermind_resourcespace.tab.matching_assets')) + '</div>' +
          this.renderAssetList(
            data.results || [],
            configuration.configured ? __('coppermind_resourcespace.tab.no_results') : __('coppermind_resourcespace.tab.setup_required'),
            false,
            !!configuration.default_attribute_code
          ) +
          '</section></div>'
        );
      },

      renderToolbar: function (query, configuration) {
        var message = configuration.configured
          ? (
            configuration.default_attribute_code
              ? __('coppermind_resourcespace.tab.default_sync', {attribute: configuration.default_attribute_code})
              : __('coppermind_resourcespace.tab.default_sync_missing')
          )
          : __('coppermind_resourcespace.tab.setup_required');

        return (
          '<form class="CoppermindResourceSpaceTab-toolbar" data-role="resourcespace-search-form">' +
          '<input class="AknTextField CoppermindResourceSpaceTab-search" type="text" data-role="resourcespace-query" placeholder="' +
          _.escape(__('coppermind_resourcespace.tab.search_placeholder')) + '" value="' + _.escape(query || '') + '">' +
          '<button type="submit" class="AknButton AknButton--apply">' + _.escape(__('coppermind_resourcespace.tab.search')) + '</button>' +
          '<button type="button" class="AknButton" data-action="refresh">' + _.escape(__('coppermind_resourcespace.tab.refresh')) + '</button>' +
          '</form>' +
          '<div class="CoppermindResourceSpaceTab-note' + (configuration.configured ? '' : ' CoppermindResourceSpaceTab-note--warning') + '">' +
          _.escape(message) +
          '</div>'
        );
      },

      renderWorkflowOverview: function (workflow, operations, audit) {
        return (
          '<div class="CoppermindResourceSpaceTab-overviewGrid"><section class="CoppermindResourceSpaceTab-panel CoppermindResourceSpaceTab-panel--wide">' +
          '<div class="CoppermindResourceSpaceTab-panelHeader">' + _.escape(__('coppermind_resourcespace.tab.workflow_heading')) + '</div>' +
          '<div class="CoppermindResourceSpaceTab-overviewBody">' +
          '<div class="CoppermindResourceSpaceTab-statGrid">' +
          this.renderStat(__('coppermind_resourcespace.tab.completeness'), this.formatPercent(workflow.completeness_score)) +
          this.renderStat(__('coppermind_resourcespace.tab.publish_status'), __('coppermind_resourcespace.tab.publish_status_' + (workflow.publish_status || 'blocked'))) +
          this.renderStat(__('coppermind_resourcespace.tab.approval_status'), __('coppermind_resourcespace.tab.approval_status_' + (workflow.approval_status || 'pending'))) +
          this.renderStat(__('coppermind_resourcespace.tab.pending_outbox_events'), operations.pending_outbox_events || 0) +
          this.renderStat(__('coppermind_resourcespace.tab.active_ingest_jobs'), operations.active_ingest_jobs || 0) +
          this.renderStat(__('coppermind_resourcespace.tab.linked_asset_count'), operations.linked_asset_count || 0) +
          '</div>' +
          '<div class="CoppermindResourceSpaceTab-section"><div class="CoppermindResourceSpaceTab-sectionTitle">' + _.escape(__('coppermind_resourcespace.tab.blockers')) + '</div>' +
          this.renderBlockers(workflow.blockers || []) + '</div>' +
          '<div class="CoppermindResourceSpaceTab-section"><div class="CoppermindResourceSpaceTab-sectionTitle">' + _.escape(__('coppermind_resourcespace.tab.approvals_heading')) + '</div>' +
          this.renderApprovals(workflow.approvals || []) + '</div>' +
          '<div class="CoppermindResourceSpaceTab-section"><div class="CoppermindResourceSpaceTab-sectionTitle">' + _.escape(__('coppermind_resourcespace.tab.marketplace_readiness')) + '</div>' +
          this.renderTargets(workflow.targets || []) + '</div>' +
          '<div class="CoppermindResourceSpaceTab-section"><div class="CoppermindResourceSpaceTab-sectionTitle">' + _.escape(__('coppermind_resourcespace.tab.audit_heading')) + '</div>' +
          this.renderAudit(audit || []) + '</div>' +
          '</div></section></div>'
        );
      },

      renderStat: function (label, value) {
        return '<div class="CoppermindResourceSpaceTab-statCard"><div class="CoppermindResourceSpaceTab-statLabel">' +
          _.escape(label) + '</div><div class="CoppermindResourceSpaceTab-statValue">' + _.escape(String(value)) + '</div></div>';
      },

      renderBlockers: function (blockers) {
        if (!blockers.length) {
          return '<div class="CoppermindResourceSpaceTab-emptySmall">' + _.escape(__('coppermind_resourcespace.tab.no_blockers')) + '</div>';
        }

        return '<div class="CoppermindResourceSpaceTab-list">' + _.map(blockers, function (blocker) {
          return '<div class="CoppermindResourceSpaceTab-listItem CoppermindResourceSpaceTab-listItem--warning">' +
            '<span class="CoppermindResourceSpaceTab-listBadge">' + _.escape(blocker.target_code || blocker.code || 'issue') + '</span>' +
            _.escape(blocker.message || '') + '</div>';
        }).join('') + '</div>';
      },

      renderApprovals: function (approvals) {
        if (!approvals.length) {
          return '<div class="CoppermindResourceSpaceTab-emptySmall">' + _.escape(__('coppermind_resourcespace.tab.no_approvals_required')) + '</div>';
        }

        return '<div class="CoppermindResourceSpaceTab-list">' + _.map(approvals, function (approval) {
          var status = approval.status || 'not_requested';
          var actions = '';

          if ('not_requested' === status || 'rejected' === status) {
            actions += this.renderWorkflowAction('workflow-request', approval.stage_code, __('coppermind_resourcespace.tab.workflow_request'));
          }
          if ('pending' === status || 'rejected' === status) {
            actions += this.renderWorkflowAction('workflow-approve', approval.stage_code, __('coppermind_resourcespace.tab.workflow_approve'));
          }
          if ('pending' === status || 'approved' === status) {
            actions += this.renderWorkflowAction('workflow-reject', approval.stage_code, __('coppermind_resourcespace.tab.workflow_reject'));
          }

          return '<div class="CoppermindResourceSpaceTab-listItem"><div class="CoppermindResourceSpaceTab-listItemHead">' +
            '<div class="CoppermindResourceSpaceTab-stageName">' + _.escape(approval.stage_code || '') + '</div>' +
            '<span class="CoppermindResourceSpaceTab-badge CoppermindResourceSpaceTab-badge--' + _.escape(status) + '">' +
            _.escape(__('coppermind_resourcespace.tab.approval_status_' + status)) + '</span></div>' +
            '<div class="CoppermindResourceSpaceTab-listItemMeta">' + _.escape(this.approvalTimestamp(approval)) + '</div>' +
            '<div class="CoppermindResourceSpaceTab-actions">' + actions + '</div></div>';
        }.bind(this)).join('') + '</div>';
      },

      approvalTimestamp: function (approval) {
        if (approval.approved_at) {
          return __('coppermind_resourcespace.tab.workflow_approved_at', {date: approval.approved_at});
        }
        if (approval.rejected_at) {
          return __('coppermind_resourcespace.tab.workflow_rejected_at', {date: approval.rejected_at});
        }
        if (approval.requested_at) {
          return __('coppermind_resourcespace.tab.workflow_requested_at', {date: approval.requested_at});
        }

        return __('coppermind_resourcespace.tab.workflow_not_requested');
      },

      renderTargets: function (targets) {
        if (!targets.length) {
          return '<div class="CoppermindResourceSpaceTab-emptySmall">' + _.escape(__('coppermind_resourcespace.tab.none')) + '</div>';
        }

        return '<div class="CoppermindResourceSpaceTab-targetGrid">' + _.map(targets, function (target) {
          return '<div class="CoppermindResourceSpaceTab-targetCard"><div class="CoppermindResourceSpaceTab-targetHead">' +
            '<div class="CoppermindResourceSpaceTab-targetTitle">' + _.escape(target.label || target.target_code || '') + '</div>' +
            '<span class="CoppermindResourceSpaceTab-badge CoppermindResourceSpaceTab-badge--' + _.escape(target.status || 'blocked') + '">' +
            _.escape(__('coppermind_resourcespace.tab.target_status_' + (target.status || 'blocked'))) + '</span></div>' +
            this.renderTargetMeta(__('coppermind_resourcespace.tab.required_attributes_short'), target.required_attributes) +
            this.renderTargetMeta(__('coppermind_resourcespace.tab.required_asset_roles_short'), target.required_asset_roles) +
            this.renderTargetMeta(__('coppermind_resourcespace.tab.required_approvals_short'), target.required_approvals) +
            '<div class="CoppermindResourceSpaceTab-targetMeta">' +
            _.escape(__('coppermind_resourcespace.tab.minimum_assets_short', {count: target.minimum_asset_count || 0})) +
            '</div>' +
            ((target.blockers || []).length ? '<div class="CoppermindResourceSpaceTab-targetIssues">' + _.map(target.blockers, function (blocker) {
              return '<div class="CoppermindResourceSpaceTab-targetIssue">' + _.escape(blocker.message || '') + '</div>';
            }).join('') + '</div>' : '') +
            '</div>';
        }.bind(this)).join('') + '</div>';
      },

      renderTargetMeta: function (label, values) {
        return '<div class="CoppermindResourceSpaceTab-targetMeta">' + _.escape(label) + ': ' +
          _.escape((values || []).length ? values.join(', ') : __('coppermind_resourcespace.tab.none')) + '</div>';
      },

      renderAudit: function (audit) {
        if (!audit.length) {
          return '<div class="CoppermindResourceSpaceTab-emptySmall">' + _.escape(__('coppermind_resourcespace.tab.no_audit_entries')) + '</div>';
        }

        return '<div class="CoppermindResourceSpaceTab-list">' + _.map(audit, function (entry) {
          return '<div class="CoppermindResourceSpaceTab-listItem"><div class="CoppermindResourceSpaceTab-listItemHead">' +
            '<div class="CoppermindResourceSpaceTab-stageName">' + _.escape(entry.action_code || '') + '</div>' +
            '<div class="CoppermindResourceSpaceTab-listItemMeta">' + _.escape(entry.created_at || '') + '</div></div>' +
            '<div class="CoppermindResourceSpaceTab-listItemMeta">' +
            _.escape(entry.actor_identifier || __('coppermind_resourcespace.tab.system_actor')) + '</div></div>';
        }).join('') + '</div>';
      },
      renderAssetList: function (assets, emptyMessage, linkedList, canSync) {
        if (!assets.length) {
          return '<div class="CoppermindResourceSpaceTab-empty">' + _.escape(emptyMessage) + '</div>';
        }

        return '<div class="CoppermindResourceSpaceTab-cardList">' + _.map(assets, function (asset) {
          return this.renderAssetCard(asset, linkedList, canSync);
        }.bind(this)).join('') + '</div>';
      },

      renderAssetCard: function (asset, linkedList, canSync) {
        var resourceRef = asset.resource_ref;
        var isLinked = linkedList || !!asset.is_linked;
        var badges = '';
        var actions = '';

        if (isLinked) {
          badges += this.renderBadge(__('coppermind_resourcespace.tab.linked_badge'), 'linked');
        }
        if (asset.is_primary) {
          badges += this.renderBadge(__('coppermind_resourcespace.tab.primary_badge'), 'primary');
        }
        if (asset.asset_role) {
          badges += this.renderBadge(__('coppermind_resourcespace.tab.asset_role_badge', {role: asset.asset_role}), 'neutral');
        }
        if (asset.synced_attribute) {
          badges += this.renderBadge(__('coppermind_resourcespace.tab.synced_badge', {attribute: asset.synced_attribute}), 'success');
        }
        if ('pending' === asset.writeback_status) {
          badges += this.renderBadge(__('coppermind_resourcespace.tab.writeback_pending_badge'), 'warning');
        }
        if ('failed' === asset.writeback_status) {
          badges += this.renderBadge(__('coppermind_resourcespace.tab.writeback_failed_badge'), 'danger');
        }
        if ('pending' === asset.ingest_status) {
          badges += this.renderBadge(__('coppermind_resourcespace.tab.ingest_pending_badge'), 'warning');
        }
        if ('failed' === asset.ingest_status) {
          badges += this.renderBadge(__('coppermind_resourcespace.tab.ingest_failed_badge'), 'danger');
        }
        if ('succeeded' === asset.ingest_status) {
          badges += this.renderBadge(__('coppermind_resourcespace.tab.ingest_synced_badge'), 'success');
        }

        if (!isLinked) {
          actions += this.renderActionButton('link', resourceRef, __('coppermind_resourcespace.tab.link'), 'AknButton--apply');
        }

        if (isLinked && !asset.is_primary) {
          actions += this.renderActionButton('primary', resourceRef, __('coppermind_resourcespace.tab.make_primary'));
        }

        if (canSync) {
          if (isLinked && !asset.is_primary) {
            actions += this.renderActionButton('primary-sync', resourceRef, __('coppermind_resourcespace.tab.primary_sync'));
          }
          actions += this.renderActionButton('sync', resourceRef, __('coppermind_resourcespace.tab.sync'), '', asset.asset_role || '');
        }

        if ('failed' === asset.writeback_status) {
          actions += this.renderActionButton('retry-writeback', resourceRef, __('coppermind_resourcespace.tab.retry_writeback'));
        }

        if (isLinked) {
          actions += this.renderActionButton('unlink', resourceRef, __('coppermind_resourcespace.tab.unlink'));
        }

        return (
          '<article class="CoppermindResourceSpaceTab-card' + (this.isBusyResource(resourceRef) ? ' CoppermindResourceSpaceTab-card--busy' : '') + '">' +
          '<div class="CoppermindResourceSpaceTab-cardPreview">' + this.renderPreview(asset) + '</div>' +
          '<div class="CoppermindResourceSpaceTab-cardBody">' +
          '<div class="CoppermindResourceSpaceTab-cardHead">' +
          '<div><div class="CoppermindResourceSpaceTab-cardTitle">' + _.escape(asset.title || __('coppermind_resourcespace.tab.untitled')) + '</div>' +
          '<div class="CoppermindResourceSpaceTab-cardMeta">#' + _.escape(String(resourceRef || '')) +
          ((asset.resource_type || asset.file_extension) ? ' • ' + _.escape(asset.resource_type || asset.file_extension) : '') +
          '</div></div>' +
          this.renderExternalLink(asset.ui_url) +
          '</div>' +
          '<div class="CoppermindResourceSpaceTab-badgeRow">' + badges + '</div>' +
          (isLinked ? '<div class="CoppermindResourceSpaceTab-cardSection">' +
            '<div class="CoppermindResourceSpaceTab-inlineLabel">' + _.escape(__('coppermind_resourcespace.tab.asset_role')) + '</div>' +
            this.renderRoleSelect(asset) + '</div>' : '') +
          this.renderAssetGovernance(asset) +
          this.renderWritebackNote(asset) +
          this.renderIngestNote(asset) +
          '<div class="CoppermindResourceSpaceTab-actions">' + actions + '</div>' +
          '</div></article>'
        );
      },

      renderPreview: function (asset) {
        var imageUrl = asset.preview_url || asset.thumbnail_url || '';

        if (imageUrl) {
          return '<img src="' + _.escape(imageUrl) + '" alt="' + _.escape(asset.title || __('coppermind_resourcespace.tab.untitled')) + '">';
        }

        return '<div class="CoppermindResourceSpaceTab-noPreview">' + _.escape(__('coppermind_resourcespace.tab.no_preview')) + '</div>';
      },

      renderExternalLink: function (url) {
        if (!url) {
          return '';
        }

        return '<a class="AknButton AknButton--grey" target="_blank" rel="noopener noreferrer" href="' +
          _.escape(url) + '">' + _.escape(__('coppermind_resourcespace.tab.open')) + '</a>';
      },

      renderRoleSelect: function (asset) {
        var disabled = this.state.busy ? ' disabled="disabled"' : '';
        var options = ['<option value="">' + _.escape(__('coppermind_resourcespace.tab.asset_role_none')) + '</option>'];

        _.each(this.availableAssetRoles(), function (role) {
          var selected = asset.asset_role === role ? ' selected="selected"' : '';
          options.push('<option value="' + _.escape(role) + '"' + selected + '>' + _.escape(role) + '</option>');
        });

        return '<select class="AknSelectBox CoppermindResourceSpaceTab-roleSelect" data-role="asset-role" data-resource-ref="' +
          _.escape(String(asset.resource_ref || '')) + '" data-is-primary="' + (asset.is_primary ? '1' : '0') + '"' + disabled + '>' +
          options.join('') + '</select>';
      },

      renderAssetGovernance: function (asset) {
        var items = [];

        if (asset.rights_status) {
          items.push('<div class="CoppermindResourceSpaceTab-metadataItem"><span class="CoppermindResourceSpaceTab-metadataLabel">' +
            _.escape(__('coppermind_resourcespace.tab.rights_status')) + '</span>' +
            _.escape(asset.rights_status) + '</div>');
        }
        if (asset.license_code) {
          items.push('<div class="CoppermindResourceSpaceTab-metadataItem"><span class="CoppermindResourceSpaceTab-metadataLabel">' +
            _.escape(__('coppermind_resourcespace.tab.license_code')) + '</span>' +
            _.escape(asset.license_code) + '</div>');
        }
        if (asset.license_expires_at) {
          items.push('<div class="CoppermindResourceSpaceTab-metadataItem"><span class="CoppermindResourceSpaceTab-metadataLabel">' +
            _.escape(__('coppermind_resourcespace.tab.license_expires_at')) + '</span>' +
            _.escape(asset.license_expires_at) + '</div>');
        }
        if (asset.rendition_key) {
          items.push('<div class="CoppermindResourceSpaceTab-metadataItem"><span class="CoppermindResourceSpaceTab-metadataLabel">' +
            _.escape(__('coppermind_resourcespace.tab.rendition_key')) + '</span>' +
            _.escape(asset.rendition_key) + '</div>');
        }
        if (asset.derivative_of_resource_ref) {
          items.push('<div class="CoppermindResourceSpaceTab-metadataItem"><span class="CoppermindResourceSpaceTab-metadataLabel">' +
            _.escape(__('coppermind_resourcespace.tab.derivative_of')) + '</span>#' +
            _.escape(String(asset.derivative_of_resource_ref)) + '</div>');
        }

        items.push('<div class="CoppermindResourceSpaceTab-metadataItem"><span class="CoppermindResourceSpaceTab-metadataLabel">' +
          _.escape(__('coppermind_resourcespace.tab.where_used')) + '</span>' +
          _.escape(String(asset.where_used_count || 0)) + '</div>');

        return '<div class="CoppermindResourceSpaceTab-metadata">' + items.join('') + '</div>';
      },
      renderWorkflowAction: function (action, stageCode, label) {
        return '<button type="button" class="AknButton AknButton--small" data-action="' + _.escape(action) +
          '" data-stage-code="' + _.escape(stageCode || '') + '"' +
          (this.state.busy ? ' disabled="disabled"' : '') + '>' + _.escape(label) + '</button>';
      },

      renderActionButton: function (action, resourceRef, label, modifier, assetRole) {
        var classes = ['AknButton', 'AknButton--small'];
        if (modifier) {
          classes.push(modifier);
        }

        return '<button type="button" class="' + classes.join(' ') + '" data-action="' + _.escape(action) +
          '" data-resource-ref="' + _.escape(String(resourceRef || '')) + '"' +
          (assetRole ? ' data-asset-role="' + _.escape(assetRole) + '"' : '') +
          (this.state.busy ? ' disabled="disabled"' : '') + '>' +
          _.escape(label) + '</button>';
      },

      renderBadge: function (label, modifier) {
        return '<span class="CoppermindResourceSpaceTab-badge CoppermindResourceSpaceTab-badge--' +
          _.escape(modifier || 'neutral') + '">' + _.escape(label) + '</span>';
      },

      renderWritebackNote: function (asset) {
        if ('pending' === asset.writeback_status) {
          return '<div class="CoppermindResourceSpaceTab-inlineNote CoppermindResourceSpaceTab-inlineNote--warning">' +
            _.escape(__('coppermind_resourcespace.tab.writeback_pending_note')) + '</div>';
        }

        if ('failed' === asset.writeback_status) {
          return '<div class="CoppermindResourceSpaceTab-inlineNote CoppermindResourceSpaceTab-inlineNote--danger">' +
            _.escape(__('coppermind_resourcespace.tab.writeback_failed_note', {error: asset.writeback_error || __('coppermind_resourcespace.tab.error')})) +
            '</div>';
        }

        return '';
      },

      renderIngestNote: function (asset) {
        if ('pending' === asset.ingest_status) {
          return '<div class="CoppermindResourceSpaceTab-inlineNote CoppermindResourceSpaceTab-inlineNote--warning">' +
            _.escape(__('coppermind_resourcespace.tab.ingest_pending_note', {attribute: asset.ingest_attribute_code || __('coppermind_resourcespace.tab.none')})) +
            '</div>';
        }

        if ('failed' === asset.ingest_status) {
          return '<div class="CoppermindResourceSpaceTab-inlineNote CoppermindResourceSpaceTab-inlineNote--danger">' +
            _.escape(__('coppermind_resourcespace.tab.ingest_failed_note', {error: asset.ingest_error || __('coppermind_resourcespace.tab.error')})) +
            '</div>';
        }

        if ('succeeded' === asset.ingest_status) {
          return '<div class="CoppermindResourceSpaceTab-inlineNote CoppermindResourceSpaceTab-inlineNote--success">' +
            _.escape(__('coppermind_resourcespace.tab.ingest_succeeded_note', {attribute: asset.ingest_attribute_code || asset.synced_attribute || ''})) +
            '</div>';
        }

        return '';
      },

      isBusyResource: function (resourceRef) {
        return this.state.busy && null !== this.state.busyRef && Number(this.state.busyRef) === Number(resourceRef);
      },

      extractError: function (xhr) {
        if (!xhr) {
          return __('coppermind_resourcespace.tab.error');
        }

        if (xhr.responseJSON && xhr.responseJSON.message) {
          return xhr.responseJSON.message;
        }

        if (xhr.responseText) {
          try {
            var payload = JSON.parse(xhr.responseText);
            if (payload && payload.message) {
              return payload.message;
            }
          } catch (error) {
          }
        }

        return xhr.statusText || __('coppermind_resourcespace.tab.error');
      },

      formatPercent: function (value) {
        var numeric = Number(value);
        if (!_.isFinite(numeric)) {
          return '0%';
        }

        return numeric.toFixed(0) + '%';
      },
      injectStyles: function () {
        if (document.getElementById(STYLE_ID)) {
          return;
        }

        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
          '.CoppermindResourceSpaceTab{padding:20px 0 32px;color:var(--brand-ink,#1a1a1a);}',
          '.CoppermindResourceSpaceTab-loading,.CoppermindResourceSpaceTab-empty{padding:28px;border:1px dashed rgba(0,0,0,.12);border-radius:14px;background:#fff;color:#4e5b49;box-shadow:0 1px 3px rgba(0,0,0,.1),0 1px 2px rgba(0,0,0,.06);}',
          '.CoppermindResourceSpaceTab-emptySmall{color:#667063;font-size:13px;}',
          '.CoppermindResourceSpaceTab-header{display:grid;gap:12px;margin-bottom:16px;}',
          '.CoppermindResourceSpaceTab-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}',
          '.CoppermindResourceSpaceTab-search{min-width:280px;flex:1 1 320px;}',
          '.CoppermindResourceSpaceTab-note{padding:12px 14px;border-radius:10px;border:1px solid rgba(124,179,66,.18);background:rgba(241,248,233,.72);color:var(--brand-green-dark,#558b2f);font-size:13px;}',
          '.CoppermindResourceSpaceTab-note--warning{border-color:rgba(255,140,66,.24);background:rgba(255,243,232,.9);color:#96531d;}',
          '.CoppermindResourceSpaceTab-overviewGrid{margin-bottom:18px;}',
          '.CoppermindResourceSpaceTab-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:18px;align-items:start;}',
          '.CoppermindResourceSpaceTab-panel{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:14px;box-shadow:0 4px 6px rgba(0,0,0,.1),0 2px 4px rgba(0,0,0,.06);overflow:hidden;}',
          '.CoppermindResourceSpaceTab-panel--wide{overflow:visible;}',
          '.CoppermindResourceSpaceTab-panelHeader{padding:16px 18px;border-bottom:1px solid rgba(0,0,0,.06);font-size:15px;font-weight:700;color:var(--brand-green-dark,#558b2f);background:linear-gradient(180deg,rgba(239,246,255,.72) 0%,#fff 100%);}',
          '.CoppermindResourceSpaceTab-overviewBody{padding:18px;display:grid;gap:16px;}',
          '.CoppermindResourceSpaceTab-statGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;}',
          '.CoppermindResourceSpaceTab-statCard{padding:14px;border-radius:10px;background:#fff;border:1px solid rgba(0,0,0,.08);box-shadow:0 1px 3px rgba(0,0,0,.1),0 1px 2px rgba(0,0,0,.06);}',
          '.CoppermindResourceSpaceTab-statLabel{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6f7b63;}',
          '.CoppermindResourceSpaceTab-statValue{margin-top:6px;font-size:22px;font-weight:700;color:var(--brand-green-dark,#558b2f);}',
          '.CoppermindResourceSpaceTab-section{display:grid;gap:10px;}',
          '.CoppermindResourceSpaceTab-sectionTitle{font-size:13px;font-weight:700;color:var(--brand-blue-dark,#148cb8);text-transform:uppercase;letter-spacing:.04em;}',
          '.CoppermindResourceSpaceTab-list,.CoppermindResourceSpaceTab-cardList{display:grid;gap:10px;}',
          '.CoppermindResourceSpaceTab-listItem{padding:12px 14px;border:1px solid rgba(0,0,0,.07);border-radius:10px;background:#fff;}',
          '.CoppermindResourceSpaceTab-listItem--warning{background:#fff7ef;border-color:rgba(255,140,66,.24);}',
          '.CoppermindResourceSpaceTab-listItemHead{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;}',
          '.CoppermindResourceSpaceTab-listBadge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:rgba(28,167,216,.12);color:var(--brand-blue-dark,#148cb8);font-size:11px;font-weight:700;margin-right:8px;}',
          '.CoppermindResourceSpaceTab-listItemMeta,.CoppermindResourceSpaceTab-cardMeta{font-size:12px;color:#667063;}',
          '.CoppermindResourceSpaceTab-stageName{font-size:14px;font-weight:700;color:var(--brand-green-dark,#558b2f);}',
          '.CoppermindResourceSpaceTab-targetGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;}',
          '.CoppermindResourceSpaceTab-targetCard{padding:14px;border:1px solid rgba(0,0,0,.07);border-radius:12px;background:#fff;display:grid;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,.1),0 1px 2px rgba(0,0,0,.06);}',
          '.CoppermindResourceSpaceTab-targetHead{display:flex;justify-content:space-between;gap:10px;align-items:center;}',
          '.CoppermindResourceSpaceTab-targetTitle{font-weight:700;color:var(--brand-green-dark,#558b2f);}',
          '.CoppermindResourceSpaceTab-targetMeta{font-size:12px;color:#60705e;line-height:1.45;}',
          '.CoppermindResourceSpaceTab-targetIssues{display:grid;gap:6px;margin-top:4px;}',
          '.CoppermindResourceSpaceTab-targetIssue{font-size:12px;color:#914c00;background:#fff7ef;border-radius:10px;padding:8px 10px;border:1px solid rgba(255,140,66,.18);}',
          '.CoppermindResourceSpaceTab-card{display:grid;grid-template-columns:120px minmax(0,1fr);gap:14px;padding:18px;border-bottom:1px solid rgba(0,0,0,.05);background:rgba(255,255,255,.82);}',
          '.CoppermindResourceSpaceTab-card:last-child{border-bottom:none;}',
          '.CoppermindResourceSpaceTab-card--busy{opacity:.7;}',
          '.CoppermindResourceSpaceTab-cardPreview{width:120px;height:120px;border-radius:14px;overflow:hidden;background:linear-gradient(135deg,rgba(239,246,255,.92) 0%,rgba(241,248,233,.92) 100%);display:flex;align-items:center;justify-content:center;border:1px solid rgba(0,0,0,.08);box-shadow:inset 0 1px 0 rgba(255,255,255,.85);}',
          '.CoppermindResourceSpaceTab-cardPreview img{width:100%;height:100%;object-fit:cover;display:block;}',
          '.CoppermindResourceSpaceTab-noPreview{padding:12px;text-align:center;font-size:12px;color:#667063;}',
          '.CoppermindResourceSpaceTab-cardBody{display:grid;gap:10px;min-width:0;}',
          '.CoppermindResourceSpaceTab-cardHead{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;}',
          '.CoppermindResourceSpaceTab-cardTitle{font-size:16px;font-weight:700;color:var(--brand-green-dark,#558b2f);word-break:break-word;}',
          '.CoppermindResourceSpaceTab-badgeRow,.CoppermindResourceSpaceTab-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}',
          '.CoppermindResourceSpaceTab-badge{display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;}',
          '.CoppermindResourceSpaceTab-badge--linked,.CoppermindResourceSpaceTab-badge--success,.CoppermindResourceSpaceTab-badge--ready,.CoppermindResourceSpaceTab-badge--approved,.CoppermindResourceSpaceTab-badge--succeeded{background:rgba(124,179,66,.16);color:var(--brand-green-dark,#558b2f);}',
          '.CoppermindResourceSpaceTab-badge--primary,.CoppermindResourceSpaceTab-badge--neutral{background:rgba(28,167,216,.12);color:var(--brand-blue-dark,#148cb8);}',
          '.CoppermindResourceSpaceTab-badge--warning,.CoppermindResourceSpaceTab-badge--pending{background:rgba(255,140,66,.16);color:#8a5200;}',
          '.CoppermindResourceSpaceTab-badge--danger,.CoppermindResourceSpaceTab-badge--failed,.CoppermindResourceSpaceTab-badge--rejected,.CoppermindResourceSpaceTab-badge--blocked{background:rgba(211,47,47,.12);color:#a12e2b;}',
          '.CoppermindResourceSpaceTab-badge--not_requested{background:#edf0f4;color:#5e6e81;}',
          '.CoppermindResourceSpaceTab-cardSection{display:grid;gap:6px;}',
          '.CoppermindResourceSpaceTab-inlineLabel{font-size:12px;font-weight:700;color:#60705e;text-transform:uppercase;letter-spacing:.04em;}',
          '.CoppermindResourceSpaceTab-roleSelect{max-width:260px;}',
          '.CoppermindResourceSpaceTab-metadata{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px 12px;}',
          '.CoppermindResourceSpaceTab-metadataItem{font-size:12px;color:#2f3f2f;line-height:1.45;}',
          '.CoppermindResourceSpaceTab-metadataLabel{display:block;color:#6b7b63;font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:11px;margin-bottom:2px;}',
          '.CoppermindResourceSpaceTab-inlineNote{padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.45;}',
          '.CoppermindResourceSpaceTab-inlineNote--warning{background:#fff7ef;color:#8d5300;border:1px solid rgba(255,140,66,.18);}',
          '.CoppermindResourceSpaceTab-inlineNote--danger{background:#fff3f3;color:#9e2a2a;border:1px solid rgba(211,47,47,.12);}',
          '.CoppermindResourceSpaceTab-inlineNote--success{background:#f8fdf4;color:var(--brand-green-dark,#558b2f);border:1px solid rgba(124,179,66,.16);}',
          '@media (max-width: 900px){.CoppermindResourceSpaceTab-card{grid-template-columns:1fr;}.CoppermindResourceSpaceTab-cardPreview{width:100%;height:220px;}.CoppermindResourceSpaceTab-cardHead{flex-direction:column;align-items:flex-start;}.CoppermindResourceSpaceTab-toolbar{align-items:stretch;}.CoppermindResourceSpaceTab-search{min-width:0;width:100%;}}'
        ].join('');

        document.head.appendChild(style);
      },
    });

    return DamTab;
  }
);
