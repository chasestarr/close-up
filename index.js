class Transform {
  constructor(scale, translate_x, translate_y) {
    this.scale = scale;
    this.translate_x = translate_x;
    this.translate_y = translate_y;

    this.pan_prev_x = 0;
    this.pan_prev_y = 0;
  }

  pan_start(x, y) {
    this.pan_prev_x = x;
    this.pan_prev_y = y;
  }

  pan_move(x, y) {
    this.translate_x += x - this.pan_prev_x;
    this.translate_y += y - this.pan_prev_y;
    this.pan_prev_x = x;
    this.pan_prev_y = y;
  }

  zoom_toward(x, y, value) {
    const zoom = 1 - value / 500;

    let t = new Transform(this.scale, this.translate_x, this.translate_y);

    t = new Transform(1, -x, -y).mult_transform(t);
    t = new Transform(zoom, 0, 0).mult_transform(t);
    t = new Transform(1, x, y).mult_transform(t);

    if (t.scale > 0.1) {
      this.scale = t.scale;
      this.translate_x = t.translate_x;
      this.translate_y = t.translate_y;
    }
  }

  fit(subject_width, subject_height, bounds_width, bounds_height) {
    if (subject_height > subject_width) {
      this.scale = bounds_height / subject_height;
      this.translate_x = bounds_width / 2 - subject_width * this.scale / 2;
      this.translate_y = 0;
    } else {
      this.scale = bounds_width / subject_width;
      this.translate_x = 0;
      this.translate_y = bounds_height / 2 - subject_height * this.scale / 2;
    }
  }

  inverse() {
    const s = 100 / this.scale / 100;
    return new Transform(
      s,
      this.translate_x * s,
      this.translate_y * s,
    )
  }

  mult_transform(t) {
    return new Transform(
      this.scale * t.scale,
      this.scale * t.translate_x + this.translate_x,
      this.scale * t.translate_y + this.translate_y,
    );
  }

  mult_vector(v) {
    return [this.scale * v[0], this.scale * v[1]];
  }
}

const F_KEY = 70;
const X_KEY = 88;

function local_mouse_position(canvas, global_x, global_y) {
  const canvasRect = canvas.getBoundingClientRect();
  const x = Math.min(canvas.width, Math.max(0, global_x - canvasRect.left + window.scrollX));
  const y = Math.min(canvas.height, Math.max(0, global_y - canvasRect.top + window.scrollY));
  return [x, y];
}

function draw_rect(ctx, transform, position, scale, color) {
  const p = transform.mult_vector(position);
  const s = transform.mult_vector(scale);
  ctx.fillStyle = color;
  ctx.fillRect(transform.translate_x + p[0], transform.translate_y + p[1], s[0], s[1]);
}

function draw_image(ctx, transform, img) {
  let size = transform.mult_vector([img.naturalWidth, img.naturalHeight]);
  ctx.drawImage(img, transform.translate_x, transform.translate_y, size[0], size[1]);
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

function imagedata_to_image(imagedata) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = imagedata.width;
  canvas.height = imagedata.height;
  context.putImageData(imagedata, 0, 0);
  const im = new Image();
  im.src = canvas.toDataURL();
  return im;
}

function image_data(img) {
  const offscreen = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
  const context = offscreen.getContext('2d');
  context.drawImage(img, 0, 0);
  return context.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
}

function image_subtract(img_a, img_b) {
  const data_a = image_data(img_a);
  const data_b = image_data(img_b);
  const width = Math.max(data_a.width, data_b.width);
  const height = Math.max(data_a.height, data_b.height);

  function get_value(src, x, y){
    const channels = 4;
    if (x < src.width && y < src.height) {
      const start = (y * src.width + x) * channels;
      return [
        src.data[start],
        src.data[start + 1],
        src.data[start + 2],
        src.data[start + 3],
      ];
    }
    return [0, 0, 0, 0];
  }

  let index = 0;
  let im = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [ra, ga, ba, aa] = get_value(data_a, x, y);
      const [rb, gb, bb, ab] = get_value(data_b, x, y);
      const r = Math.abs(ra - rb);
      const g = Math.abs(ga - gb);
      const b = Math.abs(ba - bb);

      const dist = r + g + b;
      im[index] = dist > 0 ? 255 : 0;
      im[index + 1] = 0;
      im[index + 2] = 0;
      im[index + 3] = dist;
      index += 4;
    }
  }
  const imagedata = new ImageData(Uint8ClampedArray.from(im), width, height);
  return imagedata_to_image(imagedata);
}

