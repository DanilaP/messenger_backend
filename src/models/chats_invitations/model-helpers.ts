import { db } from "../../../db";
import { IChatInvitation } from "./chats_invitations";

export const deleteInvitation = async (invitationId: number, userId: number) => {
	const deletedResult = await db.query<IChatInvitation>(
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
    
	return { status: 500 };
};