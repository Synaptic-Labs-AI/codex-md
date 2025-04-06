// src/lib/stores/files.js
/**
 * Files Store
 *
 * Manages the state of files in the application.
 * Modified to support single file conversion only.
 * Multi-selection functionality has been commented out.
 */

import { writable, derived } from 'svelte/store';
import { v4 as uuidv4 } from 'uuid';
import { requiresApiKey } from '@codex-md/shared/utils/files';
import { browser } from '$app/environment';

// Create and export the stores
export const files = createFilesStore();

// Clear any stored files data on page load
if (browser) {
    // Clear any stored files data
    localStorage.removeItem('codex_md_files');
    sessionStorage.removeItem('codex_md_files');
}
export const currentFileType = derived(files, $files => {
    const activeFile = $files[0];
    if (!activeFile) return null;
    return activeFile.name.split('.').pop().toLowerCase();
});

/**
 * File status enumeration
 */
export const FileStatus = {
    READY: 'ready',
    UPLOADING: 'uploading',
    CONVERTING: 'converting',
    COMPLETED: 'completed',
    ERROR: 'error'
};

/**
 * Utility functions for file operations
 */
const FileUtils = {
    /**
     * Creates a standardized result object
     */
    createResult(success, message, data = null) {
        return { success, message, file: data };
    },

    /**
     * Creates a standardized file object
     */
    createFileObject(file) {
        // Handle file path (string) from Electron or File object from web
        const isFilePath = typeof file === 'string';
        const fileName = isFilePath ? file.split(/[/\\]/).pop() : file.name;
        const extension = fileName?.split('.').pop()?.toLowerCase();
        
        return {
            id: uuidv4(),
            name: fileName,
            type: file.type || extension || 'unknown',  // Ensure type is set from extension if not provided
            size: isFilePath ? 0 : (file.size || 0),  // Size will be determined by Electron for file paths
            url: file.url || null,
            file: isFilePath ? null : (file.file || file),  // Store File object for web files
            path: isFilePath ? file : (file.path || null),  // Store path for native files
            status: FileStatus.READY,
            progress: 0,
            error: null,
            selected: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            requiresApiKey: requiresApiKey(isFilePath ? { type: extension } : file),
            isNative: isFilePath,  // Flag to indicate if this is a native file path
            ...file  // Allow override but after setting defaults
        };
    },

    /**
     * Checks for duplicate files considering URL and type
     * For URLs, we only consider them duplicate if they have the same type (parent/single)
     */
    isDuplicate(files, newFile) {
        return files.some(f => {
            // For URL-based files
            if (f.url && newFile.url) {
                return f.url === newFile.url && f.type === newFile.type;
            }
            
            // For native file paths
            if (f.path && newFile.path) {
                return f.path === newFile.path;
            }
            
            // For regular files
            return f.name && newFile.name && f.name === newFile.name && f.type === newFile.type;
        });
    },

    /**
     * Updates a file's timestamp
     */
    withTimestamp(file) {
        return {
            ...file,
            updatedAt: new Date().toISOString()
        };
    }
};

/**
 * Creates a store action with standard error handling
 */
function createAction(name, handler) {
    return (...args) => {
        try {
            return handler(...args);
        } catch (error) {
            console.error(`📁 Error in ${name}:`, error);
            return FileUtils.createResult(false, error.message);
        }
    };
}

/**
 * Creates and returns the files store
 */