const MODE_TWO_UP = 0;
const MODE_SLIDE = 1;

function CloseUp(canvas, img_a, img_b) {
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;

  let update_waiting = false;
  let transform = new Transform(1, 0, 0);
  let mouse_x = -1;
  let mouse_y = -1;
  let mouse_left_down = false;
  let slide_horiz = true;

  let mode = MODE_TWO_UP;
  fit();

  context.imageSmoothingQuality = 'high';
  canvas.addEventListener('wheel', handle_wheel);
  canvas.addEventListener('mousemove', handle_mouse_move);
  canvas.addEventListener('mousedown', handle_mouse_down);
  canvas.addEventListener('mouseup', handle_mouse_up);
  canvas.addEventListener('mouseleave', handle_mouse_leave);
  canvas.addEventListener('keydown', handle_key_down);
  canvas.addEventListener('keyup', handle_key_up);
  canvas.oncontextmenu = () => false;

  let draw_diff = false;
  let diff_img_a = null;
  let diff_img_b = null;
  function load_diff() {
    requestAnimationFrame(() => {
      diff_img_a = image_subtract(img_a, img_b);
      diff_img_b = image_subtract(img_b, img_a);
    });
  }

  function cleanup() {
    canvas.removeEventListener('wheel', handle_wheel);
    canvas.removeEventListener('mousemove', handle_mouse_move);
    canvas.removeEventListener('mousedown', handle_mouse_down);
    canvas.removeEventListener('mouseup', handle_mouse_up);
    canvas.removeEventListener('mouseleave', handle_mouse_leave);
    canvas.removeEventListener('keydown', handle_key_down);
    canvas.removeEventListener('keyup', handle_key_up);
  }

  function handle_wheel(event) {
    event.preventDefault();
    const [local_x, local_y] = local_mouse_position(canvas, event.clientX, event.clientY);
    if (mode === MODE_TWO_UP) {
      const frame_width = canvas.width / 2;
      transform.zoom_toward(
        local_x > frame_width ? local_x - frame_width : local_x,
        local_y,
        event.deltaY
      );
    } else if (mode === MODE_SLIDE) {
      transform.zoom_toward(local_x, local_y, event.deltaY);
    }
    if (transform.scale > 2) {
      context.imageSmoothingEnabled = false;
    } else {
      context.imageSmoothingEnabled = true;
    }
    update();
  }

  function handle_mouse_move(event) {
    const [local_x, local_y] = local_mouse_position(canvas, event.clientX, event.clientY);

    if (mouse_left_down) {
      transform.pan_move(local_x, local_y);
    }

    if (mode === MODE_SLIDE) {
      mouse_x = local_x;
      mouse_y = local_y;

      const horiz_edge = canvas.width / 8;
      const vert_edge = canvas.height / 8;
      if (mouse_y < vert_edge || mouse_y > canvas.height - vert_edge) {
        slide_horiz = false;
      } else if (mouse_x < horiz_edge || mouse_x > canvas.width - horiz_edge) {
        slide_horiz = true;
      }
    }

    canvas.focus();

    update();
  }

  function handle_mouse_down(event) {
    if (event.which === 1) {
      const [local_x, local_y] = local_mouse_position(canvas, event.clientX, event.clientY);
      mouse_left_down = true;
      transform.pan_start(local_x, local_y);
    }
    update();
  }

  function handle_mouse_up(event) {
    if (event.which === 1) {
      mouse_left_down = false;
    }
    update();
  }

  function handle_mouse_leave() {
    mouse_left_down = false;
    update();
  }

  function handle_key_down(event) {
    if (event.keyCode === F_KEY) {
      fit();
    }
    if (event.keyCode === X_KEY) {
      draw_diff = true;
    }

    update();
  }

  function handle_key_up(event) {
    if (event.keyCode === X_KEY) {
      draw_diff = false;
      update();
    }
  }

  function fit() {
    const max_height = Math.max(img_a.naturalHeight, img_b.naturalHeight);
    const max_width = Math.max(img_a.naturalWidth, img_b.naturalWidth);
    if (mode === MODE_TWO_UP) {
      transform.fit(max_width, max_height, canvas.width / 2, canvas.height);
    } else if (mode === MODE_SLIDE) {
      transform.fit(max_width, max_height, canvas.width, canvas.height);
    }
    update();
  }

  function set_mode(next_mode) {
    if (next_mode === MODE_TWO_UP && mode !== MODE_TWO_UP) {
      mode = MODE_TWO_UP;
    } else if (next_mode === MODE_SLIDE && mode !== MODE_SLIDE) {
      mode = MODE_SLIDE;
      mouse_x = canvas.width / 2;
      mouse_y = 0;
    }
    fit();
  }

  function draw_two_up() {
    const frame_width = canvas.width / 2;
    const left = new Transform(1, 0, 0).mult_transform(transform);
    const right = new Transform(1, frame_width, 0).mult_transform(transform);

    context.fillStyle = '#f6f6f6';
    context.fillRect(0, 0, frame_width, canvas.height);

    draw_rect(context, left, [0, 0], [img_b.naturalWidth, img_b.naturalHeight], "#FECB4D");
    const [width_a, height_a] = left.mult_vector([img_a.naturalWidth, img_a.naturalHeight]);
    const [width_b, height_b] = right.mult_vector([img_b.naturalWidth, img_b.naturalHeight]);

    context.drawImage(
      img_a,
      left.translate_x,
      left.translate_y,
      width_a,
      height_a,
    );

    if (draw_diff && diff_img_a) {
      context.drawImage(
        diff_img_a,
        left.translate_x,
        left.translate_y,
        ...left.mult_vector([diff_img_a.width, diff_img_a.height]),
      );
    }

    context.save();
    context.clip(context.rect(frame_width, 0, frame_width, canvas.height));

    context.fillStyle = '#f6f6f6';
    context.fillRect(frame_width, 0, frame_width, canvas.height);

    draw_rect(context, right, [0, 0], [img_a.naturalWidth, img_a.naturalHeight], "#FECB4D");
    context.drawImage(
      img_b,
      right.translate_x,
      right.translate_y,
      width_b,
      height_b,
    );

    if (draw_diff && diff_img_b) {
      context.drawImage(
        diff_img_b,
        right.translate_x,
        right.translate_y,
        ...right.mult_vector([diff_img_b.width, diff_img_b.height]),
      );
    }

    context.restore();
  }

  function draw_slide() {
    context.fillStyle = '#f6f6f6';
    context.fillRect(0, 0, canvas.width, canvas.height);

    let a_size = transform.mult_vector([img_a.naturalWidth, img_a.naturalHeight]);
    context.drawImage(img_a, transform.translate_x, transform.translate_y, a_size[0], a_size[1]);

    // if (draw_diff && diff_img_a) {
    //   let a_diff_size = transform.mult_vector([diff_img_a.width, diff_img_a.height]);
    //   context.drawImage(diff_img_a, transform.translate_x, transform.translate_y, a_diff_size[0], a_diff_size[1]);
    // }

    context.fillStyle = "#ffda3a";
    if (slide_horiz) {
      const inverse = transform.inverse();
      const [local_mouse_x] = inverse.mult_vector([mouse_x, 0]);
      const slide_x = local_mouse_x - inverse.translate_x;
      const b_full_size = transform.mult_vector([img_b.naturalWidth, img_b.naturalHeight]);
      const b_hidden_size = transform.mult_vector([slide_x, 0]);

      context.drawImage(
        img_b,
        slide_x, 0,
        img_b.naturalWidth - slide_x, img_b.naturalHeight,
        transform.translate_x + b_hidden_size[0], transform.translate_y,
        b_full_size[0] - b_hidden_size[0], b_full_size[1],
      );

      if (draw_diff && diff_img_b) {
        const diff_b_full_size = transform.mult_vector([diff_img_b.width, diff_img_b.height]);
        context.drawImage(
          diff_img_b,
          slide_x, 0,
          diff_img_b.width - slide_x, diff_img_b.height,
          transform.translate_x + b_hidden_size[0], transform.translate_y,
          diff_b_full_size[0] - b_hidden_size[0], diff_b_full_size[1],
        );
      }

      context.fillRect(mouse_x, 0, 1, canvas.height);
    } else {
      const inverse = transform.inverse();
      const [, local_mouse_y] = inverse.mult_vector([0, mouse_y]);
      const slide_y = local_mouse_y - inverse.translate_y;
      const b_full_size = transform.mult_vector([img_b.naturalWidth, img_b.naturalHeight]);
      const b_hidden_size = transform.mult_vector([0, slide_y]);

      context.drawImage(
        img_b,
        0, slide_y,
        img_b.naturalWidth, img_b.naturalHeight - slide_y,
        transform.translate_x, transform.translate_y + b_hidden_size[1],
        b_full_size[0], b_full_size[1] - b_hidden_size[1],
      );

      if (draw_diff && diff_img_b) {
        const diff_b_full_size = transform.mult_vector([diff_img_b.width, diff_img_b.height]);
        context.drawImage(
          diff_img_b,
          0, slide_y,
          diff_img_b.width, diff_img_b.height - slide_y,
          transform.translate_x, transform.translate_y + b_hidden_size[1],
          diff_b_full_size[0], diff_b_full_size[1] - b_hidden_size[1],
        );
      }

      context.fillRect(0, mouse_y, canvas.width, 1);
    }
  }

  function update() {
    if (!update_waiting) {
      update_waiting = true;
      requestAnimationFrame(() => {
        if (mode === MODE_TWO_UP) {
          draw_two_up();
        } else if (mode === MODE_SLIDE) {
          draw_slide();
        }
        update_waiting = false;

        if (!diff_img_a && !diff_img_b) {
          load_diff();
        }
      });
    }
  }

  return {
    cleanup,
    set_mode
  };
}

