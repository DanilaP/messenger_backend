// src/seed/chat-files.seed.ts
import { from as copyFrom } from "pg-copy-streams";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { db } from "../../db"; // путь подгони под себя

const TOTAL_ROWS = 5_000_000;
const LOG_EVERY  = 10_000;
const TABLE      = "chats_files"; // имя твоей таблицы

const TYPES = ["image", "video", "audio", "document"];
const EXTS: Record<string, string> = {
	image:    "jpg",
	video:    "mp4",
	audio:    "mp3",
	document: "pdf",
};

function csv(v: unknown): string {
	if (v === null || v === undefined) return "";
	return `"${String(v).replace(/"/g, '""')}"`;
}

function randInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randString(len: number): string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let s = "";
	for (let i = 0; i < len; i++) {
		s += chars[randInt(0, chars.length - 1)];
	}
	return s;
}

export async function seedChatFiles(): Promise<void> {
	// 1. Проверяем, сколько уже есть
	const { rows: cntRows } = await db.query<{ count: string }>(
		`SELECT COUNT(*)::text AS count FROM ${TABLE}`
	);
	const existing = Number(cntRows[0].count);

	if (existing >= TOTAL_ROWS) {
		console.log(`[seed] ${TABLE} уже содержит ${existing} записей — пропускаем`);
		return;
	}

	const toInsert = TOTAL_ROWS - existing;
	console.log(`[seed] Нужно вставить ${toInsert} записей в ${TABLE}`);

	// 2. Узнаём максимальный id, чтобы продолжить нумерацию
	const { rows: maxRows } = await db.query<{ max_id: string }>(
		`SELECT COALESCE(MAX(id), 0)::text AS max_id FROM ${TABLE}`
	);
	let currentId = Number(maxRows[0].max_id) + 1;

	// message_id начинаем с 1 (или с existing+1, если дозаполняем)
	let currentMessageId = existing + 1;

	const client = await db.getClient();

	try {
		const copyStream = client.query(
			copyFrom(`
				COPY ${TABLE}
					(id, name, url, type, size, message_id)
				FROM STDIN WITH (FORMAT csv, NULL '')
			`)
		) as unknown as NodeJS.WritableStream;

		let inserted = 0;

		const source = new Readable({
			highWaterMark: 1 << 16,
			read() {
				while (inserted < toInsert) {
					const id        = currentId;
					const type      = TYPES[randInt(0, TYPES.length - 1)];
					const ext       = EXTS[type];
					const name      = `${randString(12)}.${ext}`;
					const url       = `/files/chats/${currentMessageId}/${name}`;
					const size      = randInt(1_000, 50_000_000); // 1 КБ … ~48 МБ
					const messageId = currentMessageId;

					const row =
						[
							id,
							csv(name),
							csv(url),
							csv(type),
							size,
							messageId,
						].join(",") + "\n";

					currentId++;
					currentMessageId++;
					inserted++;

					if (inserted % LOG_EVERY === 0) {
						console.log(
							`[seed] Загружено: ${inserted.toLocaleString("ru-RU")} / ${toInsert.toLocaleString("ru-RU")}`
						);
					}

					if (!this.push(row)) return; // backpressure
				}
				this.push(null);
			},
		});

		const t0 = Date.now();
		await pipeline(source, copyStream);

		// 3. Чиним sequence
		await client.query(
			`SELECT setval(
				pg_get_serial_sequence('${TABLE}', 'id'),
				(SELECT MAX(id) FROM ${TABLE})
			)`
		);

		const sec = ((Date.now() - t0) / 1000).toFixed(1);
		console.log(`[seed] Готово. Вставлено ${inserted.toLocaleString("ru-RU")} за ${sec} с`);
	} finally {
		client.release();
	}
}