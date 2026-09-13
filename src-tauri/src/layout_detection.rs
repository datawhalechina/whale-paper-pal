use base64::Engine;
use image::{imageops, Rgb, RgbImage};
use ort::{session::Session, value::Tensor};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{path::BaseDirectory, AppHandle, Manager};

const INPUT_SIZE: u32 = 1024;
const MODEL_RESOURCE: &str = "models/doclayout_yolo_docstructbench_imgsz1024.onnx";
const MODEL_DEVELOPMENT_PATH: &str =
    "resources/models/doclayout_yolo_docstructbench_imgsz1024.onnx";

static LAYOUT_SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PdfLayoutDetectionRequest {
    data_url: String,
    document_id: String,
    page_index: u32,
}

#[derive(Debug, serde::Serialize)]
pub(crate) struct PdfLayoutBox {
    box_cls: u32,
    box_conf: f32,
    box_xywhn: [f32; 4],
}

#[derive(Clone, Copy)]
struct LetterboxTransform {
    original_width: f32,
    original_height: f32,
    scale: f32,
    pad_x: f32,
    pad_y: f32,
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resolve(MODEL_RESOURCE, BaseDirectory::Resource)
        .map_err(|error| format!("无法定位本地版面模型: {error}"))?;
    if bundled.is_file() {
        return Ok(bundled);
    }
    let development = Path::new(env!("CARGO_MANIFEST_DIR")).join(MODEL_DEVELOPMENT_PATH);
    if development.is_file() {
        return Ok(development);
    }
    Err(format!("本地版面模型不存在: {}", bundled.display()))
}

fn decode_page_image(data_url: &str) -> Result<Vec<u8>, String> {
    let encoded = data_url
        .split_once(',')
        .map(|(_, value)| value)
        .unwrap_or(data_url);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("无法读取页面图像: {error}"))?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("页面图像超过 16 MB".into());
    }
    Ok(bytes)
}

fn preprocess(bytes: &[u8]) -> Result<(Vec<f32>, LetterboxTransform), String> {
    let image = image::load_from_memory(bytes)
        .map_err(|error| format!("无法解码页面图像: {error}"))?
        .to_rgb8();
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return Err("页面图像尺寸无效".into());
    }

    let scale = (INPUT_SIZE as f32 / width as f32).min(INPUT_SIZE as f32 / height as f32);
    let resized_width = (width as f32 * scale).round().clamp(1.0, INPUT_SIZE as f32) as u32;
    let resized_height = (height as f32 * scale)
        .round()
        .clamp(1.0, INPUT_SIZE as f32) as u32;
    let horizontal_padding = INPUT_SIZE - resized_width;
    let vertical_padding = INPUT_SIZE - resized_height;
    let pad_x = (horizontal_padding as f32 / 2.0 - 0.1).round().max(0.0) as u32;
    let pad_y = (vertical_padding as f32 / 2.0 - 0.1).round().max(0.0) as u32;

    let resized = imageops::resize(
        &image,
        resized_width,
        resized_height,
        imageops::FilterType::Triangle,
    );
    let mut canvas = RgbImage::from_pixel(INPUT_SIZE, INPUT_SIZE, Rgb([114, 114, 114]));
    imageops::replace(&mut canvas, &resized, i64::from(pad_x), i64::from(pad_y));

    let plane = (INPUT_SIZE * INPUT_SIZE) as usize;
    let mut input = vec![0.0_f32; plane * 3];
    for (index, pixel) in canvas.pixels().enumerate() {
        input[index] = pixel[0] as f32 / 255.0;
        input[plane + index] = pixel[1] as f32 / 255.0;
        input[plane * 2 + index] = pixel[2] as f32 / 255.0;
    }

    Ok((
        input,
        LetterboxTransform {
            original_width: width as f32,
            original_height: height as f32,
            scale,
            pad_x: pad_x as f32,
            pad_y: pad_y as f32,
        },
    ))
}

fn confidence_threshold(class_id: u32) -> f32 {
    match class_id {
        3 => 0.55, // figure
        5 => 0.70, // table
        8 => 0.65, // isolated formula
        2 | 7 | 9 => 0.60,
        _ => 0.50,
    }
}

fn decode_detections(output: &[f32], transform: LetterboxTransform) -> Vec<PdfLayoutBox> {
    output
        .chunks_exact(6)
        .filter_map(|row| {
            let confidence = row[4];
            let class_id = row[5].round() as u32;
            if !confidence.is_finite()
                || confidence < confidence_threshold(class_id)
                || class_id > 9
            {
                return None;
            }
            let x1 =
                ((row[0] - transform.pad_x) / transform.scale).clamp(0.0, transform.original_width);
            let y1 = ((row[1] - transform.pad_y) / transform.scale)
                .clamp(0.0, transform.original_height);
            let x2 =
                ((row[2] - transform.pad_x) / transform.scale).clamp(0.0, transform.original_width);
            let y2 = ((row[3] - transform.pad_y) / transform.scale)
                .clamp(0.0, transform.original_height);
            if x2 <= x1 || y2 <= y1 {
                return None;
            }
            Some(PdfLayoutBox {
                box_cls: class_id,
                box_conf: confidence,
                box_xywhn: [
                    (x1 + x2) / (2.0 * transform.original_width),
                    (y1 + y2) / (2.0 * transform.original_height),
                    (x2 - x1) / transform.original_width,
                    (y2 - y1) / transform.original_height,
                ],
            })
        })
        .collect()
}

