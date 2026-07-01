import { db } from "../../../db";
import { IChatMember } from "./chats_members";

export const addMemberToChat = async (memberId: number, chatId: number) => {
	const baseChatMemberRoleId = 2; //ID роли обычного участника чата

	try {
		const insertResult = await db.query<IChatMember>(
			`INSERT INTO chats_members (chat_id, user_id, role_id) 
			VALUES ($1, $2, $3) 
			RETURNING id, chat_id, user_id, role_id`,
			[chatId, memberId, baseChatMemberRoleId]
		);
		
		if (insertResult.rows.length !== 0) {
			const insertedMemberInfo = insertResult.rows[0];
			return { status: 200, insertedMemberInfo: insertedMemberInfo };
		}

		return { status: 500, insertedMemberInfo: null };
	}

	catch(error) {
		console.error(error);
		return { status: 500, insertedMemberInfo: null };
	}
};

export const removeMemberFromChat = async (memberId: number, chatId: number) => {
	const deletedMemberInfo = await db.query(
		`
            DELETE FROM chats_members
            WHERE user_id = $1 AND chat_id = $2
            RETURNING user_id, chat_id
        `,
		[memberId, chatId]
	);

	if (deletedMemberInfo.rows.length !== 0) {
		return { status: 200, deletedMemberInfo: deletedMemberInfo.rows[0] };
	}

	return { status: 500, deletedMemberInfo: null };
};