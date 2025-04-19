/**
 * UnifiedConverterFactory.test.js
 * 
 * Unit tests for the UnifiedConverterFactory module
 * Focuses on testing the standardizeResult method to ensure
 * content property is properly handled and not overridden
 */

const { describe, it, expect, jest } = require('@jest/globals');
const path = require('path');

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