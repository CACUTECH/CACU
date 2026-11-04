"""Generate the CACU brag composition: index.html + one scene per compositions/sNN.html.
Narration is the clock: each scene's slot = lead + its Kokoro line + tail, and reveals land on the words that name them."""
import json, subprocess, os, html
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'composition'
FPS = 30
LINES = dict(json.load(open(Path(__file__).with_name('vo-lines.json'), encoding='utf-8')))
def dur(sid):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0',
                                 str(ROOT / 'assets/vo' / f'{sid}.wav')], capture_output=True, text=True).stdout)
def fr(x): return round(x * FPS) / FPS

LEAD = {'s01': 1.5, 's02': 1.3, 's05': 0.6, 's13': 1.2, 's17': 1.6}
TAIL = {'s05': 1.6, 's13': 0.8, 's16': 1.6, 's17': 6.0}

COMMON_CSS = r"""
@font-face{font-family:'CACU Display';src:url('assets/fonts/space-grotesk-latin-variable.woff2') format('woff2');font-weight:300 700}
@font-face{font-family:'CACU Text';src:url('assets/fonts/inter-latin-variable.woff2') format('woff2');font-weight:100 900}
#root{position:absolute;inset:0;overflow:hidden;font-family:'CACU Text',sans-serif;color:#14123a}
#root *{box-sizing:border-box;margin:0;padding:0}
.ground{position:absolute;inset:0}
.light{background:#F7F7F7}.navy{background:#09006C}
.all{position:absolute;inset:0}
.eyebrow{position:absolute;left:150px;top:300px;font-family:'CACU Display';font-weight:700;font-size:26px;letter-spacing:4px;color:#5C40FF}
.eyebrow i{display:inline-block;width:56px;height:4px;border-radius:2px;background:#5C40FF;vertical-align:middle;margin-right:18px}
.title{position:absolute;left:150px;top:350px;width:780px;font-family:'CACU Display';font-weight:700;font-size:88px;line-height:1.04;letter-spacing:-3px;color:#09006C}
.title em{font-style:normal;color:#5C40FF}
.navy .eyebrow,.onnavy .eyebrow{color:#A99BFF}.onnavy .eyebrow i{background:#A99BFF}
.onnavy .title{color:#fff}.onnavy .title em{color:#A99BFF}
.card{position:absolute;background:#fff;border-radius:30px;box-shadow:0 40px 90px -30px rgba(9,0,108,.35),0 0 0 1.5px #ebeaf3;padding:36px 42px}
.ncard{position:absolute;background:#15107f;border-radius:28px;box-shadow:0 0 0 1.5px #2c2696;padding:32px 36px;color:#fff}
.ch{display:flex;justify-content:space-between;align-items:center;gap:20px}
.ct{font-family:'CACU Display';font-weight:700;font-size:30px;color:#09006C}
.cs{font-size:20px;color:#5d5b7a;margin-top:8px}
.pill{font-size:18px;font-weight:600;color:#5C40FF;background:#efecff;padding:9px 16px;border-radius:999px;white-space:nowrap}
.pill.ok{color:#0b7a4b;background:#dcf7ea}.pill.wait{color:#8a5a00;background:#fff1cc}
.row{display:flex;justify-content:space-between;align-items:center;height:70px;border-bottom:1.5px solid #f0eff6;font-size:23px;color:#1a1840}
.row:last-child{border-bottom:none}
.amt{font-family:'CACU Display';font-weight:600;font-variant-numeric:tabular-nums}
.btn{display:flex;align-items:center;justify-content:center;height:64px;border-radius:16px;background:#5C40FF;color:#fff;font-weight:700;font-size:22px}
.chip{display:inline-flex;align-items:center;height:56px;padding:0 24px;border-radius:999px;background:#fff;box-shadow:0 0 0 1.5px #e4e3ef;font-weight:600;font-size:22px;color:#09006C}
.check{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:#2fd18a;flex:none}
.sub{position:absolute;left:150px;width:760px;font-size:30px;line-height:1.4;color:#5d5b7a}
"""
CHECK = '<span class="check"><svg width="26" height="26" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'

def head(n, label, title, navy=False):
    return (f'<div class="eyebrow" id="§-eb"><i></i>{label}</div>'
            f'<div class="title" id="§-tt">{title}</div>')

S = {}  # sid -> dict(ground, html, css, js, sfx[(t,file,vol)])

S['s01'] = dict(ground='navy', css=r"""
#§-ruled{position:absolute;left:0;right:0;top:-80px;height:1400px;background:repeating-linear-gradient(to bottom,transparent 0 79px,rgba(169,155,255,.16) 79px 81px)}
#§-margin{position:absolute;top:0;bottom:0;left:110px;width:3px;background:rgba(169,155,255,.25)}
.§-h{position:absolute;left:170px;font-family:'CACU Display';font-weight:700;font-size:104px;letter-spacing:-3px;line-height:1}
#§-h1{top:250px;color:#fff}#§-h2{top:380px;color:#A99BFF}
.§-w{display:inline-block;margin-right:28px}
.§-scrap{position:absolute;width:430px;border-radius:22px;padding:28px 30px}
#§-nb{left:170px;top:600px;background:#fffbea;color:#3b3220;transform-origin:center;font-size:26px;line-height:1.6;box-shadow:0 30px 60px -20px rgba(0,0,0,.5)}
#§-nb b{display:block;font-family:'CACU Display';font-size:20px;letter-spacing:2px;color:#9a8a5a;margin-bottom:6px}
#§-al{left:700px;top:640px;background:#fff;color:#14123a;font-size:24px;line-height:1.45;box-shadow:0 30px 60px -20px rgba(0,0,0,.5)}
#§-al b{display:block;font-size:19px;color:#5d5b7a;margin-bottom:6px}
#§-wa{left:1230px;top:600px;background:#dcf8c6;color:#14243a;font-size:25px;line-height:1.45;box-shadow:0 30px 60px -20px rgba(0,0,0,.5)}
#§-wa b{display:block;font-size:19px;color:#3d6b3a;margin-bottom:6px}
#§-iris{position:absolute;left:960px;top:540px;width:2400px;height:2400px;margin:-1200px 0 0 -1200px;border-radius:50%;background:#F7F7F7}
""", html=r"""
<div id="§-ruled"></div><div id="§-margin"></div>
<div class="all" id="§-all" data-hold>
<div class="§-h" id="§-h1"><span class="§-w">You</span><span class="§-w">sell</span><span class="§-w">all</span><span class="§-w">day.</span></div>
<div class="§-h" id="§-h2"><span class="§-w">Who</span><span class="§-w">keeps</span><span class="§-w">the</span><span class="§-w">books?</span></div>
<div class="§-scrap" id="§-nb"><b>NOTEBOOK · TUESDAY</b>Milk, tin × 2 — 1,300<br>Garri 1kg — 1,800<br><s>Noodles carton</s> owes 5k??</div>
<div class="§-scrap" id="§-al"><b>BANK ALERT</b>Credit: NGN 18,400.00<br>Desc: TRF FROM CUSTOMER<br>Avail bal: NGN 61,250.00</div>
<div class="§-scrap" id="§-wa"><b>WHATSAPP · Customer</b>Please send 2 cartons today<br>I'll pay on Friday</div>
</div>
<div id="§-iris"></div>
""", js=r"""
tl.fromTo('#§-ruled',{y:0},{y:-60,duration:END,ease:'none'},0);
tl.fromTo('#§-h1 .§-w',{opacity:0,filter:'blur(6px)'},{opacity:1,filter:'blur(0px)',duration:.13,stagger:.067,ease:'power2.out'},0.15);
tl.fromTo('#§-h2 .§-w',{opacity:0,filter:'blur(6px)'},{opacity:1,filter:'blur(0px)',duration:.13,stagger:.067,ease:'power2.out'},0.75);
IN('#§-nb',@@And most@@,{y:60,rot:-4});IN('#§-al',@@And most@@+0.6,{y:60,rot:3});IN('#§-wa',@@And most@@+1.2,{y:60,rot:-2});
tl.fromTo('#§-iris',{scale:0},{scale:1,duration:.5,ease:'power3.in',immediateRender:true},END-0.5);
""", sfx=[('@@And most@@', 'card-slide-1', .35), ('@@And most@@+0.6', 'card-slide-1', .3), ('@@And most@@+1.2', 'card-slide-1', .3)], noexit=True)

