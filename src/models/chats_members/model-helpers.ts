import { db } from "../../../db";

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