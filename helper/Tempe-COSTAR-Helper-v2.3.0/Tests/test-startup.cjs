// Exercise the actual HTML startup guard and page script through browser events.
// The DOM and saved-draft adapter are in memory; this is not a live browser test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../Website/jobcard-shared.js');
const html = fs.readFileSync(path.join(__dirname, '../Website/Fitment_Planner.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../Website/Fitment_Planner.js'), 'utf8');
const guard = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].find(m => !/\bsrc=/.test(m[1]))[2];
const clone = value => JSON.parse(JSON.stringify(value));
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
class Element {
    constructor(tagName = 'DIV') {
        Object.assign(this, {tagName, value: '', textContent: '', children: [], dataset: {}, disabled: false, hidden: false, checked: false, events: {}});
        this.classList = {add() {}, remove() {}};
    }
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    async fire(name, event = {}) { for (const fn of this.events[name] || []) await fn({...event, target: this}); }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.children.push(node); return node; }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
    focus() {}
    setSelectionRange() {}
}
function environment({readyState = 'loading', missingCore = false, readError = null, pendingRead = null} = {}) {
    let draft = core.empty('saved-by-f-alt-tab');
    for (const sku of ['UNU2054517S', '2054517ST005', '2254517ST005']) {
        draft = core.reduce(draft, {type: 'add', productId: sku, product: {sku, type: 'tyre', description: 'TEST TYRE'}});
    }
    const original = JSON.stringify(draft), writes = [], nodes = new Map(), events = {}, timers = new Map();
    let timerId = 0, subscriptions = 0, intervals = 0, reloads = 0;
    for (const m of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
        nodes.set(m[3], Object.assign(new Element(m[1].toUpperCase()), {disabled: /\bdisabled\b/.test(m[2]), hidden: /\bhidden\b/.test(m[2])}));
    }
    nodes.get('saveStatus').textContent = 'Loading…';
    const radios = ['WA', 'WAFR'].map(value => Object.assign(new Element('INPUT'), {value, disabled: true}));
    const document = {readyState, hidden: false, events: {}, body: new Element('BODY'),
        getElementById: id => nodes.get(id), createElement: tag => new Element(tag.toUpperCase()),
        querySelectorAll: q => q.includes('alignmentCode') ? radios : [], querySelector: () => null,
        addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    };
    const store = {
        async read() { if (readError) throw new Error(readError); if (pendingRead) await pendingRead; return clone(draft); },
        async mutate(action) { writes.push(clone(action)); draft = core.reduce(draft, action); return clone(draft); },
        subscribe() { subscriptions++; }
    };
    const context = {document, console, Promise, Date, navigator: {},
        location: {reload() { reloads++; }}, localStorage: {removeItem() { throw new Error('Startup must not clear storage'); }},
        addEventListener(name, fn) { (events[name] ||= []).push(fn); },
        setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
        setInterval() { intervals++; return 1; },
        TempeJobCard: missingCore ? undefined : {...core, getStore: () => store, toast() {}}
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(guard, context, {filename: 'Job Card inline startup guard'});
    return {
        context, nodes, document, events, timers, writes, original, draft: () => draft,
        counters: () => ({subscriptions, intervals, reloads}),
        load() { vm.runInContext(source, context, {filename: 'Fitment_Planner.js'}); },
        async domReady() { document.readyState = 'interactive'; for (const fn of document.events.DOMContentLoaded || []) await fn(); },
        async complete() { await nextTurn(); await nextTurn(); }
    };
}
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
(async () => {
    await check('normal deferred startup restores all three F Alt Tab products without rewriting them', async () => {
        const e = environment(); e.load();
        assert.equal(e.nodes.get('productLines').children.length, 0);
        assert.equal(e.nodes.get('customerName').disabled, true);
        await e.domReady();
        assert.equal(e.nodes.get('productCount').textContent, '3 / 3');
        assert.deepEqual(e.nodes.get('productLines').children.map(row => row.children[0].children[1].value), ['UNU2054517S', '2054517ST005', '2254517ST005']);
        assert.ok(e.nodes.get('jobCardPreview').textContent.includes('2254517ST005'));
        assert.equal(e.nodes.get('saveStatus').textContent, 'Saved');
        assert.equal(e.nodes.get('jobcardStartupNotice').hidden, true);
        assert.equal(e.nodes.get('customerName').disabled, false);
        assert.equal(e.writes.length, 0);
        assert.equal(JSON.stringify(e.draft()), e.original);
    });
    await check('a script loaded after DOMContentLoaded still restores the saved card', async () => {
        const e = environment({readyState: 'complete'}); e.load(); await e.complete();
        assert.equal(e.nodes.get('productCount').textContent, '3 / 3');
        assert.equal(e.nodes.get('productLines').children.length, 3);
        assert.equal(e.writes.length, 0);
    });
    await check('repeated startup does not duplicate listeners or poll timers', async () => {
        const e = environment({readyState: 'interactive'}); e.load();
        const a = e.context.initJobCard(), b = e.context.initJobCard();
        assert.equal(a, b); await a;
        assert.equal(e.nodes.get('customerName').events.input.length, 1);
        assert.deepEqual(e.counters(), {subscriptions: 1, intervals: 1, reloads: 0});
    });
    await check('missing shared script gives a visible error and never clears the saved products', async () => {
        const e = environment({missingCore: true}); e.load(); await e.domReady();
        assert.match(e.nodes.get('jobcardStartupMessage').textContent, /jobcard-shared\.js did not load/);
        assert.equal(e.nodes.get('reloadJobCardBtn').hidden, false);
        assert.equal(e.nodes.get('saveStatus').textContent, 'Not loaded');
        for (const id of ['customerName', 'addWheelBtn', 'newJobBtn', 'submitBtn']) assert.equal(e.nodes.get(id).disabled, true);
        assert.equal(e.writes.length, 0); assert.equal(JSON.stringify(e.draft()), e.original);
    });
    await check('a failed storage read cannot replace the saved card with an empty draft', async () => {
        const e = environment({readError: 'Saved card is temporarily unavailable'}); e.load(); await e.domReady();
        assert.match(e.nodes.get('jobcardStartupMessage').textContent, /temporarily unavailable/);
        assert.equal(e.nodes.get('customerName').disabled, true);
        assert.equal(e.writes.length, 0); assert.equal(JSON.stringify(e.draft()), e.original);
    });
    await check('a missing page script is reported by HTML even when no page script executes', async () => {
        const e = environment();
        for (const fn of e.events.error) fn({target: {tagName: 'SCRIPT', src: 'https://test.invalid/Fitment_Planner.js?v=20260929-startup1'}});
        assert.match(e.nodes.get('jobcardStartupMessage').textContent, /Fitment_Planner\.js could not be loaded/);
        assert.equal(e.timers.size, 0); // Preserve the precise failure instead of replacing it with a timeout.
        await e.nodes.get('reloadJobCardBtn').fire('click');
        assert.equal(e.counters().reloads, 1); assert.equal(e.writes.length, 0);
    });
    await check('a stalled startup shows a reload message and a later successful read restores the card', async () => {
        let release;
        const e = environment({readyState: 'complete', pendingRead: new Promise(resolve => { release = resolve; })});
        e.load(); for (const fn of [...e.timers.values()]) fn();
        assert.match(e.nodes.get('jobcardStartupMessage').textContent, /could not finish loading/);
        assert.equal(e.nodes.get('customerName').disabled, true);
        release(); await e.complete();
        assert.equal(e.nodes.get('jobcardStartupNotice').hidden, true);
        assert.equal(e.nodes.get('productCount').textContent, '3 / 3');
        assert.equal(e.nodes.get('customerName').disabled, false);
    });
    await check('saved products render without a PC helper or COSTAR client', async () => {
        const e = environment({readyState: 'complete'}); e.load(); await e.complete();
        assert.equal(e.nodes.get('productCount').textContent, '3 / 3');
        assert.equal(e.nodes.get('helperConnection').textContent, 'PC helper not connected');
        assert.equal(e.nodes.get('submitBtn').disabled, true);
    });
    await check('versioned script URLs resolve to the included files', async () => {
        const refs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
        assert.equal(refs.length, 3);
        for (const ref of refs) {
            assert.match(ref, /\?v=20260929-startup1$/);
            assert.ok(fs.existsSync(path.join(__dirname, '../Website', ref.split('?')[0])));
        }
    });
    console.log(checks + ' startup checks passed using DOM/storage adapters; no live browser was exercised.');
})().catch(error => { console.error(error); process.exitCode = 1; });
