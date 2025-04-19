const { Readable, Writable } = require('stream');

// Setup mock constants
const mockStatusIcon = '🚀';
const mockStatus = {
  STARTING: 'STARTING',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR'
};

// Mock ConversionStatus before requiring ConversionLogger
jest.mock('../../../../src/electron/utils/conversion/ConversionStatus', () => ({
  STATUS: mockStatus,
  getStatusDescription: jest.fn(),
  getStatusIcon: jest.fn().mockReturnValue(mockStatusIcon)
}));

// Require ConversionLogger after mocking its dependencies
const ConversionStatus = require('../../../../src/electron/utils/conversion/ConversionStatus');
const { ConversionLogger, getLogger, resetLoggers } = require('../../../../src/electron/utils/logging/ConversionLogger');

describe('ConversionLogger', () => {
  let logger;
  let consoleSpy;

  beforeAll(() => {
    // Ensure mock is properly initialized
    ConversionStatus.getStatusIcon.mockReturnValue(mockStatusIcon);
  });

  beforeEach(() => {
    // Clear require cache to ensure fresh instances
    jest.resetModules();
    
    logger = new ConversionLogger('TestComponent');
    consoleSpy = {
      debug: jest.spyOn(console, 'debug').mockImplementation(),
      info: jest.spyOn(console, 'info').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation()
    };
  });

  afterEach(() => {
    resetLoggers();
    jest.clearAllMocks();
  });

  describe('Conversion Buffer Sanitization', () => {
    test('handles small Buffer (< 1MB) with preview', () => {
      const smallBuffer = Buffer.alloc(1024 * 512); // 512KB
      const options = { videoData: smallBuffer };
      
      logger.logConversionStart('mp4', options);
      
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('"videoData":{"type":"[Buffer]","size":524288,"sizeFormatted":"512.0KB"')
      );
    });

    test('handles medium Buffer (1-50MB) with metadata only', () => {
      const mediumBuffer = Buffer.alloc(2 * 1024 * 1024); // 2MB
      const options = { videoData: mediumBuffer };
      
      logger.logConversionStart('mp4', options);
      
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('"videoData":{"type":"[Buffer]","size":2097152,"sizeFormatted":"2.0MB"')
      );
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.not.stringContaining('preview')
      );
    });

    test('handles large Buffer (> 50MB) with basic metadata', () => {
      const largeBuffer = Buffer.alloc(51 * 1024 * 1024); // 51MB
      const options = { videoData: largeBuffer };
      
      logger.logConversionStart('mp4', options);
      
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('"videoData":{"type":"[Large Buffer]","size":53477376,"sizeFormatted":"51.0MB"}')
      );
    });

    test('handles nested objects containing Buffers', () => {
      const options = {
        video: {
          data: Buffer.alloc(1024),
          metadata: {
            thumbnail: Buffer.alloc(512)
          }
        }
      };
      
      logger.logConversionStart('mp4', options);
      
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('"data":{"type":"[Buffer]"')
      );
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('"thumbnail":{"type":"[Buffer]"')
      );
    });

    test('handles stream objects correctly', () => {
      const readStream = new Readable({ read() {} });
      const writeStream = new Writable({ write() {} });
      
      const options = {
        input: readStream,
        output: writeStream,
        data: Buffer.alloc(1024)
      };
      
      logger.logConversionStart('mp4', options);
      
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('"input":"[Stream/Handle]"')
      );
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('"output":"[Stream/Handle]"')
      );
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('"data":{"type":"[Buffer]"')
      );
    });

    test('handles mixed content types correctly', () => {
      const options = {
        buffer: Buffer.alloc(1024),
        stream: new Readable({ read() {} }),
        string: 'test',
        number: 42,
        boolean: true,
        nested: {
          buffer: Buffer.alloc(512),
          array: [1, 2, 3]
        }
      };
      
      logger.logConversionStart('mp4', options);
      
      const infoCall = consoleSpy.info.mock.calls[0][0];
      expect(infoCall).toEqual(expect.stringContaining('"string":"test"'));
      expect(infoCall).toEqual(expect.stringContaining('"number":42'));
      expect(infoCall).toEqual(expect.stringContaining('"boolean":true'));
      expect(infoCall).toEqual(expect.stringContaining('"stream":"[Stream/Handle]"'));
      expect(infoCall).toEqual(expect.stringContaining('"buffer":{"type":"[Buffer]"'));
    });

    test('falls back to basic info when JSON.stringify fails', () => {
      const circular = { a: {} };
      circular.a.b = circular;
      
      logger.logConversionStart('mp4', circular);
      
      expect(consoleSpy.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not stringify full options')
      );
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('with options: {keys: [a]}')
      );
    });
      test('logs debug information about raw options', () => {
        const options = {
          data: Buffer.alloc(1024),
          format: 'mp4'
        };

        logger.logConversionStart('mp4', options);

        expect(consoleSpy.debug).toHaveBeenCalledWith(
          expect.stringContaining('Raw options type: object, keys: data,format')
        );
        expect(consoleSpy.debug).toHaveBeenCalledWith(
          expect.stringContaining('Sanitized options structure: data,format')
        );
      });

      test('handles sanitization errors gracefully', () => {
        const options = {
          get problematic() {
            throw new Error('Sanitization error');
          }
        };

        logger.logConversionStart('mp4', options);

        expect(consoleSpy.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to process options: Sanitization error')
        );
        expect(consoleSpy.info).toHaveBeenCalledWith(
          expect.stringContaining('with options: {type: object}')
        );
      });
    });
  });