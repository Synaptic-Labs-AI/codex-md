# Multimedia Conversion Test Files

This directory contains test files and scripts for testing the audio and video conversion functionality in Codex MD.

## Test Files

- `sample-audio.mp3`: A sample MP3 file with a sine wave tone
- `sample-video.mp4`: A sample MP4 video file with a test pattern

## Generated Output Files

- `audio-conversion-result.md`: The result of converting the sample MP3 file to Markdown
- `video-conversion-result.md`: The result of converting the sample video file to Markdown

## How to Use

1. First, generate the sample test files:

```bash
node scripts/generate-test-files.js
```

This script requires FFmpeg to be installed on your system. It will generate a sample MP3 file and a sample MP4 video file in the `test-files` directory.

2. Then, run the test script:

```bash
# Set your OpenAI API key if you want to test transcription
export OPENAI_API_KEY=your_api_key_here

# Run the test script
node scripts/test-multimedia-conversion.js
```

The test script will:
- Attempt to convert the sample MP3 file to Markdown
- Attempt to convert the sample video file to Markdown
- Log the results of each conversion
- Verify that the converted content contains the expected elements

## Notes

- If you don't provide an OpenAI API key, the transcription functionality will be skipped.
- The test script will create detailed log output showing the progress and results of each conversion.
- The converted Markdown files will be saved in this directory for manual inspection.