import { mat4, vec2 } from './vendor/gl-matrix/index.js';

const MODE_TWO_UP = 0;
const MODE_SLIDE = 1;
const MODE_OVERLAY = 2;
const MODE_DIFF = 3;
const F_KEY = 70;

class Transform {
  constructor() {
    this.mat = mat4.create();
    this.pan_prev_x = 0;
    this.pan_prev_y = 0;
  }

  get_scale() {
    return this.mat[0];
  }

  get_translate() {
    return [this.mat[12], this.mat[13]];
  }

  pan_start(x, y) {
    this.pan_prev_x = x;
    this.pan_prev_y = y;
  }

  pan_move(x, y) {
    this.mat[12] = this.mat[12] + (x - this.pan_prev_x);
    this.mat[13] = this.mat[13] + (y - this.pan_prev_y);
    this.pan_prev_x = x;
    this.pan_prev_y = y;
  }

  zoom_toward(x, y, value) {
    const zoom = 1 - value / 500;
    const to_point = mat4.fromTranslation(mat4.create(), [-x, -y, 0]);
    const scale = mat4.fromScaling(mat4.create(), [zoom, zoom, 1]);
    const from_point = mat4.fromTranslation(mat4.create(), [x, y, 0]);

    let t = mat4.clone(this.mat);
    mat4.multiply(t, to_point, t);
    mat4.multiply(t, scale, t);
    mat4.multiply(t, from_point, t);

    if (t[0] >= 0.1) {
      this.mat = t;
    }
  }

  fit(subject_width, subject_height, bounds_width, bounds_height) {
    if (subject_height > subject_width) {
      const scale = bounds_height / subject_height;
      this.mat[0] = scale;
      this.mat[5] = scale;
      this.mat[12] = bounds_width / 2 - subject_width * scale / 2;
      this.mat[13] = 0;
    } else {
      const scale = bounds_width / subject_width;
      this.mat[0] = scale;
      this.mat[5] = scale;
      this.mat[12] = 0;
      this.mat[13] = bounds_height / 2 - subject_height * scale / 2;
    }
  }
}

function create_shader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (success) {
    return shader;
  }

  console.error(gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
}

function create_program(gl, vertex_shader, fragment_shader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertex_shader);
  gl.attachShader(program, fragment_shader);
  gl.linkProgram(program);
  var success = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (success) {
    return program;
  }

  console.error(gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
}

function is_power_2(value) {
  return (value & (value - 1)) == 0;
}

async function load_image(gl, url) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);

  const level = 0;
  const internalFormat = gl.RGBA;
  const width = 1;
  const height = 1;
  const border = 0;
  const srcFormat = gl.RGBA;
  const srcType = gl.UNSIGNED_BYTE;
  const pixel = new Uint8Array([0, 0, 255, 255]);
  gl.texImage2D(
    gl.TEXTURE_2D,
    level,
    internalFormat,
    width,
    height,
    border,
    srcFormat,
    srcType,
    pixel
  );

  const info = {
    width: 1,
    height: 1,
    texture,
  };

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = function() {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, srcFormat, srcType, image);

      info.width = image.width;
      info.height = image.height;

      if (is_power_2(image.width) && is_power_2(image.height)) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      resolve(info);
    }
    image.src = url;
  });
}

function local_mouse_position(canvas, global_x, global_y) {
  const canvasRect = canvas.getBoundingClientRect();
  const x = Math.min(canvas.width, Math.max(0, global_x - canvasRect.left));
  const y = Math.min(canvas.height, Math.max(0, global_y - canvasRect.top));
  return [x, y];
}