S['s02'] = dict(ground='light', css=r"""
.§-wm{position:absolute;left:460px;top:300px;width:1000px}
#§-tag{position:absolute;left:0;right:0;top:600px;text-align:center;font-family:'CACU Display';font-weight:600;font-size:58px;color:#09006C;letter-spacing:-1.5px}
#§-tag b{color:#5C40FF}
#§-chips{position:absolute;left:0;right:0;top:730px;display:flex;justify-content:center;gap:22px}
""", html=r"""
<div class="all" id="§-all" data-hold>
<img class="§-wm" id="§-dome" src="assets/img/logo-wordmark.jpg"><img class="§-wm" id="§-bowl" src="assets/img/logo-wordmark.jpg"><img class="§-wm" id="§-txt" src="assets/img/logo-wordmark.jpg">
<div id="§-tag"><b>Sell.</b> CACU keeps the books.</div>
<div id="§-chips"><span class="chip" id="§-c1">Sell</span><span class="chip" id="§-c2">Stock</span><span class="chip" id="§-c3">Team</span><span class="chip" id="§-c4">Books</span></div>
</div>""", js=r"""
// beat-locked: scene start = 10.02 s on the Vol. 1 beat grid
tl.set('#§-dome',{clipPath:'inset(0 76% 64% 0)'},0);tl.set('#§-bowl',{clipPath:'inset(44% 76% 0 0)'},0);
tl.fromTo('#§-dome',{y:-240,opacity:0},{y:0,opacity:1,duration:.7,ease:'back.out(1.4)'},0.05);
tl.fromTo('#§-bowl',{y:240,opacity:0},{y:0,opacity:1,duration:.7,ease:'back.out(1.4)'},0.2);
tl.fromTo('#§-txt',{clipPath:'inset(0 73% 0 27%)'},{clipPath:'inset(0 0% 0 27%)',duration:.5,ease:'power3.inOut'},0.6);
IN('#§-tag',1.1);
IN('#§-c1',@@to sell@@);IN('#§-c2',@@track your stock@@);IN('#§-c3',@@run your team@@);IN('#§-c4',@@keep real books@@);
""", sfx=[(0.05, 'impactBell_heavy_000', .45)])

S['s03'] = dict(ground='light', css=r"""
#§-card{left:1000px;top:200px;width:780px}
.§-lab{font-size:19px;font-weight:600;letter-spacing:1.5px;color:#9b99b5;text-transform:uppercase;margin-top:26px}
.§-in{margin-top:12px;height:66px;border:2px solid #e4e3ef;border-radius:16px;display:flex;align-items:center;padding:0 22px;font-size:26px;color:#14123a}
.§-ch{display:inline-block;opacity:0}
#§-cur{display:inline-block;width:3px;height:30px;background:#5C40FF;margin-left:2px}
.§-opts{display:flex;gap:16px;margin-top:14px}
.§-opt{flex:1;height:120px;border-radius:18px;border:2px solid #e4e3ef;display:flex;flex-direction:column;justify-content:center;padding:0 22px;font-size:24px;font-weight:700;color:#09006C}
.§-opt span{font-size:17px;font-weight:500;color:#8a89a3;margin-top:6px}
#§-p1sel{position:absolute;inset:0;border-radius:18px;border:3px solid #5C40FF;background:rgba(92,64,255,.06)}
""", html=r"""
<div class="all" id="§-all" data-hold>""" + head(0, 'LIVE TODAY · SET UP', 'Set up in<br><em>minutes.</em>') + r"""
<div class="card" id="§-card"><div class="ct">Business setup</div>
<div class="§-lab">Business name</div><div class="§-in" id="§-name">""" + ''.join(f'<span class="§-ch">{html.escape(c) if c != " " else "&nbsp;"}</span>' for c in 'Ada Provisions') + r"""<span id="§-cur"></span></div>
<div class="§-lab">What do you sell?</div>
<div class="§-opts"><div class="§-opt" id="§-o1" style="position:relative"><div id="§-p1sel"></div>Products<span>Stock you count</span></div><div class="§-opt" id="§-o2">Services<span>Time and skill</span></div><div class="§-opt" id="§-o3">Both<span>Products and services</span></div></div>
</div></div>""", js=r"""
IN('#§-eb',0.1);IN('#§-tt',0.2);IN('#§-card',0.35,{y:40});
tl.fromTo('#§-name .§-ch',{opacity:0},{opacity:1,duration:.01,stagger:.07},@@Name your business@@);
IN('#§-o1',@@products@@-0.3,{y:16});IN('#§-o2',@@services@@-0.3,{y:16});IN('#§-o3',@@or both@@-0.2,{y:16});
tl.fromTo('#§-p1sel',{opacity:0,scale:.96},{opacity:1,scale:1,duration:.35,ease:'expo.out'},@@shapes itself@@);
""", sfx=[('@@shapes itself@@', 'click2', .5)])

S['s04'] = dict(ground='light', css=r"""
#§-cat{left:1000px;top:140px;width:780px}
#§-adj{left:1060px;top:600px;width:720px;padding:28px 34px}
.§-it{display:flex;align-items:center;gap:18px;height:84px;border-bottom:1.5px solid #f0eff6}
.§-th{width:52px;height:52px;border-radius:14px;flex:none}
.§-nm{font-weight:600;font-size:23px;color:#14123a}.§-st{font-size:18px;color:#8a89a3;margin-top:3px}
.§-q{margin-left:auto;font-family:'CACU Display';font-weight:700;font-size:26px;color:#09006C}
#§-ok{position:absolute;right:34px;top:30px}
""", html=r"""
<div class="all" id="§-all" data-hold>""" + head(0, 'LIVE TODAY · STOCK', 'Stock you can<br><em>account for.</em>') + r"""
<div class="card" id="§-cat"><div class="ch"><div class="ct">Catalogue</div><span class="pill">3 items</span></div>
<div class="§-it" id="§-i1"><div class="§-th" style="background:linear-gradient(135deg,#fff1c9,#ffd36b)"></div><div><div class="§-nm">Milk, tin</div><div class="§-st">₦650 · Product</div></div><div class="§-q">24</div></div>
<div class="§-it" id="§-i2"><div class="§-th" style="background:linear-gradient(135deg,#ffe0d1,#ff9e6b)"></div><div><div class="§-nm">Noodles, carton</div><div class="§-st">₦9,500 · Product</div></div><div class="§-q">8</div></div>
<div class="§-it" id="§-i3" style="border:none"><div class="§-th" style="background:linear-gradient(135deg,#f3ead9,#d9c08f)"></div><div><div class="§-nm">Garri, 1 kg</div><div class="§-st">₦1,800 · Product</div></div><div class="§-q">31</div></div></div>
<div class="card" id="§-adj"><div class="ct" style="font-size:26px">Stock adjustment · Garri, 1 kg</div>
<div class="cs">−6 units · Reason: damaged in the rain · Requested by Tolu</div>
<span class="pill wait" id="§-wait" style="position:absolute;right:34px;top:30px">Waiting for approval</span>
<span class="pill ok" id="§-ok">Approved by Owner</span></div>
</div>""", js=r"""
IN('#§-eb',0.1);IN('#§-tt',0.2);IN('#§-cat',0.35,{y:40});
IN('#§-i1',@@products and services@@,{y:12});IN('#§-i2',@@products and services@@+0.12,{y:12});IN('#§-i3',@@products and services@@+0.24,{y:12});
IN('#§-adj',@@big adjustments@@,{y:40});
tl.fromTo('#§-wait',{opacity:1},{opacity:0,duration:.2,immediateRender:false},@@owner's approval@@+0.4);
tl.fromTo('#§-ok',{opacity:0,scale:.8},{opacity:1,scale:1,duration:.45,ease:'back.out(1.6)'},@@owner's approval@@+0.45);
""", sfx=[('@@big adjustments@@', 'card-slide-1', .3), ("@@owner's approval@@+0.45", 'bong_001', .5)])

