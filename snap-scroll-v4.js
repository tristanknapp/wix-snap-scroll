console.log("[Wix Snap Scroll v4.0] file executing");

(() => {
  "use strict";

  const VERSION = "Wix Snap Scroll v4.0";
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
      navigationSyncDelay: 120
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

    edgeTolerance: 12,
    retryDelay: 400,
    maxRetries: 40,
    badgeDuration: 4000,
    debug: true
  };

  const CLEANUP_KEY =
    "__WIX_SNAP_SCROLL_V4_CLEANUP__";

  const BADGE_ID =
    "__wix-snap-scroll-version-badge__";

  let win;
  let doc;
  let snaps = [];
  let currentKey = null;
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
    delta: 0,
    timers: {
      gesture: null,
      rearm: null,
      sync: null
    }
  };

  const mobile = {
    installed: false,
    animating: false,
    movementToken: 0,
    rearmTimer: null,

    touch: {
      tracking: false,
      triggered: false,
      startX: 0,
      startY: 0,
      inFaq: false,
      faqDragging: false,
      faqStartTop: 0,
      faqBounds: null
    }
  };

  const log = (...args) => {
    if (CONFIG.debug) {
      console.log(
        `[${VERSION}]`,
        ...args
      );
    }
  };

  const isMobile = () =>
    Boolean(
      win &&
        win.matchMedia(
          `(max-width: ${CONFIG.mobileBreakpoint}px)`
        ).matches
    );

  const getScrollTop = () =>
    win.scrollY ||
    doc.documentElement.scrollTop ||
    doc.body?.scrollTop ||
    0;

  const setScrollTop = (top) =>
    win.scrollTo({
      top,
      left: 0,
      behavior: "auto"
    });

  const getViewportHeight = () =>
    isMobile() &&
    win.visualViewport?.height
      ? win.visualViewport.height
      : win.innerHeight;

  const getElement = (selector) => {
    try {
      return doc.querySelector(
        selector
      );
    } catch {
      return null;
    }
  };

  const getPageTop = (element) =>
    element
      .getBoundingClientRect()
      .top +
    getScrollTop();

  function findPageDocument() {
    const visited = new Set();
    let best = null;

    function visit(candidate) {
      if (
        !candidate ||
        visited.has(candidate)
      ) {
        return;
      }

      visited.add(candidate);

      let candidateDoc;

      try {
        candidateDoc =
          candidate.document;
      } catch {
        return;
      }

      const count =
        CONFIG.sections.reduce(
          (sum, section) =>
            sum +
            (
              candidateDoc
                .querySelector(
                  section.selector
                )
                ? 1
                : 0
            ),
          0
        );

      if (
        !best ||
        count > best.count
      ) {
        best = {
          win: candidate,
          doc: candidateDoc,
          count
        };
      }

      try {
        for (
          let i = 0;
          i <
          candidate.frames.length;
          i++
        ) {
          visit(
            candidate.frames[i]
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
      !best ||
      best.count < 2
    ) {
      return false;
    }

    win = best.win;
    doc = best.doc;

    log(
      `Found page document with ${best.count} configured sections`
    );

    return true;
  }

  function buildSnaps() {
    const viewportHeight =
      getViewportHeight();

    const next = [];

    CONFIG.sections.forEach(
      (
        section,
        configuredIndex
      ) => {
        const element =
          getElement(
            section.selector
          );

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

        const count =
          section.mode === "SPLIT"
            ? section.parts
            : 1;

        for (
          let partIndex = 0;
          partIndex < count;
          partIndex++
        ) {
          let pointTop = top;

          if (
            section.mode ===
            "SPLIT"
          ) {
            if (isMobile()) {
              pointTop =
                top +
                (
                  height /
                  count
                ) *
                  partIndex;
            } else {
              pointTop =
                Math.min(
                  top +
                    viewportHeight *
                      partIndex,
                  Math.max(
                    top,
                    top +
                      height -
                      viewportHeight
                  )
                );
            }
          }

          next.push({
            key:
              `${section.selector}:` +
              `${section.mode}:` +
              `${partIndex}`,

            top:
              Math.round(
                pointTop
              ),

            selector:
              section.selector,

            mode:
              section.mode,

            partIndex,

            configuredIndex
          });
        }
      }
    );

    snaps = next.sort(
      (a, b) =>
        a.configuredIndex -
          b.configuredIndex ||
        a.partIndex -
          b.partIndex
    );

    return snaps;
  }

  const snapIndexByKey = (
    key
  ) =>
    snaps.findIndex(
      (point) =>
        point.key === key
    );

  const faqSnapIndex = () =>
    snaps.findIndex(
      (point) =>
        point.selector ===
        CONFIG.faqSelector
    );

  function closestSnapIndex(
    position = getScrollTop()
  ) {
    if (!snaps.length) {
      return -1;
    }

    let index = 0;
    let distance = Infinity;

    snaps.forEach(
      (
        point,
        candidate
      ) => {
        const nextDistance =
          Math.abs(
            position -
              point.top
          );

        if (
          nextDistance <
          distance
        ) {
          distance =
            nextDistance;

          index =
            candidate;
        }
      }
    );

    return index;
  }

  function syncCurrentKey() {
    buildSnaps();

    const index =
      closestSnapIndex();

    if (index !== -1) {
      currentKey =
        snaps[index].key;
    }

    return index;
  }

  function faqBounds() {
    const element =
      getElement(
        CONFIG.faqSelector
      );

    if (!element) {
      return null;
    }

    const top =
      getPageTop(element);

    const height =
      element
        .getBoundingClientRect()
        .height;

    const bottom =
      top + height;

    const finalScrollTop =
      Math.max(
        top,
        bottom -
          getViewportHeight()
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

  function faqState(
    position = getScrollTop()
  ) {
    const faq =
      faqBounds();

    if (!faq) {
      return {
        faq: null,
        inside: false,
        atTop: false,
        atBottom: false
      };
    }

    const tolerance =
      CONFIG.edgeTolerance;

    const inside =
      position >=
        faq.top -
          tolerance &&
      position <=
        faq.finalScrollTop +
          tolerance;

    return {
      faq,
      inside,

      atTop:
        inside &&
        position <=
          faq.top +
            tolerance,

      atBottom:
        inside &&
        position >=
          faq.finalScrollTop -
            tolerance
    };
  }

  function showBadge(mode) {
    if (!doc.body) {
      win.setTimeout(
        () =>
          showBadge(mode),
        100
      );

      return;
    }

    doc
      .getElementById(
        BADGE_ID
      )
      ?.remove();

    const badge =
      doc.createElement(
        "div"
      );

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

        color:
          "#fff",

        fontFamily:
          "Arial,Helvetica,sans-serif",

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

    doc.body.appendChild(
      badge
    );

    win.setTimeout(() => {
      badge.style.opacity =
        "0";

      badge.style.transform =
        "translateY(-8px)";

      win.setTimeout(
        () =>
          badge.remove(),
        450
      );
    }, CONFIG.badgeDuration);
  }

  const ease = (
    progress
  ) =>
    progress < 0.5
      ? 8 *
        Math.pow(
          progress,
          4
        )
      : 1 -
        Math.pow(
          -2 *
            progress +
            2,
          4
        ) /
          2;

  function animateTo(
    targetTop,
    duration
  ) {
    if (
      animation.frame !==
      null
    ) {
      win.cancelAnimationFrame(
        animation.frame
      );
    }

    animation.token++;

    const token =
      animation.token;

    const start =
      getScrollTop();

    const distance =
      targetTop -
      start;

    const started =
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
                started
              ) /
                duration,
              1
            );

          setScrollTop(
            start +
              distance *
                ease(
                  progress
                )
          );

          if (
            progress < 1
          ) {
            animation.frame =
              win.requestAnimationFrame(
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
          win.requestAnimationFrame(
            frame
          );
      }
    );
  }

  function cancelAnimation() {
    if (
      animation.frame !==
      null
    ) {
      win.cancelAnimationFrame(
        animation.frame
      );

      animation.frame =
        null;
    }

    animation.token++;
  }

  function addScrollListeners(
    handler
  ) {
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

  function removeScrollListeners(
    handler
  ) {
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
   * MOBILE
   */

  function setControlledTouch(
    enabled
  ) {
    if (!doc.body) {
      return;
    }

    const action =
      enabled
        ? "setProperty"
        : "removeProperty";

    const args =
      enabled
        ? [
            "none",
            "important"
          ]
        : [];

    [
      doc.body.style,
      doc.documentElement.style
    ].forEach(
      (style) => {
        style[action](
          "touch-action",
          ...args
        );

        style[action](
          "overscroll-behavior-y",
          ...args
        );
      }
    );
  }

  function resetTouch() {
    Object.assign(
      mobile.touch,
      {
        tracking: false,
        triggered: false,
        startX: 0,
        startY: 0,
        inFaq: false,
        faqDragging: false,
        faqStartTop: 0,
        faqBounds: null
      }
    );
  }

  function isProtectedControl(
    target
  ) {
    return Boolean(
      target?.closest?.(
        "input,textarea,select,[contenteditable='true']"
      )
    );
  }

  async function mobileMoveTo(
    index
  ) {
    if (
      mobile.animating ||
      index < 0 ||
      index >=
        snaps.length
    ) {
      resetTouch();
      return;
    }

    const target =
      snaps[index];

    mobile.movementToken++;

    const token =
      mobile.movementToken;

    mobile.animating =
      true;

    mobile.touch.triggered =
      true;

    try {
      await animateTo(
        target.top,
        CONFIG.mobile.duration
      );

      if (
        token ===
        mobile.movementToken
      ) {
        currentKey =
          target.key;
      }
    } finally {
      if (
        token ===
        mobile.movementToken
      ) {
        mobile.animating =
          false;

        win.clearTimeout(
          mobile.rearmTimer
        );

        mobile.rearmTimer =
          win.setTimeout(
            resetTouch,
            CONFIG.mobile
              .rearmDelay
          );
      }
    }
  }

  function mobileMoveOne(
    direction
  ) {
    buildSnaps();

    const index =
      closestSnapIndex();

    if (index === -1) {
      resetTouch();
      return;
    }

    currentKey =
      snaps[index].key;

    mobileMoveTo(
      index +
        direction
    );
  }

  function mobileLeaveFaq(
    direction
  ) {
    buildSnaps();

    mobileMoveTo(
      faqSnapIndex() +
        direction
    );
  }

  function faqDragPosition(
    requested,
    bounds
  ) {
    const zone =
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
      zone > 0 &&
      requested <
        bounds.top +
          zone
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
      zone > 0 &&
      requested >
        bounds.finalScrollTop -
          zone
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
    const touch =
      mobile.touch;

    touch.faqBounds ||=
      faqBounds();

    if (
      !touch.faqBounds
    ) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    touch.faqDragging =
      true;

    const requested =
      touch.faqStartTop -
      deltaY *
        CONFIG.faq
          .dragMultiplier;

    setScrollTop(
      faqDragPosition(
        requested,
        touch.faqBounds
      )
    );

    const direction =
      deltaY < 0
        ? 1
        : -1;

    const overflow =
      requested >
      touch.faqBounds
        .finalScrollTop
        ? requested -
          touch.faqBounds
            .finalScrollTop
        : requested <
            touch.faqBounds
              .top
          ? touch.faqBounds
              .top -
            requested
          : 0;

    if (
      overflow <
      CONFIG.faq
        .exitThreshold
    ) {
      return;
    }

    touch.triggered =
      true;

    setScrollTop(
      direction > 0
        ? touch.faqBounds
            .finalScrollTop
        : touch.faqBounds
            .top
    );

    mobileLeaveFaq(
      direction
    );
  }

  function onTouchStart(
    event
  ) {
    if (
      !mobile.installed ||
      !isMobile() ||
      mobile.animating ||
      event.touches
        .length !== 1 ||
      isProtectedControl(
        event.target
      )
    ) {
      resetTouch();
      return;
    }

    buildSnaps();

    const state =
      faqState();

    const touch =
      event.touches[0];

    mobile.touch.tracking =
      true;

    mobile.touch.triggered =
      false;

    mobile.touch.startX =
      touch.clientX;

    mobile.touch.startY =
      touch.clientY;

    mobile.touch.inFaq =
      state.inside;

    if (state.inside) {
      currentKey =
        snaps[
          faqSnapIndex()
        ]?.key ||
        currentKey;

      mobile.touch.faqStartTop =
        getScrollTop();

      mobile.touch.faqBounds =
        state.faq;
    } else {
      const index =
        closestSnapIndex();

      if (index !== -1) {
        currentKey =
          snaps[index].key;
      }
    }
  }

  function onTouchMove(
    event
  ) {
    const touchState =
      mobile.touch;

    if (
      !mobile.installed ||
      !touchState.tracking ||
      touchState.triggered ||
      mobile.animating ||
      event.touches
        .length !== 1
    ) {
      return;
    }

    const touch =
      event.touches[0];

    const deltaX =
      touch.clientX -
      touchState.startX;

    const deltaY =
      touch.clientY -
      touchState.startY;

    const vertical =
      Math.abs(
        deltaY
      );

    const horizontal =
      Math.abs(
        deltaX
      );

    if (
      vertical <=
      horizontal *
        CONFIG.mobile
          .directionRatio
    ) {
      return;
    }

    if (
      touchState.inFaq
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
      vertical <
      CONFIG.mobile
        .threshold
    ) {
      return;
    }

    touchState.triggered =
      true;

    mobileMoveOne(
      deltaY < 0
        ? 1
        : -1
    );
  }

  function onTouchEnd() {
    if (
      mobile.touch
        .faqDragging &&
      !mobile.animating
    ) {
      const state =
        faqState();

      if (
        state.atTop
      ) {
        setScrollTop(
          state.faq.top
        );
      }

      if (
        state.atBottom
      ) {
        setScrollTop(
          state.faq
            .finalScrollTop
        );
      }
    }

    if (
      !mobile.animating
    ) {
      resetTouch();
    }
  }

  function onMobileScroll() {
    if (
      !mobile.installed ||
      mobile.animating ||
      mobile.touch
        .faqDragging
    ) {
      return;
    }

    buildSnaps();

    if (
      faqState().inside
    ) {
      currentKey =
        snaps[
          faqSnapIndex()
        ]?.key ||
        currentKey;
    }
  }

  function installMobile() {
    if (
      mobile.installed
    ) {
      return;
    }

    removeDesktop();

    buildSnaps();
    syncCurrentKey();

    mobile.installed =
      true;

    setControlledTouch(
      true
    );

    win.addEventListener(
      "touchstart",
      onTouchStart,
      {
        passive: false,
        capture: true
      }
    );

    win.addEventListener(
      "touchmove",
      onTouchMove,
      {
        passive: false,
        capture: true
      }
    );

    win.addEventListener(
      "touchend",
      onTouchEnd,
      {
        passive: true,
        capture: true
      }
    );

    win.addEventListener(
      "touchcancel",
      onTouchEnd,
      {
        passive: true,
        capture: true
      }
    );

    addScrollListeners(
      onMobileScroll
    );

    showBadge(
      "mobile direct FAQ"
    );

    log(
      "Mobile mode enabled"
    );
  }

  function removeMobile() {
    if (
      !win ||
      !doc
    ) {
      return;
    }

    win.removeEventListener(
      "touchstart",
      onTouchStart,
      {
        capture: true
      }
    );

    win.removeEventListener(
      "touchmove",
      onTouchMove,
      {
        capture: true
      }
    );

    win.removeEventListener(
      "touchend",
      onTouchEnd,
      {
        capture: true
      }
    );

    win.removeEventListener(
      "touchcancel",
      onTouchEnd,
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

    mobile.animating =
      false;

    mobile.installed =
      false;

    setControlledTouch(
      false
    );

    resetTouch();
  }

  /*
   * DESKTOP
   */

  function clearDesktopTimers() {
    Object.keys(
      desktop.timers
    ).forEach(
      (key) => {
        win.clearTimeout(
          desktop.timers[
            key
          ]
        );

        desktop.timers[
          key
        ] = null;
      }
    );
  }

  function syncDesktop(
    reason = "scroll"
  ) {
    if (
      !desktop.installed ||
      desktop.animating ||
      isMobile()
    ) {
      return;
    }

    buildSnaps();

    const state =
      faqState();

    if (state.inside) {
      currentKey =
        snaps[
          faqSnapIndex()
        ]?.key ||
        currentKey;

      return;
    }

    const index =
      closestSnapIndex();

    if (index === -1) {
      return;
    }

    const previous =
      currentKey;

    currentKey =
      snaps[index].key;

    if (
      previous !==
      currentKey
    ) {
      log(
        `Desktop resynced after ${reason}:`,
        previous,
        "→",
        currentKey
      );
    }
  }

  function onDesktopScroll() {
    if (
      !desktop.installed ||
      desktop.animating ||
      isMobile()
    ) {
      return;
    }

    win.clearTimeout(
      desktop.timers.sync
    );

    desktop.timers.sync =
      win.setTimeout(
        () =>
          syncDesktop(
            "navigation/anchor scroll"
          ),

        CONFIG.desktop
          .navigationSyncDelay
      );
  }

  function rearmDesktop(
    token
  ) {
    win.clearTimeout(
      desktop.timers.rearm
    );

    desktop.timers.rearm =
      win.setTimeout(
        () => {
          if (
            token !==
            desktop
              .movementToken
          ) {
            return;
          }

          desktop.latched =
            false;

          desktop.delta =
            0;
        },

        CONFIG.desktop
          .rearmDelay
      );
  }

  async function desktopMoveTo(
    index
  ) {
    if (
      desktop.animating ||
      index < 0 ||
      index >=
        snaps.length
    ) {
      desktop.latched =
        false;

      desktop.delta =
        0;

      return;
    }

    clearDesktopTimers();
    buildSnaps();

    const target =
      snaps[index];

    desktop.movementToken++;

    const token =
      desktop.movementToken;

    desktop.animating =
      true;

    desktop.latched =
      true;

    desktop.delta =
      0;

    try {
      await animateTo(
        target.top,
        CONFIG.desktop
          .duration
      );

      if (
        token ===
        desktop
          .movementToken
      ) {
        currentKey =
          target.key;
      }
    } finally {
      if (
        token ===
        desktop
          .movementToken
      ) {
        desktop.animating =
          false;

        rearmDesktop(
          token
        );
      }
    }
  }

  function desktopMoveOne(
    direction
  ) {
    buildSnaps();

    /*
     * Always use the real viewport position after
     * Wix navigation or anchor jumps.
     */
    const index =
      closestSnapIndex();

    if (index === -1) {
      return;
    }

    currentKey =
      snaps[index].key;

    desktopMoveTo(
      index +
        direction
    );
  }

  function desktopLeaveFaq(
    direction
  ) {
    buildSnaps();

    desktopMoveTo(
      faqSnapIndex() +
        direction
    );
  }

  function scheduleWheelEnd() {
    win.clearTimeout(
      desktop.timers
        .gesture
    );

    const token =
      desktop
        .movementToken;

    desktop.timers.gesture =
      win.setTimeout(
        () => {
          if (
            desktop.animating ||
            token !==
              desktop
                .movementToken
          ) {
            return;
          }

          syncDesktop(
            "wheel gesture end"
          );

          desktop.latched =
            false;

          desktop.delta =
            0;
        },

        CONFIG.desktop
          .gestureEndDelay
      );
  }

  function onWheel(event) {
    if (
      !desktop.installed ||
      isMobile() ||
      !event.deltaY
    ) {
      return;
    }

    if (
      !desktop.animating
    ) {
      syncDesktop(
        "wheel start"
      );
    }

    const direction =
      event.deltaY > 0
        ? 1
        : -1;

    scheduleWheelEnd();

    const state =
      faqState();

    if (state.inside) {
      currentKey =
        snaps[
          faqSnapIndex()
        ]?.key ||
        currentKey;

      const canScroll =
        (
          direction > 0 &&
          !state.atBottom
        ) ||
        (
          direction < 0 &&
          !state.atTop
        );

      if (canScroll) {
        desktop.latched =
          false;

        desktop.delta =
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

      desktop.delta +=
        event.deltaY;

      if (
        Math.abs(
          desktop.delta
        ) <
        CONFIG.desktop
          .threshold
      ) {
        return;
      }

      desktop.latched =
        true;

      desktop.delta =
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

    desktop.delta +=
      event.deltaY;

    if (
      Math.abs(
        desktop.delta
      ) <
      CONFIG.desktop
        .threshold
    ) {
      return;
    }

    desktop.latched =
      true;

    desktop.delta =
      0;

    desktopMoveOne(
      direction
    );
  }

  function onDesktopResize() {
    win.setTimeout(
      () =>
        syncDesktop(
          "resize"
        ),
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

    buildSnaps();

    if (
      snaps.length < 2
    ) {
      return;
    }

    syncCurrentKey();

    desktop.installed =
      true;

    win.addEventListener(
      "wheel",
      onWheel,
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

    showBadge(
      "desktop nav-sync"
    );

    log(
      "Desktop mode enabled"
    );
  }

  function removeDesktop() {
    if (
      !win ||
      !doc
    ) {
      return;
    }

    win.removeEventListener(
      "wheel",
      onWheel,
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

    desktop.animating =
      false;

    desktop.latched =
      false;

    desktop.delta =
      0;

    desktop.installed =
      false;
  }

  function applyMode() {
    if (isMobile()) {
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
          if (isMobile()) {
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
      ?.getElementById(
        BADGE_ID
      )
      ?.remove();
  }

  function install() {
    if (
      typeof win[
        CLEANUP_KEY
      ] === "function"
    ) {
      win[
        CLEANUP_KEY
      ]();
    }

    win[
      CLEANUP_KEY
    ] = cleanup;

    win.addEventListener(
      "resize",
      onBreakpointChange
    );

    win.visualViewport
      ?.addEventListener(
        "resize",
        onBreakpointChange
      );

    applyMode();
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
