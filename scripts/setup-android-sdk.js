const fs = require('fs');
const path = require('path');
const { fetchUtils, util } = require('@bubblewrap/core');

const SDK_URL = 'https://dl.google.com/android/repository/commandlinetools-win-6609375_latest.zip';
const SDK_DIR = path.resolve(__dirname, '../.android-sdk');

async function main() {
  if (fs.existsSync(path.join(SDK_DIR, 'bin', 'sdkmanager.bat')) || fs.existsSync(path.join(SDK_DIR, 'tools', 'bin', 'sdkmanager.bat'))) {
    console.log('SDK already configured at', SDK_DIR);
    return;
  }
  await fs.promises.mkdir(SDK_DIR, { recursive: true });
  const zipPath = path.join(SDK_DIR, 'cmdline-tools.zip');
  console.log('Downloading Android SDK command line tools...');
  console.log('URL:', SDK_URL);
  await fetchUtils.downloadFile(SDK_URL, zipPath);
  console.log('Download complete. Unzipping...');
  const tempDir = path.join(SDK_DIR, 'temp');
  await fs.promises.mkdir(tempDir, { recursive: true });
  await util.unzipFile(zipPath, tempDir, true);
  const extracted = path.join(tempDir, 'cmdline-tools');
  const toolsDir = path.join(SDK_DIR, 'tools');
  if (fs.existsSync(extracted)) {
    await fs.promises.rename(extracted, toolsDir);
    await fs.promises.rmdir(tempDir);
    console.log('SDK configured at', SDK_DIR);
  } else {
    console.error('Could not find extracted cmdline-tools directory');
    process.exit(1);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
