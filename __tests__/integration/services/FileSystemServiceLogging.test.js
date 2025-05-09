// Define mock objects *before* using them in jest.mock
const mockFsPromises = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  unlink: jest.fn(),
  stat: jest.fn(),
  mkdir: jest.fn(),
  access: jest.fn(),
  constants: {
      R_OK: 4,
      W_OK: 2
  }
};

// Mock modules FIRST
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn((name) => {
      if (name === 'userData') return '/mock/userData';
      if (name === 'temp') return '/mock/temp';
      return '/mock/path';
    }),
    on: jest.fn(),
    isPackaged: false,
  },
  ipcMain: {
    handle: jest.fn(),
    removeHandler: jest.fn(),
  },
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  statSync: jest.fn(() => ({ isFile: () => true, isDirectory: () => false })),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(() => ''),
  writeFileSync: jest.fn(),
  constants: {
      R_OK: 4,
      W_OK: 2
  }
}));

jest.mock('fs/promises', () => mockFsPromises);

// Require modules AFTER mocks
const path = require('path');
const { FileSystemService } = require('../../../src/electron/services/FileSystemService');
// We need the actual fs promises mock object to set return values in tests
const fs = require('fs/promises');
// const { getLogger } = require('../../../src/electron/utils/logging/ConversionLogger'); // Not strictly needed if only spying on console

// Reset fs/promises mocks before each test
beforeEach(() => {
  Object.values(mockFsPromises).forEach(mockFn => {
    if (jest.isMockFunction(mockFn)) {
      mockFn.mockReset();
    }
  });
  // Re-apply default implementations if needed after reset
  mockFsPromises.stat.mockResolvedValue({ isFile: () => true, size: 100 });
  mockFsPromises.mkdir.mockResolvedValue(undefined);
});


describe('FileSystemService Logging Integration Test', () => {
  let fileSystemService;
  let consoleSpy;

  beforeEach(() => {
    // Reset other mocks (like console spy) before each test
    // Note: fs/promises mocks are reset in the top-level beforeEach
    jest.clearAllMocks(); // Clears electron mocks etc.

    // Spy on console methods
    consoleSpy = {
      debug: jest.spyOn(console, 'debug').mockImplementation(),
      info: jest.spyOn(console, 'info').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation()
    };

    // Instantiate the service. It will internally create its own logger instance.
    fileSystemService = new FileSystemService();
  });

  afterEach(() => {
    // Restore console spies
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
  });

  test('readFile should log info on success', async () => {
    const filePath = 'test/read/file.txt';
    const fileContent = 'Test content';
    // Use the imported mock object 'fs' which points to mockFsPromises
    fs.readFile.mockResolvedValue(fileContent);
    fs.stat.mockResolvedValue({ isFile: () => true, size: fileContent.length }); // Ensure stat is also mocked for readFile logic

    let result;
    try {
      // Call the actual service method
      result = await fileSystemService.readFile(filePath);
    } catch (e) {
      // Should not throw in success case
    }

    expect(result.success).toBe(true);
    expect(result.data).toBe(fileContent);
    expect(fs.stat).toHaveBeenCalledWith(expect.stringContaining(filePath)); // Verify fs.stat call
    expect(fs.readFile).toHaveBeenCalledWith(expect.stringContaining(filePath), { encoding: 'utf8' }); // Verify fs.readFile call

    // Check console logs
    expect(consoleSpy.info).toHaveBeenCalledWith(
      expect.stringContaining(`[FileSystemService] Reading file`) // Check basic message
    );
    // Check for specific path in context if logger includes it
    // Example: expect(consoleSpy.info).toHaveBeenCalledWith(expect.stringContaining(filePath));

    expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining(`[FileSystemService] ✅ File read successfully`) // Check success message WITH EMOJI
    );
    expect(consoleSpy.debug).toHaveBeenCalledWith(
        expect.stringContaining(`Data preview: Test content`) // Check debug preview
    );
    expect(consoleSpy.error).not.toHaveBeenCalled();
  });

  test('readFile should log error on failure', async () => {
    const filePath = 'test/read/nonexistent.txt';
    const mockError = new Error('File not found');
    mockError.code = 'ENOENT';
    // Mock fs.stat to throw the error, as that's checked first in readFile
    fs.stat.mockRejectedValue(mockError);

    let result;
    try {
      result = await fileSystemService.readFile(filePath);
    } catch (e) {
      // The service method catches and returns { success: false }, should not throw here
    }

    expect(result.success).toBe(false);
    expect(result.error).toContain('File not accessible: File not found');
    expect(fs.stat).toHaveBeenCalledWith(expect.stringContaining(filePath)); // Verify fs.stat call
    expect(fs.readFile).not.toHaveBeenCalled(); // readFile should not be called if stat fails

    // Check console logs
    expect(consoleSpy.info).toHaveBeenCalledWith(
      expect.stringContaining(`[FileSystemService] Reading file`)
    );
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining(`[FileSystemService] File stat error: File not found`) // Check for stat error log
    );
    // Ensure no success logs were made
    expect(consoleSpy.info).not.toHaveBeenCalledWith(
        expect.stringContaining(`[FileSystemService] File read successfully`)
    );
  });

  test('writeFile should log info on success', async () => {
    const filePath = 'test/write/output.txt';
    const content = 'Data to write';
    // Mock successful write and subsequent stat verification
    fs.writeFile.mockResolvedValue(undefined);
    fs.stat.mockResolvedValue({ size: content.length, birthtime: new Date(), mtime: new Date() });

    let result;
    try {
      result = await fileSystemService.writeFile(filePath, content);
    } catch (e) {
       // Should not throw
    }

    expect(result.success).toBe(true);
    expect(result.stats.size).toBe(content.length);
    // Use expect.any(String) as validatePath normalizes the path
    expect(fs.mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(expect.any(String), content, { encoding: 'utf8' });
    expect(fs.stat).toHaveBeenCalledWith(expect.any(String)); // Verify stat call for verification

    // Check console logs
    expect(consoleSpy.info).toHaveBeenCalledWith(
      expect.stringContaining(`[FileSystemService] Writing file`)
    );
     expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining(`[FileSystemService] ✅ File written successfully`) // Check success message WITH EMOJI
    );
    expect(consoleSpy.error).not.toHaveBeenCalled();
  });

   test('writeFile should log error on failure', async () => {
    const filePath = 'test/write/protected/output.txt';
    const content = 'Data to write';
    const mockError = new Error('Permission denied');
    mockError.code = 'EACCES';
    fs.writeFile.mockRejectedValue(mockError); // Mock failed write

    let result;
    try {
      result = await fileSystemService.writeFile(filePath, content);
    } catch (e) {
      // Should not throw
    }

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to write file: Permission denied');
    // Use expect.any(String) as validatePath normalizes the path
    expect(fs.mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(expect.any(String), content, { encoding: 'utf8' });

    // Check console logs
    expect(consoleSpy.info).toHaveBeenCalledWith(
      expect.stringContaining(`[FileSystemService] Writing file`)
    );
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining(`[FileSystemService] Failed to write file: Permission denied`)
    );
     // Ensure no success logs were made
     expect(consoleSpy.info).not.toHaveBeenCalledWith(
        expect.stringContaining(`[FileSystemService] File written successfully`)
     );
  });

});