function createFilesStore() {
    const { subscribe, update, set } = writable([], (set) => {
        // Cleanup function that runs when all subscribers unsubscribe
        return () => {
            set([]); // Clear the store
            if (browser) {
                // Clear any stored data
                localStorage.removeItem('codex_md_files');
                sessionStorage.removeItem('codex_md_files');
            }
        };
    });

    function hasFile(url) {
        let found = false;
        update(files => {
            found = files.some(file => file.url === url);
            console.log('Checking if file exists with URL:', url, 'Found:', found);
            return files;
        });
        return found;
    }

    /**
     * Updates files and returns a result
     */
    function updateFiles(updater, successMsg) {
        let result;
        update(files => {
            const updated = updater(files);
            result = updated.result;
            console.log('Files updated:', updated.files);
            return updated.files;
        });
        return result;
    }

    return {
        subscribe,

        /**
         * Adds a file to the store
         */
        /**
         * Adds a file to the store
         * Modified to only allow one item at a time (either file OR URL)
         */
        addFile: createAction('addFile', (file) => {
            const newFile = FileUtils.createFileObject(file);
            console.log('[filesStore] Attempting to add file:', newFile);
            
            return updateFiles(files => {
                // If there are existing files, clear them before adding the new one
                if (files.length > 0) {
                    console.log('[filesStore] Clearing existing files before adding new one');
                    // We could add additional logic here to check if the existing item is a URL or file
                    // and provide more specific messaging, but for now we'll just replace it
                }

                // Special handling for parent URLs - this is kept for future use but will rarely be triggered
                // since we're now enforcing single item limit
                if (newFile.type === 'parent') {
                    const existingFile = files.find(f =>
                        f.url === newFile.url && f.type === 'url'
                    );
                    if (existingFile) {
                        console.log('[filesStore] Converting single URL to parent:', existingFile.name);
                        return {
                            files: [{...existingFile, type: 'parent', name: `${existingFile.name} (Parent)`}],
                            result: FileUtils.createResult(true,
                                'URL converted to parent successfully'
                            )
                        };
                    }
                }

                // Handle duplicates silently
                if (FileUtils.isDuplicate(files, newFile)) {
                    console.log('[filesStore] Duplicate URL detected - ignoring:', newFile.name);
                    return {
                        files,
                        result: FileUtils.createResult(true,
                            'URL processed successfully'
                        )
                    };
                }

                console.log('[filesStore] Adding file:', newFile);
                return {
                    files: [newFile], // Replace all files with just the new one
                    result: FileUtils.createResult(true,
                        `Added "${newFile.name}" successfully`,
                        newFile
                    )
                };
            });
        }),

        /**
         * Updates a file in the store
         */
        updateFile: createAction('updateFile', (id, data) => {
            console.log('[filesStore] Updating file with ID:', id, 'Data:', data);
            return updateFiles(files => {
                const index = files.findIndex(f => f.id === id);
                if (index === -1) {
                    console.log('[filesStore] File not found for update:', id);
                    return {
                        files,
                        result: FileUtils.createResult(false, 'File not found')
                    };
                }

                const updatedFile = FileUtils.withTimestamp({
                    ...files[index],
                    ...data
                });

                const updatedFiles = [...files];
                updatedFiles[index] = updatedFile;

                console.log('[filesStore] Updated file:', updatedFile);
                return {
                    files: updatedFiles,
                    result: FileUtils.createResult(true, 
                        'File updated successfully', 
                        updatedFile
                    )
                };
            });
        }),

        /**
         * Removes a file from the store
         */
        removeFile: createAction('removeFile', (id) => {
            console.log('[filesStore] Removing file with ID:', id);
            return updateFiles(files => {
                const fileToRemove = files.find(f => f.id === id);
                if (!fileToRemove) {
                    console.log('[filesStore] File not found for removal:', id);
                    return {
                        files,
                        result: FileUtils.createResult(false, 
                            `File with ID "${id}" not found`
                        )
                    };
                }

                console.log('[filesStore] Removing file:', fileToRemove);
                return {
                    files: files.filter(f => f.id !== id),
                    result: FileUtils.createResult(true, 
                        `Removed "${fileToRemove.name}" successfully`, 
                        fileToRemove
                    )
                };
            });
        }),

        /**
         * File selection methods have been commented out since we no longer need multi-selection
         * functionality in the single file conversion mode.
         */
        
        /*
        // Commented out: No longer needed for single file conversion
        toggleSelect: createAction('toggleSelect', (id) => {
            console.log('[filesStore] Toggling selection for file ID:', id);
            return updateFiles(files => {
                const index = files.findIndex(f => f.id === id);
                if (index === -1) {
                    console.log('[filesStore] File not found for toggle:', id);
                    return {
                        files,
                        result: FileUtils.createResult(false, 'File not found')
                    };
                }

                const updatedFiles = [...files];
                updatedFiles[index] = FileUtils.withTimestamp({
                    ...files[index],
                    selected: !files[index].selected
                });

                console.log('[filesStore] Toggled selection for file:', updatedFiles[index]);
                return {
                    files: updatedFiles,
                    result: FileUtils.createResult(true,
                        'Selection toggled successfully',
                        updatedFiles[index]
                    )
                };
            });
        }),

        // Commented out: No longer needed for single file conversion
        selectAll: createAction('selectAll', (select = true) => {
            console.log('[filesStore] Selecting all files:', select);
            let count = 0;
            return updateFiles(files => {
                const updatedFiles = files.map(file => {
                    if (file.selected !== select) {
                        count++;
                        return FileUtils.withTimestamp({
                            ...file,
                            selected: select
                        });
                    }
                    return file;
                });

                console.log('[filesStore] Selected/Deselected', count, 'files');
                return {
                    files: updatedFiles,
                    result: {
                        success: true,
                        message: `${select ? 'Selected' : 'Deselected'} ${count} files`,
                        count
                    }
                };
            });
        }),

        // Commented out: No longer needed for single file conversion
        getSelectedFiles() {
            console.log('[filesStore] Retrieving selected files');
            let selected = [];
            update(files => {
                selected = files.filter(f => f.selected);
                console.log('[filesStore] Selected files:', selected);
                return files;
            });
            return selected;
        },
        */

        /**
         * Clears all files from the store
         */
        clearFiles: createAction('clearFiles', () => {
            console.log('[filesStore] Clearing all files');
            let count = 0;
            if (browser) {
                // Clear any stored data
                localStorage.removeItem('codex_md_files');
                sessionStorage.removeItem('codex_md_files');
            }
            return updateFiles(files => {
                count = files.length;
                console.log('[filesStore] Clearing', count, 'files');
                return {
                    files: [],
                    result: {
                        success: true,
                        message: `Cleared ${count} files`,
                        count
                    }
                };
            });
        })
    };
}
