/**
 * OpenAIProxyService Fix
 * 
 * This file provides a fix for the OpenAIProxyService that was failing with
 * "TypeError: axiosRetry is not a function" error.
 * 
 * The issue is that axios-retry v4.x.x exports differently than v3.x.x,
 * and the code was expecting the older version's export pattern.
 */

// Import the correct version of axios-retry
let axiosRetry;
try {
  // Try to import the module
  const axiosRetryModule = require('axios-retry');
  
  // Check if it's a function (v3.x.x) or an object with default export (v4.x.x)
  if (typeof axiosRetryModule === 'function') {
    // v3.x.x
    axiosRetry = axiosRetryModule;
  } else if (axiosRetryModule && typeof axiosRetryModule.default === 'function') {
    // v4.x.x
    axiosRetry = axiosRetryModule.default;
  } else {
    // Fallback implementation
    console.warn('⚠️ Could not load axios-retry properly, using fallback implementation');
    axiosRetry = (axios, options) => {
      console.log('Using fallback axios-retry implementation');
      // Simple fallback that doesn't actually retry but prevents errors
      return axios;
    };
  }
} catch (error) {
  console.error('❌ Failed to load axios-retry:', error);
  // Fallback implementation
  axiosRetry = (axios, options) => {
    console.log('Using fallback axios-retry implementation due to error:', error.message);
    return axios;
  };
}

// Export the fixed axiosRetry function
module.exports = axiosRetry;
