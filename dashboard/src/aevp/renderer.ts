/**
 * AEVP Phase 2 — WebGL2 Renderer Engine
 *
 * 3-pass render pipeline: ambient orb, particle overlay, bloom post-process.
 * Drives all visuals from AEVPRenderState computed by colorMapping.ts.
 */

import type { AEVPRenderState } from "./types";
import {
  ParticleSystem,
  type ParticleFormationRequest,
  type ParticleSymbolExpressionRequest,
} from "./particles";
import { getFrameIntervalMs } from "./pi-profile";
import ambientFrag from "./shaders/ambient.frag?raw";
// Vite raw imports for GLSL sources
import ambientVert from "./shaders/ambient.vert?raw";
import bloomFrag from "./shaders/bloom.frag?raw";
import {
  linkProgram,
  UniformManager,
  createFullscreenQuad,
  createFBO,
  resizeFBO,
  enableFloatFBO,
  type FBO,
} from "./shaders/compile";
import particlesFrag from "./shaders/particles.frag?raw";
import particlesVert from "./shaders/particles.vert?raw";

// ── Constants ────────────────────────────────────────────────────────────────

const FLOATS_PER_PARTICLE = 7;
const FLOAT_BYTES = 4;
const STRIDE = FLOATS_PER_PARTICLE * FLOAT_BYTES; // 28 bytes

// ── Renderer ─────────────────────────────────────────────────────────────────

