# Product Context

## Purpose
The Obsidian Note Converter Frontend is a web application designed to help users convert various file types into Markdown format specifically for use in Obsidian, a knowledge management application.

## Problem Statement
Users need to convert different types of files (documents, media, web content) into Markdown format for their Obsidian vaults, but manually converting these files is time-consuming and error-prone.

## Solution
A user-friendly web interface that:
- Accepts multiple file formats (documents, data files, audio, video)
- Supports URL-based conversions
- Handles batch processing
- Provides real-time conversion status
- Delivers results in a convenient ZIP format

## Key Features
1. Multi-format Support:
   - Documents: PDF, DOCX, PPTX, TXT
   - Data: CSV, XLSX
   - Media: MP3, WAV, M4A, MP4, WEBM, AVI
   - Web: URLs, YouTube content

2. Flexible Input Methods:
   - File upload via drag-and-drop
   - URL input for web content
   - Batch processing capability

3. User-Friendly Interface:
   - Real-time progress tracking
   - Error handling and feedback
   - Conversion status monitoring

4. Security:
   - API key management for protected operations
   - Secure file handling

## User Workflow
1. User adds files through upload or URL input
2. System validates files and input
3. Conversion process starts with progress tracking
4. Results are packaged into a ZIP file
5. User downloads the converted Markdown files
