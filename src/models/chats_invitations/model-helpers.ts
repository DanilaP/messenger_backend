import { db } from "../../../db";
import { IChatInvitation } from "./chats_invitations";
import { QueryResult, QueryResultRow } from "pg";

// Общий тип для любого объекта, поддерживающего query
type Queryable = {
  query<T extends QueryResultRow = any>(text: string, values?: any[]): Promise<QueryResult<T>>;
};

export const getInvitationInfoById = async (invitationId: number) => {
	const selectResult = await db.query<IChatInvitation>(
		`
			SELECT * FROM chats_invitations
			WHERE id = $1
		`,
		[invitationId]
	);
	if (selectResult.rows.length !== 0) {
		return { status: 200, invitationInfo: selectResult.rows[0] };
	}
	return { status: 404, invitationInfo: null };
};

export const deleteInvitation = async (
	client: Queryable,
	invitationId: number,
	userId: number
) => {
	const deletedResult = await client.query<IChatInvitation>(
		`
		DELETE FROM chats_invitations
		WHERE id = $1 and user_id = $2
		RETURNING id, chat_id, user_id
	`,
		[invitationId, userId]
	);

	if (deletedResult.rowCount !== 0) {
		return { status: 200 };
	}

	return { status: 404, message: "Приглашение не найдено" };

};
	
	
	