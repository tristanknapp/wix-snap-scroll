console.log("[Wix Snap Scroll v2.3.1] file executing");

(() => {
    "use strict";

    const CONFIG = {
        sectionSelector: '[data-testid="section-container"]',

        // The 200vh hero section.
        splitSections: [
            "#comp-mrx3f3km"
        ],

        // The FAQ section, which should scroll normally.
        freeSections: [
            "#comp-mrxamx3r"
        ],

        wheelThreshold: 45,

        /*
         * A wheel gesture ends after no wheel events have arrived
         * for this amount of time.
         */
        gestureEndDelay: 320,

        /*
         * Forces the controller to become available after a snap,
         * even if the browser keeps the wheel transaction alive
         * until the pointer moves.
         */
        forcedRearmDelay: 500,

        scrollDuration: 800,
        edgeTolerance: 20,

        retryDelay: 400,
        maxRetries: 40,

        debug: true
    };

    const INSTANCE_KEY = "__WIX_SNAP_SCROLL_V231__";
    const CLEANUP_KEY = "__WIX_SNAP_SCROLL_CLEANUP__";

    let pageWindow = null;
    let pageDocument = null;

    let sections = [];
    let snapPoints = [];
    let currentSnapIndex = 0;

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
            console.log("[Wix Snap Scroll v2.3.1]", ...args);
        }
    }

    /*
     * Wix may execute custom code in a wrapper document.
     * This searches all accessible frames for the document
     * containing the actual Wix Studio sections.
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
            } catch (error) {
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

    function findPageDocument() {
        let bestMatch = null;
        let highestSectionCount = 0;

        getAccessibleDocuments().forEach(({ win, doc }) => {
            let sectionCount = 0;

            try {
                sectionCount = doc.querySelectorAll(
                    CONFIG.sectionSelector
                ).length;
            } catch (error) {
                return;
            }

            if (sectionCount > highestSectionCount) {
                highestSectionCount = sectionCount;
                bestMatch = { win, doc };
            }
        });

        if (!bestMatch || highestSectionCount < 2) {
            return false;
        }

        pageWindow = bestMatch.win;
        pageDocument = bestMatch.doc;

        log(
            `Found page document with ${highestSectionCount} sections`
        );

        return true;
    }

    function matchesSelectorList(element, selectors) {
        return selectors.some((selector) => {
            try {
                return element.matches(selector);
            } catch (error) {
                log("Invalid selector:", selector);
                return false;
            }
        });
    }

    function getMode(section) {
        if (
            matchesSelectorList(
                section,
                CONFIG.freeSections
            )
        ) {
            return "FREE";
        }

        if (
            matchesSelectorList(
                section,
                CONFIG.splitSections
            )
        ) {
            return "SPLIT";
        }

        return "SNAP";
    }

    function getPageTop(element) {
        return (
            element.getBoundingClientRect().top +
            pageWindow.scrollY
        );
    }

    function refreshSections() {
        sections = Array.from(
            pageDocument.querySelectorAll(
                CONFIG.sectionSelector
            )
        ).filter((section) => {
            return section.getBoundingClientRect().height > 0;
        });
    }

    /*
     * Builds all allowed snap destinations.
     *
     * SNAP:
     * One destination at the top.
     *
     * SPLIT:
     * One destination per viewport-height part.
     *
     * FREE:
     * One destination at the top, then native scrolling inside.
     */
    function buildSnapPoints() {
        refreshSections();

        const viewportHeight = pageWindow.innerHeight;
        const points = [];

        sections.forEach((section, sectionIndex) => {
            const rect = section.getBoundingClientRect();
            const top = getPageTop(section);
            const height = rect.height;
            const mode = getMode(section);

            if (mode === "FREE") {
                points.push({
                    top: Math.round(top),
                    section,
                    sectionIndex,
                    partIndex: 0,
                    mode
                });

                return;
            }

            if (mode === "SPLIT") {
                const partCount = Math.max(
                    1,
                    Math.round(height / viewportHeight)
                );

                const finalTop = Math.max(
                    top,
                    top + height - viewportHeight
                );

                for (
                    let partIndex = 0;
                    partIndex < partCount;
                    partIndex++
                ) {
                    const requestedTop =
                        top + viewportHeight * partIndex;

                    points.push({
                        top: Math.round(
                            Math.min(
                                requestedTop,
                                finalTop
                            )
                        ),
                        section,
                        sectionIndex,
                        partIndex,
                        mode
                    });
                }

                return;
            }

            points.push({
                top: Math.round(top),
                section,
                sectionIndex,
                partIndex: 0,
                mode
            });
        });

        snapPoints = points
            .sort((a, b) => a.top - b.top)
            .filter((point, index, list) => {
                if (index === 0) {
                    return true;
                }

                return (
                    Math.abs(
                        point.top - list[index - 1].top
                    ) > 10
                );
            });

        log(
            `Built ${snapPoints.length} snap points`,
            snapPoints.map((point, index) => ({
                snap: index + 1,
                section: point.sectionIndex + 1,
                part: point.partIndex + 1,
                mode: point.mode,
                y: point.top,
                id: point.section.id
            }))
        );
    }

    function findClosestSnapIndex() {
        if (snapPoints.length === 0) {
            return 0;
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

    function findActiveFreeSection() {
        const viewportTop = pageWindow.scrollY;
        const viewportBottom =
            viewportTop + pageWindow.innerHeight;

        for (
            let sectionIndex = 0;
            sectionIndex < sections.length;
            sectionIndex++
        ) {
            const section = sections[sectionIndex];

            if (getMode(section) !== "FREE") {
                continue;
            }

            const top = getPageTop(section);
            const height =
                section.getBoundingClientRect().height;
            const bottom = top + height;

            const overlapsViewport =
                viewportBottom >
                    top + CONFIG.edgeTolerance &&
                viewportTop <
                    bottom - CONFIG.edgeTolerance;

            if (overlapsViewport) {
                return {
                    section,
                    sectionIndex,
                    top,
                    bottom
                };
            }
        }

        return null;
    }

    function getSnapIndexForSection(section) {
        return snapPoints.findIndex(
            (point) => point.section === section
        );
    }

    /*
     * Native scrolling is allowed while the user is inside the
     * middle of the FAQ.
     *
     * At the FAQ top, scrolling upward snaps to the previous point.
     * At the FAQ bottom, scrolling downward snaps to the next point.
     */
    function shouldAllowFreeScroll(direction) {
        const freeSection = findActiveFreeSection();

        if (!freeSection) {
            return false;
        }

        const viewportTop = pageWindow.scrollY;
        const viewportBottom =
            viewportTop + pageWindow.innerHeight;

        if (
            direction > 0 &&
            viewportBottom <
                freeSection.bottom -
                    CONFIG.edgeTolerance
        ) {
            return true;
        }

        if (
            direction < 0 &&
            viewportTop >
                freeSection.top +
                    CONFIG.edgeTolerance
        ) {
            return true;
        }

        return false;
    }

    function easeInOutQuart(progress) {
        if (progress < 0.5) {
            return 8 * Math.pow(progress, 4);
        }

        return (
            1 -
            Math.pow(-2 * progress + 2, 4) / 2
        );
    }

    /*
     * Controlled scroll animation.
     * This avoids native browser overshoot and visible correction.
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
                            easeInOutQuart(progress),
                    left: 0,
                    behavior: "auto"
                });

                if (progress < 1) {
                    animationFrame =
                        pageWindow.requestAnimationFrame(
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
                pageWindow.requestAnimationFrame(
                    frame
                );
        });
    }

    function synchronizeToFreeSection() {
        const activeFreeSection =
            findActiveFreeSection();

        if (!activeFreeSection) {
            return false;
        }

        const freeSnapIndex =
            getSnapIndexForSection(
                activeFreeSection.section
            );

        if (freeSnapIndex !== -1) {
            currentSnapIndex = freeSnapIndex;

            log(
                "Current snap attached to free section:",
                currentSnapIndex + 1
            );

            return true;
        }

        return false;
    }

    function forceRearm() {
        pageWindow.clearTimeout(
            forcedRearmTimer
        );

        forcedRearmTimer =
            pageWindow.setTimeout(() => {
                gestureLatched = false;
                accumulatedDelta = 0;

                synchronizeToFreeSection();

                log(
                    "Forced gesture re-arm at snap",
                    currentSnapIndex + 1
                );
            }, CONFIG.forcedRearmDelay);
    }

    async function moveOneStep(direction) {
        if (animating) {
            return;
        }

        buildSnapPoints();

        /*
         * If the user is inside the FAQ, keep the logical index
         * fixed to the FAQ's top snap point.
         */
        synchronizeToFreeSection();

        const targetIndex = Math.max(
            0,
            Math.min(
                currentSnapIndex + direction,
                snapPoints.length - 1
            )
        );

        if (targetIndex === currentSnapIndex) {
            forceRearm();
            return;
        }

        const target = snapPoints[targetIndex];

        if (!target) {
            forceRearm();
            return;
        }

        animating = true;

        log(
            "Moving exactly one snap:",
            `${currentSnapIndex + 1} → ${targetIndex + 1}`,
            target
        );

        try {
            await animateScrollTo(target.top);

            /*
             * The requested destination is authoritative.
             */
            currentSnapIndex = targetIndex;

            /*
             * Recalculate positions after arriving in case Wix shifted
             * the layout during the animation.
             */
            buildSnapPoints();

            const refreshedTarget =
                snapPoints[currentSnapIndex];

            if (refreshedTarget) {
                const difference =
                    refreshedTarget.top -
                    pageWindow.scrollY;

                /*
                 * Only correct meaningful layout movement.
                 */
                if (Math.abs(difference) > 4) {
                    pageWindow.scrollTo({
                        top: refreshedTarget.top,
                        left: 0,
                        behavior: "auto"
                    });
                }
            }
        } catch (error) {
            console.error(
                "[Wix Snap Scroll v2.3.1] animation error",
                error
            );

            currentSnapIndex =
                findClosestSnapIndex();
        } finally {
            animating = false;

            /*
             * Re-arm even when the browser does not send a clean
             * end to the wheel gesture until the pointer moves.
             */
            forceRearm();
        }
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
                 * While inside the FAQ, do not choose the nearest
                 * following snap point. Keep the active logical point
                 * tied to the FAQ.
                 */
                if (!synchronizeToFreeSection()) {
                    currentSnapIndex =
                        findClosestSnapIndex();
                }

                gestureLatched = false;
                accumulatedDelta = 0;

                log(
                    "Wheel gesture ended; re-armed at snap",
                    currentSnapIndex + 1
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

        /*
         * Keep the logical index attached to the FAQ while the user
         * scrolls naturally inside it.
         */
        synchronizeToFreeSection();

        /*
         * Allow native scrolling through the FAQ.
         */
        if (shouldAllowFreeScroll(direction)) {
            accumulatedDelta = 0;
            return;
        }

        /*
         * Capture the event before older snap-scroll handlers can
         * react to it.
         */
        event.preventDefault();
        event.stopImmediatePropagation();

        /*
         * One physical wheel or trackpad gesture can trigger only
         * one snap.
         */
        if (gestureLatched || animating) {
            return;
        }

        accumulatedDelta += event.deltaY;

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
         * Wait until the FAQ accordion animation finishes,
         * then recalculate section positions.
         */
        pageWindow.setTimeout(() => {
            buildSnapPoints();
            synchronizeToFreeSection();
        }, 650);
    }

    function handleResize() {
        pageWindow.setTimeout(() => {
            buildSnapPoints();

            if (!animating) {
                if (!synchronizeToFreeSection()) {
                    currentSnapIndex =
                        findClosestSnapIndex();
                }
            }
        }, 150);
    }

    function cleanupPreviousInstance() {
        if (
            typeof pageWindow[CLEANUP_KEY] ===
            "function"
        ) {
            pageWindow[CLEANUP_KEY]();
        }
    }

    function install() {
        cleanupPreviousInstance();

        buildSnapPoints();

        if (sections.length < 2) {
            return;
        }

        currentSnapIndex =
            findClosestSnapIndex();

        /*
         * Capture mode lets this handler execute before older
         * bubble-phase wheel listeners.
         */
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

        pageWindow[CLEANUP_KEY] = () => {
            pageWindow.removeEventListener(
                "wheel",
                handleWheel,
                { capture: true }
            );

            pageWindow.removeEventListener(
                "resize",
                handleResize
            );

            pageDocument.removeEventListener(
                "click",
                handleAccordionClick
            );

            pageWindow.clearTimeout(
                gestureEndTimer
            );

            pageWindow.clearTimeout(
                forcedRearmTimer
            );

            if (animationFrame !== null) {
                pageWindow.cancelAnimationFrame(
                    animationFrame
                );
            }

            animationToken++;
        };

        pageWindow[INSTANCE_KEY] = true;

        log(
            "Installed successfully; current snap:",
            currentSnapIndex + 1
        );
    }

    function initialize() {
        retries++;

        if (findPageDocument()) {
            install();
            return;
        }

        if (retries < CONFIG.maxRetries) {
            window.setTimeout(
                initialize,
                CONFIG.retryDelay
            );
        } else {
            log(
                "Unable to find the Wix page document"
            );
        }
    }

    initialize();
})();