function load_image(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.src = url;
    img.onload = () => {
      resolve(img);
    }
  });
}

async function display(canvas, url_a, url_b) {
  const img_a = await load_image(url_a);
  const img_b = await load_image(url_b);
  return CloseUp(canvas, img_a, img_b);
}

async function main() {
  const editor = document.getElementById('editor');
  const {height} = editor.getBoundingClientRect();

  const panel_width = 240;
  const width = window.innerWidth;
  const canvas = document.getElementById('canvas');
  canvas.height = height;
  canvas.width = width - panel_width;

  const left = document.getElementById('left-panel');
  left.style = `width: ${panel_width}px`;

  let close_up = null;

  canvas.addEventListener('keydown', event => {
    if (event.keyCode === 49) {
      close_up.set_mode(MODE_TWO_UP);
    }
    if (event.keyCode === 50) {
      close_up.set_mode(MODE_SLIDE);
    }
  });

  const modes = [
    [MODE_TWO_UP, 'two-up'],
    [MODE_SLIDE, 'slide'],
  ];
  const toolbar = document.getElementById('toolbar');
  const mode_buttons = modes.map(([mode, label]) => {
    const button = document.createElement('button');
    button.classList.add('toolbar-button');
    button.textContent = label;
    button.addEventListener('click', () => {
      mode_buttons.forEach(b => b.classList.remove('toolbar-button-selected'));
      button.classList.add('toolbar-button-selected');
      close_up.set_mode(mode);
    });
    toolbar.appendChild(button);
    return button;
  });
  mode_buttons[0].classList.add('toolbar-button-selected');

  let selected_option_index = 2;
  const options = [
    ['images/morris-off.jpg', 'images/morris-on.jpg'],
    // https://www.kaggle.com/vbookshelf/computed-tomography-ct-images
    ['images/ct-scan-01.jpg', 'images/ct-scan-02.jpg'],
    // https://www.kaggle.com/kmader/aerial-change-detection-in-video-games
    ['images/game-aerial-before.png', 'images/game-aerial-after.png'],
    ['images/snuff-out.png', 'images/statecraft.png'],
    ['images/data-table-before.png', 'images/data-table-after.png'],
  ];
  const option_elements = options.map(([url_a, url_b], index) => {
    const li = document.createElement('li');
    li.classList.add('left-panel-option');
    if (selected_option_index === index) {
      li.classList.add('left-panel-option-selected');
    }
    const button = document.createElement('button');
    button.textContent = `${url_a}, ${url_b}`;
    button.addEventListener('click', async () => {
      close_up.cleanup();
      close_up = await display(canvas, url_a, url_b);
      selected_option_index = index;

      option_elements.forEach((l, i) => {
        if (selected_option_index === i) {
          l.classList.add('left-panel-option-selected');
        } else {
          l.classList.remove('left-panel-option-selected');
        }
      });
    });
    li.appendChild(button);
    left.appendChild(li);
    return li;
  });

  close_up = await display(
    canvas,
    options[selected_option_index][0],
    options[selected_option_index][1]
  );
}

main();

