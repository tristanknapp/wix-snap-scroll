console.log("[Wix Snap Scroll v2.2] file executing");

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
        wheelResetDelay: 220,

        scrollDuration: 800,

        /*
         * Ignore residual wheel momentum after arriving.
         * Increasing this reduces accidental double movement.
         */
        postScrollCooldown: 450,

        retryDelay: 400,
        maxRetries: 40,
        edgeTolerance: 20,

        debug: true
    };

    const INSTANCE_KEY = "__WIX_SNAP_SCROLL_V22__";

    let pageWindow = null;
    let pageDocument = null;

    let sections = [];
    let snapPoints = [];

    let currentSnapIndex = 0;
    let targetSnapIndex = 0;

    let locked = false;
    let wheelTotal = 0;
    let wheelResetTimer = null;
    let retries = 0;

    let animationFrame = null;
    let animationToken = 0;

    function log(...args) {
        if (CONFIG.debug) {
            console.log("[Wix Snap Scroll v2.2]", ...args);
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
                // Ignore inaccessible frames.
            }
        }

        visit(window);

        try {
            visit(window.top);
        } catch (error) {
            // The top-level window may be inaccessible.
        }

        return results;
    }

    function findPageDocument() {
        const documents = getAccessibleDocuments();

        let bestMatch = null;
        let highestSectionCount = 0;

        documents.forEach(({ win, doc }) => {
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
            } else if (mode === "SPLIT") {
                const partCount = Math.max(
                    1,
                    Math.round(height / viewportHeight)
                );

                const lastPossibleTop = Math.max(
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
                                lastPossibleTop
                            )
                        ),
                        section,
                        sectionIndex,
                        partIndex,
                        mode
                    });
                }
            } else {
                points.push({
                    top: Math.round(top),
                    section,
                    sectionIndex,
                    partIndex: 0,
                    mode
                });
            }
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
                y: point.top
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

    function synchronizeCurrentIndex() {
        currentSnapIndex = findClosestSnapIndex();
        targetSnapIndex = currentSnapIndex;

        log(
            `Current snap synchronized to ${currentSnapIndex + 1}`
        );
    }

    function findActiveFreeSection() {
        const viewportTop = pageWindow.scrollY;
        const viewportBottom =
            viewportTop + pageWindow.innerHeight;

        for (
            let index = 0;
            index < sections.length;
            index++
        ) {
            const section = sections[index];

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
                    index,
                    top,
                    bottom
                };
            }
        }

        return null;
    }

    function shouldFreeScroll(direction) {
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

    function animateScrollTo(targetY) {
        if (animationFrame !== null) {
            pageWindow.cancelAnimationFrame(
                animationFrame
            );
        }

        animationToken++;

        const currentToken = animationToken;
        const startY = pageWindow.scrollY;
        const distance = targetY - startY;
        const startTime =
            pageWindow.performance.now();

        return new Promise((resolve) => {
            function frame(currentTime) {
                if (currentToken !== animationToken) {
                    resolve(false);
                    return;
                }

                const elapsed =
                    currentTime - startTime;

                const progress = Math.min(
                    elapsed / CONFIG.scrollDuration,
                    1
                );

                const easedProgress =
                    easeInOutQuart(progress);

                pageWindow.scrollTo({
                    top:
                        startY +
                        distance * easedProgress,
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

    async function scrollToSnap(index) {
        if (locked) {
            return;
        }

        const clampedIndex = Math.max(
            0,
            Math.min(index, snapPoints.length - 1)
        );

        if (clampedIndex === currentSnapIndex) {
            return;
        }

        locked = true;
        wheelTotal = 0;
        targetSnapIndex = clampedIndex;

        /*
         * Refresh positions but preserve the intended index.
         */
        buildSnapPoints();

        const target = snapPoints[targetSnapIndex];

        if (!target) {
            locked = false;
            synchronizeCurrentIndex();
            return;
        }

        const targetY = Math.round(target.top);

        log(
            `Moving exactly one step:`,
            `${currentSnapIndex + 1} → ${targetSnapIndex + 1}`,
            `targetY=${targetY}`
        );

        try {
            await animateScrollTo(targetY);

            /*
             * The completed destination becomes the authoritative
             * current index. It is not recalculated from scrollY.
             */
            currentSnapIndex = targetSnapIndex;

            buildSnapPoints();

            const updatedTarget =
                snapPoints[currentSnapIndex];

            if (updatedTarget) {
                const correctedY =
                    Math.round(updatedTarget.top);

                const difference = Math.abs(
                    pageWindow.scrollY -
                    correctedY
                );

                if (difference > 4) {
                    pageWindow.scrollTo({
                        top: correctedY,
                        left: 0,
                        behavior: "auto"
                    });
                }
            }
        } catch (error) {
            console.error(
                "[Wix Snap Scroll v2.2] animation error",
                error
            );

            synchronizeCurrentIndex();
        } finally {
            /*
             * Keep the page locked briefly after the animation so
             * trackpad momentum cannot immediately trigger another move.
             */
            pageWindow.setTimeout(() => {
                wheelTotal = 0;
                locked = false;
            }, CONFIG.postScrollCooldown);
        }
    }

    function moveOneStep(direction) {
        const nextIndex = Math.max(
            0,
            Math.min(
                currentSnapIndex + direction,
                snapPoints.length - 1
            )
        );

        if (nextIndex === currentSnapIndex) {
            wheelTotal = 0;
            return;
        }

        scrollToSnap(nextIndex);
    }

    function handleWheel(event) {
        if (!event.deltaY) {
            return;
        }

        const direction =
            event.deltaY > 0 ? 1 : -1;

        /*
         * Allow ordinary scrolling inside the FAQ.
         */
        if (shouldFreeScroll(direction)) {
            wheelTotal = 0;

            /*
             * Native movement means we are no longer necessarily
             * aligned to a snap point.
             */
            synchronizeCurrentIndex();
            return;
        }

        if (locked) {
            event.preventDefault();
            return;
        }

        wheelTotal += event.deltaY;

        pageWindow.clearTimeout(
            wheelResetTimer
        );

        wheelResetTimer =
            pageWindow.setTimeout(() => {
                wheelTotal = 0;
            }, CONFIG.wheelResetDelay);

        if (
            Math.abs(wheelTotal) <
            CONFIG.wheelThreshold
        ) {
            return;
        }

        event.preventDefault();

        const requestedDirection =
            wheelTotal > 0 ? 1 : -1;

        wheelTotal = 0;

        moveOneStep(requestedDirection);
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
            synchronizeCurrentIndex();
        }, 650);
    }

    function handleNativeScroll() {
        /*
         * Do not update the index during our own animation.
         * Only synchronize after manual/native scrolling.
         */
        if (locked) {
            return;
        }

        synchronizeCurrentIndex();
    }

    function install() {
        if (pageWindow[INSTANCE_KEY]) {
            log("Already installed");
            return;
        }

        buildSnapPoints();

        if (sections.length < 2) {
            return;
        }

        synchronizeCurrentIndex();

        pageWindow[INSTANCE_KEY] = true;

        pageWindow.addEventListener(
            "wheel",
            handleWheel,
            { passive: false }
        );

        pageWindow.addEventListener(
            "scroll",
            handleNativeScroll,
            { passive: true }
        );

        pageWindow.addEventListener(
            "resize",
            () => {
                pageWindow.setTimeout(() => {
                    buildSnapPoints();
                    synchronizeCurrentIndex();
                }, 150);
            }
        );

        pageDocument.addEventListener(
            "click",
            handleAccordionClick
        );

        log("Installed successfully");
    }

    function initialize() {
        retries++;

        if (findPageDocument()) {
            install();

            if (pageWindow?.[INSTANCE_KEY]) {
                return;
            }
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
