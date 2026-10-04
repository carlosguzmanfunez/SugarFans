import type { Track, TrackProcessor, VideoProcessorOptions } from 'livekit-client';
import type { FaceLandmarker, ImageSegmenter, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { lookParams, needsFace, isLightDevice, type LookId, type LookParams } from './videoLooks';
import { loadFaceLandmarker, loadSegmenter } from './segmenter';

// LiveKit video processor that draws each camera frame through a WebGL shader
// (face shaping, smoothing, light and colour, makeup, optional background blur) onto a
// canvas, and hands
// LiveKit the canvas stream to publish. One instance stays on the track while the
// look changes, so switching looks never interrupts the call.
export type LookFailure = 'slow' | 'blur' | 'gl' | 'face';

const VERT = 'attribute vec2 p;varying vec2 uv;void main(){uv=p*0.5+0.5;gl_Position=vec4(p,0.0,1.0);}';

const HEAD = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 uv;
`;

// Separable 9-tap Gaussian (linear-sampling weights).
const BLUR_FRAG = `${HEAD}uniform sampler2D src;uniform vec2 dir;
void main(){
  vec4 c=texture2D(src,uv)*0.2270270270;
  c+=(texture2D(src,uv+dir*1.3846153846)+texture2D(src,uv-dir*1.3846153846))*0.3162162162;
  c+=(texture2D(src,uv+dir*3.2307692308)+texture2D(src,uv-dir*3.2307692308))*0.0702702703;
  gl_FragColor=c;
}`;

// Edge-preserving smoothing taps on two rings around the pixel.
const TAPS = [1, 2]
  .flatMap((r) =>
    Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4 + (r === 2 ? Math.PI / 8 : 0);
      return `tap(vec2(${(Math.cos(a) * r).toFixed(4)},${(Math.sin(a) * r).toFixed(4)}),c0,sum,w);`;
    })
  )
  .join('\n');

const FINAL_FRAG = `${HEAD}uniform sampler2D src;uniform sampler2D bg;uniform sampler2D mask;
uniform vec2 radius;uniform float smoothAmt;uniform float exposure;uniform float contrast;
uniform float saturation;uniform float warmth;uniform float lift;uniform float useBlur;
uniform float glow;uniform float blush;uniform float rose;
uniform vec2 aspect;uniform vec4 warpC[6];uniform vec2 warpV[6];
uniform vec4 lips;uniform float lipAng;uniform vec3 lipColor;uniform float lipAmt;
uniform vec4 irisL;uniform vec4 irisR;uniform vec3 irisColor;uniform float irisAmt;
vec2 suv;
// Face shaping: each control point pushes (warpV) or magnifies (warpC.w) the picture
// inside a soft circle of radius warpC.z (measured with the picture's aspect ratio).
vec2 warp(vec2 p){
  vec2 d=vec2(0.0);
  for(int i=0;i<6;i++){
    vec4 c=warpC[i];
    if(c.z>0.0){float t=length((p-c.xy)*aspect)/c.z;
      if(t<1.0){float f=1.0-t*t;f*=f;d-=(warpV[i]+(p-c.xy)*c.w)*f;}}
  }
  return p+d;
}
float irisMask(vec4 ir){
  if(ir.z<=0.0)return 0.0;
  float d=length((suv-ir.xy)*aspect)/ir.z;
  return (1.0-smoothstep(0.75,1.0,d))*smoothstep(0.25,0.45,d);
}
void tap(vec2 o,vec3 c,inout vec3 sum,inout float w){
  vec3 s=texture2D(src,suv+o*radius).rgb;vec3 d=s-c;float k=exp(-dot(d,d)*90.0);sum+=s*k;w+=k;
}
float skin(vec3 c){
  float cb=-0.1687*c.r-0.3313*c.g+0.5*c.b;float cr=0.5*c.r-0.4187*c.g-0.0813*c.b;
  return smoothstep(-0.25,-0.18,cb)*(1.0-smoothstep(0.0,0.06,cb))*smoothstep(0.0,0.04,cr)*(1.0-smoothstep(0.18,0.24,cr));
}
vec3 grade(vec3 c){
  c*=exposure;c+=lift*(1.0-c)*(1.0-c);c=(c-0.5)*contrast+0.5;
  float l=dot(c,vec3(0.299,0.587,0.114));c=mix(vec3(l),c,saturation);
  c+=vec3(warmth,warmth*0.25,-warmth);c+=rose*vec3(0.05,-0.015,0.035);return clamp(c,0.0,1.0);
}
void main(){
  suv=warp(uv);
  vec3 c0=texture2D(src,suv).rgb;vec3 c=c0;
  if(smoothAmt>0.0){vec3 sum=c0;float w=1.0;
${TAPS}
    float sk=skin(c0);vec3 sm=sum/w;
    c=mix(c0,sm,min(1.0,smoothAmt*(0.35+0.65*sk)));
    // Retouch: soft glow from the smoothed picture and a little colour on the skin.
    c=1.0-(1.0-c)*(1.0-sm*glow);
    c=mix(c,c*vec3(1.05,0.96,0.99)+vec3(0.015,0.0,0.01),blush*sk);}
  c=grade(c);
  if(lipAmt>0.0){
    vec2 q=(suv-lips.xy)*aspect;float cs=cos(lipAng);float sn=sin(lipAng);
    q=vec2(cs*q.x+sn*q.y,-sn*q.x+cs*q.y);
    float m=1.0-smoothstep(0.7,1.0,length(q/lips.zw));
    float red=smoothstep(0.0,0.07,c0.r-c0.g);
    float l=dot(c,vec3(0.299,0.587,0.114));
    vec3 t=clamp(lipColor*l/dot(lipColor,vec3(0.299,0.587,0.114)),0.0,1.0);
    c=mix(c,t,lipAmt*m*red);
  }
  if(irisAmt>0.0){
    float l=dot(c0,vec3(0.299,0.587,0.114));
    float m=max(irisMask(irisL),irisMask(irisR))*(1.0-smoothstep(0.45,0.7,l));
    c=mix(c,clamp(irisColor*(0.3+l*1.3),0.0,1.0),irisAmt*m);
  }
  if(useBlur>0.5){vec3 b=grade(texture2D(bg,suv).rgb);float m=smoothstep(0.3,0.7,texture2D(mask,suv).r);c=mix(b,c,m);}
  gl_FragColor=vec4(c,1.0);
}`;

// Timers on the main thread are throttled to 1/s in background tabs; a worker's are not.
function makeTicker(fps: number, tick: () => void): () => void {
  try {
    const url = URL.createObjectURL(new Blob(['let t;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}'], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    w.onmessage = tick;
    w.postMessage(1000 / fps);
    return () => w.terminate();
  } catch {
    const t = setInterval(tick, 1000 / fps);
    return () => clearInterval(t);
  }
}

interface Programs {
  blur: WebGLProgram;
  final: WebGLProgram;
}

export class LookProcessor implements TrackProcessor<Track.Kind.Video, VideoProcessorOptions> {
  name = 'fans-reserve-looks';
  processedTrack?: MediaStreamTrack;

  look: LookId;
  enhance: boolean;
  shape: boolean;
  private params: LookParams;
  private onFail?: (why: LookFailure) => void;
  private failed = false;

  private canvas?: HTMLCanvasElement;
  private gl?: WebGLRenderingContext;
  private prog?: Programs;
  private srcTex?: WebGLTexture;
  private maskTex?: WebGLTexture;
  private fbo: { tex: WebGLTexture; fb: WebGLFramebuffer }[] = [];
  private blurSize = [0, 0];
  private video?: HTMLVideoElement;
  private ownVideo = false;
  private stopTicker?: () => void;
  private maxSide = 1920;

  private segmenter?: ImageSegmenter;
  private segLoading = false;
  private maskPrev?: Float32Array;
  private maskBytes?: Uint8Array;
  private segEvery = 1;
  private frame = 0;
  private lastTs = 0;
  private avgMs = 0;
  private lastEnd = 0;
  private pixel = new Uint8Array(4);

  private face?: FaceLandmarker;
  private faceLoading = false;
  private faceBroken = false;
  private faceEvery = 1;
  private faceTs = 0;
  private faceMiss = 0;
  private pts?: Float32Array; // smoothed landmarks in uv (x, y up), 2 per point
  private warpC = new Float32Array(24);
  private warpV = new Float32Array(12);

  constructor(look: LookId, enhance: boolean, onFail?: (why: LookFailure) => void, shape = false) {
    this.look = look;
    this.enhance = enhance;
    this.shape = shape;
    this.params = lookParams(look, enhance, shape);
    this.onFail = onFail;
  }

  get isFailed() {
    return this.failed;
  }

  /** Changes the look in place, without touching the published track. */
  setLook(look: LookId, enhance: boolean, shape = false) {
    this.look = look;
    this.enhance = enhance;
    this.shape = shape;
    this.params = lookParams(look, enhance, shape);
    this.avgMs = 0;
    this.frame = 0;
    this.ensureModels();
  }

  private ensureModels() {
    if (this.params.blur) this.ensureSegmenter();
    if (needsFace(this.params)) this.ensureFace();
  }

  private ensureFace() {
    if (this.face || this.faceLoading || this.faceBroken) return;
    this.faceLoading = true;
    loadFaceLandmarker()
      .then((f) => {
        this.face = f;
        this.frame = 0; // its first frames are slow: restart the speed check
      })
      .catch(() => this.faceFail())
      .finally(() => (this.faceLoading = false));
  }

  // Face features are extras: if they can't run, the look carries on without them.
  private faceFail() {
    if (this.faceBroken) return;
    this.faceBroken = true;
    this.face = undefined;
    this.pts = undefined;
    this.onFail?.('face');
  }

  async init(opts: VideoProcessorOptions) {
    this.maxSide = isLightDevice() ? 1280 : 1920;
    const canvas = document.createElement('canvas');
    const s = opts.track.getSettings();
    this.fitCanvas(canvas, s.width || 1280, s.height || 720);
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('WebGL no disponible');
    this.canvas = canvas;
    this.gl = gl;
    this.setupGl(gl);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.fail('gl');
    });
    this.useSource(opts);
    this.processedTrack = canvas.captureStream(30).getVideoTracks()[0];
    this.ensureModels();
    this.stopTicker = makeTicker(30, () => {
      // Ticks that queued up while a slow frame was drawing are dropped, not replayed.
      if (performance.now() - this.lastEnd < 20) return;
      this.render();
      this.lastEnd = performance.now();
    });
  }

  async restart(opts: VideoProcessorOptions) {
    // Camera turned back on or switched: same canvas and published track, new source.
    this.useSource(opts);
  }

  async destroy() {
    this.stopTicker?.();
    this.stopTicker = undefined;
    if (this.ownVideo && this.video) this.video.srcObject = null;
    this.video = undefined;
    this.processedTrack?.stop();
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = undefined;
    this.canvas = undefined;
  }

  private useSource(opts: VideoProcessorOptions) {
    if (opts.element instanceof HTMLVideoElement) {
      this.video = opts.element;
      this.ownVideo = false;
    } else {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.srcObject = new MediaStream([opts.track]);
      v.play().catch(() => undefined);
      this.video = v;
      this.ownVideo = true;
    }
  }

  private fail(why: LookFailure) {
    if (this.failed) return;
    this.failed = true;
    this.onFail?.(why);
  }

  private ensureSegmenter() {
    if (this.segmenter || this.segLoading) return;
    this.segLoading = true;
    loadSegmenter()
      .then((s) => {
        this.segmenter = s;
        this.frame = 0; // its first frames are slow: restart the speed check
      })
      .catch(() => this.fail('blur'))
      .finally(() => (this.segLoading = false));
  }

  private fitCanvas(canvas: HTMLCanvasElement, vw: number, vh: number) {
    const k = Math.min(1, this.maxSide / Math.max(vw, vh));
    const w = Math.max(2, Math.round((vw * k) / 2) * 2);
    const h = Math.max(2, Math.round((vh * k) / 2) * 2);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  private setupGl(gl: WebGLRenderingContext) {
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader');
      return sh;
    };
    const link = (frag: string) => {
      const p = gl.createProgram()!;
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
      gl.bindAttribLocation(p, 0, 'p');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'program');
      return p;
    };
    this.prog = { blur: link(BLUR_FRAG), final: link(FINAL_FRAG) };
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // Camera frames and masks arrive top row first; flip so uv (0,0) is bottom-left.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.srcTex = this.texture(gl);
    this.maskTex = this.texture(gl);
    // Until the first mask arrives, everything counts as the person (nothing blurred).
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([255]));
    this.fbo = [0, 1].map(() => {
      const tex = this.texture(gl);
      const fb = gl.createFramebuffer()!;
      return { tex, fb };
    });
  }

  private texture(gl: WebGLRenderingContext) {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private sizeBlurTargets(gl: WebGLRenderingContext, w: number, h: number) {
    const bw = Math.max(1, Math.round(w / 4));
    const bh = Math.max(1, Math.round(h / 4));
    if (this.blurSize[0] === bw && this.blurSize[1] === bh) return;
    this.blurSize = [bw, bh];
    for (const { tex, fb } of this.fbo) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, bw, bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private segment(v: HTMLVideoElement) {
    const gl = this.gl!;
    const seg = this.segmenter;
    if (!seg || this.frame % this.segEvery !== 0) return;
    // MediaPipe needs strictly increasing timestamps.
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;
    seg.segmentForVideo(v, ts, (res) => {
      const masks = res.confidenceMasks;
      const m = masks?.[masks.length - 1]; // the person channel is the last one
      if (!m) return;
      const f = m.getAsFloat32Array();
      if (!this.maskPrev || this.maskPrev.length !== f.length) {
        this.maskPrev = new Float32Array(f);
        this.maskBytes = new Uint8Array(f.length);
      }
      const prev = this.maskPrev;
      const bytes = this.maskBytes!;
      for (let i = 0; i < f.length; i++) {
        prev[i] = prev[i] * 0.4 + f[i] * 0.6; // steadier edges between frames
        bytes[i] = prev[i] * 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex!);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, m.width, m.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes);
    });
  }

  private detectFace(v: HTMLVideoElement) {
    const face = this.face;
    if (!face || this.frame % this.faceEvery !== 0) return;
    const ts = Math.max(performance.now(), this.faceTs + 1);
    this.faceTs = ts;
    const lm: NormalizedLandmark[] | undefined = face.detectForVideo(v, ts).faceLandmarks?.[0];
    if (!lm || lm.length < 478) {
      if (++this.faceMiss > 8) this.pts = undefined; // face gone: stop shaping
      return;
    }
    this.faceMiss = 0;
    const prev = this.pts;
    const next = new Float32Array(lm.length * 2);
    for (let i = 0; i < lm.length; i++) {
      // Landmarks are top-left based; our texture space has y going up. Smooth jitter.
      const x = lm[i].x;
      const y = 1 - lm[i].y;
      next[i * 2] = prev ? prev[i * 2] * 0.3 + x * 0.7 : x;
      next[i * 2 + 1] = prev ? prev[i * 2 + 1] * 0.3 + y * 0.7 : y;
    }
    this.pts = next;
  }

  // Turns the landmarks into shader controls: 4 jaw pushes and 2 eye magnifiers,
  // a rotated ellipse over the lips and two iris circles.
  private faceUniforms(gl: WebGLRenderingContext, f: WebGLProgram, aspect: number) {
    const u = (n: string) => gl.getUniformLocation(f, n);
    const p = this.params;
    const pts = this.pts;
    this.warpC.fill(0);
    this.warpV.fill(0);
    let lipAmt = 0;
    let irisAmt = 0;
    if (pts) {
      const P = (i: number): [number, number] => [pts[i * 2], pts[i * 2 + 1]];
      const dist = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1]);
      const avg = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const faceW = dist(P(234), P(454));
      const mid = avg(P(234), P(454));
      let k = 0;
      if (p.slim > 0) {
        for (const i of [132, 361, 172, 397]) {
          const j = P(i);
          this.warpC.set([j[0], j[1], faceW * 0.24, 0], k * 4);
          this.warpV.set([(mid[0] - j[0]) * 0.14 * p.slim, (mid[1] - j[1]) * 0.14 * p.slim], k * 2);
          k++;
        }
      }
      if (p.eyes > 0) {
        for (const [a, b] of [[33, 133], [362, 263]]) {
          const c = avg(P(a), P(b));
          this.warpC.set([c[0], c[1], dist(P(a), P(b)) * 1.1, 0.2 * p.eyes], k * 4);
          k++;
        }
      }
      if (p.lip > 0) {
        const c = avg(P(0), P(17));
        const l = P(61);
        const r = P(291);
        gl.uniform4f(u('lips'), c[0], c[1], (dist(l, r) / 2) * 1.15, (dist(P(0), P(17)) / 2) * 1.25);
        gl.uniform1f(u('lipAng'), Math.atan2(r[1] - l[1], (r[0] - l[0]) * aspect));
        gl.uniform3fv(u('lipColor'), p.lipColor);
        lipAmt = p.lip;
      }
      if (p.iris > 0) {
        gl.uniform4f(u('irisL'), pts[468 * 2], pts[468 * 2 + 1], dist(P(468), P(469)) * 1.05, 0);
        gl.uniform4f(u('irisR'), pts[473 * 2], pts[473 * 2 + 1], dist(P(473), P(474)) * 1.05, 0);
        gl.uniform3fv(u('irisColor'), p.irisColor);
        irisAmt = p.iris;
      }
    }
    gl.uniform2f(u('aspect'), aspect, 1);
    gl.uniform4fv(u('warpC'), this.warpC);
    gl.uniform2fv(u('warpV'), this.warpV);
    gl.uniform1f(u('lipAmt'), lipAmt);
    gl.uniform1f(u('irisAmt'), irisAmt);
  }

  private render() {
    const gl = this.gl;
    const v = this.video;
    const canvas = this.canvas;
    const prog = this.prog;
    if (!gl || !v || !canvas || !prog || this.failed || gl.isContextLost()) return;
    if (v.readyState < 2 || !v.videoWidth) return;
    const t0 = performance.now();
    this.fitCanvas(canvas, v.videoWidth, v.videoHeight);
    const { width: w, height: h } = canvas;
    const p = this.params;
    const blur = p.blur && !!this.segmenter;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex!);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);

    if (needsFace(p) && this.face) {
      try {
        this.detectFace(v);
      } catch {
        this.faceFail();
      }
    }

    if (blur) {
      try {
        this.segment(v);
      } catch {
        this.fail('blur');
        return;
      }
      this.sizeBlurTargets(gl, w, h);
      const [bw, bh] = this.blurSize;
      gl.useProgram(prog.blur);
      gl.viewport(0, 0, bw, bh);
      const dirLoc = gl.getUniformLocation(prog.blur, 'dir');
      gl.uniform1i(gl.getUniformLocation(prog.blur, 'src'), 0);
      // Three rounds of horizontal + vertical passes at quarter size: a strong, cheap blur.
      let from = this.srcTex!;
      for (let i = 0; i < 6; i++) {
        const to = this.fbo[i % 2];
        gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, from);
        gl.uniform2f(dirLoc, i % 2 ? 0 : 1.5 / bw, i % 2 ? 1.5 / bh : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        from = to.tex;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    const f = prog.final;
    gl.useProgram(f);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex!);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fbo[1].tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex!);
    const u = (n: string) => gl.getUniformLocation(f, n);
    gl.uniform1i(u('src'), 0);
    gl.uniform1i(u('bg'), 1);
    gl.uniform1i(u('mask'), 2);
    const r = (h / 180) * p.reach; // smoothing reach scales with the picture size
    gl.uniform2f(u('radius'), r / w, r / h);
    gl.uniform1f(u('smoothAmt'), p.smooth);
    gl.uniform1f(u('exposure'), p.exposure);
    gl.uniform1f(u('contrast'), p.contrast);
    gl.uniform1f(u('saturation'), p.saturation);
    gl.uniform1f(u('warmth'), p.warmth);
    gl.uniform1f(u('lift'), p.lift);
    gl.uniform1f(u('glow'), p.glow);
    gl.uniform1f(u('blush'), p.blush);
    gl.uniform1f(u('rose'), p.rose);
    this.faceUniforms(gl, f, w / h);
    gl.uniform1f(u('useBlur'), blur ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // Wait for the GPU to finish this frame, so slow devices can't pile up work and
    // the timing below includes the GPU.
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel);

    this.watchSpeed(performance.now() - t0, blur);
    this.frame++;
  }

  // Phones that can't keep up first segment less often, then drop back to Natural
  // rather than freezing the picture or draining the battery.
  private watchSpeed(ms: number, blur: boolean) {
    // The first second includes one-off warm-up (shader compile, model load): skip it.
    if (this.frame < 30) return;
    this.avgMs = this.frame === 30 ? ms : this.avgMs * 0.95 + ms * 0.05;
    if (this.frame < 90 || this.frame % 30 !== 0) return;
    if (this.avgMs > 28) {
      if (this.face && needsFace(this.params) && this.faceEvery < 3) {
        this.faceEvery++;
        return;
      }
      if (blur && this.segEvery < 3) {
        this.segEvery++;
        return;
      }
    }
    if (this.avgMs > 55) this.fail('slow');
  }
}
