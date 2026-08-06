console.log("[Wix Snap Scroll] snap-scroll.js executing");

(() => {
    "use strict";

    const CONFIG = {
        sectionSelector: '[data-testid="section-container"]',

        // Minimum wheel/trackpad movement required.
        wheelThreshold: 30,

        // Time during which additional wheel events are ignored.
        cooldown: 950,

        enableKeyboard: true,
        debug: true
    };

    let snapPoints = [];
    let locked = false;
    let accumulatedDelta = 0;
    let deltaResetTimer = null;
    let initialized = false;

    function log(...args) {
        if (CONFIG.debug) {
            console.log("[Wix Snap Scroll]", ...args);
        }
    }

    function getAbsoluteTop(element) {
        return element.getBoundingClientRect().top + window.scrollY;
    }

    function refreshSnapPoints() {
        const viewportHeight = window.innerHeight;

        const sections = Array.from(
            document.querySelectorAll(CONFIG.sectionSelector)
        ).filter((section) => {
            const rect = section.getBoundingClientRect();

            return (
                rect.height > 0 &&
                section.offsetParent !== null
            );
        });

        const points = [];

        sections.forEach((section, sectionIndex) => {
            const rect = section.getBoundingClientRect();
            const sectionTop = getAbsoluteTop(section);
            const sectionHeight = rect.height;

            /*
             * A normal 100vh section gets one point.
             * A 200vh section gets two points.
             * A 300vh section gets three points, etc.
             */
            const numberOfScreens = Math.max(
                1,
                Math.round(sectionHeight / viewportHeight)
            );

            for (let screenIndex = 0; screenIndex < numberOfScreens; screenIndex++) {
                let pointTop = sectionTop + viewportHeight * screenIndex;

                /*
                 * Never create a point beyond the section's final
                 * full viewport position.
                 */
                const maximumTop = Math.max(
                    sectionTop,
                    sectionTop + sectionHeight - viewportHeight
                );

                pointTop = Math.min(pointTop, maximumTop);

                points.push({
                    top: Math.round(pointTop),
                    sectionIndex,
                    screenIndex,
                    section
                });
            }
        });

        /*
         * Sort points and remove duplicates caused by rounding or
         * sections slightly shorter than an exact viewport multiple.
         */
        snapPoints = points
            .sort((a, b) => a.top - b.top)
            .filter((point, index, array) => {
                if (index === 0) return true;

                return Math.abs(point.top - array[index - 1].top) > 10;
            });

        log(`Found ${sections.length} Wix sections`);
        log(
            "Snap points:",
            snapPoints.map((point, index) => ({
                number: index + 1,
                y: point.top,
                wixSection: point.sectionIndex + 1,
                part: point.screenIndex + 1
            }))
        );
    }

    function getCurrentSnapIndex(direction = 0) {
        const currentY = window.scrollY;

        let closestIndex = 0;
        let closestDistance = Infinity;

        snapPoints.forEach((point, index) => {
            const distance = Math.abs(currentY - point.top);

            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = index;
            }
        });

        /*
         * When the page is between two points, prefer the point
         * matching the requested direction.
         */
        if (direction > 0) {
            for (let i = 0; i < snapPoints.length; i++) {
                if (snapPoints[i].top > currentY + 20) {
                    return i - 1;
                }
            }
        }

        if (direction < 0) {
            for (let i = snapPoints.length - 1; i >= 0; i--) {
                if (snapPoints[i].top < currentY - 20) {
                    return i + 1;
                }
            }
        }

        return closestIndex;
    }

    function scrollToSnapPoint(index) {
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
            `Scrolling to point ${targetIndex + 1}`,
            `Y=${target.top}`,
            `Wix section=${target.sectionIndex + 1}`,
            `part=${target.screenIndex + 1}`
        );

        window.scrollTo({
            top: target.top,
            left: 0,
            behavior: "smooth"
        });

        window.setTimeout(() => {
            locked = false;
            log("Scroll unlocked");
        }, CONFIG.cooldown);
    }

    function move(direction) {
        refreshSnapPoints();

        const currentIndex = getCurrentSnapIndex(direction);
        const targetIndex = currentIndex + direction;

        if (
            targetIndex < 0 ||
            targetIndex >= snapPoints.length
        ) {
            accumulatedDelta = 0;
            return;
        }

        scrollToSnapPoint(targetIndex);
    }

    function handleWheel(event) {
        if (snapPoints.length === 0) return;

        if (locked) {
            event.preventDefault();
            return;
        }

        accumulatedDelta += event.deltaY;

        window.clearTimeout(deltaResetTimer);

        deltaResetTimer = window.setTimeout(() => {
            accumulatedDelta = 0;
        }, 180);

        if (
            Math.abs(accumulatedDelta) <
            CONFIG.wheelThreshold
        ) {
            return;
        }

        event.preventDefault();

        const direction = accumulatedDelta > 0 ? 1 : -1;

        move(direction);
    }

    function handleKeydown(event) {
        if (!CONFIG.enableKeyboard || locked) return;

        const activeElement = document.activeElement;
        const tag = activeElement?.tagName?.toLowerCase();

        if (
            activeElement?.isContentEditable ||
            tag === "input" ||
            tag === "textarea" ||
            tag === "select"
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
            log("Not enough snap points. Retrying...");
            window.setTimeout(initialize, 500);
            return;
        }

        if (initialized) return;

        initialized = true;

        window.addEventListener("wheel", handleWheel, {
            passive: false
        });

        window.addEventListener("keydown", handleKeydown);

        window.addEventListener("resize", () => {
            window.setTimeout(refreshSnapPoints, 150);
        });

        window.addEventListener("load", () => {
            window.setTimeout(refreshSnapPoints, 300);
        });

        log("Snap scrolling initialized");
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialize
        );
    } else {
        initialize();
    }
})();