S['s05'] = dict(ground='light', css=r"""
#§-phone{position:absolute;left:1180px;top:70px;width:440px;height:940px;border-radius:64px;background:#0e0c26;padding:14px;box-shadow:0 50px 100px -30px rgba(9,0,108,.45)}
#§-screen{position:relative;width:100%;height:100%;border-radius:52px;background:#fff;overflow:hidden}
.§-sb{display:flex;justify-content:space-between;padding:18px 34px 0;font-size:17px;font-weight:600;color:#111}
.§-ph{padding:26px 28px 0}.§-ph h3{font-family:'CACU Display';font-size:32px;font-weight:700;color:#09006C}.§-ph p{font-size:17px;color:#5d5b7a;margin-top:4px}
.§-search{margin:20px 28px 0;height:54px;border:1.5px solid #e4e4ee;border-radius:14px;display:flex;align-items:center;padding:0 18px;color:#77769a;font-size:17px}
.§-item{margin:14px 28px 0;height:96px;border:1.5px solid #ececf3;border-radius:18px;display:flex;align-items:center;padding:0 18px;gap:14px}
.§-thumb{width:58px;height:58px;border-radius:14px;flex:none}
.§-nm{font-weight:600;font-size:19px;color:#111}.§-st{font-size:15px;color:#77769a;margin-top:3px}.§-st b{color:#09006C}
.§-plus{margin-left:auto;width:44px;height:44px;border-radius:50%;background:#5C40FF;color:#fff;font-size:28px;display:flex;align-items:center;justify-content:center;position:relative}
.§-badge{position:absolute;top:-8px;right:-8px;width:24px;height:24px;border-radius:50%;background:#09006C;color:#fff;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center}
#§-cart{position:absolute;left:0;right:0;bottom:0;height:420px;background:#fff;border-radius:30px 30px 0 0;box-shadow:0 -18px 40px rgba(9,0,108,.12);padding:16px 28px 0}
.§-grab{width:56px;height:6px;border-radius:3px;background:#dddbe9;margin:0 auto 18px}
.§-cl{display:flex;justify-content:space-between;margin-top:14px;font-size:19px;color:#222}
.§-tot{display:flex;justify-content:space-between;margin-top:16px;padding-top:16px;border-top:1.5px dashed #e2e1ec;font-family:'CACU Display';font-weight:700;font-size:28px;color:#09006C}
.§-pay{display:flex;gap:12px;margin-top:18px}
.§-chip{flex:1;height:52px;border-radius:14px;border:1.5px solid #e2e1ec;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:18px;color:#333;position:relative}
#§-cashsel{position:absolute;inset:-1.5px;border-radius:14px;border:2px solid #5C40FF;background:rgba(92,64,255,.08)}
#§-confirm{margin-top:18px;height:62px;border-radius:16px;background:#5C40FF;color:#fff;font-weight:700;font-size:20px;display:flex;align-items:center;justify-content:center}
#§-toast{position:absolute;left:24px;right:24px;top:120px;height:110px;border-radius:22px;background:#09006C;color:#fff;display:flex;align-items:center;gap:18px;padding:0 24px;box-shadow:0 24px 50px rgba(9,0,108,.35)}
#§-toast .a{font-family:'CACU Display';font-weight:700;font-size:26px}#§-toast .b{font-size:17px;color:#cfcaff;margin-top:3px}
#§-finger{position:absolute;left:0;top:0;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:rgba(9,0,108,.22);border:3px solid rgba(255,255,255,.9);box-shadow:0 6px 18px rgba(9,0,108,.3)}
""", html=r"""
<div class="all" id="§-all" data-hold>""" + head(0, 'LIVE TODAY · SELL', 'Ring up<br><em>a sale.</em>') + r"""
<div class="sub" id="§-sb2" style="top:600px">Prices come from your catalogue. Cash or transfer.</div>
<div id="§-phone"><div id="§-screen">
<div class="§-sb"><span>9:41</span><span>●●● 4G</span></div>
<div class="§-ph"><h3>POS Checkout</h3><p>Ada Provisions · Main shop</p></div>
<div class="§-search">⌕&nbsp; Search inventory or scan SKU...</div>
<div class="§-item"><div class="§-thumb" style="background:linear-gradient(135deg,#fff1c9,#ffd36b)"></div><div><div class="§-nm">Milk, tin</div><div class="§-st"><b>₦650</b> · 24 in stock</div></div><div class="§-plus">+<div class="§-badge" id="§-q1">1</div><div class="§-badge" id="§-q2">2</div></div></div>
<div class="§-item"><div class="§-thumb" style="background:linear-gradient(135deg,#ffe0d1,#ff9e6b)"></div><div><div class="§-nm">Noodles, carton</div><div class="§-st"><b>₦9,500</b> · 8 in stock</div></div><div class="§-plus">+</div></div>
<div class="§-item"><div class="§-thumb" style="background:linear-gradient(135deg,#f3ead9,#d9c08f)"></div><div><div class="§-nm">Garri, 1 kg</div><div class="§-st"><b>₦1,800</b> · 31 in stock</div></div><div class="§-plus">+</div></div>
<div id="§-cart"><div class="§-grab"></div><div class="ct" style="font-size:22px">Cart</div>
<div class="§-cl"><span>Milk, tin × 2</span><span>₦1,300</span></div><div class="§-tot"><span>Total</span><span>₦1,300</span></div>
<div class="§-pay"><div class="§-chip"><div id="§-cashsel"></div>Cash</div><div class="§-chip">Transfer</div></div>
<div id="§-confirm">Confirm &amp; Record Sale</div></div>
<div id="§-toast">""" + CHECK.replace('width:44px', 'width:54px') + r"""<div><div class="a">Sale Recorded</div><div class="b">₦1,300 · Cash · Sale #0042</div></div></div>
<div id="§-finger"></div>
</div></div></div>""", js=r"""
IN('#§-eb',0.1);IN('#§-tt',0.2);IN('#§-sb2',@@prices come@@);
tl.fromTo('#§-phone',{y:140,opacity:0},{y:0,opacity:1,duration:.7,ease:'expo.out'},0.25);
const P=@@Ring up@@-0.9; // tap sequence anchored to "Ring up a cash or transfer sale"
tl.fromTo('#§-finger',{x:280,y:560,opacity:0},{x:343,y:265,opacity:1,duration:.4,ease:'power2.inOut'},P-0.45);
tl.fromTo('#§-q1',{opacity:0,scale:0},{opacity:1,scale:1,duration:.2,ease:'back.out(2)'},P);
tl.fromTo('#§-q2',{opacity:0,scale:0},{opacity:1,scale:1,duration:.2,ease:'back.out(2)'},P+0.5);
tl.fromTo('#§-finger',{scale:1},{scale:.82,duration:.06,yoyo:true,repeat:1,immediateRender:false},P);
tl.fromTo('#§-finger',{scale:1},{scale:.82,duration:.06,yoyo:true,repeat:1,immediateRender:false},P+0.5);
tl.fromTo('#§-cart',{y:440},{y:0,duration:.45,ease:'expo.out'},P+0.6);
tl.fromTo('#§-finger',{x:343,y:265},{x:114,y:710,duration:.45,ease:'power2.inOut',immediateRender:false},P+1.0);
tl.fromTo('#§-cashsel',{opacity:0},{opacity:1,duration:.15},P+1.5);
tl.fromTo('#§-finger',{x:114,y:710},{x:206,y:785,duration:.35,ease:'power2.inOut',immediateRender:false},P+1.75);
tl.fromTo('#§-confirm',{scale:1},{scale:.96,duration:.07,yoyo:true,repeat:1,immediateRender:false},@@recorded@@-0.5);
tl.fromTo('#§-finger',{opacity:1},{opacity:0,duration:.25,immediateRender:false},@@recorded@@-0.2);
tl.fromTo('#§-toast',{opacity:0,y:-30,scale:.86},{opacity:1,y:0,scale:1,duration:.5,ease:'back.out(1.5)'},@@recorded@@);
""", sfx=[('@@Ring up@@-0.9', 'click_003', .55), ('@@Ring up@@-0.4', 'click_003', .55), ('@@Ring up@@+0.6', 'click2', .5), ('@@recorded@@-0.5', 'click2', .5), ('@@recorded@@', 'bong_001', .55)])

