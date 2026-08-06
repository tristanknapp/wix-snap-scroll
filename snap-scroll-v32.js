console.log("[Wix Snap Scroll v3.2] file executing");

(() => {
    "use strict";

    const VERSION = "Wix Snap Scroll v3.2";

    const CONFIG = {
        mobileBreakpoint: 767,

        /*
         * The order here defines the navigation order.
         */
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

        heroSelector: "#comp-mrx3f3km",
        faqSelector: "#comp-mrxamx3r",

        /*
         * Desktop wheel settings.
         */
        wheelThreshold: 42,
        wheelGestureEndDelay: 220,
        desktopRearmDelay: 140,
        desktopScrollDuration: 800,

        /*
         * Mobile scroll-settle settings.
         *
         * mobileSettleDelay:
         * How long scrolling must remain quiet before snapping.
         *
         * mobileScrollDuration:
         * Duration of the final alignment animation.
         *
         * mobileMinimumMovement:
         * Ignores tiny browser toolbar and layout movements.
         */
        mobileSettleDelay: 180,
        mobileScrollDuration: 420,
        mobileMinimumMovement: 6,

        /*
         * Distance used when detecting FAQ boundaries.
         */
        edgeTolerance: 16,

        /*
         * Wix document discovery.
         */
        retryDelay: 400,
        maxRetries: 40,

        /*
         * Version badge.
         */
        showVersionBadge: true,
        versionBadgeDuration: 4000,

        debug: true
    };

    const CLEANUP_KEY =
        "__WIX_SNAP_SCROLL_V32_CLEANUP__";

    const BADGE_ID =
        "__wix-snap-scroll-version-badge__";

    let pageWindow = null;
    let pageDocument = null;

    let snapPoints = [];
    let currentSnapKey = null;

    /*
     * Shared animation state.
     */
    let animationFrame = null;
    let animationToken = 0;

    /*
     * Desktop state.
     */
    let desktopInstalled = false;
    let desktopAnimating = false;
    let wheelLatched = false;
    let accumulatedWheel = 0;
    let wheelEndTimer = null;
    let desktopRearmTimer = null;
    let desktopMovementToken = 0;

    /*
     * Mobile state.
     */
    let mobileInstalled = false;
    let mobileProgrammaticScroll = false;
    let mobileSettleTimer = null;
    let mobileUnlockTimer = null;
    let mobileLastScrollTop = 0;
    let mobilePreviousScrollTop = 0;
    let mobileDirection = 0;

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
     * Wix Custom Code may execute in a wrapper frame.
     * Locate the document containing the configured Wix sections.
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

            results.push({ win, doc });

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
            // Ignore inaccessible top-level window.
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
                    bestMatch = { win, doc };
                }
            }
        );

        if (!bestMatch || highestCount < 2) {
            return false;
        }

        pageWindow = bestMatch.win;
        pageDocument = bestMatch.doc;

        log(
            `Found page document with ` +
            `${highestCount} configured sections`
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

    /*
     * BODY is the detected Wix mobile scroll container, but
     * window.scrollY remains the reliable document scroll position.
     */
    function getScrollTop() {
        return (
            pageWindow.scrollY ||
            pageDocument.documentElement.scrollTop ||
            pageDocument.body.scrollTop ||
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
            pageWindow.visualViewport &&
            pageWindow.visualViewport.height
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
     * Builds stable snap destinations.
     *
     * Their order always follows CONFIG.sections rather than
     * Wix's temporary DOM or visual ordering.
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
                    definition.mode === "SPLIT"
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
        scrollTop = getScrollTop()
    ) {
        if (snapPoints.length === 0) {
            return -1;
        }

        let closestIndex = 0;
        let closestDistance = Infinity;

        snapPoints.forEach(
            (point, index) => {
                const distance = Math.abs(
                    scrollTop - point.top
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

        /*
         * The greatest scrollTop at which the FAQ bottom is
         * aligned to the viewport bottom.
         */
        const finalScrollTop =
            Math.max(
                top,
                bottom - viewportHeight
            );

        return {
            top,
            bottom,
            height,
            finalScrollTop
        };
    }

    function isInsideFaqFreeRange(
        scrollTop,
        faq
    ) {
        if (!faq) {
            return false;
        }

        return (
            scrollTop >
                faq.top +
                    CONFIG.edgeTolerance &&
            scrollTop <
                faq.finalScrollTop -
                    CONFIG.edgeTolerance
        );
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

            const previousBadge =
                pageDocument.getElementById(
                    BADGE_ID
                );

            if (previousBadge) {
                previousBadge.remove();
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
                        "opacity 400ms ease, " +
                        "transform 400ms ease"
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

    /*
     * Shared controlled scroll animation.
     */
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
            targetY - startY;

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
     * MOBILE SCROLL-SETTLE ENGINE
     * =========================================================
     */

    function clearMobileTimers() {
        pageWindow.clearTimeout(
            mobileSettleTimer
        );

        pageWindow.clearTimeout(
            mobileUnlockTimer
        );

        mobileSettleTimer = null;
        mobileUnlockTimer = null;
    }

    function chooseMobileTargetIndex(
        scrollTop
    ) {
        const faq =
            getFaqBounds();

        const faqIndex =
            getFaqSnapIndex();

        /*
         * Leave the middle of the FAQ completely untouched.
         */
        if (
            faq &&
            isInsideFaqFreeRange(
                scrollTop,
                faq
            )
        ) {
            return null;
        }

        /*
         * At the bottom edge of the FAQ, a downward gesture
         * targets the section immediately after it.
         */
        if (
            faq &&
            faqIndex !== -1 &&
            mobileDirection > 0 &&
            scrollTop >=
                faq.finalScrollTop -
                    CONFIG.edgeTolerance
        ) {
            const nextIndex =
                faqIndex + 1;

            if (
                nextIndex <
                snapPoints.length
            ) {
                return nextIndex;
            }
        }

        /*
         * At the top edge of the FAQ, an upward gesture targets
         * the section immediately before it.
         */
        if (
            faq &&
            faqIndex !== -1 &&
            mobileDirection < 0 &&
            scrollTop <=
                faq.top +
                    CONFIG.edgeTolerance &&
            scrollTop >=
                faq.top -
                    getViewportHeight()
        ) {
            const previousIndex =
                faqIndex - 1;

            if (previousIndex >= 0) {
                return previousIndex;
            }
        }

        /*
         * Everywhere else, align to the nearest configured point.
         */
        return findClosestSnapIndex(
            scrollTop
        );
    }

    async function settleMobileScroll() {
        if (
            !mobileInstalled ||
            mobileProgrammaticScroll ||
            !isMobileViewport()
        ) {
            return;
        }

        buildSnapPoints();

        const scrollTop =
            getScrollTop();

        const targetIndex =
            chooseMobileTargetIndex(
                scrollTop
            );

        /*
         * null means the viewport is in the free-scrolling
         * middle of the FAQ.
         */
        if (
            targetIndex === null ||
            targetIndex < 0 ||
            targetIndex >=
                snapPoints.length
        ) {
            return;
        }

        const target =
            snapPoints[targetIndex];

        const distance =
            Math.abs(
                target.top - scrollTop
            );

        /*
         * Ignore tiny toolbar/layout changes.
         */
        if (
            distance <
            CONFIG.mobileMinimumMovement
        ) {
            currentSnapKey =
                target.key;

            return;
        }

        mobileProgrammaticScroll = true;
        currentSnapKey = target.key;

        log(
            "Mobile settling:",
            `y=${Math.round(scrollTop)}`,
            "→",
            target.key,
            `y=${target.top}`
        );

        try {
            await animateScrollTo(
                target.top,
                CONFIG.mobileScrollDuration
            );
        } finally {
            pageWindow.clearTimeout(
                mobileUnlockTimer
            );

            mobileUnlockTimer =
                pageWindow.setTimeout(() => {
                    mobileProgrammaticScroll =
                        false;

                    mobilePreviousScrollTop =
                        getScrollTop();

                    mobileLastScrollTop =
                        mobilePreviousScrollTop;
                }, 100);
        }
    }

    function handleMobileScroll() {
        if (
            !mobileInstalled ||
            mobileProgrammaticScroll ||
            !isMobileViewport()
        ) {
            return;
        }

        const currentTop =
            getScrollTop();

        const difference =
            currentTop -
            mobileLastScrollTop;

        if (
            Math.abs(difference) >= 1
        ) {
            mobileDirection =
                difference > 0
                    ? 1
                    : -1;

            mobilePreviousScrollTop =
                mobileLastScrollTop;

            mobileLastScrollTop =
                currentTop;
        }

        pageWindow.clearTimeout(
            mobileSettleTimer
        );

        mobileSettleTimer =
            pageWindow.setTimeout(
                settleMobileScroll,
                CONFIG.mobileSettleDelay
            );
    }

    function installMobileMode() {
        if (mobileInstalled) {
            return;
        }

        removeDesktopMode();

        /*
         * Remove CSS snapping left behind by the diagnostic version.
         */
        pageDocument.documentElement
            .style.removeProperty(
                "scroll-snap-type"
            );

        if (pageDocument.body) {
            pageDocument.body.style
                .removeProperty(
                    "scroll-snap-type"
                );

            pageDocument.body.style
                .removeProperty(
                    "scroll-behavior"
                );

            pageDocument.body.style
                .removeProperty(
                    "-webkit-overflow-scrolling"
                );

            /*
             * Keep Wix's normal mobile overflow.
             */
        }

        const oldStyle =
            pageDocument.getElementById(
                "__wix-snap-scroll-mobile-style__"
            );

        if (oldStyle) {
            oldStyle.remove();
        }

        pageDocument
            .querySelectorAll(
                ".__wix-snap-scroll-hero-midpoint__"
            )
            .forEach((element) => {
                element.remove();
            });

        buildSnapPoints();

        mobilePreviousScrollTop =
            getScrollTop();

        mobileLastScrollTop =
            mobilePreviousScrollTop;

        mobileDirection = 0;
        mobileProgrammaticScroll = false;

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

        /*
         * BODY was confirmed as Wix's scrolling element.
         * Add the listener there as well for browser differences.
         */
        if (pageDocument.body) {
            pageDocument.body
                .addEventListener(
                    "scroll",
                    handleMobileScroll,
                    {
                        passive: true,
                        capture: true
                    }
                );
        }

        mobileInstalled = true;

        showVersionBadge(
            "mobile settle"
        );

        log(
            "Mobile scroll-settle mode enabled"
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
            pageDocument.body
                .removeEventListener(
                    "scroll",
                    handleMobileScroll,
                    { capture: true }
                );
        }

        clearMobileTimers();

        mobileProgrammaticScroll = false;
        mobileInstalled = false;

        log(
            "Mobile scroll-settle mode disabled"
        );
    }

    /*
     * =========================================================
     * DESKTOP WHEEL ENGINE
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

    function getActiveDesktopFaq() {
        const faq =
            getFaqBounds();

        if (!faq) {
            return null;
        }

        const scrollTop =
            getScrollTop();

        if (
            scrollTop >=
                faq.top -
                    CONFIG.edgeTolerance &&
            scrollTop <=
                faq.finalScrollTop +
                    CONFIG.edgeTolerance
        ) {
            return faq;
        }

        return null;
    }

    function shouldAllowDesktopFaqScroll(
        direction,
        faq
    ) {
        if (!faq) {
            return false;
        }

        const scrollTop =
            getScrollTop();

        if (
            direction > 0 &&
            scrollTop <
                faq.finalScrollTop -
                    CONFIG.edgeTolerance
        ) {
            return true;
        }

        if (
            direction < 0 &&
            scrollTop >
                faq.top +
                    CONFIG.edgeTolerance
        ) {
            return true;
        }

        return false;
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
            pageWindow.setTimeout(() => {
                if (
                    token !==
                    desktopMovementToken
                ) {
                    return;
                }

                wheelLatched = false;
                accumulatedWheel = 0;
            }, CONFIG.desktopRearmDelay);
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
            currentIndex + direction;

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
            snapPoints[targetIndex].key
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
            faqIndex + direction;

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
            snapPoints[targetIndex].key
        );
    }

    function scheduleWheelEnd() {
        pageWindow.clearTimeout(
            wheelEndTimer
        );

        const expectedMovement =
            desktopMovementToken;

        wheelEndTimer =
            pageWindow.setTimeout(() => {
                if (
                    desktopAnimating ||
                    expectedMovement !==
                        desktopMovementToken
                ) {
                    return;
                }

                const faq =
                    getActiveDesktopFaq();

                if (faq) {
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
            }, CONFIG.wheelGestureEndDelay);
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

        const faq =
            getActiveDesktopFaq();

        if (faq) {
            const faqIndex =
                getFaqSnapIndex();

            if (faqIndex !== -1) {
                currentSnapKey =
                    snapPoints[
                        faqIndex
                    ].key;
            }

            if (
                shouldAllowDesktopFaqScroll(
                    direction,
                    faq
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
        pageWindow.setTimeout(() => {
            if (
                !desktopInstalled ||
                isMobileViewport() ||
                desktopAnimating
            ) {
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
        }, 150);
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

        const closestIndex =
            findClosestSnapIndex();

        if (closestIndex === -1) {
            return;
        }

        currentSnapKey =
            snapPoints[
                closestIndex
            ].key;

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

        if (animationFrame !== null) {
            pageWindow.cancelAnimationFrame(
                animationFrame
            );

            animationFrame = null;
        }

        animationToken++;
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
            pageWindow.setTimeout(() => {
                if (isMobileViewport()) {
                    removeDesktopMode();
                    installMobileMode();
                } else {
                    removeMobileMode();
                    installDesktopMode();
                }
            }, 150);
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

        pageWindow[CLEANUP_KEY] =
            cleanup;

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
                ? "mobile settle mode"
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
                `[${VERSION}] Unable to find ` +
                `configured Wix sections`
            );
        }
    }

    initialize();
})();
