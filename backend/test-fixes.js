/**
 * Test script for URL processing and table processing fixes
 */

// Import the modules we need to test
const UrlProcessor = require('./src/services/converter/web/utils/UrlProcessor.js').default;
const { htmlToMarkdown } = require('./src/services/converter/web/utils/htmlToMarkdown.js');
const { JSDOM } = require('jsdom');

// Test URL processing with fragment identifiers
function testUrlProcessing() {
  console.log('=== Testing URL Processing ===');
  
  // Test cases for fragment identifiers
  const testCases = [
    { url: '#section-name', text: 'Section Link', baseUrl: 'https://example.com' },
    { url: '#waitforselector', text: 'Wait For Selector', baseUrl: 'https://pptr.dev' },
    { url: '#querying-without-waiting', text: '', baseUrl: 'https://pptr.dev' },
    { url: 'https://example.com#fragment', text: 'External with fragment', baseUrl: 'https://other.com' },
    { url: '/relative/path', text: 'Relative Path', baseUrl: 'https://example.com' },
    { url: 'https://example.com', text: 'External Link', baseUrl: 'https://other.com' }
  ];
  
  // Process each test case
  testCases.forEach(({ url, text, baseUrl }) => {
    try {
      const result = UrlProcessor.formatLink(text, url, {}, baseUrl);
      console.log(`URL: ${url}`);
      console.log(`Text: ${text || '(empty)'}`);
      console.log(`Base URL: ${baseUrl}`);
      console.log(`Result: ${result}`);
      console.log('---');
    } catch (error) {
      console.error(`Error processing URL: ${url}`, error);
    }
  });
}

// Test table processing
function testTableProcessing() {
  console.log('\n=== Testing Table Processing ===');
  
  // Create a simple HTML table
  const tableHtml = `
    <table>
      <tr>
        <th>Header 1</th>
        <th>Header 2</th>
      </tr>
      <tr>
        <td>Cell 1</td>
        <td>Cell 2</td>
      </tr>
      <tr>
        <td>Cell 3</td>
        <td>Cell 4</td>
      </tr>
    </table>
  `;
  
  // Create a more complex table with nested elements
  const complexTableHtml = `
    <table>
      <tr>
        <th><strong>Bold Header</strong></th>
        <th><a href="#section">Link Header</a></th>
      </tr>
      <tr>
        <td><em>Italic Cell</em></td>
        <td><code>Code Cell</code></td>
      </tr>
    </table>
  `;
  
  try {
    // Process the simple table
    const dom1 = new JSDOM(tableHtml);
    const table1 = dom1.window.document.querySelector('table');
    const markdown1 = htmlToMarkdown(table1);
    console.log('Simple Table Result:');
    console.log(markdown1);
    console.log('---');
    
    // Process the complex table
    const dom2 = new JSDOM(complexTableHtml);
    const table2 = dom2.window.document.querySelector('table');
    const markdown2 = htmlToMarkdown(table2);
    console.log('Complex Table Result:');
    console.log(markdown2);
  } catch (error) {
    console.error('Error processing table:', error);
  }
}

// Run the tests
console.log('Starting tests...\n');
testUrlProcessing();
testTableProcessing();
console.log('\nTests completed.');