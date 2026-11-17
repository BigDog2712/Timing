import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { archiveApkName, expectedApkName, run, signingCommand } from './android-sign.mjs';

describe('Android APK archive naming', () => {
  it('uses the manifest version and selected ABI/variant', () => {
    assert.equal(expectedApkName('arm64-v8a', 'release'), 'app-arm64-release.apk');
    assert.equal(expectedApkName('armeabi-v7a', 'debug'), 'app-arm-debug.apk');
    assert.equal(archiveApkName('0.12.8', 'x86_64', 'debug', 'debugsigned'), 'Timing-android-0.12.8-debug-x86_64-debugsigned.apk');
  });

  it('rejects unsupported versions and ABI values', () => {
    assert.throws(() => archiveApkName('0.12', 'arm64-v8a', 'release', 'signed'), /versionName/);
    assert.throws(() => expectedApkName('mips', 'release'), /变体/);
  });
});

describe('Android APK signing secrets', () => {
  const keystore = { storeFile: 'release.jks', storePassword: 'store-secret', keyAlias: 'timing', keyPassword: 'key-secret' };

  it('passes passwords through the child environment instead of argv', () => {
    const { args, options } = signingCommand('apksigner.jar', keystore, 'in.apk', 'out.apk');
    assert.ok(!args.join(' ').includes('secret'));
    assert.equal(options.env.TIMING_APK_STORE_PASSWORD, 'store-secret');
    assert.equal(options.env.TIMING_APK_KEY_PASSWORD, 'key-secret');
  });

  it('does not echo arguments when a command fails', () => {
    assert.throws(
      () => run(process.execPath, ['-e', 'process.exit(3)', 'pass:leaked'], { stdio: 'ignore' }),
      (error) => /exit 3/.test(error.message) && !error.message.includes('leaked'),
    );
  });
});
