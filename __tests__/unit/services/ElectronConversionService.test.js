/**
 * ElectronConversionService.test.js
 * 
 * Integration tests for the ElectronConversionService
 * Focuses on testing the convert method to ensure it properly handles
 * content from the UnifiedConverterFactory
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals'); // Remove explicit 'jest' import
jest.mock('node-fetch'); // Mock node-fetch to prevent ESM issues
const path = require('path');
// Mock MistralPdfConverter to prevent node-fetch issues in unit tests
jest.mock('../../../src/electron/services/conversion/document/MistralPdfConverter', () => {
  return jest.fn().mockImplementation(() => {
    return {
      convert: jest.fn().mockResolvedValue({ success: true, content: 'mock mistral content' }),
      initialize: jest.fn().mockResolvedValue(undefined),
      // Add other methods if they are called by the factory/service
    };
  });
});
// const fs = require('fs-extra'); // fs-extra is mocked below

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

// Mock dependencies (fs-extra is now mocked here)
jest.mock('electron', () => ({
  app: {
    getAppPath: jest.fn().mockReturnValue('/mock/app/path'),
    getPath: jest.fn().mockReturnValue('/mock/user/data'),
    isPackaged: false
  }
}));

// Mock fs-extra separately (moved from line 11)
jest.mock('fs-extra', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  readFileSync: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  ensureDir: jest.fn().mockResolvedValue(undefined),
  createDirectory: jest.fn().mockResolvedValue(undefined)
}));

// Mock the FileSystemService
jest.mock('../../../src/electron/services/FileSystemService', () => ({
  createDirectory: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined)
}));

// Mock the ConversionResultManager
jest.mock('../../../src/electron/services/ConversionResultManager', () => ({
  saveConversionResult: jest.fn().mockImplementation(async (options) => ({
    success: true,
    outputPath: '/mock/output/path',
    mainFile: '/mock/output/path/document.md',
    metadata: options.metadata || {}
  }))
}));

// Create a mock for UnifiedConverterFactory
const mockConvertFile = jest.fn();
jest.mock('../../../src/electron/converters/UnifiedConverterFactory', () => ({
  convertFile: mockConvertFile,
  initialize: jest.fn().mockResolvedValue(true)
}));

// Import the module under test
const ElectronConversionService = require('../../../src/electron/services/ElectronConversionService');

describe('ElectronConversionService', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe('convert', () => {
    it('should not throw "empty content" error when content is properly passed from converter', async () => {
      // Arrange
      const mockFilePath = 'test.mp4';
      const mockOptions = {
        fileType: 'mp4',
        outputDir: '/tmp/output'
      };
      
      // Mock the unifiedConverterFactory.convertFile method to return a result with content
      mockConvertFile.mockResolvedValue({
        success: true,
        content: 'Test content',
        // Simulate the issue where content might be overridden
        someProperty: {
          content: null
        }
      });
      
      // Act
      const result = await ElectronConversionService.convert(mockFilePath, mockOptions);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should throw "empty content" error when converter returns falsy content', async () => {
      // Arrange
      const mockFilePath = 'test.mp4';
      const mockOptions = {
        fileType: 'mp4',
        outputDir: '/tmp/output'
      };
      
      // Mock the unifiedConverterFactory.convertFile method to return a result with empty content
      mockConvertFile.mockResolvedValue({
        success: true,
        content: '', // Empty content
      });
      
      // Act & Assert
      await expect(async () => {
        await ElectronConversionService.convert(mockFilePath, mockOptions);
      }).rejects.toThrow('Conversion produced empty content');
    });

    it('should throw "empty content" error when converter returns null content', async () => {
      // Arrange
      const mockFilePath = 'test.mp4';
      const mockOptions = {
        fileType: 'mp4',
        outputDir: '/tmp/output'
      };
      
      // Mock the unifiedConverterFactory.convertFile method to return a result with null content
      mockConvertFile.mockResolvedValue({
        success: true,
        content: null, // Null content
      });
      
      // Act & Assert
      await expect(async () => {
        await ElectronConversionService.convert(mockFilePath, mockOptions);
      }).rejects.toThrow('Conversion produced empty content');
    });

    it('should handle conversion errors properly', async () => {
      // Arrange
      const mockFilePath = 'test.mp4';
      const mockOptions = {
        fileType: 'mp4',
        outputDir: '/tmp/output'
      };
      
      // Mock the unifiedConverterFactory.convertFile method to return an error
      mockConvertFile.mockResolvedValue({
        success: false,
        error: 'Conversion failed',
      });
      
      // Act
      const result = await ElectronConversionService.convert(mockFilePath, mockOptions);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Conversion failed');
    });
  });
});