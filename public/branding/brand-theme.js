(function () {
  var scheduled = false;

  var applyBranding = function () {
    var logoImage = document.querySelector(
      ".AknHeader-menuBlock[data-drop-zone='mainMenu'] > .AknHeader-menuItemContainer:first-child .AknHeader-logoImage"
    );

    if (logoImage instanceof HTMLImageElement) {
      if (!logoImage.src.endsWith("/branding/brand-logo.png")) {
        logoImage.src = "/branding/brand-logo.png";
      }

      logoImage.alt = "Company logo";
      logoImage.classList.add("BrandShell-sidebarLogoImage");

      var logoItem = logoImage.closest(".AknHeader-menuItem");
      if (logoItem instanceof HTMLElement) {
        logoItem.classList.add("BrandShell-sidebarLogo");
      }
    }

    document.querySelectorAll("header").forEach(function (header) {
      if (!(header instanceof HTMLElement) || header.classList.contains("AknTitleContainer")) {
        return;
      }

      var breadcrumb = header.querySelector("nav[aria-label='Breadcrumb']");
      if (!(breadcrumb instanceof HTMLElement)) {
        return;
      }

      header.classList.add("BrandShell-pageHeader");
      breadcrumb.classList.add("BrandShell-pageHeaderBreadcrumb");

      var titleLine = breadcrumb.parentElement && breadcrumb.parentElement.parentElement
        ? breadcrumb.parentElement.parentElement.children.item(1)
        : null;
      var title = titleLine && titleLine.firstElementChild;

      if (title instanceof HTMLElement) {
        title.classList.add("BrandShell-pageHeaderTitle");
      }
    });
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

  var observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, {childList: true, subtree: true});
})();