export class AEVPRenderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;

  // Programs
  private ambientProgram: WebGLProgram;
  private particleProgram: WebGLProgram;
  private bloomProgram: WebGLProgram;

  // Uniforms
  private ambientUniforms: UniformManager;
  private bloomUniforms: UniformManager;

  // Geometry
  private quadVAO: WebGLVertexArrayObject;
  private particleVAO: WebGLVertexArrayObject;
  private particleVBO: WebGLBuffer;

  // FBOs for multi-pass
  private sceneFBO: FBO;
  private bloomFBO: FBO;

  // Particle system
  private particles: ParticleSystem;

  // Animation state
  private rafId: number = 0;
  private running: boolean = false;
  private time: number = 0;
  private lastFrameTime: number = 0;
  private contextLost: boolean = false;
  private orbCenter: [number, number] = [0.5, 0.65];
  private presenceOffsetPx: [number, number] = [0, 0];
  private presenceScale: number = 1;

  // Phase 3: lerped state transitions
  private targetState: AEVPRenderState | null = null;
  private currentState: AEVPRenderState | null = null;

  // Event listeners (stored for cleanup)
  private onContextLost: (e: Event) => void;
  private onContextRestored: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
    });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;

    // Context loss handling
    this.onContextLost = (e: Event) => {
      e.preventDefault();
      this.contextLost = true;
      console.warn("[AEVP] WebGL context lost");
    };
    this.onContextRestored = () => {
      this.contextLost = false;
      console.warn("[AEVP] WebGL context restored — reinitializing");
      this.initGL();
    };
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);

    this.particles = new ParticleSystem();

    // Initialize all GL resources
    this.ambientProgram = null!;
    this.particleProgram = null!;
    this.bloomProgram = null!;
    this.ambientUniforms = null!;
    this.bloomUniforms = null!;
    this.quadVAO = null!;
    this.particleVAO = null!;
    this.particleVBO = null!;
    this.sceneFBO = null!;
    this.bloomFBO = null!;
    this.initGL();
  }

  /** Start the render loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.tick(this.lastFrameTime);
  }

  /** Stop the render loop. */
  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /** Resize the renderer to match canvas dimensions. */
  resize(width: number, height: number): void {
    const gl = this.gl;
    this.canvas.width = width;
    this.canvas.height = height;
    resizeFBO(gl, this.sceneFBO, width, height);
    resizeFBO(gl, this.bloomFBO, width, height);
  }

  /** Update the visual state driving all render parameters. */
  updateState(state: AEVPRenderState): void {
    this.targetState = state;
    // Initialize currentState on first call (snap, no lerp)
    if (!this.currentState) {
      this.currentState = {
        ...state,
        coreColor: [...state.coreColor],
        glowColor: [...state.glowColor],
      };
    }
  }

  /** Update speech amplitude directly (bypasses React re-renders). */
  setSpeechAmplitude(v: number): void {
    if (this.targetState) {
      this.targetState.speechAmplitude = v;
    }
  }

  /** Move orb anchor within the canvas (0..1 UV space). */
  setOrbCenter(x: number, y: number): void {
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    this.orbCenter = [clamp(x), clamp(y)];
  }

  /** Move/scale orb + particle composition without moving the background field. */
  setPresenceTransform(offsetXPx: number, offsetYPx: number, scale: number): void {
    this.presenceOffsetPx = [offsetXPx, offsetYPx];
    this.presenceScale = Math.max(0.25, scale);
  }

  /** Trigger temporary particle text/glyph formation mode. */
  requestFormation(request: ParticleFormationRequest): void {
    this.particles.startFormation(request);
  }

  /** Trigger temporary symbolic particle behavior expression. */
  requestSymbolExpression(request: ParticleSymbolExpressionRequest): void {
    this.particles.startSymbolExpression(request);
  }

  /** Clean up all GL resources and stop rendering. */
  destroy(): void {
    this.stop();
    const gl = this.gl;

    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);

    if (this.contextLost) return;

    gl.deleteProgram(this.ambientProgram);
    gl.deleteProgram(this.particleProgram);
    gl.deleteProgram(this.bloomProgram);
    gl.deleteVertexArray(this.quadVAO);
    gl.deleteVertexArray(this.particleVAO);
    gl.deleteBuffer(this.particleVBO);
    gl.deleteFramebuffer(this.sceneFBO.framebuffer);
    gl.deleteTexture(this.sceneFBO.texture);
    gl.deleteFramebuffer(this.bloomFBO.framebuffer);
    gl.deleteTexture(this.bloomFBO.texture);
  }

  // ── Private: GL Initialization ───────────────────────────────────────────

  private initGL(): void {
    const gl = this.gl;
    const w = this.canvas.width || 1;
    const h = this.canvas.height || 1;

    // Enable float FBOs if supported (must be before createFBO calls)
    enableFloatFBO(gl);

    // Compile shader programs
    this.ambientProgram = linkProgram(gl, ambientVert, ambientFrag);
    this.particleProgram = linkProgram(gl, particlesVert, particlesFrag);
    this.bloomProgram = linkProgram(gl, ambientVert, bloomFrag); // reuses ambient.vert

    // Uniform managers
    this.ambientUniforms = new UniformManager(gl, this.ambientProgram);
    this.bloomUniforms = new UniformManager(gl, this.bloomProgram);

    // Fullscreen quad
    this.quadVAO = createFullscreenQuad(gl);

    // Particle VAO + VBO
    this.particleVBO = gl.createBuffer()!;
    this.particleVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.particleVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVBO);

    // a_position: location=0, vec2, offset 0
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE, 0);

    // a_size: location=1, float, offset 8
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, STRIDE, 2 * FLOAT_BYTES);

    // a_alpha: location=2, float, offset 12
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, STRIDE, 3 * FLOAT_BYTES);

    // a_color: location=3, vec3, offset 16
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, STRIDE, 4 * FLOAT_BYTES);

    gl.bindVertexArray(null);

    // FBOs
    this.sceneFBO = createFBO(gl, w, h);
    this.bloomFBO = createFBO(gl, w, h);

    // GL state defaults
    gl.enable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
  }

  // ── Private: Render Loop ────────────────────────────────────────────────

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    if (this.contextLost) return;

    // Pi profile: throttle ticks to >= frameIntervalMs between renders.
    const frameInterval = getFrameIntervalMs();
    if (frameInterval > 0 && now - this.lastFrameTime < frameInterval) {
      return;
    }

    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1); // Cap at 100ms
    this.lastFrameTime = now;

    // Early-out: no state yet
    if (!this.targetState || !this.currentState) return;

    // Phase 3: Lerp currentState toward targetState (~1s transition)
    this.lerpState(dt);

    // Always render — breathing, pulse, and particle animations are time-driven
    this.time += dt;
    this.render(dt);
  };

  /** Lerp all numeric fields in currentState toward targetState. */
  private lerpState(dt: number): void {
    const cur = this.currentState!;
    const tgt = this.targetState!;
    const t = Math.min(1, 3.0 * dt); // ~1s convergence at 60fps

    // Colors
    cur.coreColor[0] += (tgt.coreColor[0] - cur.coreColor[0]) * t;
    cur.coreColor[1] += (tgt.coreColor[1] - cur.coreColor[1]) * t;
    cur.coreColor[2] += (tgt.coreColor[2] - cur.coreColor[2]) * t;
    cur.glowColor[0] += (tgt.glowColor[0] - cur.glowColor[0]) * t;
    cur.glowColor[1] += (tgt.glowColor[1] - cur.glowColor[1]) * t;
    cur.glowColor[2] += (tgt.glowColor[2] - cur.glowColor[2]) * t;

    // Numeric scalars
    cur.glowIntensity += (tgt.glowIntensity - cur.glowIntensity) * t;
    cur.breathingRate += (tgt.breathingRate - cur.breathingRate) * t;
    cur.breathingDepth += (tgt.breathingDepth - cur.breathingDepth) * t;
    cur.pulseIntensity += (tgt.pulseIntensity - cur.pulseIntensity) * t;
    cur.edgeCoherence += (tgt.edgeCoherence - cur.edgeCoherence) * t;
    cur.formExpansion += (tgt.formExpansion - cur.formExpansion) * t;
    cur.particleSpeed += (tgt.particleSpeed - cur.particleSpeed) * t;
    cur.particleCount += (tgt.particleCount - cur.particleCount) * t;

    // Shape morphing (lerps smoothly between mood shapes)
    cur.squash += (tgt.squash - cur.squash) * t;
    cur.wobble += (tgt.wobble - cur.wobble) * t;

    // Speech amplitude lerps faster for responsiveness
    const speechT = Math.min(1, 12.0 * dt);
    cur.speechAmplitude += (tgt.speechAmplitude - cur.speechAmplitude) * speechT;

    // Snap non-numeric fields immediately
    cur.toolCategory = tgt.toolCategory;
    cur.resonanceTargets = tgt.resonanceTargets;
  }

  private render(dt: number): void {
    const gl = this.gl;
    const state = this.currentState!;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Update particle simulation
    this.particles.update(dt, state);
    const formationActive = this.particles.isFormationActive();

    // ── Pass 1: Ambient orb → scene FBO ──────────────────────────────────

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.ambientProgram);
    const au = this.ambientUniforms;
    au.float("u_time", this.time);
    au.vec2("u_resolution", w, h);
    au.vec3("u_coreColor", state.coreColor[0], state.coreColor[1], state.coreColor[2]);
    au.vec3("u_glowColor", state.glowColor[0], state.glowColor[1], state.glowColor[2]);
    au.float("u_glowIntensity", state.glowIntensity);
    au.float("u_breathingRate", state.breathingRate);
    au.float("u_breathingDepth", state.breathingDepth);
    au.float("u_edgeCoherence", state.edgeCoherence);
    au.float("u_formExpansion", state.formExpansion);
    au.float("u_pulseIntensity", state.pulseIntensity);
    au.vec2("u_orbCenter", this.orbCenter[0], this.orbCenter[1]);
    au.vec2("u_presenceOffset", this.presenceOffsetPx[0] / w, this.presenceOffsetPx[1] / h);
    au.float("u_presenceScale", this.presenceScale);
    au.float("u_squash", state.squash);
    au.float("u_wobble", state.wobble);
    au.float("u_speechAmplitude", state.speechAmplitude);

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ── Pass 2: Particles → same scene FBO (additive blending) ──────────

    const particleCount = this.particles.getActiveCount();
    if (particleCount > 0) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      if (!formationActive) {
        // Preserve legacy ambient brightness outside formation mode.
        gl.blendFunc(gl.ONE, gl.ONE);
      }

      gl.useProgram(this.particleProgram);
      const particleOffsetX = (this.presenceOffsetPx[0] / w) * 2.0;
      const particleOffsetY = -(this.presenceOffsetPx[1] / h) * 2.0;
      const particleOffsetLoc = gl.getUniformLocation(this.particleProgram, "u_presenceOffset");
      const particleScaleLoc = gl.getUniformLocation(this.particleProgram, "u_presenceScale");
      gl.uniform2f(particleOffsetLoc, particleOffsetX, particleOffsetY);
      gl.uniform1f(particleScaleLoc, this.presenceScale);

      // Upload particle data
      const data = this.particles.getBufferData();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVBO);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);

      gl.bindVertexArray(this.particleVAO);
      gl.drawArrays(gl.POINTS, 0, particleCount);
    }

    // ── Pass 3: Bloom — separable Gaussian blur ──────────────────────────

    gl.useProgram(this.bloomProgram);
    const bu = this.bloomUniforms;
    bu.float("u_intensity", 1.5);
    bu.int("u_scene", 0);

    // Horizontal blur: scene → bloom FBO (wider kernel for bigger glow)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFBO.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneFBO.texture);
    bu.vec2("u_direction", 2.5 / w, 0);

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Vertical blur: bloom → scene FBO (reuse as ping-pong)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindTexture(gl.TEXTURE_2D, this.bloomFBO.texture);
    bu.vec2("u_direction", 0, 2.5 / h);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ── Pass 4: Composite to screen ──────────────────────────────────────

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Draw the blurred scene
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    bu.float("u_intensity", 1.0);
    bu.vec2("u_direction", 0, 0); // Pass-through

    gl.bindTexture(gl.TEXTURE_2D, this.sceneFBO.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Strong additive bloom layer — visible glow halo
    gl.blendFunc(gl.ONE, gl.ONE);
    bu.float("u_intensity", formationActive ? 0.45 : 0.8);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomFBO.texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindVertexArray(null);
  }
}
