// services/converter/data/yamlConverter.js

import yaml from 'js-yaml';

/**
 * Converts a YAML buffer or string to Markdown format.
 * @param {Buffer|string} input - The YAML content as a buffer or string.
 * @param {string} originalName - Original filename for context.
 * @param {string} [apiKey] - API key if needed.
 * @returns {Promise<{ content: string, images: Array }>} - Converted content and images.
 */
export async function convertYamlToMarkdown(input, originalName, apiKey) {
  try {
    // Convert buffer to string if necessary
    const yamlContent = Buffer.isBuffer(input) ? input.toString('utf-8') : input;

    // Parse the YAML data
    const yamlData = yaml.load(yamlContent);

    // Reuse the JSON to Markdown conversion logic
    const markdownContent = jsonToMarkdown(yamlData);

    return { content: markdownContent, images: [] };
  } catch (error) {
    console.error('Error converting YAML to Markdown:', error);
    throw error;
  }
}

/**
 * Recursively converts JSON/YAML data to Markdown format.
 * @param {any} data - The data to convert.
 * @param {number} depth - The current depth for nested structures.
 * @returns {string} - The converted Markdown string.
 */
function jsonToMarkdown(data, depth = 0) {
  const indent = '  '.repeat(depth);

  if (Array.isArray(data)) {
    return data.map(item => `${indent}- ${jsonToMarkdown(item, depth + 1)}`).join('\n');
  } else if (typeof data === 'object' && data !== null) {
    return Object.entries(data)
      .map(([key, value]) => `${indent}- **${key}**: ${jsonToMarkdown(value, depth + 1)}`)
      .join('\n');
  } else {
    return String(data);
  }
}
