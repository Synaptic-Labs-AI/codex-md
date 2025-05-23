# CodexMD

A Windows desktop application that converts documents, audio, video, and websites into clean Markdown files optimized for Obsidian.

## Getting Started

### Download and Install

1. Go to the [Latest Release](https://github.com/Synaptic-Labs-AI/codex-md/releases/latest)
2. Download `CodexMD-Setup-x.x.x.exe` for Windows
3. Run the installer and launch CodexMD

*Note: macOS and Linux versions coming...when they come*

### How to Convert Files

1. **Open CodexMD** from your desktop or Start Menu
2. **Choose your input type**:
   - **File**: Click "Choose File" or drag and drop a file
   - **URL**: Click the URL tab and paste a website link
3. **Click Convert** to start the conversion
4. **View Results**: Click "Open Output Folder" when complete

## Supported Formats

### Documents
- **PDF** - Standard conversion (works offline)
- **PDF with OCR** - Advanced extraction for complex layouts (requires Mistral API key)
- **DOCX, PPTX** - Microsoft Office documents
- **HTML/HTM** - Web pages saved locally

### Audio & Video (requires Deepgram API key)
- **Audio**: MP3, WAV, M4A, FLAC, OGG
- **Video**: MP4, WEBM, AVI, MOV, MKV

### Data Files
- **CSV** - Comma-separated values
- **XLSX** - Excel spreadsheets

### Websites
- **Single URL**: Convert one webpage to Markdown
- **Parent URL**: Convert an entire website with all linked pages
  - Automatically crawls linked pages (up to 3 levels deep)
  - Processes up to 100 pages
  - Includes image links for Obsidian compatibility
  - Adds page metadata and structure

## Setting Up API Keys

Some features require API keys:

### For Audio/Video Transcription
1. Create a free account at [Deepgram](https://console.deepgram.com/signup)
2. Copy your API key
3. Go to **Settings** in CodexMD
4. Paste your key in the **Deepgram API Key** field
5. Choose a transcription model:
   - **Nova 3** - Latest and most accurate
   - **Nova 2** - Balanced speed and accuracy
   - **Nova 1** - Fastest processing

### For Advanced PDF OCR
1. Get an API key from [Mistral AI](https://console.mistral.ai/)
2. Go to **Settings** in CodexMD
3. Paste your key in the **Mistral API Key** field
4. Toggle **Advanced OCR** on

## Settings and Options

### Appearance
- **Theme**: Toggle between light and dark mode

### Document Processing
- **Standard Mode**: Fast PDF conversion (works offline)
- **Advanced OCR Mode**: Better extraction for complex PDFs with tables and difficult text

### Website Conversion
- **Combined File**: All pages in one Markdown file (default)
- **Separate Files**: Each page as its own file in a folder structure

### Transcription
- Choose between three Deepgram Nova models
- Models differ in speed vs accuracy

## Features

### Drag and Drop
Simply drag any supported file onto the app window to start converting.

### Offline Mode
Documents and data files work offline. Only transcription and web scraping need internet.

## Output Format

All files are converted to Markdown optimized for [Obsidian](https://obsidian.md/):
- Clean formatting with proper headings
- Preserved links between pages (for websites)
- Tables maintained from spreadsheets
- Code blocks preserved with syntax highlighting
- Images included as external links
- Metadata in frontmatter format

## Privacy

- All document processing happens locally on your computer
- Audio/video files are sent to Deepgram for transcription
- Complex PDFs may be sent to Mistral for OCR (if enabled)
- Website content is fetched directly from the source
- No usage data or file content is collected by CodexMD

## Development

Want to contribute or build from source?

```bash
# Clone repository
git clone https://github.com/Synaptic-Labs-AI/codex-md.git
cd codex-md

# Install dependencies
npm install
cd frontend && npm install && cd ..

# Run in development
npm run dev

# Build application
npm run build
```

## Support

- Report issues: [GitHub Issues](https://github.com/Synaptic-Labs-AI/codex-md/issues)
- View logs: Settings > Advanced > Show Logs

## License

CodexMD is open source software licensed under the MIT License.