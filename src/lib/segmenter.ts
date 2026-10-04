import type { FaceLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';

// MediaPipe models for the camera looks, loaded only when a look needs them:
// person segmentation for Background Blur, and face landmarks for face shaping and
// makeup. The WASM runtime comes from jsDelivr (pinned to the installed version) and
// the models are served from our own /models.
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

type Vision = typeof import('@mediapipe/tasks-vision');
type Fileset = Awaited<ReturnType<Vision['FilesetResolver']['forVisionTasks']>>;

let runtime: Promise<{ vision: Vision; files: Fileset }> | null = null;

function loadRuntime() {
  runtime ??= (async () => {
    const vision = await import('@mediapipe/tasks-vision');
    const files = await vision.FilesetResolver.forVisionTasks(WASM);
    return { vision, files };
  })().catch((err) => {
    runtime = null;
    throw err;
  });
  return runtime;
}

// Each loader keeps one shared instance and lets a later attempt retry after a failure.
function cached<T>(create: () => Promise<T>) {
  let p: Promise<T> | null = null;
  return () => {
    p ??= create().catch((err) => {
      p = null;
      throw err;
    });
    return p;
  };
}

export const loadSegmenter = cached<ImageSegmenter>(async () => {
  const { vision, files } = await loadRuntime();
  const create = (delegate: 'GPU' | 'CPU') =>
    vision.ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: '/models/selfie_segmenter.tflite', delegate },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  return create('GPU').catch(() => create('CPU'));
});

export const loadFaceLandmarker = cached<FaceLandmarker>(async () => {
  const { vision, files } = await loadRuntime();
  const create = (delegate: 'GPU' | 'CPU') =>
    vision.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
  return create('GPU').catch(() => create('CPU'));
});
