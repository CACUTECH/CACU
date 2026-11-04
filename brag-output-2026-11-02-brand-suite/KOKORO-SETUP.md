# Local Kokoro for CACU brag

Kokoro is installed in this directory's `.venv`, separate from CACU's application/backend environments. Official project: https://github.com/hexgrad/kokoro . Packages include `kokoro`, `kokoro-onnx` and `soundfile`; Hyperframes uses the ONNX package for local speech. CPU dependencies only.

From PowerShell in `composition`:

```powershell
$env:HYPERFRAMES_PYTHON = (Resolve-Path '../.venv/Scripts/python.exe').Path
npx.cmd --yes hyperframes@0.9.0 tts ../voiceover.txt --voice af_heart --speed 1.12 --output assets/voiceover.wav
```

No OpenAI key, Supabase credential or HeyGen login is required for this local narration. Model weights are downloaded on first generation. To list voices, use `npx.cmd hyperframes tts --list`.

Original installation command: `uv pip install --python .venv/Scripts/python.exe kokoro-onnx soundfile "kokoro>=0.9.4" --index https://download.pytorch.org/whl/cpu --index https://pypi.org/simple --index-strategy unsafe-best-match`.

See installed-packages.txt for the exact resolved versions. The official Python Kokoro package is installed; the completed audio generation validates the ONNX path used by Hyperframes.
