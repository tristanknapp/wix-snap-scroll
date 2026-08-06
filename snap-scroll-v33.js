console.log("[Wix Snap Scroll v3.3] file executing");

(() => {
    "use strict";

    const VERSION = "Wix Snap Scroll v3.3";

    const CONFIG = {
        mobileBreakpoint: 767,

        sections: [
            {
                selector: "#comp-mrx3f3km",
                mode: "SPLIT",
                parts: 2
            },
            {
                selector: "#comp-mrx3fuen",
                mode: "SNAP"
            },
            {
                selector: "#comp-mrx3tdvm",
                mode: "SNAP"
            },
            {
                selector: "#comp-mrx3tz9l",
                mode: "SNAP"
            },
            {
                selector: "#comp-msen55me",
                mode: "SNAP"
            },
            {
                selector: "#comp-mrxamcft",
                mode: "SNAP"
            },
            {
                selector: "#comp-msa0j5h2",
                mode: "SNAP"
            },
            {
                selector: "#comp-mrxamx3r",
                mode: "FREE"
            },
            {
                selector: "#comp-msa50934",
                mode: "SNAP"
            },
            {
                selector: "#comp-msa47lnw",
                mode: "SNAP"
            }
        ],

        faqSelector: "#comp-mrxamx3r",

        /*
         * Desktop.
         */
        wheelThreshold: 42,
        wheelGestureEndDelay: 220,
        desktopRearmDelay: 140,
        desktopScrollDuration: 800,

        /*
         * Mobile.
         *
         * A section transition starts after this much vertical
         * finger movement.
         */
        mobileSwipeThreshold: 45,

        /*
         * A swipe must be predominantly vertical.
         */
        mobileDirectionRatio: 1.15,

        /*
         * Prevents a second gesture while the previous animation
         * is finishing.
         */
        mobileRearmDelay: 120,

        mobileScrollDuration: 650,

        /*
         * FAQ boundary tolerance.
         */
        edgeTolerance: 16,

        /*
         * Wix page discovery.
         */
        retryDelay: 400,
        maxRetries: 40,

        /*
         * Version popup.
         */
        showVersionBadge: true,
        versionBadgeDuration: 4000,

        debug: true
    };

    const CLEANUP_KEY =
        "__WIX_SNAP_SCROLL_V33_CLEANUP__";

    const BADGE_ID =
        "__wix-snap-scroll-version-badge__";

    let pageWindow = null;
    let pageDocument = null;

    let snapPoints = [];
    let currentSnapKey = null;

    let animationFrame = null;
    let animationToken = 0;

    /*
     * Desktop state.
     */
    let desktopInstalled = false;
    let desktopAnimating = false;
    let desktopMovementToken = 0;

    let wheelLatched = false;
    let accumulatedWheel = 0;

    let wheelEndTimer = null;
    let desktopRearmTimer = null;

    /*
     * Mobile state.
     */
    let mobileInstalled = false;
    let mobileAnimating = false;
    let mobileMovementToken = 0;
    let mobileRearmTimer = null;

    let touchTracking = false;
    let touchTriggered = false;
    let touchNativeFaqGesture = false;

    let touchStartX = 0;
    let touchStartY = 0;

    /*
     * Stores the original inline values so cleanup can restore Wix.
     */
    let originalBodyTouchAction = "";
    let originalBodyOverscroll = "";
    let originalHtmlTouchAction = "";
    let originalHtmlOverscroll = "";

    let breakpointTimer = null;
    let retries = 0;

    function log(...args) {
        if (CONFIG.debug) {
            console.log(`[${VERSION}]`, ...args);
        }
    }

    function isMobileViewport() {
        if (!pageWindow) {
            return false;
        }

        return pageWindow.matchMedia(
            `(max-width: ${CONFIG.mobileBreakpoint}px)`
        ).matches;
    }

    /*
     * Wix Custom Code can execute inside a wrapper.
     * Find the accessible document containing the configured sections.
     */
    function getAccessibleDocuments() {
        const results = [];
        const visited = new Set();

        function visit(win) {
            if (!win || visited.has(win)) {
                return;
            }

            visited.add(win);

            let doc;

            try {
                doc = win.document;
            } catch {
                return;
            }

            results.push({
                win,
                doc
            });

            try {
                for (
                    let index = 0;
                    index < win.frames.length;
                    index++
                ) {
                    visit(win.frames[index]);
                }
            } catch {
                // Ignore inaccessible cross-origin frames.
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

    function countConfiguredSections(doc) {
        return CONFIG.sections.reduce(
            (count, definition) => {
                try {
                    return doc.querySelector(
                        definition.selector
                    )
                        ? count + 1
                        : count;
                } catch {
                    return count;
                }
            },
            0
        );
    }

    function findPageDocument() {
        let bestMatch = null;
        let highestCount = 0;

        getAccessibleDocuments().forEach(
            ({ win, doc }) => {
                const count =
                    countConfiguredSections(doc);

                if (count > highestCount) {
                    highestCount = count;

                    bestMatch = {
                        win,
                        doc
                    };
                }
            }
        );

        if (!bestMatch || highestCount < 2) {
            return false;
        }

        pageWindow = bestMatch.win;
        pageDocument = bestMatch.doc;

        log(
            `Found page document with ${highestCount} configured sections`
        );

        return true;
    }

    function getElement(selector) {
        try {
            return pageDocument.querySelector(
                selector
            );
        } catch {
            return null;
        }
    }

    function getScrollTop() {
        return (
            pageWindow.scrollY ||
            pageDocument.documentElement.scrollTop ||
            pageDocument.body?.scrollTop ||
            0
        );
    }

    function getPageTop(element) {
        return (
            element.getBoundingClientRect().top +
            getScrollTop()
        );
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

    function makeSnapKey(
        definition,
        partIndex = 0
    ) {
        return (
            `${definition.selector}:` +
            `${definition.mode}:` +
            `${partIndex}`
        );
    }

    /*
     * Stable destinations in the exact configured order.
     */
    function buildSnapPoints() {
        const viewportHeight =
            getViewportHeight();

        const points = [];

        CONFIG.sections.forEach(
            (definition, configuredIndex) => {
                const element =
                    getElement(
                        definition.selector
                    );

                if (!element) {
                    log(
                        "Configured section missing:",
                        definition.selector
                    );

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

                if (
                    definition.mode ===
                    "SPLIT"
                ) {
                    const partCount =
                        definition.parts || 2;

                    const finalPossibleTop =
                        Math.max(
                            top,
                            top +
                                height -
                                viewportHeight
                        );

                    for (
                        let partIndex = 0;
                        partIndex < partCount;
                        partIndex++
                    ) {
                        const requestedTop =
                            top +
                            viewportHeight *
                                partIndex;

                        points.push({
                            key: makeSnapKey(
                                definition,
                                partIndex
                            ),
                            top: Math.round(
                                Math.min(
                                    requestedTop,
                                    finalPossibleTop
                                )
                            ),
                            selector:
                                definition.selector,
                            mode:
                                definition.mode,
                            partIndex,
                            configuredIndex
                        });
                    }

                    return;
                }

                points.push({
                    key: makeSnapKey(
                        definition,
                        0
                    ),
                    top: Math.round(top),
                    selector:
                        definition.selector,
                    mode:
                        definition.mode,
                    partIndex: 0,
                    configuredIndex
                });
            }
        );

        snapPoints = points.sort(
            (a, b) => {
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

        log(
            `Built ${snapPoints.length} snap points`
        );
    }

    function getSnapIndexByKey(key) {
        if (!key) {
            return -1;
        }

        return snapPoints.findIndex(
            (point) => point.key === key
        );
    }

    function getFaqSnapIndex() {
        return snapPoints.findIndex(
            (point) =>
                point.selector ===
                CONFIG.faqSelector
        );
    }

    function findClosestSnapIndex(
        position = getScrollTop()
    ) {
        if (snapPoints.length === 0) {
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

                    closestIndex = index;
                }
            }
        );

        return closestIndex;
    }

    function synchronizeCurrentKey() {
        buildSnapPoints();

        const closestIndex =
            findClosestSnapIndex();

        if (closestIndex !== -1) {
            currentSnapKey =
                snapPoints[
                    closestIndex
                ].key;
        }

        return closestIndex;
    }

    function getFaqBounds() {
        const faq =
            getElement(
                CONFIG.faqSelector
            );

        if (!faq) {
            return null;
        }

        const top =
            getPageTop(faq);

        const height =
            faq.getBoundingClientRect().height;

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
            finalScrollTop
        };
    }

    /*
     * True only while the FAQ has native content available
     * in at least one direction.
     */
    function isInsideFaqRange(
        position = getScrollTop()
    ) {
        const faq =
            getFaqBounds();

        if (!faq) {
            return false;
        }

        return (
            position >=
                faq.top -
                    CONFIG.edgeTolerance &&
            position <=
                faq.finalScrollTop +
                    CONFIG.edgeTolerance
        );
    }

    function isInsideFaqMiddle(
        position = getScrollTop()
    ) {
        const faq =
            getFaqBounds();

        if (!faq) {
            return false;
        }

        return (
            position >
                faq.top +
                    CONFIG.edgeTolerance &&
            position <
                faq.finalScrollTop -
                    CONFIG.edgeTolerance
        );
    }

    function canFaqScrollNatively(
        direction,
        position = getScrollTop()
    ) {
        const faq =
            getFaqBounds();

        if (!faq) {
            return false;
        }

        if (
            direction > 0 &&
            position <
                faq.finalScrollTop -
                    CONFIG.edgeTolerance
        ) {
            return true;
        }

        if (
            direction < 0 &&
            position >
                faq.top +
                    CONFIG.edgeTolerance
        ) {
            return true;
        }

        return false;
    }

    function showVersionBadge(mode) {
        if (
            !CONFIG.showVersionBadge ||
            !pageDocument
        ) {
            return;
        }

        const createBadge = () => {
            if (!pageDocument.body) {
                pageWindow.setTimeout(
                    createBadge,
                    100
                );

                return;
            }

            const previous =
                pageDocument.getElementById(
                    BADGE_ID
                );

            if (previous) {
                previous.remove();
            }

            const badge =
                pageDocument.createElement(
                    "div"
                );

            badge.id = BADGE_ID;

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
                    zIndex: "2147483647",
                    padding: "10px 14px",
                    borderRadius: "10px",
                    background:
                        "rgba(17, 17, 17, 0.94)",
                    color: "#ffffff",
                    fontFamily:
                        "Arial, Helvetica, sans-serif",
                    fontSize: "13px",
                    fontWeight: "700",
                    lineHeight: "1.2",
                    letterSpacing: "0.01em",
                    boxShadow:
                        "0 6px 24px rgba(0, 0, 0, 0.28)",
                    pointerEvents: "none",
                    opacity: "1",
                    transform: "translateY(0)",
                    transition:
                        "opacity 400ms ease, transform 400ms ease"
                }
            );

            pageDocument.body.appendChild(
                badge
            );

            pageWindow.setTimeout(() => {
                badge.style.opacity = "0";
                badge.style.transform =
                    "translateY(-8px)";

                pageWindow.setTimeout(() => {
                    badge.remove();
                }, 450);
            }, CONFIG.versionBadgeDuration);
        };

        createBadge();
    }

    function easeInOutQuart(progress) {
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
            ) / 2
        );
    }

    function animateScrollTo(
        targetY,
        duration
    ) {
        if (animationFrame !== null) {
            pageWindow.cancelAnimationFrame(
                animationFrame
            );
        }

        animationToken++;

        const token =
            animationToken;

        const startY =
            getScrollTop();

        const distance =
            targetY -
            startY;

        const startTime =
            pageWindow.performance.now();

        return new Promise((resolve) => {
            function frame(now) {
                if (
                    token !==
                    animationToken
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

                pageWindow.scrollTo({
                    top:
                        startY +
                        distance *
                            easeInOutQuart(
                                progress
                            ),
                    left: 0,
                    behavior: "auto"
                });

                if (progress < 1) {
                    animationFrame =
                        pageWindow
                            .requestAnimationFrame(
                                frame
                            );

                    return;
                }

                pageWindow.scrollTo({
                    top: targetY,
                    left: 0,
                    behavior: "auto"
                });

                animationFrame = null;

                resolve(true);
            }

            animationFrame =
                pageWindow
                    .requestAnimationFrame(
                        frame
                    );
        });
    }

    /*
     * =========================================================
     * MOBILE TOUCH MODE
     * =========================================================
     */

    function saveOriginalTouchStyles() {
        if (!pageDocument.body) {
            return;
        }

        originalBodyTouchAction =
            pageDocument.body.style
                .getPropertyValue(
                    "touch-action"
                );

        originalBodyOverscroll =
            pageDocument.body.style
                .getPropertyValue(
                    "overscroll-behavior-y"
                );

        originalHtmlTouchAction =
            pageDocument.documentElement.style
                .getPropertyValue(
                    "touch-action"
                );

        originalHtmlOverscroll =
            pageDocument.documentElement.style
                .getPropertyValue(
                    "overscroll-behavior-y"
                );
    }

    function restoreOriginalTouchStyles() {
        if (!pageDocument.body) {
            return;
        }

        if (originalBodyTouchAction) {
            pageDocument.body.style
                .setProperty(
                    "touch-action",
                    originalBodyTouchAction
                );
        } else {
            pageDocument.body.style
                .removeProperty(
                    "touch-action"
                );
        }

        if (originalBodyOverscroll) {
            pageDocument.body.style
                .setProperty(
                    "overscroll-behavior-y",
                    originalBodyOverscroll
                );
        } else {
            pageDocument.body.style
                .removeProperty(
                    "overscroll-behavior-y"
                );
        }

        if (originalHtmlTouchAction) {
            pageDocument.documentElement.style
                .setProperty(
                    "touch-action",
                    originalHtmlTouchAction
                );
        } else {
            pageDocument.documentElement.style
                .removeProperty(
                    "touch-action"
                );
        }

        if (originalHtmlOverscroll) {
            pageDocument.documentElement.style
                .setProperty(
                    "overscroll-behavior-y",
                    originalHtmlOverscroll
                );
        } else {
            pageDocument.documentElement.style
                .removeProperty(
                    "overscroll-behavior-y"
                );
        }
    }

    /*
     * This is updated continuously so the browser knows whether
     * the next gesture will be native FAQ scrolling or controlled
     * snap navigation before touchstart happens.
     */
    function updateMobileTouchMode() {
        if (
            !mobileInstalled ||
            !pageDocument.body
        ) {
            return;
        }

        const nativeFaqMode =
            isInsideFaqMiddle();

        if (nativeFaqMode) {
            pageDocument.body.style
                .setProperty(
                    "touch-action",
                    "pan-y",
                    "important"
                );

            pageDocument.documentElement.style
                .setProperty(
                    "touch-action",
                    "pan-y",
                    "important"
                );

            pageDocument.body.style
                .setProperty(
                    "overscroll-behavior-y",
                    "auto",
                    "important"
                );

            pageDocument.documentElement.style
                .setProperty(
                    "overscroll-behavior-y",
                    "auto",
                    "important"
                );
        } else {
            pageDocument.body.style
                .setProperty(
                    "touch-action",
                    "none",
                    "important"
                );

            pageDocument.documentElement.style
                .setProperty(
                    "touch-action",
                    "none",
                    "important"
                );

            pageDocument.body.style
                .setProperty(
                    "overscroll-behavior-y",
                    "none",
                    "important"
                );

            pageDocument.documentElement.style
                .setProperty(
                    "overscroll-behavior-y",
                    "none",
                    "important"
                );
        }
    }

    function clearMobileRearmTimer() {
        pageWindow.clearTimeout(
            mobileRearmTimer
        );

        mobileRearmTimer = null;
    }

    function resetTouchGesture() {
        touchTracking = false;
        touchTriggered = false;
        touchNativeFaqGesture = false;

        touchStartX = 0;
        touchStartY = 0;
    }

    function isInteractiveElement(target) {
        if (
            !target ||
            target.nodeType !== 1
        ) {
            return false;
        }

        try {
            return Boolean(
                target.closest(
                    [
                        "a",
                        "button",
                        "input",
                        "textarea",
                        "select",
                        "label",
                        "[role='button']",
                        "[contenteditable='true']"
                    ].join(",")
                )
            );
        } catch {
            return false;
        }
    }

    async function mobileMoveToKey(
        targetKey
    ) {
        if (
            mobileAnimating ||
            !targetKey
        ) {
            return;
        }

        clearMobileRearmTimer();
        buildSnapPoints();

        const targetIndex =
            getSnapIndexByKey(
                targetKey
            );

        if (targetIndex === -1) {
            resetTouchGesture();

            return;
        }

        const target =
            snapPoints[targetIndex];

        mobileMovementToken++;

        const thisMovement =
            mobileMovementToken;

        mobileAnimating = true;
        touchTriggered = true;

        log(
            "Mobile moving:",
            currentSnapKey,
            "→",
            target.key
        );

        try {
            await animateScrollTo(
                target.top,
                CONFIG.mobileScrollDuration
            );

            if (
                thisMovement !==
                mobileMovementToken
            ) {
                return;
            }

            currentSnapKey =
                target.key;
        } finally {
            if (
                thisMovement ===
                mobileMovementToken
            ) {
                mobileAnimating = false;

                mobileRearmTimer =
                    pageWindow.setTimeout(
                        () => {
                            resetTouchGesture();
                            updateMobileTouchMode();
                        },
                        CONFIG.mobileRearmDelay
                    );
            }
        }
    }

    function mobileMoveOneStep(
        direction
    ) {
        buildSnapPoints();

        /*
         * Always derive mobile state from the real viewport.
         */
        const currentIndex =
            findClosestSnapIndex();

        if (currentIndex === -1) {
            resetTouchGesture();

            return;
        }

        currentSnapKey =
            snapPoints[
                currentIndex
            ].key;

        const targetIndex =
            currentIndex +
            direction;

        if (
            targetIndex < 0 ||
            targetIndex >=
                snapPoints.length
        ) {
            resetTouchGesture();

            return;
        }

        mobileMoveToKey(
            snapPoints[
                targetIndex
            ].key
        );
    }

    function mobileLeaveFaq(
        direction
    ) {
        buildSnapPoints();

        const faqIndex =
            getFaqSnapIndex();

        if (faqIndex === -1) {
            resetTouchGesture();

            return;
        }

        const targetIndex =
            faqIndex +
            direction;

        if (
            targetIndex < 0 ||
            targetIndex >=
                snapPoints.length
        ) {
            resetTouchGesture();

            return;
        }

        mobileMoveToKey(
            snapPoints[
                targetIndex
            ].key
        );
    }

    function handleMobileTouchStart(event) {
        if (
            !mobileInstalled ||
            !isMobileViewport() ||
            mobileAnimating ||
            event.touches.length !== 1
        ) {
            resetTouchGesture();

            return;
        }

        if (
            isInteractiveElement(
                event.target
            ) &&
            !isInsideFaqRange()
        ) {
            resetTouchGesture();

            return;
        }

        buildSnapPoints();

        const closestIndex =
            findClosestSnapIndex();

        if (closestIndex !== -1) {
            currentSnapKey =
                snapPoints[
                    closestIndex
                ].key;
        }

        /*
         * Decide the gesture's mode before movement begins.
         */
        touchNativeFaqGesture =
            isInsideFaqMiddle();

        const touch =
            event.touches[0];

        touchStartX =
            touch.clientX;

        touchStartY =
            touch.clientY;

        touchTracking = true;
        touchTriggered = false;

        log(
            "Mobile touchstart:",
            touchNativeFaqGesture
                ? "native FAQ"
                : "snap"
        );
    }

    function handleMobileTouchMove(event) {
        if (
            !mobileInstalled ||
            !touchTracking ||
            touchTriggered ||
            mobileAnimating ||
            event.touches.length !== 1
        ) {
            return;
        }

        const touch =
            event.touches[0];

        const deltaX =
            touch.clientX -
            touchStartX;

        const deltaY =
            touch.clientY -
            touchStartY;

        const verticalDistance =
            Math.abs(deltaY);

        const horizontalDistance =
            Math.abs(deltaX);

        const verticalGesture =
            verticalDistance >
            horizontalDistance *
                CONFIG.mobileDirectionRatio;

        if (!verticalGesture) {
            return;
        }

        /*
         * Finger moving up navigates downward.
         * Finger moving down navigates upward.
         */
        const direction =
            deltaY < 0
                ? 1
                : -1;

        /*
         * If the gesture began in the freely scrolling middle
         * of the FAQ, keep it native.
         */
        if (touchNativeFaqGesture) {
            return;
        }

        /*
         * Outside native FAQ scrolling, prevent all page movement.
         */
        event.preventDefault();
        event.stopImmediatePropagation();

        if (
            verticalDistance <
            CONFIG.mobileSwipeThreshold
        ) {
            return;
        }

        touchTriggered = true;

        const position =
            getScrollTop();

        if (
            isInsideFaqRange(position)
        ) {
            /*
             * At an FAQ boundary, move directly to the configured
             * neighboring snap point.
             */
            if (
                canFaqScrollNatively(
                    direction,
                    position
                )
            ) {
                /*
                 * This should be rare because the gesture would
                 * normally have begun in native FAQ mode.
                 */
                touchTriggered = false;
                touchNativeFaqGesture = true;
                updateMobileTouchMode();

                return;
            }

            mobileLeaveFaq(direction);

            return;
        }

        mobileMoveOneStep(direction);
    }

    function handleMobileTouchEnd() {
        /*
         * Native FAQ scrolling needs its state updated after
         * momentum and the browser's final position settle.
         */
        if (touchNativeFaqGesture) {
            pageWindow.setTimeout(
                updateMobileTouchMode,
                80
            );

            pageWindow.setTimeout(
                updateMobileTouchMode,
                250
            );
        }

        if (!mobileAnimating) {
            resetTouchGesture();
        }
    }

    function handleMobileTouchCancel() {
        if (!mobileAnimating) {
            resetTouchGesture();
        }
    }

    function handleMobileScroll() {
        if (
            !mobileInstalled ||
            mobileAnimating
        ) {
            return;
        }

        /*
         * Native FAQ scrolling can reach a boundary. Update the
         * touch-action setting before the next finger gesture.
         */
        updateMobileTouchMode();
    }

    function installMobileMode() {
        if (mobileInstalled) {
            return;
        }

        removeDesktopMode();

        buildSnapPoints();
        synchronizeCurrentKey();

        mobileInstalled = true;
        mobileAnimating = false;

        saveOriginalTouchStyles();
        updateMobileTouchMode();

        pageWindow.addEventListener(
            "touchstart",
            handleMobileTouchStart,
            {
                passive: false,
                capture: true
            }
        );

        pageWindow.addEventListener(
            "touchmove",
            handleMobileTouchMove,
            {
                passive: false,
                capture: true
            }
        );

        pageWindow.addEventListener(
            "touchend",
            handleMobileTouchEnd,
            {
                passive: true,
                capture: true
            }
        );

        pageWindow.addEventListener(
            "touchcancel",
            handleMobileTouchCancel,
            {
                passive: true,
                capture: true
            }
        );

        pageWindow.addEventListener(
            "scroll",
            handleMobileScroll,
            {
                passive: true,
                capture: true
            }
        );

        pageDocument.addEventListener(
            "scroll",
            handleMobileScroll,
            {
                passive: true,
                capture: true
            }
        );

        if (pageDocument.body) {
            pageDocument.body.addEventListener(
                "scroll",
                handleMobileScroll,
                {
                    passive: true,
                    capture: true
                }
            );
        }

        showVersionBadge(
            "mobile swipe"
        );

        log(
            "Mobile one-swipe mode enabled"
        );
    }

    function removeMobileMode() {
        if (
            !pageWindow ||
            !pageDocument
        ) {
            return;
        }

        pageWindow.removeEventListener(
            "touchstart",
            handleMobileTouchStart,
            { capture: true }
        );

        pageWindow.removeEventListener(
            "touchmove",
            handleMobileTouchMove,
            { capture: true }
        );

        pageWindow.removeEventListener(
            "touchend",
            handleMobileTouchEnd,
            { capture: true }
        );

        pageWindow.removeEventListener(
            "touchcancel",
            handleMobileTouchCancel,
            { capture: true }
        );

        pageWindow.removeEventListener(
            "scroll",
            handleMobileScroll,
            { capture: true }
        );

        pageDocument.removeEventListener(
            "scroll",
            handleMobileScroll,
            { capture: true }
        );

        if (pageDocument.body) {
            pageDocument.body.removeEventListener(
                "scroll",
                handleMobileScroll,
                { capture: true }
            );
        }

        clearMobileRearmTimer();

        if (
            mobileAnimating &&
            animationFrame !== null
        ) {
            pageWindow.cancelAnimationFrame(
                animationFrame
            );

            animationFrame = null;

            animationToken++;
        }

        restoreOriginalTouchStyles();

        mobileMovementToken++;
        mobileAnimating = false;
        mobileInstalled = false;

        resetTouchGesture();

        log(
            "Mobile one-swipe mode disabled"
        );
    }

    /*
     * =========================================================
     * DESKTOP WHEEL MODE
     * =========================================================
     */

    function getDesktopCurrentIndex() {
        const storedIndex =
            getSnapIndexByKey(
                currentSnapKey
            );

        if (storedIndex !== -1) {
            return storedIndex;
        }

        return findClosestSnapIndex();
    }

    function clearDesktopTimers() {
        pageWindow.clearTimeout(
            wheelEndTimer
        );

        pageWindow.clearTimeout(
            desktopRearmTimer
        );

        wheelEndTimer = null;
        desktopRearmTimer = null;
    }

    function scheduleDesktopRearm(token) {
        pageWindow.clearTimeout(
            desktopRearmTimer
        );

        desktopRearmTimer =
            pageWindow.setTimeout(
                () => {
                    if (
                        token !==
                        desktopMovementToken
                    ) {
                        return;
                    }

                    wheelLatched = false;
                    accumulatedWheel = 0;
                },
                CONFIG.desktopRearmDelay
            );
    }

    async function desktopMoveToKey(
        targetKey
    ) {
        if (
            desktopAnimating ||
            !targetKey
        ) {
            return;
        }

        clearDesktopTimers();
        buildSnapPoints();

        const targetIndex =
            getSnapIndexByKey(
                targetKey
            );

        if (targetIndex === -1) {
            wheelLatched = false;
            accumulatedWheel = 0;

            return;
        }

        const target =
            snapPoints[targetIndex];

        desktopMovementToken++;

        const thisMovement =
            desktopMovementToken;

        desktopAnimating = true;
        wheelLatched = true;
        accumulatedWheel = 0;

        log(
            "Desktop moving:",
            currentSnapKey,
            "→",
            target.key
        );

        try {
            await animateScrollTo(
                target.top,
                CONFIG.desktopScrollDuration
            );

            if (
                thisMovement !==
                desktopMovementToken
            ) {
                return;
            }

            currentSnapKey =
                target.key;
        } finally {
            if (
                thisMovement ===
                desktopMovementToken
            ) {
                desktopAnimating = false;

                scheduleDesktopRearm(
                    thisMovement
                );
            }
        }
    }

    function desktopMoveOneStep(
        direction
    ) {
        buildSnapPoints();

        const currentIndex =
            getDesktopCurrentIndex();

        if (currentIndex === -1) {
            wheelLatched = false;
            accumulatedWheel = 0;

            return;
        }

        const targetIndex =
            currentIndex +
            direction;

        if (
            targetIndex < 0 ||
            targetIndex >=
                snapPoints.length
        ) {
            wheelLatched = false;
            accumulatedWheel = 0;

            return;
        }

        desktopMoveToKey(
            snapPoints[
                targetIndex
            ].key
        );
    }

    function desktopLeaveFaq(
        direction
    ) {
        buildSnapPoints();

        const faqIndex =
            getFaqSnapIndex();

        if (faqIndex === -1) {
            wheelLatched = false;
            accumulatedWheel = 0;

            return;
        }

        const targetIndex =
            faqIndex +
            direction;

        if (
            targetIndex < 0 ||
            targetIndex >=
                snapPoints.length
        ) {
            wheelLatched = false;
            accumulatedWheel = 0;

            return;
        }

        desktopMoveToKey(
            snapPoints[
                targetIndex
            ].key
        );
    }

    function scheduleWheelEnd() {
        pageWindow.clearTimeout(
            wheelEndTimer
        );

        const expectedMovement =
            desktopMovementToken;

        wheelEndTimer =
            pageWindow.setTimeout(
                () => {
                    if (
                        desktopAnimating ||
                        expectedMovement !==
                            desktopMovementToken
                    ) {
                        return;
                    }

                    if (
                        isInsideFaqRange()
                    ) {
                        const faqIndex =
                            getFaqSnapIndex();

                        if (faqIndex !== -1) {
                            currentSnapKey =
                                snapPoints[
                                    faqIndex
                                ].key;
                        }
                    }

                    wheelLatched = false;
                    accumulatedWheel = 0;
                },
                CONFIG.wheelGestureEndDelay
            );
    }

    function handleDesktopWheel(event) {
        if (
            !desktopInstalled ||
            isMobileViewport() ||
            !event.deltaY
        ) {
            return;
        }

        const direction =
            event.deltaY > 0
                ? 1
                : -1;

        scheduleWheelEnd();

        if (isInsideFaqRange()) {
            const faqIndex =
                getFaqSnapIndex();

            if (faqIndex !== -1) {
                currentSnapKey =
                    snapPoints[
                        faqIndex
                    ].key;
            }

            if (
                canFaqScrollNatively(
                    direction
                )
            ) {
                wheelLatched = false;
                accumulatedWheel = 0;

                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();

            if (
                wheelLatched ||
                desktopAnimating
            ) {
                return;
            }

            accumulatedWheel +=
                event.deltaY;

            if (
                Math.abs(
                    accumulatedWheel
                ) <
                CONFIG.wheelThreshold
            ) {
                return;
            }

            wheelLatched = true;
            accumulatedWheel = 0;

            desktopLeaveFaq(
                direction
            );

            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        if (
            wheelLatched ||
            desktopAnimating
        ) {
            return;
        }

        accumulatedWheel +=
            event.deltaY;

        if (
            Math.abs(
                accumulatedWheel
            ) <
            CONFIG.wheelThreshold
        ) {
            return;
        }

        wheelLatched = true;
        accumulatedWheel = 0;

        desktopMoveOneStep(
            direction
        );
    }

    function handleDesktopResize() {
        pageWindow.setTimeout(
            () => {
                if (
                    !desktopInstalled ||
                    isMobileViewport() ||
                    desktopAnimating
                ) {
                    return;
                }

                synchronizeCurrentKey();
            },
            150
        );
    }

    function installDesktopMode() {
        if (desktopInstalled) {
            return;
        }

        removeMobileMode();

        buildSnapPoints();

        if (snapPoints.length < 2) {
            return;
        }

        synchronizeCurrentKey();

        pageWindow.addEventListener(
            "wheel",
            handleDesktopWheel,
            {
                passive: false,
                capture: true
            }
        );

        pageWindow.addEventListener(
            "resize",
            handleDesktopResize
        );

        desktopInstalled = true;

        showVersionBadge(
            "desktop JS"
        );

        log(
            "Desktop wheel mode enabled"
        );
    }

    function removeDesktopMode() {
        if (!pageWindow) {
            return;
        }

        pageWindow.removeEventListener(
            "wheel",
            handleDesktopWheel,
            { capture: true }
        );

        pageWindow.removeEventListener(
            "resize",
            handleDesktopResize
        );

        clearDesktopTimers();

        if (
            desktopAnimating &&
            animationFrame !== null
        ) {
            pageWindow.cancelAnimationFrame(
                animationFrame
            );

            animationFrame = null;

            animationToken++;
        }

        desktopMovementToken++;

        desktopAnimating = false;
        wheelLatched = false;
        accumulatedWheel = 0;
        desktopInstalled = false;

        log(
            "Desktop wheel mode disabled"
        );
    }

    /*
     * =========================================================
     * MODE SWITCHING
     * =========================================================
     */

    function applyCorrectMode() {
        if (isMobileViewport()) {
            installMobileMode();
        } else {
            installDesktopMode();
        }
    }

    function handleBreakpointChange() {
        pageWindow.clearTimeout(
            breakpointTimer
        );

        breakpointTimer =
            pageWindow.setTimeout(
                () => {
                    if (
                        isMobileViewport()
                    ) {
                        removeDesktopMode();
                        installMobileMode();
                    } else {
                        removeMobileMode();
                        installDesktopMode();
                    }
                },
                150
            );
    }

    function cleanup() {
        removeDesktopMode();
        removeMobileMode();

        if (pageWindow) {
            pageWindow.removeEventListener(
                "resize",
                handleBreakpointChange
            );

            if (
                pageWindow.visualViewport
            ) {
                pageWindow.visualViewport
                    .removeEventListener(
                        "resize",
                        handleBreakpointChange
                    );
            }

            pageWindow.clearTimeout(
                breakpointTimer
            );
        }

        if (pageDocument) {
            const badge =
                pageDocument.getElementById(
                    BADGE_ID
                );

            if (badge) {
                badge.remove();
            }
        }
    }

    function install() {
        if (
            typeof pageWindow[
                CLEANUP_KEY
            ] === "function"
        ) {
            pageWindow[
                CLEANUP_KEY
            ]();
        }

        pageWindow[
            CLEANUP_KEY
        ] = cleanup;

        pageWindow.addEventListener(
            "resize",
            handleBreakpointChange
        );

        if (
            pageWindow.visualViewport
        ) {
            pageWindow.visualViewport
                .addEventListener(
                    "resize",
                    handleBreakpointChange
                );
        }

        applyCorrectMode();

        log(
            "Installed in",
            isMobileViewport()
                ? "mobile swipe mode"
                : "desktop JS mode"
        );
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
