"""Soundtrack for the CACU brag video: 120 BPM, C major (C-Am-F-G), effects in key and on the beat grid."""
import math, random, wave, array

SR, DUR, BEAT = 44100, 25.0, 0.5
N = int(SR * DUR)
TAU = 2 * math.pi
random.seed(7)
music = [[0.0] * N, [0.0] * N]
fx = [[0.0] * N, [0.0] * N]          # effects bus, gets a tempo-synced echo


def add(bus, start, samples, gain, pan=0.0):
    i0 = int(start * SR)
    gl, gr = gain * math.cos((pan + 1) * math.pi / 4), gain * math.sin((pan + 1) * math.pi / 4)
    L, R = bus
    for k, s in enumerate(samples):
        i = i0 + k
        if 0 <= i < N:
            L[i] += s * gl; R[i] += s * gr


def env(t, a, d):
    return (t / a if t < a else 1.0) * math.exp(-d * t)


def kick(length=0.35):
    out, ph = [], 0.0
    for k in range(int(length * SR)):
        t = k / SR
        ph += TAU * (45 + 85 * math.exp(-t * 28)) / SR
        out.append(math.sin(ph) * env(t, 0.002, 8.5))
    return out


def noise(length, decay, hp=True):
    out, prev = [], 0.0
    for k in range(int(length * SR)):
        x = random.uniform(-1, 1)
        y = x - prev if hp else x
        prev = x
        out.append(y * env(k / SR, 0.001, decay))
    return out


def snare():
    n = noise(0.22, 20)
    return [0.55 * s + 0.45 * math.sin(TAU * 190 * k / SR) * math.exp(-k / SR * 28) for k, s in enumerate(n)]


def tone(freq, length, decay, partials=((1, 1.0),), attack=0.003):
    return [env(k / SR, attack, decay) * sum(a * math.sin(TAU * freq * m * k / SR) for m, a in partials)
            for k in range(int(length * SR))]


def whoosh(length=0.6):
    out, lp = [], 0.0
    n = int(length * SR)
    for k in range(n):
        x = k / n
        coef = 0.01 + 0.25 * x * x                       # filter opens towards the cut
        lp += coef * (random.uniform(-1, 1) - lp)
        out.append(lp * (x ** 2.2))
    for k in range(int(0.08 * SR)):                       # quick tail after the cut
        lp += 0.2 * (random.uniform(-1, 1) - lp)
        out.append(lp * math.exp(-k / SR * 40))
    return out


CHORDS = {'C': [261.63, 329.63, 392.00], 'Am': [220.00, 261.63, 329.63], 'F': [174.61, 220.00, 261.63], 'G': [196.00, 246.94, 293.66]}
ROOTS = {'C': 65.41, 'Am': 55.00, 'F': 43.65, 'G': 49.00}
BARS = ['C', 'Am', 'F', 'G'] * 3 + ['C', 'C']   # 2 s bars; the outro resolves to C


# Pad: soft detuned triads, one per bar, overlapping slightly.
for b in range(13):
    start = b * 2.0
    length = 2.4 if b < 12 else 1.0
    for f in CHORDS[BARS[b]]:
        for det, pan in ((1.0, -0.5), (1.004, 0.5)):
            s = [math.sin(TAU * f * det * k / SR) * min(1, (k / SR) / 0.25) * min(1, (length - k / SR) / 0.35)
                 for k in range(int(length * SR))]
            add(music, start, s, 0.032 if start >= 6 else 0.026, pan)

# Drums: muted pulse in the hook, full groove from the reveal (3.0 s) to 19.5 s.
K, S, H = kick(), snare(), noise(0.06, 70)
for i in range(int(DUR / BEAT)):
    t = i * BEAT
    if t < 6.5:
        if i % 2 == 0: add(music, t, K, 0.28)
    elif t <= 23.5:
        add(music, t, K, 0.5)
        if i % 2 == 1: add(music, t, S, 0.13, 0.1)
        if t + 0.25 < 23.75: add(music, t + 0.25, H, 0.06, 0.35)

