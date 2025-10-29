/// <reference lib="webworker" />

let timer: ReturnType<typeof setTimeout> | null = null;
let currentInterval = 0;
let running = false;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function clearTimer() {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
}

function scheduleNext() {
	if (!running || currentInterval <= 0) return;
	clearTimer();
	timer = setTimeout(() => {
		if (!running) return;
		ctx.postMessage({ type: 'beat' });
		scheduleNext();
	}, currentInterval);
}

function start(interval: number) {
	currentInterval = Math.max(0, Number(interval) || 0);
	if (currentInterval <= 0) {
		stop();
		return;
	}
	running = true;
	scheduleNext();
}

function stop() {
	running = false;
	clearTimer();
}

ctx.onmessage = (event: MessageEvent) => {
	const payload = event?.data;
	if (!payload || typeof payload !== 'object') return;
	if (payload.type === 'start') {
		start(payload.interval);
	} else if (payload.type === 'stop') {
		stop();
	} else if (payload.type === 'dispose') {
		stop();
		ctx.postMessage({ type: 'dispose' });
		ctx.close();
	}
};

export {};