function Diff(canvas, transform, image_a, image_b) {
  const vertex_shader_source = `#version 300 es
    in vec4 a_position;
    in vec2 a_texcoord;

    uniform mat4 u_matrix;

    out vec2 v_texcoord;

    void main() {
       gl_Position = u_matrix * a_position;
       v_texcoord = a_texcoord;
    }
`;

  // https://jorenjoestar.github.io/post/pixel_art_filtering/
  // https://github.com/Jam3/glsl-fast-gaussian-blur
  // https://www.shadertoy.com/view/fs2Xzy
  const fragment_shader_source = `#version 300 es
    precision highp float;

    in vec2 v_texcoord;

    uniform sampler2D u_texture_a;
    uniform sampler2D u_texture_b;
    uniform float u_scale;

    out vec4 outColor;

    vec2 uv_iq(vec2 uv, ivec2 texture_size) {
      vec2 pixel = uv * vec2(texture_size);

      vec2 seam = floor(pixel + 0.5);
      vec2 dudv = fwidth(pixel);
      pixel = seam + clamp((pixel - seam) / dudv, -0.5, 0.5);

      return pixel / vec2(texture_size);
    }

    vec4 blur9(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
      vec4 color = vec4(0.0);
      vec2 off1 = vec2(1.3846153846) * direction;
      vec2 off2 = vec2(3.2307692308) * direction;
      color += texture(image, uv) * 0.2270270270;
      color += texture(image, uv + (off1 / resolution)) * 0.3162162162;
      color += texture(image, uv - (off1 / resolution)) * 0.3162162162;
      color += texture(image, uv + (off2 / resolution)) * 0.0702702703;
      color += texture(image, uv - (off2 / resolution)) * 0.0702702703;
      return color;
    }

    vec4 color(sampler2D image, vec2 coord) {
      if (u_scale > 2.0) {
        vec2 uv = uv_iq(coord, textureSize(image, 0));
        return texture(image, uv);
      } else if (u_scale < 0.2) {
        return blur9(image, coord, vec2(textureSize(image, 0)), vec2(1.0, 1.0));
      } else {
        return texture(image, coord);
      }
    }

    void main() {
      vec4 a = color(u_texture_a, v_texcoord);
      vec4 b = color(u_texture_b, v_texcoord);
      float len = length(a - b);
      if (len > 0.1) {
        outColor = vec4(1.0, 0.0, 1.0, 1.0);
      } else {
        outColor = a;
      }
    }
`;

  const gl = canvas.getContext('webgl2');
  const vertex_shader = create_shader(gl, gl.VERTEX_SHADER, vertex_shader_source);
  const fragment_shader = create_shader(gl, gl.FRAGMENT_SHADER, fragment_shader_source);
  const program = create_program(gl, vertex_shader, fragment_shader);

  const position_attribute_location = gl.getAttribLocation(program, "a_position");
  const texcoord_attribute_location = gl.getAttribLocation(program, "a_texcoord");
  const matrix_location = gl.getUniformLocation(program, "u_matrix");
  const texture_a_location = gl.getUniformLocation(program, "u_texture_a");
  const texture_b_location = gl.getUniformLocation(program, "u_texture_b");
  const scale_location = gl.getUniformLocation(program, "u_scale");

  const position_buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
  const positions = [
    0, 0, 0, 1, 1, 0,
    1, 0, 0, 1, 1, 1,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(position_attribute_location);
  gl.vertexAttribPointer(position_attribute_location, 2, gl.FLOAT, true, 0, 0);

  const texcoord_buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texcoord_buffer);
  const texcoords = [
    0, 0, 0, 1, 1, 0,
    1, 0, 0, 1, 1, 1,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texcoords), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(texcoord_attribute_location);
  gl.vertexAttribPointer(texcoord_attribute_location, 2, gl.FLOAT, true, 0, 0);

  function fit() {
    const max_height = Math.max(image_a.height, image_b.height);
    const max_width = Math.max(image_a.width, image_b.width);
    transform.fit(max_width, max_height, canvas.width, canvas.height);
  }

  function on_wheel(event, local_x, local_y) {
    transform.zoom_toward(local_x, local_y, event.deltaY);
  }

  function draw() {
    gl.useProgram(program);

    gl.uniform1i(texture_a_location, 0);
    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, image_a.texture);

    gl.uniform1i(texture_b_location, 1);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, image_b.texture);

    const matrix = mat4.create();
    mat4.ortho(matrix, 0, gl.canvas.clientWidth, gl.canvas.clientHeight, 0, -1, 1);
    mat4.multiply(matrix, matrix, transform.mat);
    mat4.scale(matrix, matrix, [image_a.width, image_a.height, 1]);
    gl.uniformMatrix4fv(matrix_location, false, matrix);

    gl.uniform1f(scale_location, transform.get_scale());

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  return {
    draw,
    fit,
    on_wheel,
  };
}

