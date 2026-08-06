console.log("[Wix Snap Scroll v5] file executing");

(() => {
    "use strict";

    const CONFIG = {
        sectionSelector: '[data-testid="section-container"]',
        wheelThreshold: 30,
        cooldown: 950,
        debug: true
    };

    // Stop the same script initializing twice in one window.
    if (window.__WIX_SNAP_SCROLL_INITIALIZED__) {
        console.log("[Wix Snap Scroll v5] duplicate instance ignored");
        return;
    }

    let snapPoints = [];
    let locked = false;
    let accumulatedDelta = 0;
    let resetTimer = null;
    let retryCount = 0;

    const MAX_RETRIES = 20;
    const RETRY_DELAY = 500;

    function log(...args) {
        if (CONFIG.debug) {
            console.log("[Wix Snap Scroll v5]", ...args);
        }
    }

    function getSections() {
        return Array.from(
            document.querySelectorAll(CONFIG.sectionSelector)
        ).filter((section) => {
            const rect = section.getBoundingClientRect();

            return rect.height > 0;
        });
    }

    function getAbsoluteTop(element) {
        return element.getBoundingClientRect().top + window.scrollY;
    }

    function buildSnapPoints() {
        const sections = getSections();
        const viewportHeight = window.innerHeight;
        const points = [];

        sections.forEach((section, sectionIndex) => {
            const rect = section.getBoundingClientRect();
            const sectionTop = getAbsoluteTop(section);
            const sectionHeight = rect.height;

            /*
             * Examples:
             * 100vh section -> 1 snap point
             * 200vh section -> 2 snap points
             * 300vh section -> 3 snap points
             */
            const partCount = Math.max(
                1,
                Math.round(sectionHeight / viewportHeight)
            );

            log(
                `Section ${sectionIndex + 1}:`,
                `height=${Math.round(sectionHeight)}px,`,
                `viewport=${viewportHeight}px,`,
                `parts=${partCount}`
            );

            for (let partIndex = 0; partIndex < partCount; partIndex++) {
                const maximumTop = Math.max(
                    sectionTop,
                    sectionTop + sectionHeight - viewportHeight
                );

                const requestedTop =
                    sectionTop + viewportHeight * partIndex;

                const pointTop = Math.min(
                    requestedTop,
                    maximumTop
                );

                points.push({
                    top: Math.round(pointTop),
                    sectionIndex,
                    partIndex
                });
            }
        });

        // Sort and remove nearly identical positions.
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

        log(
            snapPoints.map((point, index) => ({
                snapPoint: index + 1,
                y: point.top,
                wixSection: point.sectionIndex + 1,
                part: point.partIndex + 1
            }))
        );

        return sections.length;
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

    function scrollToPoint(index) {
        if (locked || snapPoints.length === 0) return;

        const targetIndex = Math.max(
            0,
            Math.min(index, snapPoints.length - 1)
        );

        const target = snapPoints[targetIndex];

        if (!target) return;

        locked = true;
        accumulatedDelta = 0;

        log(
            `Scrolling to snap ${targetIndex + 1}:`,
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

        const currentIndex = getClosestSnapIndex();
        const targetIndex = currentIndex + direction;

        if (
            targetIndex < 0 ||
            targetIndex >= snapPoints.length
        ) {
            accumulatedDelta = 0;
            return;
        }

        scrollToPoint(targetIndex);
    }

    function handleWheel(event) {
        if (snapPoints.length === 0) return;

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
                    "No Wix sections found in this frame; " +
                    "stopping this instance."
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
