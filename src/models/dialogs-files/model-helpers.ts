import { PoolClient } from "pg";
import { IFile } from "./dialogs-files";

/**
 * Вставляет массив файлов в таблицу files за один запрос.
 * files - Массив объектов без поля id (генерируется базой)
 * Возвращает массив вставленных записей с присвоенными id
 */

export async function insertFiles(client: PoolClient, files: Omit<IFile, "id">[]): Promise<IFile[]> {
	if (files.length === 0) return [];

	// Разделяем поля на отдельные массивы для передачи в UNNEST
	const names = files.map(f => f.name);
	const urls = files.map(f => f.url);
	const sizes = files.map(f => f.size);
	const types = files.map(f => f.type);
	const messageIds = files.map(f => f.message_id);

	const result = await client.query<IFile>(
		`
        INSERT INTO dialogs_files (name, url, size, type, message_id)
            SELECT * FROM UNNEST(
                $1::text[],
                $2::text[],
                $3::int[],
                $4::text[],
                $5::int[]
            )
            RETURNING id, name, url, size, type, message_id
        `,
		[names, urls, sizes, types, messageIds]
	);

	return result.rows;
}