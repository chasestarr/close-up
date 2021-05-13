import { mat4 } from './vendor/gl-matrix/index.js';

let cube_rotation = 0.0;

const vertex_shader_source = `
  attribute vec4 a_vertex_position;
  attribute vec2 a_texture_coord;

  uniform mat4 u_model_view_matrix;
  uniform mat4 u_projection_matrix;

  varying highp vec2 v_texture_coord;

  void main(void) {
    gl_Position = u_projection_matrix * u_model_view_matrix * a_vertex_position;
    v_texture_coord = a_texture_coord;
  }
`;

const fragment_shader_source = `
  varying highp vec2 v_texture_coord;

  uniform sampler2D u_sampler;

  void main(void) {
    gl_FragColor = texture2D(u_sampler, v_texture_coord);
  }
`;

function load_shader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    alert('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function load_texture(gl, url) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);

  // Because images have to be downloaded over the internet
  // they might take a moment until they are ready.
  // Until then put a single pixel in the texture so we can
  // use it immediately. When the image has finished downloading
  // we'll update the texture with the contents of the image.
  const level = 0;
  const internal_format = gl.RGBA;
  const width = 1;
  const height = 1;
  const border = 0;
  const src_format = gl.RGBA;
  const src_type = gl.UNSIGNED_BYTE;
  const pixel = new Uint8Array([0, 0, 255, 255]);
  gl.texImage2D(
    gl.TEXTURE_2D,
    level,
    internal_format,
    width,
    height,
    border,
    src_format,
    src_type,
    pixel,
  );

  const image = new Image();
  image.onload = function() {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, level, internal_format, src_format, src_type, image);

    // WebGL1 has different requirements for power of 2 images
    // vs non power of 2 images so check if the image is a
    // power of 2 in both dimensions.
    if (is_power_2(image.width) && is_power_2(image.height)) {
      gl.generateMipmap(gl.TEXTURE_2D);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
  }
  image.src = url;
  return texture;
}

function is_power_2(value) {
  return (value & (value - 1)) == 0;
}

function init_shader_program(gl, vs, fs) {
  const vertex_shader = load_shader(gl, gl.VERTEX_SHADER, vs);
  const fragment_shader = load_shader(gl, gl.FRAGMENT_SHADER, fs);

  const program = gl.createProgram();
  gl.attachShader(program, vertex_shader);
  gl.attachShader(program, fragment_shader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    alert('Unable to initialize the shader program: ' + gl.getProgramInfoLog(shaderProgram));
    return null;
  }

  return program;
}

function init_buffers(gl) {
  const position_buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
  const positions = [
    // Front face
    -1.0, -1.0,  1.0,
     1.0, -1.0,  1.0,
     1.0,  1.0,  1.0,
    -1.0,  1.0,  1.0,

    // Back face
    -1.0, -1.0, -1.0,
    -1.0,  1.0, -1.0,
     1.0,  1.0, -1.0,
     1.0, -1.0, -1.0,

    // Top face
    -1.0,  1.0, -1.0,
    -1.0,  1.0,  1.0,
     1.0,  1.0,  1.0,
     1.0,  1.0, -1.0,

    // Bottom face
    -1.0, -1.0, -1.0,
     1.0, -1.0, -1.0,
     1.0, -1.0,  1.0,
    -1.0, -1.0,  1.0,

    // Right face
     1.0, -1.0, -1.0,
     1.0,  1.0, -1.0,
     1.0,  1.0,  1.0,
     1.0, -1.0,  1.0,

    // Left face
    -1.0, -1.0, -1.0,
    -1.0, -1.0,  1.0,
    -1.0,  1.0,  1.0,
    -1.0,  1.0, -1.0,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  const face_colors = [
    [1.0,  1.0,  1.0,  1.0],    // Front face: white
    [1.0,  0.0,  0.0,  1.0],    // Back face: red
    [0.0,  1.0,  0.0,  1.0],    // Top face: green
    [0.0,  0.0,  1.0,  1.0],    // Bottom face: blue
    [1.0,  1.0,  0.0,  1.0],    // Right face: yellow
    [1.0,  0.0,  1.0,  1.0],    // Left face: purple
  ];

  let colors = [];
  for (let j = 0; j < face_colors.length; ++j) {
    const c = face_colors[j];
    // Repeat each color four times for the four vertices of the face
    colors = colors.concat(c, c, c, c);
  }

  const color_buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, color_buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);

  const index_buffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index_buffer);

  // This array defines each face as two triangles, using the
  // indices into the vertex array to specify each triangle's
  // position.

  const indices = [
    0,  1,  2,      0,  2,  3,    // front
    4,  5,  6,      4,  6,  7,    // back
    8,  9,  10,     8,  10, 11,   // top
    12, 13, 14,     12, 14, 15,   // bottom
    16, 17, 18,     16, 18, 19,   // right
    20, 21, 22,     20, 22, 23,   // left
  ];
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

  const texture_coord_buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texture_coord_buffer);

  const texture_coordinates = [
    // Front
    0.0,  0.0,
    1.0,  0.0,
    1.0,  1.0,
    0.0,  1.0,
    // Back
    0.0,  0.0,
    1.0,  0.0,
    1.0,  1.0,
    0.0,  1.0,
    // Top
    0.0,  0.0,
    1.0,  0.0,
    1.0,  1.0,
    0.0,  1.0,
    // Bottom
    0.0,  0.0,
    1.0,  0.0,
    1.0,  1.0,
    0.0,  1.0,
    // Right
    0.0,  0.0,
    1.0,  0.0,
    1.0,  1.0,
    0.0,  1.0,
    // Left
    0.0,  0.0,
    1.0,  0.0,
    1.0,  1.0,
    0.0,  1.0,
  ];
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array(texture_coordinates),
    gl.STATIC_DRAW,
  );

  return {
    color: color_buffer,
    indices: index_buffer,
    position: position_buffer,
    texture_coord: texture_coord_buffer,
  };
}

