# pi-llama-swap

Pi provider extension for [llama-swap](https://github.com/mostlygeek/llama-swap). It reads the model list from a llama-swap server and registers every model with Pi. No model entries are necessary.

## Install

```bash
pi install git:github.com/liquos/pi-llama-swap
```

Or load the package for one run:

```bash
pi -e git:github.com/liquos/pi-llama-swap
```

## Configuration

Configure the endpoint in `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "llama-swap": {
      "baseUrl": "http://127.0.0.1:6969/v1",
      "contextWindow": 131072,
      "maxTokens": 32768
    }
  }
}
```

| Key | Default | Description |
|---|---|---|
| `baseUrl` | `http://192.168.1.236:6969/v1` | llama-swap endpoint. A host root or a URL ending in `/v1` is accepted. |
| `contextWindow` | `128000` | Context window for models that report none. |
| `maxTokens` | one quarter of the context window | Output limit. A larger value is capped to the context window. |
| `apiKey` | none | API key. A key in `auth.json` takes precedence. |

Store the key in `~/.pi/agent/auth.json`, or add it with `/login`:

```json
{
  "llama-swap": {
    "type": "api_key",
    "key": "sk-your-key"
  }
}
```

Environment variables override the file:

| Variable | Description |
|---|---|
| `LLAMA_SWAP_URL` | llama-swap endpoint. |
| `LLAMA_SWAP_API_KEY` | API key. |

Precedence, highest first:

1. `LLAMA_SWAP_URL`, `LLAMA_SWAP_API_KEY`
2. `auth.json` key
3. `models.json` `apiKey`
4. Defaults

Without a key, the extension sends `Bearer llama-swap-local`. An unprotected server ignores it.

Pi shows the models under the provider `llama-swap`. Select one with `/model`. Per-model changes go in `providers["llama-swap"].modelOverrides`; Pi applies them above the discovered models.

## Model discovery

The extension reads `GET /v1/models` at startup and on provider refresh. It uses these fields:

| Pi field | Source |
|---|---|
| Model ID | `id` |
| Display name | `name`, then `id` |
| Context window | `context_length`, `context_window`, `meta.n_ctx`, then the `contextWindow` setting |
| Image input | `architecture.input_modalities` contains `image`, or `capabilities.vision` |
| Thinking levels | `meta.llamaswap.reasoning_levels` |

All models are listed, including unloaded ones. llama-swap loads a model when the first request for it arrives.

## Thinking levels

Set `reasoning_levels` in the llama-swap model metadata:

```yaml
models:
  my-model:
    metadata:
      reasoning_levels: [none, low, medium, xhigh]
```

The extension maps the Pi levels to these values:

| Pi level | Sent value |
|---|---|
| off | `none` |
| minimal | not supported unless declared |
| low | `low` |
| medium | `medium` |
| high | `xhigh` |
| xhigh | `xhigh` |
| max | `xhigh` |

A level that the metadata does not declare is marked unsupported, and Pi clamps it to the nearest supported level. The value goes in the top-level `reasoning_effort` request field.

If `reasoning_levels` is absent, the model is registered without thinking support.

## Requirements

- A running llama-swap server.
- llama-swap models that answer `GET /v1/models` with model metadata.
