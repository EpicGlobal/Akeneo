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
        setImportant(title, "color", colors.greenDark);
      }
    });
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
        title: "Use the shell as a control center, not as the place where the real work begins.",
        summary: "Most teams get lost by editing products before the catalog model is clean. Categories, attributes, and families come first.",
        flow: [
          "Categories organize browsing and merchandising structure.",
          "Attributes define what facts and copy fields exist.",
          "Families decide what each product type must contain.",
          "Products are enriched after the structure is stable.",
          "Channels, locales, and currencies shape downstream output."
        ],
        callout: "If you only remember one path, remember this: categories, attributes, families, products, then channels.",
        steps: [
          {
            title: "Navigate from the left menu",
            body: "Use the menu to move between setup pages, product work, and downstream publishing settings.",
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
        title: "Connections are operational surfaces, not decorative charts.",
        summary: "Use Connect to monitor flows, confirm sync health, and catch integration issues before they become downstream publishing problems.",
        flow: [
          "Monitor the integrations that actually matter to the business.",
          "Review failures and stale flows before they become channel issues.",
          "Treat connection setup as part of operations, not a one-time form."
        ],
        callout: "If a downstream listing or feed looks wrong, start here before blaming product data.",
        steps: [
          {
            title: "Use the connection summary as an operational briefing",
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
        title: "Settings pages define the catalog contract the rest of the workspace depends on.",
        summary: "Categories, attributes, and families are governance decisions. When these pages are weak, every downstream workflow becomes harder.",
        flow: [
          "Fix structure before pushing the team deeper into enrichment.",
          "Keep categories, attributes, and families distinct in purpose.",
          "Use settings changes carefully because they reshape the editor everywhere else."
        ],
        callout: "If the catalog feels inconsistent, the first repair is usually here rather than in the product grid.",
        steps: [
          {
            title: "Treat settings as the model layer",
            body: "These tiles control the structure, rules, and taxonomy that drive the whole workspace.",
            selectors: [".AknDefault-container .view", ".AknDefault-container"]
          }
        ]
      },
      system: {
        id: "system",
        label: "System",
        title: "Use system pages for platform administration, not day-to-day catalog editing.",
        summary: "This area controls users, permissions, and low-level platform settings, so changes here should be deliberate and auditable.",
        flow: [
          "Manage users, groups, and roles carefully.",
          "Use system configuration to support the operating model, not as a shortcut around it.",
          "Keep admin changes intentional because they affect every user."
        ],
        callout: "If an issue only affects one product, do not reach for system settings first.",
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
        title: "Treat product lists as a queue, then open a record for real enrichment.",
        summary: "The list view is for filtering, prioritizing, and finding records. Actual enrichment happens inside the product editor.",
        flow: [
          "Filter by family, completeness, status, or search terms.",
          "Open the exact product or product model you need to improve.",
          "Save meaningful batches of work from the header rather than waiting until the end."
        ],
        callout: "If a product is missing images, copy, or required data, move into the editor instead of staying in the grid.",
        steps: [
          {
            title: "Filter before you edit",
            body: "Use search and filters to narrow work to the exact records you care about.",
            selectors: [".AknFilterBox", "[data-drop-zone='filters']", ".AknGridContainer"]
          },
          {
            title: "Use the grid as a work queue",
            body: "The grid helps you spot problems. Open a record to manage tabs, assets, completeness, and deeper content.",
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
        title: "This is where enrichment actually happens.",
        summary: "The editor splits work into tabs so you can manage attributes, relationships, completeness, and media without losing the structure of the record.",
        flow: [
          "Use the tabs to break the job into smaller sections.",
          "Complete required attributes first so the record is structurally sound.",
          "Use the ResourceSpace DAM tab to link and sync assets.",
          "Save from the header after each solid pass."
        ],
        callout: "If the record has weak media, missing facts, or unclear copy, this is the page where you fix it before publishing.",
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

    if (findResourceSpaceTab() || (/product/.test(route) && /edit/.test(route) && document.querySelector(".AknHorizontalNavtab"))) {
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

  var appendActionItem = function (parent, href, title, body) {
    if (!(parent instanceof HTMLElement)) {
      return;
    }

    var item = createElement("a", "OperatorWorkspaceAction");
    item.href = href;
    item.appendChild(createElement("div", "OperatorWorkspaceAction-title", title));
    item.appendChild(createElement("div", "OperatorWorkspaceAction-body", body));
    parent.appendChild(item);
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
    var workflowList = createElement("ol", "OperatorWorkspaceList");
    var operationsList = createElement("ul", "OperatorWorkspaceList");

    hero.appendChild(createElement("div", "OperatorWorkspaceEyebrow", "Operator workspace"));
    hero.appendChild(createElement("h2", "OperatorWorkspaceTitle", "Run catalog, asset, and marketplace work from one surface."));
    hero.appendChild(createElement(
      "p",
      "OperatorWorkspaceBody",
      "Use this home screen to move from blocked records to approvals, asset rights, and downstream exceptions without hunting through legacy menus."
    ));
    hero.appendChild(createElement("div", "OperatorWorkspaceCallout", focusMessages.join(" ")));

    appendMetricCard(metrics, "Ready records", readyOwners, "good");
    appendMetricCard(metrics, "Blocked records", blockedOwners, blockedOwners > 0 ? "alert" : "");
    appendMetricCard(metrics, "Pending approvals", pendingApprovals, pendingApprovals > 0 ? "warn" : "");
    appendMetricCard(metrics, "Average completeness", averageCompleteness + "%", "");

    appendActionItem(actions, "#/enrich/product/", "Open product work queue", "Move into the enrichment grid and prioritize records that still need copy, facts, or assets.");
    appendActionItem(actions, "#/settings", "Tighten catalog structure", "Review categories, attributes, and families before pushing the team deeper into enrichment.");
    appendActionItem(actions, "#/connect/data-flows", "Review connection health", "Check whether data flows, imports, and downstream handoffs are configured and monitored.");

    workflowColumn.appendChild(createElement("h3", "OperatorWorkspaceColumn-title", "What to do next"));
    appendListItem(workflowList, "Catalog structure", "Start with categories, attributes, and families when the model is still thin or inconsistent.");
    appendListItem(workflowList, "Product enrichment", "Move next into products to improve completeness, approvals, and DAM coverage.");
    appendListItem(workflowList, "Operational readiness", "Finish by checking connection health, rights issues, and downstream exceptions.");
    workflowColumn.appendChild(workflowList);

    operationsColumn.appendChild(createElement("h3", "OperatorWorkspaceColumn-title", "Recent operational signals"));
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

    columns.appendChild(workflowColumn);
    columns.appendChild(operationsColumn);

    shell.appendChild(hero);
    shell.appendChild(metrics);
    shell.appendChild(actions);
    shell.appendChild(columns);
    section.appendChild(shell);

    if (!payload && !workspaceState.dashboardPromise) {
      loadOperatorDashboard(false).then(function () {
        scheduleApply();
      });
    }
  };

  var renderRouteBanner = function () {
    var config = null;

    if (isConnectSurface()) {
      config = {
        kind: "connect",
        title: "Connection operations",
        body: "Use this area to monitor integrations, review sync health, and prove that data is moving cleanly between Operator and downstream systems.",
        action: "#/collect/import/",
        actionLabel: "Review imports and monitored flows"
      };
    } else if (isSettingsSurface()) {
      config = {
        kind: "settings",
        title: "Catalog structure",
        body: "Categories, attributes, and families define the contract the rest of the workspace depends on. Tighten structure here before broad enrichment begins.",
        action: "#/enrich/product/",
        actionLabel: "Return to the product work queue"
      };
    } else if (isSystemSurface()) {
      config = {
        kind: "system",
        title: "Platform administration",
        body: "Use system pages for users, roles, and low-level platform configuration. Treat changes here as operational changes, not casual content edits.",
        action: "#/dashboard",
        actionLabel: "Back to Operator workspace"
      };
    } else if (isProductListSurface()) {
      var productRoot = document.querySelector(".AknDefault-contentWithBottom");
      var emptyText = productRoot instanceof HTMLElement ? (productRoot.textContent || "") : "";

      if (/there is no product for your search/i.test(emptyText)) {
        config = {
          kind: "products",
          title: "No products are visible in this view yet",
          body: "This usually means the catalog was not seeded, the search index is stale, or saved filters are hiding records. The work queue should not look empty in a healthy demo workspace.",
          action: "#/settings",
          actionLabel: "Check structure and seed readiness"
        };
      }
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
    section.appendChild(createElement("h2", "OperatorRouteBanner-title", config.title));
    section.appendChild(createElement("p", "OperatorRouteBanner-body", config.body));

    var action = createElement("a", "OperatorRouteBanner-action", config.actionLabel);
    action.href = config.action;
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

    if (isProductListSurface()) {
      var productRoot = document.querySelector(".AknDefault-contentWithBottom");

      if (productRoot instanceof HTMLElement) {
        replaceMatchedText(
          productRoot,
          "div, p, span, h1, h2, h3",
          /sorry, there is no product for your search\./i,
          "No products are visible in the current catalog view."
        );
        replaceMatchedText(
          productRoot,
          "div, p, span",
          /try again with new search criteria\./i,
          "Clear saved filters, confirm indexing, or reseed the demo catalog to restore the work queue."
        );
      }
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
    syncRouteClasses();
    brandMenuLogo();
    brandMainMenu();
    brandVerticalLists();
    brandHeaders();
    refreshLegacyCopy();
    renderWorkspaceHome();
    renderRouteBanner();
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
