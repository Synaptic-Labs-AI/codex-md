/**
 * UnifiedConverterFactory.test.js
 * 
 * Unit tests for the UnifiedConverterFactory module
 * Focuses on testing the standardizeResult method to ensure
 * content property is properly handled and not overridden
 */

const { describe, it, expect } = require('@jest/globals'); // Remove explicit 'jest' import
jest.mock('node-fetch'); // Mock node-fetch to prevent ESM issues
const path = require('path');
// Mock MistralPdfConverter to prevent node-fetch issues in unit tests
jest.mock('../../../src/electron/services/conversion/document/MistralPdfConverter', () => {
  return jest.fn().mockImplementation(() => {
    return {
      convert: jest.fn().mockResolvedValue({ success: true, content: 'mock mistral content' }),
      initialize: jest.fn().mockResolvedValue(undefined), // Add initialize if needed
      // Add other methods if they are called by the factory/service
    };
  });
});

// Mock util.promisify removed - will mock fs.readFile directly

// Mock FileStorageService to prevent its constructor/methods from running
jest.mock('../../../src/electron/services/storage/FileStorageService', () => {
  return jest.fn().mockImplementation(() => {
    return {
      // Mock methods used by dependencies if necessary
      setupStorage: jest.fn().mockResolvedValue(undefined),
      getStoragePath: jest.fn().mockReturnValue('/mock/storage'),
      saveFile: jest.fn().mockResolvedValue('/mock/storage/file.txt'),
      readFile: jest.fn().mockResolvedValue('mock file content'),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      readdir: jest.fn().mockResolvedValue([]), // Add readdir mock here too
    };
  });
});
// Mock fs/promises needed by dependencies
const mockFsPromises = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  unlink: jest.fn(),
  stat: jest.fn(),
  mkdir: jest.fn(),
  access: jest.fn(),
  readdir: jest.fn().mockResolvedValue([]), // Add readdir mock
  constants: { R_OK: 4, W_OK: 2 }
};
jest.mock('fs/promises', () => mockFsPromises);
// Mock sync fs methods AND the callback-based readFile used by promisify
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  statSync: jest.fn(() => ({ isFile: () => true, isDirectory: () => false })),
  readFile: jest.fn((path, options, callback) => { // Add mock for callback readFile
    if (typeof options === 'function') { // Handle case where options is omitted
      callback = options;
      options = undefined;
    }
    if (callback) {
      process.nextTick(() => callback(null, 'mock file content'));
    }
  }),
  constants: { R_OK: 4, W_OK: 2 }
}));

// Reset mocks before each test
beforeEach(() => {
  // Reset fs/promises mocks
  Object.values(mockFsPromises).forEach(mockFn => {
    if (jest.isMockFunction(mockFn)) mockFn.mockReset();
  });
   mockFsPromises.readdir.mockResolvedValue([]);
   // No promisify mock to reset
});

// Mock the electron app
jest.mock('electron', () => ({
  app: {
    getAppPath: jest.fn().mockReturnValue('/mock/app/path'),
    isPackaged: false
  }
}));

// Import the module under test
const unifiedConverterFactory = require('../../../src/electron/converters/UnifiedConverterFactory');

describe('UnifiedConverterFactory', () => {
  describe('standardizeResult', () => {
    it('should properly handle content property and not override it with spread', () => {
      // Arrange
      const mockResult = {
        success: true,
        content: 'Original content',
        // Some property that might shadow content in the spread
        someOtherProperty: null,
        nestedProperty: {
          content: null // This could potentially override content if spread incorrectly
        }
      };
      
      // Act
      const standardizedResult = unifiedConverterFactory.standardizeResult(
        mockResult, 
        'mp4', 
        'test.mp4', 
        'video'
      );
      
      // Assert
      expect(standardizedResult.content).toBeTruthy();
      expect(standardizedResult.content).toBe('Original content');
    });

    it('should provide default values for missing properties', () => {
      // Arrange
      const mockResult = {
        // No content property
        success: true
      };
      
      // Act
      const standardizedResult = unifiedConverterFactory.standardizeResult(
        mockResult, 
        'mp4', 
        'test.mp4', 
        'video'
      );
      
      // Assert
      expect(standardizedResult.content).toBe('');
      expect(standardizedResult.type).toBe('mp4');
      expect(standardizedResult.name).toBe('test.mp4');
      expect(standardizedResult.category).toBe('video');
      expect(standardizedResult.metadata).toBeDefined();
      expect(standardizedResult.images).toEqual([]);
    });

    it('should handle null or undefined result gracefully', () => {
      // Act & Assert
      expect(() => {
        unifiedConverterFactory.standardizeResult(null, 'mp4', 'test.mp4', 'video');
      }).not.toThrow();
      
      const standardizedResult = unifiedConverterFactory.standardizeResult(
        null, 
        'mp4', 
        'test.mp4', 
        'video'
      );
      
      // Should still have the expected properties
      expect(standardizedResult.content).toBe('');
      expect(standardizedResult.type).toBe('mp4');
      expect(standardizedResult.success).toBe(true);
    });
  });
});