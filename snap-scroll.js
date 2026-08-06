console.log("[Wix Snap Scroll v11] file executing");

(() => {
    "use strict";

    const CONFIG = {
        sectionSelector: '[data-testid="section-container"]',

        /*
         * Your 200vh hero is the second detected Wix section.
         * JavaScript indexes begin at 0, so Section 2 = index 1.
         */
        splitSectionIndexes: [1],

        /*
         * FAQ section that allows normal scrolling.
         */
        freeSectionSelectors: [
            "#comp-mrxamx3r"
        ],

        wheelThreshold: 30,
        wheelResetDelay: 180,
        cooldown: 950,
        edgeTolerance: 20,
        debug: true
    };

    const INSTANCE_KEY = "__WIX_SNAP_SCROLL_V11__";

    if (window[INSTANCE_KEY]) {
        console.log("[Wix Snap Scroll v11] duplicate instance ignored");
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
            console.log("[Wix Snap Scroll v11]", ...args);
        }
    }

    function getPageTop(element) {
        return element.getBoundingClientRect().top + window.scrollY;
    }

    function getSections() {
        return Array.from(
            document.querySelectorAll(CONFIG.sectionSelector)
        ).filter((section) => {
            return section.getBoundingClientRect().height > 0;
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
        sections = getSections();

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

    function getActiveFreeSection() {
        const viewportTop = window.scrollY;
        const viewportBottom =
            viewportTop + window.innerHeight;

        for (
            let sectionIndex = 0;
            sectionIndex < sections.length;
            sectionIndex++
        ) {
            const section = sections[sectionIndex];

            if (
                getSectionMode(section, sectionIndex) !== "FREE"
            ) {
                continue;
            }

            const sectionTop = getPageTop(section);
            const sectionHeight =
                section.getBoundingClientRect().height;
            const sectionBottom = sectionTop + sectionHeight;

            /*
             * Consider the FAQ active whenever any meaningful
             * portion of the viewport is inside it.
             */
            const intersectsViewport =
                viewportBottom > sectionTop +
                    CONFIG.edgeTolerance &&
                viewportTop < sectionBottom -
                    CONFIG.edgeTolerance;

            if (intersectsViewport) {
                return {
                    section,
                    sectionIndex,
                    sectionTop,
                    sectionBottom,
                    sectionHeight
                };
            }
        }

        return null;
    }

    function allowNativeFreeScroll(direction) {
        const current = getActiveFreeSection();

        if (!current) {
            return false;
        }

        const viewportTop = window.scrollY;
        const viewportBottom =
            viewportTop + window.innerHeight;
        const tolerance = CONFIG.edgeTolerance;

        /*
         * Scrolling down inside FAQ:
         * allow native scrolling until its bottom reaches
         * the bottom of the viewport.
         */
        if (
            direction > 0 &&
            viewportBottom <
                current.sectionBottom - tolerance
        ) {
            return true;
        }

        /*
         * Scrolling up inside FAQ:
         * allow native scrolling until its top reaches
         * the top of the viewport.
         */
        if (
            direction < 0 &&
            viewportTop >
                current.sectionTop + tolerance
        ) {
            return true;
        }

        return false;
    }

    function findTargetSnapIndex(direction) {
        const currentY = window.scrollY;
        const tolerance = 24;

        if (direction > 0) {
            return snapPoints.findIndex(
                (point) =>
                    point.top > currentY + tolerance
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

        const targetIndex =
            findTargetSnapIndex(direction);

        if (targetIndex === -1) {
            wheelDelta = 0;
            return;
        }

        scrollToSnapPoint(targetIndex);
    }

    function handleWheel(event) {
        if (snapPoints.length === 0) return;

        const direction =
            event.deltaY > 0 ? 1 : -1;

        /*
         * Native scrolling gets first priority while the
         * viewport is inside the FAQ.
         */
        if (allowNativeFreeScroll(direction)) {
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

        window.addEventListener("resize", () => {
            window.setTimeout(
                buildSnapPoints,
                150
            );
        });

        /*
         * FAQ accordion changes its height when opened.
         */
        document.addEventListener("click", (event) => {
            if (
                event.target.closest(
                    ".wixui-accordion, " +
                    ".wixui-accordion__item"
                )
            ) {
                window.setTimeout(
                    buildSnapPoints,
                    600
                );
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
