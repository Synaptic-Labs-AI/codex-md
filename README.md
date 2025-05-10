# CodexMD

Convert various file types to Markdown format using an Electron-based desktop application.

## Features

- Convert multiple file formats to Markdown:
  - Documents (PDF, DOCX, PPTX)
  - Data files (CSV, XLSX)
  - Multimedia (MP3, WAV, FLAC, MP4, MOV, AVI, MKV) with Deepgram transcription
  - Web content (URLs, websites)
- Offline support
- Customizable output
- Cross-platform (Windows, macOS, Linux)

## Development Setup

### Prerequisites
- Node.js 16+
- npm 7+

### Installation
```powershell
# Install dependencies
npm install

# Install frontend dependencies
cd frontend; npm install; cd ..
```

### Development
```powershell
# Start development mode
npm run dev

# Run tests
npm test
```

### Building
```powershell
# Build for production
npm run build
```

## Project Structure

```
codex-md/
├── src/
│   └── electron/      # Electron main process code
│       ├── services/  # Core services
│       ├── ipc/       # IPC handlers
│       ├── utils/     # Utility functions
│       └── converters/ # File converters
├── frontend/         # Frontend (Svelte) code
├── scripts/         # Build and utility scripts
└── test/           # Test files
```

## Architecture

The application uses a consolidated architecture where all conversion services run in the Electron main process. This provides several advantages:

- Direct access to the file system
- Better performance for CPU-intensive operations
- Simplified deployment
- Reduced memory usage

Communication between the renderer process (UI) and main process happens through IPC channels, with a well-defined API for all operations.

### Media Transcription

The application uses Deepgram's API for audio and video transcription, which provides:

- Fast and accurate speech-to-text
- Support for multiple languages
- Direct transcription of both audio and video files without extraction
- Multiple transcription models (Nova 1, Nova 2, Nova 3)

To use media transcription features, you'll need to provide a [Deepgram API key](https://console.deepgram.com/signup) in the application settings.

## Contributing
1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request
