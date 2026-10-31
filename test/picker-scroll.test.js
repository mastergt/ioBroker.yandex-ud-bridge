const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const admin=path.join(__dirname,'../admin');
const css=fs.readFileSync(path.join(admin,'editor.css'),'utf8');
const editor=fs.readFileSync(path.join(admin,'editor.js'),'utf8');

test('selectID dialog has a bounded native tree scrollport',()=>{
    assert.match(css,/#dialog-select-member \.dialog-content\s*\{[^}]*max-height:[^}]*overflow-y:auto!important/s);
    assert.match(css,/#dialog-select-member\.modal\.modal-fixed-footer \.modal-content\s*\{[^}]*overflow-y:auto!important/s);
    assert.match(css,/#dialog-select-member \.dialog-content ul\.fancytree-container\s*\{[^}]*max-height:[^}]*overflow-y:auto!important/s);
    assert.match(css,/@media\(max-width:600px\)/);
});
test('both Admin entrypoints retain native selectID with fixed footer',()=>{
    for(const file of ['tab_m.html','index_m.html']){
        const html=fs.readFileSync(path.join(admin,file),'utf8');
        assert.match(html,/id="dialog-select-member" class="modal modal-fixed-footer"/);
        assert.match(html,/class="col s12 dialog-content"/);
        assert.match(html,/class="modal-footer"/);
    }
    assert.match(editor,/selectId\('show',current,newId/);
    assert.match(editor,/selectId\('init',/);
});
