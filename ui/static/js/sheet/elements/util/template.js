/**
 * Clones a template and extracts its inner content (excluding the outer wrapper)
 * @param {string} templateId - ID of the template element
 * @returns {DocumentFragment} - Fragment containing the template's children
 */
function cloneTemplateContent(templateId) {
    const template = document.getElementById(templateId);
    if (!template) {
        console.error(`Template not found: ${templateId}`);
        return document.createDocumentFragment();
    }

    const clone = template.content.cloneNode(true);

    // Find the outer wrapper element (first child that's an Element)
    const wrapper = clone.querySelector('*');
    if (!wrapper) {
        console.error(`No wrapper element found in template: ${templateId}`);
        return clone;
    }

    // Create a fragment with just the inner content
    const fragment = document.createDocumentFragment();
    while (wrapper.firstChild) {
        fragment.appendChild(wrapper.firstChild);
    }

    return fragment;
}

/**
 * Replaces all occurrences of placeholder IDs in a DOM fragment
 * @param {DocumentFragment|Element} fragment - The DOM fragment to process
 * @param {string} itemId - The actual item ID to use
 * @param {string} [placeholderId] - Optional placeholder ID (for melee tab IDs, etc.)
 */
function replaceTemplateIds(fragment, itemId, placeholderId = null) {
    const elements = fragment.querySelectorAll ?
        fragment.querySelectorAll('*') :
        Array.from(fragment.children).flatMap(el => [el, ...el.querySelectorAll('*')]);

    elements.forEach(el => {
        // Replace TEMPLATE_ID with itemId
        if (el.hasAttribute('name')) {
            const name = el.getAttribute('name');
            el.setAttribute('name', name.replace('TEMPLATE_ID', itemId));
        }

        if (el.hasAttribute('for')) {
            const forAttr = el.getAttribute('for');
            el.setAttribute('for', forAttr.replace('TEMPLATE_ID', itemId));
        }

        if (el.hasAttribute('id')) {
            const id = el.getAttribute('id');
            el.setAttribute('id', id.replace('TEMPLATE_ID', itemId));
        }

        if (el.hasAttribute('data-id')) {
            const dataId = el.getAttribute('data-id');
            el.setAttribute('data-id', dataId.replace('TEMPLATE_ID', itemId));
        }

        // Replace PLACEHOLDER_ID with placeholderId (for melee tabs, etc.)
        if (placeholderId) {
            if (el.hasAttribute('name')) {
                const name = el.getAttribute('name');
                el.setAttribute('name', name.replace('PLACEHOLDER_ID', placeholderId));
            }

            if (el.hasAttribute('for')) {
                const forAttr = el.getAttribute('for');
                el.setAttribute('for', forAttr.replace('PLACEHOLDER_ID', placeholderId));
            }

            if (el.hasAttribute('id')) {
                const id = el.getAttribute('id');
                el.setAttribute('id', id.replace('PLACEHOLDER_ID', placeholderId));
            }

            if (el.hasAttribute('data-id')) {
                const dataId = el.getAttribute('data-id');
                el.setAttribute('data-id', dataId.replace('PLACEHOLDER_ID', placeholderId));
            }
        }
    });
}

/**
 * Creates an item from a template
 * Template already has default values pre-rendered, so we just clone and replace IDs
 * @param {Element} container - The container element (already created by elementsLayout.js)
 * @param {string} templateId - ID of the template to use
 * @param {string} [placeholderId] - Optional placeholder ID for nested elements (melee tabs)
 */
export function createItemFromTemplate(container, templateId, placeholderId = null) {
    const itemId = container.dataset.id;

    const content = cloneTemplateContent(templateId);
    replaceTemplateIds(content, itemId, placeholderId);
    container.appendChild(content);
}
