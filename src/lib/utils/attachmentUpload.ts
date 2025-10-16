import type { PendingAttachment } from '$lib/stores/pendingMessages';

export interface AttachmentUploadSlot {
	attachmentId: bigint;
	uploadUrl: string;
	uploadHeaders: Record<string, string>;
}

export interface MediaDimensions {
	width?: number;
	height?: number;
}

export interface UploadProgressEvent {
	uploadedBytes: number;
	totalBytes: number;
}

type UploadProgressCallback = (event: UploadProgressEvent) => void;

const FORBIDDEN_UPLOAD_HEADERS = new Set([
	'accept-charset',
	'accept-encoding',
	'access-control-request-headers',
	'access-control-request-method',
	'connection',
	'content-length',
	'cookie',
	'cookie2',
	'date',
	'dnt',
	'expect',
	'feature-policy',
	'host',
	'keep-alive',
	'origin',
	'referer',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
	'via'
]);

interface UploadHeaderEntry {
	name: string;
	lower: string;
	value: string;
}

function toBigInt(value: unknown): bigint {
	if (typeof value === 'bigint') {
		return value;
	}
	if (typeof value === 'string' || typeof value === 'number') {
		return BigInt(value);
	}
	throw new Error('Attachment response missing id');
}

export function normalizeUploadHeaders(input: unknown): Record<string, string> {
	if (!input || typeof input !== 'object') {
		return {};
	}

	const entries = new Map<string, string>();

	const addEntry = (name: unknown, value: unknown) => {
		if (typeof name !== 'string') return;
		const trimmed = name.trim();
		if (!trimmed) return;
		if (value == null) return;

		let normalized: string;
		if (Array.isArray(value)) {
			normalized = value
				.filter((item) => item != null)
				.map((item) => String(item))
				.join(', ');
		} else if (typeof value === 'object') {
			const record = value as Record<string, unknown>;
			const nested =
				record.value ??
				record.val ??
				record.headerValue ??
				(Array.isArray(record.values) ? record.values.join(', ') : undefined);
			if (nested == null) return;
			normalized = String(nested);
		} else {
			normalized = String(value);
		}

		if (!normalized.trim()) return;
		entries.set(trimmed, normalized);
	};

	if (Array.isArray(input)) {
		for (const entry of input) {
			if (!entry) continue;
			if (Array.isArray(entry) && entry.length >= 2) {
				addEntry(entry[0], entry[1]);
				continue;
			}
			if (typeof entry === 'object') {
				const record = entry as Record<string, unknown>;
				const name = record.name ?? record.key ?? record.header ?? record.headerName;
				const value =
					record.value ??
					record.val ??
					record.headerValue ??
					(Array.isArray(record.values) ? record.values.join(', ') : undefined);
				addEntry(name, value);
			}
		}
	} else {
		for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
			addEntry(name, value);
		}
	}

	return Object.fromEntries(entries.entries());
}

export function parseAttachmentUploadSlot(input: unknown): AttachmentUploadSlot {
	if (!input || typeof input !== 'object') {
		throw new Error('Attachment response missing data');
	}

	const record = input as Record<string, unknown>;
	const rawId = record.id ?? record.attachment_id ?? record.attachmentId;
	if (rawId == null) {
		throw new Error('Attachment response missing id');
	}

	const attachmentId = toBigInt(rawId);
	const urlCandidate = record.upload_url ?? record.uploadUrl ?? record.url;
	if (typeof urlCandidate !== 'string' || !urlCandidate.trim()) {
		throw new Error('Attachment response missing upload URL');
	}
	const uploadUrl = urlCandidate.trim();
	const headers = normalizeUploadHeaders(
		record.upload_headers ?? record.uploadHeaders ?? record.headers
	);

	return {
		attachmentId,
		uploadUrl,
		uploadHeaders: headers
	};
}

export function createObjectUrl(file: File): string | null {
	try {
		if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
			return URL.createObjectURL(file);
		}
	} catch {
		// ignore
	}
	return null;
}

export function revokeObjectUrl(url: string | null | undefined) {
	if (!url || typeof url !== 'string') return;
	if (!url.startsWith('blob:')) return;
	try {
		URL.revokeObjectURL(url);
	} catch {
		// ignore
	}
}

export async function readMediaDimensions(file: File): Promise<MediaDimensions> {
	const type = file.type || '';
	if (!type.startsWith('image/') && !type.startsWith('video/')) {
		return {};
	}

	const objectUrl = createObjectUrl(file);
	if (!objectUrl) {
		return {};
	}

	return new Promise<MediaDimensions>((resolve) => {
		if (type.startsWith('image/')) {
			const image = new Image();
			const finalize = () => revokeObjectUrl(objectUrl);
			image.onload = () => {
				const width = image.naturalWidth || image.width || 0;
				const height = image.naturalHeight || image.height || 0;
				finalize();
				resolve(width > 0 && height > 0 ? { width, height } : {});
			};
			image.onerror = () => {
				finalize();
				resolve({});
			};
			image.src = objectUrl;
			return;
		}

		const video = document.createElement('video');
		let settled = false;
		const cleanup = () => {
			if (settled) return;
			settled = true;
			video.removeEventListener('loadedmetadata', handleLoadedMetadata);
			video.removeEventListener('error', handleError);
			try {
				video.pause();
			} catch {
				// ignore
			}
			video.removeAttribute('src');
			try {
				video.load();
			} catch {
				// ignore
			}
			revokeObjectUrl(objectUrl);
		};

		const handleLoadedMetadata = () => {
			cleanup();
			const width = video.videoWidth || video.width || 0;
			const height = video.videoHeight || video.height || 0;
			resolve(width > 0 && height > 0 ? { width, height } : {});
		};

		const handleError = () => {
			cleanup();
			resolve({});
		};

		video.preload = 'metadata';
		video.muted = true;
		video.playsInline = true;
		video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
		video.addEventListener('error', handleError, { once: true });
		video.src = objectUrl;
		try {
			video.load();
		} catch {
			// ignore
		}
	});
}

