import { spawn } from 'node:child_process';
import { access, rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, parse } from 'node:path';

import { extractSubtitleStreams } from './media-subtitles.mjs';

function runAndCapture(command, args, { maxChars = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (stdout.length < maxChars) stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < maxChars) stderr += chunk;
    });
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else rejectPromise(new Error(`${command} exited with code ${code}: ${stderr.trim() || 'unknown error'}`));
    });
  });
}

export async function probeMedia(filePath) {
  const { stdout } = await runAndCapture('ffprobe', [
    '-v', 'error',
    '-show_entries',
    'format=format_name,duration,size:stream=index,codec_type,codec_name,profile,pix_fmt,width,height,channels,channel_layout',
    '-of', 'json',
    filePath
  ]);

  const payload = JSON.parse(stdout);
  const streams = Array.isArray(payload.streams) ? payload.streams : [];
  return {
    formatName: payload.format?.format_name || '',
    durationSeconds: Number(payload.format?.duration || 0),
    size: Number(payload.format?.size || 0),
    video: streams.find((stream) => stream.codec_type === 'video') || null,
    audio: streams.find((stream) => stream.codec_type === 'audio') || null
  };
}

export function assessChromeCompatibility(probe) {
  const containers = new Set(String(probe.formatName || '').split(',').filter(Boolean));
  const mp4Container = ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'].some((name) => containers.has(name));
  const videoReady = probe.video?.codec_name === 'h264'
    && ['yuv420p', 'yuvj420p'].includes(probe.video?.pix_fmt);
  const audioReady = !probe.audio || probe.audio.codec_name === 'aac';
  const ready = mp4Container && videoReady && audioReady;

  const reasons = [];
  if (!mp4Container) reasons.push('container will be remuxed to MP4');
  if (!videoReady) reasons.push('video will be converted to H.264 while keeping the source resolution');
  if (!audioReady) reasons.push(`audio will be converted from ${probe.audio?.codec_name || 'unknown'} to AAC`);

  return {
    ready,
    mp4Container,
    videoReady,
    audioReady,
    note: ready ? 'Ready for Chrome playback.' : reasons.join('; ')
  };
}

function makePaths(inputPath) {
  const parsed = parse(inputPath);
  const stamp = `${Date.now()}-${process.pid}`;
  const outputPath = extname(inputPath).toLowerCase() === '.mp4'
    ? inputPath
    : join(parsed.dir, `${parsed.name}.mp4`);
  const tempPath = join(parsed.dir, `.${parsed.name}.owc-processing-${stamp}.mp4`);
  const backupPath = join(parsed.dir, `.${basename(inputPath)}.owc-backup-${stamp}`);
  return { outputPath, tempPath, backupPath };
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runFfmpeg(inputPath, tempPath, probe, assessment, onProgress) {
  return new Promise((resolvePromise, rejectPromise) => {
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a:0?'
    ];

    if (assessment.videoReady) {
      args.push('-c:v', 'copy');
    } else {
      args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p');
    }

    if (!probe.audio) {
      args.push('-an');
    } else if (assessment.audioReady) {
      args.push('-c:a', 'copy');
    } else {
      const audioBitrate = Number(probe.audio.channels || 2) > 2 ? '384k' : '192k';
      args.push('-c:a', 'aac', '-b:a', audioBitrate);
    }

    args.push(
      '-map_metadata', '0',
      '-map_chapters', '0',
      '-movflags', '+faststart',
      '-progress', 'pipe:1',
      '-nostats',
      tempPath
    );

    const child = spawn('ffmpeg', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdoutBuffer = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const separator = line.indexOf('=');
        if (separator === -1) continue;
        const key = line.slice(0, separator);
        const value = line.slice(separator + 1);
        if (key === 'out_time_us' && probe.durationSeconds > 0) {
          const percent = Math.max(0, Math.min(99, Number(value) / 1_000_000 / probe.durationSeconds * 100));
          onProgress?.({ percent: Number(percent.toFixed(1)) });
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 2 * 1024 * 1024) stderr += chunk;
    });
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      if (code === 0) {
        onProgress?.({ percent: 99 });
        resolvePromise();
      } else {
        rejectPromise(new Error(`FFmpeg exited with code ${code}: ${stderr.trim() || 'unknown error'}`));
      }
    });
  });
}

async function replaceOriginal({ inputPath, outputPath, tempPath, backupPath }) {
  if (outputPath !== inputPath && await pathExists(outputPath)) {
    throw new Error(`Cannot replace the source because ${basename(outputPath)} already exists.`);
  }

  await rename(inputPath, backupPath);
  try {
    await rename(tempPath, outputPath);
    await rm(backupPath, { force: true });
  } catch (error) {
    if (await pathExists(outputPath)) await rm(outputPath, { force: true });
    await rename(backupPath, inputPath);
    throw error;
  }
}

export async function prepareMediaForChrome(inputPath, { onProgress } = {}) {
  const initialProbe = await probeMedia(inputPath);
  const initialAssessment = assessChromeCompatibility(initialProbe);

  if (initialAssessment.ready) {
    const subtitleResult = await extractSubtitleStreams(inputPath, { outputMediaPath: inputPath });
    return {
      changed: false,
      outputPath: inputPath,
      probe: initialProbe,
      assessment: initialAssessment,
      subtitleTracks: subtitleResult.tracks,
      subtitleStatus: subtitleResult.status
    };
  }

  const paths = makePaths(inputPath);
  await rm(paths.tempPath, { force: true });

  try {
    await runFfmpeg(inputPath, paths.tempPath, initialProbe, initialAssessment, onProgress);
    const outputProbe = await probeMedia(paths.tempPath);
    const outputAssessment = assessChromeCompatibility(outputProbe);
    if (!outputAssessment.ready) {
      throw new Error(`Prepared file did not pass compatibility verification: ${outputAssessment.note}`);
    }

    const subtitleResult = await extractSubtitleStreams(inputPath, {
      outputMediaPath: paths.outputPath
    });
    await replaceOriginal({ inputPath, ...paths });
    onProgress?.({ percent: 100 });

    return {
      changed: true,
      outputPath: paths.outputPath,
      probe: outputProbe,
      assessment: outputAssessment,
      subtitleTracks: subtitleResult.tracks,
      subtitleStatus: subtitleResult.status
    };
  } catch (error) {
    await rm(paths.tempPath, { force: true });
    throw error;
  }
}
