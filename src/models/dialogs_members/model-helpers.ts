import { PoolClient } from "pg";
import { IDialogsMembers } from "./dialogs_members";

export async function insertDialogMembers(client: PoolClient, dialogId: number, userIds: number[]): Promise<IDialogsMembers[]> {
	if (userIds.length === 0) return [];

	// Создаем массив dialogId той же длины, что и userIds
	const dialogIds = Array(userIds.length).fill(dialogId);

	const result = await client.query<IDialogsMembers>(
		`
            INSERT INTO dialogs_members (dialog_id, user_id)
            SELECT * FROM UNNEST($1::int[], $2::int[])
            RETURNING id, dialog_id, user_id
        `,
		[dialogIds, userIds]
	);

	return result.rows;
}