S['s06'] = dict(ground='light', css=r"""
#§-inv{left:1000px;top:150px;width:780px}
#§-bal{left:1000px;top:690px;width:780px;padding:30px 42px}
.§-big{font-family:'CACU Display';font-weight:700;font-size:64px;color:#09006C;margin-top:6px}
""", html=r"""
<div class="all" id="§-all" data-hold>""" + head(0, 'LIVE TODAY · INVOICES', 'Get paid,<br><em>in parts.</em>') + r"""
<div class="card" id="§-inv"><div class="ch"><div class="ct">Invoice INV-0007</div><span class="pill" id="§-st1">Issued</span></div>
<div class="cs">Customer: Bisi Stores · Due in 14 days</div>
<div style="margin-top:20px"><div class="row"><span>Invoice total</span><span class="amt">₦100,000.00</span></div>
<div class="row" id="§-r1"><span>Receipt · transfer · today</span><span class="amt" style="color:#0b7a4b">−₦40,000.00</span></div></div></div>
<div class="card" id="§-bal"><div class="ch"><div><div class="cs" style="margin:0">Customers owe you</div><div class="§-big" id="§-b">₦60,000</div></div><span class="pill wait">Part paid</span></div></div>
</div>""", js=r"""
IN('#§-eb',0.1);IN('#§-tt',0.2);IN('#§-inv',@@Issue an invoice@@-0.3,{y:40});
IN('#§-r1',@@part payments@@,{y:14});IN('#§-bal',@@who still owes you@@-0.6,{y:30});
""", sfx=[('@@part payments@@', 'card-slide-1', .3), ('@@who still owes you@@-0.6', 'bong_001', .4)])

S['s07'] = dict(ground='light', css=r"""
.§-c{left:1000px;width:780px;padding:28px 36px}
#§-c1{top:150px}#§-c2{top:390px}#§-c3{top:630px}
.§-k{font-size:18px;font-weight:600;letter-spacing:1.5px;color:#9b99b5;text-transform:uppercase}
.§-l{display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:26px;font-weight:600;color:#14123a}
""", html=r"""
<div class="all" id="§-all" data-hold>""" + head(0, 'LIVE TODAY · BILLS &amp; EXPENSES', 'Every naira<br><em>out, too.</em>') + r"""
<div class="card §-c" id="§-c1"><div class="§-k">Supplier bill</div><div class="§-l"><span>Mills Ltd · flour and sugar</span><span class="amt">₦250,000</span></div><div class="cs">Paid ₦150,000 · <b style="color:#8a5a00">₦100,000 still owed</b></div></div>
<div class="card §-c" id="§-c2"><div class="§-k">Expense</div><div class="§-l"><span>Diesel for the generator</span><span class="amt">₦18,000</span></div><div class="cs">Paid in cash · 2 Nov 2026</div></div>
<div class="card §-c" id="§-c3"><div class="ch"><div class="§-k">Reversal</div><span class="pill">Reversed by Owner</span></div><div class="§-l"><span>Diesel expense reversed</span><span class="amt" style="color:#5C40FF">−₦18,000</span></div><div class="cs">Reason: entered twice · original kept in the books</div></div>
</div>""", js=r"""
IN('#§-eb',0.1);IN('#§-tt',0.2);IN('#§-c1',@@Supplier bills@@,{y:30});IN('#§-c2',@@everyday expenses@@,{y:30});IN('#§-c3',@@reverses it@@-0.2,{y:30});
""", sfx=[('@@Supplier bills@@', 'card-slide-1', .3), ('@@everyday expenses@@', 'card-slide-1', .3), ('@@reverses it@@-0.2', 'card-slide-1', .3)])

S['s08'] = dict(ground='light', css=r"""
.§-q{left:1000px;width:780px;padding:26px 36px}
#§-q1{top:120px}#§-q2{top:330px}#§-q3{top:540px}
.§-qt{font-family:'CACU Display';font-weight:700;font-size:28px;color:#09006C}
.§-a{margin-top:12px;height:58px;border:2px solid #e4e3ef;border-radius:14px;display:flex;align-items:center;padding:0 20px;font-size:24px;color:#14123a}
#§-ap{position:absolute;left:1000px;top:780px;width:780px}
#§-done{position:absolute;left:1000px;top:780px;width:780px;height:64px;border-radius:16px;background:#09006C;color:#fff;display:flex;align-items:center;gap:16px;padding:0 24px;font-weight:700;font-size:22px}
""", html=r"""
<div class="all" id="§-all" data-hold>""" + head(0, 'LIVE TODAY · START YOUR BOOKS', 'Plain questions.<br><em>Real books.</em>') + r"""
<div class="card §-q" id="§-q1"><div class="§-qt">How much cash is in the till and safe now?</div><div class="§-a">₦85,000</div></div>
<div class="card §-q" id="§-q2"><div class="§-qt">Customers who owe you</div><div class="§-a">Bisi Stores · ₦60,000</div></div>
<div class="card §-q" id="§-q3"><div class="§-qt">Suppliers you owe</div><div class="§-a">Mills Ltd · ₦100,000</div></div>
<div class="btn" id="§-ap">Approve opening position</div>
<div id="§-done">""" + CHECK + r"""Books started · opening position approved</div>
</div>""", js=r"""
IN('#§-eb',0.1);IN('#§-tt',0.2);
IN('#§-q1',@@How much cash@@,{y:30});IN('#§-q2',@@Who owes you@@,{y:30});IN('#§-q3',@@Who do you owe@@,{y:30});
IN('#§-ap',@@You approve@@-0.2,{y:20});
tl.fromTo('#§-ap',{scale:1},{scale:.96,duration:.07,yoyo:true,repeat:1,immediateRender:false},@@your books begin@@-0.3);
tl.fromTo('#§-done',{opacity:0,scale:.9},{opacity:1,scale:1,duration:.45,ease:'back.out(1.5)'},@@your books begin@@);
""", sfx=[('@@How much cash@@', 'card-slide-1', .28), ('@@Who owes you@@', 'card-slide-1', .28), ('@@Who do you owe@@', 'card-slide-1', .28), ('@@your books begin@@-0.3', 'click2', .5), ('@@your books begin@@', 'bong_001', .5)])

