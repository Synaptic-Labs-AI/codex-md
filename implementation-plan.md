# Implementation Plan: Video Transcription Fix

## Files to Modify

### 1. backend/src/services/transcriber.js
- Remove _createAudioStream method
- Update the transcribe method to:
  1. Accept file path directly
  2. Use file path with OpenAI API
  3. Add proper error handling
  4. Add clear logging

### 2. backend/src/services/converter/multimedia/videoConverter.js
- In convertToMarkdown method:
  1. Integrate TempFileManager for video handling
  2. Extract audio using FFmpeg
  3. Add size check for extracted audio:
     - If ≤ 25MB: Send directly to transcription
     - If > 25MB: Use AudioChunker
  4. Update progress tracking and error handling
  5. Cleanup temp files properly

### 3. backend/src/utils/audioChunker.js
- Update splitAudio method:
  1. Check if input is Buffer or file path
  2. Skip unnecessary file operations if path provided
  3. Ensure chunks are always under 25MB
  4. Add detailed logging for troubleshooting

## Implementation Steps

1. **First Pass: transcriber.js**
   - [ ] Update transcribe method to work with file paths
   - [ ] Remove _createAudioStream method
   - [ ] Add error handling for file access
   - [ ] Add logging for API responses

2. **Second Pass: videoConverter.js**
   - [ ] Import and initialize TempFileManager
   - [ ] Add size check after audio extraction
   - [ ] Update progress tracking
   - [ ] Implement conditional audio chunking
   - [ ] Add cleanup handling

3. **Third Pass: audioChunker.js**
   - [ ] Add file path input support
   - [ ] Optimize chunk size calculation
   - [ ] Add detailed logging
   - [ ] Ensure proper temp file cleanup

4. **Testing**
   - [ ] Test with video under 25MB audio
   - [ ] Test with video over 25MB audio
   - [ ] Verify temp file cleanup
   - [ ] Check error handling

## Error Cases to Handle

1. Video file access errors
2. FFmpeg extraction failures
3. OpenAI API errors
4. Temp file cleanup issues
5. Memory management for large files

## Progress Tracking

- Video upload: 0-25%
- Audio extraction: 25-50%
- Transcription preparation: 50-75%
- Transcription processing: 75-100%

## Logging Points

1. File size checkpoints
2. Processing phase transitions
3. Error conditions
4. Cleanup operations

Note: Implement changes iteratively, testing each modification before proceeding to the next step.
