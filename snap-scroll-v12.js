console.log("[Wix Snap Scroll v12] file executing");

(() => {
    "use strict";

    const CONFIG = {
        sectionSelector: '[data-testid="section-container"]',

        // Your 200vh hero section:
        splitSectionSelectors: [
            "#comp-mrx3f3km"
        ],

        // Your normally scrollable FAQ section:
        freeSectionSelectors: [
            "#comp-mrxamx3r"
        ],

        wheelThreshold: 30,
        wheelResetDelay: 180,
        cooldown: 950,
        edgeTolerance: 20,

        searchDelay: 400,
        maxSearchAttempts: 75,

        debug: true
    };

    let pageWindow = null;
    let pageDocument = null;

    let sections = [];
    let snapPoints = [];

    let locked = false;
    let wheelDelta = 0;
    let wheelResetTimer = null;
    let searchAttempts = 0;

    function log(...args) {
        if (CONFIG.debug) {
            console.log("[Wix Snap Scroll v12]", ...args);
        }
    }

    function safelyGetDocument(frameWindow) {
        try {
            return frameWindow.document;
        } catch (error) {
            return null;
        }
    }

    function collectAccessibleWindows(rootWindow) {
        const results = [];
        const visited = new Set();

        function visit(candidateWindow) {
            if (!candidateWindow || visited.has(candidateWindow)) {
                return;
            }

            visited.add(candidateWindow);

            const candidateDocument =
                safelyGetDocument(candidateWindow);

            if (!candidateDocument) {
                return;
            }

            results.push({
                win: candidateWindow,
                doc: candidateDocument
            });

            let frames;

            try {
                frames = candidateWindow.frames;
            } catch (error) {
                return;
            }

            for (let index = 0; index < frames.length; index++) {
                try {
                    visit(frames[index]);
                } catch (error) {
                    // Ignore inaccessible cross-origin frames.
                }
            }
        }

        visit(rootWindow);

        try {
            if (rootWindow.top && rootWindow.top !== rootWindow) {
                visit(rootWindow.top);
            }
        } catch (error) {
            // Top window may be cross-origin.
        }

        return results;
    }

    function findPageContext() {
        const contexts = collectAccessibleWindows(window);

        let bestMatch = null;
        let highestSectionCount = 0;

        contexts.forEach(({ win, doc }) => {
            let sectionCount = 0;

            try {
                sectionCount = doc.querySelectorAll(
                    CONFIG.sectionSelector
                ).length;
            } catch (error) {
                return;
            }

            log(
                "Checked document:",
                doc.location?.href || "(unknown)",
                `sections=${sectionCount}`
            );

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
            "Found page context:",
            pageDocument.location?.href || "(unknown)",
            `with ${highestSectionCount} sections`
        );

        return true;
    }

    function matchesAnySelector(element, selectors) {
        return selectors.some((selector) => {
            try {
                return element.matches(selector);
            } catch (error) {
                log("Invalid selector:", selector);
                return false;
            }
        });
    }

    function getSectionMode(section) {
        if (
            matchesAnySelector(
                section,
                CONFIG.freeSectionSelectors
            )
        ) {
            return "FREE";
        }

        if (
            matchesAnySelector(
                section,
                CONFIG.splitSectionSelectors
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

    function getSections() {
        if (!pageDocument) {
            return [];
        }

        return Array.from(
            pageDocument.querySelectorAll(
                CONFIG.sectionSelector
            )
        ).filter((section) => {
            return section.getBoundingClientRect().height > 0;
        });
    }

    function buildSnapPoints() {
        sections = getSections();

        const viewportHeight = pageWindow.innerHeight;
        const points = [];

        sections.forEach((section, sectionIndex) => {
            const rect = section.getBoundingClientRect();
            const sectionTop = getPageTop(section);
            const sectionHeight = rect.height;
            const mode = getSectionMode(section);

            let partCount = 1;

            if (mode === "SPLIT") {
                partCount = Math.max(
                    1,
                    Math.round(
                        sectionHeight / viewportHeight
                    )
                );
            }

            if (mode === "FREE") {
                points.push({
                    top: Math.round(sectionTop),
                    section,
                    sectionIndex,
                    partIndex: 0,
                    mode
                });
            } else {
                const maximumTop = Math.max(
                    sectionTop,
                    sectionTop +
                        sectionHeight -
                        viewportHeight
                );

                for (
                    let partIndex = 0;
                    partIndex < partCount;
                    partIndex++
                ) {
                    const requestedTop =
                        sectionTop +
                        viewportHeight * partIndex;

                    points.push({
                        top: Math.round(
                            Math.min(
                                requestedTop,
                                maximumTop
                            )
                        ),
                        section,
                        sectionIndex,
                        partIndex,
                        mode
                    });
                }
            }

            log(
                `Section ${sectionIndex + 1}`,
                `id=${section.id || "(none)"}`,
                `height=${Math.round(sectionHeight)}px`,
                `mode=${mode}`,
                `parts=${partCount}`
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
            `Built ${snapPoints.length} snap points from`,
            `${sections.length} Wix sections`
        );

        log(
            snapPoints.map((point, index) => ({
                snap: index + 1,
                y: point.top,
                section: point.sectionIndex + 1,
                part: point.partIndex + 1,
                mode: point.mode,
                id: point.section.id
            }))
        );

        return sections.length;
    }

    function getActiveFreeSection() {
        const viewportTop = pageWindow.scrollY;
        const viewportBottom =
            viewportTop + pageWindow.innerHeight;

        for (
            let sectionIndex = 0;
            sectionIndex < sections.length;
            sectionIndex++
        ) {
            const section = sections[sectionIndex];

            if (getSectionMode(section) !== "FREE") {
                continue;
            }

            const sectionTop = getPageTop(section);
            const sectionHeight =
                section.getBoundingClientRect().height;
            const sectionBottom =
                sectionTop + sectionHeight;

            const overlapsViewport =
                viewportBottom >
                    sectionTop + CONFIG.edgeTolerance &&
                viewportTop <
                    sectionBottom - CONFIG.edgeTolerance;

            if (overlapsViewport) {
                return {
                    section,
                    sectionIndex,
                    sectionTop,
                    sectionBottom
                };
            }
        }

        return null;
    }

    function allowNativeFreeScroll(direction) {
        const activeFreeSection =
            getActiveFreeSection();

        if (!activeFreeSection) {
            return false;
        }

        const viewportTop = pageWindow.scrollY;
        const viewportBottom =
            viewportTop + pageWindow.innerHeight;
        const tolerance = CONFIG.edgeTolerance;

        if (
            direction > 0 &&
            viewportBottom <
                activeFreeSection.sectionBottom -
                    tolerance
        ) {
            return true;
        }

        if (
            direction < 0 &&
            viewportTop >
                activeFreeSection.sectionTop +
                    tolerance
        ) {
            return true;
        }

        return false;
    }

    function findTargetSnapIndex(direction) {
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

    function scrollToSnapPoint(index) {
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
        wheelDelta = 0;

        log(
            `Scrolling to snap ${index + 1}`,
            `section=${target.sectionIndex + 1}`,
            `part=${target.partIndex + 1}`,
            `mode=${target.mode}`,
            `y=${target.top}`
        );

        pageWindow.scrollTo({
            top: target.top,
            left: 0,
            behavior: "smooth"
        });

        pageWindow.setTimeout(() => {
            locked = false;
        }, CONFIG.cooldown);
    }

    function move(direction) {
        buildSnapPoints();

        const targetIndex =
            findTargetSnapIndex(direction);

        if (targetIndex === -1) {
            wheelDelta = 0;
            return;
        }

        scrollToSnapPoint(targetIndex);
    }

    function handleWheel(event) {
        if (snapPoints.length === 0) {
            return;
        }

        const direction =
            event.deltaY > 0 ? 1 : -1;

        if (allowNativeFreeScroll(direction)) {
            wheelDelta = 0;
            return;
        }

        if (locked) {
            event.preventDefault();
            return;
        }

        wheelDelta += event.deltaY;

        pageWindow.clearTimeout(
            wheelResetTimer
        );

        wheelResetTimer =
            pageWindow.setTimeout(() => {
                wheelDelta = 0;
            }, CONFIG.wheelResetDelay);

        if (
            Math.abs(wheelDelta) <
            CONFIG.wheelThreshold
        ) {
            return;
        }

        event.preventDefault();

        move(wheelDelta > 0 ? 1 : -1);
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
        if (
            pageWindow.__WIX_SNAP_SCROLL_V12__
        ) {
            log("Already installed in page context");
            return;
        }

        const sectionCount = buildSnapPoints();

        if (sectionCount < 2) {
            return;
        }

        pageWindow.__WIX_SNAP_SCROLL_V12__ =
            true;

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

        log("Snap scrolling initialized");
    }

    function searchAndInitialize() {
        searchAttempts++;

        if (findPageContext()) {
            install();

            if (
                pageWindow
                    ?.__WIX_SNAP_SCROLL_V12__
            ) {
                return;
            }
        }

        if (
            searchAttempts <
            CONFIG.maxSearchAttempts
        ) {
            window.setTimeout(
                searchAndInitialize,
                CONFIG.searchDelay
            );
        } else {
            log(
                "Could not find a Wix document containing sections."
            );
        }
    }

    searchAndInitialize();
})();
