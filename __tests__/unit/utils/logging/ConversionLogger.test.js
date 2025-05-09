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
    // Re-require after resetModules to ensure mocks are fresh
    const { ConversionLogger: FreshLogger } = require('../../../../src/electron/utils/logging/ConversionLogger');
    const FreshConversionStatus = require('../../../../src/electron/utils/conversion/ConversionStatus');
    
    // Explicitly reinforce mock return value for each test
    FreshConversionStatus.getStatusIcon.mockReturnValue(mockStatusIcon);

    logger = new FreshLogger('TestComponent');
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

describe('Core Logging Methods', () => {
    test('log() should call console.info by default', () => {
      logger.log('Test message');
      expect(consoleSpy.info).toHaveBeenCalledWith('[TestComponent] Test message');
    });

    test('log() should call correct console method based on level', () => {
      logger.log('Debug message', 'DEBUG');
      expect(consoleSpy.debug).toHaveBeenCalledWith('[TestComponent] Debug message');

      logger.log('Info message', 'INFO');
      expect(consoleSpy.info).toHaveBeenCalledWith('[TestComponent] Info message');

      logger.log('Warn message', 'WARN');
      expect(consoleSpy.warn).toHaveBeenCalledWith('[TestComponent] Warn message');

      logger.log('Error message', 'ERROR');
      expect(consoleSpy.error).toHaveBeenCalledWith('[TestComponent] Error message');
    });

    test('log() should handle context parameter correctly', () => {
      logger.log('Message with context', 'INFO', { phase: 'TESTING', fileType: 'txt' });
      expect(consoleSpy.info).toHaveBeenCalledWith('[TestComponent:TESTING][txt] Message with context');
    });

    test('info() should call log() with INFO level', () => {
      const logSpy = jest.spyOn(logger, 'log');
      logger.info('Info test');
      expect(logSpy).toHaveBeenCalledWith('Info test', 'INFO', {});
      expect(consoleSpy.info).toHaveBeenCalledWith('[TestComponent] Info test');
    });

    test('debug() should call log() with DEBUG level', () => {
      const logSpy = jest.spyOn(logger, 'log');
      logger.debug('Debug test', { custom: 'data' });
      expect(logSpy).toHaveBeenCalledWith('Debug test', 'DEBUG', { custom: 'data' });
      expect(consoleSpy.debug).toHaveBeenCalledWith('[TestComponent] Debug test'); // Formatting happens in _formatMessage
    });

    test('warn() should call log() with WARN level', () => {
      const logSpy = jest.spyOn(logger, 'log');
      logger.warn('Warn test');
      expect(logSpy).toHaveBeenCalledWith('Warn test', 'WARN', {});
      expect(consoleSpy.warn).toHaveBeenCalledWith('[TestComponent] Warn test');
    });

    test('error() should call log() with ERROR level', () => {
      const logSpy = jest.spyOn(logger, 'log');
      logger.error('Error test', { code: 500 });
      expect(logSpy).toHaveBeenCalledWith('Error test', 'ERROR', { code: 500 });
      expect(consoleSpy.error).toHaveBeenCalledWith('[TestComponent] Error test'); // Formatting happens in _formatMessage
    });

    test('success() should call log() with INFO level and success emoji', () => {
      const logSpy = jest.spyOn(logger, 'log');
      logger.success('Success test');
      expect(logSpy).toHaveBeenCalledWith('✅ Success test', 'INFO', {});
      expect(consoleSpy.info).toHaveBeenCalledWith('[TestComponent] ✅ Success test');
    });
  });

  describe('Context Handling', () => {
    test('setContext should add context for subsequent logs', () => {
      logger.setContext({ conversionId: '123', fileType: 'mp4' });
      logger.info('Processing video');
      expect(consoleSpy.info).toHaveBeenCalledWith('[TestComponent][mp4] Processing video');
    });

    test('setContext should merge with existing context', () => {
      logger.setContext({ conversionId: '123' });
      logger.setContext({ fileType: 'mp4' }); // This will overwrite if keys clash, standard object spread behavior
      logger.info('Processing video');
      expect(consoleSpy.info).toHaveBeenCalledWith('[TestComponent][mp4] Processing video');
    });

    test('clearContext should remove all context', () => {
      logger.setContext({ conversionId: '123', fileType: 'mp4' });
      logger.clearContext();
      logger.info('Processing done');
      expect(consoleSpy.info).toHaveBeenCalledWith('[TestComponent] Processing done');
    });

    test('Message-specific context should override global context keys', () => {
      logger.setContext({ phase: 'GLOBAL', fileType: 'global.txt' });
      logger.info('Specific message', { phase: 'SPECIFIC', fileType: 'specific.txt' });
      // _formatMessage uses combinedContext = { ...this.context, ...context }
      // So message-specific context keys ('phase', 'fileType') override global ones
      expect(consoleSpy.info).toHaveBeenCalledWith('[TestComponent:SPECIFIC][specific.txt] Specific message');
    });

     test('Message-specific context should merge with global context (different keys)', () => {
      logger.setContext({ conversionId: 'abc' }); // Global context
      logger.info('Specific message', { phase: 'SPECIFIC', fileType: 'specific.txt' }); // Message context
      // The _formatMessage combines contexts: { conversionId: 'abc', phase: 'SPECIFIC', fileType: 'specific.txt' }
      // The output format only uses phase and fileType explicitly
      expect(consoleSpy.info).toHaveBeenCalledWith('[TestComponent:SPECIFIC][specific.txt] Specific message');
    });
  });
  describe('Conversion Buffer Sanitization', () => {
    test('handles small Buffer (< 1MB) with preview', () => {
      const smallBuffer = Buffer.alloc(1024 * 512); // 512KB
      const options = { videoData: smallBuffer };
      
      logger.logConversionStart('mp4', options);
      
      // Expect the new metadata format including detected type and hash, checking keys individually
      const infoCall = consoleSpy.info.mock.calls[0][0];
      expect(infoCall).toEqual(expect.stringContaining('"videoData":{'));
      expect(infoCall).toEqual(expect.stringContaining('"size":524288'));
      expect(infoCall).toEqual(expect.stringContaining('"sizeFormatted":"512.0KB"'));
      expect(infoCall).toEqual(expect.stringContaining('"type":"application/octet-stream"')); // Type detected as generic
      expect(infoCall).toEqual(expect.stringContaining('"hash":')); // Check that hash is present
      expect(infoCall).toEqual(expect.stringContaining('"preview":')); // Check that preview is present for small buffers
    });

    test('handles medium Buffer (1-50MB) with metadata only', () => {
      const mediumBuffer = Buffer.alloc(2 * 1024 * 1024); // 2MB
      const options = { videoData: mediumBuffer };
      
      logger.logConversionStart('mp4', options);
      
      // Expect metadata format without preview for medium buffers, checking keys individually
      const infoCall = consoleSpy.info.mock.calls[0][0];
      expect(infoCall).toEqual(expect.stringContaining('"videoData":{'));
      expect(infoCall).toEqual(expect.stringContaining('"size":2097152'));
      expect(infoCall).toEqual(expect.stringContaining('"sizeFormatted":"2.0MB"'));
      expect(infoCall).toEqual(expect.stringContaining('"type":"application/octet-stream"'));
      expect(infoCall).toEqual(expect.stringContaining('"hash":')); // Check that hash is present
      expect(infoCall).not.toEqual(expect.stringContaining('preview')); // Preview should NOT be present
    });

    test('handles large Buffer (> 50MB) with basic metadata', () => {
      const largeBuffer = Buffer.alloc(51 * 1024 * 1024); // 51MB
      const options = { videoData: largeBuffer };
      
      logger.logConversionStart('mp4', options);
      
      // Expect only basic metadata for large buffers
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('"videoData":{"type":"[Large Buffer]","size":53477376,"sizeFormatted":"51.0MB"}')
      );
      // Hash and preview should not be present for large buffers
      expect(consoleSpy.info).not.toHaveBeenCalledWith(
        expect.stringContaining('"hash":')
      );
       expect(consoleSpy.info).not.toHaveBeenCalledWith(
        expect.stringContaining('"preview":')
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
      
      // Check for nested buffer metadata, checking keys individually
      const infoCall = consoleSpy.info.mock.calls[0][0];
      expect(infoCall).toEqual(expect.stringContaining('"data":{'));
      expect(infoCall).toEqual(expect.stringContaining('"size":1024'));
      expect(infoCall).toEqual(expect.stringContaining('"sizeFormatted":"1.0KB"'));
      expect(infoCall).toEqual(expect.stringContaining('"type":"application/octet-stream"'));
      expect(infoCall).toEqual(expect.stringContaining('"thumbnail":{'));
      expect(infoCall).toEqual(expect.stringContaining('"size":512'));
      expect(infoCall).toEqual(expect.stringContaining('"sizeFormatted":"512.0B"'));
      expect(infoCall).toEqual(expect.stringContaining('"type":"application/octet-stream"'));
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
      // Check buffer metadata alongside stream placeholder, checking keys individually
      const infoCall = consoleSpy.info.mock.calls[0][0];
      expect(infoCall).toEqual(expect.stringContaining('"input":"[Stream/Handle]"'));
      expect(infoCall).toEqual(expect.stringContaining('"output":"[Stream/Handle]"'));
      expect(infoCall).toEqual(expect.stringContaining('"data":{'));
      expect(infoCall).toEqual(expect.stringContaining('"size":1024'));
      expect(infoCall).toEqual(expect.stringContaining('"sizeFormatted":"1.0KB"'));
      expect(infoCall).toEqual(expect.stringContaining('"type":"application/octet-stream"'));
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
      // Check buffer metadata within mixed types, checking keys individually
      expect(infoCall).toEqual(expect.stringContaining('"buffer":{'));
      expect(infoCall).toEqual(expect.stringContaining('"size":1024'));
      expect(infoCall).toEqual(expect.stringContaining('"sizeFormatted":"1.0KB"'));
      expect(infoCall).toEqual(expect.stringContaining('"type":"application/octet-stream"'));
      expect(infoCall).toEqual(expect.stringContaining('"nested":{')); // Check nested structure too
      expect(infoCall).toEqual(expect.stringContaining('"buffer":{')); // Nested buffer
      expect(infoCall).toEqual(expect.stringContaining('"size":512'));
    });

    // Test name updated for clarity: Sanitizer handles circular refs before stringify
    test('handles circular references detected by sanitizer', () => {
      const circular = { a: {} };
      circular.a.b = circular;
      
      logger.logConversionStart('mp4', circular);
      
      // Sanitizer replaces circular refs *before* JSON.stringify is called in logger
      // So, we expect the '[Circular Reference]' marker in the final info log,
      // and console.warn should NOT be called for a stringify error in this case.
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('"a":{"b":"[Circular Reference]"') // Check for the marker
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