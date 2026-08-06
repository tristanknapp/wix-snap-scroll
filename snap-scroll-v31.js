console.log("[Wix Snap Scroll v3.1-diagnostic] file executing");

(() => {
    "use strict";

    const VERSION = "Wix Snap Scroll v3.1-diagnostic";

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

        wheelThreshold: 42,
        gestureEndDelay: 220,
        postAnimationRearmDelay: 140,

        scrollDuration: 800,
        edgeTolerance: 12,

        retryDelay: 400,
        maxRetries: 40,

        showVersionBadge: true,
        versionBadgeDuration: 4000,

        /*
         * Shows the mobile scroll-container diagnostic once.
         */
        showMobileDiagnosticPopup: true,

        debug: true
    };

    const CLEANUP_KEY =
        "__WIX_SNAP_SCROLL_V31_CLEANUP__";

    const BADGE_ID =
        "__wix-snap-scroll-version-badge__";

    const MOBILE_STYLE_ID =
        "__wix-snap-scroll-mobile-style__";

    const HERO_MARKER_CLASS =
        "__wix-snap-scroll-hero-midpoint__";

    let pageWindow = null;
    let pageDocument = null;
    let mobileScrollContainer = null;

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
    let diagnosticShown = false;

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
                // Ignore inaccessible frames.
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

    function getPageTop(element) {
        return (
            element.getBoundingClientRect().top +
            pageWindow.scrollY
        );
    }

    function getViewportHeight() {
        return pageWindow.innerHeight;
    }

    function describeElement(element) {
        if (!element) {
            return "(none)";
        }

        if (
            element ===
            pageDocument.scrollingElement
        ) {
            return "document.scrollingElement";
        }

        const tag =
            element.tagName || "unknown";

        const id =
            element.id
                ? `#${element.id}`
                : "";

        let classes = "";

        try {
            if (
                typeof element.className ===
                "string" &&
                element.className.trim()
            ) {
                classes =
                    "." +
                    element.className
                        .trim()
                        .split(/\s+/)
                        .slice(0, 3)
                        .join(".");
            }
        } catch {
            // Ignore class-name errors.
        }

        return `${tag}${id}${classes}`;
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
                    boxShadow:
                        "0 6px 24px rgba(0, 0, 0, 0.28)",
                    pointerEvents: "none",
                    opacity: "1",
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

    /*
     * =========================================================
     * MOBILE SCROLL-CONTAINER DETECTION
     * =========================================================
     */

    function findMobileScrollContainer() {
        const hero =
            getElement(CONFIG.heroSelector);

        if (!hero) {
            return (
                pageDocument.scrollingElement ||
                pageDocument.documentElement
            );
        }

        let element = hero.parentElement;

        while (element) {
            let style;

            try {
                style =
                    pageWindow.getComputedStyle(
                        element
                    );
            } catch {
                style = null;
            }

            const overflowY =
                style
                    ? style.overflowY
                    : "";

            const canScroll =
                element.scrollHeight >
                element.clientHeight + 10;

            const allowsScrolling =
                overflowY === "auto" ||
                overflowY === "scroll" ||
                overflowY === "overlay";

            log(
                "Checking mobile scroll ancestor:",
                describeElement(element),
                {
                    overflowY,
                    scrollHeight:
                        element.scrollHeight,
                    clientHeight:
                        element.clientHeight,
                    canScroll,
                    allowsScrolling
                }
            );

            if (
                canScroll &&
                allowsScrolling
            ) {
                return element;
            }

            element = element.parentElement;
        }

        return (
            pageDocument.scrollingElement ||
            pageDocument.documentElement
        );
    }

    function showMobileDiagnostic() {
        if (
            diagnosticShown ||
            !CONFIG.showMobileDiagnosticPopup ||
            !mobileScrollContainer
        ) {
            return;
        }

        diagnosticShown = true;

        let overflowY = "(unknown)";

        try {
            overflowY =
                pageWindow.getComputedStyle(
                    mobileScrollContainer
                ).overflowY;
        } catch {
            // Ignore.
        }

        const message = [
            VERSION,
            "",
            "Detected mobile scroll container:",
            describeElement(
                mobileScrollContainer
            ),
            "",
            `scrollHeight: ${mobileScrollContainer.scrollHeight}`,
            `clientHeight: ${mobileScrollContainer.clientHeight}`,
            `scrollTop: ${mobileScrollContainer.scrollTop}`,
            `overflowY: ${overflowY}`,
            "",
            `document scrollHeight: ${
                pageDocument.scrollingElement
                    ?.scrollHeight || 0
            }`,
            `document clientHeight: ${
                pageDocument.scrollingElement
                    ?.clientHeight || 0
            }`
        ].join("\n");

        try {
            pageWindow.alert(message);
        } catch (error) {
            log(
                "Could not show diagnostic popup",
                error
            );
        }
    }

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
    html,
    body {
        -webkit-overflow-scrolling: touch;
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

        log("Mobile CSS injected");
    }

    function applySnapToDetectedContainer() {
        if (!mobileScrollContainer) {
            return;
        }

        mobileScrollContainer.style.setProperty(
            "scroll-snap-type",
            "y mandatory",
            "important"
        );

        mobileScrollContainer.style.setProperty(
            "scroll-behavior",
            "smooth",
            "important"
        );

        mobileScrollContainer.style.setProperty(
            "-webkit-overflow-scrolling",
            "touch",
            "important"
        );

        /*
         * Only force overflow when this is not the document-level
         * scrolling element.
         */
        if (
            mobileScrollContainer !==
            pageDocument.scrollingElement
        ) {
            mobileScrollContainer.style.setProperty(
                "overflow-y",
                "auto",
                "important"
            );

            mobileScrollContainer.style.setProperty(
                "height",
                "100dvh",
                "important"
            );
        } else {
            pageDocument.documentElement
                .style.setProperty(
                    "scroll-snap-type",
                    "y mandatory",
                    "important"
                );

            if (pageDocument.body) {
                pageDocument.body
                    .style.setProperty(
                        "scroll-snap-type",
                        "y mandatory",
                        "important"
                    );
            }
        }

        log(
            "Applied snap type to:",
            describeElement(
                mobileScrollContainer
            )
        );
    }

    function clearDetectedContainerStyles() {
        if (!mobileScrollContainer) {
            return;
        }

        const properties = [
            "scroll-snap-type",
            "scroll-behavior",
            "-webkit-overflow-scrolling",
            "overflow-y",
            "height"
        ];

        properties.forEach((property) => {
            mobileScrollContainer.style
                .removeProperty(property);
        });

        pageDocument.documentElement
            .style.removeProperty(
                "scroll-snap-type"
            );

        if (pageDocument.body) {
            pageDocument.body
                .style.removeProperty(
                    "scroll-snap-type"
                );
        }

        mobileScrollContainer = null;
    }

    function insertHeroMidpointMarker() {
        const hero =
            getElement(CONFIG.heroSelector);

        if (!hero) {
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
        pageDocument
            .querySelectorAll(
                `.${HERO_MARKER_CLASS}`
            )
            .forEach((marker) => {
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

        mobileScrollContainer =
            findMobileScrollContainer();

        applySnapToDetectedContainer();
        showMobileDiagnostic();

        mobileInstalled = true;

        showVersionBadge(
            "mobile diagnostic"
        );

        log(
            "Mobile mode enabled with container:",
            describeElement(
                mobileScrollContainer
            )
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

        clearDetectedContainerStyles();
        removeHeroMidpointMarker();

        mobileInstalled = false;

        log("Mobile mode disabled");
    }

    /*
     * =========================================================
     * DESKTOP ENGINE
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
            `Built ${snapPoints.length} desktop snap points`
        );
    }

    function getSnapIndexByKey(key) {
        if (!key) {
            return -1;
        }

        return snapPoints.findIndex(
            (point) =>
                point.key === key
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
        if (!snapPoints.length) {
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
                    closestIndex =
                        index;
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
                    token !==
                    movementToken
                ) {
                    return;
                }

                gestureLatched = false;
                accumulatedDelta = 0;
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

        desktopInstalled = true;

        showVersionBadge("desktop JS");

        log(
            "Desktop mode enabled"
        );
    }

    function removeDesktopListeners() {
        if (!pageWindow) {
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

    function applyCorrectMode() {
        if (isMobileViewport()) {
            enableMobileMode();
        } else {
            installDesktopMode();
        }
    }

    function handleBreakpointChange() {
        if (isMobileViewport()) {
            removeDesktopListeners();
            enableMobileMode();
        } else {
            disableMobileMode();
            installDesktopMode();
        }
    }

    function cleanup() {
        removeDesktopListeners();
        disableMobileMode();

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
