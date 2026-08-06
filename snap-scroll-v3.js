console.log("[Wix Snap Scroll v3.0] file executing");

(() => {
    "use strict";

    const VERSION = "Wix Snap Scroll v3.0";

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

        heroSelector: "#comp-mrx3f3km",
        faqSelector: "#comp-mrxamx3r",

        // Desktop wheel behavior.
        wheelThreshold: 42,
        gestureEndDelay: 220,
        postAnimationRearmDelay: 140,

        // Desktop animation.
        scrollDuration: 800,
        edgeTolerance: 12,

        // Wix document detection.
        retryDelay: 400,
        maxRetries: 40,

        // Version badge.
        showVersionBadge: true,
        versionBadgeDuration: 4000,

        debug: true
    };

    const CLEANUP_KEY =
        "__WIX_SNAP_SCROLL_V3_CLEANUP__";

    const BADGE_ID =
        "__wix-snap-scroll-version-badge__";

    const MOBILE_STYLE_ID =
        "__wix-snap-scroll-mobile-style__";

    const HERO_MARKER_CLASS =
        "__wix-snap-scroll-hero-midpoint__";

    let pageWindow = null;
    let pageDocument = null;

    let snapPoints = [];
    let currentSnapKey = null;

    let animating = false;
    let gestureLatched = false;
    let accumulatedDelta = 0;

    let gestureEndTimer = null;
    let rearmTimer = null;

    let animationFrame = null;
    let animationToken = 0;
    let movementToken = 0;

    let retries = 0;

    let desktopInstalled = false;
    let mobileInstalled = false;

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
     * Wix Custom Code may run in a wrapper document.
     * Search accessible documents for the one containing
     * the configured Wix sections.
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

    function getPageTop(element) {
        return (
            element.getBoundingClientRect().top +
            pageWindow.scrollY
        );
    }

    function getViewportHeight() {
        /*
         * On desktop, innerHeight is more stable for the custom
         * animation. Mobile uses CSS dvh instead.
         */
        return pageWindow.innerHeight;
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
                pageDocument.createElement("div");

            badge.id = BADGE_ID;
            badge.textContent =
                `${VERSION} · ${mode}`;

            Object.assign(badge.style, {
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
            });

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

    /*
     * =========================================================
     * MOBILE: NATIVE CSS SCROLL SNAP
     * =========================================================
     */

    function createMobileCss() {
        const ordinarySectionSelectors =
            CONFIG.sections
                .filter(
                    (definition) =>
                        definition.mode === "SNAP"
                )
                .map(
                    (definition) =>
                        definition.selector
                )
                .join(",\n");

        return `
@media (max-width: ${CONFIG.mobileBreakpoint}px) {
    html {
        scroll-snap-type: y mandatory !important;
        scroll-padding-top: 0 !important;
        scroll-behavior: smooth;
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch;
    }

    body {
        overflow-y: visible !important;
        min-height: 100%;
        overscroll-behavior-y: auto;
    }

    ${ordinarySectionSelectors} {
        scroll-snap-align: start !important;
        scroll-snap-stop: always !important;
    }

    ${CONFIG.heroSelector} {
        position: relative !important;
        scroll-snap-align: start !important;
        scroll-snap-stop: always !important;
    }

    ${CONFIG.faqSelector} {
        scroll-snap-align: start !important;
        scroll-snap-stop: normal !important;
        height: auto !important;
        min-height: 100dvh;
    }

    .${HERO_MARKER_CLASS} {
        position: absolute !important;
        top: 100dvh !important;
        left: 0 !important;
        width: 1px !important;
        height: 1px !important;
        padding: 0 !important;
        margin: 0 !important;
        border: 0 !important;
        opacity: 0 !important;
        pointer-events: none !important;
        scroll-snap-align: start !important;
        scroll-snap-stop: always !important;
    }
}
        `;
    }

    function injectMobileStyles() {
        let style =
            pageDocument.getElementById(
                MOBILE_STYLE_ID
            );

        if (!style) {
            style =
                pageDocument.createElement(
                    "style"
                );

            style.id = MOBILE_STYLE_ID;

            (
                pageDocument.head ||
                pageDocument.documentElement
            ).appendChild(style);
        }

        style.textContent =
            createMobileCss();

        log("Mobile scroll-snap CSS injected");
    }

    function insertHeroMidpointMarker() {
        const hero =
            getElement(CONFIG.heroSelector);

        if (!hero) {
            log("Hero section not found");
            return;
        }

        let marker =
            hero.querySelector(
                `.${HERO_MARKER_CLASS}`
            );

        if (marker) {
            return;
        }

        marker =
            pageDocument.createElement(
                "div"
            );

        marker.className =
            HERO_MARKER_CLASS;

        marker.setAttribute(
            "aria-hidden",
            "true"
        );

        hero.appendChild(marker);

        log("Hero midpoint marker inserted");
    }

    function removeHeroMidpointMarker() {
        const markers =
            pageDocument.querySelectorAll(
                `.${HERO_MARKER_CLASS}`
            );

        markers.forEach((marker) => {
            marker.remove();
        });
    }

    function enableMobileMode() {
        if (mobileInstalled) {
            return;
        }

        removeDesktopListeners();

        injectMobileStyles();
        insertHeroMidpointMarker();

        mobileInstalled = true;

        showVersionBadge("mobile CSS");

        log(
            "Mobile native CSS snapping enabled"
        );
    }

    function disableMobileMode() {
        if (!pageDocument) {
            return;
        }

        const style =
            pageDocument.getElementById(
                MOBILE_STYLE_ID
            );

        if (style) {
            style.remove();
        }

        removeHeroMidpointMarker();

        mobileInstalled = false;

        log("Mobile CSS snapping disabled");
    }

    /*
     * =========================================================
     * DESKTOP: JAVASCRIPT WHEEL SNAP ENGINE
     * =========================================================
     */

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

                    const finalTop =
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
                                    finalTop
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

        /*
         * Navigation order is defined by CONFIG.sections,
         * not temporary layout positions.
         */
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
            `Built ${snapPoints.length} ` +
            `desktop snap points`
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

    function findClosestSnapIndex() {
        if (snapPoints.length === 0) {
            return -1;
        }

        let closestIndex = 0;
        let closestDistance = Infinity;

        snapPoints.forEach(
            (point, index) => {
                const distance =
                    Math.abs(
                        pageWindow.scrollY -
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

    function getCurrentSnapIndex() {
        const storedIndex =
            getSnapIndexByKey(
                currentSnapKey
            );

        if (storedIndex !== -1) {
            return storedIndex;
        }

        return findClosestSnapIndex();
    }

    function getActiveFaq() {
        const faq =
            getElement(
                CONFIG.faqSelector
            );

        if (!faq) {
            return null;
        }

        const viewportTop =
            pageWindow.scrollY;

        const top =
            getPageTop(faq);

        const height =
            faq.getBoundingClientRect().height;

        const bottom =
            top + height;

        const active =
            viewportTop >=
                top -
                    CONFIG.edgeTolerance &&
            viewportTop <
                bottom -
                    CONFIG.edgeTolerance;

        if (!active) {
            return null;
        }

        return {
            top,
            bottom,
            height
        };
    }

    function attachCurrentKeyToFaq() {
        const faqIndex =
            getFaqSnapIndex();

        if (faqIndex === -1) {
            return false;
        }

        currentSnapKey =
            snapPoints[faqIndex].key;

        return true;
    }

    function shouldAllowFaqNativeScroll(
        direction,
        faq
    ) {
        if (!faq) {
            return false;
        }

        const viewportTop =
            pageWindow.scrollY;

        const viewportBottom =
            viewportTop +
            pageWindow.innerHeight;

        if (
            direction > 0 &&
            viewportBottom <
                faq.bottom -
                    CONFIG.edgeTolerance
        ) {
            return true;
        }

        if (
            direction < 0 &&
            viewportTop >
                faq.top +
                    CONFIG.edgeTolerance
        ) {
            return true;
        }

        return false;
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

    function animateScrollTo(targetY) {
        if (animationFrame !== null) {
            pageWindow.cancelAnimationFrame(
                animationFrame
            );
        }

        animationToken++;

        const token =
            animationToken;

        const startY =
            pageWindow.scrollY;

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
                            CONFIG.scrollDuration,
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

    function clearDesktopTimers() {
        pageWindow.clearTimeout(
            gestureEndTimer
        );

        pageWindow.clearTimeout(
            rearmTimer
        );

        gestureEndTimer = null;
        rearmTimer = null;
    }

    function scheduleRearm(token) {
        pageWindow.clearTimeout(
            rearmTimer
        );

        rearmTimer =
            pageWindow.setTimeout(() => {
                if (
                    token !== movementToken
                ) {
                    return;
                }

                gestureLatched = false;
                accumulatedDelta = 0;

                log(
                    "Desktop re-armed at",
                    currentSnapKey
                );
            }, CONFIG.postAnimationRearmDelay);
    }

    async function moveToSnapKey(
        targetKey
    ) {
        if (
            animating ||
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
            gestureLatched = false;
            accumulatedDelta = 0;
            return;
        }

        const target =
            snapPoints[targetIndex];

        movementToken++;

        const thisMovement =
            movementToken;

        animating = true;
        gestureLatched = true;
        accumulatedDelta = 0;

        log(
            "Desktop moving:",
            currentSnapKey,
            "→",
            target.key
        );

        try {
            await animateScrollTo(
                target.top
            );

            if (
                thisMovement !==
                movementToken
            ) {
                return;
            }

            currentSnapKey =
                target.key;
        } catch (error) {
            console.error(
                `[${VERSION}] animation error`,
                error
            );
        } finally {
            if (
                thisMovement ===
                movementToken
            ) {
                animating = false;
                scheduleRearm(
                    thisMovement
                );
            }
        }
    }

    function moveOneStep(direction) {
        buildSnapPoints();

        const currentIndex =
            getCurrentSnapIndex();

        if (currentIndex === -1) {
            gestureLatched = false;
            accumulatedDelta = 0;
            return;
        }

        const targetIndex =
            currentIndex + direction;

        if (
            targetIndex < 0 ||
            targetIndex >=
                snapPoints.length
        ) {
            gestureLatched = false;
            accumulatedDelta = 0;
            return;
        }

        moveToSnapKey(
            snapPoints[targetIndex].key
        );
    }

    function leaveFaq(direction) {
        buildSnapPoints();

        const faqIndex =
            getFaqSnapIndex();

        if (faqIndex === -1) {
            gestureLatched = false;
            accumulatedDelta = 0;
            return;
        }

        const targetIndex =
            faqIndex + direction;

        if (
            targetIndex < 0 ||
            targetIndex >=
                snapPoints.length
        ) {
            gestureLatched = false;
            accumulatedDelta = 0;
            return;
        }

        moveToSnapKey(
            snapPoints[targetIndex].key
        );
    }

    function scheduleGestureEnd() {
        pageWindow.clearTimeout(
            gestureEndTimer
        );

        const expectedMovement =
            movementToken;

        gestureEndTimer =
            pageWindow.setTimeout(() => {
                if (
                    animating ||
                    expectedMovement !==
                        movementToken
                ) {
                    return;
                }

                if (getActiveFaq()) {
                    attachCurrentKeyToFaq();
                }

                gestureLatched = false;
                accumulatedDelta = 0;
            }, CONFIG.gestureEndDelay);
    }

    function handleWheel(event) {
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

        scheduleGestureEnd();

        const activeFaq =
            getActiveFaq();

        if (activeFaq) {
            attachCurrentKeyToFaq();

            if (
                shouldAllowFaqNativeScroll(
                    direction,
                    activeFaq
                )
            ) {
                gestureLatched = false;
                accumulatedDelta = 0;
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();

            if (
                gestureLatched ||
                animating
            ) {
                return;
            }

            accumulatedDelta +=
                event.deltaY;

            if (
                Math.abs(
                    accumulatedDelta
                ) <
                CONFIG.wheelThreshold
            ) {
                return;
            }

            gestureLatched = true;
            accumulatedDelta = 0;

            leaveFaq(direction);
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        if (
            gestureLatched ||
            animating
        ) {
            return;
        }

        accumulatedDelta +=
            event.deltaY;

        if (
            Math.abs(
                accumulatedDelta
            ) <
            CONFIG.wheelThreshold
        ) {
            return;
        }

        gestureLatched = true;
        accumulatedDelta = 0;

        moveOneStep(direction);
    }

    function handleAccordionClick(event) {
        if (
            !event.target.closest(
                ".wixui-accordion, " +
                ".wixui-accordion__item"
            )
        ) {
            return;
        }

        pageWindow.setTimeout(() => {
            if (!isMobileViewport()) {
                buildSnapPoints();

                if (getActiveFaq()) {
                    attachCurrentKeyToFaq();
                }
            }
        }, 650);
    }

    function handleDesktopResize() {
        pageWindow.setTimeout(() => {
            if (
                !desktopInstalled ||
                isMobileViewport()
            ) {
                return;
            }

            buildSnapPoints();

            if (animating) {
                return;
            }

            if (getActiveFaq()) {
                attachCurrentKeyToFaq();
                return;
            }

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

        disableMobileMode();

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
            handleWheel,
            {
                passive: false,
                capture: true
            }
        );

        pageWindow.addEventListener(
            "resize",
            handleDesktopResize
        );

        pageDocument.addEventListener(
            "click",
            handleAccordionClick
        );

        desktopInstalled = true;

        showVersionBadge("desktop JS");

        log(
            "Desktop JavaScript snapping enabled"
        );
    }

    function removeDesktopListeners() {
        if (
            !pageWindow ||
            !pageDocument
        ) {
            return;
        }

        pageWindow.removeEventListener(
            "wheel",
            handleWheel,
            { capture: true }
        );

        pageWindow.removeEventListener(
            "resize",
            handleDesktopResize
        );

        pageDocument.removeEventListener(
            "click",
            handleAccordionClick
        );

        clearDesktopTimers();

        if (animationFrame !== null) {
            pageWindow.cancelAnimationFrame(
                animationFrame
            );

            animationFrame = null;
        }

        animationToken++;
        movementToken++;

        animating = false;
        gestureLatched = false;
        accumulatedDelta = 0;

        desktopInstalled = false;
    }

    /*
     * =========================================================
     * MODE SWITCHING
     * =========================================================
     */

    function applyCorrectMode() {
        if (isMobileViewport()) {
            enableMobileMode();
        } else {
            installDesktopMode();
        }
    }

    function handleBreakpointChange() {
        const shouldUseMobile =
            isMobileViewport();

        log(
            "Breakpoint change:",
            shouldUseMobile
                ? "mobile"
                : "desktop"
        );

        if (shouldUseMobile) {
            removeDesktopListeners();
            enableMobileMode();
        } else {
            disableMobileMode();
            installDesktopMode();
        }
    }

    function installGlobalResizeWatcher() {
        pageWindow.addEventListener(
            "resize",
            handleBreakpointChange
        );

        if (pageWindow.visualViewport) {
            pageWindow.visualViewport
                .addEventListener(
                    "resize",
                    handleBreakpointChange
                );
        }
    }

    function cleanup() {
        removeDesktopListeners();
        disableMobileMode();

        if (
            pageWindow &&
            pageDocument
        ) {
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

        installGlobalResizeWatcher();
        applyCorrectMode();

        log(
            "Installed in",
            isMobileViewport()
                ? "mobile CSS mode"
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
