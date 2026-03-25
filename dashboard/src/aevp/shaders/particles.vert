#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;  // particle center (clip space)
layout(location = 1) in float a_size;     // point size in pixels
layout(location = 2) in float a_alpha;    // particle opacity
layout(location = 3) in vec3 a_color;     // particle color
uniform vec2 u_presenceOffset;
uniform float u_presenceScale;

out float v_alpha;
out vec3 v_color;

void main() {
  v_alpha = a_alpha;
  v_color = a_color;
  gl_Position = vec4(a_position * u_presenceScale + u_presenceOffset, 0.0, 1.0);
  gl_PointSize = a_size * u_presenceScale;
}