S['s09'] = dict(ground='light', css=r"""
#§-j{left:1000px;top:150px;width:800px}
.§-th,.§-tr{display:grid;grid-template-columns:1fr 180px 180px;align-items:center}
.§-th{margin-top:24px;padding-bottom:12px;border-bottom:1.5px solid #ecebf3;font-size:16px;font-weight:600;letter-spacing:1.5px;color:#77769a;text-transform:uppercase}
.§-th div:not(:first-child),.§-tr div:not(:first-child){text-align:right}
.§-tr{height:70px;border-bottom:1.5px solid #f2f1f7;font-size:23px;color:#1a1840}
.§-code{display:inline-block;width:76px;font-family:'CACU Display';font-weight:700;color:#5C40FF}
#§-stamp{margin-top:26px;height:80px;border-radius:20px;background:#09006C;color:#fff;display:flex;align-items:center;padding:0 26px;gap:16px;font-size:23px}
#§-stamp .z{margin-left:auto;font-family:'CACU Display';font-weight:700;font-size:36px;color:#7ef0b8}
#§-rev{position:absolute;left:150px;top:640px}
""", html=r"""
<div class="all" id="§-all" data-hold>""" + head(0, 'LIVE TODAY · YOUR BOOKS', 'It becomes<br><em>real books.</em>') + r"""
<div class="card" id="§-j"><div class="ch"><div class="ct">Sale #0042 · posted</div><span class="pill">Accountant view</span></div>
<div class="§-th"><div>Account</div><div>Debit</div><div>Credit</div></div>
<div class="§-tr" id="§-r1"><div><span class="§-code">1000</span>Cash on hand</div><div class="amt">₦1,300.00</div><div></div></div>
<div class="§-tr" id="§-r2"><div><span class="§-code">4000</span>Sales of goods</div><div></div><div class="amt">₦1,300.00</div></div>
<div class="§-tr" id="§-r3"><div><span class="§-code">5000</span>Cost of goods sold</div><div class="amt">₦900.00</div><div></div></div>
<div class="§-tr" id="§-r4" style="border:none"><div><span class="§-code">1200</span>Inventory</div><div></div><div class="amt">₦900.00</div></div>
<div id="§-stamp">""" + CHECK + r"""Trial balance difference<span class="z">₦0.00</span></div></div>
<span class="chip" id="§-rev">""" + CHECK.replace('#2fd18a', '#5C40FF') + r"""&nbsp;&nbsp;Standard accounts NG-2026.1 · reviewed</span>
</div>""", js=r"""
IN('#§-eb',0.1);IN('#§-tt',0.2);IN('#§-j',0.35,{y:40});
IN('#§-r1',@@every sale@@,{y:10});IN('#§-r2',@@receipt and bill@@,{y:10});IN('#§-r3',@@posts balanced@@,{y:10});IN('#§-r4',@@double-entry@@,{y:10});
tl.fromTo('#§-stamp',{opacity:0,scale:.9},{opacity:1,scale:1,duration:.45,ease:'back.out(1.5)'},@@automatically@@);
IN('#§-rev',@@reviewed by@@-0.4,{y:20});
""", sfx=[('@@automatically@@', 'bong_001', .5), ('@@reviewed by@@-0.4', 'click2', .35)])

S['s10'] = dict(ground='light', css=r"""
#§-tabs{position:absolute;left:1000px;top:170px;width:820px;display:flex;gap:9px}
.§-tab{height:50px;padding:0 15px;border-radius:999px;background:#fff;box-shadow:0 0 0 1.5px #e4e3ef;display:flex;align-items:center;font-weight:600;font-size:17px;white-space:nowrap;color:#5d5b7a;position:relative}
.§-on{position:absolute;inset:0;border-radius:999px;background:#5C40FF;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:19px}
#§-pl{left:1000px;top:270px;width:800px;padding:30px 40px}
.§-g{display:grid;grid-template-columns:1fr 170px 170px;align-items:center;height:62px;border-bottom:1.5px solid #f0eff6;font-size:22px}
.§-g div:not(:first-child){text-align:right}
.§-hd{height:44px;font-size:16px;font-weight:600;letter-spacing:1.5px;color:#77769a;text-transform:uppercase}
.§-np{font-family:'CACU Display';font-weight:700;font-size:28px;color:#5C40FF;border:none}
#§-ex{position:absolute;left:1000px;top:740px;display:flex;gap:16px}
.§-b{height:62px;padding:0 26px;border-radius:16px;border:2px solid #09006C;display:flex;align-items:center;font-weight:700;font-size:22px;color:#09006C}
#§-wa{position:absolute;left:150px;top:640px}
""", html=r"""
<div class="all" id="§-all" data-hold>""" + head(0, 'LIVE TODAY · STATEMENTS', 'Statements a<br><em>lender can read.</em>') + r"""
<div id="§-tabs">""" + ''.join(f'<div class="§-tab" id="§-t{i}">{n}<div class="§-on" id="§-o{i}">{n}</div></div>' for i, n in enumerate(['Trial balance', 'General ledger', 'Profit or loss', 'Balance sheet', 'Cash flow'], 1)) + r"""</div>
<div class="card" id="§-pl"><div class="ch"><div class="ct">Profit or loss · Ada Provisions</div><span class="pill">Management statements</span></div>
<div class="§-g §-hd" style="margin-top:14px"><div></div><div>Oct 2026</div><div>Sep 2026</div></div>
<div class="§-g"><div>Revenue</div><div class="amt">₦486,500</div><div class="amt">₦441,200</div></div>
<div class="§-g"><div>Cost of sales</div><div class="amt">(₦331,200)</div><div class="amt">(₦305,900)</div></div>
<div class="§-g"><div>Expenses</div><div class="amt">(₦62,400)</div><div class="amt">(₦58,100)</div></div>
<div class="§-g §-np"><div>Net profit</div><div class="amt">₦92,900</div><div class="amt">₦77,200</div></div></div>
<div id="§-ex"><div class="§-b" id="§-pdf" style="background:#09006C;color:#fff">⤓&nbsp;PDF</div><div class="§-b" id="§-xls">⤓&nbsp;Excel</div></div>
<span class="chip" id="§-wa">Stock at weighted-average cost</span>
</div>""", js=r"""
IN('#§-eb',0.1);IN('#§-tt',0.2);
IN('#§-tabs .§-tab',0.3,{y:12,st:.05});
const T=[@@Trial balance@@,@@General ledger@@,@@Profit and loss@@,@@balance sheet@@,@@cash flow@@];
T.forEach((t,i)=>{tl.fromTo('#§-o'+(i+1),{opacity:0},{opacity:1,duration:.15},t);if(i<4)tl.fromTo('#§-o'+(i+1),{opacity:1},{opacity:0,duration:.15,immediateRender:false},T[i+1]);});
IN('#§-pl',@@Profit and loss@@,{y:40});
IN('#§-pdf',@@PDF@@,{y:14});IN('#§-xls',@@Excel@@,{y:14});IN('#§-wa',@@weighted-average@@-0.3,{y:20});
""", sfx=[('@@Profit and loss@@', 'card-slide-1', .3), ('@@PDF@@', 'click2', .35), ('@@Excel@@', 'click2', .35)])

