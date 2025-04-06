// services/converter/data/csvConverter.js

import { parse } from 'csv-parse/sync';
import path from 'path';

/**
 * CSV Converter
 * Converts CSV files to Markdown format with consistent return structure
 * 
 * This converter follows the same pattern as the PDF converter to ensure
 * consistent behavior across all file types.
 * 
 * Related files:
 * - xlsxConverter.js: Similar converter for Excel files
 * - PdfConverterFactory.js: Reference implementation for converter pattern
 */

/**
 * Configuration for the converter
 */
const config = {
  name: 'CSV Converter',
  version: '1.0.0',
  supportedExtensions: ['.csv'],
  supportedMimeTypes: ['text/csv', 'application/csv'],
  maxSizeBytes: 50 * 1024 * 1024, // 50MB
};

/**
 * Validates CSV input
 * @param {Buffer|string} input - The CSV content
 * @returns {boolean} - Whether the input is valid
 */
export function validateCsvInput(input) {
  return (Buffer.isBuffer(input) || typeof input === 'string') && input.length > 0;
}

/**
 * Creates metadata object for CSV files
 * @param {string} baseName - Base filename
 * @param {number} rows - Number of rows
 * @param {number} columns - Number of columns
 * @returns {Object} - Metadata object
 */
function createMetadata(baseName, rows, columns) {
  return {
    title: baseName,
    rows,
    columns,
    format: 'csv',
    type: 'spreadsheet',
    created: new Date().toISOString()
  };
}

/**
 * Converts a CSV buffer or string to Markdown format.
 * @param {Buffer|string} input - The CSV content as a buffer or string.
 * @param {string} originalName - Original filename for context.
 * @param {string} [apiKey] - API key if needed.
 * @returns {Promise<{ content: string, images: Array, success: boolean, metadata: Object, type: string, name: string, category: string }>} - Converted content and metadata.
 */
export async function convertCsvToMarkdown(input, originalName, apiKey) {
  console.log(`🔄 [csvConverter] Converting CSV file: ${originalName}`);
  console.log(`🔄 [csvConverter] Input type: ${typeof input}, is buffer: ${Buffer.isBuffer(input)}, length: ${input.length || 'N/A'}`);
  
  try {
    // Validate input
    if (!validateCsvInput(input)) {
      throw new Error('Invalid CSV input: empty or invalid format');
    }
    
    // Convert buffer to string if necessary
    const csvContent = Buffer.isBuffer(input) ? input.toString('utf-8') : input;

    // Parse the CSV data
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true
    });

    console.log(`✅ [csvConverter] Successfully parsed CSV with ${records.length} records`);

    const baseName = path.basename(originalName, '.csv');
    
    if (records.length === 0) {
      console.log(`⚠️ [csvConverter] CSV file is empty`);
      const metadata = createMetadata(baseName, 0, 0);
      
      return { 
        success: true,
        content: "# Empty CSV File\nNo data found in the file.", 
        images: [],
        metadata,
        type: 'csv',
        name: originalName,
        category: 'data',
        originalContent: input,
        stats: {
          inputSize: input.length,
          outputSize: "# Empty CSV File\nNo data found in the file.".length,
          rowCount: 0,
          columnCount: 0
        }
      };
    }

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
    let markdownContent = `# ${baseName}\n\n`;
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

    // Create metadata
    const metadata = createMetadata(baseName, records.length, headers.length);
    
    // Create frontmatter
    const frontmatter = [
      '---',
      `source: ${originalName}`,
      `type: ${metadata.type}`,
      `format: ${metadata.format}`,
      `rows: ${metadata.rows}`,
      `columns: ${metadata.columns}`,
      `created: ${metadata.created}`,
      '---',
      ''
    ].join('\n');

    // Combine frontmatter and content
    const fullContent = frontmatter + markdownContent;
    
    // Create the final result object with all required properties
    const result = { 
      success: true,
      content: fullContent,
      images: [],
      metadata,
      type: 'csv',
      name: originalName,
      category: 'data',
      originalContent: input,
      stats: {
        inputSize: input.length,
        outputSize: fullContent.length,
        rowCount: records.length,
        columnCount: headers.length
      }
    };
    
    console.log(`✅ [csvConverter] Successfully converted CSV file: ${originalName}`);
    return result;
  } catch (error) {
    console.error('❌ Error converting CSV to Markdown:', error);
    // Return a structured error result instead of throwing
    return {
      success: false,
      error: error.message,
      content: `# Conversion Error\n\nFailed to convert CSV file: ${error.message}`,
      images: [],
      metadata: {
        format: 'csv',
        type: 'spreadsheet',
        error: true
      },
      type: 'csv',
      name: originalName,
      category: 'data'
    };
  }
}

// Export a default object to match the pattern used by other converters
export default {
  convertToMarkdown: convertCsvToMarkdown,
  validateCsvInput,
  config
};
