/**
 * Creates an element with an optional class name and children.
 * String children become text nodes, so user-provided text is never parsed as HTML.
 * @param {string} tag
 * @param {string} [className]
 * @param {...(Node|string)} children
 * @returns {HTMLElement}
 */
export function h(tag, className, ...children) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.append(...children);
    return el;
}
