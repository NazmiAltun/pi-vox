# pi-vox

```bash
pi install npm:pi-vox
```

voice input for pi that does not try to own your terminal.

`pi-vox` adds one small thing: speak into your prompt, get text back in the editor.

it records locally with `ffmpeg` or `rec`, sends the audio to ElevenLabs speech-to-text, then inserts the transcript into the current pi input.

no daemon.
no wake word.
no assistant voice.
no weird always-listening mode.

just a toggle.

## why this exists

typing long prompts is slow.

especially when you're trying to explain intent, constraints, tradeoffs, or review feedback.

Claude Code has a nice hold-space voice interaction. terminals are messy though. key release events differ. space can break. shortcuts get swallowed.

so `pi-vox` keeps the default path boring:

run `/voice-toggle` once to record.
run it again to transcribe.

that's it.

## what it does

- records microphone audio from your terminal machine
- transcribes with ElevenLabs speech-to-text
- inserts the transcript into the current pi editor buffer
- fixes common STT mistakes like `py-coding agent` → `pi-coding-agent`
- keeps auto-submit off by default
- keeps your space bar normal by default
- redacts API keys from diagnostics and errors
- gives you `/voice-cancel` when you need to bail out

## install

### from npm

```bash
pi install npm:pi-vox
```

### from GitHub

```bash
pi install https://github.com/denismrvoljak/pi-vox
```

### local path install

use this while developing the package:

```bash
pi install /absolute/path/to/pi-vox
```

### one-off test

```bash
pi -e /absolute/path/to/pi-vox
```

## setup

set your ElevenLabs key:

```bash
export ELEVENLABS_API_KEY="..."
```

or put it in a local `.env` where you launch pi:

```bash
ELEVENLABS_API_KEY=...
```

install a recorder:

```bash
brew install ffmpeg
```

or:

```bash
brew install sox
```

then reload pi:

```text
/reload
```

check status:

```text
/voice-status
```

expected shape:

```text
Voice input: version=..., provider=elevenlabs, key=configured, autoSubmit=off, audio=ffmpeg
```

## use it

start recording:

```text
/voice-toggle
```

speak.

stop and transcribe:

```text
/voice-toggle
```

cancel:

```text
/voice-cancel
```

## commands

### `/voice-toggle`

starts recording if idle.

stops recording if active, sends audio to ElevenLabs, and inserts the transcript into the editor.

### `/voice-cancel`

stops the active recording and cleans up temporary audio.

### `/voice-status`

shows provider, key status, auto-submit status, available audio recorder, and extension version.

## terminal behavior

space is not intercepted by default.

that is deliberate.

some terminals send repeated space presses while you hold the key. some do not send release events in the shape an extension expects. some shortcuts are already owned by paste behavior.

so the stable interface is command-based:

```text
/voice-toggle
```

there is internal support for hold-to-talk and shortcut handling, but the package defaults to the path that does not break normal editing.

## transcript cleanup

speech-to-text gets product names wrong.

`pi-vox` runs a tiny replacement pass before inserting text into the editor.

built-in examples:

- `py-coding agent` → `pi-coding-agent`
- `pie coding agent` → `pi-coding-agent`
- `py vox` → `pi-vox`
- `py tutor` → `pi-tutor`
- `py overwatch` → `pi-overwatch`

custom replacements can be passed through config as `[from, to]` pairs via `transcriptReplacements`.

## configuration defaults

```js
{
  provider: 'elevenlabs',
  holdKey: 'space',
  holdToTalk: false,
  holdThresholdMs: 350,
  fallbackToggleShortcut: 'ctrl+v',
  cancelShortcut: 'escape',
  autoSubmit: false,
  appendMode: 'append',
  recorder: 'auto',
  transcriptReplacements: undefined
}
```

## security model

`pi-vox` sends recorded audio to ElevenLabs when you stop recording.

it does not store recording history. audio files are temporary and cleaned up after finalize/cancel.

it redacts:

- `ELEVENLABS_API_KEY=...`
- `Authorization: Bearer ...`
- the configured ElevenLabs key when provider errors include it

still, treat any voice tool like a networked tool: don't dictate secrets.

## package structure

```text
pi-vox/
├── extensions/
│   └── pi-vox.js
├── src/
│   ├── audio.js
│   ├── config.js
│   ├── flow.js
│   ├── key-handler.js
│   ├── providers.js
│   └── state-machine.js
├── tests/
├── package.json
└── README.md
```

## development

```bash
pnpm install
pnpm test
pnpm check
pnpm pack:smoke
```

local pi loop:

```bash
pi install /absolute/path/to/pi-vox
```

inside pi:

```text
/reload
/voice-status
/voice-toggle
```

## known limitations

- ElevenLabs is the only provider implemented right now
- `ffmpeg` device capture is platform-sensitive
- command-based toggle is the supported path
- hold-space is intentionally disabled by default
- no streaming partial transcripts yet
- no TTS, no wake word, no daemon

## license

MIT
