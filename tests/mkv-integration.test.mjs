import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assessChromeCompatibility,
  prepareMediaForChrome,
  probeMedia
} from '../src/media-compatibility.mjs';

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test('one-click preparation converts a real MKV into a verified same-name MP4', async (context) => {
  const versionCheck = spawnSync('ffmpeg', ['-version'], { windowsHide: true });
  if (versionCheck.status !== 0) {
    context.skip('FFmpeg is unavailable in this environment.');
    return;
  }

  const root = await mkdtemp(join(tmpdir(), 'open-watch-cinema-mkv-'));
  const inputPath = join(root, 'sample.mkv');
  const outputPath = join(root, 'sample.mp4');

  try {
    const generated = spawnSync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=320x180:r=24:d=1',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=1',
      '-shortest',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      inputPath
    ], { windowsHide: true, encoding: 'utf8' });

    assert.equal(generated.status, 0, generated.stderr || 'Could not generate MKV fixture.');

    const result = await prepareMediaForChrome(inputPath);
    assert.equal(result.changed, true);
    assert.equal(result.outputPath, outputPath);
    assert.equal(await exists(inputPath), false);
    assert.equal(await exists(outputPath), true);

    const finalProbe = await probeMedia(outputPath);
    assert.equal(assessChromeCompatibility(finalProbe).ready, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