function draw_scene(gl, program_info, buffers, texture, deltaTime) {
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clearDepth(1.0);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Create a perspective matrix, a special matrix that is
  // used to simulate the distortion of perspective in a camera.
  // Our field of view is 45 degrees, with a width/height
  // ratio that matches the display size of the canvas
  // and we only want to see objects between 0.1 units
  // and 100 units away from the camera.

  const fov = 45 * Math.PI / 180;   // in radians
  const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
  const z_near = 0.1;
  const z_far = 100.0;
  const projection_matrix = mat4.create();
  mat4.perspective(projection_matrix, fov, aspect, z_near, z_far);
  const model_view_matrix = mat4.create();
  mat4.translate(model_view_matrix, model_view_matrix, [-0.0, 0.0, -6.0]);
  mat4.rotate(model_view_matrix, model_view_matrix, cube_rotation, [0, 0, 1]);
  mat4.rotate(model_view_matrix, model_view_matrix, cube_rotation * 0.7, [0, 1, 0]);

  {
    const num_components = 3;
    const type = gl.FLOAT;
    const normalize = false;
    const stride = 0;
    const offset = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    gl.vertexAttribPointer(
      program_info.attribute_locations.vertex_position,
      num_components,
      type,
      normalize,
      stride,
      offset,
    );
    gl.enableVertexAttribArray(program_info.attribute_locations.vertex_position);
  }

  // {
  //   const num_components = 4;
  //   const type = gl.FLOAT;
  //   const normalize = false;
  //   const stride = 0;
  //   const offset = 0;
  //   gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
  //   gl.vertexAttribPointer(
  //     program_info.attribute_locations.vertex_color,
  //     num_components,
  //     type,
  //     normalize,
  //     stride,
  //     offset,
  //   );
  //   gl.enableVertexAttribArray(program_info.attribute_locations.vertex_color);
  // }

  {
    const num = 2; // every coordinate composed of 2 values
    const type = gl.FLOAT; // the data in the buffer is 32 bit float
    const normalize = false; // don't normalize
    const stride = 0; // how many bytes to get from one set to the next
    const offset = 0; // how many bytes inside the buffer to start from
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texture_coord);
    gl.vertexAttribPointer(program_info.attribute_locations.texture_coord, num, type, normalize, stride, offset);
    gl.enableVertexAttribArray(program_info.attribute_locations.texture_coord);
  }

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);

  gl.useProgram(program_info.program);

  gl.uniformMatrix4fv(
    program_info.uniform_locations.projection_matrix,
    false,
    projection_matrix,
  );
  gl.uniformMatrix4fv(
    program_info.uniform_locations.model_view_matrix,
    false,
    model_view_matrix,
  );

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(program_info.uniform_locations.u_sampler, 0);

  {
    const vertex_count = 36;
    const type = gl.UNSIGNED_SHORT;
    const offset = 0;
    gl.drawElements(gl.TRIANGLES, vertex_count, type, offset);
  }

  cube_rotation += deltaTime;
}

function main() {
  const canvas = document.querySelector('#canvas');
  const gl = canvas.getContext("webgl");

  if (gl === null) {
    alert("Unable to initialize WebGL. Your browser or machine may not support it.");
    return;
  }

  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const program = init_shader_program(gl, vertex_shader_source, fragment_shader_source);
  const program_info = {
    program,
    attribute_locations: {
      vertex_position: gl.getAttribLocation(program, 'a_vertex_position'),
      texture_coord: gl.getAttribLocation(program, 'a_texture_coord'),
    },
    uniform_locations: {
      model_view_matrix: gl.getUniformLocation(program, 'u_model_view_matrix'),
      projection_matrix: gl.getUniformLocation(program, 'u_projection_matrix'),
      u_sampler: gl.getUniformLocation(program, 'u_sampler'),
    },
  };

  const buffers = init_buffers(gl);

  const texture = load_texture(gl, 'images/conspiracy.jpg');
  // const texture = load_texture(gl, 'images/cubetexture.png');

  let then = 0;
  function render(now) {
    now *= 0.001;
    const deltaTime = now - then;
    then = now;

    draw_scene(gl, program_info, buffers, texture, deltaTime);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}

main();
