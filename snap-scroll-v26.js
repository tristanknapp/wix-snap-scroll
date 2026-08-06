console.log("[Wix Snap Scroll v2.6-diagnostic] file executing");

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

        wheelThreshold: 42,
        gestureEndDelay: 220,
        postAnimationRearmDelay: 140,

        touchThreshold: 65,
        touchDirectionRatio: 1.2,
        maxTouchDuration: 1200,
        touchCooldown: 180,

        scrollDuration: 800,
        edgeTolerance: 12,

        retryDelay: 400,
        maxRetries: 40,

        /*
         * Diagnostic options.
         *
         * Set showDiagnosticAlert to false after testing.
         */
        showDiagnosticAlert: true,
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
    let touchCooldownTimer = null;

    let animationFrame = null;
    let animationToken = 0;
    let movementToken = 0;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchLastX = 0;
    let touchLastY = 0;
    let touchStartTime = 0;

    let touchTracking = false;
    let touchBlocked = false;

    let retries = 0;
    let diagnosticAlertShown = false;

    function log(...args) {
        if (CONFIG.debug) {
            console.log(
                "[Wix Snap Scroll v2.6-diagnostic]",
                ...args
            );
        }
    }

    function clearInteractionTimers() {
        if (!pageWindow) {
            return;
        }

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
            } catch (error) {
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
            } catch (error) {
                // Ignore inaccessible cross-origin frames.
            }
        }

        visit(window);

        try {
            visit(window.top);
        } catch (error) {
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
                } catch (error) {
                    return count;
                }
            },
            0
        );
    }

    function findPageDocument() {
        let bestMatch = null;
        let highestCount = 0;

        const documents =
            getAccessibleDocuments();

        log(
            "Accessible documents found:",
            documents.length
        );

        documents.forEach(
            ({ win, doc }, index) => {
                const count =
                    countConfiguredSections(doc);

                let location = "(unknown)";

                try {
                    location = doc.location.href;
                } catch (error) {
                    // Ignore.
                }

                log(
                    `Document ${index + 1}:`,
                    location,
                    `configured sections=${count}`
                );

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
            log(
                "No page document found yet.",
                `Best configured-section count=${highestCount}`
            );

            return false;
        }

        pageWindow = bestMatch.win;
        pageDocument = bestMatch.doc;

        log(
            "Selected page document with",
            highestCount,
            "configured sections"
        );

        return true;
    }

    function getElement(selector) {
        try {
            return pageDocument.querySelector(
                selector
            );
        } catch (error) {
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
        const missingSelectors = [];

        CONFIG.sections.forEach(
            (definition, configuredIndex) => {
                const element = getElement(
                    definition.selector
                );

                if (!element) {
                    missingSelectors.push(
                        definition.selector
                    );

                    log(
                        "Configured section missing:",
                        definition.selector
                    );

                    return;
                }

                const rect =
                    element.getBoundingClientRect();

                log(
                    "Configured section found:",
                    definition.selector,
                    {
                        height: Math.round(
                            rect.height
                        ),
                        top: Math.round(
                            rect.top
                        ),
                        mode: definition.mode
                    }
                );

                if (rect.height <= 0) {
                    log(
                        "Configured section has zero height:",
                        definition.selector
                    );

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
                            element,
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
                    element,
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

        log(
            "Snap-point details:",
            snapPoints.map(
                (point, index) => ({
                    number: index + 1,
                    key: point.key,
                    y: point.top,
                    selector:
                        point.selector,
                    mode: point.mode,
                    part:
                        point.partIndex + 1
                })
            )
        );

        if (
            missingSelectors.length > 0
        ) {
            log(
                "Missing configured selectors:",
                missingSelectors
            );
        }

        return {
            snapPointCount:
                snapPoints.length,
            missingSelectors
        };
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
            element: faq,
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
            log(
                "moveToSnapKey ignored",
                {
                    animating,
                    targetKey
                }
            );

            return;
        }

        clearInteractionTimers();
        buildSnapPoints();

        const targetIndex =
            getSnapIndexByKey(
                targetKey
            );

        if (targetIndex === -1) {
            log(
                "Target key not found:",
                targetKey
            );

            gestureLatched = false;
            accumulatedDelta = 0;
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
            target.key,
            `targetY=${target.top}`
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

            log(
                "Movement completed:",
                currentSnapKey
            );
        } catch (error) {
            console.error(
                "[Wix Snap Scroll v2.6-diagnostic] animation error",
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

        log(
            "moveOneStep",
            {
                direction,
                currentIndex,
                currentSnapKey
            }
        );

        if (currentIndex === -1) {
            gestureLatched = false;
            touchBlocked = false;
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
            log(
                "No neighboring snap point",
                {
                    currentIndex,
                    targetIndex,
                    total:
                        snapPoints.length
                }
            );

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

        log(
            "leaveFaq",
            {
                direction,
                faqIndex
            }
        );

        if (faqIndex === -1) {
            gestureLatched = false;
            accumulatedDelta = 0;
            touchBlocked = false;
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
            gestureLatched = false;
            accumulatedDelta = 0;
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

                    log(
                        "Gesture ended at",
                        currentSnapKey
                    );
                },
                CONFIG.gestureEndDelay
            );
    }

    function handleWheel(event) {
        if (!event.deltaY) {
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

    function isInteractiveElement(
        target
    ) {
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
        } catch (error) {
            return false;
        }
    }

    function handleTouchStart(event) {
        log(
            "touchstart detected",
            {
                touches:
                    event.touches.length,
                animating,
                touchBlocked,
                target:
                    event.target
                        ?.tagName ||
                    "(unknown)"
            }
        );

        if (
            animating ||
            touchBlocked ||
            event.touches.length !== 1
        ) {
            touchTracking = false;

            log(
                "touchstart rejected",
                {
                    animating,
                    touchBlocked,
                    touches:
                        event.touches
                            .length
                }
            );

            return;
        }

        if (
            isInteractiveElement(
                event.target
            )
        ) {
            touchTracking = false;

            log(
                "touchstart ignored on interactive element"
            );

            return;
        }

        const touch =
            event.touches[0];

        touchStartX =
            touch.clientX;

        touchStartY =
            touch.clientY;

        touchLastX =
            touch.clientX;

        touchLastY =
            touch.clientY;

        touchStartTime =
            Date.now();

        touchTracking = true;

        log(
            "touch tracking started",
            {
                x: touchStartX,
                y: touchStartY
            }
        );
    }

    function handleTouchMove(event) {
        if (
            !touchTracking ||
            event.touches.length !== 1
        ) {
            return;
        }

        const touch =
            event.touches[0];

        touchLastX =
            touch.clientX;

        touchLastY =
            touch.clientY;

        const deltaX =
            touchLastX -
            touchStartX;

        const deltaY =
            touchLastY -
            touchStartY;

        const verticalDistance =
            Math.abs(deltaY);

        const horizontalDistance =
            Math.abs(deltaX);

        log(
            "touchmove",
            {
                deltaX:
                    Math.round(deltaX),
                deltaY:
                    Math.round(deltaY),
                activeFaq:
                    Boolean(
                        getActiveFaq()
                    )
            }
        );

        if (
            !getActiveFaq() &&
            verticalDistance >
                CONFIG.touchThreshold /
                    2 &&
            verticalDistance >
                horizontalDistance *
                    CONFIG.touchDirectionRatio
        ) {
            event.preventDefault();

            log(
                "touchmove native scroll prevented"
            );
        }
    }

    function resetTouchTracking() {
        touchTracking = false;

        touchStartX = 0;
        touchStartY = 0;
        touchLastX = 0;
        touchLastY = 0;
        touchStartTime = 0;
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

                        log(
                            "touch cooldown ended"
                        );
                    }
                },
                CONFIG.touchCooldown
            );
    }

    function handleTouchEnd(event) {
        log(
            "touchend detected",
            {
                tracking:
                    touchTracking,
                blocked:
                    touchBlocked,
                animating,
                changedTouches:
                    event.changedTouches
                        .length
            }
        );

        if (!touchTracking) {
            log(
                "touchend ignored because tracking is false"
            );

            return;
        }

        if (
            event.changedTouches.length <
            1
        ) {
            resetTouchTracking();

            log(
                "touchend had no changed touch"
            );

            return;
        }

        const touch =
            event.changedTouches[0];

        const endX =
            touch.clientX;

        const endY =
            touch.clientY;

        const deltaX =
            endX -
            touchStartX;

        const deltaY =
            endY -
            touchStartY;

        const verticalDistance =
            Math.abs(deltaY);

        const horizontalDistance =
            Math.abs(deltaX);

        const duration =
            Date.now() -
            touchStartTime;

        const diagnostic = {
            startX:
                Math.round(
                    touchStartX
                ),
            startY:
                Math.round(
                    touchStartY
                ),
            endX:
                Math.round(endX),
            endY:
                Math.round(endY),
            deltaX:
                Math.round(deltaX),
            deltaY:
                Math.round(deltaY),
            verticalDistance:
                Math.round(
                    verticalDistance
                ),
            horizontalDistance:
                Math.round(
                    horizontalDistance
                ),
            duration,
            threshold:
                CONFIG.touchThreshold,
            blocked:
                touchBlocked,
            animating
        };

        log(
            "touch gesture result",
            diagnostic
        );

        resetTouchTracking();

        if (
            animating ||
            touchBlocked
        ) {
            log(
                "touch swipe rejected: blocked or animating"
            );

            return;
        }

        if (
            duration >
            CONFIG.maxTouchDuration
        ) {
            log(
                "touch swipe rejected: duration too long"
            );

            return;
        }

        if (
            verticalDistance <
            CONFIG.touchThreshold
        ) {
            log(
                "touch swipe rejected: below threshold"
            );

            return;
        }

        if (
            verticalDistance <
            horizontalDistance *
                CONFIG.touchDirectionRatio
        ) {
            log(
                "touch swipe rejected: too horizontal"
            );

            return;
        }

        const direction =
            deltaY < 0
                ? 1
                : -1;

        log(
            "touch swipe accepted",
            {
                direction:
                    direction > 0
                        ? "down"
                        : "up"
            }
        );

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
                log(
                    "FAQ native touch scroll retained"
                );

                return;
            }

            beginTouchCooldown();
            leaveFaq(direction);
            return;
        }

        beginTouchCooldown();
        moveOneStep(direction);
    }

    function handleTouchCancel() {
        log(
            "touchcancel detected"
        );

        resetTouchTracking();
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
        log(
            "viewport resize detected",
            {
                innerHeight:
                    pageWindow
                        .innerHeight,
                visualViewportHeight:
                    pageWindow
                        .visualViewport
                        ?.height
            }
        );

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

    function showDiagnosticAlert(
        result
    ) {
        if (
            diagnosticAlertShown ||
            !CONFIG.showDiagnosticAlert
        ) {
            return;
        }

        diagnosticAlertShown = true;

        const touchSupported =
            "ontouchstart" in
                pageWindow ||
            pageWindow.navigator
                .maxTouchPoints > 0;

        const message = [
            "Wix Snap Scroll diagnostic",
            "",
            `Snap points: ${result.snapPointCount}`,
            `Missing sections: ${result.missingSelectors.length}`,
            `Touch supported: ${touchSupported}`,
            `Max touch points: ${pageWindow.navigator.maxTouchPoints || 0}`,
            `Viewport: ${Math.round(getViewportHeight())}px`
        ].join("\n");

        try {
            pageWindow.alert(
                message
            );
        } catch (error) {
            log(
                "Could not show diagnostic alert",
                error
            );
        }
    }

    function install() {
        cleanupPreviousInstance();

        const result =
            buildSnapPoints();

        showDiagnosticAlert(
            result
        );

        if (
            snapPoints.length < 2
        ) {
            log(
                "Installation stopped: not enough snap points"
            );

            return;
        }

        const closestIndex =
            findClosestSnapIndex();

        if (closestIndex === -1) {
            log(
                "Installation stopped: closest snap not found"
            );

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
            pageWindow
                .visualViewport
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
                pageWindow
                    .removeEventListener(
                        "wheel",
                        handleWheel,
                        {
                            capture: true
                        }
                    );

                pageWindow
                    .removeEventListener(
                        "touchstart",
                        handleTouchStart,
                        {
                            capture: true
                        }
                    );

                pageWindow
                    .removeEventListener(
                        "touchmove",
                        handleTouchMove,
                        {
                            capture: true
                        }
                    );

                pageWindow
                    .removeEventListener(
                        "touchend",
                        handleTouchEnd,
                        {
                            capture: true
                        }
                    );

                pageWindow
                    .removeEventListener(
                        "touchcancel",
                        handleTouchCancel,
                        {
                            capture: true
                        }
                    );

                pageWindow
                    .removeEventListener(
                        "resize",
                        handleResize
                    );

                if (
                    pageWindow
                        .visualViewport
                ) {
                    pageWindow
                        .visualViewport
                        .removeEventListener(
                            "resize",
                            handleResize
                        );
                }

                pageDocument
                    .removeEventListener(
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
            "Installed successfully at:",
            currentSnapKey
        );

        log(
            "Touch capability:",
            {
                ontouchstart:
                    "ontouchstart" in
                    pageWindow,
                maxTouchPoints:
                    pageWindow
                        .navigator
                        .maxTouchPoints,
                userAgent:
                    pageWindow
                        .navigator
                        .userAgent
            }
        );
    }

    function initialize() {
        retries++;

        log(
            `Initialization attempt ${retries}`
        );

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

            if (
                CONFIG.showDiagnosticAlert
            ) {
                try {
                    window.alert(
                        "Wix Snap Scroll diagnostic:\nNo configured Wix sections were found."
                    );
                } catch (error) {
                    // Ignore.
                }
            }
        }
    }

    initialize();
})();
