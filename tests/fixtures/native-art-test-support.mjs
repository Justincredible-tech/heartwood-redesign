import { existsSync } from 'node:fs';

export const NATIVE_ART_TEST_FILES = [
  'art-restore-no-replace.test.mjs',
  'public-art-epoch.native.test.mjs',
  'public-art-lifecycle.test.mjs',
  'review-build-paths.native.test.mjs'
];

export const NATIVE_TOOLCHAIN_TEST_FILES = [ 'public-art-toolchain.test.mjs' ];

export function nativeArtTestState({
  requested = process.env.HW_RUN_NATIVE_ART_TESTS === '1',
  platform = process.platform,
  compilerExists = existsSync('/usr/bin/cc')
} = {}) {
  if (!requested) return {
    enabled: false,
    reason: 'Optional native art checks not requested; use test:native-art.'
  };
  if (platform !== 'darwin') {
    throw Error('UNSUPPORTED: optional native art ownership currently requires macOS; ' +
      'default public tests remain portable.');
  }
  if (!compilerExists) throw Error('Optional native art checks require the installed macOS command-line C compiler.');
  return {
    enabled: true,
    reason: null
  };
}

export function nativeToolchainTestState({
  requested = process.env.HW_RUN_NATIVE_ART_TOOLCHAIN_TESTS === '1',
  platform = process.platform,
  compilerExists = existsSync('/usr/bin/cc'),
  sharpModule = process.env.HW_ART_SHARP_MODULE,
  playwrightModule = process.env.HW_ART_PLAYWRIGHT_MODULE
} = {}) {
  if (!requested) {
    return {
      enabled: false,
      reason: 'Optional installed encoder checks not requested; use test:native-art-toolchain.'
    };
  }
  nativeArtTestState({
    requested: true,
    platform: platform,
    compilerExists: compilerExists
  });
  if (!sharpModule || !playwrightModule) {
    throw Error('Optional encoder checks require explicit installed HW_ART_SHARP_MODULE and HW_ART_PLAYWRIGHT_MODULE.');
  }
  return {
    enabled: true,
    reason: null
  };
}
