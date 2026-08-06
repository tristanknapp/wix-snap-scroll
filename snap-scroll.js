console.log("[Wix Snap Scroll] snap-scroll.js executing");

(() => {
    "use strict";

    const CONFIG = {
        sectionSelector: '[data-testid="section-container"]',
        wheelThreshold: 25,
        animationDuration: 850,
        cooldown: 950,
        enableKeyboard: true,
        debug: true
    };

    let sections = [];
    let locked = false;
    let accumulatedDelta = 0;
    let resetDeltaTimer = null;

    function log(...args) {
        if (CONFIG.debug) {
            console.log("[Wix Snap Scroll]", ...args);
        }
    }

    function refreshSections() {
        sections = Array.from(
            document.querySelectorAll(CONFIG.sectionSelector)
        ).filter((section) => {
            const rect = section.getBoundingClientRect();
            return rect.height > 0;
        });

        log(`Found ${sections.length} sections`);
    }

    function getCurrentSectionIndex() {
        const viewportCenter = window.innerHeight / 2;

        let closestIndex = 0;
        let closestDistance = Infinity;

        sections.forEach((section, index) => {
            const rect = section.getBoundingClientRect();
            const sectionCenter = rect.top + rect.height / 2;
            const distance = Math.abs(sectionCenter - viewportCenter);

            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = index;
            }
        });

        return closestIndex;
    }

    function scrollToSection(index) {
        if (locked || sections.length === 0) {
            return;
        }

        const targetIndex = Math.max(
            0,
            Math.min(index, sections.length - 1)
        );

        const target = sections[targetIndex];

        if (!target) {
            return;
        }

        locked = true;
        accumulatedDelta = 0;

        log(`Scrolling to section ${targetIndex + 1}`);

        target.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

        window.setTimeout(() => {
            locked = false;
        }, CONFIG.cooldown);
    }

    function move(direction) {
        refreshSections();

        const currentIndex = getCurrentSectionIndex();
        const targetIndex = currentIndex + direction;

        if (targetIndex < 0 || targetIndex >= sections.length) {
            accumulatedDelta = 0;
            return;
        }

        scrollToSection(targetIndex);
    }

    function handleWheel(event) {
        if (locked || sections.length === 0) {
            event.preventDefault();
            return;
        }

        accumulatedDelta += event.deltaY;

        clearTimeout(resetDeltaTimer);

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

        const activeTag = document.activeElement?.tagName?.toLowerCase();

        if (
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
        }

        if (
            event.key === "ArrowUp" ||
            event.key === "PageUp"
        ) {
            event.preventDefault();
            move(-1);
        }

        if (event.key === "Home") {
            event.preventDefault();
            scrollToSection(0);
        }

        if (event.key === "End") {
            event.preventDefault();
            scrollToSection(sections.length - 1);
        }
    }

    function initialize() {
        refreshSections();

        if (sections.length < 2) {
            log("Not enough sections found. Retrying...");
            window.setTimeout(initialize, 500);
            return;
        }

        window.addEventListener("wheel", handleWheel, {
            passive: false
        });

        window.addEventListener("keydown", handleKeydown);

        window.addEventListener("resize", refreshSections);

        const observer = new MutationObserver(() => {
            refreshSections();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        log("Snap scrolling initialized");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }
})();
