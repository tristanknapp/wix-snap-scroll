console.log("[Wix Snap Scroll v2.3.3] file executing");

(() => {
    "use strict";

    const CONFIG = {
        sectionSelector: '[data-testid="section-container"]',

        // The 200vh hero section.
        splitSections: [
            "#comp-mrx3f3km"
        ],

        // The FAQ section, which scrolls normally.
        freeSections: [
            "#comp-mrxamx3r"
        ],

        wheelThreshold: 45,

        // A gesture ends after wheel events stop for this long.
        gestureEndDelay: 320,

        // Re-arm after reaching a destination.
        forcedRearmDelay: 500,

        scrollDuration: 800,
        edgeTolerance: 20,

        retryDelay: 400,
        maxRetries: 40,

        debug: true
    };

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
            console.log("[Wix Snap Scroll v2.3.3]", ...args);
        }
    }

    /*
     * Wix may execute Custom Code in a wrapper document.
     * Search accessible windows and frames for the document
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

    function findPageDocument() {
        let bestMatch = null;
        let highestSectionCount = 0;

        getAccessibleDocuments().forEach(({ win, doc }) => {
            let count = 0;

            try {
                count = doc.querySelectorAll(
                    CONFIG.sectionSelector
                ).length;
            } catch {
                return;
            }

            if (count > highestSectionCount) {
                highestSectionCount = count;
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
            } catch {
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
     * Build all valid destinations:
     *
     * SNAP:
     * One destination at the section top.
     *
     * SPLIT:
     * One destination per viewport-height part.
     *
     * FREE:
     * One destination at the section top, followed by
     * ordinary native scrolling inside the section.
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

    /*
     * Use the stable sectionIndex rather than comparing DOM
     * references, because Wix may rerender elements.
     */
    function getSnapIndexForSectionIndex(sectionIndex) {
        return snapPoints.findIndex(
            (point) =>
                point.sectionIndex === sectionIndex
        );
    }

    /*
     * A FREE section is active only when the top of the viewport
     * is actually inside it.
     *
     * Merely seeing the FAQ at the bottom of the viewport does not
     * activate FAQ mode or change the logical snap index.
     */
    function findActiveFreeSection() {
        const viewportTop = pageWindow.scrollY;
        const tolerance = CONFIG.edgeTolerance;

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

            const viewportTopIsInside =
                viewportTop >= top - tolerance &&
                viewportTop < bottom - tolerance;

            if (viewportTopIsInside) {
                return {
                    section,
                    sectionIndex,
                    top,
                    bottom,
                    height
                };
            }
        }

        return null;
    }

    /*
     * Allow normal browser scrolling while the viewport is in
     * the middle of the FAQ.
     */
    function shouldAllowFreeScroll(
        direction,
        freeSection
    ) {
        if (!freeSection) {
            return false;
        }

        const viewportTop = pageWindow.scrollY;
        const viewportBottom =
            viewportTop + pageWindow.innerHeight;

        const tolerance = CONFIG.edgeTolerance;

        /*
         * Scroll down naturally until the bottom of the FAQ
         * reaches the bottom of the viewport.
         */
        if (
            direction > 0 &&
            viewportBottom <
                freeSection.bottom - tolerance
        ) {
            return true;
        }

        /*
         * Scroll up naturally until the top of the FAQ
         * reaches the top of the viewport.
         */
        if (
            direction < 0 &&
            viewportTop >
                freeSection.top + tolerance
        ) {
            return true;
        }

        return false;
    }

    /*
     * Return the exact snap point directly before or after
     * the FREE section.
     *
     * Returns null rather than -1, so an unresolved target
     * can never accidentally become snap point 0.
     */
    function getFreeSectionExitIndex(
        freeSection,
        direction
    ) {
        const freeSnapIndex =
            getSnapIndexForSectionIndex(
                freeSection.sectionIndex
            );

        if (freeSnapIndex === -1) {
            log(
                "Could not find FAQ snap point; exit cancelled"
            );

            return null;
        }

        const targetIndex =
            freeSnapIndex + direction;

        if (
            targetIndex < 0 ||
            targetIndex >= snapPoints.length
        ) {
            log(
                "FAQ exit target is outside the snap-point list"
            );

            return null;
        }

        return targetIndex;
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
     * Controlled animation avoids browser-native overshoot and
     * visible self-correction.
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

    function forceRearm() {
        pageWindow.clearTimeout(
            forcedRearmTimer
        );

        forcedRearmTimer =
            pageWindow.setTimeout(() => {
                gestureLatched = false;
                accumulatedDelta = 0;

                log(
                    "Forced re-arm at snap",
                    currentSnapIndex + 1
                );
            }, CONFIG.forcedRearmDelay);
    }

    /*
     * Move to one explicit, validated snap index.
     *
     * Invalid targets are ignored. They are never clamped to zero.
     */
    async function moveToSnap(targetIndex) {
        if (animating) {
            return;
        }

        buildSnapPoints();

        if (
            !Number.isInteger(targetIndex) ||
            targetIndex < 0 ||
            targetIndex >= snapPoints.length
        ) {
            log(
                "Invalid snap target ignored:",
                targetIndex
            );

            forceRearm();
            return;
        }

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
            "Moving:",
            `${currentSnapIndex + 1} → ${targetIndex + 1}`,
            target
        );

        try {
            await animateScrollTo(target.top);

            /*
             * The requested target remains authoritative.
             * Do not replace it with a nearest-point calculation.
             */
            currentSnapIndex = targetIndex;

            /*
             * Rebuild positions in case Wix changed layout while
             * the animation was running.
             */
            buildSnapPoints();

            const refreshedTarget =
                snapPoints[currentSnapIndex];

            if (refreshedTarget) {
                const difference =
                    refreshedTarget.top -
                    pageWindow.scrollY;

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
                "[Wix Snap Scroll v2.3.3] animation error",
                error
            );
        } finally {
            animating = false;
            forceRearm();
        }
    }

    function moveOneStep(direction) {
        const targetIndex =
            currentSnapIndex + direction;

        moveToSnap(targetIndex);
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

                const activeFreeSection =
                    findActiveFreeSection();

                /*
                 * Only modify the logical index during native FAQ
                 * scrolling. Outside the FAQ, preserve the last
                 * successfully completed snap index.
                 */
                if (activeFreeSection) {
                    const freeSnapIndex =
                        getSnapIndexForSectionIndex(
                            activeFreeSection.sectionIndex
                        );

                    if (freeSnapIndex !== -1) {
                        currentSnapIndex =
                            freeSnapIndex;
                    }
                }

                gestureLatched = false;
                accumulatedDelta = 0;

                log(
                    "Gesture ended; current snap:",
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

        const activeFreeSection =
            findActiveFreeSection();

        /*
         * FAQ behavior.
         */
        if (activeFreeSection) {
            const freeSnapIndex =
                getSnapIndexForSectionIndex(
                    activeFreeSection.sectionIndex
                );

            if (freeSnapIndex !== -1) {
                currentSnapIndex =
                    freeSnapIndex;
            }

            /*
             * In the middle of the FAQ, scrolling remains completely
             * native. Do not block or latch the gesture.
             */
            if (
                shouldAllowFreeScroll(
                    direction,
                    activeFreeSection
                )
            ) {
                gestureLatched = false;
                accumulatedDelta = 0;
                return;
            }

            /*
             * At the FAQ top or bottom, explicitly move to the
             * immediately neighboring snap point.
             */
            event.preventDefault();
            event.stopImmediatePropagation();

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

            const exitIndex =
                getFreeSectionExitIndex(
                    activeFreeSection,
                    direction
                );

            if (exitIndex !== null) {
                moveToSnap(exitIndex);
            } else {
                gestureLatched = false;
                accumulatedDelta = 0;
            }

            return;
        }

        /*
         * Normal one-step snapping outside the FAQ.
         */
        event.preventDefault();
        event.stopImmediatePropagation();

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
         * Wait until Wix finishes expanding or collapsing the
         * accordion, then rebuild the positions.
         */
        pageWindow.setTimeout(() => {
            buildSnapPoints();

            const activeFreeSection =
                findActiveFreeSection();

            if (activeFreeSection) {
                const freeSnapIndex =
                    getSnapIndexForSectionIndex(
                        activeFreeSection.sectionIndex
                    );

                if (freeSnapIndex !== -1) {
                    currentSnapIndex =
                        freeSnapIndex;
                }
            }
        }, 650);
    }

    function handleResize() {
        pageWindow.setTimeout(() => {
            buildSnapPoints();

            if (!animating) {
                const activeFreeSection =
                    findActiveFreeSection();

                if (activeFreeSection) {
                    const freeSnapIndex =
                        getSnapIndexForSectionIndex(
                            activeFreeSection.sectionIndex
                        );

                    if (freeSnapIndex !== -1) {
                        currentSnapIndex =
                            freeSnapIndex;
                    }
                } else {
                    /*
                     * Resize is one of the few cases where a full
                     * position resynchronization is appropriate.
                     */
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
         * Capture mode lets this handler run before older bubble-phase
         * listeners that may still exist.
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

        log(
            "Installed; current snap:",
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
