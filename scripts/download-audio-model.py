"""Download public model weights for offline use; never upload media or run inference."""
import argparse
import json
import os
from pathlib import Path

from huggingface_hub import model_info, snapshot_download

parser = argparse.ArgumentParser()
parser.add_argument('--data-root', required=True)
args = parser.parse_args()
root = Path(args.data_root).resolve()
model_id = 'Qwen/Qwen2.5-Omni-3B'
revision = model_info(model_id).sha
model_path = snapshot_download(
    model_id, revision=revision, cache_dir=root / 'audio-model-cache',
    allow_patterns=['*.json', '*.safetensors', '*.txt', '*.jinja'],
)
root.mkdir(parents=True, exist_ok=True)
config = root / 'audio-model.json'
temporary = config.with_suffix('.tmp')
temporary.write_text(json.dumps({
    'modelId': model_id, 'revision': revision, 'modelPath': model_path,
    'device': 'cpu', 'segmentMs': 10_000,
}, indent=2) + '\n', encoding='utf-8')
os.replace(temporary, config)
print(f'Audio model downloaded. Configuration: {config}', flush=True)
