/**
 * Utility functions for file type handling that mirror frontend config
 */

const API_REQUIRED_TYPES = [
  'mp3', 'wav', 'ogg', 'm4a', 'mpga',
  'mp4', 'webm', 'avi', 'mov', 'mpeg'
];

const FILE_CATEGORIES = {
  documents: ['pdf', 'docx', 'pptx'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'wma'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
  data: ['csv', 'xlsx'],
};

export function requiresApiKey(fileType) {
  if (!fileType) return false;
  return API_REQUIRED_TYPES.includes(fileType.toLowerCase());
}

export function determineCategory(type, fileType) {
  // Normalize input
  const normalizedType = type?.toLowerCase();
  const normalizedFileType = fileType?.toLowerCase();

  // Handle presentation files
  if (normalizedFileType === 'pptx' || normalizedFileType === 'ppt') {
    return 'text';
  }
  
  // Audio types
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(fileType)) {
    return 'multimedia';
  }
  
  // Video types
  if (['mp4', 'webm', 'avi'].includes(fileType)) {
    return 'multimedia';
  }
  
  // Document types - add pptx explicitly
  if (['pdf', 'docx', 'pptx', 'ppt'].includes(fileType)) {
    return 'text';
  }
  
  // Data files
  if (['csv', 'xlsx', 'xls'].includes(fileType)) {
    return 'data';
  }
  
  // Web content
  if (['url', 'parenturl'].includes(type)) {
    return 'web';
  }
  
  // Default to text for unknown types
  return 'text';
}
