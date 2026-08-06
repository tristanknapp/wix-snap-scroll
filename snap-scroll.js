console.log("[Wix Snap Scroll] snap-scroll.js executing");

(() => {
    "use strict";

    const CONFIG = {
        sectionSelector: '[data-testid="section-container"]',

        // Split the first 200vh Wix section into two snap positions.
        splitFirstSection: true,
        firstSectionParts: 2,

        wheelThreshold: 30,
        cooldown: 950,
        enableKeyboard: true,
        debug: true
    };

    let snapPoints = [];
    let locked = false;
    let accumulatedDelta = 0;
    let resetDeltaTimer = null;
    let initialized = false;

    function log(...args) {
        if (CONFIG.debug) {
            console.log("[Wix Snap Scroll]", ...args);
        }
    }

    function getPageY(element) {
        return element.getBoundingClientRect().top + window.scrollY;
    }

    function refreshSnapPoints() {
        const sections = Array.from(
            document.querySelectorAll(CONFIG.sectionSelector)
        ).filter((section) => {
            return section.getBoundingClientRect().height > 0;
        });

        if (sections.length === 0) {
            snapPoints = [];
            return;
        }

        const newSnapPoints = [];

        sections.forEach((section, sectionIndex) => {
            const sectionTop = getPageY(section);

            if (
                sectionIndex === 0 &&
                CONFIG.splitFirstSection &&
                CONFIG.firstSectionParts > 1
            ) {
                /*
                 * For a 200vh first section:
                 * point 1 = section top
                 * point 2 = section top + one viewport height
                 */
                for (
                    let partIndex = 0;
                    partIndex < CONFIG.firstSectionParts;
                    partIndex++
                ) {
                    newSnapPoints.push({
                        top: sectionTop + window.innerHeight * partIndex,
                        section,
                        sectionIndex,
                        partIndex
                    });
                }
            } else {
                newSnapPoints.push({
                    top: sectionTop,
                    section,
                    sectionIndex,
                    partIndex: 0
                });
            }
        });

        snapPoints = newSnapPoints.sort((a, b) => a.top - b.top);

        log(
            `Found ${sections.length} Wix sections and ` +
            `${snapPoints.length} snap points`
        );
    }

    function getCurrentSnapIndex() {
        let closestIndex = 0;
        let closestDistance = Infinity;

        snapPoints.forEach((point, index) => {
            const distance = Math.abs(window.scrollY - point.top);

            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = index;
            }
        });

        return closestIndex;
    }

    function scrollToSnapPoint(index) {
        if (locked || snapPoints.length === 0) {
            return;
        }

        const targetIndex = Math.max(
            0,
            Math.min(index, snapPoints.length - 1)
        );

        const target = snapPoints[targetIndex];

        if (!target) {
            return;
        }

        locked = true;
        accumulatedDelta = 0;

        log(
            `Scrolling to snap point ${targetIndex + 1} ` +
            `at Y=${Math.round(target.top)}`
        );

        window.scrollTo({
            top: target.top,
            behavior: "smooth"
        });

        window.setTimeout(() => {
            locked = false;
        }, CONFIG.cooldown);
    }

    function move(direction) {
        refreshSnapPoints();

        const currentIndex = getCurrentSnapIndex();
        const targetIndex = currentIndex + direction;

        if (targetIndex < 0 || targetIndex >= snapPoints.length) {
            accumulatedDelta = 0;
            return;
        }

        scrollToSnapPoint(targetIndex);
    }

    function handleWheel(event) {
        if (snapPoints.length === 0) {
            return;
        }

        if (locked) {
            event.preventDefault();
            return;
        }

        accumulatedDelta += event.deltaY;

        window.clearTimeout(resetDeltaTimer);

        resetDeltaTimer = window.setTimeout(() => {
            accumulatedDelta = 0;
        }, 160);

        if (Math.abs(accumulatedDelta) < CONFIG.wheelThreshold) {
            return;
        }

        event.preventDefault();

        move(accumulatedDelta > 0 ? 1 : -1);
    }

    function handleKeydown(event) {
        if (!CONFIG.enableKeyboard || locked) {
            return;
        }

        const activeElement = document.activeElement;
        const activeTag = activeElement?.tagName?.toLowerCase();

        if (
            activeElement?.isContentEditable ||
            activeTag === "input" ||
            activeTag === "textarea" ||
            activeTag === "select"
        ) {
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
            return;
        }

        if (event.key === "Home") {
            event.preventDefault();
            refreshSnapPoints();
            scrollToSnapPoint(0);
            return;
        }

        if (event.key === "End") {
            event.preventDefault();
            refreshSnapPoints();
            scrollToSnapPoint(snapPoints.length - 1);
        }
    }

    function initialize() {
        refreshSnapPoints();

        if (snapPoints.length < 2) {
            log("Not enough snap points found. Retrying...");
            window.setTimeout(initialize, 500);
            return;
        }

        if (initialized) {
            return;
        }

        initialized = true;

        window.addEventListener("wheel", handleWheel, {
            passive: false
        });

        window.addEventListener("keydown", handleKeydown);

        window.addEventListener("resize", () => {
            refreshSnapPoints();
        });

        window.addEventListener("load", () => {
            refreshSnapPoints();
        });

        log("Snap scrolling initialized");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }
})();
