console.log("[Wix Snap Scroll v2.4] file executing");

(() => {
    "use strict";

    const CONFIG = {
        /*
         * Stable section definitions taken from your console logs.
         * Their final scrolling order is still determined by their
         * actual vertical position on the page.
         */
        sections: [
            {
                selector: "#comp-mrx3f3kh_r_comp-kbgajy18",
                mode: "SNAP"
            },
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

        wheelThreshold: 45,
        gestureEndDelay: 320,
        forcedRearmDelay: 500,

        scrollDuration: 800,
        edgeTolerance: 20,

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
    let forcedRearmTimer = null;

    let animationFrame = null;
    let animationToken = 0;

    let retries = 0;

    function log(...args) {
        if (CONFIG.debug) {
            console.log(
                "[Wix Snap Scroll v2.4]",
                ...args
            );
        }
    }

    /*
     * Wix may run Custom Code in a wrapper frame.
     * Find the accessible document containing the most configured
     * page sections.
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
     * Build positions from the fixed section definitions.
     *
     * Wix may change heights, but it can no longer change the
     * identity or order relationship of our snap points.
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
                    /*
                     * Preserve visibility diagnostics, but do not
                     * invent a position for a currently hidden node.
                     */
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
                    mode: definition.mode,
                    partIndex: 0,
                    configuredIndex
                });
            }
        );

        /*
         * Use actual visual page position. This avoids relying on
         * Wix's internal DOM order.
         */
        snapPoints = points.sort((a, b) => {
            if (a.top !== b.top) {
                return a.top - b.top;
            }

            return (
                a.configuredIndex -
                b.configuredIndex
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
                pageWindow.scrollY - point.top
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
            getSnapIndexByKey(currentSnapKey);

        if (storedIndex !== -1) {
            return storedIndex;
        }

        return findClosestSnapIndex();
    }

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

        /*
         * FAQ mode begins only when the viewport top is inside it.
         * Seeing the FAQ near the bottom of the previous section
         * does not activate it.
         */
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

    function forceRearm() {
        pageWindow.clearTimeout(
            forcedRearmTimer
        );

        forcedRearmTimer =
            pageWindow.setTimeout(() => {
                gestureLatched = false;
                accumulatedDelta = 0;

                log(
                    "Forced re-arm at",
                    currentSnapKey
                );
            }, CONFIG.forcedRearmDelay);
    }

    async function moveToSnapKey(targetKey) {
        if (animating || !targetKey) {
            return;
        }

        buildSnapPoints();

        const targetIndex =
            getSnapIndexByKey(targetKey);

        if (targetIndex === -1) {
            log(
                "Target key not found:",
                targetKey
            );

            forceRearm();
            return;
        }

        const target =
            snapPoints[targetIndex];

        animating = true;

        log(
            "Moving to stable target:",
            target.key,
            target
        );

        try {
            await animateScrollTo(
                target.top
            );

            /*
             * Store the permanent identity, not a numeric index.
             */
            currentSnapKey =
                target.key;

            buildSnapPoints();

            const refreshedIndex =
                getSnapIndexByKey(
                    currentSnapKey
                );

            if (refreshedIndex !== -1) {
                const refreshedTarget =
                    snapPoints[
                        refreshedIndex
                    ];

                const difference =
                    refreshedTarget.top -
                    pageWindow.scrollY;

                if (
                    Math.abs(difference) > 4
                ) {
                    pageWindow.scrollTo({
                        top:
                            refreshedTarget.top,
                        left: 0,
                        behavior: "auto"
                    });
                }
            }
        } catch (error) {
            console.error(
                "[Wix Snap Scroll v2.4] " +
                "animation error",
                error
            );
        } finally {
            animating = false;
            forceRearm();
        }
    }

    function moveOneStep(direction) {
        buildSnapPoints();

        const currentIndex =
            getCurrentSnapIndex();

        if (currentIndex === -1) {
            forceRearm();
            return;
        }

        const targetIndex =
            currentIndex + direction;

        if (
            targetIndex < 0 ||
            targetIndex >=
                snapPoints.length
        ) {
            forceRearm();
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
                "FAQ stable snap point missing"
            );

            forceRearm();
            return;
        }

        const targetIndex =
            faqIndex + direction;

        if (
            targetIndex < 0 ||
            targetIndex >=
                snapPoints.length
        ) {
            forceRearm();
            return;
        }

        moveToSnapKey(
            snapPoints[targetIndex].key
        );
    }

    function resetGestureAfterSilence() {
        pageWindow.clearTimeout(
            gestureEndTimer
        );

        gestureEndTimer =
            pageWindow.setTimeout(() => {
                if (animating) {
                    return;
                }

                /*
                 * During native FAQ scrolling, retain the FAQ's
                 * permanent snap identity.
                 */
                if (getActiveFaq()) {
                    const faqIndex =
                        getFaqSnapIndex();

                    if (faqIndex !== -1) {
                        currentSnapKey =
                            snapPoints[
                                faqIndex
                            ].key;
                    }
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

        resetGestureAfterSilence();

        const activeFaq =
            getActiveFaq();

        if (activeFaq) {
            const faqIndex =
                getFaqSnapIndex();

            if (faqIndex !== -1) {
                currentSnapKey =
                    snapPoints[
                        faqIndex
                    ].key;
            }

            /*
             * Native scrolling inside the FAQ.
             */
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

            /*
             * At the FAQ boundary, go directly to its stable
             * previous or next snap point.
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

        /*
         * Normal section snapping.
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
         * Update positions after the FAQ expansion animation,
         * while retaining stable snap identities.
         */
        pageWindow.setTimeout(() => {
            buildSnapPoints();

            const faqIndex =
                getFaqSnapIndex();

            if (
                getActiveFaq() &&
                faqIndex !== -1
            ) {
                currentSnapKey =
                    snapPoints[
                        faqIndex
                    ].key;
            }
        }, 650);
    }

    function handleResize() {
        pageWindow.setTimeout(() => {
            buildSnapPoints();

            if (
                !animating &&
                !getSnapIndexByKey(
                    currentSnapKey
                )
            ) {
                const closest =
                    findClosestSnapIndex();

                if (closest !== -1) {
                    currentSnapKey =
                        snapPoints[
                            closest
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

                pageWindow.clearTimeout(
                    gestureEndTimer
                );

                pageWindow.clearTimeout(
                    forcedRearmTimer
                );

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
            };

        log(
            "Installed at stable snap:",
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
