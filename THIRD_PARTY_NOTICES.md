# Third-Party Notices — Thimar

Thimar bundles or uses the following third-party components. Full license texts and the
complete notice file are shipped in `public/licenses/` and are served with the application
at `/licenses/`.

## Tilawa — offline Quran recitation engine

- Package: `@tilawa/core` 1.0.0-rc.0
- Source: https://github.com/yazinsai/tilawa
- Code license: MIT — see `licenses/tilawa-LICENSE.txt`
- Model weights (`spliced-clean`, `spliced-clean-lite`): **CC BY 4.0**
- Quran reference data (`ref-v2.json`): derived from **Tanzil** (https://tanzil.net),
  Uthmani text, reproduced verbatim; Tanzil must be credited as the source.
- Full attributions: `licenses/tilawa-NOTICE.md`

Training/evaluation data and upstream works credited by Tilawa (see NOTICE for full text):

- tlog (`tarteel-ai/tlog`) — CC-BY
- Quranic Universal Ayahs / QUD alignment benchmark (`QUD-Technologies`) — CC-BY
- muaalem (`obadx/muaalem-model-v3_2`) — MIT (distillation teacher)
- quran-transcript (`obadx/quran-transcript`) — MIT
- k2-fsa icefall (`k2-fsa/icefall`) — Apache-2.0 (Zipformer architecture)

## Quran ASR Small — offline Quran recitation recognizer

- Model: `Abdou/quran-asr-small`, revision `0c2744b9d70aaf45ba574c30c5d318c575258e66`
- Source: https://huggingface.co/Abdou/quran-asr-small
- Paper: *Small Conformer-CTC Models for On-Device Quranic Recitation Recognition*,
  DOI 10.5281/zenodo.23761691
- License: **MIT** — see `licenses/quran-asr-small-LICENSE.txt` (bundled as
  `offline/v1/quran-asr-small/LICENSE`)
- Architecture: Conformer-CTC, 33M parameters, 9 blocks, d=384, 6 heads, ×4 subsampling,
  31 output tokens (28 Arabic letters + hamza carrier + blank + word separator).
- Bundled file: `model.int8.onnx` (36 MB, dynamic int8 MatMul quantization), with
  `tokens.txt` and `spelling.json`.
- The model writes Uthmani rasm without diacritics. It performs no retrieval and no
  language-model rescoring; Thimar's alignment and assessment layer is separate code.
- Training data (not redistributed, credited by the model card): `tarteel-ai/tlog`
  (CC BY 4.0), IqraEval `Iqra_train`, and EveryAyah recitations under their own terms.

## ONNX Runtime

- Package: `onnxruntime-web` 1.31.1 — MIT
- Source: https://github.com/microsoft/onnxruntime

## Redistribution

- The MIT license permits redistribution with the copyright and permission notice.
- CC BY 4.0 permits redistribution, including commercially, provided attribution is given
  and any modifications are indicated. The model weights are bundled into the Android app
  from the published release, so the CC BY 4.0 attribution above must be kept.
- Quran ASR Small is MIT-licensed; redistribution requires its copyright and permission
  notice, which ships at `licenses/quran-asr-small-LICENSE.txt` and inside the offline
  bundle.
- Tanzil's terms require the Quran text to be reproduced verbatim with attribution and a
  link to https://tanzil.net.

These notices must accompany any distributed build (APK/IPA/desktop package).
