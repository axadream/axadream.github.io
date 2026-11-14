import test from 'node:test';
import assert from 'node:assert/strict';
import { isDrag, ambientOffset, clampToBox } from '../assets/js/graph-layout.js';

test('drift offset never exceeds the amplitude', () => {
	for (let i = 0; i < 2000; i++) {
		const t = i * 0.37;
		const o = ambientOffset(t, 0.5 + (i % 7) * 0.1, (i % 63) / 10, 8, 1);
		assert.ok(Math.abs(o) <= 8 + 1e-9, `t=${t} o=${o}`);
	}
});

test('drift ramps in and is zero for amp 0 or ramp 0', () => {
	for (let t = 0; t < 50; t += 0.9) {
		assert.equal(Math.abs(ambientOffset(t, 0.7, 1.2, 0, 1)), 0);
		assert.equal(Math.abs(ambientOffset(t, 0.7, 1.2, 8, 0)), 0);
	}
	assert.ok(Math.abs(ambientOffset(1, 0.7, 1.2, 8, 0.5)) <= 4);
});

test('clampToBox keeps values inside the padded box', () => {
	for (let v = -600; v <= 600; v += 7) {
		const c = clampToBox(v, 200, 12);
		assert.ok(c >= -188 && c <= 188, `v=${v} c=${c}`);
	}
	assert.equal(clampToBox(50, 200, 12), 50);
	assert.equal(clampToBox(-999, 200, 12), -188);
	assert.equal(clampToBox(999, 200, 12), 188);
});

test('drift plus clamp stays inside the box', () => {
	for (let i = 0; i < 500; i++) {
		const v = clampToBox(190 + ambientOffset(i * 0.5, 0.6, 0.3, 8, 1), 200, 12);
		assert.ok(v <= 188 && v >= -188);
	}
});

test('isDrag threshold is 5 px, inclusive', () => {
	assert.equal(isDrag(0, 0, 5), false);
	assert.equal(isDrag(4.9, 0, 5), false);
	assert.equal(isDrag(3, 3.9, 5), false);
	assert.equal(isDrag(5, 0, 5), true);
	assert.equal(isDrag(3, 4, 5), true);
	assert.equal(isDrag(0, -6, 5), true);
});
