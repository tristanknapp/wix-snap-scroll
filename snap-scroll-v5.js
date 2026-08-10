console.log("[Wix Snap Scroll v4.1] file executing");

(() => {
  "use strict";

  const VERSION = "Wix Snap Scroll v4.1";

  const CONFIG = {
    mobileBreakpoint: 767,

    /*
     * Automatically discover Wix page sections in DOM order.
     * New normal sections automatically become SNAP sections.
     */
    sectionSelector: '[data-testid="section-container"]',

    /*
     * Known Wix structural section that should NOT participate
     * in the one-page scroll.
     */
    excludedSections: [
      "#comp-mrx3f3kh_r_comp-kbgajy18"
    ],

    /*
     * Only special sections need explicit configuration.
     */
    splitSections: {
      "#comp-mrx3f3km": 2
    },

    freeScrollSections: [
      "#comp-mrxamx3r"
    ],

    faqSelector: "#comp-mrxamx3r",

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
    "__WIX_SNAP_SCROLL_V41_CLEANUP__";

  const BADGE_ID =
    "__wix-snap-scroll-version-badge__";

  let pageWindow = null;
  let pageDocument = null;

  let sections = [];
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
      console.log(
        `[${VERSION}]`,
        ...args
      );
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

  function getPageTop(element) {
    return (
      element.getBoundingClientRect().top +
      getScrollTop()
    );
  }

  function selectorMatchesElement(
    element,
    selector
  ) {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  }

  /*
   * =========================================================
   * AUTOMATIC SECTION DISCOVERY
   * =========================================================
   */

  function isExcludedSection(element) {
    return CONFIG.excludedSections.some(
      (selector) =>
        selectorMatchesElement(
          element,
          selector
        )
    );
  }

  function getSectionMode(element) {
    /*
     * Check split sections.
     */
    for (
      const [
        selector,
        parts
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
        return {
          mode: "SPLIT",
          parts:
            Math.max(
              1,
              Number(parts) || 1
            )
        };
      }
    }

    /*
     * Check free-scroll sections.
     */
    if (
      CONFIG.freeScrollSections.some(
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

    /*
     * Everything else is automatically a normal
     * snap section.
     */
    return {
      mode: "SNAP",
      parts: 1
    };
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

    return found

      /*
       * Remove duplicates and unwanted Wix structure.
       */
      .filter((element) => {
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

        const rect =
          element
            .getBoundingClientRect();

        return rect.height > 0;
      })

      /*
       * Assign automatic modes.
       */
      .map(
        (
          element,
          index
        ) => {
          const special =
            getSectionMode(
              element
            );

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
              index
          };
        }
      );
  }

  /*
   * =========================================================
   * FIND THE REAL WIX PAGE DOCUMENT
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
          candidateWindow
            .frames.length;
          index++
        ) {
          visit(
            candidateWindow
              .frames[index]
          );
        }
      } catch {
        /*
         * Ignore inaccessible cross-origin frames.
         */
      }
    }

    visit(window);

    try {
      visit(window.top);
    } catch {
      /*
       * Ignore inaccessible top window.
       */
    }

    return results;
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
      `Found page document with ${sections.length} auto-discovered sections`
    );

    /*
     * Useful diagnostic:
     * shows exactly what the script thinks the page order is.
     */
    log(
      "Section order:",

      sections.map(
        (
          section,
          index
        ) => ({
          number:
            index + 1,

          id:
            section.element.id ||
            "(no id)",

          mode:
            section.mode,

          parts:
            section.parts
        })
      )
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
    /*
     * Rediscover every time so added, removed or reordered Wix
     * sections are automatically picked up.
     */
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

          /*
           * Special handling for the 200vh intro.
           */
          if (
            section.mode ===
            "SPLIT"
          ) {
            if (
              isMobileViewport()
            ) {
              /*
               * Mobile:
               * divide the rendered section itself.
               */
              pointTop =
                top +
                (
                  height /
                  numberOfParts
                ) *
                partIndex;
            } else {
              /*
               * Desktop:
               * use viewport-sized divisions.
               */
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

            partIndex
          });
        }
      }
    );

    /*
     * Preserve real page order.
     */
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
    try {
      return (
        pageDocument
          .querySelector(
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
      snapPoints
        .findIndex(
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
      viewportHeight /
        2;

    const tolerance =
      CONFIG.edgeTolerance;

    const withinScrollRange =
      position >=
        faq.top -
          tolerance &&
      position <=
        faq.finalScrollTop +
          tolerance;

    /*
     * Helps when Wix menu/anchor navigation lands with
     * a small offset.
     */
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

    /*
     * Down:
     * first real snap point physically below us.
     */
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

    /*
     * Up:
     * first real snap point physically above us.
     */
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
      !pageDocument.body
    ) {
      pageWindow
        .setTimeout(
          () =>
            showVersionBadge(
              mode
            ),
          100
        );

      return;
    }

    pageDocument
      .getElementById(
        BADGE_ID
      )
      ?.remove();

    const badge =
      pageDocument
        .createElement(
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

    pageWindow
      .setTimeout(
        () => {
          badge.style.opacity =
            "0";

          badge.style.transform =
            "translateY(-8px)";

          pageWindow
            .setTimeout(
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

        function frame(
          now
        ) {
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
      !pageDocument.body
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

        pageWindow
          .clearTimeout(
            mobile.rearmTimer
          );

        mobile.rearmTimer =
          pageWindow
            .setTimeout(
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

    /*
     * Resistant top edge.
     */
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

    /*
     * Resistant bottom edge.
     */
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

    /*
     * Middle of FAQ:
     * direct 1:1 movement.
     */
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

    event
      .stopImmediatePropagation();

    mobile.faqDragging =
      true;

    const requestedPosition =
      mobile
        .faqStartScrollTop -
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

    event
      .stopImmediatePropagation();

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

  function installMobile() {
    if (
      mobile.installed
    ) {
      return;
    }

    removeDesktop();

    buildSnapPoints();

    synchronizeCurrentSnap();

    mobile.installed =
      true;

    mobile.animating =
      false;

    setControlledTouch(
      true
    );

    pageWindow
      .addEventListener(
        "touchstart",
        onMobileTouchStart,
        {
          passive: false,
          capture: true
        }
      );

    pageWindow
      .addEventListener(
        "touchmove",
        onMobileTouchMove,
        {
          passive: false,
          capture: true
        }
      );

    pageWindow
      .addEventListener(
        "touchend",
        onMobileTouchEnd,
        {
          passive: true,
          capture: true
        }
      );

    pageWindow
      .addEventListener(
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
      "mobile auto-sections"
    );

    log(
      "Mobile auto-section mode enabled"
    );
  }

  function removeMobile() {
    if (
      !pageWindow ||
      !pageDocument
    ) {
      return;
    }

    pageWindow
      .removeEventListener(
        "touchstart",
        onMobileTouchStart,
        {
          capture: true
        }
      );

    pageWindow
      .removeEventListener(
        "touchmove",
        onMobileTouchMove,
        {
          capture: true
        }
      );

    pageWindow
      .removeEventListener(
        "touchend",
        onMobileTouchEnd,
        {
          capture: true
        }
      );

    pageWindow
      .removeEventListener(
        "touchcancel",
        onMobileTouchEnd,
        {
          capture: true
        }
      );

    removeScrollListeners(
      onMobileScroll
    );

    pageWindow
      .clearTimeout(
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
    pageWindow
      .clearTimeout(
        desktop.gestureTimer
      );

    pageWindow
      .clearTimeout(
        desktop.rearmTimer
      );

    pageWindow
      .clearTimeout(
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
        const previous =
          currentSnapKey;

        currentSnapKey =
          snapPoints[
            faqIndex
          ].key;

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

    if (
      closestIndex === -1
    ) {
      return;
    }

    const previous =
      currentSnapKey;

    currentSnapKey =
      snapPoints[
        closestIndex
      ].key;

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

    pageWindow
      .clearTimeout(
        desktop.syncTimer
      );

    desktop.syncTimer =
      pageWindow
        .setTimeout(
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
    pageWindow
      .clearTimeout(
        desktop.rearmTimer
      );

    desktop.rearmTimer =
      pageWindow
        .setTimeout(
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

    log(
      "Desktop moving:",

      currentSnapKey,

      "→",

      target.key,

      `y=${target.top}`
    );

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

    /*
     * FAQ remains special.
     */
    if (
      faq.active
    ) {
      desktopMoveToIndex(
        getFaqSnapIndex() +
        direction
      );

      return;
    }

    /*
     * Every normal section is now chosen from its real physical
     * position on the page. This means newly inserted sections
     * automatically participate.
     */
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
    pageWindow
      .clearTimeout(
        desktop.gestureTimer
      );

    const movementToken =
      desktop.movementToken;

    desktop.gestureTimer =
      pageWindow
        .setTimeout(
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

    /*
     * FAQ:
     * allow free native scrolling while there is content left.
     */
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

      event
        .stopImmediatePropagation();

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

    /*
     * Normal snap sections.
     */
    event.preventDefault();

    event
      .stopImmediatePropagation();

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

  function onDesktopResize() {
    pageWindow
      .setTimeout(
        () => {
          syncDesktopFromPosition(
            "resize"
          );
        },
        150
      );
  }

  function installDesktop() {
    if (
      desktop.installed
    ) {
      return;
    }

    removeMobile();

    buildSnapPoints();

    if (
      snapPoints.length <
      2
    ) {
      return;
    }

    synchronizeCurrentSnap();

    desktop.installed =
      true;

    pageWindow
      .addEventListener(
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

    pageWindow
      .addEventListener(
        "resize",
        onDesktopResize
      );

    showVersionBadge(
      "desktop auto-sections"
    );

    log(
      "Desktop auto-section mode enabled"
    );
  }

  function removeDesktop() {
    if (
      !pageWindow ||
      !pageDocument
    ) {
      return;
    }

    pageWindow
      .removeEventListener(
        "wheel",
        onDesktopWheel,
        {
          capture: true
        }
      );

    removeScrollListeners(
      onDesktopScroll
    );

    pageWindow
      .removeEventListener(
        "resize",
        onDesktopResize
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
    if (
      isMobileViewport()
    ) {
      installMobile();
    } else {
      installDesktop();
    }
  }

  function onBreakpointChange() {
    pageWindow
      .clearTimeout(
        breakpointTimer
      );

    breakpointTimer =
      pageWindow
        .setTimeout(
          () => {

            if (
              isMobileViewport()
            ) {
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
    removeDesktop();

    removeMobile();

    cancelAnimation();

    if (
      pageWindow
    ) {
      pageWindow
        .removeEventListener(
          "resize",
          onBreakpointChange
        );

      pageWindow
        .visualViewport
        ?.removeEventListener(
          "resize",
          onBreakpointChange
        );

      pageWindow
        .clearTimeout(
          breakpointTimer
        );
    }

    pageDocument
      ?.getElementById(
        BADGE_ID
      )
      ?.remove();
  }

  function install() {
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
      cleanup;

    pageWindow
      .addEventListener(
        "resize",
        onBreakpointChange
      );

    pageWindow
      .visualViewport
      ?.addEventListener(
        "resize",
        onBreakpointChange
      );

    applyCorrectMode();
  }

  function initialize() {
    retries++;

    if (
      findPageDocument()
    ) {
      install();

      return;
    }

    if (
      retries <
      CONFIG.maxRetries
    ) {
      window
        .setTimeout(
          initialize,

          CONFIG.retryDelay
        );

    } else {
      console.error(
        `[${VERSION}] Unable to find usable Wix sections`
      );
    }
  }

  initialize();
})();
