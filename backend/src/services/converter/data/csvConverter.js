// services/converter/data/csvConverter.js

import { parse } from 'csv-parse/sync';

/**
 * Converts a CSV buffer or string to Markdown format.
 * @param {Buffer|string} input - The CSV content as a buffer or string.
 * @param {string} originalName - Original filename for context.
 * @param {string} [apiKey] - API key if needed.
 * @returns {Promise<{ content: string, images: Array }>} - Converted content and images.
 */
export async function convertCsvToMarkdown(input, originalName, apiKey) {
  try {
    // Convert buffer to string if necessary
    const csvContent = Buffer.isBuffer(input) ? input.toString('utf-8') : input;

    // Parse the CSV data
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true
    });

    if (records.length === 0) {
      return { content: "# Empty CSV File\nNo data found in the file.", images: [] };
    }

    // Create frontmatter
    const frontmatter = [
      '---',
      `source: ${originalName}`,
      `type: spreadsheet`,
      `format: csv`,
      `rows: ${records.length}`,
      `columns: ${Object.keys(records[0]).length}`,
      `created: ${new Date().toISOString()}`,
      '---',
      ''
    ].join('\n');

    // Get headers and clean them
    const headers = Object.keys(records[0]).map(header => header.trim());

    // Calculate column widths for better formatting
    const columnWidths = headers.map(header => {
      const maxContentWidth = Math.max(
        header.length,
        ...records.map(row => String(row[header] || '').length)
      );
      return maxContentWidth;
    });

    // Create table header with proper spacing
    let markdownContent = `# ${originalName}\n\n`;
    markdownContent += `Total Rows: ${records.length}\n\n`;
    
    // Create the table
    markdownContent += '| ' + headers.map((header, i) => 
      header.padEnd(columnWidths[i])
    ).join(' | ') + ' |\n';
    
    markdownContent += '| ' + columnWidths.map(width => 
      '-'.repeat(width)
    ).join(' | ') + ' |\n';

    // Add data rows with proper spacing
    records.forEach(record => {
      const row = headers.map((header, i) => 
        String(record[header] || '').padEnd(columnWidths[i])
      ).join(' | ');
      markdownContent += `| ${row} |\n`;
    });

    return { 
      content: frontmatter + markdownContent,
      images: [] 
    };
  } catch (error) {
    console.error('Error converting CSV to Markdown:', error);
    throw error;
  }
}