function Overlay(canvas, transform, image_a, image_b) {
  const vertex_shader_source = `#version 300 es
    in vec4 a_position;
    in vec2 a_texcoord;

    uniform mat4 u_matrix;

    out vec2 v_texcoord;

    void main() {
       gl_Position = u_matrix * a_position;
       v_texcoord = a_texcoord;
    }
`;

  // https://jorenjoestar.github.io/post/pixel_art_filtering/
  // https://github.com/Jam3/glsl-fast-gaussian-blur
  // https://www.shadertoy.com/view/fs2Xzy
  const fragment_shader_source = `#version 300 es
    precision highp float;

    in vec2 v_texcoord;

    uniform sampler2D u_texture_a;
    uniform sampler2D u_texture_b;
    uniform float u_scale;
    uniform float u_opacity;

    out vec4 outColor;

    vec2 uv_iq(vec2 uv, ivec2 texture_size) {
      vec2 pixel = uv * vec2(texture_size);

      vec2 seam = floor(pixel + 0.5);
      vec2 dudv = fwidth(pixel);
      pixel = seam + clamp((pixel - seam) / dudv, -0.5, 0.5);

      return pixel / vec2(texture_size);
    }

    vec4 blur9(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
      vec4 color = vec4(0.0);
      vec2 off1 = vec2(1.3846153846) * direction;
      vec2 off2 = vec2(3.2307692308) * direction;
      color += texture(image, uv) * 0.2270270270;
      color += texture(image, uv + (off1 / resolution)) * 0.3162162162;
      color += texture(image, uv - (off1 / resolution)) * 0.3162162162;
      color += texture(image, uv + (off2 / resolution)) * 0.0702702703;
      color += texture(image, uv - (off2 / resolution)) * 0.0702702703;
      return color;
    }

    vec4 color(sampler2D image, vec2 coord) {
      if (u_scale > 2.0) {
        vec2 uv = uv_iq(coord, textureSize(image, 0));
        return texture(image, uv);
      } else if (u_scale < 0.2) {
        return blur9(image, coord, vec2(textureSize(image, 0)), vec2(1.0, 1.0));
      } else {
        return texture(image, coord);
      }
    }

    void main() {
      outColor = color(u_texture_a, v_texcoord) * (1.0 - u_opacity) + color(u_texture_b, v_texcoord) * u_opacity;
    }
`;

  let mouse_x = 0;

  const gl = canvas.getContext('webgl2');
  const vertex_shader = create_shader(gl, gl.VERTEX_SHADER, vertex_shader_source);
  const fragment_shader = create_shader(gl, gl.FRAGMENT_SHADER, fragment_shader_source);
  const program = create_program(gl, vertex_shader, fragment_shader);

  const position_attribute_location = gl.getAttribLocation(program, "a_position");
  const texcoord_attribute_location = gl.getAttribLocation(program, "a_texcoord");
  const matrix_location = gl.getUniformLocation(program, "u_matrix");
  const texture_a_location = gl.getUniformLocation(program, "u_texture_a");
  const texture_b_location = gl.getUniformLocation(program, "u_texture_b");
  const scale_location = gl.getUniformLocation(program, "u_scale");
  const opacity_location = gl.getUniformLocation(program, "u_opacity");

  const position_buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
  const positions = [
    0, 0, 0, 1, 1, 0,
    1, 0, 0, 1, 1, 1,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(position_attribute_location);
  gl.vertexAttribPointer(position_attribute_location, 2, gl.FLOAT, true, 0, 0);

  const texcoord_buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texcoord_buffer);
  const texcoords = [
    0, 0, 0, 1, 1, 0,
    1, 0, 0, 1, 1, 1,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texcoords), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(texcoord_attribute_location);
  gl.vertexAttribPointer(texcoord_attribute_location, 2, gl.FLOAT, true, 0, 0);

  function fit() {
    const max_height = Math.max(image_a.height, image_b.height);
    const max_width = Math.max(image_a.width, image_b.width);
    transform.fit(max_width, max_height, canvas.width, canvas.height);
  }

  function on_mouse_move(event, local_x, local_y) {
    mouse_x = local_x;
  }

  function on_wheel(event, local_x, local_y) {
    transform.zoom_toward(local_x, local_y, event.deltaY);
  }

  function draw() {
    gl.useProgram(program);

    gl.uniform1i(texture_a_location, 0);
    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, image_a.texture);

    gl.uniform1i(texture_b_location, 1);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, image_b.texture);

    const matrix = mat4.create();
    mat4.ortho(matrix, 0, gl.canvas.clientWidth, gl.canvas.clientHeight, 0, -1, 1);
    mat4.multiply(matrix, matrix, transform.mat);
    mat4.scale(matrix, matrix, [image_a.width, image_a.height, 1]);
    gl.uniformMatrix4fv(matrix_location, false, matrix);

    gl.uniform1f(scale_location, transform.get_scale());
    gl.uniform1f(opacity_location, mouse_x / gl.canvas.width);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  return {
    draw,
    fit,
    on_wheel,
    on_mouse_move,
  };
}

