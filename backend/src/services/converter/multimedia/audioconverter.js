import { openaiProxy } from '../../openaiProxy.js';
import { generateMarkdown } from '../../../utils/markdownGenerator.js';
import { FormData } from 'formdata-node';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB (OpenAI's current limit)
const SUPPORTED_FORMATS = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm'];

export async function convertAudioToMarkdown(input, originalName, apiKey) {
  try {
    // Normalize input
    const audioBuffer = Buffer.isBuffer(input) ? input : input.buffer;
    
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Invalid or empty audio buffer');
    }

    if (audioBuffer.length > MAX_FILE_SIZE) {
      throw new Error(`File size exceeds the maximum limit of ${MAX_FILE_SIZE / (1024 * 1024)} MB`);
    }

    const fileExt = originalName.split('.').pop().toLowerCase();
    if (!SUPPORTED_FORMATS.includes(fileExt)) {
      throw new Error(`Unsupported audio format. Supported formats: ${SUPPORTED_FORMATS.join(', ')}`);
    }

    // Prepare form data for OpenAI
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer]), originalName);
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'text');

    // Get transcription
    const transcription = await openaiProxy.makeRequest(apiKey, 'audio/transcriptions', formData);
    
    if (!transcription) {
      throw new Error('No transcription received');
    }

    // Remove temp_ prefix from title if present
    let cleanTitle = originalName;
    if (cleanTitle.startsWith('temp_')) {
      // Extract original filename by removing 'temp_timestamp_' prefix
      cleanTitle = cleanTitle.replace(/^temp_\d+_/, '');
    }
    
    // Generate markdown content
    const markdown = generateMarkdown({
      title: `Audio Transcription: ${cleanTitle}`,
      content: transcription,
      metadata: {
        source: originalName,
        type: 'audio-transcription',
        format: fileExt,
        fileSize: audioBuffer.length,
        created: new Date().toISOString(),
        page_count: 1 // Audio files are treated as a single page
      }
    });

    // Return with success flag
    return {
      success: true,
      content: markdown,
      type: 'audio',
      name: originalName,
      category: 'audio',
      originalContent: audioBuffer // Keep original audio for ZIP
    };

  } catch (error) {
    console.error('Audio conversion error:', error);
    throw error;
  }
}
