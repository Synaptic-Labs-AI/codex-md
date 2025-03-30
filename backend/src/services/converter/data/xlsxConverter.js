// services/converter/data/xlsxConverter.js

import xlsx from 'xlsx';

/**
 * Converts an XLSX buffer or string to Markdown format.
 * @param {Buffer|string} input - The XLSX content as a buffer or string (file path not used).
 * @param {string} originalName - Original filename for context.
 * @param {string} [apiKey] - API key if needed.
 * @returns {Promise<{ content: string, images: Array }>} - Converted content and images.
 */
export async function convertXlsxToMarkdown(input, originalName, apiKey) {
  try {
    const workbook = xlsx.read(input, { type: 'buffer' });
    
    // Create frontmatter with workbook info
    const frontmatter = [
      '---',
      `source: ${originalName}`,
      `type: spreadsheet`,
      `format: xlsx`,
      `sheets: ${workbook.SheetNames.length}`,
      `created: ${new Date().toISOString()}`,
      '---',
      ''
    ].join('\n');

    // Table of contents for sheets
    let markdownContent = `# ${originalName}\n\n`;
    markdownContent += '## Sheet Index\n\n';
    workbook.SheetNames.forEach(sheetName => {
      markdownContent += `- [[#${sheetName}|${sheetName}]]\n`;
    });
    markdownContent += '\n---\n\n';

    // Convert each sheet
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      
      if (jsonData.length === 0) {
        markdownContent += `## ${sheetName}\n\nThis sheet is empty.\n\n`;
        return;
      }

      const headers = jsonData[0];
      
      // Calculate column widths for better formatting
      const columnWidths = headers.map((_, colIndex) => {
        return Math.max(
          String(headers[colIndex] || '').length,
          ...jsonData.slice(1).map(row => String(row[colIndex] || '').length)
        );
      });

      // Add sheet header with metadata
      markdownContent += `## ${sheetName}\n\n`;
      markdownContent += `Rows: ${jsonData.length - 1}\n`;
      markdownContent += `Columns: ${headers.length}\n\n`;

      // Create table header
      markdownContent += '| ' + headers.map((header, i) => 
        String(header).padEnd(columnWidths[i])
      ).join(' | ') + ' |\n';
      
      markdownContent += '| ' + columnWidths.map(width => 
        '-'.repeat(width)
      ).join(' | ') + ' |\n';

      // Add data rows
      jsonData.slice(1).forEach(row => {
        const formattedRow = headers.map((_, i) => 
          String(row[i] || '').padEnd(columnWidths[i])
        ).join(' | ');
        markdownContent += `| ${formattedRow} |\n`;
      });

      markdownContent += '\n---\n\n';
    });

    return { 
      content: frontmatter + markdownContent,
      images: [] 
    };
  } catch (error) {
    console.error('Error converting XLSX to Markdown:', error);
    throw error;
  }
}
