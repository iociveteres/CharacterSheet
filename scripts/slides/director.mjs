// What a take of a landing slide is made of: a page with a cursor and tooltips
// drawn on it, unhurried moves and typing, a screenshot of a frame and a video
// of a frame made from the page's screencast. Scenarios in ./scenarios use it.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Draws what headless Chrome does not: the mouse cursor and the tooltip of a
 * `title`, which the browser draws outside the page. Runs in the page as an
 * init script. While `__slidesGlide` runs, the cursor follows its path frame by
 * frame, not the mouse events, which come late and uneven over CDP.
 */
export function installOverlay() {
    const ARROW = '<svg width="20" height="28" viewBox="0 0 20 28"><path d="M1 1v21l5-5 4 9 3.5-1.5-4-8.5h7z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    const HAND = '<svg width="24" height="28" viewBox="0 0 24 28"><path d="M8 2.5a1.75 1.75 0 0 1 3.5 0V12l.4-2.4a1.75 1.75 0 0 1 3.4.6l-.1 2 .3-1.4a1.75 1.75 0 0 1 3.4.7l-.2 1.4.3-.9a1.7 1.7 0 0 1 3.2 1.1L21 21c-.8 3-3 5.5-6.5 5.5h-2.7c-2.3 0-3.8-1-5-2.8L2.2 16.5a1.8 1.8 0 0 1 2.9-2.1L8 17.5z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    const BEAM = '<svg width="12" height="24" viewBox="0 0 12 24"><path d="M2 1.5h3l1 1 1-1h3M6 2.5v19M2 22.5h3l1-1 1 1h3" fill="none" stroke="#000" stroke-width="3"/><path d="M2 1.5h3l1 1 1-1h3M6 2.5v19M2 22.5h3l1-1 1 1h3" fill="none" stroke="#fff" stroke-width="1.2"/></svg>';
    // A hand of rounded parts: their wide black strokes under their white fills make one
    // outline, and thin strokes part the fingers above the palm.
    const palm = (fingers, thumb, rest) => {
        const parts = [...fingers, thumb, rest].join('');
        return `<svg width="24" height="26" viewBox="0 0 24 26"><g fill="#000" stroke="#000" stroke-width="2" stroke-linejoin="round">${parts}</g>`
            + `<g fill="#fff" stroke="#000" stroke-width=".8">${fingers.join('')}${thumb}</g><g fill="#fff">${rest}</g></svg>`;
    };
    const bar = (x, y, w, h, turn = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2}"${turn ? ` transform="rotate(${turn} ${x + w / 2} ${y + h / 2})"` : ''}/>`;
    const GRAB = palm([bar(6.5, 3, 3.2, 11), bar(9.8, 1.5, 3.2, 12), bar(13.1, 2.5, 3.2, 11), bar(16.4, 5, 3, 9)],
        bar(2.6, 10.5, 3.2, 8, -40), '<rect x="6.5" y="10" width="12.9" height="12.5" rx="4.5"/>');
    const GRABBING = palm([bar(6.5, 7, 3.2, 6), bar(9.8, 6.5, 3.2, 6.5), bar(13.1, 7, 3.2, 6), bar(16.4, 8, 3, 5.5)],
        bar(3.6, 11.5, 3.2, 6, -25), '<rect x="6.2" y="10.5" width="13.2" height="12" rx="4.5"/>');
    // Where the click point is in each picture.
    const SHAPES = { arrow: [ARROW, 1, 1], hand: [HAND, 9, 2], text: [BEAM, 6, 12], grab: [GRAB, 12, 12], grabbing: [GRABBING, 12, 12] };
    const TOOLTIP_DELAY = 500;

    function mount() {
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>
            .cursor { position: fixed; left: 0; top: 0; display: none; will-change: transform; }
            .tip { position: fixed; display: none; max-width: 520px; padding: 4px 7px; white-space: pre-wrap;
                font: 12px/1.4 "Segoe UI", system-ui, sans-serif; color: #fff; background: #2b2b2b;
                border: 1px solid #555; border-radius: 4px; box-shadow: 0 2px 6px rgba(0, 0, 0, .35); }
        </style><div class="tip"></div><div class="cursor"></div>`;
        document.documentElement.append(host);
        const cursor = root.querySelector('.cursor'), tip = root.querySelector('.tip');

        // held: the button went down on what can be grabbed, and the hand keeps it closed
        // wherever it carries it.
        let shape = '', titled = null, tipTimer = 0, x = 0, y = 0, gliding = false, held = false, at = [0, 0];
        const place = (px, py, target) => {
            at = [px, py];
            const next = shapeOf(target);
            if (next !== shape) {
                shape = next;
                cursor.innerHTML = SHAPES[shape][0];
            }
            cursor.style.display = 'block';
            cursor.style.transform = `translate(${px - SHAPES[shape][1]}px, ${py - SHAPES[shape][2]}px)`;
        };
        // The element under a point, inside the shadow roots too: the sheet lives in one.
        // A shadow root can answer with an element outside it, so a step that goes
        // back to a seen element ends the descent.
        const deepAt = (px, py) => {
            let el = document.elementFromPoint(px, py);
            const seen = new Set();
            while (el?.shadowRoot && !seen.has(el)) {
                seen.add(el);
                const inner = el.shadowRoot.elementFromPoint(px, py);
                if (!inner || seen.has(inner)) break;
                el = inner;
            }
            return el;
        };
        window.__slidesGlide = (points, duration) => new Promise(done => {
            gliding = true;
            const last = points.length - 1;
            // The time of a frame is when it began, which can be before performance.now()
            // at the call: the glide starts at its first frame.
            let start = null;
            const frame = now => {
                start ??= now;
                let f = last;
                try {
                    f = Math.min(1, (now - start) / duration) * last;
                    const i = Math.floor(f), u = f - i;
                    const a = points[i], b = points[Math.min(i + 1, last)];
                    const px = a[0] + (b[0] - a[0]) * u, py = a[1] + (b[1] - a[1]) * u;
                    place(px, py, deepAt(px, py));
                } finally {
                    if (f < last) requestAnimationFrame(frame);
                    else {
                        gliding = false;
                        done();
                    }
                }
            };
            requestAnimationFrame(frame);
        });
        const shapeOf = target => {
            if (held) return 'grabbing';
            const css = target instanceof Element ? getComputedStyle(target).cursor : 'auto';
            if (css === 'pointer') return 'hand';
            if (css === 'text') return 'text';
            if (css === 'grab' || css === 'grabbing') return css;
            if (css === 'auto' && target instanceof Element && target.matches('textarea:not([readonly]), input:not([readonly], [type=checkbox], [type=radio], [type=button], [type=submit])')) return 'text';
            return 'arrow';
        };
        const hideTip = () => { clearTimeout(tipTimer); tip.style.display = 'none'; };
        const showTip = () => {
            const text = titled?.getAttribute('title');
            if (!text) return;
            // Kept inside the frame being recorded (Director.record), else the viewport.
            const f = window.__slidesFrame ?? { x: 0, y: 0, width: innerWidth, height: innerHeight };
            tip.textContent = text;
            tip.style.maxWidth = `${Math.min(520, f.width - 8)}px`;
            tip.style.display = 'block';
            const w = tip.offsetWidth, h = tip.offsetHeight;
            tip.style.left = `${Math.max(f.x + 4, Math.min(x + 4, f.x + f.width - w - 4))}px`;
            tip.style.top = `${Math.max(f.y + 4, y + 24 + h > f.y + f.height ? y - h - 6 : y + 24)}px`;
        };

        addEventListener('mousemove', e => {
            x = e.clientX; y = e.clientY;
            const path = e.composedPath();
            if (!gliding) place(x, y, path[0]);
            const el = path.find(n => n instanceof Element && n.hasAttribute('title'));
            if (el !== titled) {
                titled = el ?? null;
                hideTip();
                if (titled) tipTimer = setTimeout(showTip, TOOLTIP_DELAY);
            }
        }, true);
        addEventListener('mousedown', () => {
            hideTip();
            if (shape !== 'grab') return;
            held = true;
            place(...at);
        }, true);
        addEventListener('mouseup', () => {
            if (!held) return;
            held = false;
            place(...at, deepAt(...at));
        }, true);
        // Until the next move: a screenshot shows no cursor.
        window.__slidesHideCursor = () => {
            hideTip();
            cursor.style.display = 'none';
        };
    }

    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount);
    else mount();
}

/** A rectangle in CSS pixels of the viewport. */
const rect = (x, y, width, height) => ({ x, y, width, height });

/** Random numbers in [0, 1) from a fixed seed: the same takes in both themes (mulberry32). */
function seeded(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** How far along a hand's move is at time t of it: slow start and end, no jerk. */
const minimumJerk = t => t * t * t * (10 - 15 * t + 6 * t * t);

/**
 * The path of a hand moving the mouse from `from` to `to`, as points 120 times
 * a second: a bow to one side, a duration that grows with the distance (Fitts),
 * and on a long move a slight overshoot taken back at the end.
 */
function handPath(from, to, random, duration) {
    const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy);
    if (dist < 2) return { points: [[to.x, to.y]], duration: 16 };
    duration ??= Math.min(750, Math.max(180, 140 + 85 * Math.log2(1 + dist / 20)));
    const nx = -dy / dist, ny = dx / dist;
    const bow = (random() * 2 - 1) * Math.min(90, dist * .16);
    const over = dist > 220 ? Math.min(12, dist * .025) * (.6 + random() * .6) : 0;
    const end = { x: to.x + dx / dist * over, y: to.y + dy / dist * over };
    const c1 = { x: from.x + dx * .3 + nx * bow, y: from.y + dy * .3 + ny * bow };
    const c2 = { x: from.x + dx * .8 + nx * bow * .4, y: from.y + dy * .8 + ny * bow * .4 };
    // The share of the time the stroke takes; the rest comes back from the overshoot.
    const stroke = over ? .85 : 1;
    const bezier = s => {
        const r = 1 - s;
        return [
            r * r * r * from.x + 3 * r * r * s * c1.x + 3 * r * s * s * c2.x + s * s * s * end.x,
            r * r * r * from.y + 3 * r * r * s * c1.y + 3 * r * s * s * c2.y + s * s * s * end.y,
        ];
    };
    const n = Math.max(2, Math.round(duration / 1000 * 120));
    const points = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        if (t <= stroke) points.push(bezier(minimumJerk(t / stroke)));
        else {
            const k = minimumJerk((t - stroke) / (1 - stroke));
            points.push([end.x + (to.x - end.x) * k, end.y + (to.y - end.y) * k]);
        }
    }
    return { points, duration };
}

export class Director {
    /** Where the mouse is, for moves that start from it. */
    pos = { x: 0, y: 0 };
    random = seeded(40000);

    constructor(page, { theme, scale, takes }) {
        this.page = page;
        this.theme = theme;
        this.scale = scale;
        this.takes = takes;
    }

    // ─── Moves ───────────────────────────────────────────────────────────────

    pause(ms) {
        return sleep(ms);
    }

    /** A point of a locator near its centre, as a hand aims, or the point given. */
    async pointOf(target) {
        if ('x' in target && !('locator' in target)) return target;
        const box = await target.boundingBox();
        if (!box) throw new Error(`Not on screen: ${target}`);
        const off = () => (this.random() - .5) * .4;
        return { x: box.x + box.width * (.5 + off()), y: box.y + box.height * (.5 + off()) };
    }

    /**
     * Moves the mouse to the target as a hand does (handPath). The page draws
     * the cursor along the path at its own frame rate; the mouse events follow
     * it every 30 ms for hovers and tooltips and end on the target.
     */
    async moveTo(target, { duration } = {}) {
        const to = await this.pointOf(target);
        const path = handPath(this.pos, to, this.random, duration);
        const glide = this.page.evaluate(([points, ms]) => window.__slidesGlide(points, ms), [path.points, path.duration]);
        const start = Date.now(), last = path.points.length - 1;
        for (let t = 0; t < path.duration; t = Date.now() - start) {
            const [x, y] = path.points[Math.min(last, Math.round(t / path.duration * last))];
            await this.page.mouse.move(x, y);
            await sleep(30);
        }
        await this.page.mouse.move(to.x, to.y);
        await glide;
        this.pos = to;
    }

    /** Moves to the target, settles for a moment as a hand does, and clicks. */
    async click(target, opts) {
        if (target) await this.moveTo(target, opts);
        await sleep(60 + this.random() * 50);
        await this.page.mouse.down();
        await sleep(60 + this.random() * 30);
        await this.page.mouse.up();
    }

    /** Takes `from` with the button held, carries it to `to` and lets it go there. */
    async drag(from, to, opts) {
        await this.moveTo(from);
        await sleep(60 + this.random() * 50);
        await this.page.mouse.down();
        await sleep(150);
        await this.moveTo(to, opts);
        // The list makes room for the item before it is let go.
        await sleep(250);
        await this.page.mouse.up();
    }

    /** Types like a person: a steady pace, a little uneven. */
    async type(text, { delay = 75 } = {}) {
        let i = 0;
        for (const ch of text) {
            await this.page.keyboard.type(ch);
            // A fixed uneven rhythm, the same in every take.
            await sleep(delay + ((i++ * 37) % 5 - 2) * 12);
        }
    }

    // ─── Frames ──────────────────────────────────────────────────────────────

    /**
     * The rectangle around the locators, `pad` pixels wider on each side, kept
     * in the page and of even size in device pixels, as yuv420p video needs.
     */
    async frameOf(locators, { pad = 0 } = {}) {
        const boxes = [];
        for (const l of [locators].flat()) {
            const b = await l.boundingBox();
            if (!b) throw new Error(`Not on screen: ${l}`);
            boxes.push(b);
        }
        const doc = await this.page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
        const x0 = Math.max(0, Math.floor(Math.min(...boxes.map(b => b.x)) - pad));
        const y0 = Math.max(0, Math.floor(Math.min(...boxes.map(b => b.y)) - pad));
        const x1 = Math.min(doc.w, Math.ceil(Math.max(...boxes.map(b => b.x + b.width)) + pad));
        const y1 = Math.min(doc.h, Math.ceil(Math.max(...boxes.map(b => b.y + b.height)) + pad));
        const even = n => Math.floor(n * this.scale / 2) * 2 / this.scale;
        return rect(x0, y0, even(x1 - x0), even(y1 - y0));
    }

    /** Saves the frame as a lossless WebP, without the cursor and what it hovers. */
    async shot(frame, out) {
        await this.page.mouse.move(0, 0);
        await this.page.evaluate(() => window.__slidesHideCursor());
        const png = await this.page.screenshot({ clip: frame, animations: 'disabled', caret: 'hide' });
        // The same pixels as the PNG in a third to a quarter of its size.
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'png_pipe', '-i', 'pipe:0',
            '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', out], { input: png, stdio: ['pipe', 'inherit', 'inherit'] });
    }

    /**
     * Records the frame while `play` runs and saves it as a VP9 video at 30
     * frames a second. The screencast sends a frame only when the page changes,
     * so each one lasts until the next.
     *
     * The window shows the frame, widened to the window's proportions, over its
     * whole size, as Emulation.setDeviceMetricsOverride does with `viewport`:
     * Chrome draws that area anew at the scale, so a small frame comes out
     * sharp and larger. The page does not see it: the mouse and the boxes of
     * elements stay in the page's pixels. `camera` moves the shown area.
     */
    async record(frame, out, play) {
        const dir = join(this.takes, `${Date.now()}`);
        mkdirSync(dir, { recursive: true });
        const cdp = this.cdp = await this.page.context().newCDPSession(this.page);
        const frames = this.frames = [];
        // Seconds the video is ahead of the wall clock after camera moves (see camera).
        this.shift = 0;
        let width = 0;
        cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
            const f = { data: Buffer.from(data, 'base64'), t: metadata.timestamp + this.shift };
            if (this.onFrame) this.onFrame(f);
            else frames.push(f);
            width = metadata.deviceWidth;
            cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => { });
        });
        await this.page.evaluate(f => { window.__slidesFrame = f; }, frame);
        this.frame = frame;
        const view = this.page.viewportSize();
        this.home = this.#keepInPage(this.#widen(frame, view.width / view.height));
        await this.#show(this.home);
        // The cursor starts where the scenario puts it, not where the setup clicked.
        await this.page.mouse.move(this.pos.x, this.pos.y);
        // The screencast comes in CSS pixels whatever the device pixel ratio.
        await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95 });
        try {
            await play();
        } finally {
            // The screencast stamps frames with the wall clock in seconds.
            this.end = Date.now() / 1000 + this.shift;
            await cdp.send('Page.stopScreencast');
            await this.#show(null);
            await cdp.detach();
            this.cdp = null;
        }
        const end = this.end;
        if (!frames.length) throw new Error(`No frames for ${out}`);

        // An image comes in with the time base of 25 frames a second, which rounds the
        // durations to 40 ms: a millisecond one keeps them.
        const entry = i => [`file f${String(i).padStart(5, '0')}.jpg`, 'option framerate 1000'];
        const list = ['ffconcat version 1.0'];
        frames.forEach((f, i) => {
            writeFileSync(join(dir, `f${String(i).padStart(5, '0')}.jpg`), f.data);
            const next = frames[i + 1]?.t ?? end;
            list.push(...entry(i), `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
        });
        // The concat demuxer drops the duration of the last entry without a file after it.
        list.push(...entry(frames.length - 1));
        writeFileSync(join(dir, 'frames.txt'), list.join('\n') + '\n');

        // Pixels of the frames as they came per CSS pixel of the page in the shown area.
        const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width',
            '-of', 'csv=p=0', join(dir, 'f00000.jpg')], { encoding: 'utf8' });
        const s = Number(probe.trim()) / width * view.width / this.home.width;
        const px = n => Math.round(n * s), even = n => Math.floor(px(n) / 2) * 2;
        const crop = `crop=${even(frame.width)}:${even(frame.height)}:${px(frame.x - this.home.x)}:${px(frame.y - this.home.y)}`;
        // The screen content tools and a keyframe every 10 s suit an interface that
        // mostly stands still; crf 40 keeps its text readable.
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt'),
            '-vf', `${crop},fps=30`, '-c:v', 'libvpx-vp9', '-crf', '40', '-b:v', '0', '-tune-content', 'screen', '-g', '300',
            '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', '-an', out], { stdio: 'inherit' });
        rmSync(dir, { recursive: true, force: true });

        // While the page moves frames come back to back; a longer gap is the page at rest.
        const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t).filter(g => g < .1).sort((a, b) => a - b);
        const fps = gaps.length ? 1 / gaps[gaps.length >> 1] : 0;
        return { frames: frames.length, seconds: end - frames[0].t, fps, scale: s };
    }

    /**
     * Moves the camera of `record` so that `target`, a rectangle of the page or
     * a locator, fills the frame: widened to the frame's proportions around its
     * centre. `null` goes back to the frame.
     *
     * The screencast comes with gaps of a few frames, and a step of the move
     * over CDP takes as long as Chrome needs to draw it anew, so the move is not
     * filmed as it goes: each step waits for its picture, which gets its place
     * in the video at 30 frames a second. Nothing else should move meanwhile.
     */
    async camera(target, { duration = 500 } = {}) {
        if (!this.cdp) throw new Error('camera() works only while recording');
        let to = this.home;
        if (target) {
            const box = 'boundingBox' in target ? await target.boundingBox() : target;
            const t = this.#widen(box, this.frame.width / this.frame.height);
            // The shown area is around the target as the first one is around the frame.
            const r = t.width / this.frame.width;
            to = this.#keepInPage(rect(t.x - (this.frame.x - this.home.x) * r, t.y - (this.frame.y - this.home.y) * r,
                this.home.width * r, this.home.height * r));
        }
        const from = this.shown;
        const fps = 30, steps = Math.max(1, Math.round(duration / 1000 * fps));
        const start = Date.now() / 1000 + this.shift;
        let latest = this.frames.at(-1), fresh = null;
        this.onFrame = f => { fresh = f; };
        try {
            for (let i = 1; i <= steps; i++) {
                const k = minimumJerk(i / steps);
                fresh = null;
                await this.#show(rect(...['x', 'y', 'width', 'height'].map(key => from[key] + (to[key] - from[key]) * k)));
                // The first picture after the change can still be on its way: the last one
                // of a short quiet spell is the step drawn.
                for (let waited = 0; !fresh && waited < 300; waited += 5) await sleep(5);
                if (fresh) await sleep(40);
                latest = fresh ?? latest;
                this.frames.push({ data: latest.data, t: start + i / fps });
            }
        } finally {
            this.onFrame = null;
        }
        this.shift = start + (steps + 1) / fps - Date.now() / 1000;
        // Tooltips now keep inside the part of the page that the frame shows.
        const r = to.width / this.home.width;
        const seen = rect(to.x + (this.frame.x - this.home.x) * r, to.y + (this.frame.y - this.home.y) * r,
            this.frame.width * r, this.frame.height * r);
        await this.page.evaluate(f => { window.__slidesFrame = f; }, seen);
    }

    /** Widens the rectangle around its centre to width / height = `aspect`. */
    #widen(r, aspect) {
        const width = Math.max(r.width, r.height * aspect), height = width / aspect;
        return rect(r.x + (r.width - width) / 2, r.y + (r.height - height) / 2, width, height);
    }

    /** Shifts the rectangle into the window, shrinking it if it is larger. */
    #keepInPage(r) {
        const view = this.page.viewportSize();
        const k = Math.min(1, view.width / r.width, view.height / r.height);
        const width = r.width * k, height = r.height * k;
        return rect(Math.min(Math.max(0, r.x), view.width - width), Math.min(Math.max(0, r.y), view.height - height), width, height);
    }

    /** Shows `area` of the page over the whole window; null shows the window as it is. */
    async #show(area) {
        const view = this.page.viewportSize();
        await this.cdp.send('Emulation.setDeviceMetricsOverride', {
            width: view.width, height: view.height, deviceScaleFactor: this.scale, mobile: false,
            ...(area && { viewport: { ...area, scale: view.width / area.width } }),
        });
        this.shown = area;
    }
}
