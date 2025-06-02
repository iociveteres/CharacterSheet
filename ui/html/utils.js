export function getTemplateInnerHTML(templateId) {
    const template = document.getElementById(templateId);
    if (!template || !(template instanceof HTMLTemplateElement)) {
        throw new Error(`Element with id "${templateId}" is not a <template>.`);
    }

    return Array.from(template.content.childNodes)
        .map(node => node.outerHTML ?? node.textContent)
        .join('');
}

export function getTemplateElement(templateId) {
    const template = document.getElementById(templateId);
    if (!template || !(template instanceof HTMLTemplateElement)) {
        throw new Error(`Element with id "${templateId}" is not a <template>.`);
    }

    // Clone and return the first element child (assumes one root node in the template)
    return template.content.firstElementChild.cloneNode(true);
}
