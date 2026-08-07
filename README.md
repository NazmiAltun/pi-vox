# pi-vox

Voice input for [pi](https://github.com/earendil-works/pi).

It records your microphone with `rec`, `sox`, or `ffmpeg`, sends audio to ElevenLabs or Xiaomi Mimo speech-to-text, and puts the transcript into the current pi input box.

ElevenLabs remains the default provider. Xiaomi Mimo reuses the existing Pi credential configured for the `xiaomi-token-plan-sgp` provider when available.

## Install

From GitHub:

```bash
pi install git:github.com/NazmiAltun/pi-vox
```

For local development:

```bash
pi install /absolute/path/to/pi-vox
```

## Setup

### Configure provider credentials

ElevenLabs keeps its existing setup. Create an API key in ElevenLabs, then put it in `~/.pi/pi-vox/config.json`:

```json
{
  "elevenLabsApiKey": "your-key-here"
}
```

You can also set it before starting pi:

```bash
export ELEVENLABS_API_KEY="your-key-here"
```

Or put it in a `.env` file in the directory where you launch pi:

```bash
ELEVENLABS_API_KEY=your-key-here
```

For Xiaomi Mimo, pi-vox first asks Pi's model registry for the stored credential belonging to `xiaomi-token-plan-sgp`. This reuses the key already used by Pi and does not require copying it into another file. As a fallback, pi-vox recognizes Pi's existing `XIAOMI_TOKEN_PLAN_SGP_API_KEY` and `XIAOMI_API_KEY` variables, plus `MIMO_API_KEY`, from the environment or `.env`.

Environment variables win over `.env`, and `.env` wins over `~/.pi/pi-vox/config.json`. pi-vox redacts both provider keys from error output.

### Install a recorder

`pi-vox` automatically selects the first available recorder in this order: `rec`, `sox`, then `ffmpeg`.

On macOS, install SoX for `rec`:

```bash
brew install sox
```

Or install ffmpeg:

```bash
brew install ffmpeg
```

When ffmpeg is selected, platform defaults are macOS `avfoundation :0`, Linux `pulse default`, and Windows `dshow audio=Microphone`. Override these in `~/.pi/pi-vox/config.json` with `inputFormat`, `input`, `sampleRate`, and `channels`.

### Reload pi

Inside pi:

```text
/reload
```

Choose provider:

```text
/voice-provider
```

Select `elevenlabs` or `mimo`. Selection persists in `~/.pi/pi-vox/config.json`.

## How to use it

Start recording:

```text
Ctrl+Q
```

Speak your prompt. Press `Ctrl+Q` again to stop recording, transcribe, and insert text.

`Ctrl+Q` is the sole recording control. There is no recording slash command or explicit pi-vox cancellation command.

## Commands

### `/voice-provider`

Opens a provider picker and persists the selected `elevenlabs` or `mimo` provider. Provider changes are blocked while recording.

Settings are saved here:

```text
~/.pi/pi-vox/config.json
```

Use another config file with:

```bash
export PI_VOX_CONFIG=/path/to/config.json
```

## Transcript cleanup

Speech-to-text often gets project names wrong, so pi-vox cleans up common mistakes before insertion.

Examples:

- `py-coding agent` → `pi-coding-agent`
- `pie coding agent` → `pi-coding-agent`
- `bye coding agent` → `pi-coding-agent`
- `pyvox` → `pi-vox`
- `pytutor` → `pi-tutor`
- `pyoverwatch` → `pi-overwatch`

Add custom glossary entries directly in config:

```json
{
  "transcriptGlossary": [
    { "canonical": "my-product", "aliases": ["my product", "mai product"] }
  ]
}
```

Disable cleanup with:

```json
{
  "transcriptCleanup": false
}
```

## Config defaults

```js
{
  provider: 'elevenlabs',
  elevenLabsApiKey: undefined,
  mimoApiKey: undefined,
  mimoEndpoint: 'https://api.xiaomimimo.com/v1/chat/completions',
  mimoModelId: 'mimo-v2.5-asr',
  mimoLanguage: 'auto',
  mimoCredentialProvider: 'xiaomi-token-plan-sgp',
  recorder: 'auto',
  autoSubmit: false,
  appendMode: 'append',
  ffmpegPath: 'ffmpeg',
  inputFormat: 'avfoundation',
  input: ':0',
  sampleRate: 16000,
  channels: 1,
  transcriptCleanup: true,
  transcriptGlossary: undefined,
  transcriptReplacements: undefined
}
```

## Privacy notes

When recording stops, pi-vox sends audio to the selected provider. Mimo requests use `https://api.xiaomimimo.com/v1/chat/completions` with a base64 WAV data URI and `mimo-v2.5-asr`.

pi-vox does not keep a recording history. Temporary audio files are cleaned up after transcription or shutdown.

Do not dictate secrets into any networked voice tool.

## Development

```bash
pnpm install
pnpm test
pnpm check
pnpm pack:smoke
```

## Known limitations

- Streaming partial transcripts are not supported.
- Recorder selection prefers `rec`, then `sox`, then `ffmpeg`.
- No text-to-speech, wake word, or daemon.

## License

MIT
