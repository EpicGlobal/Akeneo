(function () {
  var scheduled = false;
  var brandLogoUrl = "/branding/brand-logo.png?v=20260313c";
  var colors = {
    green: "#54af31",
    greenDark: "#3f9722",
    blue: "#1497cf",
    blueDark: "#0e74b9",
    surface: "linear-gradient(180deg, #ffffff 0, #fbfdf9 100%)"
  };

  var setImportant = function (element, property, value) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    element.style.setProperty(property, value, "important");
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
      image.alt = "Company logo";
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

  var brandMainMenu = function () {
    document.querySelectorAll(".AknHeader-menuItem").forEach(function (item) {
      if (!(item instanceof HTMLElement)) {
        return;
      }

      if (item.classList.contains("AknHeader-menuItem--active")) {
        setImportant(item, "color", colors.green);
        setImportant(item, "border-left-color", "#f28b33");
        setImportant(item, "border-left-width", "4px");
        setImportant(item, "padding-right", "4px");
        setImportant(item, "background", "linear-gradient(90deg, rgba(177, 215, 76, 0.16), rgba(177, 215, 76, 0) 88%)");
      }
    });
  };

  var brandVerticalLists = function () {
    document.querySelectorAll(".AknVerticalList-item.active, .AknVerticalList-item--active").forEach(function (item) {
      if (!(item instanceof HTMLElement)) {
        return;
      }

      setImportant(item, "background", "linear-gradient(90deg, rgba(177, 215, 76, 0.18), rgba(177, 215, 76, 0) 72%)");
      setImportant(item, "box-shadow", "inset 3px 0 0 #54af31");

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

        if (node.getAttribute("aria-current") === "page") {
          setImportant(node, "color", "#8ea3aa");
        } else {
          setImportant(node, "color", colors.blue);
        }
      });

      var title = null;

      if (legacyTitle instanceof HTMLElement) {
        title = legacyTitle;
      } else {
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

  var applyBranding = function () {
    brandMenuLogo();
    brandMainMenu();
    brandVerticalLists();
    brandHeaders();
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

  var observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, {childList: true, subtree: true});

  window.setInterval(scheduleApply, 1200);
})();