fn detect(model_path: &Path, bytes: &[u8]) -> Result<Vec<PdfLayoutBox>, String> {
    let (input, transform) = preprocess(bytes)?;
    let session_slot = LAYOUT_SESSION.get_or_init(|| Mutex::new(None));
    let mut guard = session_slot
        .lock()
        .map_err(|_| "本地版面模型状态不可用".to_string())?;
    if guard.is_none() {
        let mut builder = Session::builder()
            .map_err(|error| format!("无法初始化 ONNX Runtime: {error}"))?
            .with_intra_threads(4)
            .map_err(|error| format!("无法配置 ONNX Runtime: {error}"))?;

        // Apple Silicon/macOS can execute compatible graph segments through
        // CoreML. The provider is deliberately best-effort: ort falls back
        // to its CPU provider when CoreML is unavailable or rejects a graph.
        #[cfg(target_os = "macos")]
        {
            builder = builder
                .with_execution_providers([ort::ep::CoreML::default()
                    .with_compute_units(ort::ep::coreml::ComputeUnits::All)
                    .with_static_input_shapes(true)
                    .build()])
                .unwrap_or_else(|error| {
                    eprintln!("CoreML provider unavailable, using CPU: {error}");
                    error.recover()
                });
        }

        let session = builder
            .commit_from_file(model_path)
            .map_err(|error| format!("无法加载本地版面模型: {error}"))?;
        *guard = Some(session);
    }
    let session = guard
        .as_mut()
        .ok_or_else(|| "本地版面模型未初始化".to_string())?;
    let input = Tensor::from_array((
        [1_usize, 3, INPUT_SIZE as usize, INPUT_SIZE as usize],
        input,
    ))
    .map_err(|error| format!("无法创建版面模型输入: {error}"))?;
    let outputs = session
        .run(ort::inputs!["images" => input])
        .map_err(|error| format!("本地版面识别失败: {error}"))?;
    let output = outputs["output0"]
        .try_extract_array::<f32>()
        .map_err(|error| format!("无法读取版面模型输出: {error}"))?;
    let values = output
        .as_slice()
        .ok_or_else(|| "版面模型输出不是连续张量".to_string())?;
    Ok(decode_detections(values, transform))
}

#[tauri::command]
pub(crate) async fn detect_pdf_layout(
    app: AppHandle,
    request: PdfLayoutDetectionRequest,
) -> Result<Vec<PdfLayoutBox>, String> {
    let path = model_path(&app)?;
    let bytes = decode_page_image(&request.data_url)?;
    let _request_identity = (&request.document_id, request.page_index);
    tauri::async_runtime::spawn_blocking(move || detect(&path, &bytes))
        .await
        .map_err(|error| format!("本地版面识别任务失败: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_letterboxed_detection_back_to_original_page() {
        let transform = LetterboxTransform {
            original_width: 729.0,
            original_height: 229.0,
            scale: 1024.0 / 729.0,
            pad_x: 0.0,
            pad_y: 351.0,
        };
        let boxes = decode_detections(
            &[551.278, 349.9307, 952.9678, 553.5485, 0.9571, 5.0],
            transform,
        );
        assert_eq!(boxes.len(), 1);
        assert_eq!(boxes[0].box_cls, 5);
        assert!(boxes[0]
            .box_xywhn
            .iter()
            .all(|value| (0.0..=1.0).contains(value)));
    }

    #[test]
    fn applies_stricter_table_confidence_threshold() {
        let transform = LetterboxTransform {
            original_width: 1024.0,
            original_height: 1024.0,
            scale: 1.0,
            pad_x: 0.0,
            pad_y: 0.0,
        };
        assert!(decode_detections(&[0.0, 0.0, 100.0, 100.0, 0.69, 5.0], transform).is_empty());
        assert_eq!(
            decode_detections(&[0.0, 0.0, 100.0, 100.0, 0.71, 5.0], transform).len(),
            1
        );
    }

    #[test]
    #[ignore = "set WHALEPAPER_LAYOUT_TEST_IMAGE to run model inference"]
    fn runs_bundled_model_on_a_document_image() {
        let image_path = std::env::var("WHALEPAPER_LAYOUT_TEST_IMAGE")
            .expect("WHALEPAPER_LAYOUT_TEST_IMAGE is required");
        let bytes = std::fs::read(image_path).expect("test image should be readable");
        let model = Path::new(env!("CARGO_MANIFEST_DIR")).join(MODEL_DEVELOPMENT_PATH);
        let boxes = detect(&model, &bytes).expect("ONNX inference should succeed");
        assert!(!boxes.is_empty());
        assert!(boxes
            .iter()
            .all(|item| item.box_conf >= confidence_threshold(item.box_cls)));
    }
}
