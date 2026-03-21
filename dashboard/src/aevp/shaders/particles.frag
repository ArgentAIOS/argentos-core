#version 300 es
precision highp float;

in float v_alpha;
in vec3 v_color;
out vec4 fragColor;

void main() {
  // Circular point sprite with soft edge
  vec2 coord = gl_PointCoord * 2.0 - 1.0;
  float dist = length(coord);
  float alpha = 1.0 - smoothstep(0.5, 1.0, dist);
  alpha *= v_alpha;
  // Soft glow falloff
  float glow = exp(-dist * dist * 2.0);
  vec3 color = v_color * (0.6 + glow * 0.4);
  fragColor = vec4(color, alpha * glow);
}
