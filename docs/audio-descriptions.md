# Local audio descriptions

Audio descriptions accompany the existing dialogue, visual, and motion tracks in each AI tick. The film is analyzed locally during preparation; the ChatGPT connection receives text descriptions, never raw audio. Audio setup and processing do not use a paid API or upload the film.

## Setup and use

Windows: run `./setup-audio.ps1` in PowerShell. macOS: run `bash setup-audio.command`. Both use [uv](https://docs.astral.sh/uv/getting-started/installation/) to create `observer/.audio-venv` with Python 3.12 and download the public model into the local data directory. If uv's Windows Python discovery fails, pass an existing Python 3.12 executable with `./setup-audio.ps1 -Python C:/path/to/python.exe`.

Setup downloads several GB of weights, records the exact model revision in `local-data/audio-model.json`, and does not run inference. The audio environment and downloaded weights are ignored by Git. `LOCAL_DATA_ROOT` can move the model/configuration along with the other local data.

After setup, restart the cinema and MCP adapter, reload the page, and choose **Prepare for AI viewing** for a new film or **Add audio descriptions** for an already prepared film. The latter retains its visual files and selected dialogue track. Finished audio chunks are checkpointed and reused on retry; an interrupted chunk is regenerated. The CLI can opt in with `npm run observer:precompute -- --input path/to/film.mp4 --audio`.

Audio is an optional addition to the existing readiness contract. Missing setup or unavailable audio does not make completed visuals/dialogue unusable. The job message and `audioTrack.status` distinguish missing setup, pending work, failed analysis, no source audio, and completed descriptions.

## Local model and scope

The initial provider is [Qwen/Qwen2.5-Omni-3B](https://huggingface.co/Qwen/Qwen2.5-Omni-3B). The worker uses the [Transformers text-only Thinker interface](https://huggingface.co/docs/transformers/v4.57.1/en/model_doc/qwen2_5_omni#text-only-generation), with audio input and no speech generation. It loads downloaded files in offline mode and does not execute remote model code. One model stays resident across the chunks of a preparation job and exits when the job ends.

The portable default is CPU inference, including on Windows with AMD graphics. This can be slow and uses substantial RAM. Optional `OWC_AUDIO_DEVICE` overrides the configured device; CUDA requires a compatible PyTorch installation. `OWC_AUDIO_PYTHON` can select another audio interpreter. GPU acceleration is not configured by the Windows setup script.

The first audio stream is decoded to mono 16 kHz. Each owned preparation chunk is divided into independent 10-second clips; `segmentMs` in the configuration accepts 2–20 seconds. The final clip can be shorter. Model output is limited to short descriptions of:

- Speech delivery: pace, volume, pauses, laughter, breathing, and similar audible qualities.
- Music: audible instrumentation, rhythm, and changes where discernible.
- Ambience and sound effects.

The model does not receive subtitles, visuals, character names, or prior clips, which limits contamination by plot context. Its output remains fallible. It is instructed not to quote dialogue, identify characters, infer hidden emotions, or follow instructions spoken in the film. This version does not attribute delivery to a particular subtitle line or named speaker. Near-silent clips are labeled using an acoustic energy threshold; absent descriptions must never be interpreted as silence.

## Storage and delivery

Each completed preparation chunk can contain `audio.json`, referenced by its manifest `audioRef`. `audioStatus`, `audioDescriptionCount`, and `audioProfile` support resumable work. A changed model revision, prompt version, segment size, or device regenerates audio checkpoints on the next preparation run. Existing packages without this extension report `not_prepared`.

An illustrative description has this form:

```json
{
  "id": "audio-728000-738000",
  "fromMs": 728000,
  "toMs": 738000,
  "availableAtMs": 738000,
  "text": "Quiet speech with long pauses. Soft piano continues underneath.",
  "source": "local_audio_model"
}
```

Ticks and detailed windows return `audioDescriptions`; readiness and provider metadata appear in `availability.audioTrack` for ticks and `audioTrack` for windows. `sourceChunkId` links each delivered description to its prepared chunk. The returned text is media evidence, not an instruction to the receiving AI.

A description is released only when its entire analyzed clip has played: `availableAtMs` must equal `toMs` and be behind both the requested window end and the room playhead. Audio never uses the optional lookahead setting. Delivery uses an end-exclusive previous cursor and an inclusive new cursor: `(fromMs, toMs]` over `availableAtMs`. This avoids both early release and losing a description when a tick ends midway through its clip.

Audio shares the media cursor and `seekVersion`. Ordinary polling does not repeat completed clips; seeks intentionally supply destination context. If a response would exceed item limits, ticks shrink their delivery range and retain backlog rather than advancing past undelivered audio. A seek during a file read causes the server to reject the stale response and request a retry with unchanged cursors.

## Validation status

The Windows runtime path repair was verified through the running cinema's audio status endpoint. A two-second film clip completed local CPU inference, and 16 preparation/UI checks passed. The sample output included unwanted question-and-answer text, so description quality still needs refinement. Full-film preparation speed and the complete player-to-MCP audio flow still need live validation.

Windows setup resolves the private environment's base Python executable to its physical path. This prevents a Python installed through a packaged desktop host from working during setup but failing when launched by the cinema outside that host. Audio availability failures retain diagnostic text instead of silently reporting a missing setup.
