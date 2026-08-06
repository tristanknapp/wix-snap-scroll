console.log("[Wix Snap Scroll v2.3] file executing");

(() => {
    "use strict";

    const CONFIG = {
        sectionSelector: '[data-testid="section-container"]',

        splitSections: [
            "#comp-mrx3f3km"
        ],

        freeSections: [
            "#comp-mrxamx3r"
        ],

        wheelThreshold: 45,

        /*
         * A gesture is considered finished only after no wheel
         * events have arrived for this long.
         */
        gestureEndDelay: 320,

        scrollDuration: 800,
        edgeTolerance: 20,

        retryDelay: 400,
        maxRetries: 40,

        debug: true
    };

    const INSTANCE_KEY = "__WIX_SNAP_SCROLL_V23__";
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

    let animationFrame = null;
    let animationToken = 0;
    let retries = 0;

    function log(...args) {
        if (CONFIG.debug) {
            console.log("[Wix Snap Scroll v2.3]", ...args);
        }
    }

    function getAccessibleDocuments() {
        const results = [];
        const visited = new Set();

        function visit(win) {
            if (!win || visited.has(win)) return;

            visited.add(win);

            let doc;

            try {
                doc = win.document;
            } catch {
                return;
            }

            results.push({ win, doc });

            try {
                for (let i = 0; i < win.frames.length; i++) {
                    visit(win.frames[i]);
                }
            } catch {
                // Ignore inaccessible frames.
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

    function findPageDocument() {
        let bestMatch = null;
        let highestCount = 0;

        getAccessibleDocuments().forEach(({ win, doc }) => {
            let count = 0;

            try {
                count = doc.querySelectorAll(
                    CONFIG.sectionSelector
                ).length;
            } catch {
                return;
            }

            if (count > highestCount) {
                highestCount = count;
                bestMatch = { win, doc };
            }
        });

        if (!bestMatch || highestCount < 2) {
            return false;
        }

        pageWindow = bestMatch.win;
        pageDocument = bestMatch.doc;

        log(`Found page document with ${highestCount} sections`);

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
                    points.push({
                        top: Math.round(
                            Math.min(
                                top + viewportHeight * partIndex,
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
                if (index === 0) return true;

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
                y: point.top
            }))
        );
    }

    function findClosestSnapIndex() {
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

        for (const section of sections) {
            if (getMode(section) !== "FREE") continue;

            const top = getPageTop(section);
            const bottom =
                top + section.getBoundingClientRect().height;

            if (
                viewportBottom >
                    top + CONFIG.edgeTolerance &&
                viewportTop <
                    bottom - CONFIG.edgeTolerance
            ) {
                return { top, bottom };
            }
        }

        return null;
    }

    function shouldAllowFreeScroll(direction) {
        const freeSection = findActiveFreeSection();

        if (!freeSection) return false;

        const viewportTop = pageWindow.scrollY;
        const viewportBottom =
            viewportTop + pageWindow.innerHeight;

        if (
            direction > 0 &&
            viewportBottom <
                freeSection.bottom - CONFIG.edgeTolerance
        ) {
            return true;
        }

        if (
            direction < 0 &&
            viewportTop >
                freeSection.top + CONFIG.edgeTolerance
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

    function animateScrollTo(targetY) {
        if (animationFrame !== null) {
            pageWindow.cancelAnimationFrame(animationFrame);
        }

        animationToken++;

        const token = animationToken;
        const startY = pageWindow.scrollY;
        const distance = targetY - startY;
        const startTime = pageWindow.performance.now();

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
                        distance * easeInOutQuart(progress),
                    left: 0,
                    behavior: "auto"
                });

                if (progress < 1) {
                    animationFrame =
                        pageWindow.requestAnimationFrame(frame);

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

    async function moveOneStep(direction) {
        if (animating) return;

        buildSnapPoints();

        const targetIndex = Math.max(
            0,
            Math.min(
                currentSnapIndex + direction,
                snapPoints.length - 1
            )
        );

        if (targetIndex === currentSnapIndex) {
            return;
        }

        const target = snapPoints[targetIndex];

        if (!target) return;

        animating = true;

        log(
            `Moving exactly one snap:`,
            `${currentSnapIndex + 1} → ${targetIndex + 1}`
        );

        try {
            await animateScrollTo(target.top);

            /*
             * The target index is authoritative. Do not derive the
             * destination from trackpad momentum or current scrollY.
             */
            currentSnapIndex = targetIndex;

            /*
             * Re-read the target position once in case Wix shifted
             * slightly during the animation.
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
        } finally {
            animating = false;
        }
    }

    function resetGestureAfterSilence() {
        pageWindow.clearTimeout(gestureEndTimer);

        gestureEndTimer = pageWindow.setTimeout(() => {
            gestureLatched = false;
            accumulatedDelta = 0;

            /*
             * Only synchronize after the entire gesture has ended.
             */
            if (!animating) {
                currentSnapIndex =
                    findClosestSnapIndex();
            }

            log("Wheel gesture ended; re-armed");
        }, CONFIG.gestureEndDelay);
    }

    function handleWheel(event) {
        if (!event.deltaY) return;

        const direction = event.deltaY > 0 ? 1 : -1;

        resetGestureAfterSilence();

        /*
         * FAQ receives normal native scrolling.
         */
        if (shouldAllowFreeScroll(direction)) {
            accumulatedDelta = 0;
            return;
        }

        /*
         * Capture the event before older snap-scroll instances can
         * process it.
         */
        event.preventDefault();
        event.stopImmediatePropagation();

        /*
         * Once one movement has been triggered, every remaining event
         * in this same physical gesture is ignored.
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

        pageWindow.setTimeout(() => {
            buildSnapPoints();
        }, 650);
    }

    function install() {
        /*
         * Remove a previous v2.3 instance if this file was loaded twice.
         */
        if (
            typeof pageWindow[CLEANUP_KEY] === "function"
        ) {
            pageWindow[CLEANUP_KEY]();
        }

        buildSnapPoints();

        if (sections.length < 2) return;

        currentSnapIndex = findClosestSnapIndex();

        /*
         * Capture mode is important. It lets this handler run before
         * older bubble-phase wheel listeners.
         */
        pageWindow.addEventListener(
            "wheel",
            handleWheel,
            {
                passive: false,
                capture: true
            }
        );

        pageDocument.addEventListener(
            "click",
            handleAccordionClick
        );

        const resizeHandler = () => {
            pageWindow.setTimeout(() => {
                buildSnapPoints();

                if (!animating) {
                    currentSnapIndex =
                        findClosestSnapIndex();
                }
            }, 150);
        };

        pageWindow.addEventListener(
            "resize",
            resizeHandler
        );

        pageWindow[CLEANUP_KEY] = () => {
            pageWindow.removeEventListener(
                "wheel",
                handleWheel,
                { capture: true }
            );

            pageWindow.removeEventListener(
                "resize",
                resizeHandler
            );

            pageDocument.removeEventListener(
                "click",
                handleAccordionClick
            );

            pageWindow.clearTimeout(gestureEndTimer);

            if (animationFrame !== null) {
                pageWindow.cancelAnimationFrame(
                    animationFrame
                );
            }
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
            log("Unable to find Wix page document");
        }
    }

    initialize();
})();
