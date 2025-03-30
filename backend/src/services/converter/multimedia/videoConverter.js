// services/converter/multimedia/videoConverter.js

import { transcriber } from '../../transcriber.js';
import { generateMarkdown } from '../../../utils/markdownGenerator.js';
import path from 'path';

const SUPPORTED_FORMATS = ['mp4', 'webm', 'avi'];

export async function convertVideoToMarkdown(input, options) {
  try {
    // Validate input
    if (!Buffer.isBuffer(input)) {
      throw new Error('Invalid input: Expected a buffer');
    }

    const { name, apiKey, mimeType } = options;
    if (!apiKey) {
      throw new Error('API key is required for video conversion');
    }

    // Extract audio and transcribe
    console.log('Split audio into chunks');
    try {
      const audioBuffer = await transcriber.extractAudioFromVideo(input);
      const chunks = [audioBuffer]; // For now, single chunk. Could implement chunking later

      console.log(`Transcribing ${chunks.length} chunks`);
      const transcriptions = await Promise.all(
        chunks.map(async (chunk, index) => {
          console.log(`Transcribing chunk ${index + 1}/${chunks.length}`);
          return transcriber.transcribe(chunk, apiKey);  // Pass buffer directly
        })
      );

      // Combine transcriptions
      const fullTranscript = transcriptions.join('\n\n');

      // Remove temp_ prefix from title if present
      let baseName = path.basename(name, path.extname(name));
      if (baseName.startsWith('temp_')) {
        // Extract original filename by removing 'temp_timestamp_' prefix
        baseName = baseName.replace(/^temp_\d+_/, '');
      }
      
      // Generate markdown
      const markdown = generateMarkdown({
        title: `Video Transcription: ${baseName}`,
        content: fullTranscript,
        metadata: {
          source: name,
          type: 'video-transcription',
          mimeType: mimeType,
          created: new Date().toISOString(),
          page_count: 1 // Video files are treated as a single page
        }
      });

      return {
        success: true,
        content: markdown,
        type: 'video',
        name,
        category: 'video',
        originalContent: input
      };
    } catch (error) {
      if (error.message.includes('ffmpeg exited with code 1')) {
        throw new Error('Video conversion failed. Check ffmpeg installation or file integrity.');
      }
      throw error;
    }

  } catch (error) {
    console.error('Error converting video to Markdown:', error);
    throw error;
  }
}