function sanitizeHeaderEntries(headers: Record<string, string> | undefined): UploadHeaderEntry[] {
	if (!headers) return [];
	const entries: UploadHeaderEntry[] = [];
	for (const [name, rawValue] of Object.entries(headers)) {
		if (name == null) continue;
		const trimmedName = name.trim();
		if (!trimmedName) continue;
		if (rawValue == null) continue;
		const value = String(rawValue);
		entries.push({ name: trimmedName, lower: trimmedName.toLowerCase(), value });
	}
	return entries;
}

function buildUploadHeaderEntries(
	headers: Record<string, string> | undefined,
	file: File
): UploadHeaderEntry[] {
	const entries = sanitizeHeaderEntries(headers);
	return entries
		.filter((entry) => !FORBIDDEN_UPLOAD_HEADERS.has(entry.lower))
		.map((entry) => {
			if (entry.lower === 'content-type' && !entry.value && file.type) {
				return { ...entry, value: file.type };
			}
			return entry;
		})
		.filter((entry) => entry.value.trim() !== '');
}

function toHeadersInit(entries: UploadHeaderEntry[]): Headers | undefined {
	if (!entries.length) return undefined;
	const headers = new Headers();
	for (const entry of entries) {
		headers.set(entry.name, entry.value);
	}
	return headers;
}

async function uploadWithXmlHttpRequest(
	url: string,
	file: File,
	entries: UploadHeaderEntry[],
	totalBytes: number,
	onProgress: UploadProgressCallback,
	signal?: AbortSignal
) {
	await new Promise<void>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('PUT', url, true);
		xhr.withCredentials = false;

		for (const entry of entries) {
			try {
				xhr.setRequestHeader(entry.name, entry.value);
			} catch (err) {
				console.warn('Unable to set upload header', entry.name, err);
			}
		}

		const abortHandler = () => xhr.abort();
		if (signal) {
			if (signal.aborted) {
				reject(new DOMException('Upload aborted', 'AbortError'));
				return;
			}
			signal.addEventListener('abort', abortHandler, { once: true });
			xhr.addEventListener(
				'loadend',
				() => {
					signal.removeEventListener('abort', abortHandler);
				},
				{ once: true }
			);
		}

		xhr.upload.onprogress = (event) => {
			const uploaded = event.loaded;
			const total = event.lengthComputable ? event.total : totalBytes;
			onProgress({ uploadedBytes: uploaded, totalBytes: total });
		};

		xhr.onload = () => {
			const status = xhr.status === 0 ? 200 : xhr.status;
			if (status >= 200 && status < 300) {
				onProgress({ uploadedBytes: totalBytes, totalBytes });
				resolve();
			} else {
				reject(new Error(`Upload failed with status ${status}`));
			}
		};

		xhr.onerror = () => reject(new Error('Upload failed'));
		xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));

		try {
			xhr.send(file);
		} catch (err) {
			reject(err instanceof Error ? err : new Error('Upload failed'));
		}
	});
}

export async function uploadFileWithProgress(options: {
	url: string;
	file: File;
	headers?: Record<string, string>;
	onProgress?: UploadProgressCallback;
	signal?: AbortSignal;
}) {
	const { url, file, headers, onProgress = () => undefined, signal } = options;
	if (!url) {
		throw new Error('Upload URL missing');
	}

	const entries = buildUploadHeaderEntries(headers, file);
	const totalBytes = file.size > 0 ? file.size : 0;

	if (typeof XMLHttpRequest !== 'undefined') {
		await uploadWithXmlHttpRequest(url, file, entries, totalBytes, onProgress, signal);
		return;
	}

	const res = await fetch(url, {
		method: 'PUT',
		body: file,
		headers: toHeadersInit(entries),
		mode: 'cors',
		credentials: 'omit',
		signal
	});

	if (!res.ok && res.type !== 'opaque') {
		throw new Error(`Upload failed with status ${res.status}`);
	}

	const finalTotal = totalBytes > 0 ? totalBytes : file.size;
	onProgress({ uploadedBytes: finalTotal, totalBytes: finalTotal });
}

export function cloneAttachmentWithFreshPreview(attachment: PendingAttachment): PendingAttachment {
	let previewUrl = attachment.previewUrl;
	if (previewUrl && previewUrl.startsWith('blob:')) {
		const fresh = createObjectUrl(attachment.file);
		if (fresh) {
			previewUrl = fresh;
		}
	}

	return {
		...attachment,
		previewUrl,
		status: 'queued',
		progress: 0,
		uploadedBytes: 0,
		error: null
	};
}
