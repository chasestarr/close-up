import { mat4, vec2 } from './vendor/gl-matrix/index.js';

const MODE_TWO_UP = 0;
const MODE_SLIDE = 1;
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
  const x = Math.min(canvas.width, Math.max(0, global_x - canvasRect.left + window.scrollX));
  const y = Math.min(canvas.height, Math.max(0, global_y - canvasRect.top + window.scrollY));
  return [x, y];
}

function Slide(canvas, transform, image_a, image_b) {
  let mouse_x = -1;
  let mouse_y = -1;
  let slide_horiz = true;

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
  const fragment_shader_source = `#version 300 es
    precision highp float;

    in vec2 v_texcoord;

    uniform sampler2D tex;
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

    void main() {
      if (u_scale > 2.0) {
        vec2 uv = uv_iq(v_texcoord, textureSize(tex, 0));
        outColor = texture(tex, uv);
      } else if (u_scale < 0.2) {
        outColor = blur9(tex, v_texcoord, vec2(textureSize(tex, 0)), vec2(1.0, 1.0));
      } else {
        outColor = texture(tex, v_texcoord);
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
  const texture_location = gl.getUniformLocation(program, "u_texture");
  const scale_location = gl.getUniformLocation(program, "u_scale");

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

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

  function draw_image(t, tex, dst_x, dst_y, src_w, src_h) {
    gl.useProgram(program);
    gl.bindVertexArray(vao);

    const texture_unit = 0;
    gl.uniform1i(texture_location, texture_unit);
    gl.activeTexture(gl.TEXTURE0 + texture_unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);

    const matrix = mat4.create();
    mat4.ortho(matrix, 0, gl.canvas.clientWidth, gl.canvas.clientHeight, 0, -1, 1);
    mat4.multiply(matrix, matrix, t.mat);
    mat4.translate(matrix, matrix, [dst_x, dst_y, 0]);
    mat4.scale(matrix, matrix, [src_w, src_h, 1]);
    gl.uniformMatrix4fv(matrix_location, false, matrix);

    gl.uniform1f(scale_location, t.get_scale());

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function fit() {
    const max_height = Math.max(image_a.height, image_b.height);
    const max_width = Math.max(image_a.width, image_b.width);
    transform.fit(max_width, max_height, canvas.width, canvas.height);
  }

  function draw() {
    draw_image(
      transform,
      image_a.texture,
      0, 0,
      image_a.width, image_a.height,
    );
  }

  return {
    id: MODE_SLIDE,
    draw,
    fit,
    on_key_down: () => {},
    on_mouse_move: () => {},
    on_mouse_down: () => {},
    on_mouse_up: () => {},
    on_mouse_leave: () => {},
    on_wheel: () => {},
  };
}

async function CloseUp(image_url_a, image_url_b) {
  const canvas = document.getElementById('canvas');
  const gl = canvas.getContext('webgl2');

  let transform = new Transform();
  let mouse_left_down = false;

  const image_a = await load_image(gl, image_url_a);
  const image_b = await load_image(gl, image_url_b);
  const active_image = image_a;

  let mode = Slide(canvas, transform, image_a, image_b);

  canvas.addEventListener('wheel', handle_wheel);
  canvas.addEventListener('mousemove', handle_mouse_move);
  canvas.addEventListener('mousedown', handle_mouse_down);
  canvas.addEventListener('mouseup', handle_mouse_up);
  canvas.addEventListener('mouseleave', handle_mouse_leave);
  canvas.addEventListener('keydown', handle_key_down);

  function handle_wheel(event) {
    event.preventDefault();
    const [local_x, local_y] = local_mouse_position(canvas, event.clientX, event.clientY);
    transform.zoom_toward(local_x, local_y, event.deltaY);
    mode.on_wheel(event);
    update();
  }

  function handle_mouse_move(event) {
    const [local_x, local_y] = local_mouse_position(canvas, event.clientX, event.clientY);
    if (mouse_left_down) {
      transform.pan_move(local_x, local_y);
    }
    mode.on_mouse_move(event);
    canvas.focus();
    update();
  }

  function handle_mouse_down(event) {
    if (event.which === 1) {
      const [local_x, local_y] = local_mouse_position(canvas, event.clientX, event.clientY);
      mouse_left_down = true;
      transform.pan_start(local_x, local_y);
    }
    mode.on_mouse_down(event);
    update();
  }

  function handle_mouse_up(event) {
    if (event.which === 1) {
      mouse_left_down = false;
    }
    mode.on_mouse_up(event);
    update();
  }

  function handle_mouse_leave(event) {
    mouse_left_down = false;
    mode.on_mouse_leave(event);
    update();
  }

  function handle_key_down(event) {
    if (event.keyCode === F_KEY) {
      mode.fit();
    }
    mode.on_key_down(event);
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
}

function main() {
  CloseUp('images/snuff-out.png', 'images/statecraft.png');
}

main();

