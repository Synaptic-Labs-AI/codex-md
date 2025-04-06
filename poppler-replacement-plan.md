# PDF Processing Improvement Plan

## Overview

This plan outlines the steps to replace the Poppler dependency with a pure JavaScript solution for PDF processing in the Codex MD app. Currently, the app requires users to have Poppler installed on their system to use the standard PDF converter. By implementing a JavaScript-based solution, we'll eliminate this external dependency while maintaining core functionality.

## Goals

1. Remove the requirement for users to install Poppler
2. Implement a pure JavaScript solution for PDF text extraction
3. Maintain the Mistral OCR option for full PDF processing (text + images)
4. Simplify the codebase and improve cross-platform compatibility

## Implementation Plan

### 1. Add JavaScript PDF Parser

**File:** `package.json`
- Add pdf-parse dependency
```json
"dependencies": {
  "pdf-parse": "^1.1.1",
  // existing dependencies...
}
```

### 2. Create SimplePdfConverter

**File:** `backend/src/services/converter/pdf/SimplePdfConverter.js`
- Create a new converter that uses pdf-parse for text extraction
- Skip image extraction in this simple converter
- Implement all required methods from BasePdfConverter

### 3. Update PdfConverterFactory

**File:** `backend/src/services/converter/pdf/PdfConverterFactory.js`
- Modify to use SimplePdfConverter as the default instead of StandardPdfConverter
- Keep MistralPdfConverter as the OCR option
- Update error messages and logging

### 4. Update UI Components (if needed)

**File:** `frontend/src/lib/components/settings/PdfSettings.svelte` (if exists)
- Update UI text to clarify the difference between standard and OCR conversion
- Make it clear that standard conversion only extracts text
- Explain that OCR is needed for image extraction

### 5. Testing

Test the following scenarios:
- Basic PDF text extraction
- Large PDFs
- PDFs with different languages
- PDFs with complex layouts
- Fallback to Mistral OCR when needed

## Detailed Implementation

### SimplePdfConverter.js

This new converter will:
1. Use pdf-parse to extract text from PDFs
2. Skip image extraction (users who need images will use OCR)
3. Implement the same interface as the existing converters
4. Include clear documentation about its capabilities and limitations

### PdfConverterFactory.js Updates

The factory will be updated to:
1. Import the new SimplePdfConverter
2. Use it as the default converter
3. Maintain the option to use MistralPdfConverter for OCR
4. Provide clear error messages and logging

## Future Considerations

1. If needed, explore more advanced JavaScript PDF libraries for better text extraction
2. Consider adding basic image extraction capabilities to the JavaScript solution
3. Evaluate performance impact on large PDFs

## Timeline

1. Implement SimplePdfConverter
2. Update PdfConverterFactory
3. Test with various PDF types
4. Update UI and documentation
5. Deploy the changes
