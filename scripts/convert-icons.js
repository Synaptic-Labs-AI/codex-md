/**
 * convert-icons.js
 * 
 * This script converts PNG icons to ICO format for use with NSIS installer
 * It uses the 'png-to-ico' package to perform the conversion
 */

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

// Paths
const SOURCE_ICON = path.join(process.cwd(), 'frontend', 'static', 'app-icon.png');
const TARGET_ICON = path.join(process.cwd(), 'build', 'icons', 'icon.ico');

/**
 * Ensures the build/icons directory exists
 */
async function ensureIconsDir() {
  const iconsDir = path.dirname(TARGET_ICON);
  await fs.ensureDir(iconsDir);
  console.log(`✅ Created directory: ${iconsDir}`);
}

/**
 * Converts PNG to ICO using png-to-ico
 */
async function convertIcon() {
  console.log('🔄 Converting PNG icon to ICO format...');
  
  try {
    // Check if source icon exists
    if (!await fs.pathExists(SOURCE_ICON)) {
      console.error(`❌ Source icon not found: ${SOURCE_ICON}`);
      process.exit(1);
    }
    
    // Ensure png-to-ico is installed
    try {
      execSync('npm list png-to-ico', { stdio: 'ignore' });
    } catch (error) {
      console.log('📦 Installing png-to-ico...');
      execSync('npm install png-to-ico --no-save', { stdio: 'inherit' });
    }
    
    // Create a temporary conversion script
    const tempScriptPath = path.join(process.cwd(), 'temp-convert.js');
    const scriptContent = `
      const fs = require('fs');
      const pngToIco = require('png-to-ico');
      
      pngToIco('${SOURCE_ICON.replace(/\\/g, '\\\\')}')
        .then(buf => {
          fs.writeFileSync('${TARGET_ICON.replace(/\\/g, '\\\\')}', buf);
          console.log('✅ Icon converted successfully');
        })
        .catch(err => {
          console.error('❌ Error converting icon:', err);
          process.exit(1);
        });
    `;
    
    await fs.writeFile(tempScriptPath, scriptContent);
    
    // Run the conversion script
    execSync(`node ${tempScriptPath}`, { stdio: 'inherit' });
    
    // Clean up the temporary script
    await fs.remove(tempScriptPath);
    
    // Verify the icon was created
    if (await fs.pathExists(TARGET_ICON)) {
      console.log(`✅ Icon converted and saved to: ${TARGET_ICON}`);
    } else {
      console.error(`❌ Failed to create icon at: ${TARGET_ICON}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error during icon conversion:', error);
    process.exit(1);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Starting icon conversion...');
  
  await ensureIconsDir();
  await convertIcon();
  
  console.log('✨ Icon conversion completed successfully');
}

// Run the script
main().catch(err => {
  console.error('❌ Fatal error during icon conversion:', err);
  process.exit(1);
});
