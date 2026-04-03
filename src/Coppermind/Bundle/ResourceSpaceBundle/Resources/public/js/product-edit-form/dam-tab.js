'use strict';

define(
  ['jquery', 'underscore', 'oro/translator', 'oro/messenger', 'pim/user-context', 'routing', 'pimui/js/view/base'],
  function ($, _, __, messenger, UserContext, Routing, BaseView) {
    var STYLE_ID = 'coppermind-resourcespace-dam-tab-style';

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
        this.mutateLink($(event.currentTarget).data('resourceRef'), false, false);
      },

      onPrimary: function (event) {
        this.mutateLink($(event.currentTarget).data('resourceRef'), true, false);
      },

      onPrimarySync: function (event) {
        this.mutateLink($(event.currentTarget).data('resourceRef'), true, true);
      },

      onSync: function (event) {
        var resourceRef = $(event.currentTarget).data('resourceRef');

        this.runRequest({
          url: Routing.generate(this.config.syncRoute, _.extend(this.getRouteParameters(), {resourceRef: resourceRef})),
          method: 'POST',
          payload: this.buildSyncPayload(),
          successMessage: __('coppermind_resourcespace.tab.sync_success'),
        });
      },

      onUnlink: function (event) {
        var resourceRef = $(event.currentTarget).data('resourceRef');

        this.runRequest({
          url: Routing.generate(this.config.unlinkRoute, _.extend(this.getRouteParameters(), {resourceRef: resourceRef})),
          method: 'DELETE',
          successMessage: __('coppermind_resourcespace.tab.unlink_success'),
        });
      },

      onRetryWriteback: function (event) {
        var resourceRef = $(event.currentTarget).data('resourceRef');

        this.runRequest({
          url: Routing.generate(this.config.retryWritebackRoute, {resourceRef: resourceRef}),
          method: 'POST',
          successMessage: __('coppermind_resourcespace.tab.writeback_retry_success'),
          resourceRef: resourceRef,
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

      mutateLink: function (resourceRef, setPrimary, syncToAkeneo) {
        this.runRequest({
          url: Routing.generate(this.config.linkRoute, this.getRouteParameters()),
          method: 'POST',
          payload: _.extend(
            {
              resourceRef: resourceRef,
              setPrimary: setPrimary,
              syncToAkeneo: syncToAkeneo,
            },
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

      renderLayout: function () {
        if (this.state.loading) {
          return '<div class="CoppermindResourceSpaceTab-loading">' + _.escape(__('coppermind_resourcespace.tab.loading')) + '</div>';
        }

        if (this.state.error) {
          return (
            '<div class="AknMessageBox AknMessageBox--error">' +
            '<div class="AknMessageBox-text">' +
            _.escape(this.state.error) +
            '</div></div>'
          );
        }

        var data = this.state.data || {};
        var configuration = data.configuration || {};
        var links = data.links || [];
        var results = data.results || [];
        var defaultAttributeCode = configuration.default_attribute_code;

        return (
          '<div class="CoppermindResourceSpaceTab-header">' +
          this.renderToolbar(data.query || '', configuration) +
          '</div>' +
          '<div class="CoppermindResourceSpaceTab-grid">' +
          '<section class="CoppermindResourceSpaceTab-panel">' +
          '<div class="CoppermindResourceSpaceTab-panelHeader">' +
          _.escape(__('coppermind_resourcespace.tab.linked_assets')) +
          '</div>' +
          this.renderAssetList(
            links,
            __('coppermind_resourcespace.tab.no_links'),
            true,
            !!defaultAttributeCode
          ) +
          '</section>' +
          '<section class="CoppermindResourceSpaceTab-panel">' +
          '<div class="CoppermindResourceSpaceTab-panelHeader">' +
          _.escape(__('coppermind_resourcespace.tab.matching_assets')) +
          '</div>' +
          this.renderAssetList(
            results,
            configuration.configured
              ? __('coppermind_resourcespace.tab.no_results')
              : __('coppermind_resourcespace.tab.setup_required'),
            false,
            !!defaultAttributeCode
          ) +
          '</section>' +
          '</div>'
        );
      },

      renderToolbar: function (query, configuration) {
        var message = '';

        if (!configuration.configured) {
          message =
            '<div class="CoppermindResourceSpaceTab-note CoppermindResourceSpaceTab-note--warning">' +
            _.escape(__('coppermind_resourcespace.tab.setup_required')) +
            '</div>';
        } else if (configuration.default_attribute_code) {
          message =
            '<div class="CoppermindResourceSpaceTab-note">' +
            _.escape(__('coppermind_resourcespace.tab.default_sync', {attribute: configuration.default_attribute_code})) +
            '</div>';
        } else {
          message =
            '<div class="CoppermindResourceSpaceTab-note">' +
            _.escape(__('coppermind_resourcespace.tab.default_sync_missing')) +
            '</div>';
        }

        return (
          '<form class="CoppermindResourceSpaceTab-toolbar" data-role="resourcespace-search-form">' +
          '<input class="AknTextField CoppermindResourceSpaceTab-search" ' +
          'type="text" data-role="resourcespace-query" placeholder="' +
          _.escape(__('coppermind_resourcespace.tab.search_placeholder')) +
          '" value="' +
          _.escape(query || '') +
          '">' +
          '<button type="submit" class="AknButton AknButton--apply">' +
          _.escape(__('coppermind_resourcespace.tab.search')) +
          '</button>' +
          '<button type="button" class="AknButton" data-action="refresh">' +
          _.escape(__('coppermind_resourcespace.tab.refresh')) +
          '</button>' +
          '</form>' +
          message
        );
      },

      renderAssetList: function (assets, emptyMessage, linkedList, canSync) {
        if (!assets.length) {
          return '<div class="CoppermindResourceSpaceTab-empty">' + _.escape(emptyMessage) + '</div>';
        }

        return (
          '<div class="CoppermindResourceSpaceTab-cardList">' +
          _.map(
            assets,
            function (asset) {
              return this.renderAssetCard(asset, linkedList, canSync);
            }.bind(this)
          ).join('') +
          '</div>'
        );
      },

      renderAssetCard: function (asset, linkedList, canSync) {
        var title = asset.title || __('coppermind_resourcespace.tab.untitled');
        var extension = asset.file_extension ? '.' + asset.file_extension : '';
        var badges = '';
        var actions = '';
        var isBusy = this.state.busy && parseInt(asset.resource_ref, 10) === parseInt(this.state.busyRef, 10);
        var disabled = isBusy ? ' disabled="disabled"' : '';

        if (asset.is_linked) {
          badges += this.renderBadge(__('coppermind_resourcespace.tab.linked_badge'));
        }

        if (asset.is_primary) {
          badges += this.renderBadge(__('coppermind_resourcespace.tab.primary_badge'));
        }

        if (asset.synced_attribute) {
          badges += this.renderBadge(__('coppermind_resourcespace.tab.synced_badge', {attribute: asset.synced_attribute}));
        }

        if ('pending' === asset.writeback_status) {
          badges += this.renderBadge(__('coppermind_resourcespace.tab.writeback_pending_badge'));
        }

        if ('failed' === asset.writeback_status) {
          badges += this.renderBadge(__('coppermind_resourcespace.tab.writeback_failed_badge'));
        }

        if ('failed' === asset.writeback_status || 'pending' === asset.writeback_status) {
          actions += this.renderActionButton(
            'retry-writeback',
            asset.resource_ref,
            __('coppermind_resourcespace.tab.retry_writeback'),
            disabled
          );
        }

        if (linkedList) {
          if (!asset.is_primary) {
            actions += this.renderActionButton('primary', asset.resource_ref, __('coppermind_resourcespace.tab.make_primary'), disabled);
          }
          if (canSync) {
            actions += this.renderActionButton('sync', asset.resource_ref, __('coppermind_resourcespace.tab.sync'), disabled);
          }
          actions += this.renderActionButton('unlink', asset.resource_ref, __('coppermind_resourcespace.tab.unlink'), disabled);
        } else {
          if (!asset.is_linked) {
            actions += this.renderActionButton('link', asset.resource_ref, __('coppermind_resourcespace.tab.link'), disabled);
          }

          if (canSync) {
            actions += this.renderActionButton(
              'primary-sync',
              asset.resource_ref,
              __('coppermind_resourcespace.tab.primary_sync'),
              disabled
            );
          } else if (!asset.is_primary) {
            actions += this.renderActionButton('primary', asset.resource_ref, __('coppermind_resourcespace.tab.make_primary'), disabled);
          }
        }

        return (
          '<article class="CoppermindResourceSpaceTab-card">' +
          '<div class="CoppermindResourceSpaceTab-thumbWrap">' +
          this.renderPreview(asset) +
          '</div>' +
          '<div class="CoppermindResourceSpaceTab-body">' +
          '<div class="CoppermindResourceSpaceTab-titleRow">' +
          '<div class="CoppermindResourceSpaceTab-title">' +
          _.escape(title) +
          '</div>' +
          '<div class="CoppermindResourceSpaceTab-meta">#' +
          _.escape(String(asset.resource_ref)) +
          (extension ? ' ' + _.escape(extension) : '') +
          '</div>' +
          '</div>' +
          '<div class="CoppermindResourceSpaceTab-badges">' +
          badges +
          '</div>' +
          this.renderWritebackNote(asset) +
          '<div class="CoppermindResourceSpaceTab-actions">' +
          actions +
          this.renderExternalLink(asset.ui_url) +
          '</div>' +
          '</div>' +
          '</article>'
        );
      },

      renderPreview: function (asset) {
        if (!asset.preview_url && !asset.thumbnail_url) {
          return '<div class="CoppermindResourceSpaceTab-noPreview">' + _.escape(__('coppermind_resourcespace.tab.no_preview')) + '</div>';
        }

        return (
          '<img class="CoppermindResourceSpaceTab-thumb" alt="' +
          _.escape(asset.title || '') +
          '" src="' +
          _.escape(asset.preview_url || asset.thumbnail_url) +
          '">'
        );
      },

      renderExternalLink: function (uiUrl) {
        if (!uiUrl) {
          return '';
        }

        return (
          '<a class="AknButton AknButton--grey CoppermindResourceSpaceTab-openLink" target="_blank" rel="noopener noreferrer" href="' +
          _.escape(uiUrl) +
          '">' +
          _.escape(__('coppermind_resourcespace.tab.open')) +
          '</a>'
        );
      },

      renderActionButton: function (action, resourceRef, label, disabled) {
        return (
          '<button type="button" class="AknButton AknButton--grey CoppermindResourceSpaceTab-action" data-action="' +
          _.escape(action) +
          '" data-resource-ref="' +
          _.escape(String(resourceRef)) +
          '"' +
          disabled +
          '>' +
          _.escape(label) +
          '</button>'
        );
      },

      renderBadge: function (label) {
        return '<span class="CoppermindResourceSpaceTab-badge">' + _.escape(label) + '</span>';
      },

      renderWritebackNote: function (asset) {
        if ('failed' === asset.writeback_status) {
          return (
            '<div class="CoppermindResourceSpaceTab-statusNote CoppermindResourceSpaceTab-statusNote--warning">' +
            _.escape(__('coppermind_resourcespace.tab.writeback_failed_note', {error: asset.writeback_error || __('coppermind_resourcespace.tab.error')})) +
            '</div>'
          );
        }

        if ('pending' === asset.writeback_status) {
          return (
            '<div class="CoppermindResourceSpaceTab-statusNote">' +
            _.escape(__('coppermind_resourcespace.tab.writeback_pending_note')) +
            '</div>'
          );
        }

        return '';
      },

      extractError: function (xhr) {
        if (xhr && xhr.responseJSON && xhr.responseJSON.message) {
          return xhr.responseJSON.message;
        }

        if (xhr && xhr.responseJSON && xhr.responseJSON.error) {
          return xhr.responseJSON.error;
        }

        if (xhr && xhr.statusText) {
          return xhr.statusText;
        }

        return __('coppermind_resourcespace.tab.error');
      },

      injectStyles: function () {
        if (document.getElementById(STYLE_ID)) {
          return;
        }

        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
          '.CoppermindResourceSpaceTab-loading,.CoppermindResourceSpaceTab-empty{padding:24px;color:#5f6c7b;}' +
          '.CoppermindResourceSpaceTab-toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px;}' +
          '.CoppermindResourceSpaceTab-search{min-width:280px;flex:1 1 320px;}' +
          '.CoppermindResourceSpaceTab-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px;}' +
          '.CoppermindResourceSpaceTab-panel{background:#fff;border:1px solid #dfe6ee;border-radius:10px;overflow:hidden;}' +
          '.CoppermindResourceSpaceTab-panelHeader{padding:14px 16px;border-bottom:1px solid #e8edf3;font-weight:600;color:#1d2733;}' +
          '.CoppermindResourceSpaceTab-cardList{display:grid;gap:12px;padding:14px;}' +
          '.CoppermindResourceSpaceTab-card{display:grid;grid-template-columns:110px 1fr;gap:12px;padding:12px;border:1px solid #e3e9ef;border-radius:8px;background:#fbfcfd;}' +
          '.CoppermindResourceSpaceTab-thumbWrap{display:flex;align-items:center;justify-content:center;background:#eef3f7;border-radius:6px;min-height:92px;overflow:hidden;}' +
          '.CoppermindResourceSpaceTab-thumb{display:block;width:100%;height:100%;object-fit:cover;}' +
          '.CoppermindResourceSpaceTab-noPreview{padding:12px;font-size:12px;color:#6c7a89;text-align:center;}' +
          '.CoppermindResourceSpaceTab-titleRow{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;}' +
          '.CoppermindResourceSpaceTab-title{font-weight:600;color:#1d2733;line-height:1.4;}' +
          '.CoppermindResourceSpaceTab-meta{font-size:12px;color:#6d7b88;white-space:nowrap;}' +
          '.CoppermindResourceSpaceTab-badges{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;}' +
          '.CoppermindResourceSpaceTab-badge{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;background:#e8f1f8;color:#35608a;font-size:11px;font-weight:600;}' +
          '.CoppermindResourceSpaceTab-statusNote{margin:0 0 8px;color:#5f6c7b;font-size:12px;line-height:1.4;}' +
          '.CoppermindResourceSpaceTab-statusNote--warning{color:#8a4b08;}' +
          '.CoppermindResourceSpaceTab-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}' +
          '.CoppermindResourceSpaceTab-note{margin-bottom:12px;color:#5f6c7b;}' +
          '.CoppermindResourceSpaceTab-note--warning{color:#8a4b08;}';

        document.head.appendChild(style);
      },
    });

    return DamTab;
  }
);
