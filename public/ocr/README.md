# Local OCR resources

Arabic and French LSTM language models for the existing Tesseract reader.
Loaded on demand when reading scanned documents; not part of the startup bundle.
The worker and embedded WASM core are bundled from the installed Tesseract packages.

Model sources (version pinned, Apache-2.0):

- https://cdn.jsdelivr.net/npm/@tesseract.js-data/ara@1.0.0/4.0.0_best_int/ara.traineddata.gz
- https://cdn.jsdelivr.net/npm/@tesseract.js-data/fra@1.0.0/4.0.0_best_int/fra.traineddata.gz
- Upstream: https://github.com/tesseract-ocr/tessdata_best

These contain recognition model weights, not office documents or user data.
The non-SIMD embedded core supports devices without SIMD instructions.
