# pi-llama-swap

Pi provider extension for [llama-swap](https://github.com/mostlygeek/llama-swap). It reads the model list from a llama-swap server and registers every model with Pi. No model entries in `models.json` are necessary.

## Install

```bash
pi install git:github.com/liquos/pi-llama-swap
```

Or load the package for one run:

```bash
pi -e git:github.com/liquos/pi-llama-swap
```

## Configuration

Set the server address with an environment variable:

```bash
export LLAMA_SWAP_URL=http://127.0.0.1:6969
```

| Variable | Default | Description |
|---|---|---|
| `LLAMA_SWAP_URL` | `http://192.168.1.236:6969` | llama-swap base URL. A trailing `/v1` is accepted and removed. |
| `LLAMA_SWAP_API_KEY` | `local` | API key sent to the server. |

Pi shows the models under the provider `llama-swap`. Select one with `/model`.

## Model discovery

The extension reads `GET /v1/models` at startup and on provider refresh. It uses these fields:

| Pi field | Source |
|---|---|
| Model ID | `id` |
| Display name | `name`, then `id` |
| Context window, max output | `context_length`, `context_window`, `meta.n_ctx` |
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
