// electron-builder afterPack hook
// 1) Strip existing signatures from all binaries/bundles. Electron ships
//    its binaries already signed by the Electron team — when we re-sign,
//    codesign sees the old signature's metadata as "detritus" and fails.
//    --remove-signature wipes it cleanly first.
// 2) Strip xattrs, resource forks, AppleDouble files, etc.
const { execSync } = require('child_process');
const path = require('path');

function run(cmd, failOk = true) {
  try {
    execSync(cmd, { stdio: 'pipe' });
  } catch (e) {
    if (failOk) {
      // Best-effort cleanup — most files don't have signatures so --remove-signature fails on them
    } else {
      console.warn(`[afterPack] ${cmd.slice(0, 80)}... → ${e.message.split('\n')[0]}`);
    }
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  console.log(`[afterPack] Pre-clean: stripping old signatures + xattrs from ${appPath}`);

  // Step 1: remove all existing signatures so codesign can re-sign cleanly.
  // The "deep" recursion catches helper bundles, frameworks, and nested apps.
  run(`codesign --remove-signature --deep "${appPath}"`, true);
  // Also explicitly hit each .app and .framework bundle inside Frameworks/
  run(`find "${appPath}" -type d \\( -name "*.app" -o -name "*.framework" \\) -exec codesign --remove-signature {} \\;`, true);
  // And each mach-o binary inside helpers (in case --deep missed any)
  run(`find "${appPath}/Contents/Frameworks" -type f -perm +111 -exec codesign --remove-signature {} \\; 2>/dev/null`, true);

  // Step 2: strip xattrs and Finder cruft
  run(`xattr -cr "${appPath}"`, true);
  run(`dot_clean -m "${appPath}"`, true);
  run(`find "${appPath}" -type f -exec xattr -c {} +`, true);
  run(`find "${appPath}" -name ".DS_Store" -delete`, true);
  run(`find "${appPath}" -name "._*" -delete`, true);

  console.log(`[afterPack] Done — codesign can now sign from scratch`);
};