S['s11'] = dict(ground='light', css=r"""
#§-inv{left:1000px;top:140px;width:780px;padding:30px 38px}
.§-in{margin-top:16px;height:60px;border:2px solid #e4e3ef;border-radius:14px;display:flex;align-items:center;padding:0 20px;font-size:23px;color:#14123a}
.§-roles{display:flex;gap:12px;margin-top:16px}
.§-r{flex:1;height:56px;border-radius:14px;border:2px solid #e4e3ef;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:21px;color:#09006C;position:relative}
#§-sel{position:absolute;inset:-2px;border-radius:14px;border:3px solid #5C40FF;background:rgba(92,64,255,.07)}
#§-pay{left:1000px;top:560px;width:780px;padding:30px 38px}
#§-ok{position:absolute;right:38px;top:30px}
""", html=r"""
<div class="all" id="§-all" data-hold>""" + head(0, 'LIVE TODAY · TEAM &amp; HR', 'Your team,<br><em>in its place.</em>') + r"""
<div class="card" id="§-inv"><div class="ct">Invite a team member</div><div class="§-in">tolu@example.com</div>
<div class="§-roles"><div class="§-r" id="§-r1">Admin</div><div class="§-r" id="§-r2"><div id="§-sel"></div>Editor</div><div class="§-r" id="§-r3">Viewer</div></div></div>
<div class="card" id="§-pay"><div class="ct">October 2026 payroll</div><div class="cs">4 staff · 2026 Nigeria Tax Act bands · attendance attached</div>
<div class="row" style="margin-top:12px"><span>Net pay</span><span class="amt">₦412,600</span></div>
<span class="pill wait" id="§-wait" style="position:absolute;right:38px;top:30px">Awaiting approval</span><span class="pill ok" id="§-ok">Approved by Owner</span></div>
</div>""", js=r"""
IN('#§-eb',0.1);IN('#§-tt',0.2);IN('#§-inv',0.35,{y:40});
IN('#§-r1',@@admins@@,{y:10});IN('#§-r2',@@editors@@,{y:10});IN('#§-r3',@@viewers@@,{y:10});
tl.fromTo('#§-sel',{opacity:0},{opacity:1,duration:.15},@@editors@@+0.3);
IN('#§-pay',@@prepare payroll@@-0.4,{y:40});
tl.fromTo('#§-wait',{opacity:1},{opacity:0,duration:.2,immediateRender:false},@@approved by an owner@@);
tl.fromTo('#§-ok',{opacity:0,scale:.8},{opacity:1,scale:1,duration:.45,ease:'back.out(1.6)'},@@approved by an owner@@+0.05);
""", sfx=[('@@editors@@+0.3', 'click2', .4), ('@@prepare payroll@@-0.4', 'card-slide-1', .3), ('@@approved by an owner@@+0.05', 'bong_001', .5)])

S['s12'] = dict(ground='light', css=r"""
.§-t{left:1000px;width:780px;padding:30px 36px;display:flex;align-items:center;gap:24px}
#§-t1{top:180px}#§-t2{top:400px}#§-t3{top:620px}
.§-ic{width:72px;height:72px;border-radius:20px;background:#efecff;display:flex;align-items:center;justify-content:center;flex:none}
.§-tx{font-family:'CACU Display';font-weight:700;font-size:30px;color:#09006C}.§-tx span{display:block;font-family:'CACU Text';font-weight:500;font-size:20px;color:#5d5b7a;margin-top:6px}
#§-flood{position:absolute;inset:0;background:#09006C}
""", html=r"""
<div class="all" id="§-all" data-hold>""" + head(0, 'LIVE TODAY · TRUST', 'Built to be<br><em>trusted.</em>') + r"""
<div class="card §-t" id="§-t1"><div class="§-ic"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#5C40FF" stroke-width="2"><rect x="3" y="4" width="8" height="16" rx="2"/><rect x="13" y="4" width="8" height="16" rx="2"/></svg></div><div class="§-tx">Each business kept separate<span>Row-level security on every table</span></div></div>
<div class="card §-t" id="§-t2"><div class="§-ic"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#5C40FF" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></div><div class="§-tx">Posted records can't be changed<span>Corrections are reversals, never edits</span></div></div>
<div class="card §-t" id="§-t3"><div class="§-ic"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#5C40FF" stroke-width="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg></div><div class="§-tx">Uploads checked first<span>Held in quarantine, then re-encoded</span></div></div>
</div><div id="§-flood"></div>""", js=r"""
IN('#§-eb',0.1);IN('#§-tt',0.2);IN('#§-t1',@@data stays separate@@-0.5,{y:30});IN('#§-t2',@@posted records@@,{y:30});IN('#§-t3',@@uploads are checked@@,{y:30});
tl.fromTo('#§-flood',{opacity:0},{opacity:1,duration:.4,ease:'power2.inOut'},END-0.45);
""", sfx=[('@@data stays separate@@-0.5', 'card-slide-1', .28), ('@@posted records@@', 'card-slide-1', .28), ('@@uploads are checked@@', 'card-slide-1', .28)], noexit=True)

S['s13'] = dict(ground='navy', css=r"""
#§-big{position:absolute;left:0;right:0;top:380px;text-align:center;font-family:'CACU Display';font-weight:700;font-size:150px;letter-spacing:-5px;color:#fff}
#§-big em{font-style:normal;color:#A99BFF}
#§-sm{position:absolute;left:0;right:0;top:600px;text-align:center;font-size:34px;color:#c9c2ff;font-weight:500}
""", html=r"""<div class="all" id="§-all" data-hold><div id="§-big">Coming <em>next.</em></div><div id="§-sm">On the CACU roadmap</div></div>""", js=r"""
tl.fromTo('#§-big',{opacity:0,filter:'blur(14px)',scale:1.06},{opacity:1,filter:'blur(0px)',scale:1,duration:.6,ease:'expo.out'},0.25);IN('#§-sm',0.7);
""", sfx=[(0.25, 'impactSoft_medium_002', .5)])

def ncards(items, top=360, w=520, h=None):
    pass

S['s14'] = dict(ground='navy', css=r"""
.§-c{top:330px;width:540px;min-height:390px}
#§-c1{left:120px}#§-c2{left:690px}#§-c3{left:1260px}
.§-k{font-size:18px;font-weight:700;letter-spacing:2px;color:#A99BFF;text-transform:uppercase}
.§-h{font-family:'CACU Display';font-weight:700;font-size:38px;line-height:1.1;margin-top:12px}
.§-box{margin-top:30px;border-radius:18px;background:#fff;color:#14123a;padding:22px 24px}
.§-l{display:flex;justify-content:space-between;align-items:center;font-size:22px;font-weight:600;height:54px}
.§-plan{display:flex;justify-content:space-between;align-items:center;height:62px;border-bottom:1.5px solid #f0eff6;font-size:22px}
.§-plan:last-child{border:none}.§-plan b{font-family:'CACU Display';font-size:26px;color:#09006C}
#§-conf{position:absolute;right:24px;top:22px}
#§-eb2{position:absolute;left:120px;top:150px;font-family:'CACU Display';font-weight:700;font-size:26px;letter-spacing:4px;color:#A99BFF}
""", html=r"""
<div class="all" id="§-all" data-hold><div id="§-eb2">COMING NEXT · MONEY &amp; ACCESS</div>
<div class="ncard §-c" id="§-c1"><div class="§-k">Transfers</div><div class="§-h">Wait for your confirmation</div>
<div class="§-box" style="position:relative"><div class="§-l"><span>₦18,400 · transfer</span></div><div class="cs" style="margin-top:2px">Sale #0057 · 9:12 pm</div>
<span class="pill wait" id="§-pend" style="position:absolute;right:24px;top:22px">Pending</span><span class="pill ok" id="§-conf">Confirmed</span></div></div>
<div class="ncard §-c" id="§-c2"><div class="§-k">Installable app</div><div class="§-h">Keeps selling offline</div>
<div class="§-box"><div class="§-l"><span>Offline</span><span class="pill wait">3 sales waiting</span></div><div class="cs">They sync when the network is back</div></div></div>
<div class="ncard §-c" id="§-c3"><div class="§-k">Plans · paid through Paystack</div><div class="§-h">Founder, Innovator, Empire</div>
<div class="§-box" style="padding:8px 24px"><div class="§-plan" id="§-p1"><span>Founder</span><b>₦1,500</b></div><div class="§-plan" id="§-p2"><span>Innovator</span><b>₦6,000</b></div><div class="§-plan" id="§-p3"><span>Empire</span><b>₦15,000</b></div></div>
<div class="cs" style="color:#c9c2ff;margin-top:14px">per business, per month</div></div>
</div>""", js=r"""
IN('#§-eb2',0.1);
IN('#§-c1',0.2,{y:50});tl.fromTo('#§-pend',{opacity:1},{opacity:0,duration:.2,immediateRender:false},@@really arrived@@);
tl.fromTo('#§-conf',{opacity:0,scale:.8},{opacity:1,scale:1,duration:.4,ease:'back.out(1.6)'},@@really arrived@@+0.05);
IN('#§-c2',@@An installable app@@,{y:50});IN('#§-c3',@@three plans@@,{y:50});
IN('#§-p1',@@Founder@@,{y:8});IN('#§-p2',@@Innovator@@,{y:8});IN('#§-p3',@@Empire@@,{y:8});
""", sfx=[(0.2, 'card-slide-1', .3), ('@@really arrived@@+0.05', 'bong_001', .45), ('@@An installable app@@', 'card-slide-1', .3), ('@@three plans@@', 'card-slide-1', .3)])

