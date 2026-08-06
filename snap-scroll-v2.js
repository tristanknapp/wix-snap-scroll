console.log("[Wix Snap Scroll v2] file executing");

(() => {
    "use strict";

    const CONFIG = {
        sectionSelector: '[data-testid="section-container"]',

        // Your 200vh hero section.
        splitSections: [
            "#comp-mrx3f3km"
        ],

        // Your FAQ section, which should scroll normally.
        freeSections: [
            "#comp-mrxamx3r"
        ],

        wheelThreshold: 30,
        resetDelay: 180,
        scrollLockDuration: 900,

        retryDelay: 400,
        maxRetries: 40,

        edgeTolerance: 20,
        debug: true
    };

    const INSTANCE_KEY = "__WIX_SNAP_SCROLL_V2__";

    let pageWindow = null;
    let pageDocument = null;

    let sections = [];
    let snapPoints = [];

    let locked = false;
    let wheelTotal = 0;
    let wheelResetTimer = null;
    let retries = 0;

    function log(...args) {
        if (CONFIG.debug) {
            console.log("[Wix Snap Scroll v2]", ...args);
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
                for (let index = 0; index < win.frames.length; index++) {
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
            // Top window may not be accessible.
        }

        return results;
    }

    function findPageDocument() {
        const documents = getAccessibleDocuments();

        let best = null;
        let highestCount = 0;

        documents.forEach(({ win, doc }) => {
            let count = 0;

            try {
                count = doc.querySelectorAll(
                    CONFIG.sectionSelector
                ).length;
            } catch (error) {
                return;
            }

            if (count > highestCount) {
                highestCount = count;
                best = { win, doc };
            }
        });

        if (!best || highestCount < 2) {
            return false;
        }

        pageWindow = best.win;
        pageDocument = best.doc;

        log(`Found page document with ${highestCount} sections`);

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

                return Math.abs(
                    point.top - list[index - 1].top
                ) > 10;
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

            const overlaps =
                viewportBottom > top + CONFIG.edgeTolerance &&
                viewportTop < bottom - CONFIG.edgeTolerance;

            if (overlaps) {
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

    function findTargetIndex(direction) {
        const currentY = pageWindow.scrollY;
        const tolerance = 24;

        if (direction > 0) {
            return snapPoints.findIndex(
                (point) => point.top > currentY + tolerance
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

    function scrollToSnap(index) {
        if (locked) {
            return;
        }

        if (
            index < 0 ||
            index >= snapPoints.length
        ) {
            return;
        }

        const target = snapPoints[index];

        locked = true;
        wheelTotal = 0;

        log(
            `Scrolling to snap ${index + 1}`,
            target
        );

        pageWindow.scrollTo({
            top: target.top,
            left: 0,
            behavior: "smooth"
        });

        pageWindow.setTimeout(() => {
            locked = false;
        }, CONFIG.scrollLockDuration);
    }

    function move(direction) {
        buildSnapPoints();

        const targetIndex = findTargetIndex(direction);

        if (targetIndex === -1) {
            wheelTotal = 0;
            return;
        }

        scrollToSnap(targetIndex);
    }

    function handleWheel(event) {
        const direction = event.deltaY > 0 ? 1 : -1;

        if (shouldFreeScroll(direction)) {
            wheelTotal = 0;
            return;
        }

        if (locked) {
            event.preventDefault();
            return;
        }

        wheelTotal += event.deltaY;

        pageWindow.clearTimeout(wheelResetTimer);

        wheelResetTimer = pageWindow.setTimeout(() => {
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

        pageWindow.setTimeout(
            buildSnapPoints,
            600
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
            log("Unable to find the Wix page document");
        }
    }

    initialize();
})();