# Bass: eighth notes on the bar root from the reveal.
for b in range(3, 12):
    root = ROOTS[BARS[b]]
    for e in range(8):
        t = b * 2.0 + e * 0.25
        if t < 6.5 or t >= 23.75: continue
        f = root * (2 if e in (3, 6) else 1)
        add(music, t, tone(f, 0.24, 9, ((1, 1), (2, .5), (3, .3), (4, .15)), 0.005), 0.11)
add(music, 24.0, tone(65.41, 1.0, 2.5, ((1, 1), (2, .4)), 0.01), 0.12)          # final low C

# Effects, all in key and on the grid.
for end in (3.5, 6.5, 10.0, 14.0, 17.0, 20.0, 22.5):
    add(fx, end - 0.6, whoosh(), 0.15, 0.0)
marimba = lambda f: tone(f, 0.5, 13, ((1, 1), (4, .22)))
for t, f in ((4.0, 783.99), (4.5, 659.25), (5.0, 523.25)):                             # the three numbers, falling
    add(fx, t, marimba(f), 0.14, 0.1)
for f in (1046.50, 1567.98):                                                           # logo reveal
    add(fx, 6.6, tone(f, 2.0, 1.8, ((1, 1), (2.76, .12))), 0.045)
pluck = lambda f: tone(f, 0.6, 7, ((1, 1), (2, .25)))
for t, f, pan in ((10.75, 659.25, -0.2), (11.25, 783.99, 0.2), (12.0, 880.00, -0.2), (12.5, 659.25, 0.2)):
    add(fx, t, pluck(f), 0.13, pan)
for i, f in enumerate((1046.50, 1318.51, 1567.98, 2093.00)):                         # "Sale Recorded"
    add(fx, 13.0 + i * 0.125, tone(f, 1.2, 3.2, ((1, 1), (3, .08))), 0.075, -0.3 + i * 0.2)
pop = lambda f: [math.sin(TAU * f * (0.85 + 0.15 * min(1, k / (0.02 * SR))) * k / SR) * math.exp(-k / SR * 18) for k in range(int(0.3 * SR))]
add(fx, 14.7, marimba(698.46), 0.12)                                                   # payment row
add(fx, 15.2, pop(523.25), 0.13)                                                       # still owes
add(fx, 17.2, marimba(880.00), 0.12)                                                   # question card
for i, f in enumerate((783.99, 987.77, 1174.66)):                                      # profit card
    add(fx, 18.2 + i * 0.125, tone(f, 1.0, 3.5, ((1, 1), (3, .08))), 0.06)
add(fx, 18.8, pop(1046.50), 0.12)                                                      # PDF
add(fx, 20.0, marimba(523.25), 0.10)                                                   # homework page
for f in (1046.50, 1567.98):                                                           # outro bell
    add(fx, 22.5, tone(f, 2.5, 1.6, ((1, 1), (2.76, .12))), 0.05)
add(music, 22.5, kick(0.5), 0.3)

# Echo on the effects bus: dotted eighth (0.375 s), so the repeats stay on the grid.
D = int(0.375 * SR)
for ch in (0, 1):
    b = fx[ch]
    for i in range(D, N):
        b[i] += 0.28 * b[i - D]

# Mix, soft clip, fade, normalise.
out = []
for i in range(N):
    t = i / SR
    fade = min(1, t / 0.01) * (1 if t < 24.3 else max(0, (DUR - t) / 0.7))
    out.append([math.tanh(1.3 * (music[c][i] + 0.8 * fx[c][i])) * fade for c in (0, 1)])
peak = max(abs(v) for pair in out for v in pair) or 1
scale = 0.89 / peak * 32767
data = array.array('h', (int(v * scale) for pair in out for v in pair))
with wave.open('music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
print('wrote music.wav', round(peak, 3))
