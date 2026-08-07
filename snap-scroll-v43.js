console.log("[Wix Snap Scroll v4.0.3] file executing");

(() => {
  "use strict";

  const VERSION = "Wix Snap Scroll v4.0.3";

  const CONFIG = {
    mobileBreakpoint: 767,

    sections: [
      ["#comp-mrx3f3km", "SPLIT", 2],
      ["#comp-mrx3fuen", "SNAP"],
      ["#comp-mrx3tdvm", "SNAP"],
      ["#comp-mrx3tz9l", "SNAP"],
      ["#comp-msen55me", "SNAP"],
      ["#comp-mrxamcft", "SNAP"],
      ["#comp-msa0j5h2", "SNAP"],
      ["#comp-mrxamx3r", "FREE"],
      ["#comp-msa50934", "SNAP"],
      ["#comp-msa47lnw", "SNAP"]
    ].map(([selector, mode, parts = 1]) => ({
      selector,
      mode,
      parts
    })),

    faqSelector: "#comp-mrxamx3r",

    /*
     * FAST WIX MENU / ANCHOR SCROLL
     *
     * 250 = very fast
     * 350 = fast + smooth
     * 500 = medium
     */
    menuScroll: {
      enabled: true,
      duration: 350,

      /*
       * Use this if a fixed header covers the destination.
       * Example:
       * offset: -80
       */
      offset: 0
    },

    desktop: {
      threshold: 42,
      gestureEndDelay: 220,
      rearmDelay: 140,
      duration: 800,
      navigationSyncDelay: 140,
      directionalTolerance: 24
    },

    mobile: {
      threshold: 30,
      directionRatio: 1.05,
      rearmDelay: 120,
      duration: 650
    },

    faq: {
      dragMultiplier: 1,
      edgeZone: 70,
      edgeResistance: 0.45,
      exitThreshold: 34
    },

    edgeTolerance: 18,

    retryDelay: 400,
    maxRetries: 40,

    badgeDuration: 4000,
    debug: true
  };

  const CLEANUP_KEY =
    "__WIX_SNAP_SCROLL_V403_CLEANUP__";

  const BADGE_ID =
    "__wix-snap-scroll-version-badge__";

  let pageWindow = null;
  let pageDocument = null;

  let snapPoints = [];
  let currentSnapKey = null;

  let retries = 0;
  let breakpointTimer = null;

  const animation = {
    frame: null,
    token: 0
  };

  const desktop = {
    installed: false,
    animating: false,
    movementToken: 0,

    latched: false,
    accumulatedDelta: 0,

    gestureTimer: null,
    rearmTimer: null,
    syncTimer: null
  };

  const mobile = {
    installed: false,
    animating: false,
    movementToken: 0,
    rearmTimer: null,

    tracking: false,
    triggered: false,

    startX: 0,
    startY: 0,

    startedInFaq: false,
    faqDragging: false,
    faqStartScrollTop: 0,
    faqBounds: null
  };

  /*
   * =========================================================
   * BASIC HELPERS
   * =========================================================
   */

  function log(...args) {
    if (CONFIG.debug) {
      console.log(`[${VERSION}]`, ...args);
    }
  }

  function isMobileViewport() {
    return Boolean(
      pageWindow &&
      pageWindow.matchMedia(
        `(max-width: ${CONFIG.mobileBreakpoint}px)`
      ).matches
    );
  }

  function getScrollTop() {
    return (
      pageWindow.scrollY ||
      pageDocument.documentElement.scrollTop ||
      pageDocument.body?.scrollTop ||
      0
    );
  }

  function setScrollTop(top) {
    pageWindow.scrollTo({
      top,
      left: 0,
      behavior: "auto"
    });
  }

  function getViewportHeight() {
    if (
      isMobileViewport() &&
      pageWindow.visualViewport?.height
    ) {
      return pageWindow.visualViewport.height;
    }

    return pageWindow.innerHeight;
  }

  function getElement(selector) {
    try {
      return pageDocument.querySelector(selector);
    } catch {
      return null;
    }
  }

  function getPageTop(element) {
    return (
      element.getBoundingClientRect().top +
      getScrollTop()
    );
  }

  /*
   * =========================================================
   * FIND REAL WIX PAGE DOCUMENT
   * =========================================================
   */

  function findPageDocument() {
    const visited = new Set();

    let bestMatch = null;

    function visit(candidateWindow) {
      if (
        !candidateWindow ||
        visited.has(candidateWindow)
      ) {
        return;
      }

      visited.add(candidateWindow);

      let candidateDocument;

      try {
        candidateDocument =
          candidateWindow.document;
      } catch {
        return;
      }

      const count =
        CONFIG.sections.reduce(
          (total, section) => {
            try {
              return (
                total +
                (
                  candidateDocument.querySelector(
                    section.selector
                  )
                    ? 1
                    : 0
                )
              );
            } catch {
              return total;
            }
          },
          0
        );

      if (
        !bestMatch ||
        count > bestMatch.count
      ) {
        bestMatch = {
          win: candidateWindow,
          doc: candidateDocument,
          count
        };
      }

      try {
        for (
          let index = 0;
          index <
          candidateWindow.frames.length;
          index++
        ) {
          visit(
            candidateWindow.frames[index]
          );
        }
      } catch {
        // Ignore inaccessible frames.
      }
    }

    visit(window);

    try {
      visit(window.top);
    } catch {
      // Ignore inaccessible top window.
    }

    if (
      !bestMatch ||
      bestMatch.count < 2
    ) {
      return false;
    }

    pageWindow = bestMatch.win;
    pageDocument = bestMatch.doc;

    log(
      `Found page document with ${bestMatch.count} configured sections`
    );

    return true;
  }

  /*
   * =========================================================
   * SNAP POINTS
   * =========================================================
   */

  function makeSnapKey(
    section,
    partIndex
  ) {
    return (
      `${section.selector}:` +
      `${section.mode}:` +
      `${partIndex}`
    );
  }

  function buildSnapPoints() {
    const viewportHeight =
      getViewportHeight();

    const points = [];

    CONFIG.sections.forEach(
      (section, configuredIndex) => {
        const element =
          getElement(section.selector);

        if (!element) {
          return;
        }

        const rect =
          element.getBoundingClientRect();

        if (rect.height <= 0) {
          return;
        }

        const top =
          getPageTop(element);

        const height =
          rect.height;

        const numberOfParts =
          section.mode === "SPLIT"
            ? section.parts
            : 1;

        for (
          let partIndex = 0;
          partIndex < numberOfParts;
          partIndex++
        ) {
          let pointTop = top;

          if (section.mode === "SPLIT") {
            if (isMobileViewport()) {
              pointTop =
                top +
                (
                  height /
                  numberOfParts
                ) *
                partIndex;
            } else {
              const requestedTop =
                top +
                viewportHeight *
                partIndex;

              const finalPossibleTop =
                Math.max(
                  top,
                  top +
                  height -
                  viewportHeight
                );

              pointTop =
                Math.min(
                  requestedTop,
                  finalPossibleTop
                );
            }
          }

          points.push({
            key:
              makeSnapKey(
                section,
                partIndex
              ),

            top:
              Math.round(pointTop),

            selector:
              section.selector,

            mode:
              section.mode,

            configuredIndex,
            partIndex
          });
        }
      }
    );

    snapPoints =
      points.sort((a, b) => {
        if (
          a.configuredIndex !==
          b.configuredIndex
        ) {
          return (
            a.configuredIndex -
            b.configuredIndex
          );
        }

        return (
          a.partIndex -
          b.partIndex
        );
      });

    return snapPoints;
  }

  function findClosestSnapIndex(
    position = getScrollTop()
  ) {
    if (!snapPoints.length) {
      return -1;
    }

    let closestIndex = 0;
    let closestDistance = Infinity;

    snapPoints.forEach(
      (point, index) => {
        const distance =
          Math.abs(
            position -
            point.top
          );

        if (
          distance <
          closestDistance
        ) {
          closestDistance =
            distance;

          closestIndex =
            index;
        }
      }
    );

    return closestIndex;
  }

  function getFaqSnapIndex() {
    return snapPoints.findIndex(
      (point) =>
        point.selector ===
        CONFIG.faqSelector
    );
  }

  function findDirectionalSnapIndex(
    direction,
    position = getScrollTop()
  ) {
    if (!snapPoints.length) {
      return -1;
    }

    const tolerance =
      CONFIG.desktop.directionalTolerance;

    if (direction > 0) {
      for (
        let index = 0;
        index < snapPoints.length;
        index++
      ) {
        if (
          snapPoints[index].top >
          position + tolerance
        ) {
          return index;
        }
      }

      return -1;
    }

    for (
      let index =
        snapPoints.length - 1;
      index >= 0;
      index--
    ) {
      if (
        snapPoints[index].top <
        position - tolerance
      ) {
        return index;
      }
    }

    return -1;
  }

  function synchronizeCurrentSnap() {
    buildSnapPoints();

    const faq =
      getFaqState();

    if (faq.active) {
      const faqIndex =
        getFaqSnapIndex();

      if (faqIndex !== -1) {
        currentSnapKey =
          snapPoints[faqIndex].key;

        return faqIndex;
      }
    }

    const closestIndex =
      findClosestSnapIndex();

    if (closestIndex !== -1) {
      currentSnapKey =
        snapPoints[closestIndex].key;
    }

    return closestIndex;
  }

  /*
   * =========================================================
   * FAQ
   * =========================================================
   */

  function getFaqBounds() {
    const faq =
      getElement(CONFIG.faqSelector);

    if (!faq) {
      return null;
    }

    const top =
      getPageTop(faq);

    const height =
      faq.getBoundingClientRect().height;

    const bottom =
      top + height;

    const viewportHeight =
      getViewportHeight();

    const finalScrollTop =
      Math.max(
        top,
        bottom -
        viewportHeight
      );

    return {
      top,
      bottom,
      height,
      finalScrollTop,

      scrollRange:
        Math.max(
          0,
          finalScrollTop -
          top
        )
    };
  }

  function getFaqState(
    position = getScrollTop()
  ) {
    const faq =
      getFaqBounds();

    if (!faq) {
      return {
        faq: null,
        active: false,
        atTop: false,
        atBottom: false
      };
    }

    const viewportHeight =
      getViewportHeight();

    const viewportCenter =
      position +
      viewportHeight / 2;

    const tolerance =
      CONFIG.edgeTolerance;

    const withinScrollRange =
      position >=
        faq.top -
        tolerance &&
      position <=
        faq.finalScrollTop +
        tolerance;

    const centerInside =
      viewportCenter >=
        faq.top &&
      viewportCenter <=
        faq.bottom;

    const active =
      withinScrollRange ||
      centerInside;

    return {
      faq,
      active,

      atTop:
        active &&
        position <=
        faq.top +
        tolerance,

      atBottom:
        active &&
        position >=
        faq.finalScrollTop -
        tolerance
    };
  }

  /*
   * =========================================================
   * VERSION BADGE
   * =========================================================
   */

  function showVersionBadge(mode) {
    if (!pageDocument.body) {
      pageWindow.setTimeout(
        () =>
          showVersionBadge(mode),
        100
      );

      return;
    }

    pageDocument
      .getElementById(BADGE_ID)
      ?.remove();

    const badge =
      pageDocument.createElement("div");

    badge.id =
      BADGE_ID;

    badge.textContent =
      `${VERSION} · ${mode}`;

    Object.assign(
      badge.style,
      {
        position: "fixed",

        top:
          "max(14px, env(safe-area-inset-top))",

        right:
          "max(14px, env(safe-area-inset-right))",

        zIndex:
          "2147483647",

        padding:
          "10px 14px",

        borderRadius:
          "10px",

        background:
          "rgba(17,17,17,.94)",

        color: "#fff",

        fontFamily:
          "Arial, Helvetica, sans-serif",

        fontSize: "13px",

        fontWeight: "700",

        lineHeight: "1.2",

        boxShadow:
          "0 6px 24px rgba(0,0,0,.28)",

        pointerEvents:
          "none",

        opacity: "1",

        transform:
          "translateY(0)",

        transition:
          "opacity 400ms ease, transform 400ms ease"
      }
    );

    pageDocument.body.appendChild(badge);

    pageWindow.setTimeout(() => {
      badge.style.opacity = "0";

      badge.style.transform =
        "translateY(-8px)";

      pageWindow.setTimeout(
        () => badge.remove(),
        450
      );
    }, CONFIG.badgeDuration);
  }

  /*
   * =========================================================
   * ANIMATION
   * =========================================================
   */

  function easing(progress) {
    if (progress < 0.5) {
      return (
        8 *
        Math.pow(progress, 4)
      );
    }

    return (
      1 -
      Math.pow(
        -2 * progress + 2,
        4
      ) /
      2
    );
  }

  function cancelAnimation() {
    if (
      animation.frame !== null
    ) {
      pageWindow.cancelAnimationFrame(
        animation.frame
      );

      animation.frame = null;
    }

    animation.token++;
  }

  function animateTo(
    targetTop,
    duration
  ) {
    cancelAnimation();

    animation.token++;

    const token =
      animation.token;

    const startTop =
      getScrollTop();

    const distance =
      targetTop -
      startTop;

    const startTime =
      pageWindow.performance.now();

    return new Promise(
      (resolve) => {
        function frame(now) {
          if (
            token !==
            animation.token
          ) {
            resolve(false);
            return;
          }

          const progress =
            Math.min(
              (
                now -
                startTime
              ) /
              duration,
              1
            );

          setScrollTop(
            startTop +
            distance *
            easing(progress)
          );

          if (progress < 1) {
            animation.frame =
              pageWindow.requestAnimationFrame(
                frame
              );

            return;
          }

          setScrollTop(targetTop);

          animation.frame = null;

          resolve(true);
        }

        animation.frame =
          pageWindow.requestAnimationFrame(
            frame
          );
      }
    );
  }

  /*
   * =========================================================
   * FAST MENU / ANCHOR NAVIGATION
   * =========================================================
   */

  function escapeCss(value) {
    if (
      pageWindow.CSS?.escape
    ) {
      return pageWindow.CSS.escape(
        value
      );
    }

    return value.replace(
      /["\\#.:()[\],=]/g,
      "\\$&"
    );
  }

  function resolveAnchorTarget(link) {
    if (
      !CONFIG.menuScroll.enabled ||
      !link
    ) {
      return null;
    }

    const href =
      link.getAttribute("href");

    if (
      !href ||
      href === "#" ||
      href.startsWith(
        "javascript:"
      )
    ) {
      return null;
    }

    let url;

    try {
      url = new URL(
        href,
        pageWindow.location.href
      );
    } catch {
      return null;
    }

    /*
     * Only intercept links to the current page.
     */
    const current =
      new URL(
        pageWindow.location.href
      );

    if (
      url.origin !==
      current.origin
    ) {
      return null;
    }

    const normalizedPath =
      (path) =>
        path
          .replace(/\/+$/, "")
          .toLowerCase();

    if (
      normalizedPath(
        url.pathname
      ) !==
      normalizedPath(
        current.pathname
      )
    ) {
      return null;
    }

    if (!url.hash) {
      return null;
    }

    let anchorName;

    try {
      anchorName =
        decodeURIComponent(
          url.hash.slice(1)
        );
    } catch {
      anchorName =
        url.hash.slice(1);
    }

    if (!anchorName) {
      return null;
    }

    const escaped =
      escapeCss(anchorName);

    /*
     * Standard HTML/Wix possibilities.
     */
    let target =
      pageDocument.getElementById(
        anchorName
      );

    if (!target) {
      try {
        target =
          pageDocument.querySelector(
            `[name="${escaped}"]`
          );
      } catch {}
    }

    if (!target) {
      try {
        target =
          pageDocument.querySelector(
            `[data-anchor="${escaped}"]`
          );
      } catch {}
    }

    if (!target) {
      try {
        target =
          pageDocument.querySelector(
            `[data-anchor-name="${escaped}"]`
          );
      } catch {}
    }

    /*
     * If the hash itself is one of our configured component IDs.
     */
    if (!target) {
      const configured =
        CONFIG.sections.find(
          (section) =>
            section.selector ===
            `#${anchorName}`
        );

      if (configured) {
        target =
          getElement(
            configured.selector
          );
      }
    }

    return target;
  }

  function resetSnapEngineForMenuJump() {
    /*
     * Stop any existing snap animation.
     */
    cancelAnimation();

    /*
     * Reset desktop gesture state.
     */
    desktop.movementToken++;
    desktop.animating = false;
    desktop.latched = false;
    desktop.accumulatedDelta = 0;

    pageWindow.clearTimeout(
      desktop.gestureTimer
    );

    pageWindow.clearTimeout(
      desktop.rearmTimer
    );

    pageWindow.clearTimeout(
      desktop.syncTimer
    );

    /*
     * Reset mobile movement state.
     */
    mobile.movementToken++;
    mobile.animating = false;
    mobile.triggered = false;

    pageWindow.clearTimeout(
      mobile.rearmTimer
    );
  }

  async function fastMenuScrollTo(
    target
  ) {
    if (!target) {
      return;
    }

    resetSnapEngineForMenuJump();

    const destination =
      Math.max(
        0,
        getPageTop(target) +
        CONFIG.menuScroll.offset
      );

    log(
      "Fast menu scroll:",
      target,
      `y=${Math.round(destination)}`
    );

    await animateTo(
      destination,
      CONFIG.menuScroll.duration
    );

    /*
     * Rebuild everything after Wix layout settles.
     */
    pageWindow.setTimeout(
      () => {
        buildSnapPoints();

        if (
          isMobileViewport()
        ) {
          const faq =
            getFaqState();

          if (faq.active) {
            const faqIndex =
              getFaqSnapIndex();

            if (faqIndex !== -1) {
              currentSnapKey =
                snapPoints[
                  faqIndex
                ].key;
            }
          } else {
            const closest =
              findClosestSnapIndex();

            if (closest !== -1) {
              currentSnapKey =
                snapPoints[
                  closest
                ].key;
            }
          }
        } else {
          syncDesktopFromPosition(
            "fast menu scroll"
          );
        }
      },
      80
    );
  }

  function onMenuClick(event) {
    /*
     * Normal left-click/tap only.
     */
    if (
      event.defaultPrevented ||
      event.button > 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const link =
      event.target?.closest?.(
        "a[href]"
      );

    if (!link) {
      return;
    }

    if (
      link.target === "_blank"
    ) {
      return;
    }

    const target =
      resolveAnchorTarget(link);

    if (!target) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    /*
     * Keep the URL hash updated.
     */
    try {
      const url =
        new URL(
          link.href,
          pageWindow.location.href
        );

      pageWindow.history.replaceState(
        null,
        "",
        url.hash
      );
    } catch {
      // Not critical.
    }

    fastMenuScrollTo(
      target
    );
  }

  function installMenuNavigation() {
    if (
      !CONFIG.menuScroll.enabled
    ) {
      return;
    }

    pageDocument.addEventListener(
      "click",
      onMenuClick,
      {
        capture: true
      }
    );

    log(
      `Fast menu navigation enabled (${CONFIG.menuScroll.duration}ms)`
    );
  }

  function removeMenuNavigation() {
    if (!pageDocument) {
      return;
    }

    pageDocument.removeEventListener(
      "click",
      onMenuClick,
      {
        capture: true
      }
    );
  }

  /*
   * =========================================================
   * SHARED SCROLL LISTENERS
   * =========================================================
   */

  function addScrollListeners(handler) {
    pageWindow.addEventListener(
      "scroll",
      handler,
      {
        passive: true,
        capture: true
      }
    );

    pageDocument.addEventListener(
      "scroll",
      handler,
      {
        passive: true,
        capture: true
      }
    );

    pageDocument.body?.addEventListener(
      "scroll",
      handler,
      {
        passive: true,
        capture: true
      }
    );
  }

  function removeScrollListeners(handler) {
    pageWindow.removeEventListener(
      "scroll",
      handler,
      {
        capture: true
      }
    );

    pageDocument.removeEventListener(
      "scroll",
      handler,
      {
        capture: true
      }
    );

    pageDocument.body?.removeEventListener(
      "scroll",
      handler,
      {
        capture: true
      }
    );
  }

  /*
   * =========================================================
   * MOBILE
   * =========================================================
   */

  function setControlledTouch(enabled) {
    if (!pageDocument.body) {
      return;
    }

    const elements = [
      pageDocument.body,
      pageDocument.documentElement
    ];

    elements.forEach((element) => {
      if (enabled) {
        element.style.setProperty(
          "touch-action",
          "none",
          "important"
        );

        element.style.setProperty(
          "overscroll-behavior-y",
          "none",
          "important"
        );
      } else {
        element.style.removeProperty(
          "touch-action"
        );

        element.style.removeProperty(
          "overscroll-behavior-y"
        );
      }
    });
  }

  function resetMobileTouch() {
    mobile.tracking = false;
    mobile.triggered = false;

    mobile.startX = 0;
    mobile.startY = 0;

    mobile.startedInFaq = false;
    mobile.faqDragging = false;

    mobile.faqStartScrollTop = 0;
    mobile.faqBounds = null;
  }

  function isProtectedControl(target) {
    try {
      return Boolean(
        target?.closest?.(
          [
            "input",
            "textarea",
            "select",
            "[contenteditable='true']"
          ].join(",")
        )
      );
    } catch {
      return false;
    }
  }

  async function mobileMoveToIndex(index) {
    if (
      mobile.animating ||
      index < 0 ||
      index >= snapPoints.length
    ) {
      resetMobileTouch();
      return;
    }

    const target =
      snapPoints[index];

    mobile.movementToken++;

    const movementToken =
      mobile.movementToken;

    mobile.animating = true;
    mobile.triggered = true;

    try {
      await animateTo(
        target.top,
        CONFIG.mobile.duration
      );

      if (
        movementToken ===
        mobile.movementToken
      ) {
        currentSnapKey =
          target.key;
      }
    } finally {
      if (
        movementToken ===
        mobile.movementToken
      ) {
        mobile.animating = false;

        pageWindow.clearTimeout(
          mobile.rearmTimer
        );

        mobile.rearmTimer =
          pageWindow.setTimeout(
            resetMobileTouch,
            CONFIG.mobile.rearmDelay
          );
      }
    }
  }

  function mobileMoveOneSection(direction) {
    buildSnapPoints();

    const faq =
      getFaqState();

    if (faq.active) {
      mobileMoveToIndex(
        getFaqSnapIndex() +
        direction
      );

      return;
    }

    const targetIndex =
      findDirectionalSnapIndex(
        direction
      );

    if (targetIndex === -1) {
      resetMobileTouch();
      return;
    }

    mobileMoveToIndex(
      targetIndex
    );
  }

  function mobileLeaveFaq(direction) {
    buildSnapPoints();

    mobileMoveToIndex(
      getFaqSnapIndex() +
      direction
    );
  }

  function calculateFaqDragPosition(
    requested,
    bounds
  ) {
    const edgeZone =
      Math.max(
        0,
        Math.min(
          CONFIG.faq.edgeZone,
          bounds.scrollRange / 2
        )
      );

    if (
      requested <=
      bounds.top
    ) {
      return bounds.top;
    }

    if (
      requested >=
      bounds.finalScrollTop
    ) {
      return bounds.finalScrollTop;
    }

    if (
      edgeZone > 0 &&
      requested <
      bounds.top +
      edgeZone
    ) {
      return (
        bounds.top +
        (
          requested -
          bounds.top
        ) *
        CONFIG.faq.edgeResistance
      );
    }

    if (
      edgeZone > 0 &&
      requested >
      bounds.finalScrollTop -
      edgeZone
    ) {
      return (
        bounds.finalScrollTop -
        (
          bounds.finalScrollTop -
          requested
        ) *
        CONFIG.faq.edgeResistance
      );
    }

    return requested;
  }

  function dragFaq(event, deltaY) {
    if (!mobile.faqBounds) {
      mobile.faqBounds =
        getFaqBounds();
    }

    if (!mobile.faqBounds) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    mobile.faqDragging = true;

    const requestedPosition =
      mobile.faqStartScrollTop -
      deltaY *
      CONFIG.faq.dragMultiplier;

    setScrollTop(
      calculateFaqDragPosition(
        requestedPosition,
        mobile.faqBounds
      )
    );

    const direction =
      deltaY < 0
        ? 1
        : -1;

    let overflow = 0;

    if (
      requestedPosition >
      mobile.faqBounds.finalScrollTop
    ) {
      overflow =
        requestedPosition -
        mobile.faqBounds.finalScrollTop;
    } else if (
      requestedPosition <
      mobile.faqBounds.top
    ) {
      overflow =
        mobile.faqBounds.top -
        requestedPosition;
    }

    if (
      overflow <
      CONFIG.faq.exitThreshold
    ) {
      return;
    }

    mobile.triggered = true;

    setScrollTop(
      direction > 0
        ? mobile.faqBounds.finalScrollTop
        : mobile.faqBounds.top
    );

    mobileLeaveFaq(direction);
  }

  function onMobileTouchStart(event) {
    if (
      !mobile.installed ||
      !isMobileViewport() ||
      mobile.animating ||
      event.touches.length !== 1 ||
      isProtectedControl(event.target)
    ) {
      resetMobileTouch();
      return;
    }

    buildSnapPoints();

    const faq =
      getFaqState();

    const touch =
      event.touches[0];

    mobile.tracking = true;
    mobile.triggered = false;

    mobile.startX =
      touch.clientX;

    mobile.startY =
      touch.clientY;

    mobile.startedInFaq =
      faq.active;

    if (faq.active) {
      const faqIndex =
        getFaqSnapIndex();

      if (faqIndex !== -1) {
        currentSnapKey =
          snapPoints[faqIndex].key;
      }

      mobile.faqStartScrollTop =
        getScrollTop();

      mobile.faqBounds =
        faq.faq;
    } else {
      const closestIndex =
        findClosestSnapIndex();

      if (closestIndex !== -1) {
        currentSnapKey =
          snapPoints[closestIndex].key;
      }
    }
  }

  function onMobileTouchMove(event) {
    if (
      !mobile.installed ||
      !mobile.tracking ||
      mobile.triggered ||
      mobile.animating ||
      event.touches.length !== 1
    ) {
      return;
    }

    const touch =
      event.touches[0];

    const deltaX =
      touch.clientX -
      mobile.startX;

    const deltaY =
      touch.clientY -
      mobile.startY;

    const verticalDistance =
      Math.abs(deltaY);

    const horizontalDistance =
      Math.abs(deltaX);

    if (
      verticalDistance <=
      horizontalDistance *
      CONFIG.mobile.directionRatio
    ) {
      return;
    }

    if (mobile.startedInFaq) {
      dragFaq(event, deltaY);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (
      verticalDistance <
      CONFIG.mobile.threshold
    ) {
      return;
    }

    mobile.triggered = true;

    mobileMoveOneSection(
      deltaY < 0
        ? 1
        : -1
    );
  }

  function onMobileTouchEnd() {
    if (
      mobile.faqDragging &&
      !mobile.animating
    ) {
      const faq =
        getFaqState();

      if (
        faq.faq &&
        faq.atTop
      ) {
        setScrollTop(
          faq.faq.top
        );
      } else if (
        faq.faq &&
        faq.atBottom
      ) {
        setScrollTop(
          faq.faq.finalScrollTop
        );
      }
    }

    if (!mobile.animating) {
      resetMobileTouch();
    }
  }

  function onMobileScroll() {
    if (
      !mobile.installed ||
      mobile.animating ||
      mobile.faqDragging
    ) {
      return;
    }

    buildSnapPoints();

    const faq =
      getFaqState();

    if (faq.active) {
      const faqIndex =
        getFaqSnapIndex();

      if (faqIndex !== -1) {
        currentSnapKey =
          snapPoints[faqIndex].key;
      }
    }
  }

  function installMobile() {
    if (mobile.installed) {
      return;
    }

    removeDesktop();

    buildSnapPoints();
    synchronizeCurrentSnap();

    mobile.installed = true;
    mobile.animating = false;

    setControlledTouch(true);

    pageWindow.addEventListener(
      "touchstart",
      onMobileTouchStart,
      {
        passive: false,
        capture: true
      }
    );

    pageWindow.addEventListener(
      "touchmove",
      onMobileTouchMove,
      {
        passive: false,
        capture: true
      }
    );

    pageWindow.addEventListener(
      "touchend",
      onMobileTouchEnd,
      {
        passive: true,
        capture: true
      }
    );

    pageWindow.addEventListener(
      "touchcancel",
      onMobileTouchEnd,
      {
        passive: true,
        capture: true
      }
    );

    addScrollListeners(
      onMobileScroll
    );

    showVersionBadge(
      "mobile + fast menu"
    );

    log("Mobile mode enabled");
  }

  function removeMobile() {
    if (!pageWindow || !pageDocument) {
      return;
    }

    pageWindow.removeEventListener(
      "touchstart",
      onMobileTouchStart,
      {
        capture: true
      }
    );

    pageWindow.removeEventListener(
      "touchmove",
      onMobileTouchMove,
      {
        capture: true
      }
    );

    pageWindow.removeEventListener(
      "touchend",
      onMobileTouchEnd,
      {
        capture: true
      }
    );

    pageWindow.removeEventListener(
      "touchcancel",
      onMobileTouchEnd,
      {
        capture: true
      }
    );

    removeScrollListeners(
      onMobileScroll
    );

    pageWindow.clearTimeout(
      mobile.rearmTimer
    );

    mobile.movementToken++;

    mobile.animating = false;
    mobile.installed = false;

    setControlledTouch(false);
    resetMobileTouch();
  }

  /*
   * =========================================================
   * DESKTOP
   * =========================================================
   */

  function clearDesktopTimers() {
    pageWindow.clearTimeout(
      desktop.gestureTimer
    );

    pageWindow.clearTimeout(
      desktop.rearmTimer
    );

    pageWindow.clearTimeout(
      desktop.syncTimer
    );

    desktop.gestureTimer = null;
    desktop.rearmTimer = null;
    desktop.syncTimer = null;
  }

  function syncDesktopFromPosition(reason) {
    if (
      !desktop.installed ||
      desktop.animating ||
      isMobileViewport()
    ) {
      return;
    }

    buildSnapPoints();

    const faq =
      getFaqState();

    if (faq.active) {
      const faqIndex =
        getFaqSnapIndex();

      if (faqIndex !== -1) {
        const previous =
          currentSnapKey;

        currentSnapKey =
          snapPoints[faqIndex].key;

        if (
          previous !==
          currentSnapKey
        ) {
          log(
            `Desktop resynced to FAQ after ${reason}`
          );
        }
      }

      return;
    }

    const closestIndex =
      findClosestSnapIndex();

    if (closestIndex === -1) {
      return;
    }

    const previous =
      currentSnapKey;

    currentSnapKey =
      snapPoints[closestIndex].key;

    if (
      previous !==
      currentSnapKey
    ) {
      log(
        `Desktop resynced after ${reason}:`,
        previous,
        "→",
        currentSnapKey
      );
    }
  }

  function onDesktopScroll() {
    if (
      !desktop.installed ||
      desktop.animating ||
      isMobileViewport()
    ) {
      return;
    }

    pageWindow.clearTimeout(
      desktop.syncTimer
    );

    desktop.syncTimer =
      pageWindow.setTimeout(
        () => {
          syncDesktopFromPosition(
            "navigation/anchor scroll"
          );
        },
        CONFIG.desktop.navigationSyncDelay
      );
  }

  function rearmDesktop(
    movementToken
  ) {
    pageWindow.clearTimeout(
      desktop.rearmTimer
    );

    desktop.rearmTimer =
      pageWindow.setTimeout(
        () => {
          if (
            movementToken !==
            desktop.movementToken
          ) {
            return;
          }

          desktop.latched = false;
          desktop.accumulatedDelta = 0;
        },
        CONFIG.desktop.rearmDelay
      );
  }

  async function desktopMoveToIndex(index) {
    if (
      desktop.animating ||
      index < 0 ||
      index >= snapPoints.length
    ) {
      desktop.latched = false;
      desktop.accumulatedDelta = 0;
      return;
    }

    clearDesktopTimers();
    buildSnapPoints();

    const target =
      snapPoints[index];

    desktop.movementToken++;

    const movementToken =
      desktop.movementToken;

    desktop.animating = true;
    desktop.latched = true;
    desktop.accumulatedDelta = 0;

    try {
      await animateTo(
        target.top,
        CONFIG.desktop.duration
      );

      if (
        movementToken ===
        desktop.movementToken
      ) {
        currentSnapKey =
          target.key;
      }
    } finally {
      if (
        movementToken ===
        desktop.movementToken
      ) {
        desktop.animating = false;

        rearmDesktop(
          movementToken
        );
      }
    }
  }

  function desktopMoveOneSection(direction) {
    buildSnapPoints();

    const faq =
      getFaqState();

    if (faq.active) {
      desktopMoveToIndex(
        getFaqSnapIndex() +
        direction
      );

      return;
    }

    const targetIndex =
      findDirectionalSnapIndex(
        direction
      );

    if (targetIndex === -1) {
      desktop.latched = false;
      desktop.accumulatedDelta = 0;
      return;
    }

    const closestIndex =
      findClosestSnapIndex();

    if (closestIndex !== -1) {
      currentSnapKey =
        snapPoints[closestIndex].key;
    }

    desktopMoveToIndex(
      targetIndex
    );
  }

  function desktopLeaveFaq(direction) {
    buildSnapPoints();

    const faqIndex =
      getFaqSnapIndex();

    if (faqIndex === -1) {
      desktop.latched = false;
      desktop.accumulatedDelta = 0;
      return;
    }

    desktopMoveToIndex(
      faqIndex +
      direction
    );
  }

  function scheduleDesktopGestureEnd() {
    pageWindow.clearTimeout(
      desktop.gestureTimer
    );

    const movementToken =
      desktop.movementToken;

    desktop.gestureTimer =
      pageWindow.setTimeout(
        () => {
          if (
            desktop.animating ||
            movementToken !==
            desktop.movementToken
          ) {
            return;
          }

          syncDesktopFromPosition(
            "wheel gesture end"
          );

          desktop.latched = false;
          desktop.accumulatedDelta = 0;
        },
        CONFIG.desktop.gestureEndDelay
      );
  }

  function onDesktopWheel(event) {
    if (
      !desktop.installed ||
      isMobileViewport() ||
      !event.deltaY
    ) {
      return;
    }

    if (!desktop.animating) {
      syncDesktopFromPosition(
        "wheel start"
      );
    }

    const direction =
      event.deltaY > 0
        ? 1
        : -1;

    scheduleDesktopGestureEnd();

    const faq =
      getFaqState();

    if (faq.active) {
      const faqIndex =
        getFaqSnapIndex();

      if (faqIndex !== -1) {
        currentSnapKey =
          snapPoints[faqIndex].key;
      }

      const canScrollInsideFaq =
        (
          direction > 0 &&
          !faq.atBottom
        ) ||
        (
          direction < 0 &&
          !faq.atTop
        );

      if (canScrollInsideFaq) {
        desktop.latched = false;
        desktop.accumulatedDelta = 0;
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      if (
        desktop.latched ||
        desktop.animating
      ) {
        return;
      }

      desktop.accumulatedDelta +=
        event.deltaY;

      if (
        Math.abs(
          desktop.accumulatedDelta
        ) <
        CONFIG.desktop.threshold
      ) {
        return;
      }

      desktop.latched = true;
      desktop.accumulatedDelta = 0;

      desktopLeaveFaq(direction);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (
      desktop.latched ||
      desktop.animating
    ) {
      return;
    }

    desktop.accumulatedDelta +=
      event.deltaY;

    if (
      Math.abs(
        desktop.accumulatedDelta
      ) <
      CONFIG.desktop.threshold
    ) {
      return;
    }

    desktop.latched = true;
    desktop.accumulatedDelta = 0;

    desktopMoveOneSection(
      direction
    );
  }

  function onDesktopResize() {
    pageWindow.setTimeout(
      () => {
        syncDesktopFromPosition(
          "resize"
        );
      },
      150
    );
  }

  function installDesktop() {
    if (desktop.installed) {
      return;
    }

    removeMobile();

    buildSnapPoints();

    if (snapPoints.length < 2) {
      return;
    }

    synchronizeCurrentSnap();

    desktop.installed = true;

    pageWindow.addEventListener(
      "wheel",
      onDesktopWheel,
      {
        passive: false,
        capture: true
      }
    );

    addScrollListeners(
      onDesktopScroll
    );

    pageWindow.addEventListener(
      "resize",
      onDesktopResize
    );

    showVersionBadge(
      "desktop + fast menu"
    );

    log("Desktop mode enabled");
  }

  function removeDesktop() {
    if (!pageWindow || !pageDocument) {
      return;
    }

    pageWindow.removeEventListener(
      "wheel",
      onDesktopWheel,
      {
        capture: true
      }
    );

    removeScrollListeners(
      onDesktopScroll
    );

    pageWindow.removeEventListener(
      "resize",
      onDesktopResize
    );

    clearDesktopTimers();

    desktop.movementToken++;

    desktop.animating = false;
    desktop.latched = false;
    desktop.accumulatedDelta = 0;
    desktop.installed = false;
  }

  /*
   * =========================================================
   * MODE MANAGEMENT
   * =========================================================
   */

  function applyCorrectMode() {
    if (isMobileViewport()) {
      installMobile();
    } else {
      installDesktop();
    }
  }

  function onBreakpointChange() {
    pageWindow.clearTimeout(
      breakpointTimer
    );

    breakpointTimer =
      pageWindow.setTimeout(
        () => {
          if (isMobileViewport()) {
            removeDesktop();
            installMobile();
          } else {
            removeMobile();
            installDesktop();
          }
        },
        150
      );
  }

  function cleanup() {
    removeMenuNavigation();

    removeDesktop();
    removeMobile();

    cancelAnimation();

    if (pageWindow) {
      pageWindow.removeEventListener(
        "resize",
        onBreakpointChange
      );

      pageWindow.visualViewport
        ?.removeEventListener(
          "resize",
          onBreakpointChange
        );

      pageWindow.clearTimeout(
        breakpointTimer
      );
    }

    pageDocument
      ?.getElementById(BADGE_ID)
      ?.remove();
  }

  function install() {
    if (
      typeof pageWindow[CLEANUP_KEY] ===
      "function"
    ) {
      pageWindow[CLEANUP_KEY]();
    }

    pageWindow[CLEANUP_KEY] =
      cleanup;

    pageWindow.addEventListener(
      "resize",
      onBreakpointChange
    );

    pageWindow.visualViewport
      ?.addEventListener(
        "resize",
        onBreakpointChange
      );

    installMenuNavigation();

    applyCorrectMode();
  }

  function initialize() {
    retries++;

    if (findPageDocument()) {
      install();
      return;
    }

    if (
      retries <
      CONFIG.maxRetries
    ) {
      window.setTimeout(
        initialize,
        CONFIG.retryDelay
      );
    } else {
      console.error(
        `[${VERSION}] Unable to find configured Wix sections`
      );
    }
  }

  initialize();
})();
