// Local packaging checks. These do not compile C# or exercise Windows/COSTAR.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
for (const name of ['F_alt_tab.js','Fitment_Planner.js','jobcard-shared.js','costar-client.js']) {
  execFileSync(process.execPath, ['--check', path.join(root,'Website',name)]);
}
for (const name of ['index.html','Fitment_Planner.html']) {
  const html = fs.readFileSync(path.join(root,'Website',name),'utf8');
  for (const [,src] of html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)) {
    if (/^https?:/.test(src)) continue;
    assert.ok(fs.existsSync(path.resolve(root,'Website',src.split('?')[0])), `${name}: missing ${src}`);
  }
}
const context = {window:{}};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'Source/qr.js'),'utf8'),context);
for (const url of [
  'http://192.168.1.100:8791/trust.cer',
  'https://192.168.1.100:8790/Fitment_Planner.html#pc=https%3A%2F%2F192.168.1.100%3A8790&key='+'a'.repeat(43),
  'https://example.github.io/tempe-helper/Fitment_Planner.html#pc=https%3A%2F%2F192.168.1.100%3A8790&key='+'b'.repeat(43)
]) {
  const qr = new context.window.TempeQR(-1,1);
  qr.addData(url); qr.make();
  const size=qr.getModuleCount();
  assert.ok(size>=21 && (size-21)%4===0 && size<=177);
  const finder=['1111111','1000001','1011101','1011101','1011101','1000001','1111111'];
  for (const [top,left] of [[0,0],[0,size-7],[size-7,0]])
    for(let y=0;y<7;y++) for(let x=0;x<7;x++)
      assert.equal(qr.isDark(top+y,left+x),finder[y][x]==='1');
  assert.ok(Array.from({length:size},(_,y)=>Array.from({length:size},(_,x)=>qr.isDark(y,x))).flat().every(v=>typeof v==='boolean'));
}
for (const name of ['Check-Build.cmd','Setup-Desk.cmd','Start-Desk.cmd','Start-RDP.cmd','Start-Online.cmd']) {
  const launcher=fs.readFileSync(path.join(root,name),'utf8');
  const match=launcher.match(/%~dp0([^"\r\n]+\.ps1)/);
  assert.ok(match && fs.existsSync(path.join(root,match[1])),`${name}: missing launch script`);
}
assert.ok(fs.existsSync(path.join(root,'Source/MobileTests.cs')));
assert.ok(fs.readFileSync(path.join(root,'Build.ps1'),'utf8').includes('--self-test'));
console.log('PASS JavaScript syntax, website script references, three local QR payloads, Windows launcher targets and self-test inclusion.');
console.log('C# compilation, Windows TLS/DPAPI/controls, camera QR scanning and RDP injection were not exercised.');
