/**
 * Common markdown text formatting utilities (ES Module version)
 */

/**
 * Makes text bold
 * @param {string} text - Text to make bold
 * @returns {string} - Bold text
 */
export function bold(text) {
    return `**${text}**`;
}

/**
 * Makes text italic
 * @param {string} text - Text to italicize
 * @returns {string} - Italic text
 */
export function italic(text) {
    return `_${text}_`;
}

/**
 * Creates an inline code block
 * @param {string} code - Code to format
 * @returns {string} - Formatted inline code
 */
export function inlineCode(code) {
    return `\`${code}\``;
}

/**
 * Creates a link
 * @param {string} text - Link text
 * @param {string} url - Link URL
 * @returns {string} - Markdown link
 */
export function link(text, url) {
    return `[${text}](${url})`;
}

/**
 * Creates an image
 * @param {string} altText - Alt text
 * @param {string} url - Image URL
 * @returns {string} - Markdown image
 */
export function image(altText, url) {
    return `![${altText}](${url})`;
}

/**
 * Creates an Obsidian-style internal link
 * @param {string} target - Link target (file or section)
 * @param {string} [alias] - Optional display text
 * @returns {string} - Obsidian internal link
 */
export function internalLink(target, alias) {
    return alias ? `[[${target}|${alias}]]` : `[[${target}]]`;
}

/**
 * Creates a horizontal rule
 * @returns {string} - Horizontal rule
 */
export function horizontalRule() {
    return '\n---\n';
}

/**
 * Creates a task list item
 * @param {string} text - Task text
 * @param {boolean} checked - Whether task is checked
 * @returns {string} - Task list item
 */
export function taskItem(text, checked = false) {
    return `- [${checked ? 'x' : ' '}] ${text}`;
}

/**
 * Indents text by a number of spaces
 * @param {string} text - Text to indent
 * @param {number} [spaces=2] - Number of spaces
 * @returns {string} - Indented text
 */
export function indent(text, spaces = 2) {
    return text
        .split('\n')
        .map(line => ' '.repeat(spaces) + line)
        .join('\n');
}

/**
 * Creates a definition list item
 * @param {string} term - Term to define
 * @param {string} definition - Definition text
 * @returns {string} - Definition list item
 */
export function definitionListItem(term, definition) {
    return `${term}\n: ${definition}`;
}

/**
 * Creates a footnote reference
 * @param {string} ref - Reference identifier
 * @param {string} text - Footnote text
 * @returns {string} - Footnote with reference
 */
export function footnote(ref, text) {
    return {
        reference: `[^${ref}]`,
        definition: `[^${ref}]: ${text}`
    };
}

/**
 * Escapes special characters in markdown text
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
export function escapeText(text) {
    return text.replace(/([\\`*_{}[\]()#+-.!])/g, '\\$1');
}

/**
 * Creates a table row
 * @param {Array<string>} cells - Row cells
 * @returns {string} - Formatted table row
 */
export function tableRow(cells) {
    return `| ${cells.join(' | ')} |`;
}

/**
 * Creates a table header row with alignment
 * @param {Array<{text: string, align?: 'left'|'center'|'right'}>} headers 
 * @returns {string} - Formatted table header with alignment
 */
export function tableHeader(headers) {
    const headerRow = tableRow(headers.map(h => h.text));
    const alignRow = tableRow(headers.map(h => {
        switch (h.align) {
            case 'right': return '--:';
            case 'center': return ':-:';
            default: return ':--';
        }
    }));
    return `${headerRow}\n${alignRow}`;
}

/**
 * Creates a formatted table
 * @param {Array<{text: string, align?: 'left'|'center'|'right'}>} headers - Table headers
 * @param {Array<Array<string>>} rows - Table rows
 * @returns {string} - Complete formatted table
 */
export function table(headers, rows) {
    const headerSection = tableHeader(headers);
    const rowsSection = rows.map(row => tableRow(row)).join('\n');
    return `${headerSection}\n${rowsSection}`;
}

/**
 * Wraps text at a specified column width
 * @param {string} text - Text to wrap
 * @param {number} [width=80] - Column width
 * @returns {string} - Wrapped text
 */
export function wrapText(text, width = 80) {
    return text
        .split('\n')
        .map(line => {
            if (line.length <= width) return line;
            
            const words = line.split(' ');
            const lines = [];
            let currentLine = [];
            let currentLength = 0;
            
            words.forEach(word => {
                if (currentLength + word.length + 1 > width) {
                    lines.push(currentLine.join(' '));
                    currentLine = [word];
                    currentLength = word.length;
                } else {
                    currentLine.push(word);
                    currentLength += word.length + 1;
                }
            });
            
            if (currentLine.length > 0) {
                lines.push(currentLine.join(' '));
            }
            
            return lines.join('\n');
        })
        .join('\n');
}

// Default export for compatibility
export default {
    bold,
    italic,
    inlineCode,
    link,
    image,
    internalLink,
    horizontalRule,
    taskItem,
    indent,
    definitionListItem,
    footnote,
    escapeText,
    tableRow,
    tableHeader,
    table,
    wrapText
};
