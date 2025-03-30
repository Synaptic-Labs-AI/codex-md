// routes/middleware/validators.js

import { body, validationResult } from 'express-validator';
import { AppError } from '../../utils/errorHandler.js';
import { config } from '../../config/default.js';

/**
 * Normalizes a URL by adding https:// if missing
 */
const normalizeUrl = (url) => {
    if (!url) return url;
    const trimmed = url.trim().replace(/\s+/g, '');
    return !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
};

/**
 * Validates URL format
 */
const validateUrl = (url) => {
    try {
        new URL(normalizeUrl(url));
        return true;
    } catch (error) {
        throw new Error('Invalid URL format');
    }
};

/**
 * Validation result checker
 */
const checkResult = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
      console.log('Validation Failures:', {
          body: req.body,
          errors: errors.array()
      });
      
      return next(new AppError('Validation failed', 400, {
          errors: errors.array().map(err => ({
              field: err.param,
              message: err.msg,
              value: err.value,
              location: err.location
          }))
      }));
  }
  next();
};

// Export validators object with all validation rules
const validators = {
    // File validation
    file: [
        body('fileType')
            .optional()
            .isString()
            .withMessage('fileType must be a string')
            .custom((value) => {
                if (value && !config.conversion.allowedFileTypes.includes(value.toLowerCase())) {
                    throw new Error(
                        `Unsupported file type. Allowed types: ${config.conversion.allowedFileTypes.join(', ')}`
                    );
                }
                return true;
            })
    ],

    // URL validation
    url: [
      body('url')
          .exists()
          .withMessage('URL is required')
          .notEmpty()
          .withMessage('URL cannot be empty')
          .isString()
          .withMessage('URL must be a string')
          .customSanitizer(url => {
              // Match frontend normalization
              const trimmed = url.trim().replace(/\s+/g, '');
              return !/^https?:\/\//i.test(trimmed) ? 
                  `https://${trimmed}` : trimmed;
          })
          .custom((url) => {
              try {
                  new URL(url);
                  return true;
              } catch (error) {
                  throw new Error('Invalid URL format');
              }
          })
  ],


    // Parent URL validation
    parenturl: [
        body('parenturl')
            .trim()
            .notEmpty()
            .withMessage('Parent URL is required')
            .isString()
            .withMessage('Parent URL must be a string')
            .customSanitizer(normalizeUrl)
            .custom(validateUrl)
    ],

    // Batch validation
    batch: [
        body('items')
            .custom((value, { req }) => {
                // Handle string JSON input
                try {
                    const items = typeof value === 'string' ? JSON.parse(value) : value;
                    
                    // Validate items array if present
                    if (value !== undefined && value !== '') {
                        if (!Array.isArray(items)) {
                            throw new Error('Items must be an array');
                        }
                    }

                    // Get total files from both single and batch fields
                    const files = req.files || {};
                    const totalFiles = [
                        ...(files.file || []),
                        ...(files.files || [])
                    ].length;

                    // Check if we have any items to process
                    if ((items?.length || 0) === 0 && totalFiles === 0) {
                        throw new Error('No items provided for conversion');
                    }

                    console.log('🔍 Validating batch request:', {
                        itemsCount: items?.length || 0,
                        filesCount: totalFiles,
                        hasFiles: totalFiles > 0,
                        hasItems: items?.length > 0
                    });

                    // Store parsed items for later use
                    req.parsedItems = items || [];
                    return true;
                } catch (error) {
                    throw new Error(`Invalid items format: ${error.message}`);
                }
            }),
        body('items.*.type')
            .optional()
            .isString()
            .isIn(['file', 'url', 'parenturl', 'pptx', 'pdf', 'docx', 'csv', 'xlsx'])
            .withMessage('Invalid item type. Supported types: file, url, parenturl, pptx, pdf, docx, csv, xlsx'),
        body('items.*.url')
            .optional()
            .custom((value, { req }) => {
                const item = req.body.items[req._validationData.index];
                if (['url', 'parenturl'].includes(item.type)) {
                    if (!value) {
                        throw new Error(`URL is required for type: ${item.type}`);
                    }
                    try {
                        new URL(normalizeUrl(value));
                    } catch (error) {
                        throw new Error('Invalid URL format');
                    }
                }
                return true;
            }),
        body('items.*.options')
            .optional()
            .custom((value) => {
                if (value) {
                    try {
                        if (typeof value === 'string') {
                            JSON.parse(value);
                        } else if (typeof value !== 'object') {
                            throw new Error('Options must be an object or JSON string');
                        }
                    } catch (error) {
                        throw new Error('Invalid options format');
                    }
                }
                return true;
            })
    ],

    // Export the result checker
    checkResult
};

export const validateConversion = (req, res, next) => {
    const validationType = req.path.split('/').pop();
    const validationChain = validators[validationType] || validators.file;
    
    Promise.all(validationChain.map(validation => validation.run(req)))
        .then(() => validators.checkResult(req, res, next))
        .catch(next);
};

// Export both validators and validateConversion
export { validators };
