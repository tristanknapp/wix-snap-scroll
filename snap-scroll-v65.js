(() => {
  "use strict";

  

  const CONFIG = {
    mobileBreakpoint: 767,

    allowedPaths: [
      "/home-1"
    ],

    sectionSelector: '[data-testid="section-container"]',

    excludedSections: [
      "#comp-mrx3f3kh_r_comp-kbgajy18"
    ],

    splitSections: {
      "#comp-mrx3f3km": {
        desktop: 2,
        mobile: 2
      }
    },

    freeScrollSections: [
      "#comp-mrxamx3r"
    ],

    faqSelector: "#comp-mrxamx3r",

    splitSectionAfterFaq: {
      enabled: true,
      desktop: 1,
      mobile: 2
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
    routeCheckInterval: 300,
    badgeDuration: 4000,
    debug: true
  };

  const CLEANUP_KEY =
    "__WIX_SNAP_SCROLL_V413_CLEANUP__";

  const BADGE_ID =
    "__wix-snap-scroll-version-badge__";

  let pageWindow = null;
  let pageDocument = null;

  let sections = [];
  let snapPoints = [];
  let currentSnapKey = null;

  let retries = 0;
  let routeTimer = null;
  let lastKnownPath = null;
  let engineActive = false;

  /*
   * Safari toolbar stability.
   *
   * Capture the mobile viewport once and keep using it while the
   * browser toolbar expands/collapses.
   *
   * It is only recalculated after a real orientation / width change.
   */
  let stableMobileViewportHeight = 0;
  let stableMobileViewportWidth = 0;
  let lastMobileOrientation = null;

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
   * LOGGING
   * =========================================================
   */

  function log(...args) {
    if (CONFIG.debug) {
      console.log(
        `[${VERSION}]`,
        ...args
      );
    }
  }

  /*
   * =========================================================
   * ROUTE HELPERS
   * =========================================================
   */

  function normalizePath(path) {
    let cleaned =
      String(path || "/")
        .split("?")[0]
        .split("#")[0]
        .replace(/\/+$/, "")
        .toLowerCase();

    if (!cleaned) {
      cleaned = "/";
    }

    if (!cleaned.startsWith("/")) {
      cleaned =
        "/" + cleaned;
    }

    return cleaned;
  }

  function getCurrentPath() {
    try {
      return normalizePath(
        pageWindow?.location?.pathname ||
        window.location.pathname ||
        "/"
      );
    } catch {
      return normalizePath(
        window.location.pathname ||
        "/"
      );
    }
  }

  function shouldRunOnCurrentPage() {
    const current =
      getCurrentPath();

    return CONFIG.allowedPaths
      .map(normalizePath)
      .includes(current);
  }

  /*
   * =========================================================
   * FIND WIX PAGE DOCUMENT
   * =========================================================
   */

  function getAccessibleDocuments() {
    const results = [];
    const visited = new Set();

    function visit(
      candidateWindow
    ) {
      if (
        !candidateWindow ||
        visited.has(
          candidateWindow
        )
      ) {
        return;
      }

      visited.add(
        candidateWindow
      );

      let candidateDocument;

      try {
        candidateDocument =
          candidateWindow.document;
      } catch {
        return;
      }

      results.push({
        win:
          candidateWindow,

        doc:
          candidateDocument
      });

      try {
        for (
          let index = 0;
          index <
          candidateWindow.frames.length;
          index++
        ) {
          visit(
            candidateWindow.frames[
              index
            ]
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

    return results;
  }

  /*
   * =========================================================
   * MOBILE VIEWPORT STABILITY
   * =========================================================
   */

  function isMobileViewport() {
    return Boolean(
      pageWindow &&
      pageWindow.matchMedia(
        `(max-width: ${CONFIG.mobileBreakpoint}px)`
      ).matches
    );
  }

  function getCurrentOrientation() {
    if (!pageWindow) {
      return null;
    }

    const width =
      pageWindow.innerWidth ||
      0;

    const height =
      pageWindow.innerHeight ||
      0;

    return width >= height
      ? "landscape"
      : "portrait";
  }

  function captureStableMobileViewport(
    force = false
  ) {
    if (
      !pageWindow ||
      !isMobileViewport()
    ) {
      return;
    }

    const width =
      pageWindow.innerWidth ||
      0;

    const height =
      pageWindow.innerHeight ||
      0;

    const orientation =
      getCurrentOrientation();

    const widthChanged =
      Math.abs(
        width -
        stableMobileViewportWidth
      ) > 40;

    const orientationChanged =
      lastMobileOrientation &&
      orientation !==
      lastMobileOrientation;

    if (
      force ||
      !stableMobileViewportHeight ||
      widthChanged ||
      orientationChanged
    ) {
      stableMobileViewportHeight =
        height;

      stableMobileViewportWidth =
        width;

      lastMobileOrientation =
        orientation;

      log(
        "Captured stable mobile viewport:",
        `${Math.round(
          stableMobileViewportWidth
        )}x${Math.round(
          stableMobileViewportHeight
        )}`,
        orientation
      );
    }
  }

  function clearStableMobileViewport() {
    stableMobileViewportHeight =
      0;

    stableMobileViewportWidth =
      0;

    lastMobileOrientation =
      null;
  }

  /*
   * =========================================================
   * BASIC PAGE HELPERS
   * =========================================================
   */

  function getScrollTop() {
    if (
      !pageWindow ||
      !pageDocument
    ) {
      return 0;
    }

    return (
      pageWindow.scrollY ||
      pageDocument
        .documentElement
        .scrollTop ||
      pageDocument.body
        ?.scrollTop ||
      0
    );
  }

  function setScrollTop(top) {
    if (!pageWindow) {
      return;
    }

    pageWindow.scrollTo({
      top,
      left: 0,
      behavior: "auto"
    });
  }

  function getViewportHeight() {
    /*
     * Important:
     *
     * On mobile we deliberately do NOT use visualViewport.height.
     *
     * Safari changes that when the toolbar hides/shows.
     * The snap geometry instead stays locked to the stable
     * viewport height captured at initialization.
     */
    if (
      isMobileViewport() &&
      stableMobileViewportHeight >
      0
    ) {
      return (
        stableMobileViewportHeight
      );
    }

    return (
      pageWindow?.innerHeight ||
      window.innerHeight ||
      0
    );
  }

  function getPageTop(element) {
    return (
      element
        .getBoundingClientRect()
        .top +
      getScrollTop()
    );
  }

  function selectorMatchesElement(
    element,
    selector
  ) {
    try {
      return element.matches(
        selector
      );
    } catch {
      return false;
    }
  }

  /*
   * =========================================================
   * AUTOMATIC SECTION DISCOVERY
   * =========================================================
   */

  function isExcludedSection(
    element
  ) {
    return (
      CONFIG.excludedSections
        .some(
          (selector) =>
            selectorMatchesElement(
              element,
              selector
            )
        )
    );
  }

  function getResponsiveParts(
    config
  ) {
    if (
      typeof config ===
      "number"
    ) {
      return Math.max(
        1,
        config
      );
    }

    if (
      !config ||
      typeof config !==
      "object"
    ) {
      return 1;
    }

    const value =
      isMobileViewport()
        ? config.mobile
        : config.desktop;

    return Math.max(
      1,
      Number(value) || 1
    );
  }

  function getExplicitSectionMode(
    element
  ) {
    /*
     * Explicit split sections.
     */
    for (
      const [
        selector,
        splitConfig
      ] of Object.entries(
        CONFIG.splitSections
      )
    ) {
      if (
        selectorMatchesElement(
          element,
          selector
        )
      ) {
        const parts =
          getResponsiveParts(
            splitConfig
          );

        return parts > 1
          ? {
              mode: "SPLIT",
              parts
            }
          : {
              mode: "SNAP",
              parts: 1
            };
      }
    }

    /*
     * Free-scroll sections.
     */
    if (
      CONFIG.freeScrollSections
        .some(
          (selector) =>
            selectorMatchesElement(
              element,
              selector
            )
        )
    ) {
      return {
        mode: "FREE",
        parts: 1
      };
    }

    return null;
  }

  function discoverSections(
    doc = pageDocument
  ) {
    if (!doc) {
      return [];
    }

    let found = [];

    try {
      found =
        Array.from(
          doc.querySelectorAll(
            CONFIG.sectionSelector
          )
        );
    } catch {
      return [];
    }

    const seen =
      new Set();

    const usable =
      found.filter(
        (element) => {
          if (
            !element ||
            seen.has(element)
          ) {
            return false;
          }

          seen.add(element);

          if (
            isExcludedSection(
              element
            )
          ) {
            return false;
          }

          return (
            element
              .getBoundingClientRect()
              .height >
            0
          );
        }
      );

    const faqIndex =
      usable.findIndex(
        (element) =>
          selectorMatchesElement(
            element,
            CONFIG.faqSelector
          )
      );

    const sectionAfterFaqIndex =
      faqIndex >= 0
        ? faqIndex + 1
        : -1;

    return usable.map(
      (
        element,
        index
      ) => {
        let special =
          getExplicitSectionMode(
            element
          );

        /*
         * Section directly after FAQ:
         *
         * Desktop = normal
         * Mobile = split in two
         */
        if (
          !special &&
          CONFIG
            .splitSectionAfterFaq
            .enabled &&
          index ===
            sectionAfterFaqIndex
        ) {
          const parts =
            getResponsiveParts(
              CONFIG
                .splitSectionAfterFaq
            );

          special =
            parts > 1
              ? {
                  mode: "SPLIT",
                  parts
                }
              : {
                  mode: "SNAP",
                  parts: 1
                };
        }

        /*
         * Everything else.
         */
        if (!special) {
          special = {
            mode: "SNAP",
            parts: 1
          };
        }

        return {
          element,

          selector:
            element.id
              ? `#${element.id}`
              : null,

          mode:
            special.mode,

          parts:
            special.parts,

          discoveredIndex:
            index,

          isAfterFaq:
            index ===
            sectionAfterFaqIndex
        };
      }
    );
  }

  function findPageDocument() {
    let bestMatch =
      null;

    getAccessibleDocuments()
      .forEach(
        ({
          win,
          doc
        }) => {
          const discovered =
            discoverSections(
              doc
            );

          if (
            !bestMatch ||
            discovered.length >
              bestMatch.count
          ) {
            bestMatch = {
              win,
              doc,

              count:
                discovered.length
            };
          }
        }
      );

    if (
      !bestMatch ||
      bestMatch.count < 2
    ) {
      return false;
    }

    pageWindow =
      bestMatch.win;

    pageDocument =
      bestMatch.doc;

    sections =
      discoverSections(
        pageDocument
      );

    log(
      `Found ${sections.length} auto-discovered sections`
    );

    return true;
  }

  /*
   * =========================================================
   * SNAP POINT BUILDING
   * =========================================================
   */

  function makeSnapKey(
    section,
    partIndex
  ) {
    const identity =
      section.selector ||
      `auto-${section.discoveredIndex}`;

    return (
      `${identity}:` +
      `${section.mode}:` +
      `${partIndex}`
    );
  }

  function buildSnapPoints() {
    if (
      !pageDocument ||
      !engineActive
    ) {
      snapPoints = [];

      return snapPoints;
    }

    sections =
      discoverSections(
        pageDocument
      );

    const viewportHeight =
      getViewportHeight();

    const points = [];

    sections.forEach(
      (
        section,
        configuredIndex
      ) => {
        const element =
          section.element;

        const rect =
          element
            .getBoundingClientRect();

        if (
          rect.height <= 0
        ) {
          return;
        }

        const top =
          getPageTop(
            element
          );

        const height =
          rect.height;

        const numberOfParts =
          section.mode ===
          "SPLIT"
            ? section.parts
            : 1;

        for (
          let partIndex = 0;
          partIndex <
            numberOfParts;
          partIndex++
        ) {
          let pointTop =
            top;

          if (
            section.mode ===
            "SPLIT"
          ) {
            if (
              isMobileViewport()
            ) {
              /*
               * Mobile split sections use their actual rendered
               * section height.
               */
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
              Math.round(
                pointTop
              ),

            element,

            selector:
              section.selector,

            mode:
              section.mode,

            configuredIndex,

            partIndex,

            isAfterFaq:
              section.isAfterFaq
          });
        }
      }
    );

    snapPoints =
      points.sort(
        (
          a,
          b
        ) => {
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
        }
      );

    return snapPoints;
  }

  /*
   * =========================================================
   * FAQ HELPERS
   * =========================================================
   */

  function getFaqElement() {
    if (!pageDocument) {
      return null;
    }

    try {
      return (
        pageDocument.querySelector(
          CONFIG.faqSelector
        )
      );
    } catch {
      return null;
    }
  }

  function getFaqSnapIndex() {
    const faqElement =
      getFaqElement();

    if (!faqElement) {
      return -1;
    }

    return (
      snapPoints.findIndex(
        (point) =>
          point.element ===
          faqElement
      )
    );
  }

  function getFaqBounds() {
    const faq =
      getFaqElement();

    if (!faq) {
      return null;
    }

    const top =
      getPageTop(
        faq
      );

    const height =
      faq
        .getBoundingClientRect()
        .height;

    const bottom =
      top +
      height;

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
    position =
      getScrollTop()
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
   * SNAP SEARCH
   * =========================================================
   */

  function findClosestSnapIndex(
    position =
      getScrollTop()
  ) {
    if (
      !snapPoints.length
    ) {
      return -1;
    }

    let closestIndex =
      0;

    let closestDistance =
      Infinity;

    snapPoints.forEach(
      (
        point,
        index
      ) => {
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

  function findDirectionalSnapIndex(
    direction,
    position =
      getScrollTop()
  ) {
    if (
      !snapPoints.length
    ) {
      return -1;
    }

    const tolerance =
      CONFIG.desktop
        .directionalTolerance;

    if (
      direction > 0
    ) {
      for (
        let index = 0;
        index <
          snapPoints.length;
        index++
      ) {
        if (
          snapPoints[index]
            .top >
          position +
            tolerance
        ) {
          return index;
        }
      }

      return -1;
    }

    for (
      let index =
        snapPoints.length -
        1;
      index >= 0;
      index--
    ) {
      if (
        snapPoints[index]
          .top <
        position -
          tolerance
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

    if (
      faq.active
    ) {
      const faqIndex =
        getFaqSnapIndex();

      if (
        faqIndex !== -1
      ) {
        currentSnapKey =
          snapPoints[
            faqIndex
          ].key;

        return faqIndex;
      }
    }

    const closestIndex =
      findClosestSnapIndex();

    if (
      closestIndex !== -1
    ) {
      currentSnapKey =
        snapPoints[
          closestIndex
        ].key;
    }

    return closestIndex;
  }

  /*
   * =========================================================
   * VERSION BADGE
   * =========================================================
   */

  function showVersionBadge(
    mode
  ) {
    if (
      !pageDocument?.body
    ) {
      return;
    }

    pageDocument
      .getElementById(
        BADGE_ID
      )
      ?.remove();

    const badge =
      pageDocument.createElement(
        "div"
      );

    badge.id =
      BADGE_ID;

    badge.textContent =
      `${VERSION} · ${mode}`;

    Object.assign(
      badge.style,
      {
        position:
          "fixed",

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

        color:
          "#fff",

        fontFamily:
          "Arial, Helvetica, sans-serif",

        fontSize:
          "13px",

        fontWeight:
          "700",

        lineHeight:
          "1.2",

        boxShadow:
          "0 6px 24px rgba(0,0,0,.28)",

        pointerEvents:
          "none",

        opacity:
          "1",

        transform:
          "translateY(0)",

        transition:
          "opacity 400ms ease, transform 400ms ease"
      }
    );

    pageDocument.body
      .appendChild(
        badge
      );

    pageWindow.setTimeout(
      () => {
        badge.style.opacity =
          "0";

        badge.style.transform =
          "translateY(-8px)";

        pageWindow.setTimeout(
          () =>
            badge.remove(),
          450
        );
      },

      CONFIG.badgeDuration
    );
  }

  /*
   * =========================================================
   * SCROLL ANIMATION
   * =========================================================
   */

  function easing(
    progress
  ) {
    if (
      progress < 0.5
    ) {
      return (
        8 *
        Math.pow(
          progress,
          4
        )
      );
    }

    return (
      1 -
      Math.pow(
        -2 *
          progress +
          2,
        4
      ) /
        2
    );
  }

  function cancelAnimation() {
    if (!pageWindow) {
      return;
    }

    if (
      animation.frame !==
      null
    ) {
      pageWindow
        .cancelAnimationFrame(
          animation.frame
        );

      animation.frame =
        null;
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
      pageWindow
        .performance
        .now();

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
              easing(
                progress
              )
          );

          if (
            progress < 1
          ) {
            animation.frame =
              pageWindow
                .requestAnimationFrame(
                  frame
                );

            return;
          }

          setScrollTop(
            targetTop
          );

          animation.frame =
            null;

          resolve(true);
        }

        animation.frame =
          pageWindow
            .requestAnimationFrame(
              frame
            );
      }
    );
  }

  /*
   * =========================================================
   * SHARED SCROLL LISTENERS
   * =========================================================
   */

  function addScrollListeners(
    handler
  ) {
    pageWindow
      .addEventListener(
        "scroll",
        handler,
        {
          passive: true,
          capture: true
        }
      );

    pageDocument
      .addEventListener(
        "scroll",
        handler,
        {
          passive: true,
          capture: true
        }
      );

    pageDocument.body
      ?.addEventListener(
        "scroll",
        handler,
        {
          passive: true,
          capture: true
        }
      );
  }

  function removeScrollListeners(
    handler
  ) {
    if (
      !pageWindow ||
      !pageDocument
    ) {
      return;
    }

    pageWindow
      .removeEventListener(
        "scroll",
        handler,
        {
          capture: true
        }
      );

    pageDocument
      .removeEventListener(
        "scroll",
        handler,
        {
          capture: true
        }
      );

    pageDocument.body
      ?.removeEventListener(
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

  function setControlledTouch(
    enabled
  ) {
    if (
      !pageDocument?.body
    ) {
      return;
    }

    [
      pageDocument.body,
      pageDocument
        .documentElement
    ].forEach(
      (element) => {

        if (enabled) {
          element.style
            .setProperty(
              "touch-action",
              "none",
              "important"
            );

          element.style
            .setProperty(
              "overscroll-behavior-y",
              "none",
              "important"
            );
        } else {
          element.style
            .removeProperty(
              "touch-action"
            );

          element.style
            .removeProperty(
              "overscroll-behavior-y"
            );
        }
      }
    );
  }

  function resetMobileTouch() {
    mobile.tracking =
      false;

    mobile.triggered =
      false;

    mobile.startX =
      0;

    mobile.startY =
      0;

    mobile.startedInFaq =
      false;

    mobile.faqDragging =
      false;

    mobile.faqStartScrollTop =
      0;

    mobile.faqBounds =
      null;
  }

  function isProtectedControl(
    target
  ) {
    try {
      return Boolean(
        target?.closest?.(
          "input,textarea,select,[contenteditable='true']"
        )
      );
    } catch {
      return false;
    }
  }

  async function mobileMoveToIndex(
    index
  ) {
    if (
      mobile.animating ||
      index < 0 ||
      index >=
        snapPoints.length
    ) {
      resetMobileTouch();

      return;
    }

    const target =
      snapPoints[
        index
      ];

    mobile.movementToken++;

    const movementToken =
      mobile.movementToken;

    mobile.animating =
      true;

    mobile.triggered =
      true;

    try {
      await animateTo(
        target.top,

        CONFIG.mobile
          .duration
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
        mobile.animating =
          false;

        pageWindow.clearTimeout(
          mobile.rearmTimer
        );

        mobile.rearmTimer =
          pageWindow.setTimeout(
            resetMobileTouch,

            CONFIG.mobile
              .rearmDelay
          );
      }
    }
  }

  function mobileMoveOneSection(
    direction
  ) {
    buildSnapPoints();

    const faq =
      getFaqState();

    if (
      faq.active
    ) {
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

    if (
      targetIndex === -1
    ) {
      resetMobileTouch();

      return;
    }

    mobileMoveToIndex(
      targetIndex
    );
  }

  function mobileLeaveFaq(
    direction
  ) {
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
          CONFIG.faq
            .edgeZone,

          bounds.scrollRange /
            2
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
      return (
        bounds.finalScrollTop
      );
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
        CONFIG.faq
          .edgeResistance
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
        CONFIG.faq
          .edgeResistance
      );
    }

    return requested;
  }

  function dragFaq(
    event,
    deltaY
  ) {
    if (
      !mobile.faqBounds
    ) {
      mobile.faqBounds =
        getFaqBounds();
    }

    if (
      !mobile.faqBounds
    ) {
      return;
    }

    event.preventDefault();

    event.stopImmediatePropagation();

    mobile.faqDragging =
      true;

    const requestedPosition =
      mobile.faqStartScrollTop -
      deltaY *
      CONFIG.faq
        .dragMultiplier;

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

    let overflow =
      0;

    if (
      requestedPosition >
      mobile.faqBounds
        .finalScrollTop
    ) {
      overflow =
        requestedPosition -
        mobile.faqBounds
          .finalScrollTop;

    } else if (
      requestedPosition <
      mobile.faqBounds
        .top
    ) {
      overflow =
        mobile.faqBounds
          .top -
        requestedPosition;
    }

    if (
      overflow <
      CONFIG.faq
        .exitThreshold
    ) {
      return;
    }

    mobile.triggered =
      true;

    setScrollTop(
      direction > 0
        ? mobile.faqBounds
            .finalScrollTop

        : mobile.faqBounds
            .top
    );

    mobileLeaveFaq(
      direction
    );
  }

  function onMobileTouchStart(
    event
  ) {
    if (
      !engineActive ||
      !mobile.installed ||
      !isMobileViewport() ||
      mobile.animating ||
      event.touches.length !==
        1 ||
      isProtectedControl(
        event.target
      )
    ) {
      resetMobileTouch();

      return;
    }

    buildSnapPoints();

    const faq =
      getFaqState();

    const touch =
      event.touches[0];

    mobile.tracking =
      true;

    mobile.triggered =
      false;

    mobile.startX =
      touch.clientX;

    mobile.startY =
      touch.clientY;

    mobile.startedInFaq =
      faq.active;

    if (
      faq.active
    ) {
      const faqIndex =
        getFaqSnapIndex();

      if (
        faqIndex !== -1
      ) {
        currentSnapKey =
          snapPoints[
            faqIndex
          ].key;
      }

      mobile.faqStartScrollTop =
        getScrollTop();

      mobile.faqBounds =
        faq.faq;

    } else {
      const closestIndex =
        findClosestSnapIndex();

      if (
        closestIndex !== -1
      ) {
        currentSnapKey =
          snapPoints[
            closestIndex
          ].key;
      }
    }
  }

  function onMobileTouchMove(
    event
  ) {
    if (
      !engineActive ||
      !mobile.installed ||
      !mobile.tracking ||
      mobile.triggered ||
      mobile.animating ||
      event.touches.length !==
        1
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
      Math.abs(
        deltaY
      );

    const horizontalDistance =
      Math.abs(
        deltaX
      );

    if (
      verticalDistance <=
      horizontalDistance *
      CONFIG.mobile
        .directionRatio
    ) {
      return;
    }

    if (
      mobile.startedInFaq
    ) {
      dragFaq(
        event,
        deltaY
      );

      return;
    }

    event.preventDefault();

    event.stopImmediatePropagation();

    if (
      verticalDistance <
      CONFIG.mobile
        .threshold
    ) {
      return;
    }

    mobile.triggered =
      true;

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
          faq.faq
            .finalScrollTop
        );
      }
    }

    if (
      !mobile.animating
    ) {
      resetMobileTouch();
    }
  }

  function onMobileScroll() {
    if (
      !engineActive ||
      !mobile.installed ||
      mobile.animating ||
      mobile.faqDragging
    ) {
      return;
    }

    buildSnapPoints();

    const faq =
      getFaqState();

    if (
      faq.active
    ) {
      const faqIndex =
        getFaqSnapIndex();

      if (
        faqIndex !== -1
      ) {
        currentSnapKey =
          snapPoints[
            faqIndex
          ].key;
      }
    }
  }

  /*
   * Only a genuine orientation change recaptures the mobile
   * viewport height.
   */
  function onMobileOrientationChange() {
    if (
      !engineActive ||
      !mobile.installed
    ) {
      return;
    }

    pageWindow.setTimeout(
      () => {
        captureStableMobileViewport(
          true
        );

        buildSnapPoints();

        synchronizeCurrentSnap();

        log(
          "Stable viewport recaptured after orientation change"
        );
      },

      250
    );
  }

  function installMobile() {
    if (
      mobile.installed ||
      !engineActive
    ) {
      return;
    }

    removeDesktop();

    /*
     * Capture the Safari-visible viewport once.
     */
    captureStableMobileViewport(
      true
    );

    buildSnapPoints();

    synchronizeCurrentSnap();

    mobile.installed =
      true;

    mobile.animating =
      false;

    setControlledTouch(
      true
    );

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

    pageWindow.addEventListener(
      "orientationchange",
      onMobileOrientationChange,
      {
        passive: true
      }
    );

    addScrollListeners(
      onMobileScroll
    );

    showVersionBadge(
      "mobile stable viewport"
    );

    log(
      "Mobile snap mode enabled with stable viewport height:",
      Math.round(
        stableMobileViewportHeight
      )
    );
  }

  function removeMobile() {
    if (
      !pageWindow ||
      !pageDocument
    ) {
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

    pageWindow.removeEventListener(
      "orientationchange",
      onMobileOrientationChange
    );

    removeScrollListeners(
      onMobileScroll
    );

    pageWindow.clearTimeout(
      mobile.rearmTimer
    );

    mobile.movementToken++;

    mobile.animating =
      false;

    mobile.installed =
      false;

    setControlledTouch(
      false
    );

    resetMobileTouch();
  }

  /*
   * =========================================================
   * DESKTOP
   * =========================================================
   */

  function clearDesktopTimers() {
    if (!pageWindow) {
      return;
    }

    pageWindow.clearTimeout(
      desktop.gestureTimer
    );

    pageWindow.clearTimeout(
      desktop.rearmTimer
    );

    pageWindow.clearTimeout(
      desktop.syncTimer
    );

    desktop.gestureTimer =
      null;

    desktop.rearmTimer =
      null;

    desktop.syncTimer =
      null;
  }

  function syncDesktopFromPosition(
    reason
  ) {
    if (
      !engineActive ||
      !desktop.installed ||
      desktop.animating ||
      isMobileViewport()
    ) {
      return;
    }

    buildSnapPoints();

    const faq =
      getFaqState();

    if (
      faq.active
    ) {
      const faqIndex =
        getFaqSnapIndex();

      if (
        faqIndex !== -1
      ) {
        currentSnapKey =
          snapPoints[
            faqIndex
          ].key;
      }

      return;
    }

    const closestIndex =
      findClosestSnapIndex();

    if (
      closestIndex === -1
    ) {
      return;
    }

    currentSnapKey =
      snapPoints[
        closestIndex
      ].key;

    log(
      `Desktop resynced after ${reason}:`,
      currentSnapKey
    );
  }

  function onDesktopScroll() {
    if (
      !engineActive ||
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

        CONFIG.desktop
          .navigationSyncDelay
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

          desktop.latched =
            false;

          desktop.accumulatedDelta =
            0;
        },

        CONFIG.desktop
          .rearmDelay
      );
  }

  async function desktopMoveToIndex(
    index
  ) {
    if (
      !engineActive ||
      desktop.animating ||
      index < 0 ||
      index >=
        snapPoints.length
    ) {
      desktop.latched =
        false;

      desktop.accumulatedDelta =
        0;

      return;
    }

    clearDesktopTimers();

    buildSnapPoints();

    const target =
      snapPoints[
        index
      ];

    desktop.movementToken++;

    const movementToken =
      desktop.movementToken;

    desktop.animating =
      true;

    desktop.latched =
      true;

    desktop.accumulatedDelta =
      0;

    try {
      await animateTo(
        target.top,

        CONFIG.desktop
          .duration
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
        desktop.animating =
          false;

        rearmDesktop(
          movementToken
        );
      }
    }
  }

  function desktopMoveOneSection(
    direction
  ) {
    buildSnapPoints();

    const faq =
      getFaqState();

    if (
      faq.active
    ) {
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

    if (
      targetIndex === -1
    ) {
      desktop.latched =
        false;

      desktop.accumulatedDelta =
        0;

      return;
    }

    const closestIndex =
      findClosestSnapIndex();

    if (
      closestIndex !== -1
    ) {
      currentSnapKey =
        snapPoints[
          closestIndex
        ].key;
    }

    desktopMoveToIndex(
      targetIndex
    );
  }

  function desktopLeaveFaq(
    direction
  ) {
    buildSnapPoints();

    const faqIndex =
      getFaqSnapIndex();

    if (
      faqIndex === -1
    ) {
      desktop.latched =
        false;

      desktop.accumulatedDelta =
        0;

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

          desktop.latched =
            false;

          desktop.accumulatedDelta =
            0;
        },

        CONFIG.desktop
          .gestureEndDelay
      );
  }

  function onDesktopWheel(
    event
  ) {
    if (
      !engineActive ||
      !desktop.installed ||
      isMobileViewport() ||
      !event.deltaY
    ) {
      return;
    }

    if (
      !desktop.animating
    ) {
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

    if (
      faq.active
    ) {
      const faqIndex =
        getFaqSnapIndex();

      if (
        faqIndex !== -1
      ) {
        currentSnapKey =
          snapPoints[
            faqIndex
          ].key;
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

      if (
        canScrollInsideFaq
      ) {
        desktop.latched =
          false;

        desktop.accumulatedDelta =
          0;

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
        CONFIG.desktop
          .threshold
      ) {
        return;
      }

      desktop.latched =
        true;

      desktop.accumulatedDelta =
        0;

      desktopLeaveFaq(
        direction
      );

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
      CONFIG.desktop
        .threshold
    ) {
      return;
    }

    desktop.latched =
      true;

    desktop.accumulatedDelta =
      0;

    desktopMoveOneSection(
      direction
    );
  }

  function installDesktop() {
    if (
      desktop.installed ||
      !engineActive
    ) {
      return;
    }

    removeMobile();

    clearStableMobileViewport();

    buildSnapPoints();

    if (
      snapPoints.length < 2
    ) {
      return;
    }

    synchronizeCurrentSnap();

    desktop.installed =
      true;

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

    showVersionBadge(
      "desktop /home-1"
    );

    log(
      "Desktop snap mode enabled"
    );
  }

  function removeDesktop() {
    if (
      !pageWindow ||
      !pageDocument
    ) {
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

    clearDesktopTimers();

    desktop.movementToken++;

    desktop.animating =
      false;

    desktop.latched =
      false;

    desktop.accumulatedDelta =
      0;

    desktop.installed =
      false;
  }

  /*
   * =========================================================
   * MODE MANAGEMENT
   * =========================================================
   */

  function applyCorrectMode() {
    if (!engineActive) {
      return;
    }

    if (
      isMobileViewport()
    ) {
      installMobile();
    } else {
      installDesktop();
    }
  }

  /*
   * Important Safari change:
   *
   * We do NOT listen to visualViewport.resize anymore.
   *
   * Safari toolbar collapse can repeatedly change viewport
   * height while the user scrolls.
   *
   * We only care if the page really crosses the mobile/desktop
   * breakpoint, or if the width changes significantly.
   */
  function onWindowResize() {
    if (
      !engineActive ||
      !pageWindow
    ) {
      return;
    }

    const nowMobile =
      isMobileViewport();

    /*
     * Actual breakpoint crossing.
     */
    if (
      nowMobile &&
      !mobile.installed
    ) {
      removeDesktop();

      installMobile();

      return;
    }

    if (
      !nowMobile &&
      !desktop.installed
    ) {
      removeMobile();

      installDesktop();

      return;
    }

    /*
     * On mobile, ignore height-only changes.
     *
     * Safari toolbar disappearance normally changes the viewport
     * height but not the device width.
     */
    if (
      nowMobile &&
      mobile.installed
    ) {
      const currentWidth =
        pageWindow.innerWidth ||
        0;

      if (
        Math.abs(
          currentWidth -
          stableMobileViewportWidth
        ) > 40
      ) {
        captureStableMobileViewport(
          true
        );

        buildSnapPoints();
      }
    }
  }

  /*
   * =========================================================
   * ENGINE INSTALL / CLEANUP
   * =========================================================
   */

  function cleanupEngine() {
    removeDesktop();

    removeMobile();

    cancelAnimation();

    currentSnapKey =
      null;

    snapPoints =
      [];

    sections =
      [];

    clearStableMobileViewport();

    if (
      pageWindow
    ) {
      pageWindow.removeEventListener(
        "resize",
        onWindowResize
      );
    }

    pageDocument
      ?.getElementById(
        BADGE_ID
      )
      ?.remove();

    setControlledTouch(
      false
    );
  }

  function installEngine() {
    if (
      !engineActive ||
      !pageWindow ||
      !pageDocument
    ) {
      return;
    }

    if (
      typeof pageWindow[
        CLEANUP_KEY
      ] ===
      "function"
    ) {
      pageWindow[
        CLEANUP_KEY
      ]();
    }

    pageWindow[
      CLEANUP_KEY
    ] =
      cleanupEngine;

    pageWindow.addEventListener(
      "resize",
      onWindowResize,
      {
        passive: true
      }
    );

    applyCorrectMode();

    log(
      "Snap engine installed on",
      getCurrentPath()
    );
  }

  /*
   * =========================================================
   * ROUTE ACTIVATION
   * =========================================================
   */

  function updatePageActivation(
    reason = "route check"
  ) {
    const currentPath =
      getCurrentPath();

    const shouldRun =
      shouldRunOnCurrentPage();

    log(
      reason,
      currentPath,
      shouldRun
        ? "ENABLED"
        : "DISABLED"
    );

    if (!shouldRun) {
      if (
        engineActive
      ) {
        engineActive =
          false;

        cleanupEngine();

        log(
          "Snap scroll disabled on",
          currentPath
        );
      }

      return;
    }

    if (
      engineActive
    ) {
      return;
    }

    if (
      !findPageDocument()
    ) {
      log(
        "Allowed page detected, sections not ready yet"
      );

      return;
    }

    engineActive =
      true;

    installEngine();
  }

  function checkRouteChange() {
    const currentPath =
      getCurrentPath();

    if (
      currentPath ===
      lastKnownPath
    ) {
      return;
    }

    const previousPath =
      lastKnownPath;

    lastKnownPath =
      currentPath;

    log(
      "Route changed:",
      previousPath,
      "→",
      currentPath
    );

    window.setTimeout(
      () => {
        updatePageActivation(
          "route change"
        );
      },
      100
    );
  }

  function installRouteWatcher() {
    if (
      routeTimer
    ) {
      return;
    }

    lastKnownPath =
      getCurrentPath();

    routeTimer =
      window.setInterval(
        checkRouteChange,
        CONFIG.routeCheckInterval
      );

    log(
      "Route watcher installed:",
      lastKnownPath
    );
  }

  /*
   * =========================================================
   * INITIALIZATION
   * =========================================================
   */

  function initialize() {
    retries++;

    installRouteWatcher();

    if (
      !shouldRunOnCurrentPage()
    ) {
      engineActive =
        false;

      log(
        "Snap scroll disabled on initial page:",
        getCurrentPath()
      );

      return;
    }

    if (
      findPageDocument()
    ) {
      engineActive =
        true;

      installEngine();

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
        `[${VERSION}] Unable to find usable Wix sections on /home-1`
      );
    }
  }

  initialize();
})();
