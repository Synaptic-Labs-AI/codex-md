# Product Context

## Purpose
mdCode is an Electron-based desktop application designed to convert various file types and web content into Markdown format specifically for use with Obsidian, a knowledge management application. It provides a seamless local experience for file conversion without requiring internet connectivity for most operations.

## Problems Solved
- Enables users to convert different file formats (PDF, DOCX, PPTX, etc.) to Markdown locally
- Allows conversion of web content (URLs, YouTube videos) to Markdown when online
- Supports batch conversions of multiple files/URLs with native file system integration
- Handles multimedia content (audio/video) transcription via OpenAI's Whisper API
- Automates the process of creating Obsidian-compatible Markdown files
- Provides native desktop features like drag-and-drop, system tray access, and offline support
- Securely manages OpenAI API keys for transcription features
- Provides local file handling with native system integration

## How It Works
1. Accepts various input types through native file system:
   - Local files (PDF, DOCX, PPTX, CSV, XLSX, etc.)
   - URLs (web pages, parent URLs for entire sites when online)
   - YouTube videos (requires internet connection)
   - Audio/video files for local transcription

2. Processing Flow:
   - Direct file system access for local files
   - Validates file types and permissions
   - Routes to appropriate local converter based on file type
   - Converts content to Markdown format
   - Organizes output with intelligent folder structure:
     * Single files: Direct save to selected location
     * Batch conversions: Creates dated batch folders
     * Web content: Separate folders with assets
     * YouTube content: Single markdown files with metadata
     * Audio/Video: Transcribed content with original media metadata
   - Supports batch processing with organized output
   - Handles both online and offline operations seamlessly
   - Securely manages API access for transcription services

3. API Integration:
   - Secure local storage of API keys
   - Encrypted storage using machine-specific keys
   - Automatic API key validation
   - Usage tracking and monitoring
   - Online/offline capability detection
   - Fallback options for offline operation

4. Desktop Features:
   - Native file system integration for direct file access
   - Intelligent file organization and folder management
   - System tray presence for quick access
   - Drag-and-drop support for files
   - Output location memory and shortcuts
   - Offline operation for local file conversions
   - Auto-updates for software improvements
   - Native notifications for conversion status
   - Local storage for conversion preferences and history

4. File Organization:
   - Single File Output:
     * Direct save to selected directory
     * Maintains original filename with .md extension
   - Batch Processing:
     * Creates dated folders (e.g., "Batch_2025-03-27_14-30")
     * Preserves file relationships and structure
   - Web Content:
     * Separate folder for each converted webpage
     * Assets stored in dedicated subfolder
     * Index.md for main content
   - YouTube Content:
     * Single markdown file with timestamps
     * Embedded metadata and video information
