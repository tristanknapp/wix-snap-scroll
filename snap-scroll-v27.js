console.log("[Wix Snap Scroll v2.7] file executing");

(function () {
    const VERSION = "Wix Snap Scroll v2.7";

    const badge = document.createElement("div");
    badge.textContent = VERSION;

    badge.style.position = "fixed";
    badge.style.top = "16px";
    badge.style.right = "16px";
    badge.style.padding = "10px 14px";
    badge.style.background = "#111";
    badge.style.color = "#fff";
    badge.style.borderRadius = "10px";
    badge.style.font = "600 14px system-ui";
    badge.style.zIndex = "999999";
    badge.style.pointerEvents = "none";
    badge.style.opacity = "0.95";
    badge.style.transition = "opacity .5s ease";

    document.addEventListener("DOMContentLoaded", () => {
        document.body.appendChild(badge);

        setTimeout(() => {
            badge.style.opacity = "0";
            setTimeout(() => badge.remove(), 500);
        }, 2500);
    });
})();

(() => {
    "use strict";

    const CONFIG = {
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

        // Desktop
        wheelThreshold: 42,
        gestureEndDelay: 220,
        postAnimationRearmDelay: 140,

        // Mobile
        touchThreshold: 55,
        touchDirectionRatio: 1.15,
        touchCooldown: 250,

        scrollDuration: 800,
        edgeTolerance: 12,

        retryDelay: 400,
        maxRetries: 40,

        debug: true
    };

    const CLEANUP_KEY =
        "__WIX_SNAP_SCROLL_CLEANUP__";

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

    let touchStartX = 0;
    let touchStartY = 0;
    let touchTracking = false;
    let touchTriggered = false;
    let touchBlocked = false;
    let touchCooldownTimer = null;

    let retries = 0;

    function log(...args) {
        if (CONFIG.debug) {
            console.log(
                "[Wix Snap Scroll v2.7]",
                ...args
            );
        }
    }

    function clearInteractionTimers() {
        if (!pageWindow) return;

        pageWindow.clearTimeout(
            gestureEndTimer
        );

        pageWindow.clearTimeout(
            rearmTimer
        );

        pageWindow.clearTimeout(
            touchCooldownTimer
        );

        gestureEndTimer = null;
        rearmTimer = null;
        touchCooldownTimer = null;
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

    function getPageTop(element) {
        return (
            element.getBoundingClientRect().top +
            pageWindow.scrollY
        );
    }

    function getViewportHeight() {
        if (
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

    function buildSnapPoints() {
        const viewportHeight =
            getViewportHeight();

        const points = [];

        CONFIG.sections.forEach(
            (definition, configuredIndex) => {
                const element = getElement(
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
                    definition.mode === "SPLIT"
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
            `Built ${snapPoints.length} snap points`
        );
    }

    function getSnapIndexByKey(key) {
        if (!key) return -1;

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
            faq.getBoundingClientRect()
                .height;

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
            getViewportHeight();

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
                Math.pow(
                    progress,
                    4
                )
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

    function animateScrollTo(targetY) {
        if (animationFrame !== null) {
            pageWindow
                .cancelAnimationFrame(
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

        return new Promise(
            (resolve) => {
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
            }
        );
    }

    function scheduleRearm(token) {
        pageWindow.clearTimeout(
            rearmTimer
        );

        rearmTimer =
            pageWindow.setTimeout(
                () => {
                    if (
                        token !==
                        movementToken
                    ) {
                        return;
                    }

                    gestureLatched = false;
                    accumulatedDelta = 0;
                    touchBlocked = false;

                    log(
                        "Re-armed at",
                        currentSnapKey
                    );
                },
                CONFIG
                    .postAnimationRearmDelay
            );
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

        clearInteractionTimers();
        buildSnapPoints();

        const targetIndex =
            getSnapIndexByKey(
                targetKey
            );

        if (targetIndex === -1) {
            gestureLatched = false;
            touchBlocked = false;
            return;
        }

        const target =
            snapPoints[targetIndex];

        movementToken++;

        const thisMovement =
            movementToken;

        animating = true;
        gestureLatched = true;
        touchBlocked = true;
        accumulatedDelta = 0;

        log(
            "Moving:",
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
            touchBlocked = false;
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
            touchBlocked = false;
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
            touchBlocked = false;
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
            touchBlocked = false;
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
            pageWindow.setTimeout(
                () => {
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
                },
                CONFIG.gestureEndDelay
            );
    }

    function handleWheel(event) {
        if (!event.deltaY) return;

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
                        "[contenteditable='true']",
                        ".wixui-accordion",
                        ".wixui-accordion__item"
                    ].join(",")
                )
            );
        } catch {
            return false;
        }
    }

    function resetTouch() {
        touchTracking = false;
        touchTriggered = false;

        touchStartX = 0;
        touchStartY = 0;
    }

    function beginTouchCooldown() {
        touchBlocked = true;

        pageWindow.clearTimeout(
            touchCooldownTimer
        );

        touchCooldownTimer =
            pageWindow.setTimeout(
                () => {
                    if (!animating) {
                        touchBlocked = false;
                    }
                },
                CONFIG.touchCooldown
            );
    }

    function handleTouchStart(event) {
        if (
            animating ||
            touchBlocked ||
            event.touches.length !== 1
        ) {
            resetTouch();
            return;
        }

        if (
            isInteractiveElement(
                event.target
            )
        ) {
            resetTouch();
            return;
        }

        const touch =
            event.touches[0];

        touchStartX =
            touch.clientX;

        touchStartY =
            touch.clientY;

        touchTracking = true;
        touchTriggered = false;

        log(
            "Touch started",
            touchStartX,
            touchStartY
        );
    }

    /*
     * Mobile navigation triggers here, not on touchend.
     */
    function handleTouchMove(event) {
        if (
            !touchTracking ||
            touchTriggered ||
            animating ||
            touchBlocked ||
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

        if (
            verticalDistance <
            CONFIG.touchThreshold
        ) {
            return;
        }

        if (
            verticalDistance <
            horizontalDistance *
                CONFIG.touchDirectionRatio
        ) {
            return;
        }

        /*
         * Finger moving up means navigate down.
         * Finger moving down means navigate up.
         */
        const direction =
            deltaY < 0
                ? 1
                : -1;

        const activeFaq =
            getActiveFaq();

        if (activeFaq) {
            attachCurrentKeyToFaq();

            /*
             * Keep native scrolling inside the middle of the FAQ.
             */
            if (
                shouldAllowFaqNativeScroll(
                    direction,
                    activeFaq
                )
            ) {
                return;
            }
        }

        /*
         * Once threshold is crossed outside normal FAQ scrolling,
         * capture this gesture immediately.
         */
        event.preventDefault();
        event.stopImmediatePropagation();

        touchTriggered = true;
        touchTracking = false;

        beginTouchCooldown();

        log(
            "Mobile swipe triggered",
            direction > 0
                ? "down"
                : "up"
        );

        if (activeFaq) {
            leaveFaq(direction);
        } else {
            moveOneStep(direction);
        }
    }

    function handleTouchEnd() {
        resetTouch();
    }

    function handleTouchCancel() {
        resetTouch();
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

        pageWindow.setTimeout(
            () => {
                buildSnapPoints();

                if (getActiveFaq()) {
                    attachCurrentKeyToFaq();
                }
            },
            650
        );
    }

    function handleResize() {
        pageWindow.setTimeout(
            () => {
                buildSnapPoints();

                if (animating) {
                    return;
                }

                if (getActiveFaq()) {
                    attachCurrentKeyToFaq();
                    return;
                }

                if (
                    getSnapIndexByKey(
                        currentSnapKey
                    ) === -1
                ) {
                    const closestIndex =
                        findClosestSnapIndex();

                    if (
                        closestIndex !==
                        -1
                    ) {
                        currentSnapKey =
                            snapPoints[
                                closestIndex
                            ].key;
                    }
                }
            },
            150
        );
    }

    function cleanupPreviousInstance() {
        if (
            typeof pageWindow[
                CLEANUP_KEY
            ] === "function"
        ) {
            pageWindow[
                CLEANUP_KEY
            ]();
        }
    }

    function install() {
        cleanupPreviousInstance();

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
            "touchstart",
            handleTouchStart,
            {
                passive: true,
                capture: true
            }
        );

        pageWindow.addEventListener(
            "touchmove",
            handleTouchMove,
            {
                passive: false,
                capture: true
            }
        );

        pageWindow.addEventListener(
            "touchend",
            handleTouchEnd,
            {
                passive: true,
                capture: true
            }
        );

        pageWindow.addEventListener(
            "touchcancel",
            handleTouchCancel,
            {
                passive: true,
                capture: true
            }
        );

        pageWindow.addEventListener(
            "resize",
            handleResize
        );

        if (
            pageWindow.visualViewport
        ) {
            pageWindow.visualViewport
                .addEventListener(
                    "resize",
                    handleResize
                );
        }

        pageDocument.addEventListener(
            "click",
            handleAccordionClick
        );

        pageWindow[CLEANUP_KEY] =
            () => {
                pageWindow.removeEventListener(
                    "wheel",
                    handleWheel,
                    {
                        capture: true
                    }
                );

                pageWindow.removeEventListener(
                    "touchstart",
                    handleTouchStart,
                    {
                        capture: true
                    }
                );

                pageWindow.removeEventListener(
                    "touchmove",
                    handleTouchMove,
                    {
                        capture: true
                    }
                );

                pageWindow.removeEventListener(
                    "touchend",
                    handleTouchEnd,
                    {
                        capture: true
                    }
                );

                pageWindow.removeEventListener(
                    "touchcancel",
                    handleTouchCancel,
                    {
                        capture: true
                    }
                );

                pageWindow.removeEventListener(
                    "resize",
                    handleResize
                );

                if (
                    pageWindow.visualViewport
                ) {
                    pageWindow.visualViewport
                        .removeEventListener(
                            "resize",
                            handleResize
                        );
                }

                pageDocument.removeEventListener(
                    "click",
                    handleAccordionClick
                );

                clearInteractionTimers();

                if (
                    animationFrame !==
                    null
                ) {
                    pageWindow
                        .cancelAnimationFrame(
                            animationFrame
                        );
                }

                animationToken++;
                movementToken++;
            };

        log(
            "Installed at:",
            currentSnapKey
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
            log(
                "Unable to find configured Wix sections"
            );
        }
    }

    initialize();
})();
