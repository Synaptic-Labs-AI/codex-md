// services/fileProcessor.js
import { textConverterFactory } from './converter/textConverterFactory.js';
import { AppError } from '../utils/errorHandler.js';

export async function processFile(fileBuffer, fileType, apiKey, originalName) {
  try {
    // Just convert and return the content
    return await textConverterFactory.convertToMarkdown(
      fileBuffer,
      fileType,
      apiKey,
      originalName
    );
  } catch (error) {
    console.error(`Error processing file ${originalName}:`, error);
    throw new AppError('File conversion failed', 500, error.message);
  }
}