console.log("[Wix Snap Scroll v2.1] file executing");

(() => {
    "use strict";

    const CONFIG = {
        sectionSelector: '[data-testid="section-container"]',

        // Your 200vh hero section.
        splitSections: [
            "#comp-mrx3f3km"
        ],

        // Your FAQ section, which scrolls normally.
        freeSections: [
            "#comp-mrxamx3r"
        ],

        // Wheel and trackpad behavior.
        wheelThreshold: 30,
        resetDelay: 180,

        // Controlled scroll animation.
        scrollDuration: 800,
        scrollLockReleaseDelay: 80,

        // Section detection.
        retryDelay: 400,
        maxRetries: 40,
        edgeTolerance: 20,

        debug: true
    };

    const INSTANCE_KEY = "__WIX_SNAP_SCROLL_V21__";

    let pageWindow = null;
    let pageDocument = null;

    let sections = [];
    let snapPoints = [];

    let locked = false;
    let wheelTotal = 0;
    let wheelResetTimer = null;
    let retries = 0;

    let animationFrame = null;
    let animationToken = 0;

    function log(...args) {
        if (CONFIG.debug) {
            console.log("[Wix Snap Scroll v2.1]", ...args);
        }
    }

    /*
     * Wix may run the custom-code loader in a wrapper document.
     * This searches accessible frames for the document that contains
     * the actual Wix Studio sections.
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
            // The top window may be inaccessible.
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

    /*
     * Builds the positions the page may snap to.
     *
     * SNAP:
     * One point at the top of the section.
     *
     * SPLIT:
     * One point per viewport-height part.
     *
     * FREE:
     * One point at the top, followed by native scrolling.
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

            log(
                `Section ${sectionIndex + 1}`,
                `id=${section.id}`,
                `height=${Math.round(height)}`,
                `mode=${mode}`
            );
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

    /*
     * Allows normal scrolling through the FAQ until the user reaches
     * its upper or lower edge.
     */
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

    function findTargetIndex(direction) {
        const currentY = pageWindow.scrollY;
        const tolerance = 24;

        if (direction > 0) {
            return snapPoints.findIndex(
                (point) =>
                    point.top >
                    currentY + tolerance
            );
        }

        for (
            let index = snapPoints.length - 1;
            index >= 0;
            index--
        ) {
            if (
                snapPoints[index].top <
                currentY - tolerance
            ) {
                return index;
            }
        }

        return -1;
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
     * Uses requestAnimationFrame rather than the browser's native
     * smooth scrolling. This gives us a consistent destination and
     * avoids native overshooting and correction behavior.
     */
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

                /*
                 * End on the exact target pixel.
                 */
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

        if (
            index < 0 ||
            index >= snapPoints.length
        ) {
            return;
        }

        locked = true;
        wheelTotal = 0;

        /*
         * Recalculate immediately before scrolling. Wix layouts may
         * have shifted since the last wheel event.
         */
        buildSnapPoints();

        let target = snapPoints[index];

        if (!target) {
            locked = false;
            return;
        }

        const targetY = Math.round(target.top);

        log(
            `Scrolling to snap ${index + 1}`,
            `targetY=${targetY}`,
            target
        );

        try {
            await animateScrollTo(targetY);

            /*
             * Recalculate after the animation because Wix accordions,
             * images or responsive layout changes may have moved the
             * destination while scrolling.
             */
            buildSnapPoints();

            target = snapPoints[index];

            if (target) {
                const correctedY =
                    Math.round(target.top);

                const difference = Math.abs(
                    pageWindow.scrollY -
                    correctedY
                );

                /*
                 * Ignore tiny subpixel differences. Only correct a
                 * meaningful layout shift.
                 */
                if (difference > 3) {
                    log(
                        `Correcting final position by ` +
                        `${Math.round(difference)}px`
                    );

                    pageWindow.scrollTo({
                        top: correctedY,
                        left: 0,
                        behavior: "auto"
                    });
                }
            }
        } catch (error) {
            console.error(
                "[Wix Snap Scroll v2.1] " +
                "Scroll animation failed",
                error
            );
        } finally {
            pageWindow.setTimeout(() => {
                locked = false;
            }, CONFIG.scrollLockReleaseDelay);
        }
    }

    function move(direction) {
        buildSnapPoints();

        const targetIndex =
            findTargetIndex(direction);

        if (targetIndex === -1) {
            wheelTotal = 0;
            return;
        }

        scrollToSnap(targetIndex);
    }

    function handleWheel(event) {
        if (!event.deltaY) {
            return;
        }

        const direction =
            event.deltaY > 0 ? 1 : -1;

        /*
         * Native scrolling receives priority inside the FAQ.
         */
        if (shouldFreeScroll(direction)) {
            wheelTotal = 0;
            return;
        }

        /*
         * Prevent trackpad momentum from moving the page during
         * an active snap animation.
         */
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
            }, CONFIG.resetDelay);

        if (
            Math.abs(wheelTotal) <
            CONFIG.wheelThreshold
        ) {
            return;
        }

        event.preventDefault();

        move(wheelTotal > 0 ? 1 : -1);
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
         * Wait for the accordion opening or closing animation.
         */
        pageWindow.setTimeout(
            buildSnapPoints,
            650
        );
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

        pageWindow[INSTANCE_KEY] = true;

        pageWindow.addEventListener(
            "wheel",
            handleWheel,
            { passive: false }
        );

        pageWindow.addEventListener(
            "resize",
            () => {
                pageWindow.setTimeout(
                    buildSnapPoints,
                    150
                );
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
