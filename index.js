function mult_tt(a, b) {
  return [
    a[0] * b[0],
    a[0] * b[1] + a[1],
    a[0] * b[2] + a[2],
  ];
}

function mult_tv(a, b) {
  return [
    a[0] * b[0],
    a[0] * b[1],
  ];
}

function Transform(_scale, _translate_x, _translate_y) {
  let scale = _scale;
  let translate_x = _translate_x;
  let translate_y = _translate_y;

  let pan_prev_x = 0;
  let pan_prev_y = 0;
  function pan_start(x, y) {
    pan_prev_x = x;
    pan_prev_y = y;
  }

  function pan_move(x, y) {
    translate_x += x - pan_prev_x;
    translate_y += y - pan_prev_y;
    pan_prev_x = x;
    pan_prev_y = y;
  }

  function zoom_toward(x, y, value) {
    const zoom = 1 - value / 500;

    let t = Transform(scale, translate_x, translate_y);

    t = Transform(1, -x, -y).mult_transform(t);
    t = Transform(zoom, 0, 0).mult_transform(t);
    t = Transform(1, x, y).mult_transform(t);

    if (t.scale > 0.1) {
      scale = t.scale;
      translate_x = t.translate_x;
      translate_y = t.translate_y;
    }
  }

  function fit(subject_width, subject_height, bounds_width, bounds_height) {
    if (subject_height > subject_width) {
      scale = bounds_height / subject_height;
    } else {
      scale = bounds_width / subject_width;
    }
    translate_x = 0;
    translate_y = 0;
  }

  function mult_transform(t) {
    return Transform(
      scale * t.scale,
      scale * t.translate_x + translate_x,
      scale * t.translate_y + translate_y,
    );
  }

  function mult_vector(v) {
    return [scale * v[0], scale * v[1]];
  }

  return {
    scale,
    translate_x,
    translate_y,

    pan_start,
    pan_move,
    zoom_toward,
    fit,
  };
}

function local_mouse_position(canvas, global_x, global_y) {
  const canvasRect = canvas.getBoundingClientRect();
  const x = Math.min(canvas.width, Math.max(0, global_x - canvasRect.left + window.scrollX));
  const y = Math.min(canvas.height, Math.max(0, global_y - canvasRect.top + window.scrollY));
  return [x, y];
}

function draw_rect(ctx, transform, position, scale, color) {
  const p = mult_tv(transform, position);
  const s = mult_tv(transform, scale);
  ctx.fillStyle = color;
  ctx.fillRect(transform[1] + p[0], transform[2] + p[1], s[0], s[1]);
}

function draw_checkerboard(ctx, transform, count, c1, c2) {
  let dark = true;
  const size = 100;
  const scale = [size, size];
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < count; j++) {
      draw_rect(ctx, transform, [i * size, j * size], scale, dark ? c1 : c2);
      dark = !dark;
    }
  }
}

