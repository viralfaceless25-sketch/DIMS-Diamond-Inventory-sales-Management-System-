from __future__ import annotations

import argparse
import math
import struct
import wave
from pathlib import Path


SAMPLE_RATE = 48_000


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def event_envelope(t: float, start: float, length: float) -> float:
    local = t - start
    if local < 0.0 or local >= length:
        return 0.0
    attack = smoothstep(local / 1.4)
    release = smoothstep((length - local) / 1.8)
    return min(attack, release)


def synthesize(duration: float) -> tuple[list[float], list[float]]:
    frame_count = int(round(duration * SAMPLE_RATE))
    left = [0.0] * frame_count
    right = [0.0] * frame_count

    # Original slow progression: Am - F - C - G, voiced as airy pads.
    chords = [
        (110.00, (1.0, 1.189207, 1.498307, 2.0)),
        (87.31, (1.0, 1.259921, 1.498307, 2.0)),
        (130.81, (1.0, 1.259921, 1.498307, 2.0)),
        (98.00, (1.0, 1.259921, 1.498307, 2.0)),
    ]
    chord_spacing = 6.5
    chord_length = 8.0
    event_count = int(math.ceil(duration / chord_spacing)) + 1

    for event_index in range(event_count):
        start = event_index * chord_spacing - 0.5
        base, ratios = chords[event_index % len(chords)]
        first = max(0, int(start * SAMPLE_RATE))
        last = min(frame_count, int((start + chord_length) * SAMPLE_RATE))
        for frame in range(first, last):
            t = frame / SAMPLE_RATE
            env = event_envelope(t, start, chord_length)
            if env == 0.0:
                continue
            local = t - start
            pad_l = 0.0
            pad_r = 0.0
            for tone_index, ratio in enumerate(ratios):
                frequency = base * ratio
                weight = (0.22, 0.16, 0.14, 0.08)[tone_index]
                drift = 0.0025 * math.sin(2.0 * math.pi * (0.055 + tone_index * 0.008) * t)
                pad_l += weight * math.sin(2.0 * math.pi * frequency * (1.0 + drift) * local)
                pad_r += weight * math.sin(
                    2.0 * math.pi * frequency * (1.0 - drift) * local + 0.10 * (tone_index + 1)
                )
            left[frame] += env * pad_l
            right[frame] += env * pad_r

    # Sparse glassy notes add a jewelry-like shimmer without becoming rhythmic.
    bell_times = [1.2 + index * 2.35 for index in range(int(duration / 2.35) + 1)]
    bell_notes = [440.00, 523.25, 659.25, 587.33, 493.88, 659.25, 783.99, 587.33]
    for bell_index, start in enumerate(bell_times):
        frequency = bell_notes[bell_index % len(bell_notes)]
        bell_length = 2.1
        first = int(start * SAMPLE_RATE)
        last = min(frame_count, int((start + bell_length) * SAMPLE_RATE))
        pan = 0.32 if bell_index % 2 == 0 else 0.68
        for frame in range(first, last):
            local = frame / SAMPLE_RATE - start
            attack = smoothstep(local / 0.018)
            decay = math.exp(-2.25 * local)
            value = attack * decay * (
                0.18 * math.sin(2.0 * math.pi * frequency * local)
                + 0.075 * math.sin(2.0 * math.pi * frequency * 2.01 * local)
                + 0.035 * math.sin(2.0 * math.pi * frequency * 3.98 * local)
            )
            left[frame] += value * math.sqrt(1.0 - pan)
            right[frame] += value * math.sqrt(pan)

    # Global entrance/exit and conservative normalization.
    peak = 1e-9
    for frame in range(frame_count):
        t = frame / SAMPLE_RATE
        fade_in = smoothstep(t / 1.0)
        fade_out = smoothstep((duration - t) / 1.4)
        gain = min(fade_in, fade_out)
        left[frame] *= gain
        right[frame] *= gain
        peak = max(peak, abs(left[frame]), abs(right[frame]))

    scale = 0.55 / peak
    for frame in range(frame_count):
        left[frame] *= scale
        right[frame] *= scale
    return left, right


def write_wav(path: Path, left: list[float], right: list[float]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        chunk = bytearray()
        for l_sample, r_sample in zip(left, right):
            chunk.extend(
                struct.pack(
                    "<hh",
                    int(max(-1.0, min(1.0, l_sample)) * 32767),
                    int(max(-1.0, min(1.0, r_sample)) * 32767),
                )
            )
            if len(chunk) >= 262_144:
                output.writeframesraw(chunk)
                chunk.clear()
        if chunk:
            output.writeframesraw(chunk)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create an original ambient luxury music bed.")
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.duration <= 0:
        raise SystemExit("Duration must be positive")
    left, right = synthesize(args.duration)
    write_wav(args.output, left, right)


if __name__ == "__main__":
    main()
