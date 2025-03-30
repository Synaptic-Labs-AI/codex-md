// routes/convert/utils/apiKeyChecker.js

import { requiresApiKey } from '../../../utils/fileTypeUtils.js';
import { AppError } from '../../../utils/errorHandler.js';  // Fix path
import path from 'path';

/**
 * Middleware to check API key based on file type
 */
export function apiKeyChecker(req, res, next) {
  // Set proper headers for file downloads
  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': 'attachment; filename="obsidian_conversion.zip"',
    'Cache-Control': 'no-cache'
  });

  // Get file extension
  const extension = req.file?.originalname ? 
    path.extname(req.file.originalname).slice(1).toLowerCase() : null;
  
  // If no extension or doesn't require API key, continue
  if (!extension || !requiresApiKey(extension)) {
    return next();
  }

  // Check for API key in headers
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  
  if (!apiKey) {
    return next(new AppError('API key is required for audio/video conversion', 401));
  }

  // Basic API key format validation
  if (!apiKey.startsWith('sk-')) {
    return next(new AppError('Invalid API key format', 401));
  }

  next();
}
