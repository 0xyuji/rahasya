# rahasya

The [Rahasya](https://rahasya.chat) local proxy: an OpenAI-compatible API on `127.0.0.1` that signs each request with your own inference wallet and spends its credit. With the TEE models (`gemma-4-26b-tee`, `deepseek-abliterated-tee`), prompts are end-to-end encrypted from your machine to an attested enclave.

```sh
npx rahasya@0.1.1        # first run asks for your inference key (rahasya.chat → account menu → Local proxy)
```

It prints `http://127.0.0.1:8787/v1` and a local API key for your tools. `npx rahasya@0.1.1 --help` lists the other commands. Pin the version as shown.

Source: [`packages/proxy`](https://github.com/0xyuji/rahasya/tree/master/packages/proxy), bundled into one readable file. Releases are built by GitHub Actions and approved by hand before going live.
