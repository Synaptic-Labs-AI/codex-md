# API Key Integration Phase

## Secure Storage Implementation
> "The electron-store module with encryption can be used to securely store sensitive data in the user's local system."

1. **Secure Store Setup (electron/features/secure-store.js)**
   ```javascript
   const Store = require('electron-store');
   const crypto = require('crypto');

   class SecureStore {
     constructor() {
       this.store = new Store({
         name: 'secure-config',
         encryptionKey: this.getEncryptionKey(),
         clearInvalidConfig: true
       });
     }

     getEncryptionKey() {
       // Use machine-specific data to generate a stable encryption key
       const machineId = crypto
         .createHash('sha256')
         .update(process.env.COMPUTERNAME || process.env.HOSTNAME)
         .digest('hex');
       return machineId;
     }

     async saveApiKey(key) {
       try {
         // Validate API key format
         if (!this.isValidApiKey(key)) {
           throw new Error('Invalid API key format');
         }
         
         await this.store.set('openai-api-key', key);
         return { success: true };
       } catch (error) {
         console.error('Error saving API key:', error);
         return { success: false, error: error.message };
       }
     }

     getApiKey() {
       return this.store.get('openai-api-key');
     }

     isValidApiKey(key) {
       return /^sk-[A-Za-z0-9]{32,}$/.test(key);
     }
   }
   ```

2. **IPC Handler Setup (electron/ipc/handlers/api-key.js)**
   ```javascript
   const { ipcMain } = require('electron');
   const SecureStore = require('../features/secure-store');

   class ApiKeyHandler {
     constructor() {
       this.secureStore = new SecureStore();
       this.setupHandlers();
     }

     setupHandlers() {
       ipcMain.handle('mdcode:api-key:save', async (event, key) => {
         return await this.secureStore.saveApiKey(key);
       });

       ipcMain.handle('mdcode:api-key:get', async () => {
         const key = await this.secureStore.getApiKey();
         return key ? { exists: true } : { exists: false };
       });

       ipcMain.handle('mdcode:api-key:validate', async (event, key) => {
         // Test the API key with a minimal OpenAI API call
         try {
           // Simple validation request
           const response = await fetch('https://api.openai.com/v1/models', {
             headers: {
               'Authorization': `Bearer ${key}`
             }
           });
           
           return { 
             valid: response.ok,
             error: response.ok ? null : 'Invalid API key'
           };
         } catch (error) {
           return { 
             valid: false, 
             error: 'Network error during validation'
           };
         }
       });
     }
   }
   ```

## Frontend Integration

1. **API Key Settings Component (frontend/src/lib/components/settings/ApiKeySettings.svelte)**
   ```svelte
   <script lang="ts">
     import { onMount } from 'svelte';
     import { apiKey } from '$lib/stores/apiKey';
     
     let key = '';
     let saving = false;
     let error = '';
     let hasExistingKey = false;

     onMount(async () => {
       const result = await window.electronAPI.getApiKey();
       hasExistingKey = result.exists;
     });

     async function saveApiKey() {
       saving = true;
       error = '';
       
       try {
         // Validate key format
         if (!key.startsWith('sk-')) {
           throw new Error('Invalid API key format');
         }

         // Validate with API
         const validation = await window.electronAPI.validateApiKey(key);
         if (!validation.valid) {
           throw new Error(validation.error);
         }

         // Save key
         const result = await window.electronAPI.saveApiKey(key);
         if (!result.success) {
           throw new Error(result.error);
         }

         // Update store
         apiKey.set(key);
         hasExistingKey = true;
         key = '';
       } catch (e) {
         error = e.message;
       } finally {
         saving = false;
       }
     }
   </script>

   <div class="api-key-settings">
     <h2>OpenAI API Key</h2>
     
     {#if hasExistingKey}
       <p class="success">✓ API key is configured</p>
     {/if}

     <div class="input-group">
       <input
         type="password"
         placeholder="sk-..."
         bind:value={key}
         class:error={!!error}
       />
       <button
         on:click={saveApiKey}
         disabled={saving || !key}
       >
         {saving ? 'Saving...' : 'Save API Key'}
       </button>
     </div>

     {#if error}
       <p class="error-message">{error}</p>
     {/if}

     <p class="info">
       Your API key is stored securely on your device and is only used
       for transcription services. The key is never transmitted to our servers.
     </p>
   </div>

   <style>
     .api-key-settings {
       padding: 1rem;
       border-radius: 4px;
       background: var(--background-secondary);
     }

     .input-group {
       display: flex;
       gap: 0.5rem;
       margin: 1rem 0;
     }

     input {
       flex: 1;
       padding: 0.5rem;
       border: 1px solid var(--border);
       border-radius: 4px;
     }

     input.error {
       border-color: var(--error);
     }

     .error-message {
       color: var(--error);
       font-size: 0.9rem;
       margin-top: 0.5rem;
     }

     .success {
       color: var(--success);
       font-weight: 500;
     }

     .info {
       font-size: 0.9rem;
       color: var(--text-secondary);
       margin-top: 1rem;
     }
   </style>
   ```

2. **API Key Store (frontend/src/lib/stores/apiKey.ts)**
   ```typescript
   import { writable } from 'svelte/store';

   function createApiKeyStore() {
     const { subscribe, set } = writable<string | null>(null);

     return {
       subscribe,
       set,
       async initialize() {
         const result = await window.electronAPI.getApiKey();
         if (result.exists) {
           set('configured');
         }
       }
     };
   }

   export const apiKey = createApiKeyStore();
   ```

## Integration with Transcription Service

1. **Update TranscriptionService (backend/src/services/transcriber.js)**
   ```javascript
   class TranscriptionService {
     async transcribe(audioPath) {
       const apiKey = await secureStore.getApiKey();
       if (!apiKey) {
         throw new Error('OpenAI API key not configured');
       }

       // Use API key for transcription
       const formData = new FormData();
       formData.append('file', fs.createReadStream(audioPath));
       formData.append('model', 'whisper-1');

       const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
         method: 'POST',
         headers: {
           'Authorization': `Bearer ${apiKey}`
         },
         body: formData
       });

       if (!response.ok) {
         throw new Error('Transcription failed');
       }

       return await response.json();
     }
   }
   ```

## Security Considerations

1. **Key Storage**
   - API keys are encrypted at rest using machine-specific encryption
   - Keys are only stored locally
   - Access is restricted to the application process

2. **Usage**
   - Keys are only used for OpenAI API calls
   - No external transmission except to OpenAI
   - Validation before storage

## Implementation Notes

1. **Setup**
   - Install required dependencies:
     ```bash
     npm install electron-store crypto-js
     ```
   
2. **Testing**
   - Verify secure storage encryption
   - Test API key validation
   - Verify transcription functionality
   - Check error handling

3. **User Experience**
   - Clear error messages
   - Secure input handling
   - Status indicators
   - Easy key management
