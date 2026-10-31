"""Generates the game's voice pack from the lines listed by extract_lines.mjs.

Offline, on the CPU, with a Bangla VITS voice model. Run it with the voice environment's Python:

  D:/bow-voice/venv/Scripts/python.exe -I tools/voice/generate.py <lines.json> <model dir> <work dir> <out dir> [limit]

Everyone in the game is one recorded speaker made into several people: each actor's pitch and pace
are shifted together, the way a larger or smaller body changes a voice. A line that several actors
share is only synthesised once. Finished clips are mono MP3s, small enough to load as they're needed.
Run again after changing the dialogue: anything already made is skipped.
"""

import json
import os
import re
import subprocess
import sys
import time

import numpy as np
import soundfile as sf
import torch

# Pitch factor and pace. Kept within about 10%: beyond that it starts to sound like a cartoon.
ACTORS = {
    "hero": (1.03, 1.0),
    "young": (1.10, 1.03),
    "mid": (1.0, 1.0),
    "deep": (0.91, 0.99),
    "elder": (0.87, 0.93),
    "seller": (1.05, 1.06),
    "kid": (1.22, 1.08),
}
SAMPLE_RATE = 22050


def sentences(text):
    """A line as the model likes it: one sentence at a time, in the alphabet it was trained on.
    It has no danda, so a full stop stands in, and these letters must be in their single-character form."""
    t = text.replace("—", ", ").replace("…", ".").replace("-", " ")
    t = t.replace("ড়", "ড়").replace("ঢ়", "ঢ়").replace("য়", "য়")
    t = re.sub(r"\s+", " ", t).strip()
    parts = re.findall(r"[^।?!]+[।?!]*", t)
    return [p.replace("।", ".").strip() if p.strip()[-1] in "।?!" else p.strip() + "." for p in parts if p.strip()]


def load(model_dir):
    from TTS.config import load_config
    from TTS.tts.models.vits import Vits

    config = load_config(os.path.join(model_dir, "config.json"))
    model = Vits.init_from_config(config)
    # Weights only: a checkpoint is a pickle, and this refuses anything in it that could run code.
    state = torch.load(os.path.join(model_dir, "pytorch_model.pth"), map_location="cpu", weights_only=True)
    model.load_state_dict(state["model"] if "model" in state else state, strict=False)
    model.eval()
    return model


def synth(model, text):
    """Each sentence separately with a short breath between, which is how the model was trained."""
    pieces = []
    gap = np.zeros(int(SAMPLE_RATE * 0.22), dtype=np.float32)
    for sentence in sentences(text):
        ids = model.tokenizer.text_to_ids(sentence)
        x = torch.tensor(ids, dtype=torch.long).unsqueeze(0)
        with torch.inference_mode():
            y = model.inference(x, aux_input={"x_lengths": torch.tensor([x.shape[1]])})["model_outputs"]
        pieces.append(y.squeeze().cpu().numpy())
        pieces.append(gap)
    return np.concatenate(pieces[:-1])


def main():
    lines_path, model_dir, work, out_dir = sys.argv[1:5]
    limit = int(sys.argv[5]) if len(sys.argv) > 5 else 0
    data = json.load(open(lines_path, encoding="utf8"))
    lines = data["lines"]
    if limit:
        lines = lines[:limit]
    raw_dir = os.path.join(work, "raw")
    os.makedirs(raw_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)

    model = load(model_dir)
    start = time.time()
    keys = {}
    for line in lines:
        keys.setdefault(line["key"], line["text"])
    print(f"{len(keys)} different lines to synthesise, {len(lines)} clips", flush=True)
    done = 0
    for key, text in keys.items():
        wav = os.path.join(raw_dir, f"{key}.wav")
        if not os.path.exists(wav):
            sf.write(wav, synth(model, text), SAMPLE_RATE)
        done += 1
        if done % 25 == 0:
            print(f"  {done}/{len(keys)} in {time.time() - start:.0f}s", flush=True)

    manifest = {}
    made = 0
    for line in lines:
        actor, key = line["actor"], line["key"]
        pitch, pace = ACTORS[actor]
        folder = os.path.join(out_dir, actor)
        os.makedirs(folder, exist_ok=True)
        target = os.path.join(folder, f"{key}.mp3")
        manifest.setdefault(actor, {})[key] = 1
        if os.path.exists(target):
            continue
        rate = int(SAMPLE_RATE * pitch)
        tempo = pace / pitch
        chain = f"asetrate={rate},aresample={SAMPLE_RATE},atempo={tempo:.4f},silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-19:TP=-2:LRA=9,highpass=f=70"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(raw_dir, f"{key}.wav"), "-af", chain, "-ar", str(SAMPLE_RATE), "-ac", "1", "-b:a", "48k", target],
            check=True,
        )
        made += 1
        if made % 100 == 0:
            print(f"  {made} clips encoded", flush=True)
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf8") as f:
        json.dump(manifest, f, separators=(",", ":"))
    size = sum(os.path.getsize(os.path.join(d, n)) for d, _, ns in os.walk(out_dir) for n in ns)
    print(f"finished: {sum(len(v) for v in manifest.values())} clips, {size / 1e6:.1f} MB, {time.time() - start:.0f}s", flush=True)


if __name__ == "__main__":
    main()
