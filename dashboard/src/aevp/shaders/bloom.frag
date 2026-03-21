#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_scene;
uniform vec2 u_direction;  // (1/width, 0) or (0, 1/height) for separable blur
uniform float u_intensity;

// 9-tap Gaussian weights
const float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

void main() {
  vec3 result = texture(u_scene, v_uv).rgb * weights[0];

  for (int i = 1; i < 5; i++) {
    vec2 offset = u_direction * float(i);
    result += texture(u_scene, v_uv + offset).rgb * weights[i];
    result += texture(u_scene, v_uv - offset).rgb * weights[i];
  }

  fragColor = vec4(result * u_intensity, 1.0);
}
