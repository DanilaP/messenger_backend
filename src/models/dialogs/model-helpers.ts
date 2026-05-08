import { db } from "../../../db";

export const checkMember = async (userId: number, dialogId: number) => {
	const membersInfo = await db.query(
		`
            SELECT user_id from dialogs_members where dialog_id = $1
        `,
		[dialogId]
	);

	let isMember = false;
	membersInfo.rows.map(row => {
		if (row.user_id === userId) {
			isMember = true;
		}
	});

	return isMember;
};