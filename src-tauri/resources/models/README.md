# DocLayout-YOLO ONNX model

- Upstream: `juliozhao/DocLayout-YOLO-DocStructBench`
- Source checkpoint: `doclayout_yolo_docstructbench_imgsz1024.pt`
- Source checkpoint SHA-256: `9a2ee0220fe3d9ad31b47e1d9f1282f46959a54e4618fce9cffcc9715b8286e2`
- ONNX SHA-256: `8905b0810e426aea3c3cc924f839ddd360d93aa585f273c64546bb970d450605`
- ONNX opset: 17
- Input: `images`, float32 `[1, 3, 1024, 1024]`, RGB values in `[0, 1]`
- Output: `output0`, float32 `[1, 300, 6]`, rows of `x1, y1, x2, y2, confidence, class`

The model is distributed separately under AGPL-3.0. See
`LICENSE.DocLayout-YOLO.txt`. Generate the ONNX file from the upstream
checkpoint with `scripts/export-doclayout-onnx.py`.
