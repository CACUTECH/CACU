"""CACU brag soundtrack: 120 BPM, Am-F-C-G, SFX tuned to the same chords and beat grid. Stdlib only."""
import math, random, struct, sys, wave
from array import array

SR, DUR, BPM = 44100, 20.0, 120
BEAT = 60 / BPM
N = int(SR * DUR)
random.seed(7)

def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)

# one chord per 2 s bar; ends resolved on C
CHORDS = [('Am', [57, 60, 64], 45), ('F', [53, 57, 60], 41), ('C', [55, 60, 64], 48), ('G', [55, 59, 62], 43)] * 2 + \
         [('F', [53, 57, 60], 41), ('C', [55, 60, 64], 48)]
def chord_at(t): return CHORDS[min(int(t // 2), len(CHORDS) - 1)]

dry = array('d', bytes(8 * N))   # direct mix
send = array('d', bytes(8 * N))  # reverb send
duck = array('d', [1.0]) * N     # sidechain gain for pad/bass

def add(buf, start, samples, gain):
    i0 = int(start * SR)
    for k, v in enumerate(samples):
        i = i0 + k
        if 0 <= i < N: buf[i] += v * gain

def env_len(sec): return int(sec * SR)

# ---------- instruments ----------
def kick(boom=1.0):
    n = env_len(0.45 * boom); out = []; ph = 0.0
    for k in range(n):
        t = k / SR
        f = 45 * boom ** -0.3 + 110 * math.exp(-t / 0.03)
        ph += 2 * math.pi * f / SR
        out.append(math.sin(ph) * math.exp(-t / (0.16 * boom)) + (0.25 * math.exp(-t / 0.004) if k < 200 else 0))
    return out

def noise_burst(sec, decay, hp=0.0, lp=1.0):
    n = env_len(sec); out = []; l1 = l2 = 0.0
    for k in range(n):
        x = random.uniform(-1, 1)
        l1 += lp * (x - l1)            # low-pass
        l2 += hp * (l1 - l2)           # tracks lows; subtract for high-pass
        out.append((l1 - l2) * math.exp(-k / SR / decay))
    return out

def clap():
    a = noise_burst(0.2, 0.06, hp=0.15, lp=0.28)
    for k in range(min(len(a), env_len(0.02))):  # triple-hit attack
        a[k] *= 1.0 + 0.6 * math.sin(k / SR * 2 * math.pi * 120)
    return a

def hat(open_=False): return noise_burst(0.12 if open_ else 0.05, 0.05 if open_ else 0.012, hp=0.6, lp=0.95)

def pluck(m, sec=0.5, bright=1.0):
    f = mtof(m); n = env_len(sec); out = []
    for k in range(n):
        t = k / SR; e = math.exp(-t / (0.12 + 0.1 * bright)) * min(1, k / 60)
        out.append(e * (math.sin(2 * math.pi * f * t) + 0.35 * bright * math.sin(4 * math.pi * f * t) * math.exp(-t / 0.05)
                        + 0.12 * math.sin(6 * math.pi * f * t) * math.exp(-t / 0.03)))
    return out

def blip(m, sec=0.18):  # soft UI click in key
    f = mtof(m); n = env_len(sec)
    return [math.sin(2 * math.pi * f * k / SR) * math.exp(-k / SR / 0.035) * min(1, k / 30) for k in range(n)]

def whoosh(sec, rising=True):
    n = env_len(sec); out = []; l = 0.0
    for k in range(n):
        p = k / n; p = p if rising else 1 - p
        a = 0.02 + 0.25 * p * p
        l += a * (random.uniform(-1, 1) - l)
        out.append(l * math.sin(math.pi * (k / n)) ** 1.5)
    return out

# ---------- arrangement ----------
# Hook 0â€“3: card pops climb the Am arpeggio, riser into the 3.0 impact
for i, m in enumerate([69, 72, 76, 81]):
    add(dry, 0.5 * i, pluck(m, 0.6, 1.2), 0.26); add(send, 0.5 * i, pluck(m, 0.6), 0.2)
riser = []
for k in range(env_len(1.0)):
    t = k / SR; p = t / 1.0
    riser.append(math.sin(2 * math.pi * (220 * t + 330 * t * t)) * p ** 2 * 0.5)
add(dry, 2.0, riser, 0.06); add(send, 2.0, riser, 0.08)
add(dry, 2.0, whoosh(1.0, True), 0.2); add(send, 2.0, whoosh(1.0), 0.2)
add(dry, 3.0, kick(2.2), 0.75); add(send, 3.0, noise_burst(1.2, 0.35, hp=0.02, lp=0.25), 0.25)
add(dry, 17.5, kick(1.8), 0.5); add(send, 17.5, noise_burst(1.0, 0.3, hp=0.02, lp=0.25), 0.18)

# Groove 3â€“19
t = 3.0
while t < 19.0 - 1e-6:
    b = round(t / BEAT) % 4
    add(dry, t, kick(), 0.6)
    for k in range(env_len(0.3)):  # sidechain duck
        i = int(t * SR) + k
        if i < N: duck[i] = min(duck[i], 1 - 0.65 * math.exp(-k / SR / 0.09))
    if b in (1, 3):
        c = clap(); add(dry, t, c, 0.16); add(send, t, c, 0.14)
    add(dry, t + BEAT / 2, hat(open_=(t >= 13 and b == 3)), 0.1)
    if t >= 13.0:  # 16th hats lift the dashboard section
        add(dry, t + BEAT / 4, hat(), 0.05); add(dry, t + 3 * BEAT / 4, hat(), 0.05)
    t += BEAT

# Bass: eighth-note octave pump, ducked
bass = array('d', bytes(8 * N))
for step in range(int(3.0 / (BEAT / 2)), int(19.0 / (BEAT / 2))):
    t = step * BEAT / 2; root = chord_at(t)[2] - 12 + (12 if step % 2 else 0)
    f = mtof(root); n = env_len(BEAT / 2)
    for k in range(n):
        i = int(t * SR) + k
        if i < N:
            tt = k / SR; e = min(1, k / 80) * math.exp(-tt / 0.18)
            bass[i] += e * (math.sin(2 * math.pi * f * tt) + 0.3 * math.sin(4 * math.pi * f * tt) + 0.1 * math.sin(6 * math.pi * f * tt))

# Pad: detuned saw-ish chords through a one-pole LP; quiet under the hook, full from 3.0, rings out at the end
pad = array('d', bytes(8 * N)); lp = 0.0
phases = [0.0] * 6
for i in range(N):
    t = i / SR; name, notes, _ = chord_at(t)
    lvl = (0.35 if t < 3 else 1.0) * min(1, t / 0.4)
    x = 0.0
    for v, m in enumerate(notes):
        for d, det in enumerate((-0.07, 0.07)):
            j = v * 2 + d
            phases[j] = (phases[j] + mtof(m + det) / SR) % 1.0
            x += (2 * phases[j] - 1) * (0.6 if d else 0.4)
    cutoff = 0.035 + (0.05 if t >= 3 else 0.0) + 0.02 * math.sin(t * 0.8)
    lp += cutoff * (x - lp)
    pad[i] = lp * lvl
for i in range(N):
    d = duck[i]
    dry[i] += pad[i] * 0.1 * d + bass[i] * 0.3 * d
    send[i] += pad[i] * 0.06 * d

# Arp plucks (eighths) through setup/POS/dashboard, sitting low
for step in range(int(6.0 / (BEAT / 2)), int(16.5 / (BEAT / 2))):
    t = step * BEAT / 2; notes = chord_at(t)[1]
    m = notes[[0, 1, 2, 1][step % 4]] + 12
    p = pluck(m, 0.35, 0.6); add(dry, t, p, 0.09); add(send, t, p, 0.07)

# Outro shimmer on the chip burst, final chord pluck stack
for i, m in enumerate([72, 76, 79, 84]):
    add(dry, 16.5 + 0.06 * i, pluck(m, 0.7, 1.0), 0.09); add(send, 16.5 + 0.06 * i, pluck(m, 0.7), 0.12)
for m in [60, 64, 67, 72]:
    add(dry, 19.0, pluck(m, 1.0, 0.8), 0.1); add(send, 19.0, pluck(m, 1.0), 0.16)

# ---------- SFX in key, on the grid ----------
def sfx_click(t):
    m = chord_at(t)[1][-1] + 24
    add(dry, t, blip(m), 0.09); add(send, t, blip(m), 0.05)
    add(dry, t, noise_burst(0.02, 0.004, hp=0.5, lp=0.9), 0.05)
for t in [7.5, 9.5, 10.0, 10.5, 11.0]: sfx_click(t)
for k in range(17):  # typing "Lekki Corner Mart" between 6.35 and 7.0
    add(dry, 6.35 + k * 0.65 / 17, noise_burst(0.015, 0.003, hp=0.55, lp=0.9), 0.022)
for i, m in enumerate([77, 81, 84]):  # "Sale Recorded" chime over F
    add(dry, 11.5 + 0.08 * i, blip(m, 0.5), 0.08); add(send, 11.5 + 0.08 * i, blip(m, 0.5), 0.1)
for i, m in enumerate([72, 76, 79, 84]):  # stat cards over C
    add(dry, 13.0 + 0.25 * i, blip(m, 0.25), 0.05); add(send, 13.0 + 0.25 * i, blip(m, 0.25), 0.05)
for cut in [6.0, 9.0, 13.0, 16.5]:
    w = whoosh(0.4, True); add(dry, cut - 0.35, w, 0.18); add(send, cut - 0.35, w, 0.15)

# ---------- reverb (Schroeder), stereo by different comb lengths ----------
def reverb(x, combs, aps):
    out = array('d', bytes(8 * N))
    for L, g in combs:
        buf = [0.0] * L; idx = 0; lp = 0.0
        for i in range(N):
            y = buf[idx]; lp += 0.4 * (y - lp); buf[idx] = x[i] + lp * g; idx = (idx + 1) % L; out[i] += y
    for L in aps:
        buf = [0.0] * L; idx = 0
        for i in range(N):
            b = buf[idx]; v = out[i] + 0.5 * b; buf[idx] = v; out[i] = b - 0.5 * v; idx = (idx + 1) % L
    return out

revL = reverb(send, [(1557, .84), (1617, .84), (1491, .84), (1422, .84)], [225, 556])
revR = reverb(send, [(1277, .84), (1356, .84), (1188, .84), (1116, .84)], [341, 441])

# ---------- master ----------
L = [0.0] * N; R = [0.0] * N; peak = 0.0
for i in range(N):
    t = i / SR; fade = min(1.0, (DUR - t) / 0.45)
    l = math.tanh(1.1 * (dry[i] + 0.11 * revL[i])) * fade
    r = math.tanh(1.1 * (dry[i] + 0.11 * revR[i])) * fade
    L[i], R[i] = l, r; peak = max(peak, abs(l), abs(r))
g = 0.89 / peak
pcm = array('h', [0]) * (2 * N)
for i in range(N):
    pcm[2 * i] = int(L[i] * g * 32767); pcm[2 * i + 1] = int(R[i] * g * 32767)
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('peak', round(peak, 3), 'written', sys.argv[1])
