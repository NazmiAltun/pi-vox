# pi-vox

Voice input for [pi coding agent](https://github.com/earendil-works/pi-coding-agent).

It records your microphone, sends the audio to ElevenLabs speech-to-text, and puts the transcript into the current pi input box.

ElevenLabs is the only speech provider right now. Their free tier is generous enough for normal testing and light use.

## Install

From npm:

```bash
pi install npm:pi-vox
```

Or from GitHub:

```bash
pi install https://github.com/denismrvoljak/pi-vox
```

## Setup

### 1. Add your ElevenLabs API key

Create an API key in ElevenLabs, then set it before starting pi:

```bash
export ELEVENLABS_API_KEY="your-key-here"
```

You can also put it in a `.env` file in the directory where you launch pi:

```bash
ELEVENLABS_API_KEY=your-key-here
```

`pi-vox` redacts this key from status messages and common error output.

### 2. Install a recorder

`pi-vox` needs a local command-line recorder. On macOS, install one of these:

```bash
brew install sox
```

or:

```bash
brew install ffmpeg
```

If you install `sox`, `pi-vox` can use `rec` or `sox`. If you install `ffmpeg`, it can use `ffmpeg`.

### 3. Reload pi

Inside pi:

```text
/reload
```

Then check that everything is connected:

```text
/voice-status
```

You should see something like:

```text
Voice input: version=..., provider=elevenlabs, key=configured, autoSubmit=off, cleanup=on, audio=rec/sox/ffmpeg
```

## How to use it

Start recording:

```text
/voice-toggle
```

Speak your prompt.

Stop recording and insert the transcript:

```text
/voice-toggle
```

Cancel the recording:

```text
/voice-cancel
```

That's the main workflow.

## Commands

### `/voice-toggle`

Starts recording when idle. Stops recording when active, transcribes, and inserts the text into the editor.

### `/voice-cancel`

Stops the current recording and deletes the temporary audio file.

### `/voice-status`

Shows whether the API key is configured, which recorder is available, and a few current settings.

### `/voice-glossary`

Adds custom cleanup rules for words speech-to-text gets wrong.

```text
/voice-glossary list
/voice-glossary add pi-vox pyvox "bye vox"
/voice-glossary add pi-coding-agent pycodingagent "bye coding agent"
/voice-glossary clear
```

Settings are saved here:

```text
~/.pi/pi-vox/config.json
```

You can use another config file with:

```bash
export PI_VOX_CONFIG=/path/to/config.json
```

## Transcript cleanup

Speech-to-text often gets project names wrong, so `pi-vox` cleans up common mistakes before inserting the text.

Examples:

- `py-coding agent` → `pi-coding-agent`
- `pie coding agent` → `pi-coding-agent`
- `bye coding agent` → `pi-coding-agent`
- `pyvox` → `pi-vox`
- `pytutor` → `pi-tutor`
- `pyoverwatch` → `pi-overwatch`

You can add your own glossary entries in config:

```json
{
  "transcriptGlossary": [
    { "canonical": "my-product", "aliases": ["my product", "mai product"] }
  ]
}
```

Or use the command:

```text
/voice-glossary add my-product "my product" "mai product"
```

To turn cleanup off:

```json
{
  "transcriptCleanup": false
}
```

## Why it uses commands instead of hold-space

Some terminals handle key press/release events differently. Holding space can be unreliable, and it can interfere with normal typing.

So the default is simple and safe:

```text
/voice-toggle
```

There is internal support for shortcuts and hold-to-talk, but the command workflow is the supported default.

## Config defaults

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
  transcriptCleanup: true,
  transcriptGlossary: undefined,
  transcriptReplacements: undefined
}
```

## Privacy notes

When you stop recording, `pi-vox` sends that audio to ElevenLabs for transcription.

It does not keep a recording history. Temporary audio files are cleaned up after transcribe or cancel.

Still, don't dictate secrets into any networked voice tool.

## Development

```bash
pnpm install
pnpm test
pnpm check
pnpm pack:smoke
```

Local install while developing:

```bash
pi install /absolute/path/to/pi-vox
```

Inside pi:

```text
/reload
/voice-status
/voice-toggle
```

## Known limitations

- ElevenLabs is the only provider right now
- command-based toggle is the supported path
- hold-space is disabled by default
- no streaming partial transcripts yet
- no text-to-speech, wake word, or daemon

## License

MIT
