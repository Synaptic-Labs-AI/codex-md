// config/default.js

export const config = {
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development'
  },
  api: {
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      timeout: 300000,
      maxRetries: 3,
      apiKey: process.env.OPENAI_API_KEY
    }
  },
  conversion: {
    allowedFileTypes: [
      "txt", "pdf", "docx", "pptx",
      "csv", "xlsx",
      "mp3", "wav", "m4a",
      "mp4", "webm", "avi"
    ],
    maxFileSize: 52428800, // 50MB for non-video files
    maxVideoFileSize: 524288000 // 500MB for video files
  },
  storage: {
    tempDir: '/tmp/obsidian-converter'
  },
  security: {
    rateLimitPerMinute: 100
  },
  CORS: {
    ORIGIN: [
      'https://frontend-production-2748.up.railway.app',
      'http://localhost:5173',
      'http://localhost:3000'
    ],
    METHODS: ['GET', 'POST', 'OPTIONS'],
    ALLOWED_HEADERS: [
      'Content-Type',
      'Authorization',
      'x-api-key',
      'Origin',
      'Accept'
    ],
    EXPOSED_HEADERS: ['Content-Disposition']
  }
};

// Optionally, add a default export if needed
export default config;
