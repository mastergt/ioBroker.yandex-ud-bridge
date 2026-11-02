'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const admin=path.join(__dirname,'../admin');
const css=fs.readFileSync(path.join(admin,'editor.css'),'utf8');
const editor=fs.readFileSync(path.join(admin,'editor.js'),'utf8');
test('standalone HTML state browser is scrollable, accessible, and bounded',()=>{
  assert.match(css,/\.state-dialog-results\{[^}]*overflow-y:auto/s);
  assert.match(css,/\.state-dialog\{[^}]*max-height:/s);
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(editor,/const LIMIT = 250/);
  assert.match(editor,/aria-selected/);
});
test('both entrypoints include vanilla HTML dialog and no FancyTree assets',()=>{
  for(const file of ['tab_m.html','index_m.html']) {
    const html=fs.readFileSync(path.join(admin,file),'utf8');
    assert.match(html,/id="state-picker-dialog"/);
    assert.match(html,/id="state-picker-results"/);
    assert.match(html,/id="state-picker-search"/);
    assert.doesNotMatch(html,/fancytree|selectID\.js|materialize\.css|materialize\.js/i);
  }
  assert.doesNotMatch(editor,/selectId\('show'|selectId\('init'/);
});
