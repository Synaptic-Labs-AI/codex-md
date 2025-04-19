/**
 * ElectronConversionService.test.js
 * 
 * Integration tests for the ElectronConversionService
 * Focuses on testing the convert method to ensure it properly handles
 * content from the UnifiedConverterFactory
 */

const { describe, it, expect, jest, beforeEach, afterEach } = require('@jest/globals');
const path = require('path');
const fs = require('fs-extra');

// Mock dependencies
jest.mock('electron', () => ({
  app: {
    getAppPath: jest.fn().mockReturnValue('/mock/app/path'),
    getPath: jest.fn().mockReturnValue('/mock/user/data'),
    isPackaged: false
  }
}));

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