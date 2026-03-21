/**
 * AEVP Phase 2 — Shader Compilation & Uniform Management
 *
 * Handles WebGL2 shader compilation, program linking, and
 * cached uniform location lookups.
 */

// ── Shader Compilation ─────────────────────────────────────────────────────

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

export function linkProgram(
  gl: WebGL2RenderingContext,
  vertSource: string,
  fragSource: string,
): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSource);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSource);
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create program");
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    throw new Error(`Program link error: ${info}`);
  }
  // Shaders can be detached after linking
  gl.detachShader(program, vert);
  gl.detachShader(program, frag);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  return program;
}

// ── Uniform Manager ────────────────────────────────────────────────────────

export class UniformManager {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private cache: Map<string, WebGLUniformLocation | null> = new Map();

  constructor(gl: WebGL2RenderingContext, program: WebGLProgram) {
    this.gl = gl;
    this.program = program;
  }

  private loc(name: string): WebGLUniformLocation | null {
    if (this.cache.has(name)) return this.cache.get(name)!;
    const location = this.gl.getUniformLocation(this.program, name);
    this.cache.set(name, location);
    return location;
  }

  float(name: string, value: number): void {
    const l = this.loc(name);
    if (l) this.gl.uniform1f(l, value);
  }

  vec2(name: string, x: number, y: number): void {
    const l = this.loc(name);
    if (l) this.gl.uniform2f(l, x, y);
  }

  vec3(name: string, x: number, y: number, z: number): void {
    const l = this.loc(name);
    if (l) this.gl.uniform3f(l, x, y, z);
  }

  vec4(name: string, x: number, y: number, z: number, w: number): void {
    const l = this.loc(name);
    if (l) this.gl.uniform4f(l, x, y, z, w);
  }

  int(name: string, value: number): void {
    const l = this.loc(name);
    if (l) this.gl.uniform1i(l, value);
  }
}

// ── Fullscreen Quad ────────────────────────────────────────────────────────

/** Creates a VAO for a fullscreen triangle strip quad (2 triangles, 4 verts). */
export function createFullscreenQuad(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("Failed to create VAO");
  gl.bindVertexArray(vao);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // Two triangles covering clip space
  // prettier-ignore
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
     1,  1,
  ]), gl.STATIC_DRAW);

  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);
  return vao;
}

// ── Framebuffer ────────────────────────────────────────────────────────────

export interface FBO {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

/**
 * Enable float FBO rendering for this specific GL context.
 * Must be called once per context before creating FBOs.
 * Returns whether RGBA16F is supported.
 */
export function enableFloatFBO(gl: WebGL2RenderingContext): boolean {
  const ext = gl.getExtension("EXT_color_buffer_float");
  if (!ext) {
    console.warn("[AEVP] EXT_color_buffer_float not available, using RGBA8 FBOs");
  }
  return ext !== null;
}

export function createFBO(gl: WebGL2RenderingContext, width: number, height: number): FBO {
  const framebuffer = gl.createFramebuffer()!;
  const texture = gl.createTexture()!;

  gl.bindTexture(gl.TEXTURE_2D, texture);
  // Always use RGBA8 — universally supported, no extension issues
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  // Verify completeness
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.error("[AEVP] FBO incomplete, status:", status);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { framebuffer, texture };
}

export function resizeFBO(
  gl: WebGL2RenderingContext,
  fbo: FBO,
  width: number,
  height: number,
): void {
  gl.bindTexture(gl.TEXTURE_2D, fbo.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
}
