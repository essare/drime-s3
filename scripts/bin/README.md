# Large upload test payloads

Place a **real binary** here for production multipart tests (e.g. ISO, disk image, or `truncate` / `dd` output).

Default path used by `scripts/real-large-s3-upload.ts`:

- `payload.bin` — create or copy your file to this name, **or** pass another path as the first CLI argument.

Everything in this directory except this `README.md` is ignored by Git (see repo `.gitignore`).

Example (sparse 512 MiB file for a quick multipart run):

```bash
mkfile -n 512m scripts/bin/payload.bin
```

On Linux without `mkfile`:

```bash
truncate -s 512M scripts/bin/payload.bin
```
