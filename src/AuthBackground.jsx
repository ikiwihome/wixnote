import { useEffect, useRef } from 'react';

// A slowly swirling, domain-warped soft checker pattern in blue and white.
const VERTEX = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;
const FRAGMENT = `
precision mediump float;
uniform vec2 uResolution;
uniform float uTime;
const vec3 BLUE = vec3(0.541, 0.639, 0.839);
const vec3 WHITE = vec3(1.0);
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  uv.y -= 0.3;
  float a = -0.087;
  uv = mat2(cos(a), -sin(a), sin(a), cos(a)) * uv * 1.6;
  float t = uTime;
  for (int i = 1; i <= 8; i++) {
    float f = float(i);
    uv.x += 0.55 / f * sin(t + f * uv.y + 0.4 * f);
    uv.y += 0.55 / f * cos(0.8 * t + f * uv.x - 0.2 * f);
  }
  uv += 0.12 * vec2(sin(uv.y * 2.0 + t), cos(uv.x * 2.0 - t));
  float checks = sin(uv.x * 3.2) * sin(uv.y * 3.2);
  float mixAmount = smoothstep(-0.75, 0.95, checks);
  gl_FragColor = vec4(mix(BLUE, WHITE, mixAmount), 1.0);
}`;

function startWarp(canvas, animate) {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) return () => {};
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return () => {};
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const resolution = gl.getUniformLocation(program, 'uResolution'),
    time = gl.getUniformLocation(program, 'uTime');

  let frame = 0;
  const start = performance.now();
  const draw = (now) => {
    gl.uniform1f(time, 4 + ((now - start) / 1000) * 0.12);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.dataset.ready = '';
    if (animate) frame = requestAnimationFrame(draw);
  };
  // The pattern is soft, so rendering at reduced resolution is visually lossless.
  const resize = () => {
    const scale = Math.min(window.devicePixelRatio || 1, 2) * 0.5;
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(resolution, canvas.width, canvas.height);
    if (!animate) draw(start);
  };
  const visibility = () => {
    cancelAnimationFrame(frame);
    if (animate && !document.hidden) frame = requestAnimationFrame(draw);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  visibility();
  document.addEventListener('visibilitychange', visibility);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener('visibilitychange', visibility);
  };
}

// A faint dot grid whose connecting lines stop short of each dot.
function startGrid(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const spacing = 90,
    gap = 10;
  const draw = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2),
      width = canvas.clientWidth,
      height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const columns = Math.ceil(width / spacing) + 1,
      rows = Math.ceil(height / spacing) + 1,
      left = (width - (columns - 1) * spacing) / 2,
      top = (height - (rows - 1) * spacing) / 2;
    ctx.strokeStyle = 'rgba(60, 100, 160, 0.1)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const x = left + column * spacing,
          y = top + row * spacing;
        if (column < columns - 1) {
          ctx.moveTo(x + gap, y);
          ctx.lineTo(x + spacing - gap, y);
        }
        if (row < rows - 1) {
          ctx.moveTo(x, y + gap);
          ctx.lineTo(x, y + spacing - gap);
        }
      }
    ctx.stroke();
    ctx.fillStyle = 'rgba(60, 100, 160, 0.04)';
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        ctx.beginPath();
        ctx.arc(left + column * spacing, top + row * spacing, 1.8, 0, 2 * Math.PI);
        ctx.fill();
      }
  };
  const observer = new ResizeObserver(draw);
  observer.observe(canvas);
  return () => observer.disconnect();
}

export default function AuthBackground() {
  const warp = useRef(),
    grid = useRef();
  useEffect(() => {
    const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stopWarp = startWarp(warp.current, animate),
      stopGrid = startGrid(grid.current);
    return () => {
      stopWarp();
      stopGrid();
    };
  }, []);
  return (
    <div className="auth-backdrop" aria-hidden="true">
      <canvas ref={warp} className="auth-warp" />
      <canvas ref={grid} className="auth-grid" />
    </div>
  );
}
