console.log("[Wix Snap Scroll v6] file executing");

(() => {
    "use strict";

    const CONFIG = {
        sectionSelector: '[data-testid="section-container"]',

        /*
         * Use the section number shown in the console.
         *
         * Example:
         * If the FAQ is logged as "Section 8",
         * keep this as [8].
         */
        freeScrollSectionNumbers: [8],

        wheelThreshold: 30,
        cooldown: 950,
        edgeTolerance: 12,
        debug: true
    };

    if (window.__WIX_SNAP_SCROLL_INITIALIZED__) {
        console.log("[Wix Snap Scroll v6] duplicate instance ignored");
        return;
    }

    let sections = [];
    let snapPoints = [];
    let locked = false;
    let accumulatedDelta = 0;
    let resetTimer = null;
    let retryCount = 0;

    const MAX_RETRIES = 20;
    const RETRY_DELAY = 500;

    function log(...args) {
        if (CONFIG.debug) {
            console.log("[Wix Snap Scroll v6]", ...args);
        }
    }

    function getSections() {
        return Array.from(
            document.querySelectorAll(CONFIG.sectionSelector)
        ).filter((section) => {
            return section.getBoundingClientRect().height > 0;
        });
    }

    function getAbsoluteTop(element) {
        return element.getBoundingClientRect().top + window.scrollY;
    }

    function isFreeScrollSection(sectionIndex) {
        // Convert the zero-based JavaScript index to a human-readable number.
        return CONFIG.freeScrollSectionNumbers.includes(sectionIndex + 1);
    }

    function buildSnapPoints() {
        sections = getSections();

        const viewportHeight = window.innerHeight;
        const points = [];

        sections.forEach((section, sectionIndex) => {
            const rect = section.getBoundingClientRect();
            const sectionTop = getAbsoluteTop(section);
            const sectionHeight = rect.height;
            const freeScroll = isFreeScrollSection(sectionIndex);

            /*
             * Free-scroll sections only receive a snap point at their top.
             * Other tall sections are divided into viewport-sized parts.
             */
            const partCount = freeScroll
                ? 1
                : Math.max(
                    1,
                    Math.round(sectionHeight / viewportHeight)
                );

            log(
                `Section ${sectionIndex + 1}:`,
                `height=${Math.round(sectionHeight)}px,`,
                `parts=${partCount},`,
                freeScroll ? "FREE SCROLL" : "SNAP"
            );

            for (
                let partIndex = 0;
                partIndex < partCount;
                partIndex++
            ) {
                const maximumTop = Math.max(
                    sectionTop,
                    sectionTop + sectionHeight - viewportHeight
                );

                const requestedTop =
                    sectionTop + viewportHeight * partIndex;

                const pointTop = freeScroll
                    ? sectionTop
                    : Math.min(requestedTop, maximumTop);

                points.push({
                    top: Math.round(pointTop),
                    sectionIndex,
                    partIndex
                });
            }
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
            `Built ${snapPoints.length} snap points from ` +
            `${sections.length} Wix sections`
        );

        return sections.length;
    }

    function getSectionAtViewportCenter() {
        const viewportCenter = window.innerHeight / 2;

        for (let index = 0; index < sections.length; index++) {
            const rect = sections[index].getBoundingClientRect();

            if (
                rect.top <= viewportCenter &&
                rect.bottom >= viewportCenter
            ) {
                return {
                    element: sections[index],
                    index,
                    rect
                };
            }
        }

        return null;
    }

    function shouldAllowNativeScroll(direction) {
        const current = getSectionAtViewportCenter();

        if (!current) return false;
        if (!isFreeScrollSection(current.index)) return false;

        const rect = current.rect;
        const tolerance = CONFIG.edgeTolerance;

        /*
         * Scrolling down is allowed until the bottom of the FAQ
         * reaches the bottom of the viewport.
         */
        if (
            direction > 0 &&
            rect.bottom > window.innerHeight + tolerance
        ) {
            return true;
        }

        /*
         * Scrolling up is allowed until the top of the FAQ
         * reaches the top of the viewport.
         */
        if (
            direction < 0 &&
            rect.top < -tolerance
        ) {
            return true;
        }

        return false;
    }

    function getClosestSnapIndex() {
        let closestIndex = 0;
        let closestDistance = Infinity;

        snapPoints.forEach((point, index) => {
            const distance = Math.abs(
                window.scrollY - point.top
            );

            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = index;
            }
        });

        return closestIndex;
    }

    function getTargetIndex(direction) {
        const currentY = window.scrollY;
        const tolerance = 20;

        if (direction > 0) {
            /*
             * Find the first snap point below the current position.
             */
            return snapPoints.findIndex(
                (point) => point.top > currentY + tolerance
            );
        }

        /*
         * Find the last snap point above the current position.
         */
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

    function scrollToPoint(index) {
        if (locked || snapPoints.length === 0) return;
        if (index < 0 || index >= snapPoints.length) return;

        const target = snapPoints[index];

        locked = true;
        accumulatedDelta = 0;

        log(
            `Scrolling to snap ${index + 1}:`,
            `section=${target.sectionIndex + 1},`,
            `part=${target.partIndex + 1},`,
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

        let targetIndex = getTargetIndex(direction);

        /*
         * Fallback for when the page is already almost exactly
         * aligned to a snap point.
         */
        if (targetIndex === -1) {
            const currentIndex = getClosestSnapIndex();
            targetIndex = currentIndex + direction;
        }

        scrollToPoint(targetIndex);
    }

    function handleWheel(event) {
        if (snapPoints.length === 0) return;

        const direction = event.deltaY > 0 ? 1 : -1;

        /*
         * Inside the FAQ, leave normal browser scrolling untouched.
         */
        if (shouldAllowNativeScroll(direction)) {
            accumulatedDelta = 0;
            return;
        }

        if (locked) {
            event.preventDefault();
            return;
        }

        accumulatedDelta += event.deltaY;

        window.clearTimeout(resetTimer);

        resetTimer = window.setTimeout(() => {
            accumulatedDelta = 0;
        }, 180);

        if (
            Math.abs(accumulatedDelta) <
            CONFIG.wheelThreshold
        ) {
            return;
        }

        event.preventDefault();

        move(accumulatedDelta > 0 ? 1 : -1);
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
                    "No Wix sections found in this frame; stopping."
                );
            }

            return;
        }

        window.__WIX_SNAP_SCROLL_INITIALIZED__ = true;

        window.addEventListener("wheel", handleWheel, {
            passive: false
        });

        window.addEventListener("resize", () => {
            window.setTimeout(buildSnapPoints, 150);
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