TILES = [('Purchase orders', '@@Purchase orders@@'), ('Stock transfers', '@@stock transfers@@'), ('Bookings with deposits', '@@Bookings@@'),
         ('WhatsApp reminders', '@@WhatsApp@@'), ('Cashier shifts', '@@Cashier shifts@@'), ('Roles for cashiers &amp; accountants', '@@roles for cashiers@@'),
         ('Bank reconciliation', '@@bank reconciliation@@'), ('Budgets', '@@budgets@@'), ('VAT', '@@VAT@@')]
S['s15'] = dict(ground='navy', css=r"""
#§-grid{position:absolute;left:120px;top:280px;width:1680px;display:grid;grid-template-columns:repeat(3,1fr);gap:26px}
.§-tile{height:170px;border-radius:26px;background:#15107f;box-shadow:0 0 0 1.5px #2c2696;padding:30px 34px;display:flex;flex-direction:column;justify-content:space-between}
.§-n{font-family:'CACU Display';font-weight:700;font-size:20px;color:#A99BFF;letter-spacing:2px}
.§-tt{font-family:'CACU Display';font-weight:700;font-size:36px;color:#fff;line-height:1.1}
#§-eb2{position:absolute;left:120px;top:150px;font-family:'CACU Display';font-weight:700;font-size:26px;letter-spacing:4px;color:#A99BFF}
""", html=r"""<div class="all" id="§-all" data-hold><div id="§-eb2">COMING NEXT · RUNNING THE BUSINESS</div><div id="§-grid">""" + ''.join(
    f'<div class="§-tile" id="§-k{i}"><div class="§-n">0{i}</div><div class="§-tt">{n}</div></div>' for i, (n, _) in enumerate(TILES, 1)) + "</div></div>",
    js="IN('#§-eb2',0.1);\n" + ''.join(f"IN('#§-k{i}',{a}-0.15,{{y:30}});\n" for i, (_, a) in enumerate(TILES, 1)),
    sfx=[(a + '-0.15', 'card-slide-1', .22) for _, a in TILES[::2]])

S['s16'] = dict(ground='navy', css=r"""
#§-eb2{position:absolute;left:120px;top:150px;font-family:'CACU Display';font-weight:700;font-size:26px;letter-spacing:4px;color:#A99BFF}
#§-chat{left:120px;top:250px;width:860px;height:470px}
.§-q{margin-left:auto;width:fit-content;max-width:600px;background:#5C40FF;color:#fff;border-radius:22px 22px 6px 22px;padding:18px 24px;font-size:25px;font-weight:600}
.§-a{margin-top:22px;width:fit-content;max-width:680px;background:#fff;color:#14123a;border-radius:22px 22px 22px 6px;padding:20px 24px;font-size:24px;line-height:1.45}
.§-a b{font-family:'CACU Display';color:#09006C}
.§-src{margin-top:12px;font-size:18px;color:#c9c2ff}
#§-fund{left:1040px;top:250px;width:760px;height:470px}
.§-gauge{margin:26px auto 0;width:360px;height:180px;position:relative;overflow:hidden}
.§-arc{position:absolute;left:0;top:0;width:360px;height:360px;border-radius:50%;border:30px solid #2c2696;box-sizing:border-box}
#§-fill{position:absolute;left:0;top:0;width:360px;height:360px;border-radius:50%;border:30px solid transparent;border-top-color:#A99BFF;border-left-color:#A99BFF;box-sizing:border-box;transform:rotate(-45deg)}
.§-band{text-align:center;font-family:'CACU Display';font-weight:700;font-size:40px;margin-top:8px}
.§-con{text-align:center;font-size:21px;color:#c9c2ff;margin-top:10px}
#§-more{position:absolute;left:120px;top:790px;display:flex;gap:20px}
.§-chip{height:62px;padding:0 28px;border-radius:999px;background:#15107f;box-shadow:0 0 0 1.5px #2c2696;display:flex;align-items:center;font-weight:700;font-size:23px;color:#fff}
#§-flood{position:absolute;inset:0;background:#F7F7F7}
""", html=r"""
<div class="all" id="§-all" data-hold><div id="§-eb2">COMING NEXT · INTELLIGENCE</div>
<div class="ncard" id="§-chat"><div class="§-k" style="font-size:18px;font-weight:700;letter-spacing:2px;color:#A99BFF">AI ASSISTANT</div>
<div style="margin-top:26px"><div class="§-q" id="§-q">How much profit did I make this month?</div>
<div class="§-a" id="§-a">You made <b>₦92,900</b> net profit in October, ₦15,700 more than September.<div class="§-src" style="color:#5d5b7a">From your posted books · Profit or loss, Oct 2026</div></div></div></div>
<div class="ncard" id="§-fund"><div class="§-k" style="font-size:18px;font-weight:700;letter-spacing:2px;color:#A99BFF">FUNDING READINESS</div>
<div class="§-gauge"><div class="§-arc"></div><div id="§-fill"></div></div><div class="§-band">Developing</div>
<div class="§-con">An indicative self-assessment.<br>Shared with a lender only when you choose.</div></div>
<div id="§-more"><div class="§-chip" id="§-m1">Payroll posting</div><div class="§-chip" id="§-m2">E-invoicing</div><div class="§-chip" id="§-m3">New countries</div></div>
</div><div id="§-flood"></div>""", js=r"""
IN('#§-eb2',0.1);IN('#§-chat',0.2,{y:40});IN('#§-q',0.5,{y:16});IN('#§-a',@@get the answer@@,{y:16});
IN('#§-fund',@@how ready@@-0.3,{y:40});
tl.fromTo('#§-fill',{rotation:-180},{rotation:-45-36,duration:1.0,ease:'power3.out'},@@how ready@@+0.2);
IN('#§-m1',@@payroll posting@@,{y:14});IN('#§-m2',@@e-invoicing@@,{y:14});IN('#§-m3',@@new countries@@,{y:14});
tl.fromTo('#§-flood',{opacity:0},{opacity:1,duration:.4,ease:'power2.inOut'},END-0.45);
""", sfx=[('@@get the answer@@', 'card-slide-1', .28), ('@@how ready@@-0.3', 'card-slide-1', .28), ('@@payroll posting@@', 'click2', .3), ('@@e-invoicing@@', 'click2', .3), ('@@new countries@@', 'click2', .3)], noexit=True)

