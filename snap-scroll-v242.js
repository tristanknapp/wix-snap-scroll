console.log("[Wix Snap Scroll v2.5.1] file executing");

(() => {
    "use strict";

    const CONFIG = {
        /*
         * Only include real scrollable page sections here.
         *
         * The small 65–85px section was removed because it appears
         * to be fixed or sticky and was changing position while
         * scrolling.
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

        faqSelector: "#comp-mrxamx3r",

        wheelThreshold: 42,

        /*
         * Re-arm when wheel events stop.
         */
        gestureEndDelay: 220,

        /*
         * Re-arm shortly after a snap animation finishes.
         */
        postAnimationRearmDelay: 140,

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

    let retries = 0;

    function log(...args) {
        if (CONFIG.debug) {
            console.log(
                "[Wix Snap Scroll v2.5.1]",
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

        gestureEndTimer = null;
        rearmTimer = null;
    }

    /*
     * Wix may execute Custom Code in a wrapper document.
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
     * Build all valid snap destinations.
     *
     * Important:
     * The order comes exclusively from CONFIG.sections.
     * Temporary Wix layout positions cannot reorder navigation.
     */
    function buildSnapPoints() {
        const viewportHeight =
            pageWindow.innerHeight;

        const points = [];

        CONFIG.sections.forEach(
            (definition, configuredIndex) => {
                const element = getElement(
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
                    log(
                        "Configured section has no height:",
                        definition.selector
                    );

                    return;
                }

                const top = getPageTop(element);
                const height = rect.height;

                if (definition.mode === "SPLIT") {
                    const partCount =
                        definition.parts || 2;

                    const finalTop = Math.max(
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

        /*
         * Preserve explicit configured order.
         *
         * Do not sort by top position. Fixed, sticky, animated,
         * short or dynamically resized sections must not change
         * navigation order.
         */
        snapPoints = points.sort((a, b) => {
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

        log(
            `Built ${snapPoints.length} stable snap points`,
            snapPoints.map((point, index) => ({
                snap: index + 1,
                key: point.key,
                y: point.top,
                selector: point.selector,
                mode: point.mode,
                part: point.partIndex + 1
            }))
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

        snapPoints.forEach((point, index) => {
            const distance = Math.abs(
                pageWindow.scrollY -
                point.top
            );

            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = index;
            }
        });

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

    /*
     * FAQ mode becomes active only once the viewport top enters
     * the FAQ section.
     */
    function getActiveFaq() {
        const faq =
            getElement(CONFIG.faqSelector);

        if (!faq) {
            return null;
        }

        const viewportTop =
            pageWindow.scrollY;

        const top = getPageTop(faq);

        const height =
            faq.getBoundingClientRect().height;

        const bottom = top + height;

        const active =
            viewportTop >=
                top - CONFIG.edgeTolerance &&
            viewportTop <
                bottom - CONFIG.edgeTolerance;

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

    /*
     * Allow native scrolling through the middle of the FAQ.
     *
     * At its top or bottom boundary, the next deliberate gesture
     * uses snap navigation.
     */
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
                8 * Math.pow(progress, 4)
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

    /*
     * Controlled animation prevents native browser overshoot
     * and visible self-correction.
     */
    function animateScrollTo(targetY) {
        if (animationFrame !== null) {
            pageWindow.cancelAnimationFrame(
                animationFrame
            );
        }

        animationToken++;

        const token = animationToken;
        const startY = pageWindow.scrollY;
        const distance = targetY - startY;

        const startTime =
            pageWindow.performance.now();

        return new Promise((resolve) => {
            function frame(now) {
                if (token !== animationToken) {
                    resolve(false);
                    return;
                }

                const progress = Math.min(
                    (now - startTime) /
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

    function scheduleRearm(token) {
        pageWindow.clearTimeout(
            rearmTimer
        );

        rearmTimer =
            pageWindow.setTimeout(() => {
                /*
                 * Ignore stale callbacks belonging to an older move.
                 */
                if (token !== movementToken) {
                    return;
                }

                gestureLatched = false;
                accumulatedDelta = 0;

                log(
                    "Re-armed at",
                    currentSnapKey
                );
            }, CONFIG.postAnimationRearmDelay);
    }

    async function moveToSnapKey(targetKey) {
        if (animating || !targetKey) {
            return;
        }

        clearInteractionTimers();
        buildSnapPoints();

        const targetIndex =
            getSnapIndexByKey(targetKey);

        if (targetIndex === -1) {
            log(
                "Target key not found:",
                targetKey
            );

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
        } catch (error) {
            console.error(
                "[Wix Snap Scroll v2.5.1] " +
                "animation error",
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
            log(
                "FAQ snap point not found"
            );

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

                log(
                    "Gesture ended at",
                    currentSnapKey
                );
            }, CONFIG.gestureEndDelay);
    }

    function handleWheel(event) {
        if (!event.deltaY) {
            return;
        }

        const direction =
            event.deltaY > 0 ? 1 : -1;

        scheduleGestureEnd();

        const activeFaq =
            getActiveFaq();

        /*
         * FAQ native-scroll mode.
         */
        if (activeFaq) {
            attachCurrentKeyToFaq();

            if (
                shouldAllowFaqNativeScroll(
                    direction,
                    activeFaq
                )
            ) {
                /*
                 * Never latch while scrolling normally inside FAQ.
                 */
                gestureLatched = false;
                accumulatedDelta = 0;
                return;
            }

            /*
             * At the FAQ boundary, capture the wheel gesture and move
             * to the immediate neighboring configured section.
             */
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
                Math.abs(accumulatedDelta) <
                CONFIG.wheelThreshold
            ) {
                return;
            }

            gestureLatched = true;
            accumulatedDelta = 0;

            leaveFaq(direction);
            return;
        }

        /*
         * Normal one-step snap navigation.
         */
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
            Math.abs(accumulatedDelta) <
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

        /*
         * Recalculate positions after Wix finishes the accordion
         * animation, while preserving stable keys.
         */
        pageWindow.setTimeout(() => {
            buildSnapPoints();

            if (getActiveFaq()) {
                attachCurrentKeyToFaq();
            }
        }, 650);
    }

    function handleResize() {
        pageWindow.setTimeout(() => {
            buildSnapPoints();

            if (animating) {
                return;
            }

            if (getActiveFaq()) {
                attachCurrentKeyToFaq();
                return;
            }

            /*
             * Only resynchronize after a genuine viewport resize.
             */
            if (
                getSnapIndexByKey(
                    currentSnapKey
                ) === -1
            ) {
                const closestIndex =
                    findClosestSnapIndex();

                if (closestIndex !== -1) {
                    currentSnapKey =
                        snapPoints[
                            closestIndex
                        ].key;
                }
            }
        }, 150);
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
            "resize",
            handleResize
        );

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
                        { capture: true }
                    );

                pageWindow
                    .removeEventListener(
                        "resize",
                        handleResize
                    );

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
