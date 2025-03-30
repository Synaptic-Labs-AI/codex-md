/**
 * src/lib/utils/iconUtils.js
 */

/**
 * Comprehensive icon configuration object
 */
export const FILE_ICONS = {
  // Documents
  txt: { icon: '📄', color: '#4A90E2', label: 'Text Document' },
  pdf: { icon: '📕', color: '#E24A4A', label: 'PDF Document' },
  doc: { icon: '📘', color: '#4A90E2', label: 'Word Document' },
  docx: { icon: '📘', color: '#4A90E2', label: 'Word Document' },

  // Data Files
  csv: { icon: '📊', color: '#4AE266', label: 'CSV File' },
  xlsx: { icon: '📈', color: '#4AE266', label: 'Excel Spreadsheet' },
  pptx: { icon: '📊', color: '#E24A4A', label: 'PowerPoint Presentation' },

  // Audio
  audio: { icon: '🎵', color: '#9E4AE2', label: 'Audio File' },
  mp3: { icon: '🎵', color: '#9E4AE2', label: 'Audio File' },
  wav: { icon: '🎵', color: '#9E4AE2', label: 'Audio File' },
  ogg: { icon: '🎵', color: '#9E4AE2', label: 'Audio File' },
  m4a: { icon: '🎵', color: '#9E4AE2', label: 'Audio File' },
  aac: { icon: '🎵', color: '#9E4AE2', label: 'Audio File' },
  wma: { icon: '🎵', color: '#9E4AE2', label: 'Audio File' },
  mpga: { icon: '🎵', color: '#9E4AE2', label: 'Audio File' },

  // Video
  video: { icon: '🎥', color: '#E24A4A', label: 'Video File' },
  mp4: { icon: '🎥', color: '#E24A4A', label: 'Video File' },
  webm: { icon: '🎥', color: '#E24A4A', label: 'Video File' },
  avi: { icon: '🎥', color: '#E24A4A', label: 'Video File' },
  mov: { icon: '🎥', color: '#E24A4A', label: 'Video File' },
  mpeg: { icon: '🎥', color: '#E24A4A', label: 'Video File' },
  mkv: { icon: '🎥', color: '#E24A4A', label: 'Video File' },

  // Special Types
  url: { icon: '🔗', color: '#4AE2B5', label: 'URL Link' },
  parenturl: { icon: '🗺️', color: '#9E4AE2', label: 'Parent URL' },
  // youtube: { icon: '▶️', color: '#E24A4A', label: 'YouTube Video' },

  // Default Fallback
  default: { icon: '🗎', color: '#B8B8B8', label: 'File' }
};

/**
 * Common MIME types mapped to extensions
 * Expand this map as needed
 */
const MIME_TYPE_MAP = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/x-ms-wma': 'wma',
  'audio/mpa': 'mpga',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/x-msvideo': 'avi',
  'video/quicktime': 'mov',
  'video/mpeg': 'mpeg',
  'video/x-matroska': 'mkv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/pdf': 'pdf',
  'application/vnd.ms-excel': 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'application/csv': 'csv',
  // Add more MIME types as needed
};

/**
 * Returns the icon configuration for a given file type or extension.
 *
 * @param {string} type - The file type, extension, or possibly a MIME type.
 * @returns {Object} Icon configuration object
 */
export function getFileIconConfig(type) {
  console.log('Getting icon config for type:', type);

  if (!type) {
    console.log('No type provided, using default');
    return FILE_ICONS.default;
  }

  let normalized = type.toLowerCase();
  console.log('Normalized type:', normalized);

  // If it's a known MIME type, map it to the extension first
  if (MIME_TYPE_MAP[normalized]) {
    normalized = MIME_TYPE_MAP[normalized];
    console.log('Mapped MIME type to:', normalized);
  }

  // Remove any leading '.' (e.g., '.pdf' -> 'pdf')
  normalized = normalized.replace(/^\.*/, '');

  // Direct lookup first
  if (FILE_ICONS[normalized]) {
    console.log('Found direct icon match:', FILE_ICONS[normalized].icon);
    return FILE_ICONS[normalized];
  }

  // Try base type
  const baseType = getBaseFileType(normalized);
  if (baseType && FILE_ICONS[baseType]) {
    console.log('Found base type match:', FILE_ICONS[baseType].icon);
    return FILE_ICONS[baseType];
  }

  console.log('No match found, using default');
  return FILE_ICONS.default;
}

/**
 * Maps an extension to a base file type category (audio, video, etc.)
 *
 * @param {string} extension - File extension
 * @returns {string|null} Base file type or null
 */
function getBaseFileType(extension) {
  const typeMap = {
    audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'wma', 'mpga'],
    video: ['mp4', 'webm', 'avi', 'mov', 'mpeg', 'mkv'],
    data: ['csv', 'xlsx', 'xls', 'json', 'yaml', 'yml'] // Added data types
  };

  // Ensure lowercase comparison
  extension = extension.toLowerCase();
  
  for (const [type, extensions] of Object.entries(typeMap)) {
    if (extensions.includes(extension)) {
      return type;
    }
  }
  return null;
}

/**
 * Convenience function that returns only the icon character
 *
 * @param {string} type - The file type, extension, or MIME type
 * @returns {string} The emoji icon
 */
export function getFileIcon(type) {
  return getFileIconConfig(type).icon;
}

/**
 * Additional utility to get full icon config (if needed)
 *
 * @param {string} type
 * @returns {Object} Icon configuration object
 */
export function getFileIconFullConfig(type) {
  return getFileIconConfig(type);
}
