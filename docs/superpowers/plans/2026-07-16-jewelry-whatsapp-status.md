# Jewelry WhatsApp Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a clean 25 to 30 second vertical luxury jewelry montage from the supplied MOV and JPEG assets.

**Architecture:** A workspace-local FFmpeg binary will probe, trim, crop, color-correct, and concatenate the media. A small Python script will synthesize an original ambient instrumental WAV, and a PowerShell render script will combine the finished picture and audio into a WhatsApp-ready MP4.

**Tech Stack:** FFmpeg/ffprobe, PowerShell, bundled Python 3, Python standard library

## Global Constraints

- Final delivery: MP4 using H.264 video and AAC audio.
- Canvas: 1080 x 1920 portrait at 30 fps.
- Target length: 25 to 30 seconds.
- No text, logo, pricing, or branding.
- Do not use the original camera audio.
- Preserve the jewelry's real appearance and use restrained transitions.

---

### Task 1: Local Render Tooling and Media Inspection

**Files:**
- Create: `tools/ffmpeg/`
- Create: `output/jewelry-status/contact-sheet.jpg`
- Create: `output/jewelry-status/probe.json`

**Interfaces:**
- Consumes: four MOV files and ten JPEG files in `C:\Users\zeel1\Downloads\Jewelry Status assets`
- Produces: workspace-local `ffmpeg.exe`, `ffprobe.exe`, probe metadata, and a review contact sheet

- [ ] **Step 1: Download and extract an FFmpeg essentials build into `tools/ffmpeg`**

Run a workspace-scoped download and extraction; do not modify system PATH.

- [ ] **Step 2: Probe the four videos**

Run `ffprobe` with JSON output for duration, rotation, dimensions, codecs, and frame rate. Save the complete result to `output/jewelry-status/probe.json`.

- [ ] **Step 3: Build representative thumbnails**

Extract beginning, middle, and ending thumbnails from each video and combine them into `output/jewelry-status/contact-sheet.jpg`.

- [ ] **Step 4: Review the contact sheet**

Reject camera-settling frames, redundant angles, and any crop that cuts off a pendant. Record selected trim ranges in the render script created in Task 3.

### Task 2: Original Luxury Instrumental Bed

**Files:**
- Create: `scripts/create_luxury_audio.py`
- Create: `output/jewelry-status/luxury-bed.wav`

**Interfaces:**
- Consumes: exact requested duration in seconds
- Produces: `output/jewelry-status/luxury-bed.wav`, stereo 48 kHz PCM with peak below -3 dBFS

- [ ] **Step 1: Create the audio generator**

Implement a standard-library Python synthesizer using soft sine-wave pad chords, sparse bell-like overtones, attack/release envelopes, and a full-track fade in/out. Use a repeating progression based on A minor, F major, C major, and G major at a restrained tempo. Normalize to a peak amplitude of 0.55.

- [ ] **Step 2: Generate the WAV**

Run the bundled Python executable with the target montage duration and save the stereo 48 kHz result as `output/jewelry-status/luxury-bed.wav`.

- [ ] **Step 3: Validate audio**

Use `ffprobe` to confirm stereo PCM at 48 kHz and use FFmpeg `volumedetect` to confirm the maximum volume is below -3 dBFS.

### Task 3: Portrait Montage Render

**Files:**
- Create: `scripts/create_jewelry_status.ps1`
- Create: `output/jewelry-status/jewelry-whatsapp-status.mp4`

**Interfaces:**
- Consumes: selected video trim ranges, selected JPEG paths, `luxury-bed.wav`, and workspace-local FFmpeg
- Produces: final H.264/AAC portrait MP4

- [ ] **Step 1: Implement the render script**

Define exact clip and photo order in arrays. For videos: remove camera audio, auto-rotate, scale to cover 1080 x 1920, crop centrally, apply restrained contrast/saturation/warmth, and normalize to 30 fps. For selected photos: apply a subtle `zoompan` motion over 1.8 to 2.2 seconds. Apply short fade-in/out handles to each segment and concatenate with 0.25 to 0.35 second dissolves.

- [ ] **Step 2: Render the picture master**

Render H.264 with `libx264`, `yuv420p`, 30 fps, `-preset medium`, and a visually clean CRF between 18 and 21.

- [ ] **Step 3: Add music and delivery encoding**

Mix only `luxury-bed.wav`, trim to picture duration, fade both ends, encode AAC at 192 kbps, and add `-movflags +faststart`.

### Task 4: Delivery Verification

**Files:**
- Create: `output/jewelry-status/final-probe.json`
- Create: `output/jewelry-status/final-contact-sheet.jpg`

**Interfaces:**
- Consumes: `jewelry-whatsapp-status.mp4`
- Produces: verified final video and QA evidence

- [ ] **Step 1: Probe the final MP4**

Confirm 1080 x 1920, 30 fps, H.264 video, AAC stereo audio, and a duration between 25 and 30 seconds. Save JSON to `output/jewelry-status/final-probe.json`.

- [ ] **Step 2: Decode-check the full file**

Run FFmpeg with the final MP4 as input and a null output. Expected result: exit code 0 with no decode errors.

- [ ] **Step 3: Inspect representative frames**

Create a six-frame contact sheet spanning the final duration. Verify portrait orientation, pendant visibility, restrained transitions, natural color, and clean opening/closing frames.

- [ ] **Step 4: Confirm file size and playback readiness**

Check that the MP4 exists, is non-empty, includes `faststart`, and is ready for WhatsApp Status upload.