function two_up(canvas, img_url_a, img_url_b) {
  const context = canvas.getContext('2d');
  const frame_width = canvas.width / 2;


  let root_transform = [1, 0, 0];
  let mouse_right_down = false;
  let pan_prev_x = 0;
  let pan_prev_y = 0;

  const img_a = new Image();
  img_a.src = img_url_a;
  img_a.onload = function() {
    fit_to_image();
    update();
  }
  const img_b = new Image();
  img_b.src = img_url_b;
  img_b.onload = function() {
    fit_to_image();
    update();
  }


  function fit_to_image() {
    const max_height = Math.max(img_a.naturalHeight, img_b.naturalHeight);
    const max_width = Math.max(img_a.naturalWidth, img_b.naturalWidth);

    if (max_height > max_width) {
      root_transform[0] = canvas.height / max_height;
    } else {
      root_transform[0] = frame_width / max_width;
    }
    root_transform[1] = 0;
    root_transform[2] = 0;
  }

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const [local_x, local_y] = local_mouse_position(canvas, event.clientX, event.clientY);
    const x = (local_x > frame_width ? local_x - frame_width : local_x);
    const y = local_y;

    const zoom = 1 - event.deltaY / 500;
    let t = root_transform;
    t = mult_tt([1, -x, -y], t);
    t = mult_tt([zoom, 0, 0], t);
    t = mult_tt([1, x, y], t);
    if (t[0] > 0.1) {
      root_transform = t;
    }

    update();
  });

  canvas.addEventListener('mousemove', (event) => {
    const [local_x, local_y] = local_mouse_position(canvas, event.clientX, event.clientY);
    if (mouse_right_down) {
      const delta_x = local_x - pan_prev_x;
      const delta_y = local_y - pan_prev_y;
      pan_prev_x = local_x;
      pan_prev_y = local_y;
      root_transform[1] += delta_x;
      root_transform[2] += delta_y;
    }
    update();
  });

  canvas.addEventListener('mousedown', (event) => {
    if (event.which === 3) {
      const [local_x, local_y] = local_mouse_position(canvas, event.clientX, event.clientY);
      mouse_right_down = true;
      pan_prev_x = local_x;
      pan_prev_y = local_y;
    }
    update();
  });

  canvas.addEventListener('mouseup', (event) => {
    if (event.which === 3) {
      mouse_right_down = false;
    }
    update();
  });

  canvas.addEventListener('mouseleave', () => {
    mouse_right_down = false;
  });

  const F_KEY = 70;
  canvas.addEventListener('keydown', (event) => {
    if (event.keyCode === F_KEY) {
      fit_to_image();
      update();
    }
  })

  canvas.oncontextmenu = () => false;

  function draw_image(ctx, transform, img) {
    let size = [img.naturalWidth, img.naturalHeight];
    size = mult_tv(transform, size);
    ctx.drawImage(img, transform[1], transform[2], size[0], size[1]);
  }

  function draw_left(transform) {
    context.fillStyle = '#f6f6f6';
    context.fillRect(0, 0, frame_width, canvas.height);

    draw_rect(context, transform, [0, 0], [img_b.naturalWidth, img_b.naturalHeight], "#FECB4D");
    draw_image(context, transform, img_a);
  }

  function draw_right(transform) {
    context.save();
    context.clip(context.rect(frame_width, 0, frame_width, canvas.height));

    context.fillStyle = '#f6f6f6';
    context.fillRect(frame_width, 0, frame_width, canvas.height);

    draw_rect(context, transform, [0, 0], [img_a.naturalWidth, img_a.naturalHeight], "#FECB4D");
    draw_image(context, transform, img_b);

    context.restore();
  }

  function draw() {
    draw_left(mult_tt([1, 0, 0], root_transform));
    draw_right(mult_tt([1, frame_width, 0], root_transform));
  }

  let waiting = false;
  function update() {
    if (!waiting) {
      waiting = true;
      requestAnimationFrame(() => {
        draw();
        waiting = false;
      });
    }
  }

  update();
}

function slide(canvas, img_url_a, img_url_b) {
  const context = canvas.getContext('2d');

  let mouse_x = 0;
  let mouse_y = 0;
  let slide_horiz = true;

  canvas.addEventListener("mouseleave", (event) => {
    mouse_x = -1;
    mouse_y = -1;

    update();
  });

  canvas.addEventListener("mousemove", (event) => {
    const [local_x, local_y] = local_mouse_position(canvas, event.clientX, event.clientY);
    mouse_x = local_x;
    mouse_y = local_y;

    const horiz_edge = canvas.width / 8;
    const vert_edge = canvas.height / 8;
    if (mouse_y < vert_edge || mouse_y > canvas.height - vert_edge) {
      slide_horiz = false;
    } else if (mouse_x < horiz_edge || mouse_x > canvas.width - horiz_edge) {
      slide_horiz = true;
    }

    update();
  });

  function draw() {
    draw_checkerboard(context, [1, 0, 0], 31, "#fd7441", "#2c6184");

    context.fillStyle = "#ffda3a";
    if (slide_horiz) {
      context.fillRect(mouse_x, 0, 1, canvas.height);
    } else {
      context.fillRect(0, mouse_y, canvas.width, 1);
    }
  }

  let waiting = false;
  function update() {
    if (!waiting) {
      waiting = true;
      requestAnimationFrame(() => {
        draw();
        waiting = false;
      });
    }
  }

  update();
}

function main() {
  const editor = document.getElementById('editor');
  const {height} = editor.getBoundingClientRect();

  const panel_width = 240;
  const width = window.innerWidth;
  const canvas = document.getElementById('canvas');
  canvas.height = height;
  canvas.width = width - panel_width;

  const left = document.getElementById('left-panel');
  left.style = `width: ${panel_width}px`;

  // two_up(canvas, 'images/snuff-out.png', 'images/snuff-out.png');
  two_up(canvas, 'images/morris-on.jpg', 'images/morris-off.jpg');
  // two_up(canvas, 'images/snuff-out.png', 'images/morris-off.jpg');
  // slide(canvas, 'images/snuff-out.png', 'images/morris-off.jpg');
}

main();

