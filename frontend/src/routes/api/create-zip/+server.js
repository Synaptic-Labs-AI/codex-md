// src/routes/api/create-zip/+server.js

import { json } from '@sveltejs/kit';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';

export async function POST({ request }) {
  const { fileIds } = await request.json();

  if (!fileIds || fileIds.length === 0) {
    return json({ error: 'No files specified for download' }, { status: 400 });
  }

  // Set proper headers for multipart form data
  const headers = {
    'Content-Type': 'multipart/form-data',
    'Accept': 'application/json, application/zip'
  };

  const zipFileName = `obsidian-notes-${Date.now()}.zip`;
  const zipFilePath = path.join(process.cwd(), 'temp', zipFileName);

  const output = fs.createWriteStream(zipFilePath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  output.on('close', () => {
    console.log(`${archive.pointer()} total bytes`);
    console.log('Archiver has been finalized and the output file descriptor has closed.');
  });

  archive.on('error', (err) => {
    throw err;
  });

  archive.pipe(output);

  // Add files to the zip
  for (const fileId of fileIds) {
    const filePath = path.join(process.cwd(), 'converted', `${fileId}.md`);
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: path.basename(filePath) });
    }
  }

  await archive.finalize();

  // Stream the file to the client
  const stat = fs.statSync(zipFilePath);
  const readStream = fs.createReadStream(zipFilePath);

  readStream.on('close', () => {
    fs.unlinkSync(zipFilePath); // Clean up the temporary zip file
  });

  return new Response(readStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipFileName}"`,
      'Content-Length': stat.size
    }
  });
}