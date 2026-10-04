import type { ImageSegmenter } from '@mediapipe/tasks-vision';

// Person segmentation for Background Blur (MediaPipe selfie segmenter). Loaded only
// when someone picks Background Blur: the WASM runtime comes from jsDelivr (pinned to
// the installed version) and the 250 KB model is served from our own /models.
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = '/models/selfie_segmenter.tflite';

let loading: Promise<ImageSegmenter> | null = null;

export function loadSegmenter(): Promise<ImageSegmenter> {
  loading ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks(WASM);
    const create = (delegate: 'GPU' | 'CPU') =>
      ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    return create('GPU').catch(() => create('CPU'));
  })().catch((err) => {
    loading = null; // let a later attempt retry
    throw err;
  });
  return loading;
}
