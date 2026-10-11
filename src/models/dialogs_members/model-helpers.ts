import { PoolClient } from "pg";
import { IDialogsMembers } from "./dialogs_members";
import { db } from "../../../db";

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

export const isDialogBetweenUsersExists = async (userId: number, opponentId: number): Promise<{ dialogId: number | null }> => {
	const result = await db.query<{ dialogId: number }>(
		`
			SELECT dialog_id as "dialogId"
			FROM dialogs_members
			WHERE user_id IN ($1, $2)
			GROUP BY dialog_id
			HAVING COUNT(DISTINCT user_id) = 2;
		`,
		[userId, opponentId]
	);

	const dialogId = result?.rows[0]?.dialogId || null;
	return { dialogId };
};