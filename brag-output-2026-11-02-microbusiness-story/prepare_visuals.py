from pathlib import Path
import json
r=Path('.'); scenes=json.loads((r/'scenes.json').read_text(encoding='utf-8'))
# Composition source is prepared now; final timing and audio are inserted after narration is measured.
css='''@font-face{font-family:Space Grotesk;src:url('assets/fonts/space-grotesk-latin-variable.woff2')}@font-face{font-family:Inter;src:url('assets/fonts/inter-latin-variable.woff2')}*{box-sizing:border-box}#root{position:absolute;inset:0;background:#F7F7F7;color:#09006C;font-family:Inter}.content{position:absolute;inset:0;padding:105px 150px}h1,h2,h3,p{margin:0}h1,h2,h3{font-family:Space Grotesk;font-weight:700;letter-spacing:-2px}h1{font-size:79px;line-height:1.12}.brandbar{display:flex;align-items:center;gap:20px;font-size:28px;font-weight:700;letter-spacing:2px}.brandbar img{width:50px;height:50px}.label{color:#4930D4;font-size:28px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-top:52px;margin-bottom:25px}.left{width:730px}.sub{font-size:32px;line-height:1.5;color:#494361;margin-top:38px}.panel{position:absolute;left:965px;top:225px;width:805px;border:2px solid #D8D1EF;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 20px 50px #09006c0d}.panelhead{padding:25px 32px;background:#EAE6FC;font-size:30px;font-weight:700}.inside{padding:30px 32px}.row{padding:23px 0;border-bottom:1px solid #DED8EE;display:flex;justify-content:space-between;gap:20px;font-size:29px;line-height:1.4}.row:last-child{border:0}.row strong{white-space:nowrap}.muted{color:#514B6B}.btn{background:#5C40FF;color:#fff;border-radius:12px;padding:22px;text-align:center;font-size:29px;font-weight:700;margin-top:24px}.pill{display:inline-block;border-radius:12px;padding:13px 20px;background:#E8E2FF;color:#35228A;font-size:28px;font-weight:700;margin:12px 12px 0 0}.footer{position:absolute;left:150px;right:150px;bottom:48px;font-size:28px;color:#514B6B;line-height:1.4}.chapter{position:absolute;right:150px;top:115px;font-size:28px;color:#514B6B}.note{font-size:28px;color:#514B6B;line-height:1.5;margin-top:25px}.amount{font-size:108px;font-family:Space Grotesk;font-weight:700;letter-spacing:-4px;color:#5C40FF}.tick{color:#17633D;font-weight:700}.line{height:3px;background:#DED8EE}.paper{background:#FFFDF7;border-color:#DBCFC1}.paper .panelhead{background:#F0E8DC}.step{margin-top:25px;padding-left:23px;border-left:4px solid #5C40FF;font-size:31px;line-height:1.4}.hero-logo{width:700px;display:block;margin:80px auto 35px}.bigline{font-size:42px;line-height:1.3;font-weight:700}.tiny{font-size:28px}.tabs{display:flex;gap:20px;font-size:28px;flex-wrap:wrap;padding-bottom:20px;border-bottom:2px solid #DCD6FF}.tabactive{color:#4930D4;font-weight:700}'''
def rows(items):return ''.join('<div class="row reveal"><span>'+a+'</span><strong>'+b+'</strong></div>' for a,b in items)
def panel(title,body,cls=''):return '<div class="panel '+cls+'"><div class="panelhead">'+title+'</div><div class="inside">'+body+'</div></div>'
visuals={
'notebook':panel('Bisi’s evening notebook',rows([('Sales today','?'),('Stock bought','?'),('Expenses paid','?')])+'<p class="note">What is left after the costs?</p>','paper'),
'scatter':panel('Reconstructing a working day','<div class="step reveal">Notebook: sales and credit</div><div class="step reveal">Paper bill: supplier delivery</div><div class="step reveal">Memory: a customer payment</div><p class="note">One record is still missing.</p>','paper'),
'stat':panel('A local finding — not all of Nigeria','<div class="amount reveal">59.2%</div><p style="font-size:34px;line-height:1.4;margin-top:20px">kept financial records manually themselves</p><div class="line" style="margin-top:30px"></div><p class="note">120 business owners · Abeokuta South<br>Published 2020 · Purposive sample</p>'),
'brand':'<div class="panel" style="border:0;box-shadow:none;background:#F7F7F7;top:230px"><img class="hero-logo" src="assets/logo.jpg"><p style="font-size:34px;text-align:center">Product · Service · Hybrid</p><div style="text-align:center;margin-top:35px"><span class="pill">Grow With Ease</span></div></div>',
'pos':panel('CACU / POS Checkout','<p class="note" style="margin:0;background:#F3F0FA;padding:16px">Search inventory or scan SKU...</p>'+rows([('Milk, tin × 2','NGN 1,300'),('Payment method','Cash')])+'<div class="btn" id="sale-button">Confirm &amp; Record Sale</div><p class="note tick reveal">✓ Sale Recorded</p>'),
'stock':panel('CACU / Inventory',rows([('Item','Milk, tin'),('On hand before sale','12'),('Sale quantity','2'),('On hand after sale','10')])+'<p class="note reveal">Stock history records the change.</p>'),
'invoice':panel('CACU / Invoices &amp; Receipts',rows([('Sample invoice','INV-DEMO-01'),('Invoice amount','NGN 15,000'),('Payment recorded','NGN 5,000'),('Remaining amount','NGN 10,000')])+'<span class="pill reveal">Customer record</span><span class="pill reveal">Receipt</span>'),
'supplier':panel('CACU / Supplier bills',rows([('Sample bill','BILL-DEMO-01'),('Bill amount','NGN 30,000'),('Payment recorded','NGN 10,000'),('Remaining amount','NGN 20,000')])+'<span class="pill reveal">Part paid</span>'),
'expenses':panel('CACU / Expenses',rows([('Transport','NGN 4,000'),('Shop supplies','NGN 6,000'),('Other operating costs','NGN 10,000')])+'<div class="btn reveal">Record with supporting details</div><p class="note">Illustrative period costs.</p>'),
'ledger':panel('CACU / General ledger',rows([('Debit · Cash','NGN 1,300'),('Credit · Sales','NGN 1,300')])+'<div class="step reveal">Journals → General ledger</div><div class="step reveal">Trial balance → Review</div><p class="note">Illustrative revenue-side posting only.</p>'),
'reports':panel('CACU / Financial Reports','<div class="tabs"><span class="tabactive">Income Statement</span><span>Balance Sheet</span><span>Cash Flow</span></div>'+rows([('Sales','NGN 120,000'),('Cost of goods','NGN 80,000'),('Other expenses','NGN 20,000'),('Before other charges','NGN 20,000')])+'<span class="pill">PDF</span><span class="pill">Excel</span>'),
'cash':panel('Illustrative period calculation',rows([('Sales','120,000'),('Less stock cost','(80,000)'),('Less other expenses','(20,000)')])+'<div class="amount reveal" style="font-size:80px;margin-top:25px">NGN 20,000</div><p class="note">Before other charges.<br>Cash timing can be different.</p>'),
'people':panel('CACU / HR &amp; workforce','<div class="step reveal">Employee information</div><div class="step reveal">Attendance records</div><div class="step reveal">Monthly payroll drafts</div><span class="pill reveal">Owner / Admin review</span><p class="note">No payout or accounting posting.</p>'),
'controls':panel('CACU / Access &amp; records','<div class="step reveal">Business roles and permissions</div><div class="step reveal">Audit history for changes</div><div class="step reveal">Configured secure uploads</div><p class="note">Keep supporting files with the workflow.</p>'),
'ai':panel('CACU AI Assistant','<p class="note" style="margin-top:0">Illustrative question</p><div style="font-size:37px;line-height:1.4;margin-top:20px">“What do these business records tell me?”</div><div class="line" style="margin-top:32px"></div><span class="pill reveal">Provider setup required</span><p class="note reveal">No generated answer is shown.<br>Review assistance with your accountant.</p>'),
'setup':panel('Your getting-started checklist','<div class="step reveal">Choose the business mode</div><div class="step reveal">Check items and party records</div><div class="step reveal">Review opening balances</div><div class="step reveal">Approve mappings and activate</div><p class="note">Internet required to save.</p>'),
'support':panel('Digital tools + a regular habit','<div class="step reveal">Start with one daily workflow</div><div class="step reveal">Record consistently</div><div class="step reveal">Review with support</div><p class="note">IGC pilot: digital records and<br>personalised adoption support.<br>Not a test of CACU.</p>'),
'sources':panel('Research behind the story','<p class="bigline">Olajide &amp; Obialo · 2020</p><p class="note">JEMT 26(5), 34–43<br>journaljemt.com · DOI:<br>10.9734/jemt/2020/v26i530254</p><div class="line" style="margin-top:25px"></div><p class="bigline" style="margin-top:25px;font-size:36px">IGC / Oyebanjo · 2025</p><p class="note">Digital records policy brief<br>theigc.org</p>')}
sub={
'notebook':'A busy day is easy to remember.<br>The full record can be harder.',
'scatter':'Sales, costs, credit and cash<br>need to meet in one record.',
'stat':'Evidence for the problem.<br>Careful about the scope.',
'brand':'Daily operations.<br>Connected business records.',
'pos':'Find the item.<br>Confirm the sale.<br>Keep the receipt.',
'stock':'Items. Quantities. History.<br>Reviewed valuation controls.',
'invoice':'Customer details and payments,<br>with a record to follow.',
'supplier':'A bill and its payment<br>belong in the same story.',
'expenses':'Capture the costs<br>behind the sales.',
'ledger':'A traceable structure<br>for owner and accountant.',
'reports':'Income. Position. Cash flow.<br>Review and export.',
'cash':'Look beyond the amount<br>collected at the counter.',
'people':'Employees. Attendance.<br>Payroll drafts for review.',
'controls':'Shared work.<br>Clear responsibility.',
'ai':'Business questions.<br>Financial context.<br>Human review.',
'setup':'Review the starting point.<br>Build a consistent routine.',
'support':'A tool works best<br>when it becomes a habit.',
'sources':'Fictional composite story.<br>Illustrative figures.<br>Synthetic narration.'}
for i,s in enumerate(scenes):
 s['visual']=visuals[s['kind']];s['sub']=sub.get(s['kind'],'');s['chapter']=i+1
(r/'visual-scenes.json').write_text(json.dumps(scenes,ensure_ascii=False,indent=2),encoding='utf-8')
(r/'scene-style.css').write_text(css,encoding='utf-8')
print('Prepared nineteen distinct source-grounded chapter visuals.')