function TwoUp(canvas, transform, image_a, image_b) {
  const vertex_shader_source = `#version 300 es
    in vec4 a_position;
    in vec2 a_texcoord;

    uniform mat4 u_matrix;
    uniform mat4 u_texture_matrix;

    out vec2 v_texcoord;

    void main() {
      gl_Position = u_matrix * a_position;
      v_texcoord = (u_texture_matrix * vec4(a_texcoord, 0, 1)).xy;
    }
  `;

  // https://jorenjoestar.github.io/post/pixel_art_filtering/
  // https://github.com/Jam3/glsl-fast-gaussian-blur
  // https://www.shadertoy.com/view/fs2Xzy
  const fragment_shader_source = `#version 300 es
    precision highp float;

    in vec2 v_texcoord;

    uniform sampler2D u_texture;
    uniform float u_scale;

    out vec4 outColor;

    vec2 uv_iq(vec2 uv, ivec2 texture_size) {
      vec2 pixel = uv * vec2(texture_size);

      vec2 seam = floor(pixel + 0.5);
      vec2 dudv = fwidth(pixel);
      pixel = seam + clamp((pixel - seam) / dudv, -0.5, 0.5);

      return pixel / vec2(texture_size);
    }

    vec4 blur9(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
      vec4 color = vec4(0.0);
      vec2 off1 = vec2(1.3846153846) * direction;
      vec2 off2 = vec2(3.2307692308) * direction;
      color += texture(image, uv) * 0.2270270270;
      color += texture(image, uv + (off1 / resolution)) * 0.3162162162;
      color += texture(image, uv - (off1 / resolution)) * 0.3162162162;
      color += texture(image, uv + (off2 / resolution)) * 0.0702702703;
      color += texture(image, uv - (off2 / resolution)) * 0.0702702703;
      return color;
    }

    vec4 color(sampler2D image, vec2 coord) {
      if (u_scale > 2.0) {
        vec2 uv = uv_iq(coord, textureSize(image, 0));
        return texture(image, uv);
      } else if (u_scale < 0.2) {
        return blur9(image, coord, vec2(textureSize(image, 0)), vec2(1.0, 1.0));
      } else {
        return texture(image, coord);
      }
    }

    void main() {
      outColor = color(u_texture, v_texcoord);
    }
  `;

  const gl = canvas.getContext('webgl2');
  const vertex_shader = create_shader(gl, gl.VERTEX_SHADER, vertex_shader_source);
  const fragment_shader = create_shader(gl, gl.FRAGMENT_SHADER, fragment_shader_source);
  const program = create_program(gl, vertex_shader, fragment_shader);

  const position_attribute_location = gl.getAttribLocation(program, "a_position");
  const texcoord_attribute_location = gl.getAttribLocation(program, "a_texcoord");
  const matrix_location = gl.getUniformLocation(program, "u_matrix");
  const texture_location = gl.getUniformLocation(program, "u_texture");
  const texture_matrix_location = gl.getUniformLocation(program, "u_texture_matrix");
  const scale_location = gl.getUniformLocation(program, "u_scale");

  const position_buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
  const positions = [
    0, 0, 0, 1, 1, 0,
    1, 0, 0, 1, 1, 1,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(position_attribute_location);
  gl.vertexAttribPointer(position_attribute_location, 2, gl.FLOAT, true, 0, 0);

  const texcoord_buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texcoord_buffer);
  const texcoords = [
    0, 0, 0, 1, 1, 0,
    1, 0, 0, 1, 1, 1,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texcoords), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(texcoord_attribute_location);
  gl.vertexAttribPointer(texcoord_attribute_location, 2, gl.FLOAT, true, 0, 0);

  function draw_image(t, image, sx, sy, sw, sh, dx, dy, dw, dh) {
    gl.uniform1i(texture_location, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, image.texture);

    const matrix = mat4.create();
    mat4.ortho(matrix, 0, gl.canvas.clientWidth, gl.canvas.clientHeight, 0, -1, 1);
    mat4.multiply(matrix, matrix, t.mat);
    mat4.translate(matrix, matrix, [dx, dy, 0]);
    mat4.scale(matrix, matrix, [dw, dh, 1]);
    gl.uniformMatrix4fv(matrix_location, false, matrix);

    const tex_matrix = mat4.create();
    mat4.translate(tex_matrix, tex_matrix, [sx / image.width, sy / image.height, 0]);
    mat4.scale(tex_matrix, tex_matrix, [sw / image.width, sh / image.height, 0]);
    gl.uniformMatrix4fv(texture_matrix_location, false, tex_matrix);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function draw_left() {
    const inverse = mat4.invert(mat4.create(), transform.mat);
    const [mid] = vec2.transformMat4([], [gl.canvas.width / 2, 0], inverse);
    const width = Math.min(image_a.width, mid);
    draw_image(
      transform,
      image_a,
      0, 0, width, image_a.height,
      0, 0, width, image_a.height
    );
  }

  function draw_right() {
    const frame_width = gl.canvas.width / 2;
    const right = new Transform();
    mat4.translate(right.mat, right.mat, [frame_width, 0, 0]);
    mat4.multiply(right.mat, right.mat, transform.mat);
    const r_inverse = mat4.invert(mat4.create(), right.mat);
    const [r_mid] = vec2.transformMat4([], [frame_width, 0], r_inverse);

    const width = Math.min(image_b.width, image_b.width - r_mid);
    const x = Math.max(0, r_mid);
    draw_image(
      right,
      image_b,
      x, 0, width, image_b.height,
      x, 0, width, image_b.height
    );
  }

  function draw() {
    gl.useProgram(program);
    gl.uniform1f(scale_location, transform.get_scale());
    draw_left();
    draw_right();
  }

  function fit() {
    const max_height = Math.max(image_a.height, image_b.height);
    const max_width = Math.max(image_a.width, image_b.width);
    transform.fit(max_width, max_height, canvas.width / 2, canvas.height);
  }

  function on_wheel(event, local_x, local_y) {
    const frame_width = gl.canvas.width / 2;
    transform.zoom_toward(
      local_x > frame_width ? local_x - frame_width : local_x,
      local_y,
      event.deltaY
    );
  }

  return {
    draw,
    fit,
    on_wheel,
  };
}

function SlideHandle(canvas) {
  const vertex_shader_source = `#version 300 es
    in vec4 a_position;
    uniform mat4 u_matrix;

    void main() {
       gl_Position = u_matrix * a_position;
    }
  `;

  const fragment_shader_source = `#version 300 es
    precision highp float;
    out vec4 outColor;

    void main() {
      outColor = vec4(1.0, 0.855, 0.227, 1.0);
    }
  `;

  let mouse_x = -1;
  let mouse_y = -1;
  let slide_horiz = true;

  const gl = canvas.getContext('webgl2');
  const vertex_shader = create_shader(gl, gl.VERTEX_SHADER, vertex_shader_source);
  const fragment_shader = create_shader(gl, gl.FRAGMENT_SHADER, fragment_shader_source);
  const program = create_program(gl, vertex_shader, fragment_shader);

  const position_attribute_location = gl.getAttribLocation(program, "a_position");
  const matrix_location = gl.getUniformLocation(program, "u_matrix");

  const position_buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
  const positions = [
    0, 0, 0, 1, 1, 0,
    1, 0, 0, 1, 1, 1,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(position_attribute_location);
  gl.vertexAttribPointer(position_attribute_location, 2, gl.FLOAT, true, 0, 0);

  function draw() {
    gl.useProgram(program);

    const matrix = mat4.create();
    mat4.ortho(matrix, 0, gl.canvas.clientWidth, gl.canvas.clientHeight, 0, -1, 1);
    if (slide_horiz) {
      mat4.translate(matrix, matrix, [mouse_x, 0, 0]);
      mat4.scale(matrix, matrix, [1, canvas.height, 1]);
    } else {
      mat4.translate(matrix, matrix, [0, mouse_y, 0]);
      mat4.scale(matrix, matrix, [canvas.width, 1, 1]);
    }

    gl.uniformMatrix4fv(matrix_location, false, matrix);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function set_slide_direction(is_slide_horiz) {
    slide_horiz = is_slide_horiz;
  }

  function on_mouse_move(event, local_x, local_y) {
    mouse_x = local_x;
    mouse_y = local_y;
  }

  return {
    draw,
    set_slide_direction,
    on_mouse_move,
  };
}

function Slide(canvas, transform, image_a, image_b) {
  const vertex_shader_source = `#version 300 es
    in vec4 a_position;
    in vec2 a_texcoord;

    uniform mat4 u_matrix;

    out vec2 v_texcoord;

    void main() {
       gl_Position = u_matrix * a_position;
       v_texcoord = a_texcoord;
    }
  `;

  // https://jorenjoestar.github.io/post/pixel_art_filtering/
  // https://github.com/Jam3/glsl-fast-gaussian-blur
  // https://www.shadertoy.com/view/fs2Xzy
  const fragment_shader_source = `#version 300 es
    precision highp float;

    in vec2 v_texcoord;

    uniform sampler2D u_texture_a;
    uniform sampler2D u_texture_b;
    uniform float u_scale;
    uniform bool u_slide_horiz;
    uniform vec2 u_mouse;

    out vec4 outColor;

    vec2 uv_iq(vec2 uv, ivec2 texture_size) {
      vec2 pixel = uv * vec2(texture_size);

      vec2 seam = floor(pixel + 0.5);
      vec2 dudv = fwidth(pixel);
      pixel = seam + clamp((pixel - seam) / dudv, -0.5, 0.5);

      return pixel / vec2(texture_size);
    }

    vec4 blur9(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
      vec4 color = vec4(0.0);
      vec2 off1 = vec2(1.3846153846) * direction;
      vec2 off2 = vec2(3.2307692308) * direction;
      color += texture(image, uv) * 0.2270270270;
      color += texture(image, uv + (off1 / resolution)) * 0.3162162162;
      color += texture(image, uv - (off1 / resolution)) * 0.3162162162;
      color += texture(image, uv + (off2 / resolution)) * 0.0702702703;
      color += texture(image, uv - (off2 / resolution)) * 0.0702702703;
      return color;
    }

    vec4 color(sampler2D image, vec2 coord) {
      if (u_scale > 2.0) {
        vec2 uv = uv_iq(coord, textureSize(image, 0));
        return texture(image, uv);
      } else if (u_scale < 0.2) {
        return blur9(image, coord, vec2(textureSize(image, 0)), vec2(1.0, 1.0));
      } else {
        return texture(image, coord);
      }
    }

    void main() {
      if (u_slide_horiz) {
        if (v_texcoord.x <= u_mouse.x) {
          outColor = color(u_texture_a, v_texcoord);
        } else {
          outColor = color(u_texture_b, v_texcoord);
        }
      } else {
        if (v_texcoord.y <= u_mouse.y) {
          outColor = color(u_texture_a, v_texcoord);
        } else {
          outColor = color(u_texture_b, v_texcoord);
        }
      }
    }
  `;

  let mouse_x = -1;
  let mouse_y = -1;
  let slide_horiz = true;

  const handle = SlideHandle(canvas);

  const gl = canvas.getContext('webgl2');
  const vertex_shader = create_shader(gl, gl.VERTEX_SHADER, vertex_shader_source);
  const fragment_shader = create_shader(gl, gl.FRAGMENT_SHADER, fragment_shader_source);
  const program = create_program(gl, vertex_shader, fragment_shader);

  const position_attribute_location = gl.getAttribLocation(program, "a_position");
  const texcoord_attribute_location = gl.getAttribLocation(program, "a_texcoord");
  const matrix_location = gl.getUniformLocation(program, "u_matrix");
  const texture_a_location = gl.getUniformLocation(program, "u_texture_a");
  const texture_b_location = gl.getUniformLocation(program, "u_texture_b");
  const scale_location = gl.getUniformLocation(program, "u_scale");
  const slide_horiz_location = gl.getUniformLocation(program, "u_slide_horiz");
  const mouse_location = gl.getUniformLocation(program, "u_mouse");

  const position_buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
  const positions = [
    0, 0, 0, 1, 1, 0,
    1, 0, 0, 1, 1, 1,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(position_attribute_location);
  gl.vertexAttribPointer(position_attribute_location, 2, gl.FLOAT, true, 0, 0);

  const texcoord_buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texcoord_buffer);
  const texcoords = [
    0, 0, 0, 1, 1, 0,
    1, 0, 0, 1, 1, 1,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texcoords), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(texcoord_attribute_location);
  gl.vertexAttribPointer(texcoord_attribute_location, 2, gl.FLOAT, true, 0, 0);

  function fit() {
    const max_height = Math.max(image_a.height, image_b.height);
    const max_width = Math.max(image_a.width, image_b.width);
    transform.fit(max_width, max_height, canvas.width, canvas.height);
  }

  function on_mouse_move(event, local_x, local_y) {
    mouse_x = local_x;
    mouse_y = local_y;

    const horiz_edge = canvas.width / 8;
    const vert_edge = canvas.height / 8;
    if (mouse_y < vert_edge || mouse_y > canvas.height - vert_edge) {
      slide_horiz = false;
    } else if (mouse_x < horiz_edge || mouse_x > canvas.width - horiz_edge) {
      slide_horiz = true;
    }

    handle.set_slide_direction(slide_horiz);
    handle.on_mouse_move(event, local_x, local_y);
  }

  function on_wheel(event, local_x, local_y) {
    transform.zoom_toward(local_x, local_y, event.deltaY);
  }

  function draw() {
    gl.useProgram(program);

    gl.uniform1i(texture_a_location, 0);
    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, image_a.texture);

    gl.uniform1i(texture_b_location, 1);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, image_b.texture);

    const matrix = mat4.create();
    mat4.ortho(matrix, 0, gl.canvas.clientWidth, gl.canvas.clientHeight, 0, -1, 1);
    mat4.multiply(matrix, matrix, transform.mat);
    mat4.scale(matrix, matrix, [image_a.width, image_a.height, 1]);
    gl.uniformMatrix4fv(matrix_location, false, matrix);

    gl.uniform1f(scale_location, transform.get_scale());
    gl.uniform1f(slide_horiz_location, slide_horiz ? 1 : 0);

    const inverse = mat4.invert(mat4.create(), transform.mat);
    const [local_mouse_x, local_mouse_y] = vec2.transformMat4([], [mouse_x, mouse_y], inverse);
    gl.uniform2f(mouse_location, local_mouse_x / image_a.width, local_mouse_y / image_a.height);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    handle.draw();
  }

  return {
    draw,
    fit,
    on_wheel,
    on_mouse_move,
  };
}

async function CloseUp(canvas, image_url_a, image_url_b) {
  const gl = canvas.getContext('webgl2');

  let transform = new Transform();
  let mouse_left_down = false;

  const image_a = await load_image(gl, image_url_a);
  const image_b = await load_image(gl, image_url_b);

  let mode = TwoUp(canvas, transform, image_a, image_b);

  canvas.addEventListener('wheel', handle_wheel);
  canvas.addEventListener('mousemove', handle_mouse_move);
  canvas.addEventListener('mousedown', handle_mouse_down);
  canvas.addEventListener('mouseup', handle_mouse_up);
  canvas.addEventListener('mouseleave', handle_mouse_leave);
  canvas.addEventListener('keydown', handle_key_down);

  function set_mode(next_mode) {
    if (next_mode === MODE_TWO_UP) {
      mode = TwoUp(canvas, transform, image_a, image_b);
    } else if (next_mode === MODE_SLIDE) {
      mode = Slide(canvas, transform, image_a, image_b);
    } else if (next_mode === MODE_OVERLAY) {
      mode = Overlay(canvas, transform, image_a, image_b);
    } else if (next_mode === MODE_DIFF) {
      mode = Diff(canvas, transform, image_a, image_b);
    }
    mode.fit();
    update();
  }

  function handle_wheel(event) {
    event.preventDefault();
    const [local_x, local_y] = local_mouse_position(canvas, event.clientX, event.clientY);
    if (mode.on_wheel) {
      mode.on_wheel(event, local_x, local_y);
    }
    update();
  }

  function handle_mouse_move(event) {
    const [local_x, local_y] = local_mouse_position(canvas, event.clientX, event.clientY);
    if (mouse_left_down) {
      transform.pan_move(local_x, local_y);
    }
    if (mode.on_mouse_move) {
      mode.on_mouse_move(event, local_x, local_y);
    }
    canvas.focus({preventScroll: true});
    update();
  }

  function handle_mouse_down(event) {
    if (event.which === 1) {
      const [local_x, local_y] = local_mouse_position(canvas, event.clientX, event.clientY);
      mouse_left_down = true;
      transform.pan_start(local_x, local_y);
    }
    if (mode.on_mouse_down) {
      mode.on_mouse_down(event);
    }
    update();
  }

  function handle_mouse_up(event) {
    if (event.which === 1) {
      mouse_left_down = false;
    }
    if (mode.on_mouse_up) {
      mode.on_mouse_up(event);
    }
    update();
  }

  function handle_mouse_leave(event) {
    mouse_left_down = false;
    if (mode.on_mouse_leave) {
      mode.on_mouse_leave(event);
    }
    update();
  }

  function handle_key_down(event) {
    if (event.keyCode === F_KEY) {
      mode.fit();
    }
    if (mode.on_key_down) {
      mode.on_key_down(event);
    }
    update();
  }

  function update() {
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0.96, 0.96, 0.96, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.clearDepth(1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    mode.draw();
  }

  mode.fit();
  update();

  return {
    set_mode,
  }
}

function ModeSelector(on_select) {
  const modes = [
    ['two up', MODE_TWO_UP],
    ['slide', MODE_SLIDE],
    ['overlay', MODE_OVERLAY],
    ['diff', MODE_DIFF],
  ];

  const selected_style = 'color: blue;';

  const container = document.createElement('div');

  for (let i = 0; i < modes.length; i++) {
    const [label, mode] = modes[i];
    const button = document.createElement('button');

    if (i === 0) {
      button.style = selected_style;
    }

    button.textContent = label;
    button.addEventListener('click', () => {
      const buttons = container.querySelectorAll('button');
      for (let b of buttons) {
        b.style = null;
      }
      button.style = selected_style;

      on_select(mode);
    });

    container.appendChild(button);
  }

  return container;
}

function Pair(parent, image_url_a, image_url_b) {
  let set_mode = null;
  let mode = MODE_TWO_UP;

  function on_select(selected_mode) {
    set_mode(selected_mode);
  }

  const container = document.createElement('div');
  container.style = `
    padding: 24px;
  `;
  const mode_selector = ModeSelector(on_select);
  container.appendChild(mode_selector);

  const canvas_container = document.createElement('div');
  canvas_container.style = `
    display: flex;
    justify-content: center;
  `;
  container.appendChild(canvas_container);

  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 480;
  canvas.setAttribute('tabindex', 0);
  canvas_container.appendChild(canvas);
  CloseUp(canvas, image_url_a, image_url_b).then(close_up => set_mode = close_up.set_mode);

  return container;
}

function main() {
  const pairs = [
    ['images/ct-scan-01.jpg', 'images/ct-scan-02.jpg'],
    ['images/snuff-out.png', 'images/statecraft.png'],
    ['images/data-table-before.png', 'images/data-table-after.png'],
  ];

  const body = document.querySelector('body');
  body.style = `
    overflow: auto;
  `;
  for (const pair of pairs) {
    const p = Pair(container, ...pair);
    container.appendChild(p);
  }
}

main();

