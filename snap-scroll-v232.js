console.log("[Wix Snap Scroll v2.3.2] file executing");

(() => {
    "use strict";

    const CONFIG = {
        sectionSelector: '[data-testid="section-container"]',

        // 200vh hero section.
        splitSections: [
            "#comp-mrx3f3km"
        ],

        // FAQ section with normal scrolling.
        freeSections: [
            "#comp-mrxamx3r"
        ],

        wheelThreshold: 45,

        // Silence required before a physical gesture is considered finished.
        gestureEndDelay: 320,

        // Re-arm after arriving even if the browser keeps the gesture open.
        forcedRearmDelay: 500,

        scrollDuration: 800,
        edgeTolerance: 20,

        retryDelay: 400,
        maxRetries: 40,

        debug: true
    };

    const INSTANCE_KEY = "__WIX_SNAP_SCROLL_V232__";
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
            console.log("[Wix Snap Scroll v2.3.2]", ...args);
        }
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
                for (let index = 0; index < win.frames.length; index++) {
                    visit(win.frames[index]);
                }
            } catch {
                // Ignore cross-origin frames.
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

        log(`Found page document with ${highestSectionCount} sections`);

        return true;
    }

    function matchesSelectorList(element, selectors) {
        return selectors.some((selector) => {
            try {
                return element.matches(selector);
            } catch {
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

    function getSnapIndexForSection(section) {
        return snapPoints.findIndex(
            (point) => point.section === section
        );
    }

    /*
     * Important:
     * A free section becomes active only after the viewport TOP
     * has entered it.
     *
     * Merely seeing the FAQ at the bottom of the viewport no longer
     * changes the current snap index.
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

    function shouldAllowFreeScroll(direction, freeSection) {
        if (!freeSection) {
            return false;
        }

        const viewportTop = pageWindow.scrollY;
        const viewportBottom =
            viewportTop + pageWindow.innerHeight;

        const tolerance = CONFIG.edgeTolerance;

        // Allow ordinary downward scrolling until the FAQ bottom.
        if (
            direction > 0 &&
            viewportBottom <
                freeSection.bottom - tolerance
        ) {
            return true;
        }

        // Allow ordinary upward scrolling until the FAQ top.
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
     * Finds the exact snap immediately before or after a FREE section.
     * This avoids relying on a potentially stale current index.
     */
    function getFreeSectionExitIndex(freeSection, direction) {
        const freeSnapIndex =
            getSnapIndexForSection(freeSection.section);

        if (freeSnapIndex === -1) {
            return -1;
        }

        if (direction > 0) {
            return Math.min(
                freeSnapIndex + 1,
                snapPoints.length - 1
            );
        }

        return Math.max(
            freeSnapIndex - 1,
            0
        );
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

    function animateScrollTo(targetY) {
        if (animationFrame !== null) {
            pageWindow.cancelAnimationFrame(animationFrame);
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
                pageWindow.requestAnimationFrame(frame);
        });
    }

    function forceRearm() {
        pageWindow.clearTimeout(forcedRearmTimer);

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

    async function moveToSnap(targetIndex) {
        if (animating) {
            return;
        }

        buildSnapPoints();

        const clampedIndex = Math.max(
            0,
            Math.min(
                targetIndex,
                snapPoints.length - 1
            )
        );

        if (clampedIndex === currentSnapIndex) {
            forceRearm();
            return;
        }

        const target = snapPoints[clampedIndex];

        if (!target) {
            forceRearm();
            return;
        }

        animating = true;

        log(
            "Moving:",
            `${currentSnapIndex + 1} → ${clampedIndex + 1}`,
            target
        );

        try {
            await animateScrollTo(target.top);

            currentSnapIndex = clampedIndex;

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
                "[Wix Snap Scroll v2.3.2] animation error",
                error
            );

            currentSnapIndex =
                findClosestSnapIndex();
        } finally {
            animating = false;
            forceRearm();
        }
    }

    function moveOneStep(direction) {
        const targetIndex = Math.max(
            0,
            Math.min(
                currentSnapIndex + direction,
                snapPoints.length - 1
            )
        );

        moveToSnap(targetIndex);
    }

    function resetGestureAfterSilence() {
        pageWindow.clearTimeout(gestureEndTimer);

        gestureEndTimer =
            pageWindow.setTimeout(() => {
                if (animating) {
                    return;
                }

                const activeFreeSection =
                    findActiveFreeSection();

                if (activeFreeSection) {
                    const freeSnapIndex =
                        getSnapIndexForSection(
                            activeFreeSection.section
                        );

                    if (freeSnapIndex !== -1) {
                        currentSnapIndex =
                            freeSnapIndex;
                    }
                } else {
                    currentSnapIndex =
                        findClosestSnapIndex();
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
         * FAQ handling.
         */
        if (activeFreeSection) {
            const freeSnapIndex =
                getSnapIndexForSection(
                    activeFreeSection.section
                );

            if (freeSnapIndex !== -1) {
                currentSnapIndex = freeSnapIndex;
            }

            /*
             * In the middle of the FAQ, leave scrolling completely
             * native and do not latch the gesture.
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
             * At the FAQ's top or bottom, snap explicitly to the
             * neighboring section.
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

            moveToSnap(exitIndex);
            return;
        }

        /*
         * Normal snapping outside the FAQ.
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

        pageWindow.setTimeout(() => {
            buildSnapPoints();

            const activeFreeSection =
                findActiveFreeSection();

            if (activeFreeSection) {
                const freeSnapIndex =
                    getSnapIndexForSection(
                        activeFreeSection.section
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
                        getSnapIndexForSection(
                            activeFreeSection.section
                        );

                    if (freeSnapIndex !== -1) {
                        currentSnapIndex =
                            freeSnapIndex;
                    }
                } else {
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
