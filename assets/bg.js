(() => {
    const canvas = document.getElementById("bg");
    const gl = canvas && canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "low-power" });
    if (!gl) {
        document.documentElement.classList.add("no-gl");
    }

    const stylePresets = {
        default: { value: 0, label: "default" },
        scanline: { value: 1, label: "scanline" },
        pulse: { value: 2, label: "pulse" },
        grid: { value: 3, label: "grid" }
    };

    let activeStyle = "default";
    const savedStyle = (() => {
        try {
            const value = localStorage.getItem("linusware-bg-style");
            return value && stylePresets[value] ? value : "default";
        } catch {
            return "default";
        }
    })();
    activeStyle = savedStyle;

    const settingsToggle = document.getElementById("bg-settings-toggle");
    const settingsMenu = document.getElementById("bg-settings-menu");
    const styleButtons = [...document.querySelectorAll(".bg-style")];

    function applyStyle(styleName) {
        const next = stylePresets[styleName] ? styleName : "default";
        activeStyle = next;
        document.body.dataset.bgStyle = next;
        styleButtons.forEach((button) => {
            const isActive = button.dataset.style === next;
            button.classList.toggle("is-active", isActive);
            button.setAttribute("aria-pressed", String(isActive));
        });
        try {
            localStorage.setItem("linusware-bg-style", next);
        } catch {}
    }

    if (settingsToggle && settingsMenu) {
        settingsToggle.addEventListener("click", () => {
            const hidden = settingsMenu.hasAttribute("hidden");
            settingsMenu.toggleAttribute("hidden", !hidden);
            settingsToggle.setAttribute("aria-expanded", String(hidden));
        });

        styleButtons.forEach((button) => {
            button.addEventListener("click", () => {
                applyStyle(button.dataset.style || "default");
                settingsMenu.setAttribute("hidden", "hidden");
                settingsToggle.setAttribute("aria-expanded", "false");
            });
        });
    }

    if (!gl) {
        applyStyle(activeStyle);
        document.documentElement.classList.add("no-gl");
        document.body.classList.add("no-gl");
        return;
    }

    const VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

    const FS = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 u_res;
uniform float u_scale;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_motion;
uniform vec3 u_bg;
uniform vec3 u_line;
uniform vec3 u_glint;
uniform float u_style;
out vec4 o;

const float SP = 22.0;

