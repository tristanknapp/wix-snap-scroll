console.log("[Wix Snap Scroll v4.0.1] file executing");

(() => {
  "use strict";

  const VERSION = "Wix Snap Scroll v4.0.1";

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

    desktop: {
      threshold: 42,
      gestureEndDelay: 220,
      rearmDelay: 140,
      duration: 800,
      navigationSyncDelay: 140
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
    "__WIX_SNAP_SCROLL_V401_CLEANUP__";

  const BADGE_ID =
    "__wix-snap-scroll-version-badge__";

  let win = null;
  let doc = null;

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

  function log(...args) {
    if (CONFIG.debug) {
      console.log(`[${VERSION}]`, ...args);
    }
  }

  function isMobileViewport() {
    return Boolean(
      win &&
      win.matchMedia(
        `(max-width: ${CONFIG.mobileBreakpoint}px)`
      ).matches
    );
  }

  function getScrollTop() {
    return (
      win.scrollY ||
      doc.documentElement.scrollTop ||
      doc.body?.scrollTop ||
      0
    );
  }

  function setScrollTop(top) {
    win.scrollTo({
      top,
      left: 0,
      behavior: "auto"
    });
  }

  function getViewportHeight() {
    if (
      isMobileViewport() &&
      win.visualViewport?.height
    ) {
      return win.visualViewport.height;
    }

    return win.innerHeight;
  }

  function getElement(selector) {
    try {
      return doc.querySelector(selector);
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

    win = bestMatch.win;
    doc = bestMatch.doc;

    log(
      `Found page document with ${bestMatch.count} configured sections`
    );

    return true;
  }

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

  function synchronizeCurrentSnap() {
    buildSnapPoints();

    const state =
      getFaqState();

    /*
     * Important:
     * If the FAQ is visibly occupying the viewport, it wins over
     * the mathematically closest snap point.
     */
    if (state.active) {
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

    const viewportTop =
      position;

    const viewportBottom =
      position +
      viewportHeight;

    const viewportCenter =
      position +
      viewportHeight / 2;

    const tolerance =
      CONFIG.edgeTolerance;

    /*
     * Standard scroll-range test.
     */
    const withinScrollRange =
      position >=
        faq.top -
        tolerance &&
      position <=
        faq.finalScrollTop +
        tolerance;

    /*
     * Wix menu navigation can align the FAQ with an offset.
     * Detect the FAQ from its actual viewport visibility as well.
     */
    const centerInsideFaq =
      viewportCenter >=
        faq.top &&
      viewportCenter <=
        faq.bottom;

    const visibleOverlap =
      Math.max(
        0,
        Math.min(
          viewportBottom,
          faq.bottom
        ) -
        Math.max(
          viewportTop,
          faq.top
        )
      );

    const meaningfulOverlap =
      visibleOverlap >=
      Math.min(
        viewportHeight * 0.32,
        faq.height * 0.32
      );

    const active =
      withinScrollRange ||
      centerInsideFaq ||
      meaningfulOverlap;

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

  function showVersionBadge(mode) {
    if (!doc.body) {
      win.setTimeout(
        () =>
          showVersionBadge(mode),
        100
      );

      return;
    }

    doc
      .getElementById(BADGE_ID)
      ?.remove();

    const badge =
      doc.createElement("div");

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

    doc.body.appendChild(badge);

    win.setTimeout(() => {
      badge.style.opacity = "0";

      badge.style.transform =
        "translateY(-8px)";

      win.setTimeout(
        () => badge.remove(),
        450
      );
    }, CONFIG.badgeDuration);
  }

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
      win.performance.now();

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
              win.requestAnimationFrame(
                frame
              );

            return;
          }

          setScrollTop(targetTop);

          animation.frame = null;

          resolve(true);
        }

        animation.frame =
          win.requestAnimationFrame(
            frame
          );
      }
    );
  }

  function cancelAnimation() {
    if (
      animation.frame !== null
    ) {
      win.cancelAnimationFrame(
        animation.frame
      );

      animation.frame = null;
    }

    animation.token++;
  }

  function addScrollListeners(handler) {
    win.addEventListener(
      "scroll",
      handler,
      {
        passive: true,
        capture: true
      }
    );

    doc.addEventListener(
      "scroll",
      handler,
      {
        passive: true,
        capture: true
      }
    );

    doc.body?.addEventListener(
      "scroll",
      handler,
      {
        passive: true,
        capture: true
      }
    );
  }

  function removeScrollListeners(handler) {
    win.removeEventListener(
      "scroll",
      handler,
      {
        capture: true
      }
    );

    doc.removeEventListener(
      "scroll",
      handler,
      {
        capture: true
      }
    );

    doc.body?.removeEventListener(
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
    if (!doc.body) {
      return;
    }

    const elements = [
      doc.body,
      doc.documentElement
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

        win.clearTimeout(
          mobile.rearmTimer
        );

        mobile.rearmTimer =
          win.setTimeout(
            resetMobileTouch,
            CONFIG.mobile.rearmDelay
          );
      }
    }
  }

  function mobileMoveOneSection(direction) {
    buildSnapPoints();

    const index =
      closestSnapIndex();

    if (index === -1) {
      resetMobileTouch();
      return;
    }

    currentSnapKey =
      snapPoints[index].key;

    mobileMoveToIndex(
      index +
      direction
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

    const state =
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
      state.active;

    if (state.active) {
      const faqIndex =
        getFaqSnapIndex();

      if (faqIndex !== -1) {
        currentSnapKey =
          snapPoints[faqIndex].key;
      }

      mobile.faqStartScrollTop =
        getScrollTop();

      mobile.faqBounds =
        state.faq;
    } else {
      const closestIndex =
        closestSnapIndex();

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
      const state =
        getFaqState();

      if (
        state.faq &&
        state.atTop
      ) {
        setScrollTop(
          state.faq.top
        );
      } else if (
        state.faq &&
        state.atBottom
      ) {
        setScrollTop(
          state.faq.finalScrollTop
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

    const state =
      getFaqState();

    if (state.active) {
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

    win.addEventListener(
      "touchstart",
      onMobileTouchStart,
      {
        passive: false,
        capture: true
      }
    );

    win.addEventListener(
      "touchmove",
      onMobileTouchMove,
      {
        passive: false,
        capture: true
      }
    );

    win.addEventListener(
      "touchend",
      onMobileTouchEnd,
      {
        passive: true,
        capture: true
      }
    );

    win.addEventListener(
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
      "mobile direct FAQ"
    );

    log("Mobile mode enabled");
  }

  function removeMobile() {
    if (!win || !doc) {
      return;
    }

    win.removeEventListener(
      "touchstart",
      onMobileTouchStart,
      {
        capture: true
      }
    );

    win.removeEventListener(
      "touchmove",
      onMobileTouchMove,
      {
        capture: true
      }
    );

    win.removeEventListener(
      "touchend",
      onMobileTouchEnd,
      {
        capture: true
      }
    );

    win.removeEventListener(
      "touchcancel",
      onMobileTouchEnd,
      {
        capture: true
      }
    );

    removeScrollListeners(
      onMobileScroll
    );

    win.clearTimeout(
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
    win.clearTimeout(
      desktop.gestureTimer
    );

    win.clearTimeout(
      desktop.rearmTimer
    );

    win.clearTimeout(
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

    const state =
      getFaqState();

    /*
     * FAQ visibility takes priority over closest-distance math.
     */
    if (state.active) {
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

    win.clearTimeout(
      desktop.syncTimer
    );

    desktop.syncTimer =
      win.setTimeout(
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
    win.clearTimeout(
      desktop.rearmTimer
    );

    desktop.rearmTimer =
      win.setTimeout(
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

    log(
      "Desktop moving:",
      currentSnapKey,
      "→",
      target.key
    );

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

    const state =
      getFaqState();

    /*
     * When the menu has placed the viewport inside the FAQ,
     * use the FAQ's configured index rather than the nearest
     * numerical scroll point.
     */
    let currentIndex;

    if (state.active) {
      currentIndex =
        getFaqSnapIndex();
    } else {
      currentIndex =
        findClosestSnapIndex();
    }

    if (currentIndex === -1) {
      desktop.latched = false;
      desktop.accumulatedDelta = 0;
      return;
    }

    currentSnapKey =
      snapPoints[currentIndex].key;

    desktopMoveToIndex(
      currentIndex +
      direction
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
    win.clearTimeout(
      desktop.gestureTimer
    );

    const movementToken =
      desktop.movementToken;

    desktop.gestureTimer =
      win.setTimeout(
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

    const state =
      getFaqState();

    if (state.active) {
      const faqIndex =
        getFaqSnapIndex();

      if (faqIndex !== -1) {
        currentSnapKey =
          snapPoints[faqIndex].key;
      }

      /*
       * Let normal browser scrolling continue while there is
       * still FAQ content available in the requested direction.
       */
      const canScrollInsideFaq =
        (
          direction > 0 &&
          !state.atBottom
        ) ||
        (
          direction < 0 &&
          !state.atTop
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
    win.setTimeout(
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

    win.addEventListener(
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

    win.addEventListener(
      "resize",
      onDesktopResize
    );

    showVersionBadge(
      "desktop FAQ nav-sync"
    );

    log("Desktop mode enabled");
  }

  function removeDesktop() {
    if (!win || !doc) {
      return;
    }

    win.removeEventListener(
      "wheel",
      onDesktopWheel,
      {
        capture: true
      }
    );

    removeScrollListeners(
      onDesktopScroll
    );

    win.removeEventListener(
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
    win.clearTimeout(
      breakpointTimer
    );

    breakpointTimer =
      win.setTimeout(
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
    removeDesktop();
    removeMobile();
    cancelAnimation();

    if (win) {
      win.removeEventListener(
        "resize",
        onBreakpointChange
      );

      win.visualViewport
        ?.removeEventListener(
          "resize",
          onBreakpointChange
        );

      win.clearTimeout(
        breakpointTimer
      );
    }

    doc
      ?.getElementById(BADGE_ID)
      ?.remove();
  }

  function install() {
    if (
      typeof win[CLEANUP_KEY] ===
      "function"
    ) {
      win[CLEANUP_KEY]();
    }

    win[CLEANUP_KEY] =
      cleanup;

    win.addEventListener(
      "resize",
      onBreakpointChange
    );

    win.visualViewport
      ?.addEventListener(
        "resize",
        onBreakpointChange
      );

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
