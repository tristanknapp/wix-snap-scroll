console.log("[Wix Snap Scroll v10] file executing");

(() => {
    "use strict";

    const CONFIG = {
        sectionSelector: '[data-testid="section-container"]',

        /*
         * The first Wix section is 200vh and should behave
         * like two screens.
         */
        splitSectionIndexes: [0],

        /*
         * These sections allow normal scrolling internally.
         * Your FAQ section:
         */
        freeSectionSelectors: [
            "#comp-mrxamx3r"
        ],

        wheelThreshold: 30,
        wheelResetDelay: 180,
        cooldown: 950,
        edgeTolerance: 18,
        debug: true
    };

    const INSTANCE_KEY = "__WIX_SNAP_SCROLL_V10__";

    if (window[INSTANCE_KEY]) {
        console.log("[Wix Snap Scroll v10] duplicate instance ignored");
        return;
    }

    let sections = [];
    let snapPoints = [];
    let locked = false;
    let wheelDelta = 0;
    let wheelResetTimer = null;
    let retryCount = 0;

    const MAX_RETRIES = 30;
    const RETRY_DELAY = 500;

    function log(...args) {
        if (CONFIG.debug) {
            console.log("[Wix Snap Scroll v10]", ...args);
        }
    }

    function getPageTop(element) {
        return element.getBoundingClientRect().top + window.scrollY;
    }

    function getVisibleSections() {
        return Array.from(
            document.querySelectorAll(CONFIG.sectionSelector)
        ).filter((section) => {
            const rect = section.getBoundingClientRect();

            return rect.height > 0;
        });
    }

    function matchesAnySelector(element, selectors) {
        return selectors.some((selector) => {
            try {
                return element.matches(selector);
            } catch (error) {
                log("Invalid selector:", selector, error);
                return false;
            }
        });
    }

    function getSectionMode(section, sectionIndex) {
        if (
            matchesAnySelector(
                section,
                CONFIG.freeSectionSelectors
            )
        ) {
            return "FREE";
        }

        if (
            CONFIG.splitSectionIndexes.includes(sectionIndex)
        ) {
            return "SPLIT";
        }

        return "SNAP";
    }

    function buildSnapPoints() {
        sections = getVisibleSections();

        const viewportHeight = window.innerHeight;
        const points = [];

        sections.forEach((section, sectionIndex) => {
            const rect = section.getBoundingClientRect();
            const sectionTop = getPageTop(section);
            const sectionHeight = rect.height;
            const mode = getSectionMode(section, sectionIndex);

            let partCount = 1;

            if (mode === "SPLIT") {
                partCount = Math.max(
                    1,
                    Math.round(sectionHeight / viewportHeight)
                );
            }

            /*
             * FREE sections only get a snap point at their top.
             * Users then scroll naturally inside them.
             */
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
                    sectionTop + sectionHeight - viewportHeight
                );

                for (
                    let partIndex = 0;
                    partIndex < partCount;
                    partIndex++
                ) {
                    const requestedTop =
                        sectionTop + viewportHeight * partIndex;

                    points.push({
                        top: Math.round(
                            Math.min(requestedTop, maximumTop)
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
                if (index === 0) return true;

                return Math.abs(
                    point.top - list[index - 1].top
                ) > 10;
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

    function getSectionAtViewportCenter() {
        const viewportCenter = window.innerHeight / 2;

        for (let index = 0; index < sections.length; index++) {
            const section = sections[index];
            const rect = section.getBoundingClientRect();

            if (
                rect.top <= viewportCenter &&
                rect.bottom >= viewportCenter
            ) {
                return {
                    section,
                    index,
                    rect,
                    mode: getSectionMode(section, index)
                };
            }
        }

        return null;
    }

    function canScrollNaturallyInsideFreeSection(direction) {
        const current = getSectionAtViewportCenter();

        if (!current || current.mode !== "FREE") {
            return false;
        }

        const rect = current.rect;
        const tolerance = CONFIG.edgeTolerance;

        /*
         * While moving down, keep native scrolling enabled until
         * the bottom of the free section reaches the viewport bottom.
         */
        if (
            direction > 0 &&
            rect.bottom > window.innerHeight + tolerance
        ) {
            return true;
        }

        /*
         * While moving up, keep native scrolling enabled until
         * the top of the free section reaches the viewport top.
         */
        if (
            direction < 0 &&
            rect.top < -tolerance
        ) {
            return true;
        }

        return false;
    }

    function getNextSnapIndex(direction) {
        const currentY = window.scrollY;
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
            if (snapPoints[index].top < currentY - tolerance) {
                return index;
            }
        }

        return -1;
    }

    function scrollToSnapPoint(index) {
        if (locked) return;
        if (index < 0 || index >= snapPoints.length) return;

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

        window.scrollTo({
            top: target.top,
            left: 0,
            behavior: "smooth"
        });

        window.setTimeout(() => {
            locked = false;
        }, CONFIG.cooldown);
    }

    function move(direction) {
        buildSnapPoints();

        const targetIndex = getNextSnapIndex(direction);

        if (targetIndex === -1) {
            wheelDelta = 0;
            return;
        }

        scrollToSnapPoint(targetIndex);
    }

    function handleWheel(event) {
        if (snapPoints.length === 0) return;

        const direction = event.deltaY > 0 ? 1 : -1;

        /*
         * Do not block normal scrolling while the user is inside
         * the middle of a FREE section.
         */
        if (canScrollNaturallyInsideFreeSection(direction)) {
            wheelDelta = 0;
            return;
        }

        if (locked) {
            event.preventDefault();
            return;
        }

        wheelDelta += event.deltaY;

        window.clearTimeout(wheelResetTimer);

        wheelResetTimer = window.setTimeout(() => {
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

    function handleKeydown(event) {
        if (locked) return;

        const activeElement = document.activeElement;
        const tagName =
            activeElement?.tagName?.toLowerCase();

        if (
            activeElement?.isContentEditable ||
            tagName === "input" ||
            tagName === "textarea" ||
            tagName === "select"
        ) {
            return;
        }

        const current = getSectionAtViewportCenter();

        /*
         * Let PageUp, PageDown and arrows scroll normally while
         * the user is inside the middle of the FAQ.
         */
        if (current?.mode === "FREE") {
            return;
        }

        if (
            event.key === "ArrowDown" ||
            event.key === "PageDown" ||
            event.key === " "
        ) {
            event.preventDefault();
            move(1);
            return;
        }

        if (
            event.key === "ArrowUp" ||
            event.key === "PageUp"
        ) {
            event.preventDefault();
            move(-1);
        }
    }

    function initialize() {
        const sectionCount = buildSnapPoints();

        if (sectionCount < 2) {
            retryCount++;

            if (retryCount <= MAX_RETRIES) {
                window.setTimeout(
                    initialize,
                    RETRY_DELAY
                );
            } else {
                log(
                    "No usable Wix sections found in this frame."
                );
            }

            return;
        }

        window[INSTANCE_KEY] = true;

        window.addEventListener(
            "wheel",
            handleWheel,
            { passive: false }
        );

        window.addEventListener(
            "keydown",
            handleKeydown
        );

        window.addEventListener("resize", () => {
            window.setTimeout(buildSnapPoints, 150);
        });

        /*
         * Recalculate after FAQ accordion animations.
         */
        document.addEventListener("click", (event) => {
            if (
                event.target.closest(
                    ".wixui-accordion, .wixui-accordion__item"
                )
            ) {
                window.setTimeout(buildSnapPoints, 500);
            }
        });

        log("Snap scrolling initialized");
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            { once: true }
        );
    } else {
        initialize();
    }
})();