S['s17'] = dict(ground='light', css=r"""
.§-wm{position:absolute;left:510px;top:270px;width:900px}
#§-o1{position:absolute;left:0;right:0;top:580px;text-align:center;font-family:'CACU Display';font-weight:700;font-size:78px;color:#09006C;letter-spacing:-2.5px}
#§-o2{position:absolute;left:0;right:0;top:700px;text-align:center;font-family:'CACU Display';font-weight:600;font-size:44px;color:#09006C}
#§-o2 b{color:#5C40FF}
#§-cr{position:absolute;left:0;right:0;top:940px;text-align:center;font-size:20px;color:#77769a}
""", html=r"""
<div class="all" id="§-all" data-hold><img class="§-wm" id="§-dome" src="assets/img/logo-wordmark.jpg"><img class="§-wm" id="§-bowl" src="assets/img/logo-wordmark.jpg"><img class="§-wm" id="§-txt" src="assets/img/logo-wordmark.jpg">
<div id="§-o1">Books an owner can trust.</div><div id="§-o2"><b>Sell.</b> CACU keeps the books.</div>
<div id="§-cr">Music: Sascha Ende, ende.app (CC BY 4.0) · Shop, people and figures are illustrative</div></div>""", js=r"""
tl.set('#§-dome',{clipPath:'inset(0 76% 64% 0)'},0);tl.set('#§-bowl',{clipPath:'inset(44% 76% 0 0)'},0);
tl.fromTo('#§-dome',{y:-220,opacity:0},{y:0,opacity:1,duration:.7,ease:'back.out(1.4)'},0.1);
tl.fromTo('#§-bowl',{y:220,opacity:0},{y:0,opacity:1,duration:.7,ease:'back.out(1.4)'},0.25);
tl.fromTo('#§-txt',{clipPath:'inset(0 73% 0 27%)'},{clipPath:'inset(0 0% 0 27%)',duration:.5,ease:'power3.inOut'},0.65);
IN('#§-o1',1.2);IN('#§-o2',@@Sell@@);IN('#§-cr',@@keeps the books@@+0.8);
""", sfx=[(0.1, 'impactBell_heavy_000', .45)], noexit=True)

# ---------- layout
order = [f's{i:02d}' for i in range(1, 18)]
start, T, info = 0.0, {}, {}
for sid in order:
    V = dur(sid); L = LEAD.get(sid, 0.7); tail = TAIL.get(sid, 1.1)
    slot = 10.02 if sid == 's01' else fr(L + V + tail)
    T[sid] = (fr(start), slot, L, V); start = fr(start + slot)
TOTAL = start

def anchors(sid, s):
    _, slot, L, V = T[sid]; text = LINES[sid]
    import re
    def rep(m):
        expr = m.group(1); phrase, off = expr, 0.0
        i = text.find(phrase)
        if i < 0: raise SystemExit(f'{sid}: phrase not in line: {phrase!r}')
        return f'{L + V * i / len(text):.3f}'
    return re.sub(r'@@(.+?)@@', rep, s)

def evalt(sid, t):
    if isinstance(t, (int, float)): return float(t)
    return eval(anchors(sid, t))

HELP = r"""
const IN=(s,t,d={})=>tl.fromTo(s,{opacity:0,y:d.y??22,rotation:d.rot??0,filter:'blur(8px)'},{opacity:1,y:0,rotation:d.rot??0,filter:'blur(0px)',duration:d.dur??0.6,ease:'expo.out',stagger:d.st??0},t);
"""
for sid in order:
    sc, (st, slot, L, V) = S[sid], T[sid]
    css = COMMON_CSS + sc['css']
    js = anchors(sid, sc['js']).replace('END', f'{slot:.3f}')
    exitjs = '' if sc.get('noexit') else f"tl.fromTo('#{sid}-all',{{opacity:1,filter:'blur(0px)'}},{{opacity:0,filter:'blur(8px)',duration:.25,ease:'power3.in',immediateRender:false}},{slot - 0.3:.3f});\n"
    page = f"""<template>
<style>{css.replace('§', sid)}</style>
<div id="root" data-composition-id="{sid}" data-width="1920" data-height="1080" data-layout-allow-overlap>
<div class="ground {sc['ground']}"></div>
{sc['html'].replace('§', sid)}
</div>
<script>
const tl=gsap.timeline({{paused:true}});{HELP}{js.replace('§', sid)}{exitjs}tl.to({{}},{{duration:{slot:.3f}}},0);
window.__timelines["{sid}"]=tl;
</script>
</template>
"""
    (ROOT / 'compositions' / f'{sid}.html').write_text(page, encoding='utf-8')

# ---------- root
hosts, audio, z = [], [], 1
for sid in order:
    st, slot, L, V = T[sid]
    hosts.append(f'<div id="{sid}" class="clip" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{st:.3f}" data-duration="{slot:.3f}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080" style="z-index:{z}"></div>')
    audio.append(f'<audio id="vo-{sid}" class="clip" data-start="{st + L:.3f}" data-duration="{V:.3f}" data-track-index="3" data-volume="1" data-audio-group="voiceover" src="assets/vo/{sid}.wav"></audio>')
def sfxdur(f):
    return float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(ROOT/'assets/sfx'/f'{f}.ogg')],capture_output=True,text=True).stdout)
SEAM = ['impactSoft_medium_000', 'impactSoft_medium_002', 'impactSoft_medium_004']
n = 0
for k, sid in enumerate(order):
    st = T[sid][0]
    events = list(S[sid].get('sfx', []))
    if sid not in ('s01', 's02', 's13', 's17'):
        events.append((0.0, SEAM[k % 3], .22))
    for t, f, vol in events:
        n += 1
        audio.append(f'<audio id="fx{n:02d}" class="clip" data-start="{st + evalt(sid, t) + 1/FPS:.3f}" data-duration="{sfxdur(f):.3f}" data-track-index="4" data-volume="{vol}" data-audio-group="sfx" src="assets/sfx/{f}.ogg"></audio>')

s02, s13, s17 = T['s02'][0], T['s13'][0], T['s17'][0]
m1_end = s13 + 0.6
lane1 = [(0, .45), (1.3, .45), (1.7, .14), (s02 - .1, .14), (s02 + .1, .40), (s02 + 1.1, .40), (s02 + 1.45, .14), (m1_end, .14)]
v17 = s17 + T['s17'][2] + T['s17'][3]
m2_dur = TOTAL - s13
lane2 = [(0, .42), (1.0, .42), (1.3, .14), (v17 - s13 + .1, .14), (v17 - s13 + .6, .40), (m2_dur, .40)]
def lane(points): return json.dumps({"version": 1, "lanes": [{"target": "volume", "points": [{"t": round(t, 3), "v": v} for t, v in points]}]}).replace('"', '&quot;')
audio.append(f'<audio id="music1" class="clip" data-start="0" data-duration="{m1_end:.3f}" data-media-start="14.0" data-track-index="5" data-volume="1" data-fade-out="0.8" data-audio-group="music" data-automation="{lane(lane1)}" src="assets/music/happy-beats-business-moves-vol-1-by-ende-dot-app.mp3"></audio>')
audio.append(f'<audio id="music2" class="clip" data-start="{s13:.3f}" data-duration="{m2_dur:.3f}" data-media-start="8.19" data-track-index="6" data-volume="1" data-fade-in="0.3" data-fade-out="3.0" data-audio-group="music" data-automation="{lane(lane2)}" src="assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3"></audio>')

variables = [{"id": "color-ground", "type": "color", "label": "Light ground", "default": "#F7F7F7"},
             {"id": "color-navy", "type": "color", "label": "Navy", "default": "#09006C"},
             {"id": "color-accent", "type": "color", "label": "Accent", "default": "#5C40FF"}]
index = f"""<!doctype html>
<html lang="en" data-composition-variables='{json.dumps(variables)}'>
<head><meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>*{{margin:0;padding:0;box-sizing:border-box}}html,body{{width:1920px;height:1080px;overflow:hidden;background:#F7F7F7}}#root{{position:relative;width:1920px;height:1080px}}</style></head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{TOTAL:.3f}" data-width="1920" data-height="1080">
{chr(10).join(hosts)}
{chr(10).join(audio)}
</div>
<script>window.__timelines["main"]=gsap.timeline({{paused:true}});</script>
</body></html>
"""
(ROOT / 'index.html').write_text(index, encoding='utf-8')
print(f'TOTAL {TOTAL:.2f}s')
for sid in order:
    st, slot, L, V = T[sid]; print(f'{sid} start {st:7.2f} slot {slot:6.2f} lead {L} vo {V:.2f}')
json.dump({k: v for k, v in T.items()}, open(Path(__file__).with_name('layout.json'), 'w'), indent=1)
