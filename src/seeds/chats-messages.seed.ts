// src/seed/chat-messages.seed.ts
import { from as copyFrom } from "pg-copy-streams";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { db } from "../../db"; // путь подгони под себя

const TOTAL_ROWS = 5_000_000;
const LOG_EVERY  = 10_000;
const CHAT_ID    = 4;
const SENDER_ID  = 7;
const TABLE      = "chats_messages"; // имя твоей таблицы

function csv(v: unknown): string {
	if (v === null || v === undefined) return "";
	return `"${String(v).replace(/"/g, '""')}"`;
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

// Формат: DD:MM:YYYY HH:MM:SS (локальное время)
function formatDate(d: Date): string {
	return (
		`${pad(d.getDate())}:${pad(d.getMonth() + 1)}:${d.getFullYear()} ` +
		`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
	);
}

export async function seedChatMessages(): Promise<void> {
	// 1. Проверяем, есть ли уже данные
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

	// 2. Узнаём последний id, чтобы продолжить нумерацию и подцепить FK
	const { rows: maxRows } = await db.query<{ max_id: string }>(
		`SELECT COALESCE(MAX(id), 0)::text AS max_id FROM ${TABLE}`
	);
	let currentId = Number(maxRows[0].max_id) + 1;
	let prevId: number | null = currentId > 1 ? currentId - 1 : null;

	// 3. Берём клиент из пула — COPY работает только через клиент
	const client = await db.getClient();

	try {
		const copyStream = client.query(
			copyFrom(`
				COPY ${TABLE}
					(id, text, date, chat_id, sender_id, is_read, reply_message_id)
				FROM STDIN WITH (FORMAT csv, NULL '')
			`)
		) as unknown as NodeJS.WritableStream;

		let inserted = 0;

		const source = new Readable({
			highWaterMark: 1 << 16,
			read() {
				while (inserted < toInsert) {
					const id = currentId;

					const row =
						[
							id,
							csv(`Test message #${id}`),
							csv(formatDate(new Date())),
							CHAT_ID,
							SENDER_ID,
							inserted % 2 === 0 ? "true" : "false",
							prevId === null ? "" : prevId, // пустое → NULL
						].join(",") + "\n";

					prevId = id;
					currentId++;
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

		// 4. Чиним sequence, т.к. id вставляли руками
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