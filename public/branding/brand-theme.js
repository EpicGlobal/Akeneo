(function () {
  var scheduled = false;
  var brandLogoUrl = "/branding/brand-logo.png?v=20260313c";
  var colors = {
    green: "#7cb342",
    greenDark: "#558b2f",
    orange: "#ff8c42",
    blue: "#1ca7d8",
    surface: "linear-gradient(180deg, rgba(239, 246, 255, 0.92) 0%, #ffffff 100%)",
    accentSurface: "linear-gradient(90deg, rgba(241, 248, 233, 0.98), rgba(241, 248, 233, 0.6) 100%)"
  };
  var guideSeenKey = "operator.brandGuide.seen.v1";
  var simpleModeKey = "operator.simpleMode.v1";
  var setupWizardStepKey = "operator.setupWizard.step.v1";
  var guideState = {
    routeSignature: "",
    contextId: "",
    elements: null,
    walkthrough: null,
    autoOpened: false,
    openMode: null
  };
  var workspaceState = {
    dashboardData: null,
    dashboardPromise: null,
    dashboardLoadedAt: 0,
    dashboardError: null
  };
  var setupWizardSteps = [
    {
      title: "Groups first",
      body: "Start with categories so every product has a clear home.",
      actionLabel: "Open categories",
      action: function () {
        return clickTextTarget(/^categories$/i);
      }
    },
    {
      title: "Fact fields second",
      body: "Create attributes so editors know which facts and copy fields they must fill in.",
      actionLabel: "Open attributes",
      action: function () {
        return clickTextTarget(/^attributes$/i);
      }
    },
    {
      title: "Product types third",
      body: "Use families to decide what each kind of product must contain.",
      actionLabel: "Open families",
      action: function () {
        return clickTextTarget(/^families$/i);
      }
    },
    {
      title: "Products next",
      body: "Open the product work queue and improve one record at a time.",
      actionLabel: "Open products",
      action: function () {
        goToHash("#/enrich/product/");
        return true;
      }
    },
    {
      title: "Pictures and files",
      body: "Use the DAM tab after the main facts are in place so media supports the product instead of leading it.",
      actionLabel: "Open the first product",
      action: function () {
        goToHash("#/enrich/product/");
        window.setTimeout(openFirstVisibleProduct, 300);
        return true;
      }
    },
    {
      title: "Publishing health last",
      body: "Finish by checking data flows and downstream publishing health.",
      actionLabel: "Open connect health",
      action: function () {
        goToHash("#/connect/data-flows");
        return true;
      }
    }
  ];

  var setImportant = function (element, property, value) {
    if (element instanceof HTMLElement) {
      element.style.setProperty(property, value, "important");
    }
  };

  var clamp = function (value, min, max) {
    return Math.min(Math.max(value, min), max);
  };

  var createElement = function (tagName, className, textContent) {
    var element = document.createElement(tagName);

    if (className) {
      element.className = className;
    }

    if (typeof textContent === "string") {
      element.textContent = textContent;
    }

    return element;
  };

  var safeStorageGet = function (key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  };

  var safeStorageSet = function (key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      return null;
    }

    return value;
  };

  var isSimpleModeEnabled = function () {
    return "0" !== safeStorageGet(simpleModeKey);
  };

  var setSimpleModeEnabled = function (enabled) {
    safeStorageSet(simpleModeKey, enabled ? "1" : "0");
    setBodyClass("OperatorSimpleMode", enabled);
  };

  var getSetupWizardStepIndex = function () {
    var value = Number(safeStorageGet(setupWizardStepKey) || 0);

    if (!Number.isFinite(value) || value < 0) {
      return 0;
    }

    return Math.min(value, Math.max(0, setupWizardSteps.length - 1));
  };

  var setSetupWizardStepIndex = function (value) {
    var nextIndex = Math.min(Math.max(Number(value) || 0, 0), Math.max(0, setupWizardSteps.length - 1));
    safeStorageSet(setupWizardStepKey, String(nextIndex));
    return nextIndex;
  };

  var getRouteSignature = function () {
    return [
      window.location.pathname || "",
      window.location.hash || "",
      window.location.search || ""
    ].join("|").toLowerCase();
  };

  var getRouteText = function () {
    return [
      window.location.pathname || "",
      window.location.hash || "",
      window.location.search || "",
      document.title || ""
    ].join(" ").toLowerCase();
  };

  var getHashRoute = function () {
    return (window.location.hash || "").toLowerCase();
  };

  var isCompactViewport = function () {
    if (typeof window.matchMedia === "function") {
      return window.matchMedia("(max-width: 900px)").matches;
    }

    return window.innerWidth <= 900;
  };

  var getPageTitleText = function () {
    var title = document.querySelector(
      ".AknTitleContainer-title, .BrandShell-pageHeaderTitle, h1, [data-testid='page-title']"
    );

    if (!(title instanceof HTMLElement)) {
      return "";
    }

    return (title.textContent || "").trim().toLowerCase();
  };

  var isLoginPage = function () {
    return !!document.querySelector(".AuthenticationWrapper, .login-bg, form[name='login']");
  };

  var isAuthenticatedShell = function () {
    return !!document.querySelector(".AknHeader-menu, .BrandShell");
  };

  var findFirst = function (selectors) {
    if (!Array.isArray(selectors)) {
      return null;
    }

    for (var index = 0; index < selectors.length; index += 1) {
      var element = document.querySelector(selectors[index]);

      if (element instanceof HTMLElement) {
        return element;
      }
    }

    return null;
  };

  var findByText = function (selector, matcher) {
    var nodes = document.querySelectorAll(selector);

    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];

      if (!(node instanceof HTMLElement)) {
        continue;
      }

      var text = (node.textContent || "").replace(/\s+/g, " ").trim();

      if (text && matcher.test(text)) {
        return node.closest("[role='tab'], li, a, button, .AknHorizontalNavtab") || node;
      }
    }

    return null;
  };

  var goToHash = function (hash) {
    if ("string" !== typeof hash || !hash) {
      return;
    }

    if (window.location.hash === hash) {
      scheduleApply();
      return;
    }

    window.location.hash = hash;
  };

  var clickElement = function (element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    try {
      element.click();
      return true;
    } catch (error) {
      return false;
    }
  };

  var clickTextTarget = function (matcher, selector) {
    var target = findByText(selector || "a, button, [role='button'], div, span", matcher);
    return clickElement(target);
  };

  var findResourceSpaceTab = function () {
    return findByText(
      ".AknHorizontalNavtab a, .AknHorizontalNavtab-link, [role='tab'], a, button, span",
      /resourcespace dam/i
    );
  };

  var findTextElement = function (root, selector, matcher) {
    if (!(root instanceof HTMLElement) || !(matcher instanceof RegExp)) {
      return null;
    }

    var nodes = root.querySelectorAll(selector);

    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];

      if (!(node instanceof HTMLElement)) {
        continue;
      }

      var text = (node.textContent || "").replace(/\s+/g, " ").trim();

      if (text && matcher.test(text)) {
        return node;
      }
    }

    return null;
  };

  var replaceMatchedText = function (root, selector, matcher, replacement) {
    var element = findTextElement(root, selector, matcher);

    if (!(element instanceof HTMLElement)) {
      return null;
    }

    element.textContent = replacement;

    return element;
  };

  var brandMenuLogo = function () {
    document.querySelectorAll(".AknHeader-logoImage").forEach(function (image) {
      if (!(image instanceof HTMLImageElement)) {
        return;
      }

      if (!image.src.includes("/branding/brand-logo.png")) {
        image.src = brandLogoUrl;
      }

      image.removeAttribute("srcset");
      image.alt = "Operator logo";
      image.classList.add("BrandShell-sidebarLogoImage");

      setImportant(image, "width", "56px");
      setImportant(image, "max-width", "56px");
      setImportant(image, "height", "auto");
      setImportant(image, "display", "block");
      setImportant(image, "margin", "0 auto");

      var logoItem = image.closest(".AknHeader-menuItem");

      if (logoItem instanceof HTMLElement) {
        logoItem.classList.add("BrandShell-sidebarLogo");
      }
    });
  };

  var applyThemeRoot = function () {
    if (!(document.body instanceof HTMLElement)) {
      return;
    }

    document.body.classList.add("theme-ecosystem");
    document.body.setAttribute("data-theme", "ecosystem");
  };

  var setBodyClass = function (className, enabled) {
    if (!(document.body instanceof HTMLElement) || !className) {
      return;
    }

    document.body.classList.toggle(className, !!enabled);
  };

  var brandMainMenu = function () {
    document.querySelectorAll(".AknHeader-menuItem").forEach(function (item) {
      if (!(item instanceof HTMLElement) || !item.classList.contains("AknHeader-menuItem--active")) {
        return;
      }

      setImportant(item, "color", colors.greenDark);
      setImportant(item, "border-left-color", colors.orange);
      setImportant(item, "border-left-width", "4px");
      setImportant(item, "padding-right", "4px");
      setImportant(item, "background", colors.accentSurface);
    });
  };

  var brandVerticalLists = function () {
    document.querySelectorAll(".AknVerticalList-item.active, .AknVerticalList-item--active").forEach(function (item) {
      if (!(item instanceof HTMLElement)) {
        return;
      }

      setImportant(item, "background", colors.accentSurface);
      setImportant(item, "box-shadow", "inset 3px 0 0 " + colors.green);

      item.querySelectorAll("a, span").forEach(function (node) {
        if (node instanceof HTMLElement) {
          setImportant(node, "color", colors.greenDark);
        }
      });
    });
  };

  var brandHeaders = function () {
    document.querySelectorAll("header, .AknTitleContainer").forEach(function (header) {
      if (!(header instanceof HTMLElement)) {
        return;
      }

      var legacyTitle = header.querySelector(".AknTitleContainer-title");

      if (legacyTitle instanceof HTMLElement) {
        setImportant(header, "background", colors.surface);
        setImportant(legacyTitle, "color", colors.greenDark);
      }

      var breadcrumb = header.querySelector("nav[aria-label='Breadcrumb'], .AknTitleContainer-breadcrumbs");

      if (!(breadcrumb instanceof HTMLElement)) {
        return;
      }

      header.classList.add("BrandShell-pageHeader");
      breadcrumb.classList.add("BrandShell-pageHeaderBreadcrumb");

      setImportant(header, "background", colors.surface);
      setImportant(header, "box-shadow", "0 1px 0 rgba(20, 151, 207, 0.08), 0 12px 28px rgba(15, 31, 23, 0.03)");

      breadcrumb.querySelectorAll("a, span").forEach(function (node) {
        if (!(node instanceof HTMLElement)) {
          return;
        }

        setImportant(node, "color", node.getAttribute("aria-current") === "page" ? "#8ea3aa" : colors.blue);
      });

      var title = legacyTitle;

      if (!(title instanceof HTMLElement)) {
        var titleLine = breadcrumb.parentElement && breadcrumb.parentElement.parentElement
          ? breadcrumb.parentElement.parentElement.children.item(1)
          : null;
        title = titleLine && titleLine.firstElementChild;
      }

      if (title instanceof HTMLElement) {
        title.classList.add("BrandShell-pageHeaderTitle");
        if ("H1" !== title.tagName) {
          title.setAttribute("role", "heading");
          title.setAttribute("aria-level", "1");
        }
        setImportant(title, "color", colors.greenDark);
      }
    });
  };

  var ensureMainLandmark = function () {
    var main = findFirst([
      ".AknColumn-main",
      ".AknDefault-mainContent",
      ".AknDefault-container .view",
      "main"
    ]);

    if (!(main instanceof HTMLElement)) {
      return;
    }

    if ("MAIN" !== main.tagName) {
      main.setAttribute("role", "main");
    }

    if (!main.getAttribute("aria-label")) {
      if (isProductEditorSurface()) {
        main.setAttribute("aria-label", "Product editor");
      } else if (isProductListSurface()) {
        main.setAttribute("aria-label", "Product work queue");
      } else if (isDashboardSurface()) {
        main.setAttribute("aria-label", "Operator workspace");
      } else {
        main.setAttribute("aria-label", "Main content");
      }
    }
  };

  var appendList = function (parent, ordered, items) {
    if (!(parent instanceof HTMLElement) || !Array.isArray(items) || !items.length) {
      return;
    }

    var list = createElement(ordered ? "ol" : "ul", ordered ? "BrandGuideList BrandGuideList--ordered" : "BrandGuideList BrandGuideList--plain");

    items.forEach(function (itemText) {
      list.appendChild(createElement("li", "BrandGuideList-item", itemText));
    });

    parent.appendChild(list);
  };

  var isDashboardSurface = function () {
    var hash = getHashRoute();

    return "" === hash || "#" === hash || /^#\/dashboard(?:$|[/?])/.test(hash);
  };

  var isProductListSurface = function () {
    return /^#\/enrich\/product\/?$/.test(getHashRoute());
  };

  var isProductEditorSurface = function () {
    var hash = getHashRoute();
    var hasEditorShell = !!document.querySelector(".entity-edit-form, .AknColumn-main, .AknHorizontalNavtab, .tab-container");

    return hasEditorShell && (
      /^#\/enrich\/product\/[0-9a-f-]+(?:$|[/?])/i.test(hash)
      || /^#\/enrich\/product-model\/[^/?]+(?:$|[/?])/i.test(hash)
    );
  };

  var isConnectSurface = function () {
    return /^#\/connect(?:$|\/)/.test(getHashRoute());
  };

  var isSettingsSurface = function () {
    return /^#\/settings(?:$|[/?])/.test(getHashRoute());
  };

  var isSystemSurface = function () {
    return /^#\/system(?:$|[/?])/.test(getHashRoute());
  };

  var knownRouteClasses = [
    "BrandRoute--dashboard",
    "BrandRoute--products",
    "BrandRoute--product-editor",
    "BrandRoute--connect",
    "BrandRoute--settings",
    "BrandRoute--system"
  ];

  var syncRouteClasses = function () {
    if (!(document.body instanceof HTMLElement)) {
      return;
    }

    knownRouteClasses.forEach(function (className) {
      document.body.classList.remove(className);
    });

    if (isDashboardSurface()) {
      document.body.classList.add("BrandRoute--dashboard");
    } else if (isProductEditorSurface()) {
      document.body.classList.add("BrandRoute--product-editor");
    } else if (isProductListSurface()) {
      document.body.classList.add("BrandRoute--products");
    } else if (isConnectSurface()) {
      document.body.classList.add("BrandRoute--connect");
    } else if (isSettingsSurface()) {
      document.body.classList.add("BrandRoute--settings");
    } else if (isSystemSurface()) {
      document.body.classList.add("BrandRoute--system");
    }
  };

  var syncCompactViewportShell = function () {
    setBodyClass("BrandShell--compactNav", isAuthenticatedShell() && isCompactViewport() && !isLoginPage());

    if (!isCompactViewport()) {
      setBodyClass("BrandProductsPanelsOpen", false);
    }
  };

  var normalizeFieldText = function (value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  };

  var getClosestFieldLabel = function (element) {
    if (!(element instanceof HTMLElement)) {
      return "";
    }

    var container = element.closest(
      ".AknFieldContainer, .AknField, .AknFormContainer, .field, [data-attribute-code]"
    );

    if (!(container instanceof HTMLElement)) {
      return "";
    }

    var labelSelectors = [
      ".AknFieldContainer-header .AknFieldContainer-label",
      ".AknFieldContainer-header label",
      ".AknFieldContainer-label",
      ".AknField-label",
      ".AknLabel",
      "label"
    ];
    var labels = [];

    labelSelectors.forEach(function (selector) {
      container.querySelectorAll(selector).forEach(function (node) {
        var text = normalizeFieldText(node.textContent || "");

        if (text && -1 === labels.indexOf(text)) {
          labels.push(text);
        }
      });
    });

    return labels.length ? labels[0] : "";
  };

  var applyFieldAriaLabel = function (field, fallbackSuffix) {
    if (!(field instanceof HTMLElement) || field.getAttribute("aria-label")) {
      return;
    }

    var label = getClosestFieldLabel(field);

    if (!label) {
      return;
    }

    var resolved = fallbackSuffix ? label + " " + fallbackSuffix : label;
    field.setAttribute("aria-label", resolved);

    if (!field.getAttribute("title") && /^(a|button)$/i.test(field.tagName)) {
      field.setAttribute("title", resolved);
    }
  };

  var enhanceAccessibleFields = function () {
    document.querySelectorAll("button[data-original-title]").forEach(function (button) {
      if (!(button instanceof HTMLElement)) {
        return;
      }

      if (!button.getAttribute("aria-label")) {
        button.setAttribute("aria-label", button.getAttribute("data-original-title"));
      }
    });

    document.querySelectorAll(".download-file").forEach(function (element) {
      if (element instanceof HTMLElement && !element.getAttribute("aria-label")) {
        element.setAttribute("aria-label", "Download linked file");
      }
    });

    document.querySelectorAll(".AknTextField--noRightRadius[data-currency]").forEach(function (input) {
      if (!(input instanceof HTMLElement)) {
        return;
      }

      var currency = input.getAttribute("data-currency") || "currency";
      input.setAttribute("aria-label", "Amount in " + currency);
    });

    document.querySelectorAll(".AknMetricField-unit.unit, select.AknMetricField-unit, .select2-focusser.select2-offscreen").forEach(function (field) {
      if (field instanceof HTMLElement && !field.getAttribute("aria-label")) {
        field.setAttribute("aria-label", "Measurement unit");
      }
    });

    document.querySelectorAll("input.CoppermindResourceSpaceTab-search, [data-role='resourcespace-query']").forEach(function (field) {
      if (field instanceof HTMLElement && !field.getAttribute("aria-label")) {
        field.setAttribute("aria-label", "Search ResourceSpace assets");
      }
    });

    document.querySelectorAll(".AknFilterBox-search").forEach(function (field) {
      if (field instanceof HTMLElement && !field.getAttribute("aria-label")) {
        field.setAttribute("aria-label", "Search products");
      }
    });

    document.querySelectorAll(".AknGrid input[type='checkbox']").forEach(function (field, index) {
      if (!(field instanceof HTMLElement) || field.getAttribute("aria-label")) {
        return;
      }

      field.setAttribute("aria-label", 0 === index ? "Select visible products" : "Select product row");
    });

    document.querySelectorAll("textarea.AknTextareaField, textarea.AknTextareaField--localizable").forEach(function (field) {
      applyFieldAriaLabel(field);
    });

    document.querySelectorAll(".select2-choice, .select2-search-choice-close").forEach(function (field) {
      applyFieldAriaLabel(field, "selector");
    });
  };

  var refineProductEditorActions = function () {
    if (isProductEditorSurface()) {
      findFirst([
        ".AknTitleContainer .AknButton--apply",
        ".AknTitleContainer .AknDropdownButton--apply .AknDropdownButton-button",
        "button.AknButton--apply"
      ]) && (function (button) {
        if (!(button instanceof HTMLElement)) {
          return;
        }

        var text = (button.textContent || "").replace(/\s+/g, " ").trim();

        if (/^save$/i.test(text)) {
          button.textContent = "Save product";
        }

        button.setAttribute("aria-label", "Save product");
      })(findFirst([
        ".AknTitleContainer .AknButton--apply",
        ".AknTitleContainer .AknDropdownButton--apply .AknDropdownButton-button",
        "button.AknButton--apply"
      ]));
    }

    document.querySelectorAll(".CoppermindResourceSpaceTab-toolbar button").forEach(function (button) {
      if (!(button instanceof HTMLElement)) {
        return;
      }

      var text = (button.textContent || "").replace(/\s+/g, " ").trim();
      button.type = "button";

      if (/^search$/i.test(text)) {
        button.textContent = "Search DAM";
        button.classList.remove("AknButton--apply");
        button.classList.add("AknButton--action");
        button.setAttribute("aria-label", "Search DAM");
        return;
      }

      if (/^refresh$/i.test(text)) {
        button.setAttribute("aria-label", "Refresh DAM status");
      }
    });
  };

  var applyPrimaryActionSignals = function () {
    document.querySelectorAll("[data-variant='primary']").forEach(function (element) {
      if (element instanceof HTMLElement) {
        element.removeAttribute("data-variant");
      }
    });

    if (isDashboardSurface()) {
      var workspacePrimary = document.querySelector(".OperatorWorkspaceAction--primary");

      if (workspacePrimary instanceof HTMLElement) {
        workspacePrimary.setAttribute("data-variant", "primary");
      }

      return;
    }

    if (isProductEditorSurface()) {
      var editorPrimary = findFirst([
        ".AknTitleContainer .AknButton--apply",
        ".AknTitleContainer .AknDropdownButton--apply .AknDropdownButton-button",
        "button.AknButton--apply"
      ]);

      if (editorPrimary instanceof HTMLElement) {
        editorPrimary.setAttribute("data-variant", "primary");
      }

      return;
    }

    var bannerAction = document.querySelector(".OperatorRouteBanner-action");

    if (bannerAction instanceof HTMLElement) {
      bannerAction.setAttribute("data-variant", "primary");
    }
  };

  var resolveStepTarget = function (step) {
    if (!step) {
      return null;
    }

    if (typeof step.resolve === "function") {
      var resolved = step.resolve();
      return resolved instanceof HTMLElement ? resolved : null;
    }

    if (Array.isArray(step.selectors)) {
      return findFirst(step.selectors);
    }

    if (typeof step.selector === "string") {
      var selected = document.querySelector(step.selector);
      return selected instanceof HTMLElement ? selected : null;
    }

    return null;
  };

  var getGuideContexts = function () {
    return {
      login: {
        id: "login",
        label: "Login",
        title: "Start with sign-in, then learn the workflow inside the app.",
        summary: "The easiest way to learn this system is to set up structure first, enrich products second, and publish last.",
        flow: [
          "Sign in, then use the left menu as your main navigation.",
          "Set up categories, attributes, and families before deep product editing.",
          "Open products to fill data and use the ResourceSpace DAM tab for media."
        ],
        callout: "The Guide button stays with you after login, so you can reopen help from any page.",
        steps: [
          {
            title: "Use the login form",
            body: "Enter your Operator credentials here. After login, start with structure rather than jumping straight into products.",
            selectors: [".AuthenticationWrapper .FormWrapper", "form[name='login']", "form"]
          },
          {
            title: "Submit to enter the app",
            body: "Once you are inside, the guide switches to the screen you are on and explains the next action.",
            selectors: [".AuthenticationWrapper button[type='submit']", "button[type='submit']"]
          }
        ]
      },
      home: {
        id: "home",
        label: "Home",
        title: "Start with setup, then fill in products.",
        summary: "If you are new, follow this order: groups first, fact fields second, product types third, then products and pictures.",
        flow: [
          "Categories are the groups shoppers browse.",
          "Attributes are the fact fields and copy fields you fill in.",
          "Families are product templates that decide what each item must contain.",
          "Products are filled in after the setup is stable.",
          "Channels and connections decide where the data goes next."
        ],
        callout: "If you only remember one path, remember this: groups, fields, product types, products, pictures, then publishing.",
        steps: [
          {
            title: "Navigate from the left menu",
            body: "Use the menu to move between setup, product work, and publishing settings.",
            selectors: [".AknHeader-menu"]
          },
          {
            title: "Read the page header before acting",
            body: "The header shows where you are and usually contains save or create actions.",
            selectors: [".AknTitleContainer", "header.BrandShell-pageHeader"]
          },
          {
            title: "Do the work in the main panel",
            body: "Lists, trees, and forms change from page to page, but the main panel is always where the task actually happens.",
            selectors: [".AknDefault-mainContent", ".AknPage-main", "main"]
          }
        ]
      },
      connect: {
        id: "connect",
        label: "Connect",
        title: "Check whether data is moving.",
        summary: "Use Connect to see whether imports and exports are healthy before you assume the product data is wrong.",
        flow: [
          "Look for failed or stale imports first.",
          "Fix broken data flows before chasing product bugs.",
          "Treat connection setup as ongoing operations work."
        ],
        callout: "If a feed or listing looks wrong, start here before blaming the product record.",
        steps: [
          {
            title: "Use the summary like a health check",
            body: "This page should tell you whether data is moving cleanly, not just whether a connector exists.",
            selectors: [".AknDescriptionHeader", ".AknDefault-mainContent", ".view"]
          },
          {
            title: "Review data flow settings deliberately",
            body: "Every monitored flow should have an owner, a purpose, and a place in the operating model.",
            selectors: [".AknVerticalList", ".AknDefault-mainContent", ".view"]
          }
        ]
      },
      settings: {
        id: "settings",
        label: "Settings",
        title: "Build the product skeleton here.",
        summary: "Categories, attributes, and families decide how the rest of the app behaves. Weak setup makes every product harder to edit.",
        flow: [
          "Fix setup before you push the team into enrichment.",
          "Keep groups, fact fields, and product types separate in your mind.",
          "Remember that changes here affect every editor screen."
        ],
        callout: "If the catalog feels messy, the first repair is usually here, not in the product grid.",
        steps: [
          {
            title: "Treat settings as the model layer",
            body: "These tiles control the groups, rules, and product templates that drive the whole workspace.",
            selectors: [".AknDefault-container .view", ".AknDefault-container"]
          }
        ]
      },
      system: {
        id: "system",
        label: "System",
        title: "Use this area for admin work only.",
        summary: "This area controls people, permissions, and low-level platform settings. Most everyday catalog work happens somewhere else.",
        flow: [
          "Manage users, groups, and roles carefully.",
          "Do not use admin settings as a shortcut around weak setup.",
          "Make admin changes carefully because they affect everyone."
        ],
        callout: "If the problem affects one product, do not start here.",
        steps: [
          {
            title: "Use system navigation as an admin workspace",
            body: "This area should stay focused on platform control, permissions, and operational visibility.",
            selectors: [".AknDefault-container .view", ".AknDefault-container"]
          }
        ]
      },
      products: {
        id: "products",
        label: "Products",
        title: "Use this page to find the right product, then open it.",
        summary: "Think of this page as a to-do list. The real editing happens after you open one product.",
        flow: [
          "Search or filter until you see the right records.",
          "Open the exact product or product model you need to improve.",
          "Save solid batches of work from the header instead of waiting until the end."
        ],
        callout: "If a product is missing facts, copy, or pictures, open it instead of staying in the grid.",
        steps: [
          {
            title: "Filter before you edit",
            body: "Use search and filters to narrow work to the exact records you care about.",
            selectors: [".AknFilterBox", "[data-drop-zone='filters']", ".AknGridContainer"]
          },
          {
            title: "Use the grid as a work queue",
            body: "The grid helps you spot problems. Open a record to manage fields, pictures, completeness, and deeper content.",
            selectors: [".AknGridContainer", ".AknGrid-body", ".AknDefault-mainContent"]
          },
          {
            title: "Save or create from the header area",
            body: "Main create and apply actions typically live in the page header controls.",
            selectors: [".AknTitleContainer .AknButton--apply", ".AknDropdownButton--apply .AknDropdownButton-button", ".AknTitleContainer"]
          }
        ]
      },
      productEdit: {
        id: "product-edit",
        label: "Product editor",
        title: "Fix one product at a time on this page.",
        summary: "The tabs break the job into smaller steps, so you do not need to understand the whole record at once.",
        flow: [
          "Use the tabs as steps instead of reading the whole page at once.",
          "Fill in the required fact fields first.",
          "Use the ResourceSpace DAM tab to link pictures and files.",
          "Save from the header after each solid pass."
        ],
        callout: "If the record has weak media, missing facts, or unclear copy, this is where you fix it before publishing.",
        steps: [
          {
            title: "Check the page header first",
            body: "The header confirms what record you are editing and usually contains the main save action.",
            selectors: [".AknTitleContainer", "header.BrandShell-pageHeader"]
          },
          {
            title: "Use the tabs to move through the record",
            body: "Treat tabs as work zones instead of trying to understand the full page at once.",
            selectors: [".AknHorizontalNavtab", "[role='tablist']"]
          },
          {
            title: "Edit the main form panel",
            body: "This area holds the actual fields and content for the currently selected tab.",
            selectors: [".AknColumn-main", ".tab-content", ".AknDefault-mainContent"]
          },
          {
            title: "Use the ResourceSpace DAM tab for media",
            body: "That tab lets you search ResourceSpace, link assets, mark a primary asset, sync the binary into the catalog, and retry DAM write-back jobs.",
            resolve: findResourceSpaceTab,
            optional: true
          },
          {
            title: "Save with the header action",
            body: "Use the top apply button after each meaningful set of edits so you do not lose work.",
            selectors: [".AknTitleContainer .AknButton--apply", ".AknDropdownButton--apply .AknDropdownButton-button", "button.AknButton--apply"]
          }
        ]
      },
      categories: {
        id: "categories",
        label: "Categories",
        title: "Categories control navigation and merchandising, not every possible product fact.",
        summary: "Use category trees for organization and browse paths. Use attributes and families for the actual product data contract.",
        flow: [
          "Build clean trees that match how people browse or sell.",
          "Keep taxonomy ownership tight so the tree stays stable.",
          "Do not encode technical product facts into categories."
        ],
        callout: "When teams start putting data into categories that should be attributes, the model is drifting.",
        steps: [
          {
            title: "Use the category tree as the main work surface",
            body: "This tree controls the structure editors and channels rely on for organization.",
            selectors: [".AknVerticalList", ".AknDefault-mainContent"]
          },
          {
            title: "Use the header before creating or renaming nodes",
            body: "Category changes affect browse structure across the catalog, so verify the current branch before saving.",
            selectors: [".AknTitleContainer", "header.BrandShell-pageHeader"]
          }
        ]
      },
      attributes: {
        id: "attributes",
        label: "Attributes",
        title: "Attributes are the contract for product quality, AI enrichment, and marketplace readiness.",
        summary: "Precise attributes are what make validation, governance, and publishing behave predictably.",
        flow: [
          "Create fields for the facts, copy, SEO, compliance, and marketplace data you really need.",
          "Choose the right data type so validation and UI behavior make sense.",
          "Avoid duplicate fields with slightly different names."
        ],
        callout: "Weak attribute design is one of the fastest ways to make enrichment and downstream listings unreliable.",
        steps: [
          {
            title: "Review existing fields before adding more",
            body: "Search the current attribute set first so you do not create overlapping or duplicate fields.",
            selectors: [".AknGridContainer", ".AknDefault-mainContent"]
          },
          {
            title: "Create carefully from the top action area",
            body: "New fields should be deliberate, well named, and typed correctly for the content they hold.",
            selectors: [".AknTitleContainer .AknButton--apply", ".AknButton--important", ".AknTitleContainer"]
          }
        ]
      },
      families: {
        id: "families",
        label: "Families",
        title: "Families define what each product type must contain.",
        summary: "Think of families as templates and rules: they shape the product editor and decide what editors are required to fill.",
        flow: [
          "Group attributes into families that reflect real product types.",
          "Use required attributes to force minimum completeness.",
          "Treat family design as a governance decision because it shapes every editor downstream."
        ],
        callout: "If editors feel overwhelmed, family design is usually the first thing to tighten.",
        steps: [
          {
            title: "Review the family list before adding a new template",
            body: "Too many overlapping families make enrichment harder to manage.",
            selectors: [".AknGridContainer", ".AknDefault-mainContent"]
          },
          {
            title: "Use the header to create or update the family",
            body: "Family changes affect every product that uses that structure, so save them carefully.",
            selectors: [".AknTitleContainer", "header.BrandShell-pageHeader"]
          }
        ]
      },
      channels: {
        id: "channels",
        label: "Channels",
        title: "Channels, locales, and currencies shape what the outside world receives.",
        summary: "Good product data still fails downstream if channels and market settings are wrong.",
        flow: [
          "Align channels with real publishing targets.",
          "Set locales and currencies to match where each market sells.",
          "Treat channel setup as part of publishing governance, not just administration."
        ],
        callout: "Once you publish to Amazon and other channels, these settings become operational, not optional.",
        steps: [
          {
            title: "Check the page header for the scope you are editing",
            body: "Confirm the current market context before changing channel, locale, or currency settings.",
            selectors: [".AknTitleContainer", "header.BrandShell-pageHeader"]
          },
          {
            title: "Edit market configuration in the main panel",
            body: "These settings influence localization, pricing, and downstream exports, so change them deliberately.",
            selectors: [".AknDefault-mainContent", ".AknColumn-main", "main"]
          }
        ]
      },
      generic: {
        id: "generic",
        label: "Guide",
        title: "Use the menu for navigation, the header for actions, and the main panel for the actual work.",
        summary: "Screen layouts change, but the operating pattern stays consistent across Operator.",
        flow: [
          "Navigate from the left menu.",
          "Check the page header for context and actions.",
          "Do the current task in the main content panel."
        ],
        callout: "If you are unsure where to begin, go back to categories, attributes, families, then products.",
        steps: [
          {
            title: "Navigate from the left menu",
            body: "The menu is the fastest way to move between setup, enrichment, and downstream publishing screens.",
            selectors: [".AknHeader-menu"]
          },
          {
            title: "Use the page header as your control bar",
            body: "Breadcrumbs tell you where you are and the action area usually contains save or create buttons.",
            selectors: [".AknTitleContainer", "header.BrandShell-pageHeader"]
          },
          {
            title: "Focus on the main work panel",
            body: "That panel changes from grids to forms to trees, but it is where the current task is executed.",
            selectors: [".AknDefault-mainContent", ".AknPage-main", "main"]
          }
        ]
      }
    };
  };

  var getCurrentContext = function () {
    var contexts = getGuideContexts();
    var route = getRouteText();
    var title = getPageTitleText();

    if (isLoginPage()) {
      return contexts.login;
    }

    if (
      isProductEditorSurface()
      || findResourceSpaceTab()
      || (/product/.test(route) && /edit/.test(route) && document.querySelector(".AknHorizontalNavtab"))
    ) {
      return contexts.productEdit;
    }

    if (/connect|data flows|connected apps|connection settings/.test(route) || /connect|data flows|connected apps|connection settings/.test(title)) {
      return contexts.connect;
    }

    if ((/attributes?/.test(route) || /attributes?/.test(title)) && !/family/.test(route)) {
      return contexts.attributes;
    }

    if (/famil(y|ies)/.test(route) || /famil(y|ies)/.test(title)) {
      return contexts.families;
    }

    if (/categor(y|ies)/.test(route) || /categor(y|ies)/.test(title)) {
      return contexts.categories;
    }

    if (/channels?|locales?|currenc(y|ies)/.test(route) || /channels?|locales?|currenc(y|ies)/.test(title)) {
      return contexts.channels;
    }

    if (/products?/.test(route) || /products?/.test(title) || document.querySelector(".AknGridContainer")) {
      return contexts.products;
    }

    if (isSettingsSurface()) {
      return contexts.settings;
    }

    if (isSystemSurface()) {
      return contexts.system;
    }

    if (isAuthenticatedShell()) {
      return contexts.home;
    }

    return contexts.generic;
  };

  var getAvailableSteps = function (context) {
    if (!context || !Array.isArray(context.steps)) {
      return [];
    }

    return context.steps.map(function (step) {
      return {
        title: step.title,
        body: step.body,
        target: resolveStepTarget(step),
        optional: !!step.optional
      };
    }).filter(function (step) {
      return step.target instanceof HTMLElement || !step.optional;
    }).filter(function (step) {
      return step.target instanceof HTMLElement;
    });
  };

  var ensureGuideElements = function () {
    if (guideState.elements && document.body.contains(guideState.elements.panel)) {
      return guideState.elements;
    }

    if (!(document.body instanceof HTMLElement)) {
      return null;
    }

    var toggle = createElement("button", "BrandGuideButton", "Guide");
    var backdrop = createElement("button", "BrandGuideBackdrop");
    var panel = createElement("aside", "BrandGuidePanel");
    var content = createElement("div", "BrandGuidePanel-content");
    var close = createElement("button", "BrandGuidePanel-close", "Close");
    var footer = createElement("div", "BrandGuidePanel-footer");
    var walkthroughBackdrop = createElement("button", "BrandGuideWalkthroughBackdrop");
    var walkthroughRing = createElement("div", "BrandGuideWalkthroughRing");
    var walkthroughCard = createElement("div", "BrandGuideWalkthroughCard");
    var header = createElement("div", "BrandGuidePanel-header");
    var heading = createElement("div", "BrandGuidePanel-heading");
    var eyebrow = createElement("div", "BrandGuidePanel-eyebrow", "Operator Guide");
    var title = createElement("h2", "BrandGuidePanel-title", "Guide");

    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "BrandGuidePanel");

    backdrop.type = "button";
    backdrop.setAttribute("aria-label", "Close guide");

    close.type = "button";
    close.setAttribute("aria-label", "Close guide");

    panel.id = "BrandGuidePanel";
    panel.setAttribute("aria-hidden", "true");

    walkthroughBackdrop.type = "button";
    walkthroughBackdrop.setAttribute("aria-label", "Close walkthrough");
    walkthroughCard.setAttribute("role", "dialog");
    walkthroughCard.setAttribute("aria-live", "polite");

    heading.appendChild(eyebrow);
    heading.appendChild(title);
    header.appendChild(heading);
    header.appendChild(close);
    footer.appendChild(createElement("p", "BrandGuidePanel-note", "The Operator guide adapts as you move through catalog, DAM, and workflow screens."));

    panel.appendChild(header);
    panel.appendChild(content);
    panel.appendChild(footer);

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    document.body.appendChild(toggle);
    document.body.appendChild(walkthroughBackdrop);
    document.body.appendChild(walkthroughRing);
    document.body.appendChild(walkthroughCard);

    guideState.elements = {
      toggle: toggle,
      backdrop: backdrop,
      panel: panel,
      content: content,
      title: title,
      walkthroughBackdrop: walkthroughBackdrop,
      walkthroughRing: walkthroughRing,
      walkthroughCard: walkthroughCard
    };

    return guideState.elements;
  };

  var ensureSectionAfterHeader = function (view, className) {
    if (!(view instanceof HTMLElement)) {
      return null;
    }

    var selector = "." + String(className || "").trim().replace(/\s+/g, ".");
    var section = selector ? view.querySelector(selector) : null;

    if (!(section instanceof HTMLElement)) {
      section = createElement("section", className);
    }

    var header = view.querySelector(":scope > header, :scope > .AknTitleContainer, :scope > .BrandShell-pageHeader");

    if (header instanceof HTMLElement && header.parentNode === view) {
      if (header.nextSibling !== section) {
        view.insertBefore(section, header.nextSibling);
      }
    } else if (view.firstChild !== section) {
      view.insertBefore(section, view.firstChild);
    }

    return section;
  };

  var removeOperatorDecorators = function (className) {
    document.querySelectorAll("." + className).forEach(function (node) {
      node.remove();
    });
  };

  var appendMetricCard = function (parent, label, value, tone) {
    if (!(parent instanceof HTMLElement)) {
      return;
    }

    var card = createElement(
      "div",
      "OperatorWorkspaceMetric" + (tone ? " OperatorWorkspaceMetric--" + tone : "")
    );

    card.appendChild(createElement("div", "OperatorWorkspaceMetric-value", String(value)));
    card.appendChild(createElement("div", "OperatorWorkspaceMetric-label", label));
    parent.appendChild(card);
  };

  var appendActionItem = function (parent, href, title, body, options) {
    if (!(parent instanceof HTMLElement)) {
      return;
    }

    var config = options || {};
    var item = createElement(config.actionType === "button" ? "button" : "a", "OperatorWorkspaceAction");

    if (config.primary) {
      item.classList.add("OperatorWorkspaceAction--primary");
    }

    if ("button" === config.actionType) {
      item.type = "button";
      item.addEventListener("click", function () {
        if (typeof config.onAction === "function") {
          config.onAction();
        }
      });
    } else {
      item.href = href;
    }

    item.appendChild(createElement("div", "OperatorWorkspaceAction-title", title));
    item.appendChild(createElement("div", "OperatorWorkspaceAction-body", body));
    parent.appendChild(item);
  };

  var toggleProductsPanels = function () {
    if (!(document.body instanceof HTMLElement)) {
      return;
    }

    document.body.classList.toggle("BrandProductsPanelsOpen");

    var collapseButton = document.querySelector(".AknColumn-collapseButton");

    if (collapseButton instanceof HTMLElement) {
      collapseButton.click();
    }
  };

  var toggleSimpleMode = function () {
    setSimpleModeEnabled(!isSimpleModeEnabled());
    scheduleApply();
  };

  var openFirstVisibleProduct = function () {
    var rows = document.querySelectorAll("tbody tr, .AknGrid-bodyRow");
    var ignoreMatcher = /^(enabled|disabled|in progress|complete|n\/a|edit attributes of the product|classify the product|delete the product|toggle status)$/i;

    for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      var row = rows[rowIndex];

      if (!(row instanceof HTMLElement)) {
        continue;
      }

      var candidates = row.querySelectorAll("a, button, span, div");

      for (var itemIndex = 0; itemIndex < candidates.length; itemIndex += 1) {
        var candidate = candidates[itemIndex];

        if (!(candidate instanceof HTMLElement)) {
          continue;
        }

        var text = normalizeFieldText(candidate.textContent || "");

        if (!text || text.length < 5 || ignoreMatcher.test(text) || /^\d+%?$/.test(text) || /^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
          continue;
        }

        if (clickElement(candidate)) {
          return true;
        }
      }
    }

    return false;
  };

  var openCreateProduct = function () {
    return clickTextTarget(/^create$/i, ".create-product-button, .AknButton, button, a, span");
  };

  var findSaveProductButton = function () {
    return findFirst([
      ".AknTitleContainer .AknButton--apply",
      ".AknTitleContainer .AknDropdownButton--apply .AknDropdownButton-button",
      "button.AknButton--apply"
    ]);
  };

  var openSettingsShortcut = function (matcher) {
    if (!isSettingsSurface()) {
      goToHash("#/settings");
      window.setTimeout(function () {
        clickTextTarget(matcher, "a, button, div, span");
      }, 300);
      return true;
    }

    return clickTextTarget(matcher, "a, button, div, span");
  };

  var openSystemShortcut = function (matcher) {
    if (!isSystemSurface()) {
      goToHash("#/system");
      window.setTimeout(function () {
        clickTextTarget(matcher, "a, button, div, span");
      }, 300);
      return true;
    }

    return clickTextTarget(matcher, "a, button, div, span");
  };

  var openConnectShortcut = function (matcher) {
    if (!isConnectSurface()) {
      goToHash("#/connect/data-flows");
      window.setTimeout(function () {
        clickTextTarget(matcher, "a, button, div, span");
      }, 300);
      return true;
    }

    return clickTextTarget(matcher, "a, button, div, span");
  };

  var appendListItem = function (parent, title, body) {
    if (!(parent instanceof HTMLElement)) {
      return;
    }

    var item = createElement("li", "OperatorWorkspaceList-item");
    item.appendChild(createElement("span", "OperatorWorkspaceList-title", title));
    item.appendChild(createElement("span", "OperatorWorkspaceList-body", body));
    parent.appendChild(item);
  };

  var appendPathStep = function (parent, number, title, body) {
    if (!(parent instanceof HTMLElement)) {
      return;
    }

    var item = createElement("li", "OperatorWorkspacePath-step");
    item.appendChild(createElement("div", "OperatorWorkspacePath-number", String(number)));

    var content = createElement("div", "OperatorWorkspacePath-content");
    content.appendChild(createElement("span", "OperatorWorkspacePath-title", title));
    content.appendChild(createElement("span", "OperatorWorkspacePath-body", body));
    item.appendChild(content);
    parent.appendChild(item);
  };

  var appendGlossaryItem = function (parent, term, meaning) {
    if (!(parent instanceof HTMLElement)) {
      return;
    }

    var item = createElement("li", "OperatorWorkspaceGlossary-item");
    item.appendChild(createElement("span", "OperatorWorkspaceGlossary-term", term));
    item.appendChild(createElement("span", "OperatorWorkspaceGlossary-body", meaning));
    parent.appendChild(item);
  };

  var appendTaskAction = function (parent, title, body, options) {
    if (!(parent instanceof HTMLElement)) {
      return;
    }

    var config = options || {};
    var action = createElement("button", "OperatorTaskAction");

    action.type = "button";

    if (config.primary) {
      action.classList.add("OperatorTaskAction--primary");
    }

    if (config.secondary) {
      action.classList.add("OperatorTaskAction--secondary");
    }

    action.appendChild(createElement("span", "OperatorTaskAction-title", title));
    action.appendChild(createElement("span", "OperatorTaskAction-body", body));
    action.addEventListener("click", function () {
      if (typeof config.onAction === "function") {
        config.onAction();
      }
    });
    parent.appendChild(action);
  };

  var renderSetupWizardCard = function () {
    var stepIndex = getSetupWizardStepIndex();
    var step = setupWizardSteps[stepIndex];

    if (!step) {
      return null;
    }

    var panel = createElement("section", "OperatorTaskPanel OperatorTaskPanel--wizard");
    var header = createElement("div", "OperatorTaskPanel-header");
    var body = createElement("div", "OperatorTaskPanel-body");
    var actions = createElement("div", "OperatorTaskActions");
    var helper = createElement("div", "OperatorTaskMiniList");
    var previous = createElement("button", "OperatorTaskAction OperatorTaskAction--secondary", "Back");
    var next = createElement("button", "OperatorTaskAction OperatorTaskAction--secondary", stepIndex === setupWizardSteps.length - 1 ? "Start over" : "Next step");
    var open = createElement("button", "OperatorTaskAction OperatorTaskAction--primary", step.actionLabel);

    panel.setAttribute("aria-label", "Simple setup wizard");

    header.appendChild(createElement("div", "OperatorTaskPanel-eyebrow", "Simple setup wizard"));
    header.appendChild(createElement("h2", "OperatorTaskPanel-title", "Learn the app in the safest order."));
    header.appendChild(createElement("p", "OperatorTaskPanel-copy", "Move through these steps in order so the catalog stays understandable."));

    body.appendChild(createElement("div", "OperatorTaskStep", "Step " + (stepIndex + 1) + " of " + setupWizardSteps.length));
    body.appendChild(createElement("h3", "OperatorTaskStep-title", step.title));
    body.appendChild(createElement("p", "OperatorTaskStep-body", step.body));

    appendListItem(helper, "Current move", step.title);
    appendListItem(helper, "Why now", step.body);
    body.appendChild(helper);

    previous.type = "button";
    previous.disabled = 0 === stepIndex;
    previous.addEventListener("click", function () {
      setSetupWizardStepIndex(stepIndex - 1);
      scheduleApply();
    });

    next.type = "button";
    next.addEventListener("click", function () {
      setSetupWizardStepIndex(stepIndex === setupWizardSteps.length - 1 ? 0 : stepIndex + 1);
      scheduleApply();
    });

    open.type = "button";
    open.addEventListener("click", function () {
      if (typeof step.action === "function") {
        step.action();
      }
    });

    actions.appendChild(previous);
    actions.appendChild(open);
    actions.appendChild(next);
    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(actions);

    return panel;
  };

  var openGuideForCurrentScreen = function () {
    openGuideDrawer(false, "manual");
  };

  var loadOperatorDashboard = function (force) {
    var cacheIsFresh = Date.now() - workspaceState.dashboardLoadedAt < 60000;

    if (!force && cacheIsFresh && (workspaceState.dashboardData || workspaceState.dashboardError)) {
      return Promise.resolve(workspaceState.dashboardData);
    }

    if (workspaceState.dashboardPromise) {
      return workspaceState.dashboardPromise;
    }

    workspaceState.dashboardPromise = window.fetch("/rest/operator/dashboard?limit=6&windowDays=30", {
      credentials: "same-origin",
      headers: {
        "X-Requested-With": "XMLHttpRequest"
      }
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("Operator dashboard request failed with HTTP " + response.status + ".");
      }

      return response.json();
    }).then(function (payload) {
      workspaceState.dashboardData = payload || {};
      workspaceState.dashboardLoadedAt = Date.now();
      workspaceState.dashboardError = null;

      return workspaceState.dashboardData;
    }).catch(function (error) {
      workspaceState.dashboardLoadedAt = Date.now();
      workspaceState.dashboardError = error;

      return null;
    }).then(function (result) {
      workspaceState.dashboardPromise = null;
      return result;
    });

    return workspaceState.dashboardPromise;
  };

  var renderWorkspaceHome = function () {
    if (!isDashboardSurface()) {
      removeOperatorDecorators("OperatorWorkspaceHome");
      return;
    }

    var view = document.querySelector(".AknDefault-container .view");

    if (!(view instanceof HTMLElement)) {
      return;
    }

    var section = ensureSectionAfterHeader(view, "OperatorWorkspaceHome");

    if (!(section instanceof HTMLElement)) {
      return;
    }

    var payload = workspaceState.dashboardData;
    var governance = payload && payload.governance ? payload.governance : {};
    var approvals = payload && payload.approvals && Array.isArray(payload.approvals.items)
      ? payload.approvals.items
      : [];
    var rights = payload && payload.rights && Array.isArray(payload.rights.items)
      ? payload.rights.items
      : [];
    var exceptions = payload && payload.exceptions ? payload.exceptions : {};
    var audit = payload && Array.isArray(payload.audit) ? payload.audit : [];
    var blockedOwners = Number(governance.blocked_owners || 0);
    var readyOwners = Number(governance.ready_owners || 0);
    var pendingApprovals = approvals.length || Number(governance.pending_owners || 0);
    var averageCompleteness = Number(governance.average_completeness || 0).toFixed(0);
    var failedOutbox = exceptions.failed_outbox_events && exceptions.failed_outbox_events.length
      ? exceptions.failed_outbox_events.length
      : 0;
    var failedIngest = exceptions.failed_ingest_jobs && exceptions.failed_ingest_jobs.length
      ? exceptions.failed_ingest_jobs.length
      : 0;
    var focusMessages = [];

    if (blockedOwners > 0) {
      focusMessages.push("Resolve blocked records before they reach publishing queues.");
    }

    if (pendingApprovals > 0) {
      focusMessages.push("Review pending approvals so records keep moving downstream.");
    }

    if (rights.length > 0) {
      focusMessages.push("Address asset rights and expiration issues before media becomes a blocker.");
    }

    if (0 === focusMessages.length) {
      focusMessages.push("The workspace is clear enough to continue enrichment, DAM sync, and marketplace prep.");
    }

    section.innerHTML = "";

    var shell = createElement("div", "OperatorWorkspaceHome-shell");
    var hero = createElement("div", "OperatorWorkspaceHero");
    var metrics = createElement("div", "OperatorWorkspaceMetrics");
    var actions = createElement("div", "OperatorWorkspaceActions");
    var columns = createElement("div", "OperatorWorkspaceColumns");
    var workflowColumn = createElement("div", "OperatorWorkspaceColumn");
    var operationsColumn = createElement("div", "OperatorWorkspaceColumn");
    var pathColumn = createElement("div", "OperatorWorkspaceColumn");
    var glossaryColumn = createElement("div", "OperatorWorkspaceColumn");
    var workflowList = createElement("ol", "OperatorWorkspaceList");
    var operationsList = createElement("ul", "OperatorWorkspaceList");
    var pathList = createElement("ol", "OperatorWorkspacePath");
    var glossaryList = createElement("ul", "OperatorWorkspaceGlossary");

    hero.appendChild(createElement("div", "OperatorWorkspaceEyebrow", "Operator workspace"));
    hero.appendChild(createElement("h1", "OperatorWorkspaceTitle", "Start here. Build the product skeleton before you edit lots of products."));
    hero.appendChild(createElement(
      "p",
      "OperatorWorkspaceBody",
      "This page is the simplest place to begin. Follow the cards in order, and use the left menu only after you know which step comes next."
    ));
    hero.appendChild(createElement("div", "OperatorWorkspaceCallout", focusMessages.join(" ")));

    appendMetricCard(metrics, "Ready to keep moving", readyOwners, "good");
    appendMetricCard(metrics, "Need attention", blockedOwners, blockedOwners > 0 ? "alert" : "");
    appendMetricCard(metrics, "Waiting for approval", pendingApprovals, pendingApprovals > 0 ? "warn" : "");
    appendMetricCard(metrics, "Average filled in", averageCompleteness + "%", "");

    appendActionItem(actions, "#/settings", "1. Build the setup", "Start with categories, attributes, and families so products have a clean structure.", {primary: true});
    appendActionItem(actions, "#/enrich/product/", "2. Fill in products", "Open the products list when the setup is ready and start improving one record at a time.");
    appendActionItem(actions, "#/connect/data-flows", "3. Check publishing health", "Review imports, exports, and handoffs before you trust downstream feeds.");
    appendActionItem(actions, "#", "Need help right now?", "Open the guide for simple, screen-by-screen instructions.", {
      actionType: "button",
      onAction: openGuideForCurrentScreen
    });

    var wizardCard = renderSetupWizardCard();

    workflowColumn.appendChild(createElement("h2", "OperatorWorkspaceColumn-title", "What to do next"));
    appendListItem(workflowList, "Build the skeleton", "Use setup pages when the catalog still feels thin or inconsistent.");
    appendListItem(workflowList, "Fill in products", "Open products only after the setup is good enough to guide the editor.");
    appendListItem(workflowList, "Check publishing health", "Finish by checking connection health, rights issues, and downstream exceptions.");
    workflowColumn.appendChild(workflowList);

    operationsColumn.appendChild(createElement("h2", "OperatorWorkspaceColumn-title", "Recent operational signals"));
    if (audit.length > 0) {
      appendListItem(
        operationsList,
        String((audit[0].subject && audit[0].subject.label) || "Recent audit"),
        String(audit[0].message || audit[0].action || "A recent Operator event is available for review.")
      );
    } else {
      appendListItem(operationsList, "No recent Operator audit events", "Recent approvals, sync retries, and governance transitions will appear here once work starts moving.");
    }
    appendListItem(
      operationsList,
      failedOutbox > 0 ? failedOutbox + " failed outbox event(s)" : "Outbox healthy",
      failedOutbox > 0
        ? "A marketplace or control-plane handoff needs operator attention."
        : "Product saves are not currently backing up in the Operator outbox."
    );
    appendListItem(
      operationsList,
      failedIngest > 0 ? failedIngest + " failed media ingest job(s)" : "Media ingest healthy",
      failedIngest > 0
        ? "Some ResourceSpace binaries need to be retried or reviewed."
        : "No failed DAM binary ingest jobs are waiting right now."
    );
    appendListItem(
      operationsList,
      rights.length > 0 ? rights.length + " asset rights issue(s)" : "No urgent asset rights issues",
      rights.length > 0
        ? "Asset licensing or expiration data needs review before those files are treated as ready."
        : "Rights and expiration monitoring is currently clear for the sampled window."
    );
    operationsColumn.appendChild(operationsList);

    pathColumn.appendChild(createElement("h2", "OperatorWorkspaceColumn-title", "Simple path"));
    appendPathStep(pathList, 1, "Groups", "Create or clean up categories so products have a home.");
    appendPathStep(pathList, 2, "Fact fields", "Create attributes so people know what facts and copy to fill in.");
    appendPathStep(pathList, 3, "Product types", "Use families to decide what each kind of product must contain.");
    appendPathStep(pathList, 4, "Products", "Open one product at a time and fill in facts, copy, and completeness.");
    appendPathStep(pathList, 5, "Pictures and files", "Use the ResourceSpace DAM tab to link media after the main facts are in place.");
    pathColumn.appendChild(pathList);

    glossaryColumn.appendChild(createElement("h2", "OperatorWorkspaceColumn-title", "What the words mean"));
    appendGlossaryItem(glossaryList, "Category", "A group or folder that helps people browse products.");
    appendGlossaryItem(glossaryList, "Attribute", "A fact field or copy field, like color, size, or description.");
    appendGlossaryItem(glossaryList, "Family", "A product template that says which fields a product type needs.");
    appendGlossaryItem(glossaryList, "DAM", "The picture and file library connected through ResourceSpace.");
    glossaryColumn.appendChild(glossaryList);

    columns.appendChild(workflowColumn);
    columns.appendChild(operationsColumn);
    columns.appendChild(pathColumn);
    columns.appendChild(glossaryColumn);

    shell.appendChild(hero);
    shell.appendChild(metrics);
    shell.appendChild(actions);
    if (wizardCard instanceof HTMLElement) {
      shell.appendChild(wizardCard);
    }
    shell.appendChild(columns);
    section.appendChild(shell);

    if (!payload && !workspaceState.dashboardPromise) {
      loadOperatorDashboard(false).then(function () {
        scheduleApply();
      });
    }
  };

  var simplifySurfaceCards = function () {
    document.querySelectorAll(".OperatorSimpleMode-hidden, .OperatorSimpleMode-primary, .OperatorSimpleMode-muted").forEach(function (node) {
      node.classList.remove("OperatorSimpleMode-hidden", "OperatorSimpleMode-primary", "OperatorSimpleMode-muted");
    });

    var markByText = function (matcher, className) {
      document.querySelectorAll("a, button, div, span, h2, h3").forEach(function (node) {
        if (!(node instanceof HTMLElement)) {
          return;
        }

        var text = normalizeFieldText(node.textContent || "");

        if (!text || !matcher.test(text)) {
          return;
        }

        var container = node.closest("a, button, [role='button'], li, section, article, .AknSubsection-item, .AknVerticalList-item, .AknButtonList-item, .AknActionButton")
          || node;
        container.classList.add(className);
      });
    };

    if (isSettingsSurface()) {
      markByText(/^(measurements|association types|group types|groups)$/i, "OperatorSimpleMode-hidden");
      markByText(/^(categories|attributes|families|channels|locales|currencies)$/i, "OperatorSimpleMode-primary");
    }

    if (isSystemSurface()) {
      markByText(/^(catalog volume monitoring|configuration|system information)$/i, "OperatorSimpleMode-hidden");
      markByText(/^(users|user groups|roles)$/i, "OperatorSimpleMode-primary");
    }

    if (isConnectSurface()) {
      markByText(/^(app store|connected apps)$/i, "OperatorSimpleMode-hidden");
      markByText(/^(data flows|connection settings)$/i, "OperatorSimpleMode-primary");
    }

    if (isProductListSurface()) {
      markByText(/^(display:|variant:|columns|bulk actions|sequential edit|delete|quick export)$/i, "OperatorSimpleMode-hidden");
      markByText(/^create$/i, "OperatorSimpleMode-primary");
    }
  };

  var renderTaskPanel = function () {
    if (isDashboardSurface()) {
      removeOperatorDecorators("OperatorTaskPanelRoute");
      return;
    }

    var config = null;

    if (isProductListSurface()) {
      config = {
        kind: "products",
        eyebrow: "Simple product flow",
        title: "Do only the next useful thing.",
        body: "Create a product, open one product, or show the side filters. Leave the heavy grid tools hidden until you really need them.",
        checklist: [
          "Create only when the product type already exists.",
          "Open one product and finish the facts before jumping around.",
          "Use filters only when the list feels too crowded."
        ],
        actions: [
          {
            title: "Create one product",
            body: "Open the native create flow.",
            primary: true,
            onAction: openCreateProduct
          },
          {
            title: "Open the first visible product",
            body: "Jump into editing instead of browsing the whole grid.",
            onAction: openFirstVisibleProduct
          },
          {
            title: "Show or hide side filters",
            body: "Use the category and filter rail only when you need it.",
            onAction: toggleProductsPanels
          },
          {
            title: isSimpleModeEnabled() ? "Show advanced grid tools" : "Hide advanced grid tools",
            body: isSimpleModeEnabled() ? "Reveal bulk actions, exports, and other expert controls." : "Return to the simpler product work view.",
            secondary: true,
            onAction: toggleSimpleMode
          }
        ]
      };
    } else if (isSettingsSurface()) {
      config = {
        kind: "settings",
        eyebrow: "Simple setup",
        title: "Use only the setup pieces that matter first.",
        body: "Most teams need categories, attributes, families, and channels before they need anything more advanced.",
        checklist: [
          "Categories give products a home.",
          "Attributes define the facts and copy fields.",
          "Families tell editors what each product type needs."
        ],
        actions: [
          { title: "Categories", body: "Open the catalog groups.", primary: true, onAction: function () { return openSettingsShortcut(/^categories$/i); } },
          { title: "Attributes", body: "Open the fact-field builder.", onAction: function () { return openSettingsShortcut(/^attributes$/i); } },
          { title: "Families", body: "Open the product type templates.", onAction: function () { return openSettingsShortcut(/^families$/i); } },
          { title: isSimpleModeEnabled() ? "Show advanced setup" : "Hide advanced setup", body: isSimpleModeEnabled() ? "Reveal measurements, associations, and group tools." : "Return to the smaller setup list.", secondary: true, onAction: toggleSimpleMode }
        ]
      };
    } else if (isSystemSurface()) {
      config = {
        kind: "system",
        eyebrow: "Admin basics",
        title: "Stay with people and permissions unless you are doing platform work.",
        body: "Most operator teams only need users, roles, and user groups here.",
        checklist: [
          "Add or edit people here.",
          "Use roles when access needs to change for many people.",
          "Leave platform diagnostics for advanced admins."
        ],
        actions: [
          { title: "Users", body: "Open user accounts.", primary: true, onAction: function () { return openSystemShortcut(/^users$/i); } },
          { title: "Roles", body: "Open shared permissions.", onAction: function () { return openSystemShortcut(/^roles$/i); } },
          { title: "User groups", body: "Open grouped access control.", onAction: function () { return openSystemShortcut(/^user groups$/i); } },
          { title: isSimpleModeEnabled() ? "Show advanced admin" : "Hide advanced admin", body: isSimpleModeEnabled() ? "Reveal system diagnostics and low-level configuration." : "Return to the smaller admin view.", secondary: true, onAction: toggleSimpleMode }
        ]
      };
    } else if (isConnectSurface()) {
      config = {
        kind: "connect",
        eyebrow: "Publishing health",
        title: "Look for movement, not just settings.",
        body: "Start with data flows and imports. Go to deeper connection pages only when the health view says something is wrong.",
        checklist: [
          "Check data flows first.",
          "Verify imports before assuming the catalog is wrong.",
          "Use connection settings only when troubleshooting."
        ],
        actions: [
          { title: "Data flows", body: "Stay on the health overview.", primary: true, onAction: function () { return openConnectShortcut(/^data flows$/i); } },
          { title: "Imports", body: "Jump to import monitoring.", onAction: function () { return clickTextTarget(/^imports$/i, ".AknHeader-menuItem, .AknHeader-menuItem a, a, button, span"); } },
          { title: "Connection settings", body: "Open deeper connector rules.", onAction: function () { return openConnectShortcut(/^connection settings$/i); } },
          { title: isSimpleModeEnabled() ? "Show advanced connections" : "Hide advanced connections", body: isSimpleModeEnabled() ? "Reveal app store and connected-app surfaces." : "Return to the smaller connection view.", secondary: true, onAction: toggleSimpleMode }
        ]
      };
    } else if (isProductEditorSurface()) {
      config = {
        kind: "product-editor",
        eyebrow: "Ready-to-publish checklist",
        title: "Finish this product in a simple order.",
        body: "Use this page as a short checklist: facts, pictures, readiness, then save.",
        checklist: [
          "Fill the fact fields that are still empty.",
          "Open the ResourceSpace DAM tab and link the right files.",
          "Save before leaving this product."
        ],
        actions: [
          { title: "Save product", body: "Use the native save action.", primary: true, onAction: function () { return clickElement(findSaveProductButton()); } },
          { title: "Open the DAM tab", body: "Go straight to pictures and files.", onAction: function () { return clickElement(findResourceSpaceTab()); } },
          { title: "Back to products", body: "Return to the work queue.", onAction: function () { goToHash("#/enrich/product/"); return true; } },
          { title: isSimpleModeEnabled() ? "Show advanced editor" : "Hide advanced editor", body: isSimpleModeEnabled() ? "Reveal the full editor chrome and expert tools." : "Return to the smaller product-edit view.", secondary: true, onAction: toggleSimpleMode }
        ]
      };
    }

    document.querySelectorAll(".OperatorTaskPanelRoute").forEach(function (node) {
      if (!(node instanceof HTMLElement)) {
        return;
      }

      if (!config || !node.classList.contains("OperatorTaskPanelRoute--" + config.kind)) {
        node.remove();
      }
    });

    if (!config) {
      return;
    }

    var host = "products" === config.kind
      ? document.querySelector(".AknDefault-contentWithBottom")
      : document.querySelector(".AknDefault-container .view");

    if (!(host instanceof HTMLElement)) {
      return;
    }

    var panel = host.querySelector(".OperatorTaskPanelRoute--" + config.kind);

    if (!(panel instanceof HTMLElement)) {
      panel = createElement("section", "OperatorTaskPanelRoute OperatorTaskPanelRoute--" + config.kind);
    }

    if ("products" === config.kind) {
      var banner = host.querySelector(".OperatorRouteBanner--products");

      if (banner instanceof HTMLElement) {
        if (banner.nextSibling !== panel) {
          host.insertBefore(panel, banner.nextSibling);
        }
      } else if (host.firstChild !== panel) {
        host.insertBefore(panel, host.firstChild);
      }
    } else {
      ensureSectionAfterHeader(host, panel.className);
      panel = host.querySelector(".OperatorTaskPanelRoute--" + config.kind);
    }

    if (!(panel instanceof HTMLElement)) {
      return;
    }

    panel.innerHTML = "";

    var header = createElement("div", "OperatorTaskPanel-header");
    var body = createElement("div", "OperatorTaskPanel-body");
    var actionRow = createElement("div", "OperatorTaskActions");
    var checklist = createElement("ul", "OperatorTaskChecklist");

    header.appendChild(createElement("div", "OperatorTaskPanel-eyebrow", config.eyebrow));
    header.appendChild(createElement("h2", "OperatorTaskPanel-title", config.title));
    header.appendChild(createElement("p", "OperatorTaskPanel-copy", config.body));

    config.checklist.forEach(function (item) {
      checklist.appendChild(createElement("li", "OperatorTaskChecklist-item", item));
    });

    config.actions.forEach(function (action) {
      appendTaskAction(actionRow, action.title, action.body, action);
    });

    body.appendChild(checklist);
    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(actionRow);
  };

  var renderRouteBanner = function () {
    var config = null;

    if (isConnectSurface()) {
      config = {
        kind: "connect",
        title: "Connection operations",
        body: "Use this area to monitor integrations, review sync health, and prove that data is moving cleanly between Operator and downstream systems.",
        action: "#/collect/import/",
        actionLabel: "Review imports and monitored flows",
        actionType: "link"
      };
    } else if (isSettingsSurface()) {
      config = {
        kind: "settings",
        title: "Build the product skeleton here.",
        body: "Use setup pages before heavy editing. This is where you define groups, fact fields, and product types.",
        points: [
          "Categories are groups shoppers browse.",
          "Attributes are fact fields and copy fields.",
          "Families are product templates."
        ],
        action: "#/enrich/product/",
        actionLabel: "Return to the product work queue",
        actionType: "link"
      };
    } else if (isSystemSurface()) {
      config = {
        kind: "system",
        title: "Use this area for admin work only.",
        body: "This is for people, roles, and platform rules. Most everyday catalog work happens somewhere else.",
        points: [
          "Use system pages when the change affects many users.",
          "Do not start here for a single product problem.",
          "Treat changes here as careful admin work."
        ],
        action: "#/dashboard",
        actionLabel: "Back to Operator workspace",
        actionType: "link"
      };
    } else if (isProductListSurface()) {
      config = {
        kind: "products",
        title: "Use this page to find the right product, then open it.",
        body: "Think of this page as a to-do list. Find the right record here, then open it to do the real editing.",
        points: [
          "Search or filter until you see the right records.",
          "Open one product to edit facts, copy, and pictures.",
          "Save in the header after each solid pass."
        ],
        actionLabel: "Show filters and taxonomy",
        actionType: "button",
        onAction: toggleProductsPanels
      };
    } else if (isProductEditorSurface()) {
      config = {
        kind: "product-editor",
        title: "Fix one product at a time on this page.",
        body: "Use the tabs like steps so the page feels smaller: facts first, pictures next, then save.",
        points: [
          "Fill in required fact fields first.",
          "Open the ResourceSpace DAM tab for pictures and files.",
          "Save from the header after each good pass."
        ],
        actionLabel: "Show the guide for this screen",
        actionType: "button",
        onAction: openGuideForCurrentScreen
      };
    }

    document.querySelectorAll(".OperatorRouteBanner").forEach(function (node) {
      if (!(node instanceof HTMLElement)) {
        return;
      }

      if (!config || !node.classList.contains("OperatorRouteBanner--" + config.kind)) {
        node.remove();
      }
    });

    if (!config) {
      return;
    }

    var host = "products" === config.kind
      ? document.querySelector(".AknDefault-contentWithBottom")
      : document.querySelector(".AknDefault-container .view");

    if (!(host instanceof HTMLElement)) {
      return;
    }

    var section = host.querySelector(".OperatorRouteBanner--" + config.kind);

    if (!(section instanceof HTMLElement)) {
      section = createElement("section", "OperatorRouteBanner OperatorRouteBanner--" + config.kind);
    }

    if ("products" === config.kind) {
      if (host.firstChild !== section) {
        host.insertBefore(section, host.firstChild);
      }
    } else {
      ensureSectionAfterHeader(host, section.className);
      section = host.querySelector(".OperatorRouteBanner--" + config.kind);
    }

    if (!(section instanceof HTMLElement)) {
      return;
    }

    section.innerHTML = "";
    section.appendChild(createElement("div", "OperatorRouteBanner-eyebrow", "Operator"));
    section.appendChild(createElement("h1", "OperatorRouteBanner-title", config.title));
    section.appendChild(createElement("p", "OperatorRouteBanner-body", config.body));

    if (Array.isArray(config.points) && config.points.length) {
      var list = createElement("ol", "OperatorRouteBanner-list");
      config.points.forEach(function (point) {
        list.appendChild(createElement("li", "OperatorRouteBanner-listItem", point));
      });
      section.appendChild(list);
    }

    var action = createElement(
      "button" === config.actionType ? "button" : "a",
      "OperatorRouteBanner-action",
      config.actionLabel
    );

    if ("button" === config.actionType) {
      action.type = "button";
      action.addEventListener("click", function () {
        if (typeof config.onAction === "function") {
          config.onAction();
        }
      });
    } else {
      action.href = config.action;
    }

    section.appendChild(action);
  };

  var refreshLegacyCopy = function () {
    var view = document.querySelector(".AknDefault-container .view");

    if (isConnectSurface() && view instanceof HTMLElement) {
      replaceMatchedText(view, "div, p, span, h1, h2, h3", /welcome to data flows!/i, "Monitor data flows");
      replaceMatchedText(
        view,
        "div, p, span",
        /here, you can track the data flow between your pim and third parties\..*here you go!/i,
        "Track connection health, throughput, and failures between Operator and connected systems."
      );
      replaceMatchedText(
        view,
        "div, p, span, h1, h2, h3",
        /want to see some fancy charts about your connections\?/i,
        "No monitored data flows are reporting yet."
      );
      replaceMatchedText(
        view,
        "div, p, span",
        /create and start tracking your first one here\./i,
        "Create your first monitored connection to start tracking sync health, throughput, and failures."
      );
    }

    if (isSettingsSurface() && view instanceof HTMLElement) {
      replaceMatchedText(view, "div, p, span, h1, h2, h3", /^settings menu$/i, "Catalog structure");
    }

    if (isSystemSurface() && view instanceof HTMLElement) {
      replaceMatchedText(view, "div, p, span, h1, h2, h3", /^system menu$/i, "Platform administration");
    }

  };

  var closeGuideDrawer = function () {
    var elements = ensureGuideElements();

    if (!elements) {
      return;
    }

    elements.toggle.classList.remove("is-open");
    elements.toggle.setAttribute("aria-expanded", "false");
    elements.backdrop.classList.remove("is-open");
    elements.panel.classList.remove("is-open");
    elements.panel.setAttribute("aria-hidden", "true");
    document.body.classList.remove("BrandGuide-drawerOpen");
    guideState.openMode = null;
  };

  var openGuideDrawer = function (trackSeen, mode) {
    var elements = ensureGuideElements();

    if (!elements) {
      return;
    }

    renderGuideDrawer();

    elements.toggle.classList.add("is-open");
    elements.toggle.setAttribute("aria-expanded", "true");
    elements.backdrop.classList.add("is-open");
    elements.panel.classList.add("is-open");
    elements.panel.setAttribute("aria-hidden", "false");
    document.body.classList.add("BrandGuide-drawerOpen");
    guideState.openMode = mode || "manual";

    if (trackSeen !== false) {
      safeStorageSet(guideSeenKey, "1");
    }
  };

  var clearWalkthroughHighlight = function () {
    if (guideState.walkthrough && guideState.walkthrough.target instanceof HTMLElement) {
      guideState.walkthrough.target.classList.remove("BrandGuide-highlightTarget");
    }
  };

  var stopWalkthrough = function () {
    var elements = ensureGuideElements();

    clearWalkthroughHighlight();
    guideState.walkthrough = null;

    if (!elements) {
      return;
    }

    elements.walkthroughBackdrop.classList.remove("is-open");
    elements.walkthroughRing.classList.remove("is-open");
    elements.walkthroughCard.classList.remove("is-open");
    elements.walkthroughCard.style.removeProperty("top");
    elements.walkthroughCard.style.removeProperty("left");
    document.body.classList.remove("BrandGuide-walkthroughOpen");
  };

  var positionWalkthrough = function () {
    if (!guideState.walkthrough || !(guideState.walkthrough.target instanceof HTMLElement)) {
      return;
    }

    var elements = ensureGuideElements();

    if (!elements) {
      return;
    }

    var target = guideState.walkthrough.target;

    if (!document.body.contains(target)) {
      stopWalkthrough();
      return;
    }

    var rect = target.getBoundingClientRect();
    var ring = elements.walkthroughRing;
    var card = elements.walkthroughCard;
    var cardWidth = card.offsetWidth || 320;
    var cardHeight = card.offsetHeight || 220;
    var top = rect.bottom + 16;
    var left = clamp(rect.left, 16, Math.max(16, window.innerWidth - cardWidth - 16));

    if (top + cardHeight > window.innerHeight - 16) {
      top = rect.top - cardHeight - 16;
    }

    if (top < 16) {
      top = 16;
    }

    ring.style.top = Math.max(8, rect.top - 10) + "px";
    ring.style.left = Math.max(8, rect.left - 10) + "px";
    ring.style.width = Math.max(48, rect.width + 20) + "px";
    ring.style.height = Math.max(48, rect.height + 20) + "px";

    card.style.top = top + "px";
    card.style.left = left + "px";
  };

  var moveWalkthrough = function (delta) {
    if (!guideState.walkthrough) {
      return;
    }

    var nextIndex = guideState.walkthrough.index + delta;

    if (nextIndex < 0 || nextIndex >= guideState.walkthrough.steps.length) {
      return;
    }

    guideState.walkthrough.index = nextIndex;
    renderWalkthroughStep();
  };

  var renderWalkthroughStep = function () {
    if (!guideState.walkthrough) {
      return;
    }

    var elements = ensureGuideElements();
    var session = guideState.walkthrough;
    var step = session.steps[session.index];

    if (!elements || !step || !(step.target instanceof HTMLElement)) {
      stopWalkthrough();
      return;
    }

    clearWalkthroughHighlight();
    session.target = step.target;

    try {
      step.target.scrollIntoView({behavior: "smooth", block: "center", inline: "nearest"});
    } catch (error) {
      step.target.scrollIntoView();
    }

    step.target.classList.add("BrandGuide-highlightTarget");
    elements.walkthroughCard.innerHTML = "";

    var status = createElement("div", "BrandGuideWalkthroughCard-status", "Step " + (session.index + 1) + " of " + session.steps.length);
    var title = createElement("h3", "BrandGuideWalkthroughCard-title", step.title);
    var body = createElement("p", "BrandGuideWalkthroughCard-copy", step.body);
    var controls = createElement("div", "BrandGuideWalkthroughCard-controls");
    var previous = createElement("button", "BrandGuideActionButton BrandGuideActionButton--ghost", "Back");
    var next = createElement(
      "button",
      "BrandGuideActionButton BrandGuideActionButton--primary",
      session.index === session.steps.length - 1 ? "Finish" : "Next"
    );
    var close = createElement("button", "BrandGuideActionButton BrandGuideActionButton--text", "Close");

    previous.type = "button";
    previous.disabled = session.index === 0;
    previous.addEventListener("click", function () {
      moveWalkthrough(-1);
    });

    next.type = "button";
    next.addEventListener("click", function () {
      if (session.index === session.steps.length - 1) {
        stopWalkthrough();
        return;
      }

      moveWalkthrough(1);
    });

    close.type = "button";
    close.addEventListener("click", function () {
      stopWalkthrough();
    });

    controls.appendChild(previous);
    controls.appendChild(next);
    controls.appendChild(close);

    elements.walkthroughCard.appendChild(status);
    elements.walkthroughCard.appendChild(title);
    elements.walkthroughCard.appendChild(body);
    elements.walkthroughCard.appendChild(controls);
    elements.walkthroughBackdrop.classList.add("is-open");
    elements.walkthroughRing.classList.add("is-open");
    elements.walkthroughCard.classList.add("is-open");
    document.body.classList.add("BrandGuide-walkthroughOpen");

    positionWalkthrough();
    window.requestAnimationFrame(positionWalkthrough);
    window.setTimeout(positionWalkthrough, 180);
  };

  var startWalkthrough = function () {
    var context = getCurrentContext();
    var steps = getAvailableSteps(context);

    if (!steps.length) {
      openGuideDrawer(false);
      return;
    }

    guideState.walkthrough = {
      contextId: context.id,
      index: 0,
      steps: steps,
      target: null
    };

    closeGuideDrawer();
    renderWalkthroughStep();
  };

  var renderGuideDrawer = function () {
    var elements = ensureGuideElements();

    if (!elements) {
      return;
    }

    var context = getCurrentContext();
    var steps = getAvailableSteps(context);
    var intro = createElement("section", "BrandGuideSection BrandGuideSection--intro");
    var flow = createElement("section", "BrandGuideSection");
    var page = createElement("section", "BrandGuideSection");
    var actions = createElement("section", "BrandGuideSection BrandGuideSection--actions");
    var actionRow = createElement("div", "BrandGuideActions");
    var walkthroughButton = createElement("button", "BrandGuideActionButton BrandGuideActionButton--primary", "Show walkthrough");
    var remindButton = createElement("button", "BrandGuideActionButton BrandGuideActionButton--ghost", "Show again for new users");

    guideState.contextId = context.id;
    elements.title.textContent = context.label;
    elements.content.innerHTML = "";

    intro.appendChild(createElement("div", "BrandGuideSection-kicker", context.label));
    intro.appendChild(createElement("h3", "BrandGuideSection-title", context.title));
    intro.appendChild(createElement("p", "BrandGuideSection-copy", context.summary));
    intro.appendChild(createElement("p", "BrandGuideSection-callout", context.callout));

    flow.appendChild(createElement("h4", "BrandGuideSection-heading", "Recommended flow"));
    appendList(flow, true, context.flow);

    if (steps.length) {
      page.appendChild(createElement("h4", "BrandGuideSection-heading", "Key areas on this page"));
      appendList(page, false, steps.map(function (step) {
        return step.title;
      }));
    }

    actions.appendChild(createElement("h4", "BrandGuideSection-heading", "Guided walkthrough"));
    actions.appendChild(createElement(
      "p",
      "BrandGuideSection-copy",
      steps.length
        ? "Highlight the main controls on this screen one step at a time."
        : "This screen does not have a stable walkthrough target yet, but the summary above still explains how to use it."
    ));

    walkthroughButton.type = "button";
    walkthroughButton.disabled = !steps.length;
    walkthroughButton.addEventListener("click", function () {
      startWalkthrough();
    });

    remindButton.type = "button";
    remindButton.addEventListener("click", function () {
      safeStorageSet(guideSeenKey, "0");
      openGuideDrawer(false);
    });

    actionRow.appendChild(walkthroughButton);
    actionRow.appendChild(remindButton);
    actions.appendChild(actionRow);

    elements.content.appendChild(intro);
    elements.content.appendChild(flow);

    if (steps.length) {
      elements.content.appendChild(page);
    }

    elements.content.appendChild(actions);
  };

  var maybeAutoOpenGuide = function () {
    return;
  };

  var syncSimpleMode = function () {
    setBodyClass("OperatorSimpleMode", isSimpleModeEnabled());
  };

  var syncGuide = function () {
    var signature = getRouteSignature();
    var context = getCurrentContext();
    var elements = ensureGuideElements();
    var routeChanged = guideState.routeSignature !== signature || guideState.contextId !== context.id;

    if (!elements) {
      return;
    }

    if (routeChanged) {
      if (elements.panel.classList.contains("is-open") && ("auto" === guideState.openMode || isCompactViewport())) {
        closeGuideDrawer();
      }

      guideState.routeSignature = signature;
      renderGuideDrawer();

      if (guideState.walkthrough && guideState.walkthrough.contextId !== context.id) {
        stopWalkthrough();
      }
    }

    if (guideState.walkthrough) {
      positionWalkthrough();
    }

    maybeAutoOpenGuide();
  };

  var bindGuideEvents = function () {
    var elements = ensureGuideElements();

    if (!elements || elements.toggle.dataset.brandGuideBound === "1") {
      return;
    }

    elements.toggle.dataset.brandGuideBound = "1";

    elements.toggle.addEventListener("click", function () {
      if (elements.panel.classList.contains("is-open")) {
        closeGuideDrawer();
      } else {
        openGuideDrawer(true, "manual");
      }
    });

    elements.backdrop.addEventListener("click", function () {
      closeGuideDrawer();
    });

    elements.panel.querySelector(".BrandGuidePanel-close").addEventListener("click", function () {
      closeGuideDrawer();
    });

    elements.walkthroughBackdrop.addEventListener("click", function () {
      stopWalkthrough();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (guideState.walkthrough) {
          stopWalkthrough();
        } else {
          closeGuideDrawer();
        }
      }

      if (!guideState.walkthrough) {
        return;
      }

      if (event.key === "ArrowRight") {
        moveWalkthrough(1);
      } else if (event.key === "ArrowLeft") {
        moveWalkthrough(-1);
      }
    });
  };

  var applyBranding = function () {
    applyThemeRoot();
    syncSimpleMode();
    syncRouteClasses();
    syncCompactViewportShell();
    brandMenuLogo();
    brandMainMenu();
    brandVerticalLists();
    brandHeaders();
    ensureMainLandmark();
    refreshLegacyCopy();
    renderWorkspaceHome();
    renderRouteBanner();
    simplifySurfaceCards();
    renderTaskPanel();
    enhanceAccessibleFields();
    refineProductEditorActions();
    applyPrimaryActionSignals();
    bindGuideEvents();
    syncGuide();
  };

  var scheduleApply = function () {
    if (scheduled) {
      return;
    }

    scheduled = true;

    window.requestAnimationFrame(function () {
      scheduled = false;
      applyBranding();
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleApply, {once: true});
  } else {
    scheduleApply();
  }

  window.addEventListener("load", scheduleApply);
  window.addEventListener("hashchange", scheduleApply);
  window.addEventListener("resize", scheduleApply);
  window.addEventListener("scroll", scheduleApply, true);

  if (typeof MutationObserver !== "undefined") {
    var observer = new MutationObserver(scheduleApply);
    observer.observe(document.documentElement, {childList: true, subtree: true});
  }

  window.setInterval(scheduleApply, 1200);
})();