float h11(float n) { return fract(sin(n * 127.1 + 31.7) * 43758.5453); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float lineY(float k, float x, float t) {
    float style = clamp(u_style, 0.0, 3.0);
    float a = h11(k), b = h11(k + 17.0), c = h11(k + 41.0);
    float spacing = mix(1.0, 0.8, step(2.0, style));
    float wave = mix(1.0, 1.75, step(1.0, style));
    float drift = mix(1.0, 1.45, step(2.0, style));
    float amp = (3.5 + 5.0 * b) * mix(1.0, 1.2, step(3.0, style));
    float y = k * SP * spacing;
    y += sin(x * (0.0055 + 0.004 * b) * wave + t * (0.22 + 0.18 * c) * drift + a * 6.283) * amp;
    y += sin(x * (0.012 + 0.006 * a) * mix(1.0, 1.45, step(3.0, style)) - t * (0.15 + 0.12 * b) * (0.8 + style * 0.15) + c * 6.283) * (1.5 + 2.5 * c);
    vec2 m = u_mouse - vec2(x, y);
    float f = exp(-dot(m, m) / (2.0 * 62.0 * 62.0));
    float s = m.y / sqrt(m.y * m.y + 16.0 * 16.0);
    y -= s * f * 13.0 * u_motion;
    return y;
}

void main() {
    vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_scale;
    float W = u_res.x / u_scale;
    float t = u_time;
    vec3 col = u_bg;
    float style = clamp(u_style, 0.0, 3.0);

    float aa = 0.9 / u_scale;
    float k0 = floor(p.y / SP);
    float lines = 0.0;
    float glint = 0.0;
    for (int j = -2; j <= 2; j++) {
        float k = k0 + float(j);
        float y = lineY(k, p.x, t);
        float dy = (lineY(k, p.x + 1.0, t) - lineY(k, p.x - 1.0, t)) * 0.5;
        float d = abs(p.y - y) / sqrt(1.0 + dy * dy);
        float cov = 1.0 - smoothstep(0.55 - aa, 0.55 + aa, d);
        vec2 m = u_mouse - vec2(p.x, y);
        float near = exp(-dot(m, m) / (2.0 * 80.0 * 80.0)) * u_motion;
        float inten = (0.35 + 0.65 * h11(k + 5.0)) * (1.0 + 0.9 * near);
        lines = max(lines, cov * inten);

        float span = (W + 360.0) * mix(1.0, 1.25, step(3.0, style));
        float speed = (45.0 + 70.0 * h11(k + 9.0)) * mix(1.0, 1.5, step(2.0, style));
        float ph = t * speed / span + h11(k + 3.0);
        float on = step(0.62, h11(k * 3.1 + floor(ph) * 7.7));
        float gx = fract(ph) * span - 180.0;
        float dx = gx - p.x;
        float trail = dx > 0.0 ? pow(max(1.0 - dx / 130.0, 0.0), 2.0) : exp(-dx * dx / 18.0);
        float halo = exp(-d * d / 10.0) * exp(-dx * dx / 900.0);
        float trailBoost = mix(1.0, 1.5, step(1.0, style));
        float haloBoost = mix(1.0, 1.7, step(2.0, style));
        glint += on * (cov * trail * trailBoost + 0.15 * halo * haloBoost);
    }
    col = mix(col, u_line, clamp(lines, 0.0, 1.0));
    col += u_glint * clamp(glint, 0.0, 1.0) * 0.45;

    vec2 uv = p / vec2(W, u_res.y / u_scale) - 0.5;
    col *= 1.0 - (0.35 * smoothstep(0.35, 0.85, length(uv * vec2(1.1, 1.3))) * mix(1.0, 1.3, step(1.0, style)));
    col += (h21(gl_FragCoord.xy + fract(t) * 91.0) - 0.5) / 255.0;
    o = vec4(col, 1.0);
}`;

    function shader(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
    }

    let prog;
    try {
        prog = gl.createProgram();
        gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
        gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) {
        document.documentElement.classList.add("no-gl");
        return;
    }
    gl.useProgram(prog);
    gl.bindVertexArray(gl.createVertexArray());
    const u = (n) => gl.getUniformLocation(prog, n);
    const U = { res: u("u_res"), scale: u("u_scale"), time: u("u_time"), mouse: u("u_mouse"), motion: u("u_motion"), bg: u("u_bg"), line: u("u_line"), glint: u("u_glint"), style: u("u_style") };

    const want = { bg: [0.0157, 0.0314, 0.0784], line: [0.025, 0.13, 0.36], glint: [0.30, 0.58, 1.0] };
    const pal = { bg: [...want.bg], line: [...want.line], glint: [...want.glint] };

    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    let mouse = [-1e4, -1e4];
    let target = 0;
    let motion = 0;
    let last = performance.now();
    const start = last;
    let running = false;

    addEventListener("pointermove", (e) => {
        mouse = [e.clientX, e.clientY];
        target = e.pointerType === "mouse" ? 1 : 0;
        wake();
    }, { passive: true });
    document.documentElement.addEventListener("pointerleave", () => { target = 0; });
    addEventListener("resize", wake);
    document.addEventListener("visibilitychange", wake);

    function ease(a, b, k) {
        for (let i = 0; i < 3; i++) a[i] += (b[i] - a[i]) * k;
    }

    function frame(now) {
        running = false;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.round(innerWidth * dpr));
        const h = Math.max(1, Math.round(innerHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        const still = reduce.matches;
        motion += (target - motion) * (1 - Math.exp(-dt * 6));
        const k = still ? 1 : 1 - Math.exp(-dt * 4);
        ease(pal.bg, want.bg, k);
        ease(pal.line, want.line, k);
        ease(pal.glint, want.glint, k);

        gl.viewport(0, 0, w, h);
        gl.uniform2f(U.res, w, h);
        gl.uniform1f(U.scale, dpr);
        gl.uniform1f(U.time, still ? 40.0 : (now - start) / 1000);
        gl.uniform2f(U.mouse, mouse[0], mouse[1]);
        gl.uniform1f(U.motion, still ? 0 : motion);
        gl.uniform3fv(U.bg, pal.bg);
        gl.uniform3fv(U.line, pal.line);
        gl.uniform3fv(U.glint, pal.glint);
        gl.uniform1f(U.style, stylePresets[activeStyle] ? stylePresets[activeStyle].value : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (!still && !document.hidden) wake();
    }

    function wake() {
        if (running || document.hidden) return;
        running = true;
        requestAnimationFrame(frame);
    }

    applyStyle(activeStyle);
    wake();
})();
